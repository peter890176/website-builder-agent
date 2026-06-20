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


def ensure_workspace_root() -> Path:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR


def ensure_project_dir(project_id: str) -> Path:
    safe_id = project_id.strip()
    if not safe_id or ".." in safe_id or "/" in safe_id or "\\" in safe_id:
        raise ValueError("Invalid project_id")

    project_dir = ensure_workspace_root() / safe_id
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


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
    files: list[str] = []

    for path in project_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(project_dir)
        if any(part in IDE_IGNORED_DIRS for part in relative.parts):
            continue
        normalized = relative.as_posix()
        try:
            _validate_ide_relative_path(normalized)
        except ValueError:
            continue
        files.append(normalized)

    return sorted(files)


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
