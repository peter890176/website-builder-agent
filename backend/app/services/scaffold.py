import logging
import os
import shutil
import subprocess
import threading
from pathlib import Path

from app.core.config import TEMPLATE_DIR
from app.services.workspace import ensure_project_dir

logger = logging.getLogger(__name__)

NPM_INSTALL_TIMEOUT_SECONDS = 300
_install_locks: dict[str, threading.RLock] = {}
_install_locks_guard = threading.Lock()


def _npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def _run_npm(args: list[str], cwd: Path, timeout: int = NPM_INSTALL_TIMEOUT_SECONDS) -> None:
    logger.info("Running npm %s in %s", " ".join(args), cwd)
    try:
        result = subprocess.run(
            [_npm_command(), *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"npm timed out after {timeout}s: {' '.join(args)}") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "npm command failed").strip()
        raise RuntimeError(detail)

    logger.info("npm %s finished", " ".join(args))


def is_vite_project(project_dir: Path) -> bool:
    return (project_dir / "package.json").is_file() and (project_dir / "vite.config.ts").is_file()


def has_node_modules(project_dir: Path) -> bool:
    return (project_dir / "node_modules").is_dir()


def _get_install_lock(project_id: str) -> threading.RLock:
    with _install_locks_guard:
        return _install_locks.setdefault(project_id, threading.RLock())


def copy_vite_template(project_id: str) -> Path:
    project_dir = ensure_project_dir(project_id)

    if is_vite_project(project_dir):
        return project_dir

    if not TEMPLATE_DIR.is_dir():
        raise RuntimeError(f"Vite template not found: {TEMPLATE_DIR}")

    logger.info("Copying Vite template for project %s", project_id)

    for item in TEMPLATE_DIR.iterdir():
        if item.name in {"node_modules", "dist"}:
            continue
        target = project_dir / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    return project_dir


def ensure_npm_dependencies(project_dir: Path) -> None:
    project_id = project_dir.name

    with _get_install_lock(project_id):
        if has_node_modules(project_dir):
            logger.info("node_modules already present for project %s", project_id)
            return

        if not is_vite_project(project_dir):
            raise RuntimeError("Project is not a Vite React TypeScript app")

        lock_file = project_dir / "package-lock.json"
        if lock_file.is_file():
            _run_npm(["ci", "--no-fund", "--no-audit"], project_dir)
        else:
            _run_npm(["install", "--no-fund", "--no-audit"], project_dir)


def scaffold_vite_project(project_id: str, *, install_dependencies: bool = True) -> Path:
    project_dir = copy_vite_template(project_id)
    if install_dependencies:
        ensure_npm_dependencies(project_dir)
    return project_dir
