from datetime import UTC, datetime
import re

from pydantic import BaseModel, Field, field_validator


PACKAGE_SPEC_PATTERN = re.compile(
    r"^(@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)"
    r"(@[a-z0-9][a-z0-9._+~:-]*)?$",
    re.IGNORECASE,
)


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

    @field_validator("packages")
    @classmethod
    def validate_packages(cls, packages: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()

        for package in packages:
            spec = package.strip()
            if not spec:
                raise ValueError("Package names cannot be empty")
            if spec.startswith("-") or not PACKAGE_SPEC_PATTERN.fullmatch(spec):
                raise ValueError(f"Invalid npm package spec: {package}")
            if spec not in seen:
                normalized.append(spec)
                seen.add(spec)

        return normalized


class InstallPackagesResponse(BaseModel):
    message: str
    entry: TerminalHistoryEntry
