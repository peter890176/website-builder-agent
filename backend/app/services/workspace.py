import json
import os
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import WORKSPACE_DIR

ALLOWED_EXTENSIONS = {".html", ".css", ".js", ".jsx", ".tsx", ".ts", ".svg", ".json", ".geojson"}
ALLOWED_ROOTS = {"src", "public"}
IDE_ALLOWED_ROOT_FILES = {
    ".gitignore",
    "eslint.config.js",
    "index.html",
    "package-lock.json",
    "package.json",
    "README.md",
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
}
IDE_IGNORED_DIRS = {"dist", "node_modules", ".git"}
PROJECT_METADATA_DIR = ".builder"
PROJECT_METADATA_FILE = "project.json"
STARTER_APP_MARKERS = (
    "Website Builder Agent",
    "Generated pages will replace this starter layout.",
)
STARTER_SOURCE_FILES = {
    "public/vite.svg",
    "src/App.css",
    "src/App.tsx",
    "src/index.css",
    "src/main.tsx",
    "src/vite-env.d.ts",
}


def ensure_workspace_root() -> Path:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR


def ensure_project_dir(project_id: str) -> Path:
    safe_id = _validate_project_id(project_id)

    project_dir = ensure_workspace_root() / safe_id
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


def get_existing_project_dir(project_id: str) -> Path:
    safe_id = _validate_project_id(project_id)
    project_dir = ensure_workspace_root() / safe_id
    if not project_dir.is_dir():
        raise FileNotFoundError(project_id)
    return project_dir


def _validate_project_id(project_id: str) -> str:
    safe_id = project_id.strip()
    if not safe_id or ".." in safe_id or "/" in safe_id or "\\" in safe_id:
        raise ValueError("Invalid project_id")
    return safe_id


def _validate_relative_path(relative_path: str) -> Path:
    safe_path = relative_path.strip().replace("\\", "/")
    if not safe_path or safe_path.startswith("/"):
        raise ValueError("Invalid relative path")

    relative = Path(safe_path)
    if ".." in relative.parts:
        raise ValueError("Invalid relative path")

    if relative.parts[0] not in ALLOWED_ROOTS:
        raise ValueError("Files must be under src/ or public/")

    suffix = relative.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")

    return relative


def _validate_ide_relative_path(relative_path: str) -> Path:
    safe_path = relative_path.strip().replace("\\", "/")
    if not safe_path or safe_path.startswith("/"):
        raise ValueError("Invalid relative path")

    relative = Path(safe_path)
    if ".." in relative.parts:
        raise ValueError("Invalid relative path")
    if any(part in IDE_IGNORED_DIRS for part in relative.parts):
        raise ValueError("Cannot edit generated or dependency directories")

    if len(relative.parts) == 1 and relative.name in IDE_ALLOWED_ROOT_FILES:
        return relative

    if relative.parts[0] not in ALLOWED_ROOTS:
        raise ValueError("Editable files must be under src/, public/, or known project config files")

    suffix = relative.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")

    return relative


def list_project_files(project_id: str) -> list[str]:
    project_dir = ensure_project_dir(project_id)
    return list_editable_files_in_dir(project_dir)


def list_editable_files_in_dir(project_dir: Path) -> list[str]:
    files: list[str] = []

    for path in _walk_project_files(project_dir):
        if not path.is_file():
            continue
        relative = path.relative_to(project_dir)
        normalized = relative.as_posix()
        try:
            _validate_ide_relative_path(normalized)
        except ValueError:
            continue
        files.append(normalized)

    return sorted(files)


def read_project_files(project_id: str) -> list[dict[str, str]]:
    project_dir = ensure_project_dir(project_id)
    files: list[dict[str, str]] = []
    for relative_path in list_editable_files_in_dir(project_dir):
        try:
            files.append({
                "path": relative_path,
                "content": (project_dir / relative_path).read_text(encoding="utf-8"),
            })
        except UnicodeDecodeError:
            continue
    return files


def list_projects() -> list[dict]:
    workspace_root = ensure_workspace_root()
    projects: list[dict] = []

    for project_dir in workspace_root.iterdir():
        if not project_dir.is_dir() or project_dir.name in IDE_IGNORED_DIRS:
            continue
        if not _looks_like_project(project_dir):
            continue
        projects.append(project_summary(project_dir.name))

    return sorted(projects, key=lambda project: project.get("updated_at") or "", reverse=True)


def update_project(project_id: str, *, name: str) -> dict:
    project_dir = get_existing_project_dir(project_id)
    if not _looks_like_project(project_dir):
        raise FileNotFoundError(project_id)
    metadata = _read_project_metadata(project_dir)
    metadata["name"] = _clean_project_name(name, fallback=project_id)
    _write_project_metadata(project_dir, metadata)
    return project_summary(project_id)


def ensure_project_metadata(project_id: str, *, name: str | None = None) -> dict:
    project_dir = ensure_project_dir(project_id)
    metadata = _read_project_metadata(project_dir)
    if name is not None:
        metadata["name"] = _clean_project_name(name, fallback=project_id)
    elif not metadata.get("name"):
        metadata["name"] = _default_project_name(project_id)
    _write_project_metadata(project_dir, metadata)
    return metadata


