"""사용자 승인/역할 규칙 검증."""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.enums import Role, UserStatus
from app.models.user import User, UserRole


@pytest.fixture
def orgs(client, super_headers, root_org_id) -> dict:
    def _create(name: str, parent_id: int) -> int:
        return client.post(
            "/api/v1/organizations",
            headers=super_headers,
            json={"name": name, "parent_id": parent_id},
        ).json()["id"]

    office = _create("서울시교육청", root_org_id)
    return {
        "root": root_org_id,
        "office": office,
        "school": _create("가나초등학교", office),
        "other": _create("부산시교육청", root_org_id),
    }


def test_duplicate_role_is_rejected_at_db_level(db, root_org_id):
    """한 사용자에게 동일한 역할이 중복되지 않는다."""
    from app.core.security import hash_password

    user = User(
        user_id="dupe",
        password_hash=hash_password("test1234"),
        org_id=root_org_id,
        name="중복",
        status=UserStatus.APPROVED,
    )
    user.roles.append(UserRole(role=str(Role.ORG_ADMIN)))
    user.roles.append(UserRole(role=str(Role.ORG_ADMIN)))
    db.add(user)
    with pytest.raises(IntegrityError):
        db.commit()


def _create(client, headers, org_id: int, user_id: str, **extra):
    return client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "org_id": org_id,
            "user_id": user_id,
            "password": "test1234",
            "name": "새사용자",
            **extra,
        },
    )


def test_new_user_starts_as_member_only(client, super_headers, orgs):
    body = _create(client, super_headers, orgs["school"], "newbie").json()
    assert body["roles"] == ["MEMBER"]


def test_roles_cannot_be_set_at_creation(client, super_headers, orgs):
    """등록 요청에 역할을 실어 보내도 무시한다.

    등록과 권한 부여를 한 번에 처리하면 계정을 만드는 김에 권한까지 딸려
    나가기 쉽다. 권한은 등록한 뒤 수정에서 따로 준다.
    """
    body = _create(client, super_headers, orgs["school"], "newadmin", roles=["ORG_ADMIN"]).json()
    assert body["roles"] == ["MEMBER"]


def test_roles_are_granted_by_update(client, super_headers, orgs):
    created = _create(client, super_headers, orgs["school"], "promoted").json()

    updated = client.put(
        f"/api/v1/users/{created['id']}",
        headers=super_headers,
        json={"roles": ["ORG_ADMIN"]},
    ).json()
    assert set(updated["roles"]) == {"ORG_ADMIN", "MEMBER"}


def test_role_grant_permission_still_applies_on_update(client, orgs, make_user, login):
    """수정 경로의 권한 검사는 그대로다. 등록에서 막혔다고 느슨해지면 안 된다."""
    make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    headers = login("office_admin")
    created = _create(client, headers, orgs["school"], "target").json()

    denied = client.put(
        f"/api/v1/users/{created['id']}", headers=headers, json={"roles": ["SUPER_ADMIN"]}
    )
    assert denied.status_code == 403


def test_org_admin_approves_users_in_own_subtree(client, orgs, make_user, login):
    make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    mine = make_user("in_school", orgs["school"], [])
    theirs = make_user("in_other", orgs["other"], [])
    headers = login("office_admin")

    # 하위 기관(학교) 사용자는 승인할 수 있다.
    assert client.post(f"/api/v1/users/{mine}/approve", headers=headers).status_code == 200
    # 다른 교육청 사용자는 승인할 수 없다.
    assert client.post(f"/api/v1/users/{theirs}/approve", headers=headers).status_code == 403


def test_super_admin_approves_anyone(client, super_headers, orgs, make_user):
    target = make_user("anyone", orgs["other"], [])
    assert (
        client.post(f"/api/v1/users/{target}/approve", headers=super_headers).status_code == 200
    )


def test_member_cannot_approve(client, orgs, make_user, login):
    make_user("plain", orgs["school"], [])
    target = make_user("target", orgs["school"], [])
    response = client.post(f"/api/v1/users/{target}/approve", headers=login("plain"))
    assert response.status_code == 403


def test_org_admin_cannot_grant_super_admin(client, orgs, make_user, login):
    make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    target = make_user("victim", orgs["school"], [])
    response = client.put(
        f"/api/v1/users/{target}",
        headers=login("office_admin"),
        json={"roles": ["SUPER_ADMIN"]},
    )
    assert response.status_code == 403


def test_user_cannot_change_own_roles(client, orgs, make_user, login):
    user_id = make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    response = client.put(
        f"/api/v1/users/{user_id}",
        headers=login("office_admin"),
        json={"roles": ["ORG_ADMIN", "DEVICE_MANAGER"]},
    )
    assert response.status_code == 403


def test_role_replacement_keeps_uniqueness(client, super_headers, orgs, make_user):
    user_id = make_user("changer", orgs["school"], [Role.DEVICE_MANAGER])
    body = client.put(
        f"/api/v1/users/{user_id}",
        headers=super_headers,
        json={"roles": ["ORG_ADMIN", "ORG_ADMIN", "MEMBER"]},
    ).json()
    assert sorted(body["roles"]) == ["MEMBER", "ORG_ADMIN"]


def test_user_list_is_scoped_to_managed_orgs(client, orgs, make_user, login):
    make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    make_user("in_school", orgs["school"], [])
    make_user("in_other", orgs["other"], [])

    items = client.get("/api/v1/users", headers=login("office_admin")).json()["items"]
    user_ids = {u["user_id"] for u in items}
    assert "in_school" in user_ids
    assert "in_other" not in user_ids
    assert "admin" not in user_ids  # 최상위 기관 소속


def test_pending_count_is_scoped(client, orgs, make_user, login):
    make_user("office_admin", orgs["office"], [Role.ORG_ADMIN])
    client.post(
        "/api/v1/auth/register",
        json={
            "org_id": orgs["school"],
            "user_id": "waiting1",
            "password": "pass1234",
            "password_confirm": "pass1234",
            "name": "대기1",
        },
    )
    client.post(
        "/api/v1/auth/register",
        json={
            "org_id": orgs["other"],
            "user_id": "waiting2",
            "password": "pass1234",
            "password_confirm": "pass1234",
            "name": "대기2",
        },
    )
    count = client.get("/api/v1/users/pending-count", headers=login("office_admin")).json()
    assert count["count"] == 1


def test_cannot_delete_self(client, super_headers):
    me = client.get("/api/v1/auth/me", headers=super_headers).json()
    response = client.delete(f"/api/v1/users/{me['id']}", headers=super_headers)
    assert response.status_code == 400
