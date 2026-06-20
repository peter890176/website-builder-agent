from pydantic import BaseModel, Field


class ProjectFileListResponse(BaseModel):
    files: list[str] = Field(default_factory=list)


class ProjectFileContentResponse(BaseModel):
    path: str
    content: str


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
