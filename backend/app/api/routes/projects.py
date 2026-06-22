import logging
import uuid
from difflib import unified_diff

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from app.agents.graph import (
    generate_files,
    plan_project,
    repair_missing_imports,
    sync_project,
    website_builder_graph,
    website_edit_graph,
)
from app.agents.imports import normalize_generated_files, normalize_posix_path
from app.agents.state import AgentState
from app.agents.tsc_errors import build_fix_hints
from app.core.config import MAX_BUILD_FIX_ATTEMPTS
from app.schemas.diagnostics import ProjectDiagnosticsResponse
from app.schemas.edit_review import (
    ProjectEditApplyRequest,
    ProjectEditApplyResponse,
    ProjectEditPatchPreview,
    ProjectEditPreviewRequest,
    ProjectEditPreviewResponse,
)
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
from app.services.build import normalize_react_default_imports, try_build_vite_project
from app.services.build_fix import collect_project_sources, request_project_fix
from app.services.diagnostics import (
    build_diagnostics_from_log,
    load_project_diagnostics,
    save_project_diagnostics,
)
from app.services.project_edit import clean_edit_patches, request_project_edit
from app.services.dependencies import install_planned_dependencies
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
    write_project_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])
VERIFY_REPAIR_ATTEMPTS = MAX_BUILD_FIX_ATTEMPTS


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


@router.post("/{project_id}/chat/draft", response_model=ChatResponse)
def post_chat_draft(project_id: str, body: ChatRequest) -> ChatResponse:
    logger.info("Draft chat started for project %s", project_id)

    try:
        project_dir = scaffold_vite_project(project_id, install_dependencies=False)
    except (ValueError, RuntimeError) as exc:
        status = 400 if isinstance(exc, ValueError) else 500
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    save_project_diagnostics(
        ProjectDiagnosticsResponse(project_id=project_id, status="drafting")
    )

    should_edit = body.mode == "edit" or (
        body.mode == "auto" and collect_project_sources(project_dir)
    )

    try:
        if should_edit:
            result = _run_edit_draft(project_id, body.message, project_dir)
        else:
            result = _run_generate_draft(project_id, body.message, project_dir)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    normalized_files = _normalize_project_sources(project_dir)
    generated_files = {**result.get("generated_files", {}), **normalized_files}
    changed_files = _changed_files_payload(generated_files, project_dir)
    files = sorted(generated_files.keys())
    warnings = result.get("warnings", [])

    save_project_diagnostics(
        ProjectDiagnosticsResponse(
            project_id=project_id,
            status="live_unverified",
            warnings=warnings,
        )
    )

    return ChatResponse(
        message="Draft ready",
        reply=result.get("reply", "Draft files are ready for live preview."),
        project_id=project_id,
        workspace_path=str(project_dir),
        files=files,
        preview_url=None,
        warnings=warnings,
        changed_files=changed_files,
    )


@router.post("/{project_id}/verify", response_model=ProjectDiagnosticsResponse)
def post_project_verify(project_id: str) -> ProjectDiagnosticsResponse:
    try:
        save_project_diagnostics(ProjectDiagnosticsResponse(project_id=project_id, status="verifying"))
        project_dir = scaffold_vite_project(project_id)
        diagnostics = _verify_project_with_repair(project_id, project_dir)
        save_project_diagnostics(diagnostics)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        diagnostics = build_diagnostics_from_log(project_id, passed=False, build_log=str(exc))
        save_project_diagnostics(diagnostics)

    return diagnostics


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


def _normalize_project_sources(project_dir) -> dict[str, str]:
    before_sources = collect_project_sources(project_dir)
    normalize_react_default_imports(project_dir)
    after_sources = collect_project_sources(project_dir)
    return {
        path: content
        for path, content in after_sources.items()
        if before_sources.get(path) != content
    }


