import json
import logging
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.core.config import MAX_BUILD_FIX_ATTEMPTS, OPENAI_FIX_MODEL, get_openai_api_key
from app.schemas.build_fix import BuildFixResult
from app.services.dependencies import merge_package_specs, npm_registry_context

logger = logging.getLogger(__name__)

SOURCE_SUFFIXES = {".tsx", ".ts", ".css", ".json", ".svg"}

FIX_SYSTEM_PROMPT = """You fix Vite + React + TypeScript website projects.

Always read package.json and the TypeScript error hints.

When fixing npm/dependency errors:
- Use npm registry context and compare peerDependencies with the React version in package.json.
- Never invent package names or versions.
- Do not repeat failed npm specs.
- Prefer compatible package versions over upgrading React unless the user explicitly needs React 19.

When fixing project sync/write errors:
- Generated file paths must be under src/ or public/.
- Do not create root-level assets/* files. Static assets belong in public/assets/*.
- If TSX imports ../../assets/foo.svg or ../assets/foo.svg from outside src/, replace the import with a public URL such as `${import.meta.env.BASE_URL}assets/foo.svg`.
- Do not add npm dependencies for file path/write errors unless the error explicitly names a missing package.

When fixing TypeScript/Vite/ESLint build errors:
- ESLint parser errors, Babel parser errors, "Parsing error", "Identifier expected",
  "Unexpected token", and "An identifier or keyword cannot immediately follow a numeric literal"
  are source syntax errors. Patch the exact source file and nearby expression named in the log.
- If an object key starts with a number or contains characters invalid for dot access, use bracket
  notation such as `theme.spacing["2xl"]` instead of `theme.spacing.2xl`.
- Build-stage fixes MUST populate error_fixes. Create one error_fixes item for every current
  TypeScript error signature in Build progress diagnostics / Full build log.
- Each error_fixes item must include file, line, code, diagnosis, evidence_used, change_summary,
  and patch_path. Notes are not a substitute for error_fixes.
- Do not omit an error because another patch "probably" fixes it. If one shared change resolves
  multiple errors, create one error_fixes item per error and point each to the shared patch_path.
- Follow the debug protocol before patching: inspect Build debug context, the failing line,
  nearby source, relevant imports, and package/type evidence.
- Your patches must be explained by the evidence. If Build debug context shows the exact failing
  JSX prop/import/line, change that source line or the source it depends on; do not patch unrelated files.
- Patch files listed in "TypeScript error hints" — especially the file:line shown in each error.
- When multiple files have TypeScript errors, return patches for all affected files in the same
  fix attempt unless one shared source/data/type/package change resolves them together.
- If the failing line uses an imported symbol from an npm package, use the installed package
  type evidence to choose the supported API or propose an evidence-backed package version change.
- Do not propose @types/* for packages that already provide bundled types or whose @types package
  is listed in Failed npm specs.
- If the same signature remains from a previous attempt, do not repeat the same hypothesis.
  Change the failing line context, patch the source/data/type it depends on, or change the package version.
- IntrinsicAttributes errors mean the JSX call site passes props the component does not declare:
  remove those props in the parent file OR add a props interface to the child.
- If a child component already imports src/data/*.json internally, the parent should use `<Child />` with no data props.
- When a TypeScript error involves a third-party package, use TypeScript/package diagnostics:
  inspect the imported symbol, installed package metadata, bundled type fields,
  referenced packages from .d.ts files, and verified @types candidates before deciding
  whether to patch source code or add dev_dependencies.
- Use Build progress diagnostics to verify whether previous attempts reduced the TypeScript error set.
- If the same signatures remain, change strategy and address every remaining error file or the shared source/data/API mismatch that explains them.
- Prefer dev_dependencies for missing type declarations used only by TypeScript.
- Do not add @types/* for a package that already ships bundled TypeScript types.
- If a package ships types but references another package without bundled types, add types for the referenced package instead.
- Do not add @types/node to make browser code compile if the source uses Node-only APIs.
- Browser/Vite source must not use require(), process.env, __dirname, __filename, or Buffer.
- Replace CommonJS asset loading with Vite-safe ESM imports or public URLs based on import.meta.env.BASE_URL.
- Files in public/assets should be referenced as public URLs, not imported through relative ../../public paths.
- Return FULL file contents for every file you patch.
- Use `[number, number]` tuple literals for react-leaflet positions.

When fixing browser runtime smoke test errors:
- Runtime smoke tests run against the production preview in a real browser after build succeeds.
- Fix source files under src/ or public/ only; never patch dist/ output.
- Treat Browser runtime diagnostics as authoritative. Your patch must implement the listed required_strategy.
- Do not hallucinate missing information or binary/media assets. If a local media/map/menu/contact
  asset or fact is missing, change the UI/data to a placeholder, disabled state, or "To be provided / Needs confirmation"
  message instead of pretending the asset/fact exists.
- Use pageerror, console.error, HTTP failures, and empty #root reports as evidence.
- If the page is blank, look for render-time exceptions, invalid asset URLs, CSS hiding content, or data-shape mismatches.
- Replace CommonJS/Node-only APIs with browser/Vite-safe equivalents.
- For third-party asset 404s, fix the source import/configuration that emits asset URLs.
- If Leaflet requests marker-icon.png, marker-icon-2x.png, or marker-shadow.png from the preview root,
  import `leaflet/dist/leaflet.css`, import the marker image URLs from `leaflet/dist/images/...`,
  and configure `L.Icon.Default.mergeOptions(...)` in source code.

General rules:
- patches is a list of {path, content} objects
- npm_dependencies is for runtime packages; dev_dependencies is for type/build-only packages
- Do not patch unrelated files while leaving error files unchanged
"""

