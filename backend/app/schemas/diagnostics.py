from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.chat import ChangedProjectFile


class TypeScriptDiagnostic(BaseModel):
    file: str
    line: int
    col: int
    code: str
    message: str


class ProjectDiagnosticsResponse(BaseModel):
    project_id: str
    status: Literal["idle", "drafting", "live_unverified", "verifying", "passed", "failed"] = "idle"
    build_log: str = ""
    typescript_errors: list[TypeScriptDiagnostic] = Field(default_factory=list)
    runtime_errors: list[str] = Field(default_factory=list)
    warnings: list[dict] = Field(default_factory=list)
    changed_files: list[ChangedProjectFile] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    preview_url: str | None = None
    updated_at: str | None = None
