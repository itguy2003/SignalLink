"""이미 올라와 있는 자산의 썸네일을 만들어 채운다.

썸네일은 업로드 때 만들어지지만(``asset_service.attach_thumbnail``), 이 기능이
생기기 전에 올라온 파일들은 비어 있다. 한 번 돌리면 그것들을 채운다.
이미 썸네일이 있는 자산은 건너뛰므로 여러 번 돌려도 무방하다.

사용: PYTHONPATH=. python scripts/generate_thumbnails.py
"""

from __future__ import annotations

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.asset import Asset
from app.services import assets as asset_service


def main() -> None:
    made = skipped = failed = 0
    with SessionLocal() as db:
        rows = db.execute(select(Asset).where(Asset.thumb_path.is_(None))).scalars().all()
        for asset in rows:
            if not asset_service.absolute_path(asset).exists():
                skipped += 1
                continue
            asset_service.attach_thumbnail(asset)
            if asset.thumb_path:
                made += 1
            else:
                failed += 1
        db.commit()
    print(f"만듦 {made} / 원본 없음 {skipped} / 실패 {failed}")


if __name__ == "__main__":
    main()
