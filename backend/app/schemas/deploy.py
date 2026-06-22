from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


DeployProvider = Literal["github", "vercel", "netlify", "cloudflare"]


class GitHubExportRequest(BaseModel):
    owner: str = Field(..., min_length=1)
    repo: str = Field(..., min_length=1)
    branch: str = "main"
    commit_message: str = "Export website builder project"
    create_repo: bool = False
    private: bool = True


class DeployRequest(BaseModel):
    provider: Literal["vercel", "netlify", "cloudflare"]
    site_name: str = ""
    project_name: str = ""


class DeploymentRecord(BaseModel):
    id: str
    provider: DeployProvider
    status: Literal["queued", "running", "ready", "failed"] = "queued"
    url: str | None = None
    message: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class DeploymentListResponse(BaseModel):
    deployments: list[DeploymentRecord] = Field(default_factory=list)


class GitHubExportResponse(BaseModel):
    deployment: DeploymentRecord
    repository_url: str | None = None