def _attach_source_changes(
    diagnostics: ProjectDiagnosticsResponse,
    before_sources: dict[str, str],
    project_dir,
    note: str = "Auto-cleaned project sources",
) -> None:
    after_sources = collect_project_sources(project_dir)
    changed_files = [
        {"path": path, "content": content}
        for path, content in sorted(after_sources.items())
        if before_sources.get(path) != content
    ]

    if not changed_files:
        return

    diagnostics.changed_files = changed_files
    if note not in diagnostics.notes:
        diagnostics.notes = [*diagnostics.notes, note]


def _verify_project_with_repair(project_id: str, project_dir) -> ProjectDiagnosticsResponse:
    before_sources = collect_project_sources(project_dir)
    last_diagnostics = ProjectDiagnosticsResponse(project_id=project_id, status="failed")

    for attempt in range(VERIFY_REPAIR_ATTEMPTS + 1):
        passed, build_log = try_build_vite_project(project_dir, project_id)
        diagnostics = build_diagnostics_from_log(project_id, passed=passed, build_log=build_log)
        _attach_source_changes(
            diagnostics,
            before_sources,
            project_dir,
            note="Source changes applied" if attempt > 0 else "Auto-cleaned project sources",
        )

        if passed:
            if attempt > 0:
                diagnostics.notes = [*diagnostics.notes, "AI repair applied", "Re-ran verify"]
            return diagnostics

        last_diagnostics = diagnostics
        if attempt >= VERIFY_REPAIR_ATTEMPTS:
            break

        try:
            repaired = _apply_verify_repair(project_id, project_dir, build_log, attempt + 1)
        except (RuntimeError, ValueError) as exc:
            logger.exception("Verify AI repair failed for project %s", project_id)
            last_diagnostics.notes = [*last_diagnostics.notes, f"AI repair failed: {exc}"]
            break
        if not repaired:
            break

    _attach_source_changes(last_diagnostics, before_sources, project_dir, note="Source changes applied")
    return last_diagnostics


def _apply_verify_repair(project_id: str, project_dir, build_log: str, attempt: int) -> bool:
    logger.info("Starting verify AI repair attempt %s for project %s", attempt, project_id)
    current_sources = collect_project_sources(project_dir)
    fix = request_project_fix(
        project_dir=project_dir,
        user_message="Repair the current draft so it passes ESLint, TypeScript, and Vite verification.",
        error_message=build_log,
        failure_stage="build",
        attempt=attempt,
        max_attempts=VERIFY_REPAIR_ATTEMPTS,
        generated_files=current_sources,
        build_log=build_log,
        tsc_hints=build_fix_hints(build_log),
    )

    changed = False
    for patch in fix.patches:
        safe_path = normalize_posix_path(patch.path)
        write_project_file(project_id, safe_path, patch.content)
        changed = True

    if fix.npm_dependencies or fix.dev_dependencies:
        install_planned_dependencies(
            project_dir,
            fix.npm_dependencies,
            collect_project_sources(project_dir),
            dev_packages=fix.dev_dependencies,
            legacy_peer_deps=fix.use_legacy_peer_deps,
        )
        changed = True

    return changed


def _run_generate_draft(project_id: str, message: str, project_dir) -> AgentState:
    state = _initial_state(message, project_id, project_dir)

    for node in (plan_project, generate_files, repair_missing_imports, sync_project):
        state = {**state, **node(state)}
        _raise_if_draft_blocked(state)

    return {
        **state,
        "reply": f"Generated {len(state.get('generated_files', {}))} draft files. Live preview updates first, and backend verification runs separately.",
    }


def _run_edit_draft(project_id: str, message: str, project_dir) -> AgentState:
    current_files = collect_project_sources(project_dir)
    edit = clean_edit_patches(request_project_edit(project_dir, message))
    generated = dict(current_files)
    for patch in edit.patches:
        safe_path = normalize_posix_path(patch.path)
        write_project_file(project_id, safe_path, patch.content)
        generated[safe_path] = patch.content

    return {
        **_initial_state(message, project_id, project_dir),
        "generated_files": generated,
        "files": sorted(generated),
        "reply": edit.notes or "Generated draft changes.",
        "warnings": edit.warnings,
    }


