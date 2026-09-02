"""기관 트리와 기관 권한 검증."""

from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from app.models.enums import Role


@pytest.fixture
def org_tree_ids(client, super_headers, root_org_id):
    """최상위 - 시도교육청 - 학교 3단계 트리를 만든다."""

    def _create(name: str, parent_id: int, **extra) -> int:
        response = client.post(
            "/api/v1/organizations",
            headers=super_headers,
            json={"name": name, "parent_id": parent_id, **extra},
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    office = _create("서울시교육청", root_org_id)
    school_a = _create("가나초등학교", office, org_type="학교", school_level="초")
    school_b = _create("다라중학교", office, org_type="학교", school_level="중")
    other_office = _create("부산시교육청", root_org_id)
    return {
        "root": root_org_id,
        "office": office,
        "school_a": school_a,
        "school_b": school_b,
        "other_office": other_office,
    }


def test_only_one_root_organization(client, super_headers):
    """최상위 기관은 이미 존재하므로 또 만들 수 없다."""
    response = client.post(
        "/api/v1/organizations", headers=super_headers, json={"name": "또다른 최상위"}
    )
    assert response.status_code == 400


def test_org_admin_can_create_child_org(client, org_tree_ids, make_user, login):
    make_user("office_admin", org_tree_ids["office"], [Role.ORG_ADMIN])
    headers = login("office_admin")

    ok = client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": "마바고등학교", "parent_id": org_tree_ids["office"]},
    )
    assert ok.status_code == 201

    # 관리 범위 밖(다른 교육청) 아래에는 만들 수 없다.
    denied = client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": "침입기관", "parent_id": org_tree_ids["other_office"]},
    )
    assert denied.status_code == 403


def test_org_admin_scope_is_own_subtree(client, org_tree_ids, make_user, login):
    make_user("office_admin", org_tree_ids["office"], [Role.ORG_ADMIN])
    headers = login("office_admin")

    visible = {o["id"] for o in client.get("/api/v1/organizations", headers=headers).json()}
    assert visible == {org_tree_ids["office"], org_tree_ids["school_a"], org_tree_ids["school_b"]}
    assert org_tree_ids["other_office"] not in visible
    assert org_tree_ids["root"] not in visible


def test_member_sees_only_own_org(client, org_tree_ids, make_user, login):
    make_user("plain", org_tree_ids["school_a"], [])
    headers = login("plain")
    visible = {o["id"] for o in client.get("/api/v1/organizations", headers=headers).json()}
    assert visible == {org_tree_ids["school_a"]}


def test_tree_endpoint_nests_children(client, super_headers, org_tree_ids):
    tree = client.get("/api/v1/organizations/tree", headers=super_headers).json()
    assert len(tree) == 1  # 최상위 기관 하나

    root = tree[0]
    offices = {child["name"]: child for child in root["children"]}
    assert set(offices) == {"서울시교육청", "부산시교육청"}
    assert {c["name"] for c in offices["서울시교육청"]["children"]} == {
        "가나초등학교",
        "다라중학교",
    }


def test_cannot_move_org_under_its_own_descendant(client, super_headers, org_tree_ids):
    """순환 구조를 만드는 상위 기관 변경은 거부된다."""
    response = client.put(
        f"/api/v1/organizations/{org_tree_ids['office']}",
        headers=super_headers,
        json={"parent_id": org_tree_ids["school_a"]},
    )
    assert response.status_code == 400
    assert "순환" in response.json()["detail"]


def test_cannot_delete_org_with_children(client, super_headers, org_tree_ids):
    response = client.delete(
        f"/api/v1/organizations/{org_tree_ids['office']}", headers=super_headers
    )
    assert response.status_code == 400
    assert "하위 기관" in response.json()["detail"]


def test_cannot_delete_root_org(client, super_headers, root_org_id):
    response = client.delete(f"/api/v1/organizations/{root_org_id}", headers=super_headers)
    assert response.status_code == 400


