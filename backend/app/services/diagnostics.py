import json
from datetime import UTC, datetime
from pathlib import Path

from app.agents.tsc_errors import parse_tsc_errors
from app.schemas.diagnostics import ProjectDiagnosticsResponse, TypeScriptDiagnostic
from app.services.workspace import ensure_project_dir, get_dist_dir


DIAGNOSTICS_DIR_NAME = ".builder"
DIAGNOSTICS_FILE_NAME = "diagnostics.json"


def diagnostics_path(project_id: str) -> Path:
    return ensure_project_dir(project_id) / DIAGNOSTICS_DIR_NAME / DIAGNOSTICS_FILE_NAME


def idle_diagnostics(project_id: str) -> ProjectDiagnosticsResponse:
    return ProjectDiagnosticsResponse(project_id=project_id)


def load_project_diagnostics(project_id: str) -> ProjectDiagnosticsResponse:
    path = diagnostics_path(project_id)
    if not path.is_file():
        return idle_diagnostics(project_id)

    try:
        return ProjectDiagnosticsResponse.model_validate_json(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return idle_diagnostics(project_id)


def save_project_diagnostics(diagnostics: ProjectDiagnosticsResponse) -> ProjectDiagnosticsResponse:
    path = diagnostics_path(diagnostics.project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(diagnostics.model_dump_json(indent=2), encoding="utf-8")
    return diagnostics


def build_diagnostics_from_log(
    project_id: str,
    *,
    passed: bool,
    build_log: str,
    warnings: list[dict] | None = None,
) -> ProjectDiagnosticsResponse:
    errors = [
        TypeScriptDiagnostic(
            file=error.file,
            line=error.line,
            col=error.col,
            code=error.code,
            message=error.message,
        )
        for error in parse_tsc_errors(build_log)
    ]
    preview_url = f"/api/projects/{project_id}/preview/" if passed and (get_dist_dir(project_id) / "index.html").is_file() else None

    return ProjectDiagnosticsResponse(
        project_id=project_id,
        status="passed" if passed else "failed",
        build_log=build_log,
        typescript_errors=errors,
        warnings=warnings or [],
        preview_url=preview_url,
        updated_at=datetime.now(UTC).isoformat(),
    )
