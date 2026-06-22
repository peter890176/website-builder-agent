from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.chat import ChangedProjectFile


class ProjectEditPreviewRequest(BaseModel):
    message: str = Field(..., min_length=1)
    context_files: list[str] = Field(default_factory=list)
    current_file: str | None = None
    selected_text: str = ""
    selected_range: str = ""
    diagnostics_summary: str = ""


class ProjectEditPatchPreview(BaseModel):
    path: str
    content: str
    previous_content: str = ""
    diff: str
    change_type: Literal["added", "modified"] = "modified"
    diff_lines: int = 0


class ProjectEditPreviewResponse(BaseModel):
    notes: str = ""
    patches: list[ProjectEditPatchPreview] = Field(default_factory=list)
    npm_dependencies: list[str] = Field(default_factory=list)
    dev_dependencies: list[str] = Field(default_factory=list)
    warnings: list[dict] = Field(default_factory=list)
    change_size: Literal["small", "large"] = "small"
    requires_confirmation: bool = False
    total_diff_lines: int = 0


class ProjectEditApplyRequest(BaseModel):
    patches: list[ChangedProjectFile] = Field(default_factory=list)


class ProjectEditApplyResponse(BaseModel):
    message: str = "Edit applied"
    changed_files: list[ChangedProjectFile] = Field(default_factory=list)
