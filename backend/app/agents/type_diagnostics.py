import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.agents.tsc_errors import TscError, parse_tsc_errors
from app.services.dependencies import npm_spec_exists, package_registry_facts

IMPORT_NAMED = re.compile(r"import\s+\{(?P<names>[^}]+)\}\s+from\s+['\"](?P<pkg>[^'\"]+)['\"]")
IMPORT_DEFAULT = re.compile(r"import\s+(?P<name>[A-Za-z_$][\w$]*)\s+from\s+['\"](?P<pkg>[^'\"]+)['\"]")
IMPORT_NAMESPACE = re.compile(r"import\s+\*\s+as\s+(?P<name>[A-Za-z_$][\w$]*)\s+from\s+['\"](?P<pkg>[^'\"]+)['\"]")
JSX_TAG = re.compile(r"<(?P<name>[A-Z][A-Za-z0-9_.$]*)\b")
DTS_IMPORT = re.compile(r"\bfrom\s+['\"](?P<pkg>[^.'\"/][^'\"]*)['\"]")


@dataclass(frozen=True)
class PackageTypeFact:
    package: str
    installed: bool
    version: str = ""
    bundled_types: bool = False
    types_field: str = ""
    typings_field: str = ""
    registry: str = ""
    at_types_package: str = ""
    at_types_exists: bool = False
    at_types_installed: bool = False
    referenced_packages: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class TypeDiagnostic:
    error: TscError
    symbol: str = ""
    imported_from: str = ""
    package_facts: list[PackageTypeFact] = field(default_factory=list)

    @property
    def missing_type_candidates(self) -> list[str]:
        candidates: list[str] = []
        for fact in self.package_facts:
            if (
                fact.installed
                and not fact.bundled_types
                and fact.at_types_exists
                and not fact.at_types_installed
            ):
                candidates.append(fact.at_types_package)
        return candidates


def _package_root(specifier: str) -> str:
    if specifier.startswith("@"):
        parts = specifier.split("/")
        return "/".join(parts[:2])
    return specifier.split("/")[0]


def _at_types_name(package: str) -> str:
    if package.startswith("@"):
        scope, name = package[1:].split("/", 1)
        return f"@types/{scope}__{name}"
    return f"@types/{package}"


def _parse_imports(source: str) -> dict[str, str]:
    imports: dict[str, str] = {}
    for match in IMPORT_NAMED.finditer(source):
        if match.group("pkg").startswith("."):
            continue
        package = _package_root(match.group("pkg"))
        for raw in match.group("names").split(","):
            name = raw.strip()
            if not name:
                continue
            if " as " in name:
                name = name.split(" as ", 1)[1].strip()
            imports[name] = package

    for match in IMPORT_DEFAULT.finditer(source):
        if match.group("pkg").startswith("."):
            continue
        imports[match.group("name")] = _package_root(match.group("pkg"))

    for match in IMPORT_NAMESPACE.finditer(source):
        if match.group("pkg").startswith("."):
            continue
        imports[match.group("name")] = _package_root(match.group("pkg"))

    return imports


def _symbol_near_line(source: str, line_number: int, col: int) -> str:
    lines = source.splitlines()
    if 1 <= line_number <= len(lines):
        line = lines[line_number - 1]
        for segment in (line[max(0, col - 1) :], line):
            match = JSX_TAG.search(segment)
            if match:
                return match.group("name").split(".", 1)[0]

    for idx in range(min(len(lines), line_number) - 1, max(-1, line_number - 6), -1):
        match = JSX_TAG.search(lines[idx])
        if match:
            return match.group("name").split(".", 1)[0]

    end = min(len(lines), line_number + 3)
    for idx in range(line_number, end):
        match = JSX_TAG.search(lines[idx])
        if match:
            return match.group("name").split(".", 1)[0]
    return ""


def _read_package_json(project_dir: Path, package: str) -> dict:
    path = project_dir / "node_modules" / package / "package.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _bundled_type_entry(package_json: dict) -> str:
    entry = package_json.get("types") or package_json.get("typings")
    if isinstance(entry, str):
        return entry
    exports = package_json.get("exports")
    if isinstance(exports, dict):
        root_export = exports.get(".")
        if isinstance(root_export, dict):
            types = root_export.get("types")
            if isinstance(types, str):
                return types
    return ""