def project_summary(project_id: str) -> dict:
    project_dir = ensure_project_dir(project_id)
    metadata = _read_project_metadata(project_dir)
    files = list_editable_files_in_dir(project_dir)
    updated_at = _project_updated_at(project_dir)
    return {
        "project_id": project_id,
        "name": _clean_project_name(str(metadata.get("name") or ""), fallback=_default_project_name(project_id)),
        "workspace_path": str(project_dir),
        "updated_at": updated_at.isoformat() if updated_at else None,
        "file_count": len(files),
        "has_draft": _has_draft(project_dir, files),
    }


def write_project_file(project_id: str, relative_path: str, content: str) -> Path:
    relative = _validate_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return file_path


def read_project_file(project_id: str, relative_path: str) -> str:
    relative = _validate_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    if not file_path.is_file():
        raise FileNotFoundError(relative_path)
    return file_path.read_text(encoding="utf-8")


def read_editable_project_file(project_id: str, relative_path: str) -> str:
    relative = _validate_ide_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    if not file_path.is_file():
        raise FileNotFoundError(relative_path)
    return file_path.read_text(encoding="utf-8")


def write_editable_project_file(project_id: str, relative_path: str, content: str) -> Path:
    relative = _validate_ide_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    if not file_path.is_file():
        raise FileNotFoundError(relative_path)
    file_path.write_text(content, encoding="utf-8")
    return file_path


def create_editable_project_file(project_id: str, relative_path: str, content: str = "") -> Path:
    relative = _validate_ide_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    if file_path.exists():
        raise FileExistsError(relative_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return file_path


def delete_editable_project_file(project_id: str, relative_path: str) -> Path:
    relative = _validate_ide_relative_path(relative_path)
    project_dir = ensure_project_dir(project_id)
    file_path = project_dir / relative
    if not file_path.is_file():
        raise FileNotFoundError(relative_path)

    file_path.unlink()
    _remove_empty_parent_dirs(project_dir, file_path.parent)
    return file_path


def rename_editable_project_file(project_id: str, old_relative_path: str, new_relative_path: str) -> Path:
    old_relative = _validate_ide_relative_path(old_relative_path)
    new_relative = _validate_ide_relative_path(new_relative_path)
    project_dir = ensure_project_dir(project_id)
    old_path = project_dir / old_relative
    new_path = project_dir / new_relative

    if not old_path.is_file():
        raise FileNotFoundError(old_relative_path)
    if new_path.exists():
        raise FileExistsError(new_relative_path)

    new_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.rename(new_path)
    _remove_empty_parent_dirs(project_dir, old_path.parent)
    return new_path


def _remove_empty_parent_dirs(project_dir: Path, directory: Path) -> None:
    current = directory
    while current != project_dir and project_dir in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def get_dist_dir(project_id: str) -> Path:
    return ensure_project_dir(project_id) / "dist"


def _looks_like_project(project_dir: Path) -> bool:
    if (project_dir / PROJECT_METADATA_DIR / PROJECT_METADATA_FILE).is_file():
        return True
    if (project_dir / "package.json").is_file() and ((project_dir / "src").is_dir() or (project_dir / "index.html").is_file()):
        return True
    return False


def _read_project_metadata(project_dir: Path) -> dict:
    metadata_path = project_dir / PROJECT_METADATA_DIR / PROJECT_METADATA_FILE
    if not metadata_path.is_file():
        return {}
    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_project_metadata(project_dir: Path, metadata: dict) -> None:
    metadata_dir = project_dir / PROJECT_METADATA_DIR
    metadata_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = metadata_dir / PROJECT_METADATA_FILE
    current = dict(metadata)
    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    metadata_path.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _clean_project_name(name: str, *, fallback: str) -> str:
    cleaned = " ".join(name.strip().split())
    return cleaned[:120] if cleaned else fallback


def _default_project_name(project_id: str) -> str:
    return f"Project {project_id[:6]}"


def _project_updated_at(project_dir: Path) -> datetime | None:
    latest: datetime | None = None
    for path in _walk_project_files(project_dir):
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if latest is None or modified_at > latest:
            latest = modified_at
    return latest


def _walk_project_files(project_dir: Path):
    for root, dirnames, filenames in os.walk(project_dir):
        dirnames[:] = [dirname for dirname in dirnames if dirname not in IDE_IGNORED_DIRS]
        root_path = Path(root)
        for filename in filenames:
            yield root_path / filename


def _has_draft(project_dir: Path, files: list[str]) -> bool:
    source_files = [path for path in files if path.startswith(("src/", "public/"))]
    if not source_files:
        return False
    app_path = project_dir / "src" / "App.tsx"
    if app_path.is_file():
        try:
            app_content = app_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            app_content = ""
        if all(marker in app_content for marker in STARTER_APP_MARKERS):
            return any(path not in STARTER_SOURCE_FILES for path in source_files)

    diagnostics_path = project_dir / ".builder" / "diagnostics.json"
    if diagnostics_path.is_file():
        try:
            diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
            if diagnostics.get("status") in {"live_unverified", "verifying", "passed", "failed"}:
                return True
        except (json.JSONDecodeError, OSError, AttributeError):
            pass
    if (project_dir / "dist" / "index.html").is_file():
        return True
    return True
