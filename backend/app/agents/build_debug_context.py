import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.agents.imports import normalize_posix_path
from app.agents.tsc_errors import TscError, parse_tsc_errors


IMPORT_NAMED = re.compile(r"import\s+\{(?P<names>[^}]+)\}\s+from\s+['\"](?P<spec>[^'\"]+)['\"]")
IMPORT_DEFAULT = re.compile(r"import\s+(?P<name>[A-Za-z_$][\w$]*)\s+from\s+['\"](?P<spec>[^'\"]+)['\"]")
IMPORT_NAMESPACE = re.compile(r"import\s+\*\s+as\s+(?P<name>[A-Za-z_$][\w$]*)\s+from\s+['\"](?P<spec>[^'\"]+)['\"]")
JSX_TAG = re.compile(r"<(?P<name>[A-Z][A-Za-z0-9_.$]*)\b")
IDENTIFIER = re.compile(r"\b[A-Za-z_$][\w$]*\b")


@dataclass(frozen=True)
class ImportEvidence:
    local_name: str
    specifier: str
    package: str = ""
    is_package: bool = False


@dataclass(frozen=True)
class ErrorDebugContext:
    error: TscError
    source_excerpt: str = ""
    line_text: str = ""
    symbol_near_error: str = ""
    imports: list[ImportEvidence] = field(default_factory=list)
    relevant_imports: list[ImportEvidence] = field(default_factory=list)
    package_type_evidence: list[str] = field(default_factory=list)


def _package_root(specifier: str) -> str:
    if specifier.startswith("@"):
        parts = specifier.split("/")
        return "/".join(parts[:2])
    return specifier.split("/")[0]


def _package_spec_root(specifier: str) -> str:
    root = _package_root(specifier.strip())
    if root.startswith("@"):
        version_at = root.rfind("@")
        return root[:version_at] if version_at > 0 else root
    return root.split("@", 1)[0]


def _is_package_spec(specifier: str) -> bool:
    return not specifier.startswith(".") and not specifier.startswith("/")


def _parse_imports(source: str) -> list[ImportEvidence]:
    imports: list[ImportEvidence] = []
    for match in IMPORT_DEFAULT.finditer(source):
        specifier = match.group("spec")
        imports.append(
            ImportEvidence(
                local_name=match.group("name"),
                specifier=specifier,
                package=_package_root(specifier) if _is_package_spec(specifier) else "",
                is_package=_is_package_spec(specifier),
            )
        )

    for match in IMPORT_NAMESPACE.finditer(source):
        specifier = match.group("spec")
        imports.append(
            ImportEvidence(
                local_name=match.group("name"),
                specifier=specifier,
                package=_package_root(specifier) if _is_package_spec(specifier) else "",
                is_package=_is_package_spec(specifier),
            )
        )

    for match in IMPORT_NAMED.finditer(source):
        specifier = match.group("spec")
        package = _package_root(specifier) if _is_package_spec(specifier) else ""
        for raw in match.group("names").split(","):
            name = raw.strip()
            if not name:
                continue
            if " as " in name:
                name = name.split(" as ", 1)[1].strip()
            imports.append(
                ImportEvidence(
                    local_name=name,
                    specifier=specifier,
                    package=package,
                    is_package=bool(package),
                )
            )
    return imports


def _source_excerpt(source: str, line: int, radius: int = 12) -> tuple[str, str]:
    lines = source.splitlines()
    if not lines:
        return "", ""
    start = max(1, line - radius)
    end = min(len(lines), line + radius)
    excerpt = []
    for idx in range(start, end + 1):
        marker = ">>" if idx == line else "  "
        excerpt.append(f"{marker} {idx}: {lines[idx - 1]}")
    line_text = lines[line - 1] if 1 <= line <= len(lines) else ""
    return "\n".join(excerpt), line_text


def _symbol_near_error(source: str, error: TscError) -> str:
    lines = source.splitlines()
    if 1 <= error.line <= len(lines):
        line = lines[error.line - 1]
        for segment in (line[max(0, error.col - 1) :], line):
            match = JSX_TAG.search(segment)
            if match:
                return match.group("name").split(".", 1)[0]

    for idx in range(min(len(lines), error.line) - 1, max(-1, error.line - 8), -1):
        match = JSX_TAG.search(lines[idx])
        if match:
            return match.group("name").split(".", 1)[0]
    if 1 <= error.line <= len(lines):
        identifiers = IDENTIFIER.findall(lines[error.line - 1])
        if identifiers:
            return identifiers[0]
    return ""


def _read_package_json(project_dir: Path, package: str) -> dict:
    path = project_dir / "node_modules" / package / "package.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _type_entry_candidates(project_dir: Path, package: str, manifest: dict) -> list[Path]:
    package_dir = project_dir / "node_modules" / package
    candidates: list[Path] = []
    for key in ("types", "typings"):
        value = manifest.get(key)
        if isinstance(value, str):
            candidates.append(package_dir / value)
    exports = manifest.get("exports")
    if isinstance(exports, dict):
        root_export = exports.get(".")
        if isinstance(root_export, dict) and isinstance(root_export.get("types"), str):
            candidates.append(package_dir / root_export["types"])
    candidates.extend(package_dir.glob("*.d.ts"))
    candidates.extend((package_dir / "dist").glob("*.d.ts"))
    candidates.extend((package_dir / "types").glob("*.d.ts"))
    return list(dict.fromkeys(candidates))


