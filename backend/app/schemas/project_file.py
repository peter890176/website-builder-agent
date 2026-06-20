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
