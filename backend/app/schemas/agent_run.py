from typing import Any, Literal

from pydantic import BaseModel, Field


AgentRunStatus = Literal["running", "interrupted", "completed", "failed"]
AgentWorkflow = Literal["builder", "edit"]


class AgentRunStartRequest(BaseModel):
    message: str = Field(..., min_length=1)
    mode: Literal["auto", "generate", "edit"] = "auto"
    require_approval: bool = True


class AgentRunResumeRequest(BaseModel):
    approved: bool | None = Field(
        default=None,
        description="Approval decision for an interrupted run; omit to continue a run recovered after a process stop.",
    )


class AgentRunResponse(BaseModel):
    run_id: str
    project_id: str
    workflow: AgentWorkflow
    status: AgentRunStatus
    interrupt: dict[str, Any] | None = None
    next_nodes: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    reply: str = ""
    error: str = ""
    build_attempts: int = 0
    fix_attempts: int = 0
