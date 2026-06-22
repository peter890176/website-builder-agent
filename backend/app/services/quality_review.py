import json
import uuid
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.core.config import APP_BASE_URL, PLAYWRIGHT_BROWSERS_PATH
from app.core.config import OPENAI_FIX_MODEL, get_openai_api_key
from app.schemas.quality import QualityIssue, QualityReviewResponse, VariantSummary
from app.services.build import build_vite_project
from app.services.build_fix import collect_project_sources
from app.services.jobs import append_job_artifact, append_job_log, create_job, update_job
from app.services.runtime_smoke import run_runtime_smoke_test
from app.services.workspace import ensure_project_dir

BUILDER_DIR = ".builder"
QUALITY_DIR = "quality"


def run_quality_review(project_id: str) -> QualityReviewResponse:
    job = create_job(project_id, "quality_review", title="Quality review")
    project_dir = ensure_project_dir(project_id)
    review_id = uuid.uuid4().hex[:12]
    append_job_log(project_id, job.id, "Running production build")
    update_job(project_id, job.id, status="running", progress=10)
    build_vite_project(project_dir, project_id)
    update_job(project_id, job.id, progress=30)
    append_job_log(project_id, job.id, "Running static SEO/a11y/RWD checks")
    issues = _static_quality_issues(project_dir)
    update_job(project_id, job.id, progress=45)
    append_job_log(project_id, job.id, "Running runtime smoke test")
    runtime = run_runtime_smoke_test(project_id, base_url=APP_BASE_URL, timeout_ms=10000)
    if not runtime.ok:
        issues.extend(QualityIssue(category="runtime", severity="error", message=error) for error in runtime.errors)

    update_job(project_id, job.id, progress=65)
    append_job_log(project_id, job.id, "Capturing screenshots")
    screenshots = _capture_screenshots(project_id, review_id)
    score = max(0, 100 - sum(20 if issue.severity == "error" else 8 for issue in issues))
    update_job(project_id, job.id, progress=80)
    ai_notes = _ai_quality_notes(project_dir, issues)
    report = QualityReviewResponse(
        id=review_id,
        project_id=project_id,
        score=score,
        issues=issues,
        screenshots=screenshots,
        notes=[runtime.log, *ai_notes],
    )
    save_quality_report(project_id, report)
    append_job_artifact(
        project_id,
        job.id,
        artifact_type="quality_report",
        name=f"Quality report {report.id}",
        path=str(_report_path(project_id, report.id)),
        metadata={"review_id": report.id, "score": report.score},
    )
    for screenshot in screenshots:
        append_job_artifact(
            project_id,
            job.id,
            artifact_type="screenshot",
            name=screenshot.rsplit("/", 1)[-1],
            url=screenshot,
            metadata={"review_id": report.id},
        )
    update_job(project_id, job.id, status="succeeded", progress=100)
    append_job_log(project_id, job.id, "Quality review completed")
    return report


def quality_dir(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR / QUALITY_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _report_path(project_id: str, review_id: str) -> Path:
    return quality_dir(project_id) / f"{review_id}.json"


def save_quality_report(project_id: str, report: QualityReviewResponse) -> None:
    _report_path(project_id, report.id).write_text(report.model_dump_json(indent=2), encoding="utf-8")


def list_quality_reports(project_id: str) -> list[QualityReviewResponse]:
    reports: list[QualityReviewResponse] = []
    for path in quality_dir(project_id).glob("*.json"):
        try:
            reports.append(QualityReviewResponse.model_validate_json(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
    return sorted(reports, key=lambda item: item.created_at, reverse=True)


def get_quality_report(project_id: str, review_id: str) -> QualityReviewResponse:
    path = _report_path(project_id, review_id)
    if not path.is_file():
        raise FileNotFoundError(review_id)
    return QualityReviewResponse.model_validate_json(path.read_text(encoding="utf-8"))


def _static_quality_issues(project_dir: Path) -> list[QualityIssue]:
    sources = collect_project_sources(project_dir)
    app_text = "\n".join(sources.values()).lower()
    issues: list[QualityIssue] = []

    if "<title" not in app_text and "document.title" not in app_text:
        issues.append(QualityIssue(category="seo", message="No explicit page title was found in generated sources."))
    if "meta name=\"description\"" not in app_text and "description" not in app_text:
        issues.append(QualityIssue(category="seo", severity="info", message="No clear SEO description metadata was found."))
    if "<img" in app_text and "alt=" not in app_text:
        issues.append(QualityIssue(category="accessibility", message="Images are present but no alt text was detected."))
    if "aria-label" not in app_text and "<button" in app_text:
        issues.append(QualityIssue(category="accessibility", severity="info", message="Buttons exist; consider aria-labels for icon-only buttons."))
    if "@media" not in app_text and "grid-template-columns" not in app_text and "minmax(" not in app_text:
        issues.append(QualityIssue(category="responsive", message="No obvious responsive CSS strategy was detected."))
    if "to be provided" in app_text or "needs confirmation" in app_text:
        issues.append(QualityIssue(category="design", severity="info", message="Placeholder content remains and should be replaced before production."))

    return issues


def _capture_screenshots(project_id: str, review_id: str) -> list[str]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []

    screenshot_dir = ensure_project_dir(project_id) / ".builder" / "screenshots" / review_id
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    url = f"{APP_BASE_URL.rstrip('/')}/api/projects/{project_id}/preview/"
    screenshots: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            for width, height, name in ((390, 844, "mobile"), (1440, 1000, "desktop")):
                page = browser.new_page(viewport={"width": width, "height": height})
                page.goto(url, wait_until="networkidle", timeout=10000)
                path = screenshot_dir / f"{name}.png"
                page.screenshot(path=str(path), full_page=True)
                screenshots.append(f"/api/projects/{project_id}/quality/screenshots/{review_id}/{path.name}")
                page.close()
            browser.close()
    except Exception:
        return screenshots
    return screenshots


def _ai_quality_notes(project_dir: Path, issues: list[QualityIssue]) -> list[str]:
    api_key = get_openai_api_key()
    if not api_key:
        return ["AI quality review skipped: OPENAI_API_KEY is not configured."]
    sources = collect_project_sources(project_dir)
    source_summary = "\n\n".join(f"### {path}\n{content[:2500]}" for path, content in sorted(sources.items())[:8])
    issue_summary = "\n".join(f"- {issue.category}/{issue.severity}: {issue.message}" for issue in issues) or "none"
    llm = ChatOpenAI(model=OPENAI_FIX_MODEL, api_key=api_key, temperature=0.2)
    result = llm.invoke(
        [
            SystemMessage(content="You are a senior web quality reviewer. Return concise, actionable product-quality notes."),
            HumanMessage(
                content=(
                    f"Detected issues:\n{issue_summary}\n\n"
                    f"Representative source files:\n{source_summary}\n\n"
                    "Give 3-6 concrete quality improvement notes. Mention visual hierarchy, accessibility, SEO, and responsive risks when relevant."
                )
            ),
        ]
    )
    content = str(result.content)
    return [line.strip("- ").strip() for line in content.splitlines() if line.strip()][:8]


def generate_variant_summaries(count: int, focus: str) -> list[VariantSummary]:
    return [
        VariantSummary(
            id=uuid.uuid4().hex[:8],
            title=f"Variant {index + 1}",
            description=f"{focus} Direction {index + 1}: adjust visual hierarchy, spacing, and CTA emphasis.",
            preview_notes="Use AI Edit Composer or Design Polish to materialize this direction as a diff.",
        )
        for index in range(count)
    ]
