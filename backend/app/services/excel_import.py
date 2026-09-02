"""기관 엑셀 일괄 등록 파서.

요구사항: "기관등록은 엑셀파일로 일괄 등록할 수 있어야 한다."

첫 행을 헤더로 보고 컬럼명을 매핑한다. 컬럼 순서는 자유이며,
알 수 없는 컬럼은 무시한다. 필수는 기관명 하나뿐이다.
"""

from __future__ import annotations

import io
from typing import Any

from openpyxl import load_workbook

from app.models.enums import OrgType, SchoolLevel

#: 엑셀 헤더 -> 모델 필드
COLUMN_MAP: dict[str, str] = {
    "기관명": "name",
    "주소": "address",
    "기관타입": "org_type",
    "학교단위": "school_level",
    "위도": "latitude",
    "경도": "longitude",
    "시도교육청코드": "edu_office_code",
    "학교코드": "school_code",
}

TEMPLATE_HEADERS = list(COLUMN_MAP)


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"숫자가 아닙니다: {value!r}") from None


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_organization_workbook(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """엑셀 바이트를 읽어 (등록할 행 목록, 오류 메시지 목록)을 반환한다."""
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - openpyxl 은 다양한 예외를 던진다
        return [], [f"엑셀 파일을 읽을 수 없습니다: {exc}"]

    sheet = workbook.active
    if sheet is None:
        return [], ["시트를 찾을 수 없습니다."]

    rows_iter = sheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        return [], ["빈 파일입니다."]

    header_index: dict[int, str] = {}
    for index, cell in enumerate(header_row):
        key = _as_str(cell)
        if key and key in COLUMN_MAP:
            header_index[index] = COLUMN_MAP[key]

    if "name" not in header_index.values():
        return [], [f"'기관명' 컬럼이 없습니다. 필요한 헤더: {', '.join(TEMPLATE_HEADERS)}"]

    valid_types = {str(t) for t in OrgType}
    valid_levels = {str(level) for level in SchoolLevel}

    parsed: list[dict[str, Any]] = []
    errors: list[str] = []

    for row_number, row in enumerate(rows_iter, start=2):
        if row is None or all(cell in (None, "") for cell in row):
            continue

        record: dict[str, Any] = {}
        try:
            for index, field in header_index.items():
                value = row[index] if index < len(row) else None
                if field in ("latitude", "longitude"):
                    record[field] = _as_float(value)
                else:
                    record[field] = _as_str(value)

            if not record.get("name"):
                raise ValueError("기관명이 비어 있습니다.")

            org_type = record.get("org_type") or str(OrgType.ORG)
            if org_type not in valid_types:
                allowed = ", ".join(sorted(valid_types))
                raise ValueError(f"기관타입이 올바르지 않습니다: {org_type} (허용: {allowed})")
            record["org_type"] = org_type

            level = record.get("school_level")
            if level and level not in valid_levels:
                allowed = ", ".join(sorted(valid_levels))
                raise ValueError(f"학교단위가 올바르지 않습니다: {level} (허용: {allowed})")

            parsed.append(record)
        except ValueError as exc:
            errors.append(f"{row_number}행: {exc}")

    workbook.close()
    return parsed, errors
