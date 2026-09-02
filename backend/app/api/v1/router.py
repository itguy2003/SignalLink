from fastapi import APIRouter

from app.api.v1 import (
    assets,
    auth,
    boards,
    contents,
    device_groups,
    devices,
    organizations,
    player,
    playlists,
    schedules,
    stock,
    users,
    widgets,
    ws,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(users.router)
api_router.include_router(devices.router)
api_router.include_router(device_groups.router)
api_router.include_router(schedules.router)
api_router.include_router(contents.router)
api_router.include_router(playlists.router)
api_router.include_router(boards.router)
api_router.include_router(widgets.router)
api_router.include_router(stock.router)
api_router.include_router(assets.router)
api_router.include_router(player.router)
api_router.include_router(ws.router)
