"""FastAPI 애플리케이션 진입점."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.init_db import create_tables, init_db
from app.db.session import SessionLocal

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # 개발 편의를 위해 기동 시 테이블을 만든다.
    # 운영에서는 Alembic 마이그레이션이 스키마를 관리하며, create_all 은
    # 이미 존재하는 테이블을 건드리지 않으므로 함께 두어도 안전하다.
    create_tables()
    with SessionLocal() as db:
        init_db(db)
    logger.info(
        "%s 기동 완료 (DB: %s)",
        settings.PROJECT_NAME,
        "SQLite" if settings.is_sqlite else "PostgreSQL",
    )
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="DID(디지털 사이니지) 장치 통합관리 시스템 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):  # noqa: ANN001, ANN201
    """응답 시간을 헤더로 노출한다.

    요구사항 제한사항 4(콘텐츠 요청 200ms 이내)를 실측하기 위한 것이다.
    플레이어 엔드포인트가 임계치를 넘으면 경고 로그를 남긴다.
    """
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
    if elapsed_ms > 200 and request.url.path.startswith(f"{settings.API_V1_PREFIX}/player"):
        logger.warning("플레이어 응답 지연 %.1fms %s", elapsed_ms, request.url.path)
    return response


app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["시스템"], summary="헬스체크")
def health() -> dict:
    return {"status": "ok", "project": settings.PROJECT_NAME}