def _workbook_bytes(rows: list[list]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["기관명", "주소", "기관타입", "학교단위", "위도", "경도", "시도교육청코드", "학교코드"])
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_bulk_upload_creates_orgs_and_reports_errors(client, super_headers, org_tree_ids):
    content = _workbook_bytes(
        [
            ["사서초등학교", "서울시 종로구", "학교", "초", 37.5, 127.0, "B10", "7010001"],
            ["아자중학교", "서울시 중구", "학교", "중", None, None, "B10", "7010002"],
            ["", "이름 없음", "기관", None, None, None, None, None],
            ["타입오류학교", None, "없는타입", None, None, None, None, None],
        ]
    )
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"]},
        files={
            "file": (
                "orgs.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 2
    assert len(body["errors"]) == 2
    assert any("기관명" in e for e in body["errors"])
    assert any("기관타입" in e for e in body["errors"])


def test_bulk_upload_skips_duplicate_school_code(client, super_headers, org_tree_ids):
    content = _workbook_bytes(
        [["사서초등학교", None, "학교", "초", None, None, "B10", "7010001"]]
    )
    files = {
        "file": (
            "orgs.xlsx",
            content,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    params = {"parent_id": org_tree_ids["office"]}

    first = client.post(
        "/api/v1/organizations/bulk-upload", headers=super_headers, params=params, files=files
    ).json()
    assert first["created"] == 1

    second = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params=params,
        files={
            "file": (
                "orgs.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    ).json()
    # 같은 (시도교육청코드, 학교코드) 는 다시 만들지 않는다.
    assert second["created"] == 0
    assert second["skipped"] == 1


def _walk(nodes):
    """트리를 훑어 (id, 부모경로) 목록을 만든다."""
    seen = []

    def visit(items, path):
        for node in items:
            seen.append((node["id"], path))
            visit(node["children"], (*path, node["id"]))

    visit(nodes, ())
    return seen


def test_tree_has_no_duplicate_nodes(client, super_headers, org_tree_ids):
    """트리에 같은 기관이 두 번 나오면 안 된다.

    Pydantic 이 ORM 의 children 관계를 재귀로 읽어 하위 트리를 한 번 채운 뒤
    트리 조립 코드가 같은 자식을 또 붙이면 노드가 중복된다. 화면에서는 같은
    기관이 여러 줄로 보이고, key 가 겹쳐 한 곳을 고치면 다른 줄까지 함께
    바뀐 것처럼 보인다.
    """
    tree = client.get("/api/v1/organizations/tree", headers=super_headers).json()
    ids = [node_id for node_id, _ in _walk(tree)]
    assert len(ids) == len(set(ids)), f"중복된 노드: {sorted(ids)}"


def test_tree_node_count_matches_org_count(client, super_headers, org_tree_ids):
    tree = client.get("/api/v1/organizations/tree", headers=super_headers).json()
    orgs = client.get("/api/v1/organizations", headers=super_headers).json()
    assert len(_walk(tree)) == len(orgs)


def test_tree_children_are_direct_children_only(client, super_headers, org_tree_ids):
    """손자가 자식 자리에 섞여 들어오면 안 된다."""
    tree = client.get("/api/v1/organizations/tree", headers=super_headers).json()
    root = tree[0]
    assert {c["id"] for c in root["children"]} == {
        org_tree_ids["office"],
        org_tree_ids["other_office"],
    }

    office = next(c for c in root["children"] if c["id"] == org_tree_ids["office"])
    assert {c["id"] for c in office["children"]} == {
        org_tree_ids["school_a"],
        org_tree_ids["school_b"],
    }


def test_deep_tree_stays_flat_per_level(client, super_headers, org_tree_ids):
    """3단계보다 깊어져도 중복이 생기지 않는다(깊을수록 배로 늘던 문제)."""
    grand = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "부설유치원", "parent_id": org_tree_ids["school_a"]},
    ).json()["id"]

    tree = client.get("/api/v1/organizations/tree", headers=super_headers).json()
    ids = [node_id for node_id, _ in _walk(tree)]
    assert len(ids) == len(set(ids))
    assert grand in ids


def test_editing_one_org_does_not_change_siblings(client, super_headers, org_tree_ids):
    """한 하위 기관을 고쳐도 형제 기관은 그대로다."""
    before = {
        o["id"]: o
        for o in client.get("/api/v1/organizations", headers=super_headers).json()
    }

    client.put(
        f"/api/v1/organizations/{org_tree_ids['school_a']}",
        headers=super_headers,
        json={"name": "이름변경", "school_level": "중", "address": "새 주소"},
    )

    after = {
        o["id"]: o
        for o in client.get("/api/v1/organizations", headers=super_headers).json()
    }
    for org_id, org in before.items():
        if org_id == org_tree_ids["school_a"]:
            continue
        assert after[org_id] == org, f"기관 {org_id} 가 함께 바뀌었다"
