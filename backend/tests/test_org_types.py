"""기관구분 마스터 검증.

기관구분은 고정 3종이 아니라 관리자가 관리한다. 약속:
  - 이름은 바꿀 수 있고, 사용 중인 기관들의 org_type 도 함께 바뀐다
  - 사용 중인 구분은 삭제할 수 없다(수정만 가능)
  - 시스템 동작(커뮤니티 소유, 학교급)은 이름이 아니라 category 를 따른다
"""

from __future__ import annotations

import pytest


@pytest.fixture
def office_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "서울시교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]


def _types(client, headers) -> dict[str, dict]:
    rows = client.get("/api/v1/org-types", headers=headers).json()
    return {row["name"]: row for row in rows}


def test_defaults_are_seeded(client, super_headers):
    types = _types(client, super_headers)
    assert set(types) >= {"기관", "학교", "기타"}
    assert types["학교"]["category"] == "학교"


def test_only_super_admin_manages(client, super_headers, root_org_id, make_user, login):
    make_user("plain", root_org_id, [])
    headers = login("plain")

    # 조회는 된다 — 기관 등록 폼이 선택지로 쓴다.
    assert client.get("/api/v1/org-types", headers=headers).status_code == 200
    response = client.post(
        "/api/v1/org-types", headers=headers, json={"name": "유치원", "category": "학교"}
    )
    assert response.status_code == 403


def test_create_and_use_a_custom_type(client, super_headers, root_org_id):
    created = client.post(
        "/api/v1/org-types", headers=super_headers, json={"name": "평생교육원", "category": "기타"}
    )
    assert created.status_code == 201

    org = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "시민 평생교육원", "parent_id": root_org_id, "org_type": "평생교육원"},
    )
    assert org.status_code == 201
    assert org.json()["org_type"] == "평생교육원"


def test_unknown_type_is_rejected_on_org_create(client, super_headers, root_org_id):
    response = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "어딘가", "parent_id": root_org_id, "org_type": "우주기지"},
    )
    assert response.status_code == 400
    assert "알 수 없는 기관구분" in response.json()["detail"]


def test_duplicate_name_is_rejected(client, super_headers):
    response = client.post(
        "/api/v1/org-types", headers=super_headers, json={"name": "학교", "category": "학교"}
    )
    assert response.status_code == 400


def test_rename_cascades_to_organizations(client, super_headers, office_id):
    # 사용 중이어도 수정은 된다 — 그 구분을 쓰는 기관들이 함께 옮겨 간다.
    type_id = _types(client, super_headers)["기관"]["id"]
    renamed = client.put(
        f"/api/v1/org-types/{type_id}", headers=super_headers, json={"name": "교육기관"}
    )
    assert renamed.status_code == 200

    org = client.get(f"/api/v1/organizations/{office_id}", headers=super_headers).json()
    assert org["org_type"] == "교육기관"


def test_renamed_owner_type_still_hosts_the_community(
    client, super_headers, office_id, make_user, login
):
    # 커뮤니티 소유 판정은 category 를 따른다 — 이름을 바꿔도 커뮤니티는 산다.
    school = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가온초", "parent_id": office_id, "org_type": "학교"},
    ).json()
    type_id = _types(client, super_headers)["기관"]["id"]
    client.put(f"/api/v1/org-types/{type_id}", headers=super_headers, json={"name": "교육기관"})

    make_user("school_admin", school["id"], ["ORG_ADMIN"])
    context = client.get("/api/v1/community/context", headers=login("school_admin"))
    assert context.status_code == 200


def test_type_in_use_cannot_be_deleted(client, super_headers, office_id):
    type_id = _types(client, super_headers)["기관"]["id"]
    response = client.delete(f"/api/v1/org-types/{type_id}", headers=super_headers)

    assert response.status_code == 400
    assert "삭제할 수 없습니다" in response.json()["detail"]
    # 수정은 여전히 된다.
    assert (
        client.put(
            f"/api/v1/org-types/{type_id}", headers=super_headers, json={"name": "상급기관"}
        ).status_code
        == 200
    )


