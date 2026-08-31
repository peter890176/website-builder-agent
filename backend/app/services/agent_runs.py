import json
import uuid
from pathlib import Path
from typing import Any

from langgraph.types import Command

from app.agents.workflows import website_builder_graph, website_edit_graph
from app.schemas.agent_run import AgentRunResponse, AgentWorkflow
from app.services.agent_state import graph_config as _config, initial_state, prepare_edit_state
from app.services.diagnostics import build_diagnostics_from_log, save_project_diagnostics
from app.services.scaffold import scaffold_vite_project
from app.services.workspace import get_dist_dir, get_existing_project_dir, set_project_site_state

RUNS_DIR = "agent-runs"


def _run_path(project_id: str, run_id: str) -> Path:
    if not run_id or any(character not in "0123456789abcdef" for character in run_id) or len(run_id) != 32:
        raise ValueError("Invalid run_id")
    directory = get_existing_project_dir(project_id) / ".builder" / RUNS_DIR
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{run_id}.json"


def _graph(workflow: AgentWorkflow):
    return website_edit_graph if workflow == "edit" else website_builder_graph


def _interrupt_value(result: dict) -> dict[str, Any] | None:
    interrupts = result.get("__interrupt__", [])
    if not interrupts:
        return None
    value = getattr(interrupts[0], "value", interrupts[0])
    return value if isinstance(value, dict) else {"question": str(value)}


def _save_record(project_id: str, run_id: str, record: dict) -> None:
    _run_path(project_id, run_id).write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _load_record(project_id: str, run_id: str) -> dict:
    path = _run_path(project_id, run_id)
    if not path.is_file():
        raise FileNotFoundError(run_id)
    return json.loads(path.read_text(encoding="utf-8"))


def _response(project_id: str, run_id: str, workflow: AgentWorkflow, result: dict) -> AgentRunResponse:
    interrupt_value = _interrupt_value(result)
    status = "interrupted" if interrupt_value else "failed" if result.get("error") else "completed"
    graph = _graph(workflow)
    snapshot = graph.get_state(_config(run_id))
    response = AgentRunResponse(
        run_id=run_id,
        project_id=project_id,
        workflow=workflow,
        status=status,
        interrupt=interrupt_value,
        next_nodes=list(snapshot.next),
        files=result.get("files", []),
        reply=result.get("reply", ""),
        error=result.get("error") or "",
        build_attempts=result.get("build_attempts", 0),
        fix_attempts=result.get("fix_attempts", 0),
        build_log=result.get("build_log", ""),
        warnings=result.get("warnings", []),
    )
    _save_record(project_id, run_id, response.model_dump())
    if status == "completed":
        save_project_diagnostics(
            build_diagnostics_from_log(
                project_id,
                passed=True,
                build_log=response.build_log,
                warnings=response.warnings,
            )
        )
        set_project_site_state(project_id, "ready")
    return response


def start_agent_run(
    project_id: str,
    message: str,
    *,
    mode: str = "auto",
    require_approval: bool = True,
) -> AgentRunResponse:
    run_id = uuid.uuid4().hex
    project_dir = scaffold_vite_project(project_id)
    should_edit = mode == "edit" or (
        mode == "auto" and (get_dist_dir(project_id) / "index.html").is_file()
    )
    workflow: AgentWorkflow = "edit" if should_edit else "builder"
    state = initial_state(
        message,
        project_id,
        project_dir,
        run_id=run_id,
        require_approval=require_approval,
    )
    if should_edit:
        state = prepare_edit_state(state, message, project_dir)

    _save_record(
        project_id,
        run_id,
        {"run_id": run_id, "project_id": project_id, "workflow": workflow, "status": "running"},
    )
    result = _graph(workflow).invoke(state, config=_config(run_id))
    return _response(project_id, run_id, workflow, result)


def get_agent_run(project_id: str, run_id: str) -> AgentRunResponse:
    record = _load_record(project_id, run_id)
    return AgentRunResponse.model_validate(record)


def resume_agent_run(project_id: str, run_id: str, *, approved: bool | None) -> AgentRunResponse:
    record = _load_record(project_id, run_id)
    response = AgentRunResponse.model_validate(record)
    if response.status not in {"interrupted", "running"}:
        raise ValueError("Only an interrupted or recoverable running agent run can be resumed")

    graph = _graph(response.workflow)
    if response.status == "interrupted":
        if approved is None:
            raise ValueError("An approval decision is required for an interrupted agent run")
        graph_input = Command(
            resume={"action": "approve" if approved else "reject", "approved": approved}
        )
    else:
        graph_input = None
    result = graph.invoke(graph_input, config=_config(run_id))
    return _response(project_id, run_id, response.workflow, result)
