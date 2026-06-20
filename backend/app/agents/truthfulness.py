import re
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


LOCAL_ASSET_404 = re.compile(r"HTTP 404: (?P<url>https?://\S+)")
BINARY_MEDIA_EXTENSIONS = {".mp3", ".mp4", ".wav", ".ogg", ".webm", ".m4a", ".mov"}
ASSET_EXTENSIONS = BINARY_MEDIA_EXTENSIONS | {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"}


@dataclass(frozen=True)
class ProjectWarning:
    kind: str
    message: str
    path: str = ""
    url: str = ""
    referenced_by: list[str] | None = None
    fallback: str = ""

    def to_dict(self) -> dict:
        data = asdict(self)
        return {key: value for key, value in data.items() if value not in ("", None, [])}


def warning_dicts(warnings: list[ProjectWarning]) -> list[dict]:
    return [warning.to_dict() for warning in warnings]


def runtime_missing_asset_warnings(
    project_dir: Path,
    project_id: str,
    runtime_errors: list[str],
) -> list[ProjectWarning]:
    warnings: list[ProjectWarning] = []
    seen: set[str] = set()
    preview_prefix = f"/api/projects/{project_id}/preview/"

    for error in runtime_errors:
        match = LOCAL_ASSET_404.search(error)
        if not match:
            continue
        url = match.group("url")
        parsed_path = unquote(urlparse(url).path)
        if preview_prefix not in parsed_path:
            continue
        asset_path = parsed_path.split(preview_prefix, 1)[1].lstrip("/")
        suffix = Path(asset_path).suffix.lower()
        if suffix not in ASSET_EXTENSIONS:
            continue
        expected_path = f"public/{asset_path}" if asset_path.startswith("assets/") else asset_path
        if (project_dir / expected_path).is_file() or (project_dir / "dist" / asset_path).is_file():
            continue
        if expected_path in seen:
            continue
        seen.add(expected_path)
        is_media = suffix in BINARY_MEDIA_EXTENSIONS
        warnings.append(
            ProjectWarning(
                kind="missing_media_asset" if is_media else "missing_asset",
                path=expected_path,
                url=url,
                referenced_by=_referencing_files(project_dir, asset_path),
                fallback=(
                    "Website generated with a missing media warning; provide the file or replace it with a verified URL."
                    if is_media
                    else "Website generated with a missing asset warning; provide the file or update the reference."
                ),
                message=(
                    f"Referenced asset is missing: {expected_path}. "
                    "The app should surface this as unavailable content instead of assuming the file exists."
                ),
            )
        )
    return warnings


def is_degradable_missing_asset_failure(runtime_errors: list[str], warnings: list[ProjectWarning]) -> bool:
    if not runtime_errors or not warnings:
        return False
    warning_urls = {warning.url for warning in warnings}
    for error in runtime_errors:
        if error.startswith("console.error: Failed to load resource"):
            continue
        match = LOCAL_ASSET_404.search(error)
        if not match or match.group("url") not in warning_urls:
            return False
    return True


def _referencing_files(project_dir: Path, asset_path: str) -> list[str]:
    refs: list[str] = []
    filename = Path(asset_path).name
    needles = {asset_path, f"/{asset_path}", filename}
    for root_name in ("src", "public"):
        root = project_dir / root_name
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".css", ".json"}:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if any(needle in text for needle in needles):
                refs.append(path.relative_to(project_dir).as_posix())
    return refs[:10]