def test_unused_type_can_be_deleted(client, super_headers):
    created = client.post(
        "/api/v1/org-types", headers=super_headers, json={"name": "임시구분", "category": "기타"}
    ).json()
    assert (
        client.delete(f"/api/v1/org-types/{created['id']}", headers=super_headers).status_code
        == 200
    )


def test_usage_count_is_reported(client, super_headers, office_id):
    types = _types(client, super_headers)
    assert types["기관"]["usage_count"] >= 1  # 최상위 기관 + 교육청
    assert types["기타"]["usage_count"] == 0


def test_bulk_upload_accepts_a_custom_default_type(client, super_headers, root_org_id):
    # 일괄 등록의 기본 기관타입도 마스터를 따른다.
    client.post(
        "/api/v1/org-types", headers=super_headers, json={"name": "도서관", "category": "기타"}
    )
    csv = "기관명\n중앙도서관\n".encode()
    response = client.post(
        f"/api/v1/organizations/bulk-upload?parent_id={root_org_id}&default_org_type=도서관",
        headers=super_headers,
        files={"file": ("orgs.csv", csv, "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1


# ------------------------------------------------------------------ 분류(선택지)

# 기관구분마다 고를 수 있는 분류가 다르다. 관리자는 쉼표로 여러 값을 넣고,
# DB 에는 이어 붙여 저장되며, 기관 등록 화면이 쪼개어 드롭다운으로 쓴다.
# 고른 값은 organization.school_level 에 들어간다(학교의 초/중/고를 일반화).


def test_school_type_starts_with_school_levels(client, super_headers):
    assert _types(client, super_headers)["학교"]["classifications"] == "초,중,고"


def test_classifications_are_normalized(client, super_headers):
    # 공백과 중복은 저장 전에 정리한다 — " 초 , 중 ,초 " 를 그대로 두면
    # 화면의 드롭다운에 유령 항목이 생긴다.
    created = client.post(
        "/api/v1/org-types",
        headers=super_headers,
        json={"name": "연수원", "category": "기타", "classifications": " 본원 , 분원 ,본원 "},
    ).json()
    assert created["classifications"] == "본원,분원"


def test_too_long_classification_item_is_rejected(client, super_headers):
    response = client.post(
        "/api/v1/org-types",
        headers=super_headers,
        json={"name": "긴분류", "category": "기타", "classifications": "가나다라마바사아자차카"},
    )
    assert response.status_code == 400
    assert "1~10자" in response.json()["detail"]


def test_org_picks_a_classification_from_its_type(client, super_headers, root_org_id):
    client.post(
        "/api/v1/org-types",
        headers=super_headers,
        json={"name": "지역센터", "category": "기타", "classifications": "본원,분원"},
    )
    org = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={
            "name": "동부센터",
            "parent_id": root_org_id,
            "org_type": "지역센터",
            "school_level": "분원",
        },
    )
    assert org.status_code == 201, org.text
    assert org.json()["school_level"] == "분원"


def test_classification_outside_the_type_is_rejected(client, super_headers, root_org_id):
    response = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={
            "name": "어긋난 분류",
            "parent_id": root_org_id,
            "org_type": "학교",
            "school_level": "대학",
        },
    )
    assert response.status_code == 400
    assert "고를 수 없는 분류" in response.json()["detail"]


def test_type_without_classifications_rejects_any_value(client, super_headers, root_org_id):
    # '기관' 구분은 분류 선택지가 비어 있다 — 아무 값도 못 붙인다.
    response = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={
            "name": "분류 없는 곳",
            "parent_id": root_org_id,
            "org_type": "기관",
            "school_level": "초",
        },
    )
    assert response.status_code == 400


def test_update_validates_against_the_type(client, super_headers, office_id):
    response = client.put(
        f"/api/v1/organizations/{office_id}",
        headers=super_headers,
        json={"school_level": "본원"},
    )
    assert response.status_code == 400

    # 분류 선택지를 넓히면 그 값이 통과한다.
    type_id = _types(client, super_headers)["기관"]["id"]
    client.put(
        f"/api/v1/org-types/{type_id}",
        headers=super_headers,
        json={"classifications": "본원,분원"},
    )
    ok = client.put(
        f"/api/v1/organizations/{office_id}",
        headers=super_headers,
        json={"school_level": "본원"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["school_level"] == "본원"
