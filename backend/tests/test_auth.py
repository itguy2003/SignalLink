"""인증/회원가입 요구사항 검증."""

from __future__ import annotations

from sqlalchemy import select

from app.models.enums import Role, UserStatus
from app.models.user import LoginLog, User


def test_bootstrap_creates_root_org_and_super_admin(client, db):
    """시스템은 기본적으로 최상위 기관과 슈퍼관리자를 갖는다."""
    orgs = client.get("/api/v1/organizations/public").json()
    assert len(orgs) == 1
    assert orgs[0]["parent_id"] is None

    admin = db.execute(select(User).where(User.user_id == "admin")).scalar_one()
    assert admin.has_role(Role.SUPER_ADMIN)
    assert admin.status == UserStatus.APPROVED


def test_register_starts_pending_with_member_role(client, db, root_org_id):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "org_id": root_org_id,
            "user_id": "teacher1",
            "password": "pass1234",
            "password_confirm": "pass1234",
            "name": "김선생",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    # 신규 가입자는 미승인 상태이고 기본 역할 MEMBER 를 갖는다.
    assert body["status"] == UserStatus.PENDING
    assert body["roles"] == [str(Role.MEMBER)]


def test_register_rejects_mismatched_password_confirm(client, root_org_id):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "org_id": root_org_id,
            "user_id": "teacher2",
            "password": "pass1234",
            "password_confirm": "different",
            "name": "이선생",
        },
    )
    assert response.status_code == 422


def test_user_id_duplicate_check(client, root_org_id):
    assert client.get("/api/v1/auth/check-user-id", params={"user_id": "newbie"}).json()[
        "available"
    ]
    assert not client.get("/api/v1/auth/check-user-id", params={"user_id": "admin"}).json()[
        "available"
    ]


def test_register_rejects_duplicate_user_id(client, root_org_id):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "org_id": root_org_id,
            "user_id": "admin",
            "password": "pass1234",
            "password_confirm": "pass1234",
            "name": "중복",
        },
    )
    assert response.status_code == 400


def test_pending_user_cannot_login(client, root_org_id):
    client.post(
        "/api/v1/auth/register",
        json={
            "org_id": root_org_id,
            "user_id": "pending1",
            "password": "pass1234",
            "password_confirm": "pass1234",
            "name": "대기자",
        },
    )
    response = client.post(
        "/api/v1/auth/login", json={"user_id": "pending1", "password": "pass1234"}
    )
    assert response.status_code == 403


def test_login_attempts_are_logged(client, db):
    client.post("/api/v1/auth/login", json={"user_id": "admin", "password": "admin1234"})
    client.post("/api/v1/auth/login", json={"user_id": "admin", "password": "wrong"})
    client.post("/api/v1/auth/login", json={"user_id": "ghost", "password": "x"})

    logs = db.execute(select(LoginLog).order_by(LoginLog.id)).scalars().all()
    assert [log.success for log in logs] == [True, False, False]
    # 존재하지 않는 계정 시도도 남는다.
    assert logs[-1].attempted_user_id == "ghost"
    assert logs[-1].user_id is None


def test_me_requires_token(client, super_headers):
    assert client.get("/api/v1/auth/me").status_code == 401
    body = client.get("/api/v1/auth/me", headers=super_headers).json()
    assert body["user_id"] == "admin"
    assert str(Role.SUPER_ADMIN) in body["roles"]


def test_change_password(client, super_headers):
    response = client.post(
        "/api/v1/auth/change-password",
        headers=super_headers,
        json={
            "current_password": "admin1234",
            "new_password": "newpass99",
            "new_password_confirm": "newpass99",
        },
    )
    assert response.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login", json={"user_id": "admin", "password": "newpass99"}
        ).status_code
        == 200
    )


# ------------------------------------------------------------------ 내 정보 변경

# 이름·연락처·이메일은 본인이 고친다. /users/{id} 가 아니라 /auth/me 인 이유는
# 커뮤니티 유저 때문이다 — 그 경로는 울타리 밖이라 닿지 못하는데, 자기 정보
# 변경은 누구에게나 있어야 한다.


def test_update_my_profile(client, super_headers):  # noqa: ANN001
    body = client.put(
        "/api/v1/auth/me",
        headers=super_headers,
        json={"name": "새 이름", "phone": "010-1234-5678", "email": "new@example.ac.kr"},
    ).json()

    assert body["name"] == "새 이름"
    assert body["phone"] == "010-1234-5678"
    assert body["email"] == "new@example.ac.kr"

    # 다시 읽어도 그대로다.
    me = client.get("/api/v1/auth/me", headers=super_headers).json()
    assert me["name"] == "새 이름"


