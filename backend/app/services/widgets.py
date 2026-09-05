"""위젯 레지스트리.

위젯은 DB 에 저장되지 않고 시스템이 동적으로 제공한다(요구사항 #위젯).
새 위젯을 추가하려면 ``@register`` 로 명세를 등록하고, 데이터가 필요한
위젯이면 ``@data_provider`` 로 조회 함수를 등록한다. 편집기 팔레트와
플레이어 렌더러 선택이 모두 이 레지스트리를 기준으로 동작한다.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import nulls_last, select
from sqlalchemy.orm import Session

from app.models.board import BoardPost, OrgBoard
from app.models.enums import BoardKind
from app.schemas.widget import WidgetOptionSpec, WidgetSpec
from app.services import transitions

_REGISTRY: dict[str, WidgetSpec] = {}
_PROVIDERS: dict[str, Callable[[Session, int, dict[str, Any]], Any]] = {}


def register(spec: WidgetSpec) -> WidgetSpec:
    _REGISTRY[spec.key] = spec
    return spec


def data_provider(key: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        _PROVIDERS[key] = fn
        return fn

    return _decorator


def list_widgets() -> list[WidgetSpec]:
    return sorted(_REGISTRY.values(), key=lambda w: (w.category, w.name))


def get_widget(key: str) -> WidgetSpec | None:
    return _REGISTRY.get(key)


def fetch_data(db: Session, key: str, org_id: int, options: dict[str, Any]) -> Any:
    provider = _PROVIDERS.get(key)
    if provider is None:
        return None
    return provider(db, org_id, options)


# --------------------------------------------------------------------------
# 기능형 위젯 (데이터 수집 + 표출)
# --------------------------------------------------------------------------

_COUNT_OPTION = WidgetOptionSpec(key="count", label="표시 건수", type="number", default=5)


def _board_widget(key: str, name: str, description: str) -> WidgetSpec:
    return register(
        WidgetSpec(
            key=key,
            name=name,
            category="기능형",
            description=description,
            data_driven=True,
            refresh_sec=600,
            default_size={"w": 700, "h": 500},
            options=[
                _COUNT_OPTION,
                WidgetOptionSpec(key="title", label="제목", type="text", default=name),
                WidgetOptionSpec(key="board_id", label="연결 게시판", type="select"),
            ],
        )
    )


NOTICE = _board_widget("notice", "공지사항", "기관 게시판에서 수집한 공지사항 목록")
NEWSLETTER = _board_widget("newsletter", "가정통신문", "기관 게시판에서 수집한 가정통신문 목록")

SCHOOL_CALENDAR = register(
    WidgetSpec(
        key="school_calendar",
        name="학사일정",
        category="기능형",
        description="월별 학사일정",
        data_driven=True,
        refresh_sec=3600,
        options=[WidgetOptionSpec(key="month", label="기준 월(비우면 이번 달)", type="number")],
    )
)

MEAL = register(
    WidgetSpec(
        key="meal",
        name="급식메뉴",
        category="기능형",
        description="오늘의 급식 식단",
        data_driven=True,
        refresh_sec=3600,
        default_size={"w": 500, "h": 600},
    )
)

TIMETABLE = register(
    WidgetSpec(
        key="timetable",
        name="시간표",
        category="기능형",
        description="학급 시간표",
        data_driven=True,
        refresh_sec=3600,
        options=[
            WidgetOptionSpec(key="grade", label="학년", type="number"),
            WidgetOptionSpec(key="class_no", label="반", type="number"),
        ],
    )
)

D_DAY = register(
    WidgetSpec(
        key="dday",
        name="D-Day",
        category="기능형",
        description="지정한 날짜까지 남은 일수",
        default_size={"w": 400, "h": 200},
        options=[
            WidgetOptionSpec(
                key="label", label="표시 문구", type="text", default="D-Day", required=True
            ),
            WidgetOptionSpec(key="target_date", label="목표 일자", type="text", required=True),
        ],
    )
)

FAMOUS_PAINTING = register(
    WidgetSpec(
        key="painting",
        name="명화",
        category="기능형",
        description="명화 이미지와 설명",
        data_driven=True,
        refresh_sec=86400,
    )
)

QUOTE = register(
    WidgetSpec(
        key="quote",
        name="명언",
        category="기능형",
        description="오늘의 명언",
        data_driven=True,
        refresh_sec=86400,
        default_size={"w": 800, "h": 250},
    )
)

ENGLISH_WORD = register(
    WidgetSpec(
        key="english_word",
        name="영단어",
        category="기능형",
        description="오늘의 영단어",
        data_driven=True,
        refresh_sec=86400,
    )
)

ENGLISH_IDIOM = register(
    WidgetSpec(
        key="english_idiom",
        name="영숙어",
        category="기능형",
        description="오늘의 영숙어",
        data_driven=True,
        refresh_sec=86400,
    )
)

CLOCK = register(
    WidgetSpec(
        key="clock",
        name="시계",
        category="기능형",
        description="현재 시각",
        default_size={"w": 400, "h": 200},
        options=[
            WidgetOptionSpec(
                key="format",
                label="형식",
                type="select",
                default="HH:mm:ss",
                choices=[
                    {"value": "HH:mm", "label": "시:분"},
                    {"value": "HH:mm:ss", "label": "시:분:초"},
                    {"value": "yyyy-MM-dd HH:mm", "label": "날짜 + 시:분"},
                ],
            )
        ],
    )
)

WEATHER = register(
    WidgetSpec(
        key="weather",
        name="날씨",
        category="기능형",
        description="기관 위치 기준 현재 날씨",
        data_driven=True,
        refresh_sec=1800,
    )
)

# --------------------------------------------------------------------------
# 콘텐츠형 위젯
# --------------------------------------------------------------------------

ALBUM = register(
    WidgetSpec(
        key="album",
        name="이미지앨범",
        category="콘텐츠형",
        description="여러 이미지를 정한 간격으로 넘겨 표출",
        default_size={"w": 800, "h": 600},
        options=[
            # ``image_list`` 와 ``transition`` 은 편집기가 전용 편집칸을 그린다.
            # 글상자로는 다룰 수 없기 때문이다 — 앞의 것은 여러 장을 넣고 순서를
            # 바꾸는 일이고, 뒤의 것은 서버가 가진 효과 목록에서 고르는 일이다.
            WidgetOptionSpec(
                key="images",
                label="이미지",
                type="image_list",
                default=[],
                required=True,
            ),
            # 0 초는 한 틱에 목록을 다 돌아 화면이 깜빡인다. 한 장을 알아볼
            # 수 있는 최소가 1 초다.
            WidgetOptionSpec(
                key="interval_sec",
                label="넘김 간격(초)",
                type="number",
                default=8,
                min=1,
                max=3600,
            ),
            WidgetOptionSpec(
                key="transition",
                label="전환 효과",
                type="transition",
                default=transitions.DEFAULT_TRANSITION,
            ),
            WidgetOptionSpec(
                key="transition_ms",
                label="전환 시간(ms)",
                type="number",
                default=transitions.DEFAULT_TRANSITION_MS,
                min=transitions.MIN_TRANSITION_MS,
                max=transitions.MAX_TRANSITION_MS,
            ),
            WidgetOptionSpec(
                key="fit",
                label="채우는 방식",
                type="select",
                default="cover",
                choices=[
                    {"value": "cover", "label": "화면 채우기(잘릴 수 있음)"},
                    {"value": "contain", "label": "전체 보이기(여백이 생김)"},
                ],
            ),
        ],
    )
)

COMMUNITY = register(
    WidgetSpec(
        key="community",
        name="커뮤니티",
        category="콘텐츠형",
        description="커뮤니티 콘텐츠를 재생목록처럼 순환 표출",
        data_driven=True,
        refresh_sec=600,
        default_size={"w": 800, "h": 600},
        # 옵션이 없다. 무엇을 틀지는 서버가 고른다 — 콘텐츠의 사용기간과
        # 사용대상(장치의 학교급)에 맞는 것 중 가장 최근 것. 화면마다 고르게
        # 하면 기간이 지나거나 대상이 어긋난 채 방치된다.
        options=[],
    )
)

AI_IMAGE = register(
    WidgetSpec(
        key="ai_image",
        name="AI 생성 이미지",
        category="콘텐츠형",
        description="프롬프트로 생성한 이미지",
        options=[WidgetOptionSpec(key="prompt", label="프롬프트", type="text", required=True)],
    )
)


# --------------------------------------------------------------------------
# 데이터 제공자
# --------------------------------------------------------------------------


def _posts_for(db: Session, org_id: int, kind: BoardKind, limit: int) -> list[dict[str, Any]]:
    stmt = (
        select(BoardPost)
        .join(OrgBoard, BoardPost.board_id == OrgBoard.id)
        .where(OrgBoard.org_id == org_id, OrgBoard.kind == kind)
        # NULL 정렬 위치가 SQLite 와 PostgreSQL 에서 다르므로 명시한다.
        .order_by(nulls_last(BoardPost.posted_on.desc()), BoardPost.id.desc())
        .limit(limit)
    )
    return [
        {
            "id": p.id,
            "title": p.title,
            "author": p.author,
            "posted_on": p.posted_on.isoformat() if p.posted_on else None,
        }
        for p in db.execute(stmt).scalars().all()
    ]


@data_provider("notice")
def _notice_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    return _posts_for(db, org_id, BoardKind.BOARD, int(options.get("count", 5)))


@data_provider("newsletter")
def _newsletter_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    return _posts_for(db, org_id, BoardKind.BOARD, int(options.get("count", 5)))


@data_provider("school_calendar")
def _calendar_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    month = options.get("month") or date.today().month
    stmt = (
        select(BoardPost)
        .join(OrgBoard, BoardPost.board_id == OrgBoard.id)
        .where(
            OrgBoard.org_id == org_id,
            OrgBoard.kind == BoardKind.CALENDAR,
            BoardPost.month == int(month),
        )
        .order_by(BoardPost.day)
    )
    return [
        {
            "day": p.day,
            "title": p.title,
            "posted_on": p.posted_on.isoformat() if p.posted_on else None,
        }
        for p in db.execute(stmt).scalars().all()
    ]


@data_provider("meal")
def _meal_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    today = date.today()
    stmt = (
        select(BoardPost)
        .join(OrgBoard, BoardPost.board_id == OrgBoard.id)
        .where(
            OrgBoard.org_id == org_id,
            OrgBoard.kind == BoardKind.MEAL,
            BoardPost.year == today.year,
            BoardPost.month == today.month,
            BoardPost.day == today.day,
        )
        .limit(3)
    )
    return [{"title": p.title, "content": p.content} for p in db.execute(stmt).scalars().all()]


@data_provider("timetable")
def _timetable_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    stmt = (
        select(BoardPost)
        .join(OrgBoard, BoardPost.board_id == OrgBoard.id)
        .where(OrgBoard.org_id == org_id, OrgBoard.kind == BoardKind.TIMETABLE)
        .order_by(BoardPost.id.desc())
        .limit(1)
    )
    post = db.execute(stmt).scalars().first()
    return {"title": post.title, "content": post.content} if post else None


_QUOTES = [
    {"text": "오늘 걷지 않으면 내일은 뛰어야 한다.", "author": "속담"},
    {"text": "배움에는 끝이 없다.", "author": "속담"},
    {"text": "천 리 길도 한 걸음부터.", "author": "속담"},
]
_WORDS = [
    {"word": "diligent", "meaning": "부지런한", "example": "She is a diligent student."},
    {"word": "resilient", "meaning": "회복력 있는", "example": "Children are resilient."},
    {"word": "curious", "meaning": "호기심 많은", "example": "He is curious about science."},
]
_IDIOMS = [
    {"idiom": "hit the books", "meaning": "공부에 열중하다"},
    {"idiom": "break the ice", "meaning": "어색함을 깨다"},
    {"idiom": "under the weather", "meaning": "몸이 좋지 않다"},
]


def _pick_of_day(items: list[dict[str, Any]]) -> dict[str, Any]:
    """날짜 기준으로 항상 같은 항목을 고른다(장치 간 표출 일치)."""
    return items[date.today().toordinal() % len(items)]


@data_provider("quote")
def _quote_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    return _pick_of_day(_QUOTES)


@data_provider("english_word")
def _word_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    return _pick_of_day(_WORDS)


@data_provider("english_idiom")
def _idiom_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    return _pick_of_day(_IDIOMS)


@data_provider("painting")
def _painting_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    # TODO: 외부 명화 API/큐레이션 DB 연동. 현재는 자리표시자.
    return {"title": "별이 빛나는 밤", "artist": "빈센트 반 고흐", "src": None}


@data_provider("community")
def _community_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    """커뮤니티 위젯이 틀 콘텐츠.

    장치(플레이어)와 편집기 미리보기가 함께 부른다. 무엇을 틀지는 서버가
    고른다 — 화면마다 고르게 하면 기간이 지나거나 대상이 어긋난 채 방치된다.

    울타리    요청한 기관의 커뮤니티 것만 나간다.
    사용기간  콘텐츠가 들고 있다. 기간 밖이면 후보에서 빠진다.
    사용대상  장치가 놓인 기관의 학교급과 맞아야 한다 — 초등학교 장치에는
              '초' 와 '전체' 만 나간다. 학교급이 없는 곳(교육청)은 '전체' 만.

    맞는 것 중 **가장 최근 것 하나**를 튼다. 최신 것이 기간 밖이면 그 아래에서
    찾는다 — 빈 화면보다 낫다.
    """
    from sqlalchemy import select as _select

    from app.models.community_content import CommunityContent
    from app.models.organization import Organization
    from app.services import permissions

    community_org = permissions.community_org_of(db, org_id)
    if community_org is None:
        return None

    org = db.get(Organization, org_id)
    level = org.school_level if org else None
    audiences = {"전체"} | ({str(level)} if level else set())

    today = date.today().isoformat()

    def _fits(row: CommunityContent) -> bool:
        if row.audience not in audiences:
            return False
        if row.start_date and today < row.start_date:
            return False
        return not (row.end_date and today > row.end_date)

    rows = (
        db.execute(
            _select(CommunityContent)
            .where(CommunityContent.org_id == community_org)
            .order_by(CommunityContent.id.desc())
        )
        .scalars()
        .all()
    )
    if not rows:
        return None

    content = next((row for row in rows if _fits(row)), None)
    if content is None:
        # 콘텐츠는 있는데 지금 이 장치에 틀 것이 없다(기간 밖이거나 대상 밖).
        return {"active": False, "title": None, "version": 0, "document": None}

    # 문서는 CMS 콘텐츠와 같은 계약이라 플레이어가 그대로 그린다. 자산 주소는
    # 편집기가 저장할 때부터 열쇠 붙은 공개 주소다(``services/assets.public_url``).
    return {
        "active": True,
        "title": content.title,
        "version": content.version,
        "document": content.document,
    }


@data_provider("weather")
def _weather_data(db: Session, org_id: int, options: dict[str, Any]) -> Any:
    """기관 좌표 기준 날씨와 미세먼지.

    날씨 위젯과 콘텐츠 상단 정보 표시줄(``layout.info_bar``)이 함께 쓴다.
    연동되면 ``available: True`` 와 함께 다음 모양으로 돌려줄 것:
    ``{temp, condition, icon, high, low, dust, pm10}`` — ``dust`` 는 미세먼지
    등급 문구, ``pm10`` 은 ㎍/㎥ 수치다.

    TODO: 기상청 단기예보 + 에어코리아 대기질 API 연동. 현재는 좌표만 확인해
    자리표시자를 돌려준다(클라이언트는 샘플로 그린다).
    """
    from app.models.organization import Organization

    org = db.get(Organization, org_id)
    if org is None or org.latitude is None or org.longitude is None:
        return {"available": False, "reason": "기관 좌표가 등록되지 않았습니다."}
    return {
        "available": False,
        "reason": "날씨 API 미연동",
        "lat": org.latitude,
        "lon": org.longitude,
        "fetched_at": datetime.now(UTC).isoformat(),
    }
