import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from app.agents.graph import website_builder_graph, website_edit_graph
from app.agents.imports import normalize_generated_files, normalize_posix_path
from app.agents.state import AgentState
from app.schemas.diagnostics import ProjectDiagnosticsResponse
from app.schemas.plan import FilePlanItem, ProjectPlan
from app.schemas.chat import ChatRequest, ChatResponse, ProjectCreateResponse
from app.schemas.project_file import (
    ProjectFileCreateRequest,
    ProjectFileCreateResponse,
    ProjectFileContentResponse,
    ProjectFileDeleteResponse,
    ProjectFileListResponse,
    ProjectFileRenameRequest,
    ProjectFileRenameResponse,
    ProjectFileSaveRequest,
    ProjectFileSaveResponse,
)
from app.services.build import try_build_vite_project
from app.services.build_fix import collect_project_sources
from app.services.diagnostics import (
    build_diagnostics_from_log,
    load_project_diagnostics,
    save_project_diagnostics,
)
from app.services.project_edit import clean_edit_patches, request_project_edit
from app.services.scaffold import copy_vite_template, ensure_npm_dependencies, scaffold_vite_project
from app.services.workspace import (
    create_editable_project_file,
    delete_editable_project_file,
    ensure_project_dir,
    get_dist_dir,
    list_project_files,
    read_editable_project_file,
    rename_editable_project_file,
    write_editable_project_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectCreateResponse)
def create_project(background_tasks: BackgroundTasks) -> ProjectCreateResponse:
    project_id = uuid.uuid4().hex[:12]

    try:
        project_dir = copy_vite_template(project_id)
        background_tasks.add_task(ensure_npm_dependencies, project_dir)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    logger.info("Created project %s; dependency install scheduled", project_id)

    return ProjectCreateResponse(
        project_id=project_id,
        workspace_path=str(project_dir),
    )


@router.post("/{project_id}/chat", response_model=ChatResponse)
def post_chat(project_id: str, body: ChatRequest) -> ChatResponse:
    logger.info("Chat started for project %s", project_id)

    try:
        project_dir = scaffold_vite_project(project_id)
    except (ValueError, RuntimeError) as exc:
        status = 400 if isinstance(exc, ValueError) else 500
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    should_edit = body.mode == "edit" or (
        body.mode == "auto" and (get_dist_dir(project_id) / "index.html").is_file()
    )

    initial_state = _initial_state(body.message, project_id, project_dir)

    if should_edit:
        logger.info("Applying incremental edit for project %s", project_id)
        initial_state = _prepare_edit_state(initial_state, body.message, project_dir)
        result = website_edit_graph.invoke(
            initial_state,
            config={"recursion_limit": 80},
        )
    else:
        result = website_builder_graph.invoke(
            initial_state,
            config={"recursion_limit": 80},
        )

    if result.get("error"):
        detail = result["error"]
        if result.get("build_log"):
            detail = f"{detail}\n\nBuild log:\n{result['build_log']}"
        logger.error("Chat failed for project %s: %s", project_id, detail)
        raise HTTPException(status_code=500, detail=detail)

    files = result.get("files", [])
    preview_url = f"/api/projects/{project_id}/preview/" if files else None

    logger.info(
        "Chat completed for project %s (fix_attempts=%s, build_attempts=%s)",
        project_id,
        result.get("fix_attempts", 0),
        result.get("build_attempts", 0),
    )

    warnings = result.get("warnings", [])
    changed_files = _changed_files_payload(result.get("generated_files", {}), project_dir)
    save_project_diagnostics(
        build_diagnostics_from_log(
            project_id,
            passed=True,
            build_log=result.get("build_log", ""),
            warnings=warnings,
        )
    )

    return ChatResponse(
        message="Website generated successfully with warnings" if warnings else "Website generated successfully",
        reply=result.get("reply", ""),
        project_id=project_id,
        workspace_path=str(project_dir),
        files=files,
        preview_url=preview_url,
        build_attempts=result.get("build_attempts", 0),
        fix_attempts=result.get("fix_attempts", 0),
        build_log=result.get("build_log", ""),
        warnings=warnings,
        changed_files=changed_files,
    )


