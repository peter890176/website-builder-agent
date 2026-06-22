from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.chat import ChangedProjectFile
from app.schemas.quality import QualityIssue


class VariantGenerateJobRequest(BaseModel):
    count: int = Field(default=3, ge=1, le=4)
    focus: str = "Generate distinct visual directions for the current website."


class ProjectVariant(BaseModel):
    id: str
    title: str
    description: str
    status: Literal["queued", "building", "ready", "failed"] = "queued"
    patches: list[ChangedProjectFile] = Field(default_factory=list)
    diff_summary: str = ""
    quality_score: int = 0
    issues: list[QualityIssue] = Field(default_factory=list)
    screenshots: list[str] = Field(default_factory=list)
    build_log: str = ""
    job_id: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class VariantListResponse(BaseModel):
    variants: list[ProjectVariant] = Field(default_factory=list)


class VariantApplyResponse(BaseModel):
    message: str = "Variant applied"
    changed_files: list[ChangedProjectFile] = Field(default_factory=list)
