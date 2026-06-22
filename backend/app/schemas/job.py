from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
JobType = Literal[
    "variant_generation",
    "quality_review",
    "terminal_command",
    "dependency_install",
    "deployment",
    "snapshot_restore",
]


class JobArtifact(BaseModel):
    id: str
    type: str
    name: str
    path: str = ""
    url: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class JobLogEntry(BaseModel):
    level: Literal["info", "warning", "error"] = "info"
    message: str
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ProjectJob(BaseModel):
    id: str
    project_id: str
    type: JobType
    status: JobStatus = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    title: str = ""
    logs: list[JobLogEntry] = Field(default_factory=list)
    artifacts: list[JobArtifact] = Field(default_factory=list)
    error: str = ""
    cancel_requested: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class JobCreateRequest(BaseModel):
    type: JobType
    title: str = ""


class JobListResponse(BaseModel):
    jobs: list[ProjectJob] = Field(default_factory=list)