STAGE_LABELS = {
    "plan": "project planning",
    "generate": "file generation",
    "repair": "import repair",
    "sync": "project sync",
    "dependency": "npm dependency install",
    "build": "production build",
    "runtime": "browser runtime smoke test",
    "fix": "auto-fix",
}


def collect_project_sources(project_dir: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for folder in ("src", "public"):
        root = project_dir / folder
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                rel = path.relative_to(project_dir).as_posix()
                files[rel] = path.read_text(encoding="utf-8")
    return files


def merge_sources(project_dir: Path, generated_files: dict[str, str] | None) -> dict[str, str]:
    sources = collect_project_sources(project_dir)
    if generated_files:
        sources.update(generated_files)
    return sources


def _read_package_json(project_dir: Path) -> tuple[str, dict]:
    path = project_dir / "package.json"
    if not path.is_file():
        return "", {}
    text = path.read_text(encoding="utf-8")
    return text, json.loads(text)


def request_project_fix(
    project_dir: Path,
    user_message: str,
    error_message: str,
    failure_stage: str,
    attempt: int,
    max_attempts: int,
    *,
    pending_npm: list[str] | None = None,
    pending_dev_npm: list[str] | None = None,
    legacy_peer_deps: bool = False,
    generated_files: dict[str, str] | None = None,
    target_file: str = "",
    build_log: str = "",
    failed_npm_specs: list[str] | None = None,
    type_diagnostics: str = "",
    runtime_diagnostics: str = "",
    build_progress_diagnostics: str = "",
    build_debug_context: str = "",
    previous_fix_rejection: str = "",
    tsc_hints: str = "",
    stale_fix_count: int = 0,
) -> BuildFixResult:
    api_key = get_openai_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    sources = merge_sources(project_dir, generated_files)
    if not sources:
        raise RuntimeError("No project sources found to fix")

    manifest = "\n\n".join(
        f"### {path}\n{content[:5000]}" for path, content in sorted(sources.items())
    )
    package_json_text, _package_json = _read_package_json(project_dir)

    llm = ChatOpenAI(model=OPENAI_FIX_MODEL, api_key=api_key, temperature=0.1)
    fixer = llm.with_structured_output(BuildFixResult, method="function_calling")

    pending = ", ".join(pending_npm or []) or "none"
    pending_dev = ", ".join(pending_dev_npm or []) or "none"
    kind_label = STAGE_LABELS.get(failure_stage, failure_stage or "unknown")
    target = target_file or "none"
    failed = ", ".join(failed_npm_specs or []) or "none"
    registry = npm_registry_context(
        error_message,
        merge_package_specs(pending_npm or [], pending_dev_npm or [], failed_npm_specs or []),
    )

    stale_note = ""
    if stale_fix_count > 0:
        stale_note = (
            f"\nIMPORTANT: The TypeScript error set has not shrunk for {stale_fix_count} "
            f"fix attempt(s). Your previous patches did not make build progress. Change strategy, "
            f"use Build progress diagnostics, and patch every remaining error file or the shared "
            f"source/data/API mismatch that explains them.\n"
        )

    rejection_note = ""
    if previous_fix_rejection:
        rejection_note = (
            "\nIMPORTANT: Your previous proposed fix was rejected by validation:\n"
            f"{previous_fix_rejection}\n"
            "The next patch must directly address this rejection, otherwise it will be rejected again. "
            "If the rejection names a missing failing file patch, include a patch for that exact file "
            "or patch a clearly shared source/data/type dependency that the Build debug context proves "
            "controls that error.\n"
        )

    return fixer.invoke(
        [
            SystemMessage(content=FIX_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"User request:\n{user_message}\n\n"
                    f"Failure stage: {kind_label}\n"
                    f"Failing file: {target}\n"
                    f"Fix attempt: {attempt}/{max_attempts}\n"
                    f"Repeated same error count: {stale_fix_count}\n"
                    f"{stale_note}"
                    f"{rejection_note}"
                    f"legacy_peer_deps currently enabled: {legacy_peer_deps}\n"
                    f"Pending npm specs: {pending}\n"
                    f"Pending dev npm specs: {pending_dev}\n"
                    f"Failed npm specs (do NOT retry): {failed}\n\n"
                    f"package.json:\n{package_json_text}\n\n"
                    f"npm registry context (live query):\n{registry}\n\n"
                    f"TypeScript/package diagnostics:\n{type_diagnostics or 'none'}\n\n"
                    f"Build progress diagnostics:\n{build_progress_diagnostics or 'none'}\n\n"
                    f"Build debug context:\n{build_debug_context or 'none'}\n\n"
                    f"Browser runtime diagnostics:\n{runtime_diagnostics or 'none'}\n\n"
                    f"TypeScript error hints:\n{tsc_hints or 'none'}\n\n"
                    f"Latest error:\n{error_message}\n\n"
                    f"Full build log:\n{build_log or 'none'}\n\n"
                    f"Current project files:\n{manifest}"
                )
            ),
        ]
    )
