"""개발용 시연 데이터 시드.

**DB 의 모든 자료를 지우고** 처음부터 다시 채운다. 개발·시연용이며 운영
DB 에서 실행할 일이 없다 — 그래서 실행 전에 한 번 확인을 받는다.

스키마는 건드리지 않는다. 표를 지우고 다시 만들면 Alembic 이 관리하는
상태(`alembic_version`)와 어긋나, 다음 마이그레이션이 붙지 않는다. 행만
지우고 그 위에 채운다.

    python -m scripts.seed_demo          # 확인을 묻는다
    python -m scripts.seed_demo --yes    # 묻지 않는다
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, select, update

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.asset import Asset, ContentAsset
from app.models.board import BoardPost, OrgBoard
from app.models.community_playlist import CommunityPlaylist, CommunityPlaylistAsset
from app.models.content import Content
from app.models.device import (
    Device,
    DeviceGroup,
    DeviceGroupMember,
    DeviceManager,
    DeviceScheduleLink,
    DeviceScreenshot,
)
from app.models.enums import (
    BoardKind,
    DeviceKind,
    DeviceOS,
    FormFactor,
    OrgType,
    PanelType,
    PlaceKind,
    Role,
    ScheduleKind,
    SchoolLevel,
    ScrapeResult,
    UserStatus,
)
from app.models.organization import Organization
from app.models.playlist import ContentPlaylist, Playlist, PlaylistItem
from app.models.schedule import Schedule, ScheduleItem
from app.models.user import LoginLog, User, UserRole

#: 시연 계정의 공통 비밀번호. 개발용이라 외우기 쉬운 값을 쓴다.
PASSWORD = "test1234"

#: 최고관리자만 부트스트랩 기본값을 그대로 쓴다 — 이미 그 값으로 쓰고 있어서,
#: 여기서 바꾸면 아무도 못 들어가는 상태가 될 수 있다.
ADMIN_PASSWORD = "admin1234"

#: 지우는 순서. 자식(참조하는 쪽)을 먼저 지워야 외래키가 걸리지 않는다.
DELETE_ORDER = [
    CommunityPlaylistAsset,
    CommunityPlaylist,
    ContentAsset,
    Asset,
    ContentPlaylist,
    PlaylistItem,
    Playlist,
    DeviceGroupMember,
    DeviceGroup,
    DeviceManager,
    DeviceScheduleLink,
    DeviceScreenshot,
    ScheduleItem,
    Device,
    Schedule,
    Content,
    BoardPost,
    OrgBoard,
    LoginLog,
    UserRole,
    User,
    Organization,
]


def wipe(db) -> None:  # noqa: ANN001
    # 기관은 자기 자신을 참조한다(상급기관코드). 한 번에 지우면 부모가 먼저
    # 지워지는 행에서 외래키가 걸리므로, 먼저 연결을 끊고 지운다.
    db.execute(update(Organization).values(parent_id=None))
    for model in DELETE_ORDER:
        db.execute(delete(model))
    db.commit()


def text_element(text: str, *, size: int, y: int, color: str = "#ffffff", **options) -> dict:
    return {
        "id": f"el-text-{y}",
        "type": "text",
        "widget_key": None,
        "rect": {"x": 120, "y": y, "w": 1680, "h": 240, "z": 2, "rotation": 0},
        "opacity": 1,
        "options": {"text": text, "fontSize": size, "color": color, "align": "center", **options},
        "src": None,
    }


def widget_element(key: str, *, x: int, y: int, w: int, h: int, z: int = 1) -> dict:
    return {
        "id": f"el-{key}",
        "type": "widget",
        "widget_key": key,
        "rect": {"x": x, "y": y, "w": w, "h": h, "z": z, "rotation": 0},
        "opacity": 1,
        "options": {},
        "src": None,
    }


def document(elements: list[dict], *, width: int = 1920, height: int = 1080) -> dict:
    return {
        "version": 1,
        "layout": {"width": width, "height": height, "background": "#0f172a"},
        "elements": elements,
    }


def seed(db) -> dict:  # noqa: ANN001, C901 - 시드는 원래 길다
    now = datetime.now(UTC)

    # ------------------------------------------------------------ 기관
    root = Organization(name="최상위 기관", org_type=OrgType.ORG)
    db.add(root)
    db.flush()

    office = Organization(
        name="인천광역시교육청",
        org_type=OrgType.ORG,
        parent_id=root.id,
        address="인천광역시 남동구 정각로 9",
        edu_office_code="E10",
    )
    db.add(office)
    db.flush()

    schools = []
    for name, level, code in [
        ("가온초등학교", SchoolLevel.ELEMENTARY, "7010001"),
        ("나래중학교", SchoolLevel.MIDDLE, "7010002"),
        ("다솜고등학교", SchoolLevel.HIGH, "7010003"),
    ]:
        school = Organization(
            name=name,
            org_type=OrgType.SCHOOL,
            school_level=level,
            parent_id=office.id,
            address=f"인천광역시 연수구 {name}로 1",
            edu_office_code="E10",
            school_code=code,
            latitude=37.45,
            longitude=126.70,
        )
        db.add(school)
        schools.append(school)
    db.flush()

    gaon, narae, dasom = schools

    # ------------------------------------------------------------ 사용자
    def make_user(user_id, name, org, roles, *, status=UserStatus.APPROVED, phone=None):  # noqa: ANN001
        user = User(
            user_id=user_id,
            password_hash=hash_password(ADMIN_PASSWORD if user_id == "admin" else PASSWORD),
            org_id=org.id,
            name=name,
            phone=phone,
            email=f"{user_id}@example.ac.kr",
            status=status,
        )
        # MEMBER 는 모두가 가진다(요구사항). 중복은 unique 제약에 걸린다.
        for role in sorted({str(Role.MEMBER)} | {str(r) for r in roles}):
            user.roles.append(UserRole(role=role))
        db.add(user)
        return user

    accounts = [
        make_user("admin", "시스템 관리자", root, [Role.SUPER_ADMIN], phone="032-000-0000"),
        make_user("office", "교육청 담당자", office, [Role.ORG_ADMIN], phone="032-111-1111"),
        make_user("gaon", "가온초 관리자", gaon, [Role.ORG_ADMIN], phone="032-222-2222"),
        make_user("device", "장치 담당 주무관", gaon, [Role.DEVICE_MANAGER], phone="032-333-3333"),
        make_user("teacher", "3학년 2반 담임", gaon, [Role.HOMEROOM_TEACHER], phone="032-444-4444"),
        make_user("member", "일반 교직원", narae, [], phone="032-555-5555"),
        make_user("pending", "승인 대기 교사", dasom, [], status=UserStatus.PENDING),
    ]
    db.flush()
    by_id = {u.user_id: u for u in accounts}

    # ------------------------------------------------------------ 재생목록
    lobby = Playlist(
        name="현관 순환",
        description="등교 시간에 현관에서 도는 화면",
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        version=3,
    )
    lobby.items = [
        PlaylistItem(
            sort_order=0, widget_key="notice", duration_sec=15,
            options={"count": 5}, transition="fade", transition_ms=600,
        ),
        PlaylistItem(
            sort_order=1, widget_key="meal", duration_sec=10,
            options={}, transition="slide-left", transition_ms=900,
        ),
        PlaylistItem(
            sort_order=2, widget_key="timetable", duration_sec=10,
            options={}, transition="dissolve", transition_ms=1200,
        ),
    ]

    classroom = Playlist(
        name="교실 알림",
        description="교실 전자칠판에서 도는 화면",
        org_id=gaon.id,
        created_by=by_id["teacher"].id,
    )
    classroom.items = [
        PlaylistItem(sort_order=0, widget_key="clock", duration_sec=8, options={}, transition="none"),
        PlaylistItem(
            sort_order=1, widget_key="dday", duration_sec=7,
            options={}, transition="zoom", transition_ms=500,
        ),
    ]
    db.add_all([lobby, classroom])
    db.flush()

    # ------------------------------------------------------------ 콘텐츠
    welcome = Content(
        name="등교 환영",
        description="아침 인사 화면",
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        width=1920,
        height=1080,
        document=document(
            [
                text_element("좋은 아침입니다", size=140, y=340, bold=True, shadow=True),
                text_element("오늘도 안전하게!", size=72, y=620, color="#93c5fd"),
            ]
        ),
    )

    meal_board = Content(
        name="급식 안내",
        description="점심시간 게시",
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        document=document([widget_element("meal", x=0, y=0, w=1920, h=1080)]),
    )

    lobby_loop = Content(
        name="현관 순환",
        description="재생목록 하나로 채운 화면",
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        document=document(
            [
                {
                    "id": "el-playlist-lobby",
                    "type": "playlist",
                    "widget_key": None,
                    "rect": {"x": 0, "y": 0, "w": 1920, "h": 1080, "z": 1, "rotation": 0},
                    "opacity": 1,
                    "options": {"playlist_id": lobby.id, "playlist_name": lobby.name},
                    "src": None,
                    "region": 0,
                }
            ]
        ),
    )

    portrait = Content(
        name="복도 세로 안내",
        description="세로형 장치용",
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        width=1080,
        height=1920,
        document=document(
            [
                widget_element("notice", x=0, y=0, w=1080, h=1200),
                widget_element("clock", x=0, y=1240, w=1080, h=680, z=2),
            ],
            width=1080,
            height=1920,
        ),
    )

    exam = Content(
        name="중간고사 안내",
        org_id=narae.id,
        created_by=by_id["office"].id,
        document=document(
            [
                text_element("중간고사 안내", size=120, y=300, bold=True),
                text_element("10월 22일(수) ~ 24일(금)", size=80, y=600, color="#fbbf24"),
            ]
        ),
    )
    db.add_all([welcome, meal_board, lobby_loop, portrait, exam])
    db.flush()

    # 재생목록을 쓰는 콘텐츠 색인. 없으면 재생목록을 고쳐도 장치가 모른다.
    db.add(ContentPlaylist(content_id=lobby_loop.id, playlist_id=lobby.id))

    # ------------------------------------------------------------ 스케줄
    weekday = Schedule(
        name="평일 기본",
        kind=ScheduleKind.TIME_BASED,
        orientation=PanelType.LANDSCAPE,
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        version=4,
    )
    for day in range(5):
        weekday.items.extend(
            [
                ScheduleItem(
                    day_of_week=day, start_time=time(8, 0), end_time=time(9, 0),
                    duration_sec=30, content_id=welcome.id, content={},
                ),
                ScheduleItem(
                    day_of_week=day, start_time=time(11, 30), end_time=time(13, 0),
                    duration_sec=30, content_id=meal_board.id, content={},
                ),
                ScheduleItem(
                    day_of_week=day, start_time=time(13, 0), end_time=time(16, 0),
                    duration_sec=30, content_id=lobby_loop.id, content={},
                ),
            ]
        )

    loop = Schedule(
        name="현관 순환(목록반복)",
        kind=ScheduleKind.LIST_LOOP,
        orientation=PanelType.LANDSCAPE,
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
    )
    loop.items = [
        ScheduleItem(day_of_week=-1, sort_order=0, duration_sec=20, content_id=welcome.id, content={}),
        ScheduleItem(day_of_week=-1, sort_order=1, duration_sec=15, content_id=lobby_loop.id, content={}),
    ]

    event = Schedule(
        name="가을 운동회 안내",
        kind=ScheduleKind.TIME_BASED,
        orientation=PanelType.LANDSCAPE,
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        # 사용 기간이 있는 스케줄. 기간 밖이면 걸려 있어도 표출되지 않는다.
        start_at=now + timedelta(days=7),
        end_at=now + timedelta(days=14),
    )
    event.items = [
        ScheduleItem(
            day_of_week=5, start_time=time(9, 0), end_time=time(12, 0),
            duration_sec=20, content_id=welcome.id, content={},
        )
    ]

    expired = Schedule(
        name="지난 행사(기간 지남)",
        kind=ScheduleKind.TIME_BASED,
        orientation=PanelType.LANDSCAPE,
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
        start_at=now - timedelta(days=30),
        end_at=now - timedelta(days=15),
    )

    portrait_schedule = Schedule(
        name="복도 세로형",
        kind=ScheduleKind.TIME_BASED,
        orientation=PanelType.PORTRAIT,
        org_id=gaon.id,
        created_by=by_id["gaon"].id,
    )
    portrait_schedule.items = [
        ScheduleItem(
            day_of_week=day, start_time=time(8, 0), end_time=time(17, 0),
            duration_sec=30, content_id=portrait.id, content={},
        )
        for day in range(5)
    ]

    narae_schedule = Schedule(
        name="나래중 안내",
        kind=ScheduleKind.TIME_BASED,
        orientation=PanelType.LANDSCAPE,
        org_id=narae.id,
        created_by=by_id["office"].id,
    )
    narae_schedule.items = [
        ScheduleItem(
            day_of_week=day, start_time=time(9, 0), end_time=time(15, 0),
            duration_sec=30, content_id=exam.id, content={},
        )
        for day in range(5)
    ]

    schedules = [weekday, loop, event, expired, portrait_schedule, narae_schedule]
    db.add_all(schedules)
    db.flush()

    # ------------------------------------------------------------ 장치
    def make_device(  # noqa: ANN001, PLR0913
        org, code, name, *, os=DeviceOS.WINDOWS, form=FormFactor.DID,
        panel=PanelType.LANDSCAPE, place=None, kind=DeviceKind.NORMAL,
        master=False, online=None, storage=None, grade=None, class_no=None,
    ):
        width, height = (1920, 1080) if panel == PanelType.LANDSCAPE else (1080, 1920)
        total, free = storage or (256 * 1024**3, 96 * 1024**3)
        device = Device(
            org_id=org.id,
            device_code=code,
            name=name,
            os=os,
            form_factor=form,
            panel_type=panel,
            width=width,
            height=height,
            place_name=place,
            place_kind=PlaceKind.CLASSROOM if grade else PlaceKind.ETC,
            device_kind=kind,
            grade=grade,
            class_no=class_no,
            class_name=f"{grade}학년 {class_no}반" if grade else None,
            is_master=master,
            cpu="Intel N100",
            memory="8GB",
            storage="256GB SSD",
            storage_total_bytes=total,
            storage_free_bytes=free,
            storage_reported_at=now,
            app_version="1.2.0",
            last_seen_at=now - timedelta(seconds=online) if online is not None else None,
            version=1,
        )
        db.add(device)
        return device

    devices = [
        make_device(gaon, "GAON-001-001", "가온초 현관", place="본관 현관", master=True, online=10),
        make_device(gaon, "GAON-001-002", "가온초 급식실", place="급식실", online=25),
        make_device(
            gaon, "GAON-002-001", "가온초 복도(세로)", panel=PanelType.PORTRAIT,
            place="2층 복도", online=40,
        ),
        make_device(
            gaon, "GAON-003-001", "3학년 2반 전자칠판", kind=DeviceKind.EBOARD,
            form=FormFactor.KIOSK, place="3학년 2반", grade=3, class_no=2, online=15,
        ),
        # 저장공간 경보(80% 이상)를 보여 주는 장치.
        make_device(
            gaon, "GAON-004-001", "가온초 도서관", place="도서관", online=60,
            storage=(128 * 1024**3, 12 * 1024**3),
        ),
        # 오프라인 + 스케줄 미배정 → 데모 화면을 표출한다.
        make_device(narae, "NARA-001-001", "나래중 현관", place="현관"),
        make_device(narae, "NARA-002-001", "나래중 교무실", place="교무실", online=120),
        make_device(dasom, "DASM-001-001", "다솜고 현관", place="현관", online=90),
    ]
    db.flush()

    # 배정: 한 장치에 여러 스케줄, 순서가 곧 우선순위다.
    links = [
        (devices[0], [weekday, event]),
        (devices[1], [weekday]),
        (devices[2], [portrait_schedule]),
        (devices[3], [loop]),
        (devices[4], [weekday]),
        (devices[6], [narae_schedule]),
    ]
    for device, assigned in links:
        for order, schedule in enumerate(assigned):
            db.add(
                DeviceScheduleLink(device_id=device.id, schedule_id=schedule.id, sort_order=order)
            )

    # 장치 관리 위임(N:M). 한 장치를 여러 사람에게 맡길 수 있다.
    db.add_all(
        [
            DeviceManager(device_id=devices[0].id, user_id=by_id["device"].id),
            DeviceManager(device_id=devices[1].id, user_id=by_id["device"].id),
            DeviceManager(device_id=devices[3].id, user_id=by_id["teacher"].id),
        ]
    )

    # 장치그룹은 만든 사람에게만 보인다.
    group = DeviceGroup(name="본관 1층", user_id=by_id["gaon"].id)
    db.add(group)
    db.flush()
    db.add_all(
        [
            DeviceGroupMember(group_id=group.id, device_id=devices[0].id),
            DeviceGroupMember(group_id=group.id, device_id=devices[1].id),
        ]
    )

    # ------------------------------------------------------------ 커뮤니티
    # 커뮤니티는 상위기관(교육청)에만 있다. 2026-10 개편: 모든 승인 사용자가
    # 쓰는 공간이고, 게시물은 제목·공지대상(기관구분)·공지희망기간·연락처·
    # 메모를 메타데이터로 갖는다. '게시' + 대상·기간이 맞으면 로그인 팝업이 뜬다.
    db.add(
        CommunityPlaylist(
            org_id=office.id,
            author_id=by_id["member"].id,
            title="주말 가족 독서 모임 안내",
            memo="이번 주 토요일 오전 10시, 교육청 1층 열린도서실에서 만나요.",
            target_org_types=["학교"],
            notice_start=date.today().isoformat(),
            notice_end=(date.today() + timedelta(days=14)).isoformat(),
            contact="032-123-4567",
            publish_status="게시",
            items=[],
        )
    )
    db.flush()

    # ------------------------------------------------------------ 기관 게시판
    board = OrgBoard(
        org_id=gaon.id,
        kind=BoardKind.BOARD,
        url="https://gaon.sen.es.kr/notice",
        scrape_method="html:table",
        scrape_result=ScrapeResult.SUCCESS,
        scrape_count=4,
        last_scraped_at=now - timedelta(hours=3),
    )
    db.add(board)
    db.flush()

    today = date.today()
    for offset, title in enumerate(
        [
            "2학기 학부모 상담 주간 안내",
            "가을 운동회 개최 안내",
            "독서 골든벨 참가 신청",
            "교통안전 교육 실시 안내",
        ]
    ):
        posted = today - timedelta(days=offset * 3)
        db.add(
            BoardPost(
                board_id=board.id,
                title=title,
                author="교무부",
                posted_on=posted,
                year=posted.year,
                month=posted.month,
                day=posted.day,
                term=2,
                content=f"{title} 상세 내용입니다.",
            )
        )

    db.commit()

    # 세션이 닫힌 뒤에는 관계를 더 읽을 수 없다. 보고에 쓸 값만 지금 꺼내 둔다.
    return {
        "organizations": [o.name for o in db.execute(select(Organization)).scalars().all()],
        "users": [
            {
                "user_id": u.user_id,
                "name": u.name,
                "status": str(u.status),
                "org": db.get(Organization, u.org_id).name,
                "roles": sorted(r.role for r in u.roles),
                "password": ADMIN_PASSWORD if u.user_id == "admin" else PASSWORD,
            }
            for u in accounts
        ],
        "devices": [(d.name, d.device_code) for d in devices],
        "schedules": [s.name for s in schedules],
    }


def main() -> int:
    if "--yes" not in sys.argv:
        answer = input("DB 의 모든 자료를 지우고 시연 데이터로 다시 채웁니다. 계속할까요? [y/N] ")
        if answer.strip().lower() not in {"y", "yes"}:
            print("취소했습니다.")
            return 1

    with SessionLocal() as db:
        wipe(db)
        result = seed(db)

    print("=" * 78)
    print(
        f"기관 {len(result['organizations'])}개 · "
        f"사용자 {len(result['users'])}명 · "
        f"장치 {len(result['devices'])}대 · "
        f"스케줄 {len(result['schedules'])}개"
    )
    print("=" * 78)
    print(f"  {'아이디':<10} {'비밀번호':<10} {'이름':<16} {'소속':<14} {'상태':<6} 역할")
    for user in result["users"]:
        roles = ", ".join(r for r in user["roles"] if r != "MEMBER") or "-"
        print(
            f"  {user['user_id']:<10} {user['password']:<10} {user['name']:<16} "
            f"{user['org']:<14} {user['status']:<6} {roles}"
        )
    print("=" * 78)
    print("  모든 계정은 MEMBER 를 기본으로 가집니다(요구사항).")
    for name, code in result["devices"]:
        print(f"  장치 {code}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
