from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.edit_review import ProjectEditPreviewResponse


class QualityIssue(BaseModel):
    category: Literal["seo", "accessibility", "responsive", "runtime", "design"]
    severity: Literal["info", "warning", "error"] = "warning"
    message: str
    path: str = ""


class QualityReviewResponse(BaseModel):
    id: str
    project_id: str
    score: int
    issues: list[QualityIssue] = Field(default_factory=list)
    screenshots: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class DesignPolishRequest(BaseModel):
    focus: str = "Improve visual hierarchy, spacing, responsiveness, accessibility, and polish."


class DesignPolishResponse(ProjectEditPreviewResponse):
    pass


class VariantGenerateRequest(BaseModel):
    count: int = Field(default=3, ge=1, le=4)
    focus: str = "Generate distinct visual directions for the current website."


class VariantSummary(BaseModel):
    id: str
    title: str
    description: str
    preview_notes: str = ""


class VariantGenerateResponse(BaseModel):
    variants: list[VariantSummary] = Field(default_factory=list)
