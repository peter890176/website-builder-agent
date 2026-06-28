from pydantic import BaseModel, Field


class ProjectFileListResponse(BaseModel):
    files: list[str] = Field(default_factory=list)


class ProjectFileContentResponse(BaseModel):
    path: str
    content: str


class ProjectFilesContentResponse(BaseModel):
    files: list[ProjectFileContentResponse] = Field(default_factory=list)


class ProjectFileSaveRequest(BaseModel):
    path: str = Field(..., min_length=1)
    content: str


class ProjectFileSaveResponse(BaseModel):
    path: str
    message: str = "File saved"


class ProjectFileCreateRequest(BaseModel):
    path: str = Field(..., min_length=1)
    content: str = ""


class ProjectFileCreateResponse(BaseModel):
    path: str
    message: str = "File created"


class ProjectFileRenameRequest(BaseModel):
    old_path: str = Field(..., min_length=1)
    new_path: str = Field(..., min_length=1)


class ProjectFileRenameResponse(BaseModel):
    old_path: str
    new_path: str
    message: str = "File renamed"


class ProjectFileDeleteResponse(BaseModel):
    path: str
    message: str = "File deleted"


class ProjectSummary(BaseModel):
    project_id: str
    name: str
    workspace_path: str
    updated_at: str | None = None
    file_count: int = 0
    has_draft: bool = False


class ProjectListResponse(BaseModel):
    projects: list[ProjectSummary] = Field(default_factory=list)


class ProjectUpdateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class ProjectUpdateResponse(BaseModel):
    project: ProjectSummary
