import logging

import os

import subprocess

from pathlib import Path



from app.agents.runtime_checks import find_browser_runtime_hazards, format_runtime_hazards
from app.services.scaffold import ensure_npm_dependencies, is_vite_project

from app.services.workspace import get_dist_dir



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





def build_vite_project(project_dir: Path, project_id: str) -> Path:

    if not is_vite_project(project_dir):

        raise RuntimeError("Project is not a Vite React TypeScript app")



    preview_base = f"/api/projects/{project_id}/preview/"

    env = {**os.environ}

    tsc = _local_bin(project_dir, "tsc")

    vite = _local_bin(project_dir, "vite")



    if not Path(tsc).is_file():

        raise RuntimeError("TypeScript compiler not found in node_modules")

    if not Path(vite).is_file():

        raise RuntimeError("Vite not found in node_modules")



    ensure_npm_dependencies(project_dir)

    _clear_tsbuildinfo(project_dir)



    logger.info("Type-checking project %s", project_id)

    _run_command([tsc, "-b", "--force"], project_dir, env=env)



    logger.info("Building project %s", project_id)

    _run_command([vite, "build", "--base", preview_base], project_dir, env=env)



    dist_dir = get_dist_dir(project_id)

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


