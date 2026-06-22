from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


class SnapshotCreateRequest(BaseModel):
    label: str = "Manual snapshot"
    kind: Literal["manual", "generate", "edit", "verify", "restore"] = "manual"
    prompt: str = ""
    notes: str = ""


class ProjectSnapshot(BaseModel):
    id: str
    label: str
    kind: str
    prompt: str = ""
    notes: str = ""
    file_count: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    verified: bool = False


class SnapshotListResponse(BaseModel):
    snapshots: list[ProjectSnapshot] = Field(default_factory=list)


class SnapshotDetailResponse(BaseModel):
    snapshot: ProjectSnapshot
    files: dict[str, str] = Field(default_factory=dict)


class RestoreSnapshotResponse(BaseModel):
    message: str = "Snapshot restored"
    snapshot: ProjectSnapshot
    changed_files: list[dict[str, str]] = Field(default_factory=list)


class HistoryEvent(BaseModel):
    id: str
    type: str
    message: str
    metadata: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class HistoryResponse(BaseModel):
    events: list[HistoryEvent] = Field(default_factory=list)


class SnapshotCompareFile(BaseModel):
    path: str
    change_type: Literal["added", "removed", "modified"]


class SnapshotCompareResponse(BaseModel):
    from_snapshot: ProjectSnapshot
    to_snapshot: ProjectSnapshot
    files: list[SnapshotCompareFile] = Field(default_factory=list)
