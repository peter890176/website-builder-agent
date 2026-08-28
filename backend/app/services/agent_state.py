from pathlib import Path

from app.agents.imports import normalize_generated_files, normalize_posix_path
from app.agents.state import AgentState
from app.schemas.plan import FilePlanItem, ProjectPlan
from app.services.build_fix import collect_project_sources
from app.services.project_edit import clean_edit_patches, request_project_edit


def graph_config(run_id: str) -> dict:
    if not run_id.strip():
        raise ValueError("run_id is required for checkpointed LangGraph execution")
    return {
        "recursion_limit": 80,
        "configurable": {"thread_id": run_id},
        "metadata": {"agent_run_id": run_id},
    }


def initial_state(
    message: str,
    project_id: str,
    project_dir: Path,
    *,
    run_id: str = "",
    require_approval: bool = False,
) -> AgentState:
    return {
        "run_id": run_id,
        "require_approval": require_approval,
        "approval_status": "pending" if require_approval else "not_required",
        "message": message,
        "project_id": project_id,
        "workspace_path": str(project_dir),
        "plan": {},
        "generated_files": {},
        "pending_npm": [],
        "pending_dev_npm": [],
        "files": [],
        "reply": "",
        "warnings": [],
        "error": None,
        "build_success": False,
        "build_attempts": 0,
        "build_fix_attempts": 0,
        "runtime_attempts": 0,
        "runtime_fix_attempts": 0,
        "fix_attempts": 0,
        "invalid_fix_attempts": 0,
        "dep_attempts": 0,
        "pending_error": "",
        "failure_stage": "",
        "target_file": "",
        "resume_stage": "",
        "legacy_peer_deps": False,
        "build_log": "",
        "failed_npm_specs": [],
        "last_fix_rejection": "",
        "last_error_signature": "",
        "last_error_signatures": [],
        "build_no_progress_count": 0,
        "stale_fix_count": 0,
    }


def prepare_edit_state(state: AgentState, message: str, project_dir: Path) -> AgentState:
    current_files = collect_project_sources(project_dir)
    edit = clean_edit_patches(
        request_project_edit(project_dir, message, existing_warnings=state.get("warnings", []))
    )
    generated = dict(current_files)
    for patch in edit.patches:
        generated[normalize_posix_path(patch.path)] = patch.content
    generated = normalize_generated_files(generated)

    plan = ProjectPlan(
        summary=f"Incremental edit: {message}",
        files=[
            FilePlanItem(path=path, description=f"Existing edited file {path}", file_type=_plan_file_type(path))
            for path in sorted(generated)
        ],
        npm_dependencies=edit.npm_dependencies,
    )
    return {
        **state,
        "generated_files": generated,
        "plan": plan.model_dump(),
        "pending_npm": edit.npm_dependencies,
        "pending_dev_npm": edit.dev_dependencies,
        "warnings": [*state.get("warnings", []), *edit.warnings],
        "reply": edit.notes,
    }


def _plan_file_type(path: str):
    if path.endswith(".json"):
        return "json"
    if path.endswith(".css"):
        return "css"
    if path.endswith(".svg"):
        return "svg"
    if path.endswith(".ts") and not path.endswith(".tsx"):
        return "ts"
    return "tsx"
