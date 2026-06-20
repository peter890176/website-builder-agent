from pydantic import BaseModel, Field
from typing import Literal


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User prompt for the website builder")
    mode: Literal["auto", "generate", "edit"] = Field(
        default="auto",
        description="Whether to generate from scratch, edit the current project, or auto-detect.",
    )


class ChangedProjectFile(BaseModel):
    path: str
    content: str


class ChatResponse(BaseModel):
    message: str
    reply: str
    project_id: str
    workspace_path: str
    files: list[str]
    preview_url: str | None = None
    build_attempts: int = 0
    fix_attempts: int = 0
    build_log: str = ""
    warnings: list[dict] = Field(default_factory=list)
    changed_files: list[ChangedProjectFile] = Field(default_factory=list)


class ProjectCreateResponse(BaseModel):
    project_id: str
    workspace_path: str
