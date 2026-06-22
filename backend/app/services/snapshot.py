import json
import shutil
import uuid
from pathlib import Path

from app.services.build_fix import collect_project_sources
from app.schemas.snapshot import ProjectSnapshot
from app.services.diagnostics import load_project_diagnostics
from app.services.history import append_history_event
from app.services.workspace import ensure_project_dir, write_project_file

BUILDER_DIR = ".builder"
SNAPSHOTS_DIR = "snapshots"
SNAPSHOTS_INDEX = "snapshots.json"


def _builder_dir(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _snapshots_dir(project_id: str) -> Path:
    path = _builder_dir(project_id) / SNAPSHOTS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _index_path(project_id: str) -> Path:
    return _builder_dir(project_id) / SNAPSHOTS_INDEX


def list_snapshots(project_id: str) -> list[ProjectSnapshot]:
    path = _index_path(project_id)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [ProjectSnapshot.model_validate(item) for item in data]


def _write_index(project_id: str, snapshots: list[ProjectSnapshot]) -> None:
    _index_path(project_id).write_text(
        json.dumps([item.model_dump() for item in snapshots], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_snapshot(
    project_id: str,
    *,
    label: str,
    kind: str,
    prompt: str = "",
    notes: str = "",
) -> ProjectSnapshot:
    sources = collect_project_sources(ensure_project_dir(project_id))
    diagnostics = load_project_diagnostics(project_id)
    snapshot = ProjectSnapshot(
        id=uuid.uuid4().hex[:12],
        label=label,
        kind=kind,
        prompt=prompt,
        notes=notes,
        file_count=len(sources),
        verified=diagnostics.status == "passed",
    )
    snapshot_dir = _snapshots_dir(project_id) / snapshot.id
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "files.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    (snapshot_dir / "metadata.json").write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")

    snapshots = [snapshot, *list_snapshots(project_id)]
    _write_index(project_id, snapshots[:100])
    append_history_event(
        project_id,
        event_type="snapshot",
        message=f"Created snapshot: {label}",
        metadata={"snapshot_id": snapshot.id, "kind": kind, "verified": snapshot.verified},
    )
    return snapshot


def read_snapshot_files(project_id: str, snapshot_id: str) -> dict[str, str]:
    path = _snapshots_dir(project_id) / snapshot_id / "files.json"
    if not path.is_file():
        raise FileNotFoundError(snapshot_id)
    return json.loads(path.read_text(encoding="utf-8"))


def get_snapshot(project_id: str, snapshot_id: str) -> ProjectSnapshot:
    snapshot = next((item for item in list_snapshots(project_id) if item.id == snapshot_id), None)
    if snapshot is None:
        raise FileNotFoundError(snapshot_id)
    return snapshot


def delete_snapshot(project_id: str, snapshot_id: str) -> ProjectSnapshot:
    snapshot = get_snapshot(project_id, snapshot_id)
    snapshots = [item for item in list_snapshots(project_id) if item.id != snapshot_id]
    _write_index(project_id, snapshots)

    snapshot_dir = _snapshots_dir(project_id) / snapshot_id
    if snapshot_dir.exists():
        shutil.rmtree(snapshot_dir)

    append_history_event(
        project_id,
        event_type="snapshot",
        message=f"Deleted snapshot: {snapshot.label}",
        metadata={"snapshot_id": snapshot.id, "kind": snapshot.kind},
    )
    return snapshot


def restore_snapshot(project_id: str, snapshot_id: str) -> tuple[ProjectSnapshot, list[dict[str, str]]]:
    project_dir = ensure_project_dir(project_id)
    snapshot = get_snapshot(project_id, snapshot_id)
    files = read_snapshot_files(project_id, snapshot_id)
    create_snapshot(
        project_id,
        label="Safety snapshot before restore",
        kind="restore",
        notes=f"Automatically created before restoring {snapshot.label}",
    )

    for folder in ("src", "public"):
        target = project_dir / folder
        if target.exists():
            shutil.rmtree(target)

    changed_files: list[dict[str, str]] = []
    for path, content in files.items():
        write_project_file(project_id, path, content)
        changed_files.append({"path": path, "content": content})

    append_history_event(
        project_id,
        event_type="restore",
        message=f"Restored snapshot: {snapshot.label}",
        metadata={"snapshot_id": snapshot.id},
    )
    return snapshot, changed_files


def compare_snapshots(project_id: str, from_snapshot_id: str, to_snapshot_id: str) -> tuple[ProjectSnapshot, ProjectSnapshot, list[dict[str, str]]]:
    from_snapshot = get_snapshot(project_id, from_snapshot_id)
    to_snapshot = get_snapshot(project_id, to_snapshot_id)
    from_files = read_snapshot_files(project_id, from_snapshot_id)
    to_files = read_snapshot_files(project_id, to_snapshot_id)
    paths = sorted(set(from_files) | set(to_files))
    changes: list[dict[str, str]] = []
    for path in paths:
        if path not in from_files:
            changes.append({"path": path, "change_type": "added"})
        elif path not in to_files:
            changes.append({"path": path, "change_type": "removed"})
        elif from_files[path] != to_files[path]:
            changes.append({"path": path, "change_type": "modified"})
    return from_snapshot, to_snapshot, changes
