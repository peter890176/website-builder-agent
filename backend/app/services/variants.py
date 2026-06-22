import json
import shutil
import uuid
from pathlib import Path

from app.schemas.variants import ProjectVariant
from app.services.build import try_build_vite_project
from app.services.build_fix import collect_project_sources
from app.services.jobs import append_job_artifact, append_job_log, create_job, update_job
from app.services.project_edit import clean_edit_patches, request_project_edit
from app.services.quality_review import _static_quality_issues
from app.services.workspace import ensure_project_dir, write_project_file

BUILDER_DIR = ".builder"
VARIANTS_DIR = "variants"

VARIANT_DIRECTIONS = [
    {
        "title": "Editorial Minimal",
        "brief": (
            "Use an editorial / magazine-inspired composition: strong typography, asymmetric hero layout, "
            "large whitespace, refined section rhythm, and content-forward cards."
        ),
    },
    {
        "title": "Product Dashboard",
        "brief": (
            "Use a SaaS/product-style composition: clear feature hierarchy, metric/stat blocks, structured cards, "
            "crisp containers, and a more systematic product landing page feel."
        ),
    },
    {
        "title": "Premium Contrast",
        "brief": (
            "Use a premium high-contrast direction: darker surfaces or strong monochrome contrast, elevated cards, "
            "bold CTA treatment, and a more luxurious visual hierarchy."
        ),
    },
    {
        "title": "Warm Directory",
        "brief": (
            "Use a friendly browsing/catalog direction: approachable spacing, clear category navigation, "
            "search-oriented cards, and a warmer content discovery feel."
        ),
    },
]


def _variants_dir(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR / VARIANTS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _variant_path(project_id: str, variant_id: str) -> Path:
    return _variants_dir(project_id) / f"{variant_id}.json"


def list_variants(project_id: str) -> list[ProjectVariant]:
    variants: list[ProjectVariant] = []
    for path in _variants_dir(project_id).glob("*.json"):
        try:
            variants.append(ProjectVariant.model_validate_json(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
    return sorted(variants, key=lambda item: item.created_at, reverse=True)


def save_variant(project_id: str, variant: ProjectVariant) -> ProjectVariant:
    _variant_path(project_id, variant.id).write_text(variant.model_dump_json(indent=2), encoding="utf-8")
    return variant


def get_variant(project_id: str, variant_id: str) -> ProjectVariant:
    path = _variant_path(project_id, variant_id)
    if not path.is_file():
        raise FileNotFoundError(variant_id)
    return ProjectVariant.model_validate_json(path.read_text(encoding="utf-8"))


def delete_variant(project_id: str, variant_id: str) -> None:
    _variant_path(project_id, variant_id).unlink(missing_ok=False)


def generate_variants(project_id: str, *, count: int, focus: str) -> list[ProjectVariant]:
    project_dir = ensure_project_dir(project_id)
    job = create_job(project_id, "variant_generation", title="Generate design variants")
    append_job_log(project_id, job.id, f"Generating {count} variants")
    variants: list[ProjectVariant] = []

    for index in range(count):
        if job.cancel_requested:
            update_job(project_id, job.id, status="cancelled", progress=100)
            break

        variant_id = uuid.uuid4().hex[:10]
        direction = VARIANT_DIRECTIONS[index % len(VARIANT_DIRECTIONS)]
        title = f"Variant {index + 1}: {direction['title']}"
        prompt = (
            f"{focus}\n\n"
            f"Create a distinct design direction named {title}.\n"
            f"Design direction: {direction['brief']}\n\n"
            "This variant must be meaningfully different from the other generated variants. "
            "Do not only tweak focus styles, skip links, or global spacing. "
            "Change the visible layout strategy, hero composition, card treatment, section rhythm, "
            "and visual hierarchy while preserving truthful content and app behavior.\n\n"
            "Return full-file patches only for files that need to change. "
            "Do not invent facts, external assets, customer names, prices, or claims."
        )
        update_job(project_id, job.id, status="running", progress=int((index / max(count, 1)) * 80))
        append_job_log(project_id, job.id, f"Requesting AI patches for {title}")

        try:
            edit = clean_edit_patches(request_project_edit(project_dir, prompt))
            patches = [{"path": patch.path.replace("\\", "/"), "content": patch.content} for patch in edit.patches]
            build_log, score, issues = _build_variant_in_isolation(project_id, variant_id, patches)
            status = "ready" if "Build succeeded" in build_log else "failed"
            variant = ProjectVariant(
                id=variant_id,
                title=title,
                description=edit.notes or prompt,
                status=status,
                patches=patches,
                diff_summary=f"{len(patches)} files changed",
                quality_score=score,
                issues=issues,
                build_log=build_log,
                job_id=job.id,
            )
        except Exception as exc:
            variant = ProjectVariant(
                id=variant_id,
                title=title,
                description=prompt,
                status="failed",
                build_log=str(exc),
                job_id=job.id,
            )
            append_job_log(project_id, job.id, f"{title} failed: {exc}", level="error")

        save_variant(project_id, variant)
        append_job_artifact(
            project_id,
            job.id,
            artifact_type="variant",
            name=variant.title,
            path=str(_variant_path(project_id, variant.id)),
            metadata={"variant_id": variant.id, "status": variant.status, "quality_score": variant.quality_score},
        )
        variants.append(variant)

    update_job(project_id, job.id, status="succeeded", progress=100)
    append_job_log(project_id, job.id, "Variant generation completed")
    return variants


def _build_variant_in_isolation(
    project_id: str,
    variant_id: str,
    patches: list[dict[str, str]],
) -> tuple[str, int, list]:
    project_dir = ensure_project_dir(project_id)
    isolated_dir = _variants_dir(project_id) / f"build-{variant_id}"
    if isolated_dir.exists():
        shutil.rmtree(isolated_dir)
    ignore = shutil.ignore_patterns("node_modules", "dist", ".git", ".builder")
    shutil.copytree(project_dir, isolated_dir, ignore=ignore)

    for patch in patches:
        target = isolated_dir / patch["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(patch["content"], encoding="utf-8")

    passed, build_log = try_build_vite_project(isolated_dir, project_id)
    issues = _static_quality_issues(isolated_dir)
    score = max(0, 100 - sum(20 if issue.severity == "error" else 8 for issue in issues))
    return ("Build succeeded" if passed else build_log), score, issues


def apply_variant(project_id: str, variant_id: str) -> list[dict[str, str]]:
    variant = get_variant(project_id, variant_id)
    if variant.status != "ready":
        raise RuntimeError("Only ready variants can be applied")
    changed_files: list[dict[str, str]] = []
    for patch in variant.patches:
        write_project_file(project_id, patch.path, patch.content)
        changed_files.append({"path": patch.path, "content": patch.content})
    return changed_files