def _package_type_evidence(project_dir: Path, package: str, needles: list[str]) -> list[str]:
    manifest = _read_package_json(project_dir, package)
    if not manifest:
        return [f"package {package}: not installed or package.json missing"]

    lines = [
        f"package {package}: version={manifest.get('version', 'unknown')}, "
        f"types={manifest.get('types') or manifest.get('typings') or 'none'}"
    ]

    for path in _type_entry_candidates(project_dir, package, manifest)[:12]:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        matched = False
        for needle in needles:
            if needle and needle in text:
                matched = True
                break
        if not matched and needles:
            continue
        rel = path.relative_to(project_dir).as_posix()
        snippet = _matching_snippet(text, needles)
        lines.append(f"type file {rel}:\n{snippet}")
        if len(lines) >= 4:
            break
    return lines


def _matching_snippet(text: str, needles: list[str], radius: int = 4) -> str:
    source_lines = text.splitlines()
    match_idx = 0
    for idx, line in enumerate(source_lines):
        if any(needle and needle in line for needle in needles):
            match_idx = idx
            break
    start = max(0, match_idx - radius)
    end = min(len(source_lines), match_idx + radius + 1)
    return "\n".join(source_lines[start:end])[:2500]


def build_debug_contexts(project_dir: Path, build_log: str) -> list[ErrorDebugContext]:
    contexts: list[ErrorDebugContext] = []
    for error in parse_tsc_errors(build_log):
        source_path = project_dir / error.file
        if not source_path.is_file():
            contexts.append(ErrorDebugContext(error=error))
            continue

        source = source_path.read_text(encoding="utf-8")
        imports = _parse_imports(source)
        excerpt, line_text = _source_excerpt(source, error.line)
        symbol = _symbol_near_error(source, error)
        line_identifiers = set(IDENTIFIER.findall(line_text))
        message_identifiers = set(IDENTIFIER.findall(error.message))
        relevant = [
            item
            for item in imports
            if item.local_name == symbol
            or item.local_name in line_identifiers
            or item.local_name in message_identifiers
        ]

        needles = [symbol, *list(message_identifiers)[:8]]
        package_evidence: list[str] = []
        for item in relevant:
            if item.is_package and item.package:
                package_evidence.extend(_package_type_evidence(project_dir, item.package, needles))

        contexts.append(
            ErrorDebugContext(
                error=error,
                source_excerpt=excerpt,
                line_text=line_text,
                symbol_near_error=symbol,
                imports=imports,
                relevant_imports=relevant,
                package_type_evidence=package_evidence,
            )
        )
    return contexts


def build_debug_context_text(contexts: list[ErrorDebugContext]) -> str:
    if not contexts:
        return "none"

    chunks: list[str] = []
    for context in contexts[:8]:
        err = context.error
        relevant_import_lines = [
            f"    - {item.local_name} from {item.specifier}"
            + (f" (package {item.package})" if item.package else "")
            for item in context.relevant_imports[:8]
        ] or ["    - none"]
        package_evidence_lines = [
            f"    {evidence}" for evidence in context.package_type_evidence[:6]
        ] or ["    none"]
        chunks.append(
            "\n".join(
                [
                    f"- TS{err.code} at {err.file}:{err.line}:{err.col}",
                    f"  message: {err.message}",
                    f"  symbol near error: {context.symbol_near_error or 'unknown'}",
                    f"  line text: {context.line_text or 'unavailable'}",
                    "  relevant imports:",
                    *relevant_import_lines,
                    "  source excerpt:",
                    context.source_excerpt or "unavailable",
                    "  package/type evidence:",
                    *package_evidence_lines,
                ]
            )
        )
    return "\n\n".join(chunks)


def validate_build_fix_evidence(
    project_dir: Path,
    contexts: list[ErrorDebugContext],
    before_files: dict[str, str],
    after_files: dict[str, str],
    patched_files: set[str],
    proposed_packages: list[str],
    no_progress_count: int,
) -> None:
    if no_progress_count <= 0 or not contexts:
        return

    package_roots = {_package_spec_root(spec) for spec in proposed_packages}
    shared_patch = any(path.startswith("src/data/") or "type" in path.lower() for path in patched_files)
    for context in contexts:
        err = context.error
        path = normalize_posix_path(err.file)
        relevant_packages = {item.package for item in context.relevant_imports if item.package}
        if relevant_packages.intersection(package_roots):
            continue
        if shared_patch and not relevant_packages:
            continue
        if path not in patched_files:
            raise ValueError(
                "No-progress build fix must patch every still-failing file unless the proposed "
                "package change matches that error's imported package or a shared source/data/type "
                f"file was patched. Missing failing file patch: {path}"
            )

        before = before_files.get(path)
        if before is None:
            before_path = project_dir / path
            before = before_path.read_text(encoding="utf-8") if before_path.is_file() else ""
        after = after_files.get(path, "")
        if _line_window(before, err.line) == _line_window(after, err.line):
            raise ValueError(
                "No-progress build fix patched the failing file but did not change the failing "
                f"line context for {path}:{err.line}. Inspect Build debug context and change strategy."
            )


def _line_window(source: str, line: int, radius: int = 4) -> str:
    lines = source.splitlines()
    start = max(1, line - radius)
    end = min(len(lines), line + radius)
    return "\n".join(lines[start - 1 : end])
