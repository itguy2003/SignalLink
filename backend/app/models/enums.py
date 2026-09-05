"""도메인 열거형.

DB 에는 문자열(VARCHAR)로 저장한다. PostgreSQL ENUM 타입은 SQLite 에 없고
마이그레이션 비용이 크므로 사용하지 않는다.
"""

from enum import StrEnum


class OrgType(StrEnum):
    ORG = "기관"
    SCHOOL = "학교"
    ETC = "기타"


class SchoolLevel(StrEnum):
    ELEMENTARY = "초"
    MIDDLE = "중"
    HIGH = "고"


class BoardKind(StrEnum):
    BOARD = "게시판"
    CALENDAR = "일정"
    MEAL = "급식메뉴"
    TIMETABLE = "시간표"


class ScrapeResult(StrEnum):
    SUCCESS = "성공"
    FAIL = "실패"


class UserStatus(StrEnum):
    APPROVED = "승인"
    PENDING = "미승인"


class Role(StrEnum):
    """역할. 숫자가 클수록 상위 권한이다(권한 비교용은 RANK 참조)."""

    SUPER_ADMIN = "SUPER_ADMIN"
    ORG_ADMIN = "ORG_ADMIN"
    DEVICE_MANAGER = "DEVICE_MANAGER"
    HOMEROOM_TEACHER = "HOMEROOM_TEACHER"
    MEMBER = "MEMBER"
    #: 기관 바깥에서 게시판만 쓰는 사람(학부모·지역 주민 등). 관리 화면에는
    #: 들어오지 못하고, 소속 기관 게시판을 읽고 글을 올릴 수 있다.
    COMMUNITY_USER = "COMMUNITY_USER"


#: 역할 서열. 상위 역할이 하위 역할의 권한을 포함하지는 않지만,
#: "누가 누구를 승인/관리할 수 있는가" 판정에 사용한다.
ROLE_RANK: dict[Role, int] = {
    Role.SUPER_ADMIN: 100,
    Role.ORG_ADMIN: 80,
    Role.DEVICE_MANAGER: 60,
    Role.HOMEROOM_TEACHER: 40,
    Role.MEMBER: 10,
    Role.COMMUNITY_USER: 5,
}


class DeviceOS(StrEnum):
    WINDOWS = "Windows"
    ANDROID = "Android"
    IOS = "IOS"


class FormFactor(StrEnum):
    KIOSK = "키오스크형"
    DID = "DID형"


class PanelType(StrEnum):
    LANDSCAPE = "LANDSCAPE"
    PORTRAIT = "PORTRAIT"


class PlaceKind(StrEnum):
    CLASSROOM = "교실"
    ETC = "기타"


class DeviceKind(StrEnum):
    """장치관리 절의 '장치구분(일반, 전자칠판)'."""

    NORMAL = "일반"
    EBOARD = "전자칠판"


class ScheduleKind(StrEnum):
    TIME_BASED = "시간지정"
    LIST_LOOP = "목록반복"
