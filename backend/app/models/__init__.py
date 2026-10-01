"""모든 모델을 임포트한다.

Alembic autogenerate 와 ``Base.metadata.create_all`` 이 전체 테이블을
인식하려면 이 모듈이 먼저 로드되어야 한다.
"""

from app.models.asset import Asset, ContentAsset, PlaylistAsset
from app.models.board import BoardPost, OrgBoard
from app.models.canva import CanvaAccount
from app.models.community_playlist import (
    CommunityPlaylist,
    CommunityPlaylistAsset,
    CommunitySetting,
)
from app.models.content import Content
from app.models.device import (
    Device,
    DeviceGroup,
    DeviceGroupMember,
    DeviceManager,
    DeviceScheduleLink,
    DeviceScreenshot,
)
from app.models.organization import Organization
from app.models.playlist import ContentPlaylist, Playlist, PlaylistItem
from app.models.schedule import Schedule, ScheduleItem
from app.models.user import LoginLog, User, UserRole

__all__ = [
    "CanvaAccount",
    "Asset",
    "BoardPost",
    "CommunityPlaylist",
    "CommunityPlaylistAsset",
    "CommunitySetting",
    "Content",
    "ContentAsset",
    "PlaylistAsset",
    "ContentPlaylist",
    "Device",
    "DeviceGroup",
    "DeviceGroupMember",
    "DeviceManager",
    "DeviceScheduleLink",
    "DeviceScreenshot",
    "LoginLog",
    "OrgBoard",
    "Organization",
    "Playlist",
    "PlaylistItem",
    "Schedule",
    "ScheduleItem",
    "User",
    "UserRole",
]