def _changed_files_payload(generated_files: dict[str, str], project_dir) -> list[dict[str, str]]:
    changed: dict[str, str] = {
        normalize_posix_path(path): content
        for path, content in generated_files.items()
    }

    package_json = project_dir / "package.json"
    if package_json.is_file():
        changed["package.json"] = package_json.read_text(encoding="utf-8")

    return [
        {"path": path, "content": content}
        for path, content in sorted(changed.items())
    ]


@router.get("/{project_id}/files", response_model=ProjectFileListResponse)
def get_project_files(project_id: str) -> ProjectFileListResponse:
    try:
        files = list_project_files(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProjectFileListResponse(files=files)


@router.get("/{project_id}/files/content", response_model=ProjectFileContentResponse)
def get_project_file_content(project_id: str, path: str) -> ProjectFileContentResponse:
    try:
        content = read_editable_project_file(project_id, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc

    return ProjectFileContentResponse(path=path, content=content)


@router.put("/{project_id}/files/content", response_model=ProjectFileSaveResponse)
def put_project_file_content(project_id: str, body: ProjectFileSaveRequest) -> ProjectFileSaveResponse:
    try:
        write_editable_project_file(project_id, body.path, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc

    return ProjectFileSaveResponse(path=body.path)


@router.post("/{project_id}/files/content", response_model=ProjectFileCreateResponse)
def post_project_file_content(project_id: str, body: ProjectFileCreateRequest) -> ProjectFileCreateResponse:
    try:
        create_editable_project_file(project_id, body.path, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="File already exists") from exc

    return ProjectFileCreateResponse(path=body.path)


@router.patch("/{project_id}/files/content", response_model=ProjectFileRenameResponse)
def patch_project_file_content(project_id: str, body: ProjectFileRenameRequest) -> ProjectFileRenameResponse:
    try:
        rename_editable_project_file(project_id, body.old_path, body.new_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="Target file already exists") from exc

    return ProjectFileRenameResponse(old_path=body.old_path, new_path=body.new_path)


@router.delete("/{project_id}/files/content", response_model=ProjectFileDeleteResponse)
def delete_project_file_content(project_id: str, path: str) -> ProjectFileDeleteResponse:
    try:
        delete_editable_project_file(project_id, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc

    return ProjectFileDeleteResponse(path=path)


@router.post("/{project_id}/build", response_model=ProjectDiagnosticsResponse)
def post_project_build(project_id: str) -> ProjectDiagnosticsResponse:
    try:
        project_dir = scaffold_vite_project(project_id)
        passed, build_log = try_build_vite_project(project_dir, project_id)
        diagnostics = build_diagnostics_from_log(project_id, passed=passed, build_log=build_log)
        save_project_diagnostics(diagnostics)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        diagnostics = build_diagnostics_from_log(project_id, passed=False, build_log=str(exc))
        save_project_diagnostics(diagnostics)

    return diagnostics


@router.get("/{project_id}/diagnostics", response_model=ProjectDiagnosticsResponse)
def get_project_diagnostics(project_id: str) -> ProjectDiagnosticsResponse:
    try:
        return load_project_diagnostics(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _initial_state(message: str, project_id: str, project_dir) -> AgentState:
    return {
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



def _prepare_edit_state(state: AgentState, message: str, project_dir) -> AgentState:
    current_files = collect_project_sources(project_dir)
    edit = clean_edit_patches(request_project_edit(project_dir, message, existing_warnings=state.get("warnings", [])))
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


@router.get("/{project_id}/preview")
def preview_project_root(project_id: str) -> RedirectResponse:
    return RedirectResponse(url=f"/api/projects/{project_id}/preview/")


@router.get("/{project_id}/preview/")
def preview_project_index(project_id: str) -> FileResponse:
    try:
        ensure_project_dir(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    index_path = get_dist_dir(project_id) / "index.html"
    if not index_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Build output not found. Generate the website first.",
        )

    return FileResponse(
        index_path,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{project_id}/preview/{asset_path:path}")
def preview_project_asset(project_id: str, asset_path: str) -> FileResponse:
    try:
        ensure_project_dir(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    dist_dir = get_dist_dir(project_id)
    asset_file = (dist_dir / asset_path).resolve()

    if not str(asset_file).startswith(str(dist_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid asset path")

    if not asset_file.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")

    return FileResponse(asset_file, headers={"Cache-Control": "no-store"})