def _raise_if_draft_blocked(state: AgentState) -> None:
    if state.get("error"):
        raise RuntimeError(state["error"])
    if state.get("pending_error"):
        stage = state.get("failure_stage") or "draft"
        raise RuntimeError(f"Draft stopped at stage '{stage}': {state['pending_error']}")


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
        before_sources = collect_project_sources(project_dir)
        passed, build_log = try_build_vite_project(project_dir, project_id)
        diagnostics = build_diagnostics_from_log(project_id, passed=passed, build_log=build_log)
        _attach_source_changes(diagnostics, before_sources, project_dir)
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


@router.post("/{project_id}/edit/preview", response_model=ProjectEditPreviewResponse)
def post_project_edit_preview(project_id: str, body: ProjectEditPreviewRequest) -> ProjectEditPreviewResponse:
    try:
        project_dir = scaffold_vite_project(project_id, install_dependencies=False)
        current_files = collect_project_sources(project_dir)
        edit = clean_edit_patches(
            request_project_edit(
                project_dir,
                body.message,
                context_files=body.context_files,
                current_file=body.current_file,
                selected_text=body.selected_text,
                selected_range=body.selected_range,
                diagnostics_summary=body.diagnostics_summary,
            )
        )
    except (ValueError, RuntimeError) as exc:
        status = 400 if isinstance(exc, ValueError) else 500
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    previews = [
        _edit_patch_preview(patch.path, patch.content, current_files.get(normalize_posix_path(patch.path), ""))
        for patch in edit.patches
    ]
    total_diff_lines = sum(preview.diff_lines for preview in previews)
    change_size = _classify_edit_change(
        previews,
        total_diff_lines,
        npm_dependencies=[*edit.npm_dependencies, *edit.dev_dependencies],
    )

    return ProjectEditPreviewResponse(
        notes=edit.notes,
        patches=previews,
        npm_dependencies=edit.npm_dependencies,
        dev_dependencies=edit.dev_dependencies,
        warnings=edit.warnings,
        change_size=change_size,
        requires_confirmation=change_size == "large",
        total_diff_lines=total_diff_lines,
    )


@router.post("/{project_id}/edit/apply", response_model=ProjectEditApplyResponse)
def post_project_edit_apply(project_id: str, body: ProjectEditApplyRequest) -> ProjectEditApplyResponse:
    try:
        changed_files = []
        for patch in body.patches:
            safe_path = normalize_posix_path(patch.path)
            write_project_file(project_id, safe_path, patch.content)
            changed_files.append({"path": safe_path, "content": patch.content})
        project_dir = ensure_project_dir(project_id)
        normalized_files = _normalize_project_sources(project_dir)
        changed_files = [
            *changed_files,
            *[
                {"path": path, "content": content}
                for path, content in normalized_files.items()
                if path not in {file["path"] for file in changed_files}
            ],
        ]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProjectEditApplyResponse(changed_files=changed_files)


def _edit_patch_preview(path: str, content: str, previous_content: str) -> ProjectEditPatchPreview:
    safe_path = normalize_posix_path(path)
    diff = "\n".join(
        unified_diff(
            previous_content.splitlines(),
            content.splitlines(),
            fromfile=f"a/{safe_path}",
            tofile=f"b/{safe_path}",
            lineterm="",
        )
    )
    diff_lines = sum(1 for line in diff.splitlines() if line.startswith(("+", "-")) and not line.startswith(("+++", "---")))

    return ProjectEditPatchPreview(
        path=safe_path,
        content=content,
        previous_content=previous_content,
        diff=diff,
        change_type="modified" if previous_content else "added",
        diff_lines=diff_lines,
    )


def _classify_edit_change(
    previews: list[ProjectEditPatchPreview],
    total_diff_lines: int,
    *,
    npm_dependencies: list[str],
) -> str:
    if npm_dependencies:
        return "large"
    if len(previews) >= 3:
        return "large"
    if any(preview.change_type == "added" for preview in previews):
        return "large"
    if any(preview.path == "src/App.tsx" and preview.diff_lines >= 80 for preview in previews):
        return "large"
    if total_diff_lines >= 80:
        return "large"
    return "small"


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
