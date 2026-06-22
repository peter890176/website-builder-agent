import base64
import uuid
from datetime import UTC, datetime

import requests

from app.core.config import (
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN,
    GITHUB_TOKEN,
    NETLIFY_TOKEN,
    VERCEL_TOKEN,
)
from app.schemas.deploy import DeploymentRecord, GitHubExportRequest
from app.services.build import build_vite_project
from app.services.export import create_project_zip, save_deployment
from app.services.jobs import append_job_artifact, append_job_log, create_job, update_job
from app.services.workspace import ensure_project_dir, get_dist_dir


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _record(project_id: str, record: DeploymentRecord) -> DeploymentRecord:
    save_deployment(project_id, record.model_dump())
    return record


def _require_token(token: str, name: str) -> None:
    if not token:
        raise RuntimeError(f"{name} is not configured")


def _project_files(project_id: str) -> dict[str, bytes]:
    project_dir = ensure_project_dir(project_id)
    files: dict[str, bytes] = {}
    for path in project_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(project_dir)
        if any(part in {"node_modules", "dist", ".git", ".builder"} for part in relative.parts):
            continue
        files[relative.as_posix()] = path.read_bytes()
    return files


def export_to_github(project_id: str, body: GitHubExportRequest) -> tuple[DeploymentRecord, str | None]:
    job = create_job(project_id, "deployment", title=f"GitHub export {body.owner}/{body.repo}")
    try:
        append_job_log(project_id, job.id, "Checking GITHUB_TOKEN")
        _require_token(GITHUB_TOKEN, "GITHUB_TOKEN")
        update_job(project_id, job.id, status="running", progress=10)
    except RuntimeError as exc:
        append_job_log(project_id, job.id, str(exc), level="error")
        update_job(project_id, job.id, status="failed", progress=100, error=str(exc))
        raise
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    repo_full_name = f"{body.owner}/{body.repo}"
    if body.create_repo:
        append_job_log(project_id, job.id, "Creating or checking GitHub repository")
        response = requests.post(
            "https://api.github.com/user/repos",
            headers=headers,
            json={"name": body.repo, "private": body.private},
            timeout=60,
        )
        if response.status_code not in {201, 422}:
            raise RuntimeError(response.text)

    files = _project_files(project_id)
    for index, (path, content) in enumerate(files.items()):
        update_job(project_id, job.id, progress=10 + int((index / max(len(files), 1)) * 80))
        url = f"https://api.github.com/repos/{repo_full_name}/contents/{path}"
        current = requests.get(url, headers=headers, params={"ref": body.branch}, timeout=60)
        payload = {
            "message": body.commit_message,
            "content": base64.b64encode(content).decode("ascii"),
            "branch": body.branch,
        }
        if current.status_code == 200:
            payload["sha"] = current.json().get("sha")
        put = requests.put(url, headers=headers, json=payload, timeout=60)
        if put.status_code not in {200, 201}:
            raise RuntimeError(put.text)

    repo_url = f"https://github.com/{repo_full_name}"
    record = _record(
        project_id,
        DeploymentRecord(
            id=uuid.uuid4().hex[:12],
            provider="github",
            status="ready",
            url=repo_url,
            message=f"Exported to {repo_full_name}",
            updated_at=_now(),
        ),
    )
    append_job_artifact(
        project_id,
        job.id,
        artifact_type="repository",
        name=repo_full_name,
        url=repo_url,
        metadata={"deployment_id": record.id},
    )
    append_job_log(project_id, job.id, f"Exported to {repo_url}")
    update_job(project_id, job.id, status="succeeded", progress=100)
    return record, repo_url


