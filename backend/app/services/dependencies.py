import json

import logging

import os

import re

import subprocess

from pathlib import Path



from app.services.scaffold import _get_install_lock, _run_npm



logger = logging.getLogger(__name__)



IMPORT_PATTERN = re.compile(

    r"""(?:import\s+[^'"]+from\s+|import\s+)['"]([^'"]+)['"]""",

    re.MULTILINE,

)



PACKAGE_NAME_PATTERN = re.compile(

    r"^(@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$",

    re.IGNORECASE,

)



NPM_VIEW_TIMEOUT_SECONDS = 30



def _npm_command() -> str:

    return "npm.cmd" if os.name == "nt" else "npm"





def _package_root_name(package: str) -> str:

    pkg = package.strip()

    if pkg.startswith("@"):

        version_at = pkg.rfind("@")

        if version_at > 0:

            return pkg[:version_at]

        return pkg

    if "@" in pkg:

        return pkg.split("@", 1)[0]

    return pkg





def _has_version_specifier(package: str) -> bool:

    if package.startswith("@"):

        return package.rfind("@") > 0

    return "@" in package





def merge_package_specs(*package_lists: list[str]) -> list[str]:

    by_root: dict[str, str] = {}

    for packages in package_lists:

        for pkg in packages:

            pkg = pkg.strip()

            if not pkg:

                continue

            root = _package_root_name(pkg)

            existing = by_root.get(root)

            if existing is None:

                by_root[root] = pkg

            elif _has_version_specifier(pkg):

                by_root[root] = pkg

    return list(by_root.values())





def _package_root(specifier: str) -> str | None:

    if specifier.startswith(".") or specifier.startswith("/"):

        return None

    if specifier.startswith("@"):

        parts = specifier.split("/")

        return "/".join(parts[:2]) if len(parts) >= 2 else None

    return specifier.split("/")[0]





def _validate_package_name(package: str) -> None:

    if not PACKAGE_NAME_PATTERN.match(package):

        raise RuntimeError(f"Invalid npm package name: {package}")





def _npm_view(spec: str, field: str) -> tuple[bool, str]:

    try:

        result = subprocess.run(

            [_npm_command(), "view", spec, field, "--json"],

            capture_output=True,

            text=True,

            check=False,

            timeout=NPM_VIEW_TIMEOUT_SECONDS,

        )

    except subprocess.TimeoutExpired:

        return False, f"Timed out checking npm field {field} for {spec}"



    if result.returncode != 0:

        detail = (result.stderr or result.stdout or "unknown npm error").strip()

        return False, detail

    return True, (result.stdout or "").strip()





def npm_spec_exists(spec: str) -> tuple[bool, str]:

    return _npm_view(spec, "version")


def package_registry_facts(spec: str) -> str:
    fields = ("version", "types", "typings", "dependencies", "peerDependencies")
    lines: list[str] = []
    for field in fields:
        ok, value = _npm_view(spec, field)
        if ok and value and value not in ("", "null", "{}"):
            lines.append(f"{field}: {value}")
    return "\n".join(lines) if lines else "none"


def _at_types_target(package: str) -> str | None:
    root = _package_root_name(package)
    if not root.startswith("@types/"):
        return None
    name = root.removeprefix("@types/")
    if "__" in name:
        scope, scoped_name = name.split("__", 1)
        return f"@{scope}/{scoped_name}"
    return name


def _package_json(project_dir: Path, package: str) -> dict:
    path = project_dir / "node_modules" / package / "package.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _has_bundled_types(package_json: dict) -> bool:
    if isinstance(package_json.get("types"), str) or isinstance(package_json.get("typings"), str):
        return True
    exports = package_json.get("exports")
    if isinstance(exports, dict):
        root_export = exports.get(".")
        if isinstance(root_export, dict) and isinstance(root_export.get("types"), str):
            return True
    return False


def validate_package_specs(
    project_dir: Path,
    *,
    runtime_specs: list[str],
    dev_specs: list[str],
    failed_specs: list[str] | None = None,
) -> None:
    """Reject invalid fixer package proposals before they consume npm install attempts."""
    failed = set(failed_specs or [])
    for spec in merge_package_specs(runtime_specs, dev_specs):
        if spec in failed:
            raise RuntimeError(f"Proposed npm spec was already marked failed; do not retry: {spec}")

        root = _package_root_name(spec)
        _validate_package_name(root)

        exists, detail = npm_spec_exists(spec)
        if not exists:
            registry = npm_registry_context(detail, [root])
            raise RuntimeError(
                f"Proposed npm spec does not exist: {spec}\n"
                f"{detail}\n\nnpm registry context:\n{registry}"
            )

        target = _at_types_target(spec)
        if target:
            target_manifest = _package_json(project_dir, target)
            if target_manifest and _has_bundled_types(target_manifest):
                raise RuntimeError(
                    f"Do not install {spec}: installed package {target} already ships TypeScript types. "
                    "Fix source code or install missing types for referenced packages instead."
                )





