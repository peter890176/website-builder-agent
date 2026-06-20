import re
from dataclasses import dataclass, field
from pathlib import Path


SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}


@dataclass(frozen=True)
class RuntimeDiagnosis:
    kind: str
    required_strategy: str
    library: str = ""
    likely_files: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)


def _source_files(project_dir: Path) -> dict[str, str]:
    root = project_dir / "src"
    if not root.is_dir():
        return {}
    files: dict[str, str] = {}
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            rel = path.relative_to(project_dir).as_posix()
            files[rel] = path.read_text(encoding="utf-8")
    return files


def _files_containing(files: dict[str, str], *needles: str) -> list[str]:
    matches: list[str] = []
    for path, content in files.items():
        if all(needle in content for needle in needles):
            matches.append(path)
    return matches


def build_runtime_diagnostics(project_dir: Path, smoke_log: str) -> list[RuntimeDiagnosis]:
    log = smoke_log or ""
    files = _source_files(project_dir)
    diagnostics: list[RuntimeDiagnosis] = []

    missing_leaflet_assets = [
        asset
        for asset in ("marker-icon.png", "marker-icon-2x.png", "marker-shadow.png")
        if asset in log
    ]
    if missing_leaflet_assets:
        diagnostics.append(
            RuntimeDiagnosis(
                kind="third_party_asset_404",
                library="leaflet",
                required_strategy="configure_leaflet_marker_assets",
                likely_files=_files_containing(files, "react-leaflet") or _files_containing(files, "leaflet"),
                evidence=[
                    f"Missing Leaflet marker asset(s): {', '.join(missing_leaflet_assets)}",
                    "Leaflet default marker URLs are resolving relative to the preview root.",
                ],
            )
        )

    if "basename" in log and "useContext" in log and "null" in log:
        diagnostics.append(
            RuntimeDiagnosis(
                kind="missing_provider",
                library="react-router-dom",
                required_strategy="wrap_router_components_with_router_provider",
                likely_files=_files_containing(files, "react-router-dom"),
                evidence=[
                    "React Router component is reading router context but no Router provider is present.",
                ],
            )
        )

    for symbol in ("require", "process", "__dirname", "__filename", "Buffer"):
        if re.search(rf"\b{re.escape(symbol)}\b.*(?:is not defined|undefined)", log):
            diagnostics.append(
                RuntimeDiagnosis(
                    kind="node_api_in_browser",
                    required_strategy="replace_node_api_with_vite_browser_api",
                    likely_files=[
                        path
                        for path, content in files.items()
                        if symbol in content
                    ],
                    evidence=[f"Browser runtime reported Node-only API `{symbol}`."],
                )
            )

    asset_404s = re.findall(r"HTTP 404: (?P<url>\S+)", log)
    generic_asset_404s = [
        url
        for url in asset_404s
        if not any(asset in url for asset in ("marker-icon.png", "marker-icon-2x.png", "marker-shadow.png"))
        and "favicon" not in url.lower()
    ]
    if generic_asset_404s:
        diagnostics.append(
            RuntimeDiagnosis(
                kind="asset_404",
                required_strategy="fix_asset_reference_or_emit_asset",
                likely_files=list(files.keys()),
                evidence=[f"Missing asset URL: {url}" for url in generic_asset_404s[:5]],
            )
        )

    if "#root has no rendered children" in log or "document.body has no visible text" in log:
        diagnostics.append(
            RuntimeDiagnosis(
                kind="empty_root",
                required_strategy="fix_render_time_exception_or_visibility",
                likely_files=["src/App.tsx", "src/main.tsx"],
                evidence=["Browser smoke test found empty or invisible React root."],
            )
        )

    return diagnostics


def runtime_diagnostics_text(diagnostics: list[RuntimeDiagnosis]) -> str:
    if not diagnostics:
        return "none"

    chunks: list[str] = []
    for diagnosis in diagnostics:
        chunks.append(
            "\n".join(
                [
                    f"- kind: {diagnosis.kind}",
                    f"  library: {diagnosis.library or 'unknown'}",
                    f"  required_strategy: {diagnosis.required_strategy}",
                    f"  likely_files: {', '.join(diagnosis.likely_files) or 'unknown'}",
                    f"  evidence: {' | '.join(diagnosis.evidence) or 'none'}",
                ]
            )
        )
    return "\n".join(chunks)


def validate_runtime_fix(
    project_dir: Path,
    diagnostics: list[RuntimeDiagnosis],
    generated_files: dict[str, str],
    patched_files: set[str],
) -> None:
    if not diagnostics:
        return

    def content_for(path: str) -> str:
        if path in generated_files:
            return generated_files[path]
        file_path = project_dir / path
        if file_path.is_file():
            return file_path.read_text(encoding="utf-8")
        return ""

    for diagnosis in diagnostics:
        if diagnosis.kind == "third_party_asset_404" and diagnosis.library == "leaflet":
            candidates = diagnosis.likely_files or sorted(patched_files)
            relevant = "\n".join(content_for(path) for path in candidates)
            has_strategy = (
                "leaflet/dist/leaflet.css" in relevant
                and (
                    "L.Icon.Default.mergeOptions" in relevant
                    or "iconUrl" in relevant
                )
                and (
                    "leaflet/dist/images/marker-icon" in relevant
                    or "leaflet/dist/images/marker-shadow" in relevant
                    or "import.meta.env.BASE_URL" in relevant
                )
            )
            if not has_strategy:
                raise ValueError(
                    "Runtime diagnosis requires Leaflet marker asset configuration. "
                    "Patch the source to import Leaflet CSS/assets and configure "
                    "L.Icon.Default.mergeOptions(...) or explicit marker iconUrl; "
                    "do not change unrelated marker coordinates/data."
                )

        if diagnosis.kind == "missing_provider" and diagnosis.library == "react-router-dom":
            files_to_check = set(diagnosis.likely_files) | {"src/App.tsx", "src/main.tsx"}
            relevant = "\n".join(content_for(path) for path in files_to_check)
            if "react-router-dom" in relevant and not any(
                token in relevant for token in ("BrowserRouter", "HashRouter", "RouterProvider")
            ):
                raise ValueError(
                    "Runtime diagnosis requires React Router provider. "
                    "Wrap router components with BrowserRouter/HashRouter/RouterProvider "
                    "or remove router-only components."
                )

        if diagnosis.kind == "node_api_in_browser":
            files_to_check = diagnosis.likely_files or sorted(patched_files)
            relevant = "\n".join(content_for(path) for path in files_to_check)
            forbidden = ("require(", "process.env", "__dirname", "__filename", "Buffer.")
            if any(token in relevant for token in forbidden):
                raise ValueError(
                    "Runtime diagnosis requires removing Node-only APIs from browser source. "
                    "Use Vite ESM imports, import.meta.env, or public URLs instead."
                )