def test_profile_update_cannot_touch_roles_or_org(client, super_headers, root_org_id):  # noqa: ANN001
    # 소속과 역할은 관리자의 일이다. 보내도 무시된다(스키마에 없다).
    before = client.get("/api/v1/auth/me", headers=super_headers).json()
    body = client.put(
        "/api/v1/auth/me",
        headers=super_headers,
        json={"name": "이름만", "roles": [], "org_id": 999},
    ).json()

    assert body["roles"] == before["roles"]
    assert body["org_id"] == before["org_id"]


def test_member_can_update_their_profile(client, make_user, login, super_headers, root_org_id):  # noqa: ANN001

    office = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]
    make_user("resident9", org_id=office, roles=[])
    headers = login("resident9")

    response = client.put("/api/v1/auth/me", headers=headers, json={"name": "주민 아홉"})
    assert response.status_code == 200
    assert response.json()["name"] == "주민 아홉"


def test_change_password_requires_the_current_one(client, make_user, login, root_org_id):  # noqa: ANN001
    make_user("changer", org_id=root_org_id, roles=[])
    headers = login("changer")

    wrong = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "틀린비밀번호",
            "new_password": "newpass1234",
            "new_password_confirm": "newpass1234",
        },
    )
    assert wrong.status_code == 400

    ok = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "test1234",
            "new_password": "newpass1234",
            "new_password_confirm": "newpass1234",
        },
    )
    assert ok.status_code == 200

    # 새 비밀번호로 실제로 들어와진다.
    relogin = client.post(
        "/api/v1/auth/login", json={"user_id": "changer", "password": "newpass1234"}
    )
    assert relogin.status_code == 200


# ------------------------------------------------------------------ 비밀번호 복잡도

# 배포(운영)에서만 강제한다. 개발 SQLite 기본에서는 꺼져 있어
# 시연 계정(test1234)이 그대로 돈다.


def _register(client, org_id, user_id, password):  # noqa: ANN001
    return client.post(
        '/api/v1/auth/register',
        json={
            'org_id': org_id, 'user_id': user_id, 'password': password,
            'password_confirm': password, 'name': '복잡도 검사',
        },
    )


def test_complexity_off_by_default_in_dev(client, root_org_id):  # noqa: ANN001
    assert _register(client, root_org_id, 'weakpass1', 'aaaaaaaa').status_code == 201


def test_complexity_enforced_when_on(client, root_org_id, monkeypatch):  # noqa: ANN001
    from app.core import passwords
    monkeypatch.setattr(passwords.settings, 'PASSWORD_COMPLEXITY', 'on')

    weak = _register(client, root_org_id, 'weakpass2', 'aaaaaaaa')
    assert weak.status_code == 400
    assert '특수문자' in weak.json()['detail']

    # 영문·숫자·특수문자를 모두 갖추면 통과한다.
    assert _register(client, root_org_id, 'strongpass', 'Abcd123!').status_code == 201


def test_change_password_checks_complexity(client, root_org_id, monkeypatch, make_user, login):  # noqa: ANN001
    from app.core import passwords
    make_user('pwuser', org_id=root_org_id, roles=[])
    headers = login('pwuser')
    monkeypatch.setattr(passwords.settings, 'PASSWORD_COMPLEXITY', 'on')

    weak = client.post(
        '/api/v1/auth/change-password',
        headers=headers,
        # 영문+숫자는 스키마가 이미 요구한다 — 특수문자 누락으로 복잡도에 걸리게 한다.
        json={'current_password': 'test1234', 'new_password': 'abcd1234x', 'new_password_confirm': 'abcd1234x'},
    )
    assert weak.status_code == 400

    ok = client.post(
        '/api/v1/auth/change-password',
        headers=headers,
        json={'current_password': 'test1234', 'new_password': 'Abcd123!', 'new_password_confirm': 'Abcd123!'},
    )
    assert ok.status_code == 200


# ---------------------------------------------------------------- 커뮤니티 가입


def test_public_org_list_filters_by_category(client, super_headers, root_org_id):
    """가입 화면의 기관 목록 — category=기관 이면 학교가 보이지 않는다."""
    office = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "보람교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]
    client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={
            "name": "보람초등학교",
            "parent_id": office,
            "org_type": "학교",
            "school_level": "초",
        },
    )

    names = [
        o["name"]
        for o in client.get(
            "/api/v1/organizations/public", params={"q": "보람", "category": "기관"}
        ).json()
    ]
    assert "보람교육청" in names
    assert "보람초등학교" not in names