def deploy_project(project_id: str, provider: str, *, site_name: str = "", project_name: str = "") -> DeploymentRecord:
    job = create_job(project_id, "deployment", title=f"Deploy to {provider}")
    try:
        append_job_log(project_id, job.id, "Running production build before deploy")
        update_job(project_id, job.id, status="running", progress=15)
        build_vite_project(ensure_project_dir(project_id), project_id)
        update_job(project_id, job.id, progress=35)
        if provider == "vercel":
            record = _deploy_vercel(project_id, project_name or f"website-builder-{project_id}")
        elif provider == "netlify":
            record = _deploy_netlify(project_id, site_name)
        elif provider == "cloudflare":
            record = _deploy_cloudflare(project_id, project_name or f"website-builder-{project_id}")
        else:
            raise RuntimeError(f"Unsupported provider: {provider}")
        append_job_artifact(
            project_id,
            job.id,
            artifact_type="deployment_url",
            name=f"{provider} deployment",
            url=record.url,
            metadata={"deployment_id": record.id, "provider": provider},
        )
        append_job_log(project_id, job.id, record.message)
        update_job(project_id, job.id, status="succeeded", progress=100)
        return record
    except RuntimeError as exc:
        append_job_log(project_id, job.id, str(exc), level="error")
        update_job(project_id, job.id, status="failed", progress=100, error=str(exc))
        raise


def _dist_files(project_id: str) -> list[dict[str, str]]:
    dist_dir = get_dist_dir(project_id)
    files = []
    for path in dist_dir.rglob("*"):
        if path.is_file():
            files.append({
                "file": path.relative_to(dist_dir).as_posix(),
                "data": base64.b64encode(path.read_bytes()).decode("ascii"),
                "encoding": "base64",
            })
    return files


def _deploy_vercel(project_id: str, project_name: str) -> DeploymentRecord:
    _require_token(VERCEL_TOKEN, "VERCEL_TOKEN")
    response = requests.post(
        "https://api.vercel.com/v13/deployments",
        headers={"Authorization": f"Bearer {VERCEL_TOKEN}"},
        json={"name": project_name, "files": _dist_files(project_id), "projectSettings": {"framework": None}},
        timeout=120,
    )
    if response.status_code not in {200, 201}:
        raise RuntimeError(response.text)
    data = response.json()
    url = data.get("url")
    return _record(
        project_id,
        DeploymentRecord(
            id=data.get("id", uuid.uuid4().hex[:12]),
            provider="vercel",
            status="ready",
            url=f"https://{url}" if url and not url.startswith("http") else url,
            message="Vercel deployment created",
            updated_at=_now(),
        ),
    )


def _deploy_netlify(project_id: str, site_name: str) -> DeploymentRecord:
    _require_token(NETLIFY_TOKEN, "NETLIFY_TOKEN")
    zip_path = create_project_zip(project_id, build_output=True)
    site_id = site_name.strip()
    if not site_id:
        site_response = requests.post(
            "https://api.netlify.com/api/v1/sites",
            headers={"Authorization": f"Bearer {NETLIFY_TOKEN}"},
            json={"name": f"website-builder-{project_id}"},
            timeout=60,
        )
        if site_response.status_code not in {200, 201}:
            raise RuntimeError(site_response.text)
        site_id = site_response.json()["id"]

    deploy = requests.post(
        f"https://api.netlify.com/api/v1/sites/{site_id}/deploys",
        headers={"Authorization": f"Bearer {NETLIFY_TOKEN}", "Content-Type": "application/zip"},
        data=zip_path.read_bytes(),
        timeout=120,
    )
    if deploy.status_code not in {200, 201}:
        raise RuntimeError(deploy.text)
    data = deploy.json()
    return _record(
        project_id,
        DeploymentRecord(
            id=data.get("id", uuid.uuid4().hex[:12]),
            provider="netlify",
            status="ready",
            url=data.get("deploy_ssl_url") or data.get("ssl_url") or data.get("url"),
            message="Netlify deployment created",
            updated_at=_now(),
        ),
    )


def _deploy_cloudflare(project_id: str, project_name: str) -> DeploymentRecord:
    _require_token(CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN")
    _require_token(CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID")
    zip_path = create_project_zip(project_id, build_output=True)
    response = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/pages/projects/{project_name}/deployments",
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
        files={"file": (zip_path.name, zip_path.read_bytes(), "application/zip")},
        timeout=120,
    )
    if response.status_code not in {200, 201}:
        raise RuntimeError(response.text)
    data = response.json().get("result", {})
    return _record(
        project_id,
        DeploymentRecord(
            id=data.get("id", uuid.uuid4().hex[:12]),
            provider="cloudflare",
            status="ready",
            url=data.get("url"),
            message="Cloudflare Pages deployment created",
            updated_at=_now(),
        ),
    )
