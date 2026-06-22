import json
import shutil
import uuid
from pathlib import Path

from app.services.workspace import ensure_project_dir, get_dist_dir

BUILDER_DIR = ".builder"
EXPORTS_DIR = "exports"


def create_project_zip(project_id: str, *, build_output: bool = False) -> Path:
    project_dir = ensure_project_dir(project_id)
    source_dir = get_dist_dir(project_id) if build_output else project_dir
    if not source_dir.is_dir():
        raise FileNotFoundError("Build output not found" if build_output else "Project not found")

    export_dir = project_dir / BUILDER_DIR / EXPORTS_DIR
    export_dir.mkdir(parents=True, exist_ok=True)
    archive_base = export_dir / ("dist" if build_output else "workspace")
    archive_path = archive_base.with_suffix(".zip")
    if archive_path.exists():
        archive_path.unlink()

    if build_output:
        return Path(shutil.make_archive(str(archive_base), "zip", source_dir))

    temp_dir = export_dir / f"tmp-{uuid.uuid4().hex[:8]}"
    ignore = shutil.ignore_patterns("node_modules", "dist", ".git", ".builder")
    shutil.copytree(project_dir, temp_dir, ignore=ignore)
    try:
        return Path(shutil.make_archive(str(archive_base), "zip", temp_dir))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def deployment_records_path(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path / "deployments.json"


def load_deployments(project_id: str) -> list[dict]:
    path = deployment_records_path(project_id)
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_deployment(project_id: str, record: dict) -> dict:
    deployments = load_deployments(project_id)
    deployments.insert(0, record)
    deployment_records_path(project_id).write_text(
        json.dumps(deployments[:100], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return record
