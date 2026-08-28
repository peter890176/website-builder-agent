from fastapi import APIRouter, HTTPException

from app.schemas.agent_run import AgentRunResponse, AgentRunResumeRequest, AgentRunStartRequest
from app.services.agent_runs import get_agent_run, resume_agent_run, start_agent_run

router = APIRouter(prefix="/api/projects/{project_id}/agent-runs", tags=["agent-runs"])


@router.post("", response_model=AgentRunResponse)
def post_agent_run(project_id: str, body: AgentRunStartRequest) -> AgentRunResponse:
    try:
        return start_agent_run(
            project_id,
            body.message,
            mode=body.mode,
            require_approval=body.require_approval,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{run_id}", response_model=AgentRunResponse)
def get_agent_run_detail(project_id: str, run_id: str) -> AgentRunResponse:
    try:
        return get_agent_run(project_id, run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Agent run not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{run_id}/resume", response_model=AgentRunResponse)
def post_agent_run_resume(project_id: str, run_id: str, body: AgentRunResumeRequest) -> AgentRunResponse:
    try:
        return resume_agent_run(project_id, run_id, approved=body.approved)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Agent run not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