def npm_registry_context(error_message: str, specs: list[str] | None = None) -> str:

    """Query npm registry for facts the agent can use to pick compatible packages."""

    roots: list[str] = []

    for spec in specs or []:

        root = _package_root_name(spec)

        if root and root not in roots:

            roots.append(root)



    for match in re.finditer(
        r"(?:node_modules[/\\]|Could not resolve dependency:\s*\n\s*)"
        r"(@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)",
        error_message,
        re.IGNORECASE,
    ):
        root = _package_root_name(match.group(1))
        if root and root not in roots and PACKAGE_NAME_PATTERN.match(root):
            roots.append(root)



    lines: list[str] = []

    for root in roots[:8]:

        exists, version_or_err = _npm_view(root, "version")

        if not exists:

            lines.append(f"- {root}: NOT FOUND on npm ({version_or_err})")

            continue

        lines.append(f"- {root}: latest version {version_or_err}")

        ok, peers = _npm_view(root, "peerDependencies")

        if ok and peers and peers not in ("", "null", "{}"):

            lines.append(f"  peerDependencies: {peers}")



    return "\n".join(lines) if lines else "none"





def detect_imported_packages(generated_files: dict[str, str]) -> list[str]:

    found: set[str] = set()

    for path, content in generated_files.items():

        if not path.endswith((".tsx", ".ts", ".jsx", ".js")):

            continue

        for match in IMPORT_PATTERN.finditer(content):

            root = _package_root(match.group(1))

            if root:

                found.add(root)

    return sorted(found)





def install_planned_dependencies(

    project_dir: Path,

    packages: list[str],

    generated_files: dict[str, str] | None = None,

    *,

    legacy_peer_deps: bool = False,

    failed_specs: list[str] | None = None,

    dev_packages: list[str] | None = None,

) -> list[str]:

    detected: list[str] = []

    if generated_files:

        detected = detect_imported_packages(generated_files)



    package_json_path = project_dir / "package.json"

    if not package_json_path.is_file():

        raise RuntimeError("package.json not found")



    requested = merge_package_specs(packages, detected)
    requested_dev = merge_package_specs(dev_packages or [])

    if not requested and not requested_dev:

        return []



    package_json = json.loads(package_json_path.read_text(encoding="utf-8"))

    existing = set(package_json.get("dependencies", {}).keys())
    existing_dev = set(package_json.get("devDependencies", {}).keys())

    def collect_missing(requested_specs: list[str], existing_names: set[str]) -> tuple[list[str], list[str]]:
        to_install: list[str] = []
        installed_names: list[str] = []

        for pkg in requested_specs:

            root = _package_root_name(pkg)

            if root in existing or root in existing_dev or root in existing_names:

                continue

            _validate_package_name(root)

            exists, detail = npm_spec_exists(pkg)

            if not exists:

                registry = npm_registry_context(detail, [pkg])

                hint = f"npm package not found: {pkg}"

                if failed_specs:

                    hint += f"\nDo not retry these failed specs: {', '.join(failed_specs)}"

                raise RuntimeError(f"{hint}\n{detail}\n\nnpm registry context:\n{registry}")

            to_install.append(pkg)

            installed_names.append(root)

        return to_install, installed_names

    to_install, installed_names = collect_missing(requested, existing)
    dev_to_install, dev_installed_names = collect_missing(requested_dev, existing_dev)



    if not to_install and not dev_to_install:

        logger.info("All required npm packages already installed")

        return []



    logger.info("Installing npm packages: %s", ", ".join([*to_install, *dev_to_install]))

    with _get_install_lock(project_dir.name):
        for specs, save_flag in ((to_install, ""), (dev_to_install, "--save-dev")):
            if not specs:
                continue
            install_args = ["install", *specs, "--no-fund", "--no-audit"]
            if save_flag:
                install_args.append(save_flag)
            if legacy_peer_deps:

                install_args.append("--legacy-peer-deps")

            try:
                _run_npm(install_args, project_dir)
            except RuntimeError as exc:
                registry = npm_registry_context(str(exc), specs)
                failed_hint = ""
                if failed_specs:
                    failed_hint = f"\nDo not retry these failed specs: {', '.join(failed_specs)}"
                raise RuntimeError(
                    f"{exc}{failed_hint}\n\nnpm registry context:\n{registry}"
                ) from exc
    return [*installed_names, *dev_installed_names]


