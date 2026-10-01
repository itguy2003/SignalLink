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
    assert "소속기관" in response.json()["detail"]


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
    # 같은 (시도교육청코드, 학교코드) 는 다시 만들지 않고 변경한다.
    assert second["created"] == 0
    assert second["updated"] == 1
    listed = client.get("/api/v1/organizations?q=사서초등학교", headers=super_headers).json()
    assert len(listed) == 1


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


# ------------------------------------------------------------------ CSV 일괄 등록

# 관리자 화면의 학교 등록은 CSV 도 받는다 — 나이스 등에서 내려받은 목록이
# 흔히 CSV 라서다. 헤더 규칙은 엑셀과 같아야 한다.


def _csv_bytes(text: str, encoding: str = "utf-8-sig") -> bytes:
    return text.encode(encoding)


def test_bulk_upload_accepts_csv(client, super_headers, org_tree_ids):
    content = _csv_bytes(
        "기관명,주소,학교단위\n씨에스브이초등학교,서울시,초\n씨에스브이중학교,서울시,중\n"
    )
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={"file": ("schools.csv", content, "text/csv")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 2 and body["errors"] == []

    listed = client.get(
        "/api/v1/organizations?q=씨에스브이", headers=super_headers
    ).json()
    # 기관타입 컬럼이 없어도 학교로 들어간다 — 학교 등록 화면의 기본값.
    assert {o["org_type"] for o in listed} == {"학교"}
    assert {o["school_level"] for o in listed} == {"초", "중"}


def test_bulk_upload_reads_cp949_csv(client, super_headers, org_tree_ids):
    # 엑셀이 저장한 CSV 는 cp949 인 경우가 많다.
    content = _csv_bytes("기관명,기관타입" + chr(10) + "씨피구사구학교,학교" + chr(10), encoding="cp949")
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"]},
        files={"file": ("schools.csv", content, "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1


def test_bulk_upload_rejects_bad_default_type(client, super_headers, org_tree_ids):
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "동아리"},
        files={"file": ("schools.csv", _csv_bytes("기관명" + chr(10) + "어딘가" + chr(10)), "text/csv")},
    )
    assert response.status_code == 400


# ------------------------------------------------------------------ 두 파일 병합 등록

# 학교 정보와 위도·경도가 서로 다른 파일로 오는 경우다. 보조 파일을 함께
# 올리면 서버가 (시도교육청코드, 학교코드) 또는 이름으로 짝을 맞춰 합친다.


def test_bulk_upload_merges_coords_file(client, super_headers, org_tree_ids):
    info = _csv_bytes(
        '기관명,학교단위,시도교육청코드,학교코드' + chr(10)
        + '병합초등학교,초,B10,9010001' + chr(10)
        + '병합중학교,중,B10,9010002' + chr(10)
    )
    # 좌표 파일은 다른 출처라 '학교명' 헤더를 쓴다. 하나는 코드로, 하나는 이름으로 짝이 맞는다.
    coords = _csv_bytes(
        '학교명,위도,경도,시도교육청코드,학교코드' + chr(10)
        + '병합초등학교,37.51,126.72,B10,9010001' + chr(10)
        + '병합중학교,37.52,126.73,,' + chr(10)
        + '짝없는학교,37.53,126.74,,' + chr(10)
    )
    response = client.post(
        '/api/v1/organizations/bulk-upload',
        headers=super_headers,
        params={'parent_id': org_tree_ids['office'], 'default_org_type': '학교'},
        files={
            'file': ('info.csv', info, 'text/csv'),
            'coords_file': ('coords.csv', coords, 'text/csv'),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['created'] == 2
    # 짝을 못 찾은 보조 행은 조용히 버리지 않는다.
    assert any('짝' in e and '짝없는학교' in e for e in body['errors'])

    listed = client.get('/api/v1/organizations?q=병합', headers=super_headers).json()
    coords_by_name = {o['name']: (o['latitude'], o['longitude']) for o in listed}
    assert coords_by_name['병합초등학교'] == (37.51, 126.72)
    assert coords_by_name['병합중학교'] == (37.52, 126.73)


def test_bulk_upload_reads_neis_headers(client, super_headers, org_tree_ids):
    """학교 정보 관리의 두 파일 규약.

    첫 파일: 첫 줄이 헤더인 나이스 학교기본정보(시도교육청코드·명, 행정코드,
    학교명, 학교종류명, 시도명, 관할조직명, 도로명주소·상세, 전화번호,
    홈페이지주소). 두 번째 파일: 위도·경도만 가져온다.
    """
    info = _csv_bytes(
        "시도교육청코드,시도교육청명,행정코드,학교명,학교종류명,시도명,관할조직명,"
        "도로명주소,도로명상세주소,전화번호,홈페이지주소" + chr(10)
        + "B10,서울특별시교육청,7025001,나이스초등학교,초등학교,서울특별시,"
        "서울특별시성동광진교육지원청,서울시 광진구 어딘가 1,(중곡동),02-123-4567,"
        "http://school.example.org" + chr(10)
    )
    coords = _csv_bytes("학교명,위도,경도" + chr(10) + "나이스초등학교,37.55,127.08" + chr(10))
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={
            "file": ("info.csv", info, "text/csv"),
            "coords_file": ("coords.csv", coords, "text/csv"),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1 and response.json()["errors"] == []

    school = client.get(
        "/api/v1/organizations?q=나이스초등학교", headers=super_headers
    ).json()[0]
    assert school["edu_office_code"] == "B10"
    assert school["edu_office_name"] == "서울특별시교육청"
    assert school["school_code"] == "7025001"  # 행정코드 → 학교코드
    assert school["school_level"] == "초"  # 학교종류명 → 학교급
    assert school["sido_name"] == "서울특별시"
    assert school["jurisdiction_name"] == "서울특별시성동광진교육지원청"
    assert school["address"] == "서울시 광진구 어딘가 1"
    assert school["address_detail"] == "(중곡동)"
    assert school["phone"] == "02-123-4567"
    assert school["homepage"] == "http://school.example.org"
    assert (school["latitude"], school["longitude"]) == (37.55, 127.08)


def test_supplement_fills_coords_only(client, super_headers, org_tree_ids):
    # 두 번째 파일의 몫은 위도·경도뿐이다 — 주소 등 다른 칸은 가져오지 않는다.
    info = _csv_bytes("기관명" + chr(10) + "좌표만학교" + chr(10))
    coords = _csv_bytes(
        "학교명,주소,위도,경도" + chr(10) + "좌표만학교,보조 주소,37.0,127.0" + chr(10)
    )
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={
            "file": ("info.csv", info, "text/csv"),
            "coords_file": ("coords.csv", coords, "text/csv"),
        },
    )
    assert response.status_code == 200, response.text
    school = client.get("/api/v1/organizations?q=좌표만학교", headers=super_headers).json()[0]
    assert school["address"] is None
    assert (school["latitude"], school["longitude"]) == (37.0, 127.0)


def test_school_kind_names_become_levels(client, super_headers, org_tree_ids):
    # 학교종류명(고등학교/방송통신중학교/특수학교)이 학교급(고/중/기타)으로 바뀐다.
    info = _csv_bytes(
        "학교명,학교종류명" + chr(10)
        + "종류하나,고등학교" + chr(10)
        + "종류둘,방송통신중학교" + chr(10)
        + "종류셋,특수학교" + chr(10)
    )
    response = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={"file": ("info.csv", info, "text/csv")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 3
    listed = client.get("/api/v1/organizations?q=종류", headers=super_headers).json()
    levels = {o["name"]: o["school_level"] for o in listed}
    assert levels == {"종류하나": "고", "종류둘": "중", "종류셋": "기타"}


def test_bulk_upload_builds_org_tree_and_updates_by_name(
    client, super_headers, root_org_id, org_tree_ids
):
    """시도교육청명 → 최상위 바로 아래, 관할조직명 → 교육청 아래(각각 없을
    때만 생성), 학교는 그 아래. 같은 학교명은 다시 만들지 않고 변경한다."""
    info = _csv_bytes(
        "학교명,시도교육청명,관할조직명,주소" + chr(10)
        + "트리초등학교,트리교육청,트리교육지원청,처음 주소" + chr(10)
    )
    first = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={"file": ("info.csv", info, "text/csv")},
    ).json()
    assert first["created"] == 1 and first["errors"] == []

    orgs = client.get("/api/v1/organizations?q=트리", headers=super_headers).json()
    by_name = {o["name"]: o for o in orgs}
    assert by_name["트리교육청"]["parent_id"] == root_org_id
    assert by_name["트리교육지원청"]["parent_id"] == by_name["트리교육청"]["id"]
    assert by_name["트리초등학교"]["parent_id"] == by_name["트리교육지원청"]["id"]

    # 두 번째 업로드 — 기관 트리는 그대로 재사용하고, 같은 학교명은 변경.
    info2 = _csv_bytes(
        "학교명,시도교육청명,관할조직명,주소" + chr(10)
        + "트리초등학교,트리교육청,트리교육지원청,바뀐 주소" + chr(10)
    )
    second = client.post(
        "/api/v1/organizations/bulk-upload",
        headers=super_headers,
        params={"parent_id": org_tree_ids["office"], "default_org_type": "학교"},
        files={"file": ("info.csv", info2, "text/csv")},
    ).json()
    assert second["created"] == 0 and second["updated"] == 1

    orgs2 = client.get("/api/v1/organizations?q=트리", headers=super_headers).json()
    assert len(orgs2) == 3  # 교육청·지원청·학교 — 중복 생성 없음
    assert {o["name"]: o["address"] for o in orgs2}["트리초등학교"] == "바뀐 주소"


def test_merge_does_not_overwrite_base_values(client, super_headers, org_tree_ids):
    # 본 파일이 정본이다 — 이미 있는 값은 보조 파일이 덮지 않는다.
    info = _csv_bytes('기관명,위도,경도' + chr(10) + '정본학교,35.1,129.1' + chr(10))
    coords = _csv_bytes('학교명,위도,경도' + chr(10) + '정본학교,1.0,2.0' + chr(10))
    response = client.post(
        '/api/v1/organizations/bulk-upload',
        headers=super_headers,
        params={'parent_id': org_tree_ids['office'], 'default_org_type': '학교'},
        files={
            'file': ('info.csv', info, 'text/csv'),
            'coords_file': ('coords.csv', coords, 'text/csv'),
        },
    )
    assert response.status_code == 200, response.text
    listed = client.get('/api/v1/organizations?q=정본학교', headers=super_headers).json()
    assert (listed[0]['latitude'], listed[0]['longitude']) == (35.1, 129.1)


def test_delete_school_removes_owned_cms_data(client, super_headers, org_tree_ids):
    """스케줄·콘텐츠가 있어도 학교는 지워진다 — 소유 CMS 자료를 함께 지운다.

    이들이 RESTRICT FK 로 삭제를 막아 학교 정보 관리에서 500 이 나던 버그.
    """
    school = org_tree_ids["school_a"]
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "삭제될 콘텐츠", "org_id": school},
    )
    assert content.status_code == 201, content.text
    schedule = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={"name": "삭제될 스케줄", "kind": "시간지정", "org_id": school, "items": []},
    )
    assert schedule.status_code == 201, schedule.text

    deleted = client.delete(f"/api/v1/organizations/{school}", headers=super_headers)
    assert deleted.status_code == 200, deleted.text

    # 기관도, 그 기관이 소유하던 자료도 남지 않는다.
    assert (
        client.get(f"/api/v1/organizations/{school}", headers=super_headers).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/contents/{content.json()['id']}", headers=super_headers
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/schedules/{schedule.json()['id']}", headers=super_headers
        ).status_code
        == 404
    )


