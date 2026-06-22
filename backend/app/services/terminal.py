import json
import subprocess
import uuid
from pathlib import Path

from app.schemas.terminal import TerminalHistoryEntry
from app.services.jobs import append_job_artifact, append_job_log, create_job, update_job
from app.services.scaffold import _npm_command
from app.services.workspace import ensure_project_dir

BUILDER_DIR = ".builder"
TERMINAL_HISTORY_FILE = "terminal-history.json"


def _history_path(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path / TERMINAL_HISTORY_FILE


def list_terminal_history(project_id: str) -> list[TerminalHistoryEntry]:
    path = _history_path(project_id)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [TerminalHistoryEntry.model_validate(item) for item in data]


def append_terminal_history(
    project_id: str,
    *,
    command: str,
    args: list[str] | None = None,
    session_id: str = "default",
    cwd: str = "/",
    exit_code: int | None = None,
    output: str = "",
) -> TerminalHistoryEntry:
    entries = list_terminal_history(project_id)
    entry = TerminalHistoryEntry(
        id=uuid.uuid4().hex[:12],
        session_id=session_id,
        cwd=cwd,
        command=command,
        args=args or [],
        exit_code=exit_code,
        output=output[-8000:],
    )
    entries.append(entry)
    _history_path(project_id).write_text(
        json.dumps([item.model_dump() for item in entries[-200:]], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return entry


def install_packages(project_id: str, packages: list[str], *, dev: bool = False) -> TerminalHistoryEntry:
    project_dir = ensure_project_dir(project_id)
    job = create_job(project_id, "dependency_install", title=f"Install {' '.join(packages)}")
    append_job_log(project_id, job.id, "Starting npm install")
    update_job(project_id, job.id, status="running", progress=20)
    args = ["install", *packages, "--no-fund", "--no-audit", "--no-progress"]
    if dev:
        args.insert(1, "--save-dev")

    result = subprocess.run(
        [_npm_command(), *args],
        cwd=project_dir,
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    output = (result.stdout or "") + (result.stderr or "")
    entry = append_terminal_history(
        project_id,
        command="npm",
        args=args,
        session_id="dependency-install",
        cwd=str(project_dir),
        exit_code=result.returncode,
        output=output,
    )
    if result.returncode == 0:
        append_job_log(project_id, job.id, "npm install completed")
        append_job_artifact(
            project_id,
            job.id,
            artifact_type="dependency_install",
            name=", ".join(packages),
            metadata={"packages": packages, "dev": dev, "terminal_entry_id": entry.id},
        )
        update_job(project_id, job.id, status="succeeded", progress=100)
    else:
        append_job_log(project_id, job.id, output[-1000:] or "npm install failed", level="error")
        update_job(project_id, job.id, status="failed", progress=100, error=output[-2000:])
    return entry
