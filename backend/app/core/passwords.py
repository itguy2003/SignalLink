"""비밀번호 복잡도 검사.

**배포(운영) 환경에서만 강제한다.** 개발·시연 환경은 외우기 쉬운 계정
(test1234 등)으로 돌아가야 해서, 기본은 운영 DB(PostgreSQL)일 때만 켠다.
``PASSWORD_COMPLEXITY`` 로 명시적으로 켜고 끌 수 있다(on / off / auto).

규칙: 8자 이상(길이는 스키마가 이미 검사)에 더해 **영문·숫자·특수문자를
각각 하나 이상** 포함해야 한다. 규칙을 한 곳에 두는 이유는, 가입·비밀번호
변경·관리자 재설정이 서로 다른 기준으로 갈라지면 "여기서는 되는데 저기서는
안 되는" 비밀번호가 생기기 때문이다.
"""

from __future__ import annotations

import re

from app.core.config import settings

_LETTER = re.compile(r"[A-Za-z]")
_DIGIT = re.compile(r"\d")
_SPECIAL = re.compile(r"[^A-Za-z0-9]")


def complexity_enabled() -> bool:
    """복잡도 검사를 할 것인가.

    auto(기본)는 운영 DB 로 판정한다 — 배포 환경은 PostgreSQL 을 쓴다
    (CLAUDE.md 의 스택 표). 개발 SQLite 에서는 꺼진다.
    """
    mode = (settings.PASSWORD_COMPLEXITY or "auto").lower()
    if mode == "on":
        return True
    if mode == "off":
        return False
    return not settings.is_sqlite


def complexity_error(password: str) -> str | None:
    """규칙 위반이면 사용자에게 보여 줄 문구, 통과면 None.

    검사가 꺼져 있어도 호출부가 조건을 신경 쓰지 않도록 여기서 걸러 준다.
    """
    if not complexity_enabled():
        return None
    missing: list[str] = []
    if not _LETTER.search(password):
        missing.append("영문")
    if not _DIGIT.search(password):
        missing.append("숫자")
    if not _SPECIAL.search(password):
        missing.append("특수문자")
    if missing:
        return f"비밀번호는 영문·숫자·특수문자를 모두 포함해야 합니다(누락: {', '.join(missing)})."
    return None
