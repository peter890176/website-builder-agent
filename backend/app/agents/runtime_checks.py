import re
from dataclasses import dataclass
from pathlib import Path


SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}
DIST_SUFFIXES = {".js", ".mjs"}

RUNTIME_HAZARDS = [
    (
        re.compile(r"\brequire\s*\("),
        "CommonJS require() is not available in the browser/Vite ESM runtime. "
        "Use ESM imports or public asset URLs based on import.meta.env.BASE_URL.",
    ),
    (
        re.compile(r"\bprocess\.env\b"),
        "process.env is a Node API. Use import.meta.env for Vite browser environment variables.",
    ),
    (
        re.compile(r"\b(__dirname|__filename)\b"),
        "__dirname/__filename are Node APIs and are not available in browser code.",
    ),
    (
        re.compile(r"\bBuffer\s*\."),
        "Buffer is a Node API. Browser code needs a browser-safe alternative or explicit polyfill.",
    ),
]

PUBLIC_RELATIVE_IMPORT = re.compile(
    r"""from\s+['"][^'"]*(?:^|/|\.\./)public/[^'"]+['"]|import\s+['"][^'"]*(?:^|/|\.\./)public/[^'"]+['"]"""
)


@dataclass(frozen=True)
class RuntimeHazard:
    path: str
    line: int
    snippet: str
    reason: str


def _scan_file(path: Path, rel: str, patterns: list[tuple[re.Pattern[str], str]]) -> list[RuntimeHazard]:
    hazards: list[RuntimeHazard] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return hazards

    for line_no, line in enumerate(text.splitlines(), start=1):
        for pattern, reason in patterns:
            if pattern.search(line):
                hazards.append(
                    RuntimeHazard(
                        path=rel,
                        line=line_no,
                        snippet=line.strip()[:220],
                        reason=reason,
                    )
                )
    return hazards


def find_browser_runtime_hazards(project_dir: Path, dist_dir: Path | None = None) -> list[RuntimeHazard]:
    hazards: list[RuntimeHazard] = []

    source_root = project_dir / "src"
    if source_root.is_dir():
        for path in source_root.rglob("*"):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                rel = path.relative_to(project_dir).as_posix()
                hazards.extend(_scan_file(path, rel, RUNTIME_HAZARDS))
                hazards.extend(
                    _scan_file(
                        path,
                        rel,
                        [
                            (
                                PUBLIC_RELATIVE_IMPORT,
                                "Files in public/ should be referenced by public URLs, not imported "
                                "through relative source paths.",
                            )
                        ],
                    )
                )

    if dist_dir and dist_dir.is_dir():
        for path in dist_dir.rglob("*"):
            if path.is_file() and path.suffix in DIST_SUFFIXES:
                try:
                    rel = path.relative_to(project_dir).as_posix()
                except ValueError:
                    rel = f"dist/{path.relative_to(dist_dir).as_posix()}"
                hazards.extend(_scan_file(path, rel, RUNTIME_HAZARDS))

    return hazards


def format_runtime_hazards(hazards: list[RuntimeHazard]) -> str:
    if not hazards:
        return ""

    lines = ["Browser runtime hazard check failed:"]
    for hazard in hazards[:20]:
        lines.append(
            f"- {hazard.path}:{hazard.line}: {hazard.reason}\n"
            f"  snippet: {hazard.snippet}"
        )
    if len(hazards) > 20:
        lines.append(f"- ...and {len(hazards) - 20} more hazard(s)")
    return "\n".join(lines)
