import logging

import os

import subprocess

from pathlib import Path



from app.agents.runtime_checks import find_browser_runtime_hazards, format_runtime_hazards
from app.services.scaffold import ensure_npm_dependencies, is_vite_project

logger = logging.getLogger(__name__)



BUILD_TIMEOUT_SECONDS = 180





def _local_bin(project_dir: Path, name: str) -> str:

    bin_dir = project_dir / "node_modules" / ".bin"

    if os.name == "nt":

        return str(bin_dir / f"{name}.cmd")

    return str(bin_dir / name)





def _run_command(

    args: list[str],

    cwd: Path,

    env: dict[str, str] | None = None,

    timeout: int = BUILD_TIMEOUT_SECONDS,

) -> None:

    logger.info("Running %s in %s", " ".join(args), cwd)

    try:

        result = subprocess.run(

            args,

            cwd=cwd,

            capture_output=True,

            text=True,

            check=False,

            env=env,

            timeout=timeout,

        )

    except subprocess.TimeoutExpired as exc:

        raise RuntimeError(f"Build timed out after {timeout}s") from exc



    if result.returncode != 0:

        detail = (result.stderr or result.stdout or "command failed").strip()

        raise RuntimeError(detail)



    logger.info("Command finished: %s", args[0])





def _clear_tsbuildinfo(project_dir: Path) -> None:

    for info in project_dir.glob("*.tsbuildinfo"):

        info.unlink(missing_ok=True)


def normalize_react_default_imports(project_dir: Path) -> list[Path]:
    changed: list[Path] = []
    src_dir = project_dir / "src"
    if not src_dir.is_dir():
        return changed

    for path in src_dir.rglob("*.tsx"):
        original = path.read_text(encoding="utf-8")
        normalized = _remove_react_default_import(original)
        if normalized != original:
            path.write_text(normalized, encoding="utf-8")
            changed.append(path)

    return changed


def _remove_react_default_import(content: str) -> str:
    lines = content.splitlines()
    fixed_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped in {'import React from "react";', "import React from 'react';"}:
            continue
        if stripped.startswith("import React, {") and stripped.endswith('} from "react";'):
            fixed_lines.append(line.replace("import React, ", "import ", 1))
            continue
        if stripped.startswith("import React, {") and stripped.endswith("} from 'react';"):
            fixed_lines.append(line.replace("import React, ", "import ", 1))
            continue
        fixed_lines.append(line)

    return "\n".join(fixed_lines) + ("\n" if content.endswith("\n") else "")





def build_vite_project(project_dir: Path, project_id: str) -> Path:

    if not is_vite_project(project_dir):

        raise RuntimeError("Project is not a Vite React TypeScript app")



    preview_base = f"/api/projects/{project_id}/preview/"

    env = {**os.environ}

    ensure_npm_dependencies(project_dir)

    tsc = _local_bin(project_dir, "tsc")

    vite = _local_bin(project_dir, "vite")

    eslint = _local_bin(project_dir, "eslint")



    if not Path(tsc).is_file():

        raise RuntimeError("TypeScript compiler not found in node_modules")

    if not Path(vite).is_file():

        raise RuntimeError("Vite not found in node_modules")

    if not Path(eslint).is_file():

        raise RuntimeError("ESLint not found in node_modules")



    _clear_tsbuildinfo(project_dir)

    normalized_files = normalize_react_default_imports(project_dir)
    if normalized_files:
        logger.info("Source normalization updated %s file(s)", len(normalized_files))

    logger.info("Running lint auto-fix for project %s", project_id)

    _run_command([eslint, ".", "--fix"], project_dir, env=env)



    logger.info("Type-checking project %s", project_id)

    _run_command([tsc, "-b", "--force"], project_dir, env=env)



    logger.info("Building project %s", project_id)

    _run_command([vite, "build", "--base", preview_base], project_dir, env=env)



    dist_dir = project_dir / "dist"

    if not (dist_dir / "index.html").is_file():

        raise RuntimeError("Build completed but dist/index.html was not created")

    hazards = find_browser_runtime_hazards(project_dir, dist_dir)
    if hazards:
        raise RuntimeError(format_runtime_hazards(hazards))



    logger.info("Build finished for project %s", project_id)

    return dist_dir





def try_build_vite_project(project_dir: Path, project_id: str) -> tuple[bool, str]:

    try:

        build_vite_project(project_dir, project_id)

        return True, "Build succeeded"

    except RuntimeError as exc:

        return False, str(exc)


