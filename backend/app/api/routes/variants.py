from fastapi import APIRouter, HTTPException

from app.schemas.variants import (
    ProjectVariant,
    VariantApplyResponse,
    VariantGenerateJobRequest,
    VariantListResponse,
)
from app.services.variants import apply_variant, delete_variant, generate_variants, list_variants

router = APIRouter(prefix="/api/projects/{project_id}/variants", tags=["variants"])


@router.post("/generate", response_model=VariantListResponse)
def post_generate_variants(project_id: str, body: VariantGenerateJobRequest) -> VariantListResponse:
    try:
        return VariantListResponse(variants=generate_variants(project_id, count=body.count, focus=body.focus))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=VariantListResponse)
def get_variants(project_id: str) -> VariantListResponse:
    return VariantListResponse(variants=list_variants(project_id))


@router.post("/{variant_id}/apply", response_model=VariantApplyResponse)
def post_apply_variant(project_id: str, variant_id: str) -> VariantApplyResponse:
    try:
        return VariantApplyResponse(changed_files=apply_variant(project_id, variant_id))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Variant not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{variant_id}", response_model=ProjectVariant)
def delete_project_variant(project_id: str, variant_id: str) -> ProjectVariant:
    variant = next((item for item in list_variants(project_id) if item.id == variant_id), None)
    if variant is None:
        raise HTTPException(status_code=404, detail="Variant not found")
    delete_variant(project_id, variant_id)
    return variant
