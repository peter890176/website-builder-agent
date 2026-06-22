from datetime import UTC, datetime

from pydantic import BaseModel, Field


class TerminalHistoryEntry(BaseModel):
    id: str
    session_id: str = "default"
    cwd: str = "/"
    command: str
    args: list[str] = Field(default_factory=list)
    exit_code: int | None = None
    output: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class TerminalHistoryResponse(BaseModel):
    entries: list[TerminalHistoryEntry] = Field(default_factory=list)


class TerminalRecordRequest(BaseModel):
    session_id: str = "default"
    cwd: str = "/"
    command: str = Field(..., min_length=1)
    args: list[str] = Field(default_factory=list)
    exit_code: int | None = None
    output: str = ""


class InstallPackagesRequest(BaseModel):
    packages: list[str] = Field(..., min_length=1)
    dev: bool = False


class InstallPackagesResponse(BaseModel):
    message: str
    entry: TerminalHistoryEntry
