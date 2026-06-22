from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.api.routes.projects import _classify_edit_change, _edit_patch_preview
from app.schemas.edit_review import ProjectEditApplyRequest, ProjectEditApplyResponse
from app.schemas.quality import (
    DesignPolishRequest,
    DesignPolishResponse,
    QualityReviewResponse,
    VariantGenerateRequest,
    VariantGenerateResponse,
)
from app.services.build_fix import collect_project_sources
from app.services.project_edit import clean_edit_patches, request_project_edit
from app.services.quality_review import (
    generate_variant_summaries,
    get_quality_report,
    list_quality_reports,
    run_quality_review,
)
from app.services.workspace import ensure_project_dir, write_project_file

router = APIRouter(prefix="/api/projects/{project_id}/quality", tags=["quality"])


@router.post("/review", response_model=QualityReviewResponse)
def post_quality_review(project_id: str) -> QualityReviewResponse:
    try:
        return run_quality_review(project_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/reviews", response_model=QualityReviewResponse)
def post_quality_review_job(project_id: str) -> QualityReviewResponse:
    return post_quality_review(project_id)


@router.get("/reviews", response_model=list[QualityReviewResponse])
def get_quality_reviews(project_id: str) -> list[QualityReviewResponse]:
    return list_quality_reports(project_id)


@router.get("/reviews/{review_id}", response_model=QualityReviewResponse)
def get_quality_review_detail(project_id: str, review_id: str) -> QualityReviewResponse:
    try:
        return get_quality_report(project_id, review_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Quality review not found") from exc


@router.get("/screenshots/{filename}")
def get_quality_screenshot(project_id: str, filename: str) -> FileResponse:
    path = ensure_project_dir(project_id) / ".builder" / "screenshots" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(path, media_type="image/png")


@router.get("/screenshots/{review_id}/{filename}")
def get_quality_review_screenshot(project_id: str, review_id: str, filename: str) -> FileResponse:
    if "/" in review_id or "\\" in review_id or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid screenshot path")
    path = ensure_project_dir(project_id) / ".builder" / "screenshots" / review_id / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(path, media_type="image/png")


@router.post("/polish/preview", response_model=DesignPolishResponse)
def post_design_polish_preview(project_id: str, body: DesignPolishRequest) -> DesignPolishResponse:
    project_dir = ensure_project_dir(project_id)
    current_files = collect_project_sources(project_dir)
    edit = clean_edit_patches(
        request_project_edit(
            project_dir,
            body.focus,
            diagnostics_summary="Design polish should improve visual hierarchy, responsive behavior, SEO, and accessibility.",
        )
    )
    previews = [
        _edit_patch_preview(patch.path, patch.content, current_files.get(patch.path.replace("\\", "/"), ""))
        for patch in edit.patches
    ]
    total_diff_lines = sum(preview.diff_lines for preview in previews)
    change_size = _classify_edit_change(
        previews,
        total_diff_lines,
        npm_dependencies=[*edit.npm_dependencies, *edit.dev_dependencies],
    )
    return DesignPolishResponse(
        notes=edit.notes,
        patches=previews,
        npm_dependencies=edit.npm_dependencies,
        dev_dependencies=edit.dev_dependencies,
        warnings=edit.warnings,
        change_size=change_size,
        requires_confirmation=True,
        total_diff_lines=total_diff_lines,
    )


@router.post("/polish/apply", response_model=ProjectEditApplyResponse)
def post_design_polish_apply(project_id: str, body: ProjectEditApplyRequest) -> ProjectEditApplyResponse:
    changed_files = []
    for patch in body.patches:
        safe_path = patch.path.replace("\\", "/")
        write_project_file(project_id, safe_path, patch.content)
        changed_files.append({"path": safe_path, "content": patch.content})
    return ProjectEditApplyResponse(message="Design polish applied", changed_files=changed_files)


@router.post("/variants", response_model=VariantGenerateResponse)
def post_generate_variants(project_id: str, body: VariantGenerateRequest) -> VariantGenerateResponse:
    _ = project_id
    return VariantGenerateResponse(variants=generate_variant_summaries(body.count, body.focus))