def _referenced_packages_from_types(project_dir: Path, package: str, package_json: dict) -> list[str]:
    entry = _bundled_type_entry(package_json)
    package_dir = project_dir / "node_modules" / package
    candidates: list[Path] = []
    if entry:
        candidates.append(package_dir / entry)
    candidates.extend((package_dir / "lib").glob("*.d.ts"))
    candidates.extend(package_dir.glob("*.d.ts"))

    referenced: list[str] = []
    for path in candidates[:20]:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for match in DTS_IMPORT.finditer(text):
            root = _package_root(match.group("pkg"))
            if root != package and root not in referenced:
                referenced.append(root)
    return referenced


def _package_fact(project_dir: Path, package: str) -> PackageTypeFact:
    package_json = _read_package_json(project_dir, package)
    at_types = _at_types_name(package)
    at_types_exists, _ = npm_spec_exists(at_types)
    at_types_installed = (project_dir / "node_modules" / at_types / "package.json").is_file()
    registry = package_registry_facts(package)

    if not package_json:
        return PackageTypeFact(
            package=package,
            installed=False,
            registry=registry,
            at_types_package=at_types,
            at_types_exists=at_types_exists,
            at_types_installed=at_types_installed,
        )

    types_field = package_json.get("types") if isinstance(package_json.get("types"), str) else ""
    typings_field = package_json.get("typings") if isinstance(package_json.get("typings"), str) else ""
    bundled = bool(_bundled_type_entry(package_json))

    return PackageTypeFact(
        package=package,
        installed=True,
        version=str(package_json.get("version", "")),
        bundled_types=bundled,
        types_field=types_field,
        typings_field=typings_field,
        registry=registry,
        at_types_package=at_types,
        at_types_exists=at_types_exists,
        at_types_installed=at_types_installed,
        referenced_packages=_referenced_packages_from_types(project_dir, package, package_json),
    )


def build_type_diagnostics(project_dir: Path, build_log: str) -> list[TypeDiagnostic]:
    diagnostics: list[TypeDiagnostic] = []
    for error in parse_tsc_errors(build_log):
        source_path = project_dir / error.file
        if not source_path.is_file():
            diagnostics.append(TypeDiagnostic(error=error))
            continue

        source = source_path.read_text(encoding="utf-8")
        imports = _parse_imports(source)
        symbol = _symbol_near_line(source, error.line, error.col)
        package = imports.get(symbol, "")

        facts: list[PackageTypeFact] = []
        if package:
            primary = _package_fact(project_dir, package)
            facts.append(primary)
            for referenced in primary.referenced_packages[:8]:
                facts.append(_package_fact(project_dir, referenced))

        diagnostics.append(
            TypeDiagnostic(
                error=error,
                symbol=symbol,
                imported_from=package,
                package_facts=facts,
            )
        )
    return diagnostics


def type_diagnostics_text(diagnostics: list[TypeDiagnostic]) -> str:
    if not diagnostics:
        return "none"

    chunks: list[str] = []
    for diagnostic in diagnostics:
        err = diagnostic.error
        chunks.append(
            f"- TS{err.code} at {err.file}:{err.line}:{err.col}: {err.message}\n"
            f"  symbol near error: {diagnostic.symbol or 'unknown'}\n"
            f"  imported package: {diagnostic.imported_from or 'unknown'}"
        )
        for fact in diagnostic.package_facts:
            chunks.append(
                f"  package fact: {fact.package}\n"
                f"    installed: {fact.installed}\n"
                f"    version: {fact.version or 'unknown'}\n"
                f"    bundled types: {fact.bundled_types}\n"
                f"    types field: {fact.types_field or fact.typings_field or 'none'}\n"
                f"    referenced packages from d.ts: {', '.join(fact.referenced_packages) or 'none'}\n"
                f"    @types candidate: {fact.at_types_package} "
                f"exists={fact.at_types_exists} installed={fact.at_types_installed}\n"
                f"    registry facts: {fact.registry or 'none'}"
            )
        candidates = diagnostic.missing_type_candidates
        if candidates:
            chunks.append(f"  missing type package candidates: {', '.join(candidates)}")
    return "\n".join(chunks)


def missing_type_candidates(diagnostics: list[TypeDiagnostic]) -> list[str]:
    candidates: list[str] = []
    for diagnostic in diagnostics:
        for candidate in diagnostic.missing_type_candidates:
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates
