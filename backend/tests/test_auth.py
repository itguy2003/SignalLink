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
