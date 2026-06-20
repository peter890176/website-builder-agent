import re
from pathlib import Path, PurePosixPath

RELATIVE_IMPORT = re.compile(
    r"""(?:from|import)\s+['"](\.\.?/[^'"]+)['"]""",
    re.MULTILINE,
)
DEFAULT_ASSET_IMPORT = re.compile(
    r"""(?P<indent>\s*)import\s+(?P<name>[A-Za-z_$][\w$]*)\s+from\s+['"](?P<spec>\.\.?/[^'"]+\.(?:svg|png|jpg|jpeg|webp|gif))['"];?"""
)
CSS_ASSET_URL = re.compile(
    r"""url\((?P<quote>['"]?)(?P<spec>\.\.?/[^'")]+\.(?:svg|png|jpg|jpeg|webp|gif))(?P=quote)\)"""
)

LOCAL_EXTENSIONS = (".tsx", ".ts", ".css", ".json", ".svg")
ASSET_EXTENSIONS = (".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif")
ALLOWED_ROOTS = {"src", "public"}


def _posix_path(path: str) -> str:
    return str(PurePosixPath(path.replace("\\", "/")))


def normalize_posix_path(path: str) -> str:
    parts: list[str] = []
    for part in PurePosixPath(_posix_path(path)).parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part != ".":
            parts.append(part)
    return "/".join(parts)


def resolve_relative_import(importer_path: str, import_spec: str) -> str:
    importer = PurePosixPath(_posix_path(importer_path))
    base = importer.parent / import_spec
    return normalize_posix_path(str(base))


def is_allowed_project_path(path: str) -> bool:
    normalized = normalize_posix_path(path)
    parts = PurePosixPath(normalized).parts
    return bool(parts) and parts[0] in ALLOWED_ROOTS


def public_asset_path(path: str) -> str | None:
    normalized = normalize_posix_path(path)
    parts = PurePosixPath(normalized).parts
    if len(parts) >= 2 and parts[0] == "assets" and PurePosixPath(normalized).suffix.lower() in ASSET_EXTENSIONS:
        return f"public/{normalized}"
    return None


def normalize_generated_asset_paths(generated_files: dict[str, str]) -> dict[str, str]:
    normalized_files: dict[str, str] = {}
    for path, content in generated_files.items():
        normalized_path = normalize_posix_path(path)
        normalized_files[public_asset_path(normalized_path) or normalized_path] = content
    return normalized_files


def rewrite_public_asset_imports(generated_files: dict[str, str]) -> dict[str, str]:
    rewritten = dict(generated_files)
    for path, content in list(rewritten.items()):
        if not path.endswith((".tsx", ".ts", ".jsx", ".js", ".css")):
            continue

        def replace_default_import(match: re.Match[str]) -> str:
            spec = match.group("spec")
            resolved = resolve_relative_import(path, spec)
            public_path = public_asset_path(resolved)
            if not public_path:
                return match.group(0)
            asset_name = public_path.removeprefix("public/")
            return f"{match.group('indent')}const {match.group('name')} = `${{import.meta.env.BASE_URL}}{asset_name}`;"

        next_content = DEFAULT_ASSET_IMPORT.sub(replace_default_import, content)

        def replace_css_url(match: re.Match[str]) -> str:
            spec = match.group("spec")
            resolved = resolve_relative_import(path, spec)
            public_path = public_asset_path(resolved)
            if not public_path:
                return match.group(0)
            return f"url('/{public_path.removeprefix('public/')}')"

        if path.endswith(".css"):
            next_content = CSS_ASSET_URL.sub(replace_css_url, next_content)

        rewritten[path] = next_content
    return rewritten


def normalize_generated_files(generated_files: dict[str, str]) -> dict[str, str]:
    normalized = normalize_generated_asset_paths(generated_files)
    return rewrite_public_asset_imports(normalized)


def extract_relative_imports(content: str) -> list[str]:
    return [match.group(1) for match in RELATIVE_IMPORT.finditer(content)]


def find_missing_local_files(
    generated_files: dict[str, str],
    project_dir: Path,
) -> list[str]:
    existing = {normalize_posix_path(path) for path in generated_files.keys()}
    missing: list[str] = []

    for path, content in generated_files.items():
        if not path.endswith((".tsx", ".ts", ".css")):
            continue

        for import_spec in extract_relative_imports(content):
            if not import_spec.startswith("."):
                continue
            if not import_spec.endswith(LOCAL_EXTENSIONS):
                continue

            resolved = resolve_relative_import(path, import_spec)
            if not is_allowed_project_path(resolved):
                continue
            if resolved in existing:
                continue
            if (project_dir / resolved).is_file():
                continue
            if resolved not in missing:
                missing.append(resolved)

    return missing

