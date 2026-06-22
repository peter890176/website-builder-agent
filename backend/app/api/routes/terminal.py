from fastapi import APIRouter, HTTPException

from app.schemas.terminal import (
    InstallPackagesRequest,
    InstallPackagesResponse,
    TerminalHistoryResponse,
    TerminalRecordRequest,
)
from app.services.terminal import append_terminal_history, install_packages, list_terminal_history

router = APIRouter(prefix="/api/projects/{project_id}/terminal", tags=["terminal"])


@router.get("/history", response_model=TerminalHistoryResponse)
def get_terminal_history(project_id: str) -> TerminalHistoryResponse:
    return TerminalHistoryResponse(entries=list_terminal_history(project_id))


@router.post("/history", response_model=TerminalHistoryResponse)
def post_terminal_history(project_id: str, body: TerminalRecordRequest) -> TerminalHistoryResponse:
    append_terminal_history(
        project_id,
        command=body.command,
        args=body.args,
        session_id=body.session_id,
        cwd=body.cwd,
        exit_code=body.exit_code,
        output=body.output,
    )
    return TerminalHistoryResponse(entries=list_terminal_history(project_id))


@router.post("/install", response_model=InstallPackagesResponse)
def post_install_packages(project_id: str, body: InstallPackagesRequest) -> InstallPackagesResponse:
    try:
        entry = install_packages(project_id, body.packages, dev=body.dev)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if entry.exit_code != 0:
        raise HTTPException(status_code=500, detail=entry.output or "npm install failed")

    return InstallPackagesResponse(message="Packages installed", entry=entry)
