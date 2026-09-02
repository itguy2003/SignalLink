"""콘텐츠 문서와 재생목록의 연결.

콘텐츠 문서는 통째로 JSON 이라, '이 재생목록을 쓰는 콘텐츠' 를 찾으려면
매번 모든 문서를 뒤져야 한다. 대신 저장할 때 문서를 한 번 훑어 색인
(``ContentPlaylist``)을 남긴다.

이 색인이 없으면 재생목록을 고쳤을 때 어느 스케줄의 버전을 올려야 하는지
알 수 없고, 장치는 바뀐 재생목록을 영영 받지 못한다.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import Content
from app.models.playlist import ContentPlaylist, Playlist
from app.services import transitions

#: 재생목록을 가리키는 요소의 타입. 콘텐츠 편집기와 플레이어가 함께 아는 값이다.
ELEMENT_TYPE = "playlist"


def referenced_ids(document: dict[str, Any] | None) -> set[int]:
    """문서가 참조하는 재생목록 id 를 모은다.

    형식이 어긋난 요소는 조용히 건너뛴다. 색인을 만들다가 저장이 실패하면
    편집 내용을 잃는데, 색인은 그만한 값어치가 없다.
    """
    found: set[int] = set()
    for element in (document or {}).get("elements") or []:
        if not isinstance(element, dict) or element.get("type") != ELEMENT_TYPE:
            continue
        playlist_id = (element.get("options") or {}).get("playlist_id")
        if isinstance(playlist_id, int):
            found.add(playlist_id)
    return found


def sync_links(db: Session, content: Content) -> None:
    """콘텐츠의 재생목록 색인을 문서와 맞춘다. 커밋은 호출자가 한다."""
    wanted = referenced_ids(content.document)
    # 존재하지 않는 재생목록은 색인하지 않는다. FK 위반으로 저장이 통째로 실패한다.
    if wanted:
        alive = set(
            db.execute(select(Playlist.id).where(Playlist.id.in_(wanted))).scalars().all()
        )
        wanted &= alive

    current = {link.playlist_id for link in content.playlist_links}
    for link in list(content.playlist_links):
        if link.playlist_id not in wanted:
            content.playlist_links.remove(link)
    for playlist_id in wanted - current:
        content.playlist_links.append(ContentPlaylist(playlist_id=playlist_id))
    db.flush()


def inline_into_document(db: Session, document: dict[str, Any]) -> dict[str, Any]:
    """문서 안의 재생목록 요소에 실제 칸 목록을 채워 넣는다.

    플레이어가 재생목록의 존재를 몰라도 되게 하기 위한 것이다 — 콘텐츠
    라이브러리 참조를 서버가 인라인해 주는 것과 같은 방식이다
    (``schedule_service._player_item``).

    원본을 건드리지 않는다. 저장된 문서에는 참조만 남아 있어야 재생목록을
    고쳤을 때 다음 표출에 반영된다.
    """
    ids = referenced_ids(document)
    if not ids:
        return document

    playlists = {
        playlist.id: playlist
        for playlist in db.execute(select(Playlist).where(Playlist.id.in_(ids))).scalars().all()
    }

    elements = []
    for element in document.get("elements") or []:
        if not isinstance(element, dict) or element.get("type") != ELEMENT_TYPE:
            elements.append(element)
            continue

        options = dict(element.get("options") or {})
        playlist = playlists.get(options.get("playlist_id"))
        options["items"] = (
            [
                {
                    "widget_key": item.widget_key,
                    "duration_sec": item.duration_sec,
                    "options": item.options or {},
                    # 넘어가는 방식도 플레이어가 그린다. 이름을 여기서
                    # 정규화해 두면 각 플레이어가 따로 방어하지 않아도 된다.
                    "transition": transitions.normalize(item.transition),
                    "transition_ms": transitions.normalize_ms(item.transition_ms),
                }
                for item in playlist.items
            ]
            if playlist is not None
            # 지워진 재생목록을 가리키면 빈 목록이다. 플레이어는 아무것도 안 그린다.
            else []
        )
        elements.append({**element, "options": options})

    return {**document, "elements": elements}