class TestBulkDelete:
    """/organizations/bulk-delete — 학교 정보 관리의 일괄 삭제."""

    def test_deletes_ids_and_reports_skips(
        self, client, super_headers, org_tree_ids, make_user
    ):
        # school_b 는 사용자가 있고 office 는 하위 기관이 있다 — 둘 다 건너뛴다.
        make_user("bulk_member", org_tree_ids["school_b"], [Role.MEMBER])
        response = client.post(
            "/api/v1/organizations/bulk-delete",
            headers=super_headers,
            json={
                "ids": [
                    org_tree_ids["school_a"],
                    org_tree_ids["school_b"],
                    org_tree_ids["office"],
                ]
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["deleted"] == 1
        assert body["skipped"] == 2
        assert any("하위 기관" in e for e in body["errors"])
        assert any("소속 사용자" in e for e in body["errors"])
        gone = client.get(
            f"/api/v1/organizations/{org_tree_ids['school_a']}", headers=super_headers
        )
        assert gone.status_code == 404

    def test_filter_mode_deletes_matching_schools(
        self, client, super_headers, org_tree_ids
    ):
        # 검색 조건(분류=학교)으로 지운다 — 교육청은 학교가 아니라 안 잡힌다.
        response = client.post(
            "/api/v1/organizations/bulk-delete",
            headers=super_headers,
            json={"category": "학교", "q": "학교"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["deleted"] == 2 and body["skipped"] == 0
        offices = client.get(
            f"/api/v1/organizations/{org_tree_ids['office']}", headers=super_headers
        )
        assert offices.status_code == 200

    def test_requires_criteria(self, client, super_headers, org_tree_ids):
        # 조건 없는 요청은 '전부 삭제'다 — 거절한다.
        response = client.post(
            "/api/v1/organizations/bulk-delete", headers=super_headers, json={}
        )
        assert response.status_code == 400
        assert "삭제할 대상" in response.json()["detail"]

    def test_out_of_scope_orgs_are_skipped(
        self, client, org_tree_ids, make_user, login
    ):
        # 다른 교육청 관리자는 남의 학교를 못 지운다 — 권한 사유로 건너뛴다.
        make_user("bulk_other_admin", org_tree_ids["other_office"], [Role.ORG_ADMIN])
        headers = login("bulk_other_admin")
        response = client.post(
            "/api/v1/organizations/bulk-delete",
            headers=headers,
            json={"ids": [org_tree_ids["school_a"]]},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["deleted"] == 0 and body["skipped"] == 1
        assert any("권한" in e for e in body["errors"])


class TestPagedList:
    """/organizations/paged — 학교 정보 관리처럼 큰 목록을 쓰는 화면용."""

    def test_category_filters_and_pages(self, client, super_headers, org_tree_ids):
        first = client.get(
            "/api/v1/organizations/paged",
            headers=super_headers,
            params={"category": "학교", "page": 1, "size": 1},
        ).json()
        assert first["total"] == 2
        assert first["page"] == 1 and first["size"] == 1
        assert len(first["items"]) == 1
        # 이름순 정렬 — 가나초등학교가 먼저다.
        assert first["items"][0]["name"] == "가나초등학교"

        second = client.get(
            "/api/v1/organizations/paged",
            headers=super_headers,
            params={"category": "학교", "page": 2, "size": 1},
        ).json()
        assert [o["name"] for o in second["items"]] == ["다라중학교"]

    def test_query_narrows(self, client, super_headers, org_tree_ids):
        body = client.get(
            "/api/v1/organizations/paged",
            headers=super_headers,
            params={"category": "학교", "q": "중학"},
        ).json()
        assert body["total"] == 1
        assert body["items"][0]["name"] == "다라중학교"

    def test_scope_limits_visibility(self, client, org_tree_ids, make_user, login):
        """다른 교육청 관리자에게는 내 학교가 안 보인다."""
        make_user("other_admin", org_tree_ids["other_office"], [Role.ORG_ADMIN])
        headers = login("other_admin")
        body = client.get(
            "/api/v1/organizations/paged",
            headers=headers,
            params={"category": "학교"},
        ).json()
        assert body["total"] == 0
