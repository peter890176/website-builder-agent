import logging
import re

from pathlib import Path



from langchain_core.messages import HumanMessage, SystemMessage

from langchain_openai import ChatOpenAI

from langgraph.graph import END, START, StateGraph



from app.agents.content import clean_generated_content, is_valid_entry_tsx

from app.agents.imports import find_missing_local_files, normalize_generated_files, normalize_posix_path

from app.agents.state import AgentState
from app.agents.build_debug_context import (
    build_debug_context_text,
    build_debug_contexts,
    validate_build_fix_evidence,
)

from app.core.config import (
    APP_BASE_URL,
    MAX_BUILD_FIX_ATTEMPTS,
    MAX_DEP_FIX_ATTEMPTS,
    MAX_INVALID_FIX_ATTEMPTS,
    MAX_RUNTIME_FIX_ATTEMPTS,
    MAX_STALE_FIX_ATTEMPTS,
    MAX_TOTAL_FIX_ATTEMPTS,
    OPENAI_MODEL,
    RUNTIME_SMOKE_TIMEOUT_MS,
    get_openai_api_key,
)

from app.schemas.plan import FilePlanItem, ProjectPlan

from app.services.build import try_build_vite_project
from app.services.runtime_smoke import run_runtime_smoke_test

from app.agents.tsc_errors import (
    build_fix_hints,
    build_progress_diagnostics,
    error_signature,
    error_signatures,
    parse_tsc_errors,
)
from app.agents.type_diagnostics import (
    build_type_diagnostics,
    missing_type_candidates,
    type_diagnostics_text,
)
from app.agents.runtime_diagnostics import (
    build_runtime_diagnostics,
    runtime_diagnostics_text,
    validate_runtime_fix,
)
from app.agents.truthfulness import (
    is_degradable_missing_asset_failure,
    runtime_missing_asset_warnings,
    warning_dicts,
)
from app.services.build_fix import request_project_fix

from app.services.dependencies import install_planned_dependencies, merge_package_specs, validate_package_specs

from app.services.workspace import write_project_file



logger = logging.getLogger(__name__)



PLANNER_PROMPT = """You are a senior frontend architect planning a Vite + React + TypeScript website.



Given the user request, produce a file plan for a multi-file project.



The project template uses React 18.3 and Vite 5.



Rules:

- Always include src/App.tsx as the entry component

- Always include src/components/ui.tsx and src/components/ui.css for the shared design-system primitives.

- Put reusable UI in src/components/*.tsx and prefer importing primitives from src/components/ui.tsx.

- Put structured data in src/data/*.json and import them in TSX; keep field names consistent across all files

- Put static assets in public/assets/* (SVG preferred). Reference with /assets/filename.svg

- Do NOT plan binary downloads or external image URLs

- List npm_dependencies when third-party UI/map/chart/icon libraries are required.

- Include @radix-ui/react-slot when using the shared Button primitive.

- Prefer a single-page layout unless the user explicitly asks for multiple routes

- Maximum 12 files

- Paths must be under src/ or public/

- If a component imports ./Foo.css, include that CSS file in the plan

- Every relative import in the plan must have a matching file entry

Design-system-first planning:

- Plan pages as composed sections, not plain document-style content.
- Default to a centered hero, centered section headers, max-width containers, responsive grids, and card-based content groups.
- Prefer the shared Container, Section, SectionHeader, Button, Card, and Badge primitives instead of raw unstructured divs.
- Avoid a full page of left-aligned text blocks unless the user explicitly asks for an editorial/document layout.

"""


DESIGN_QUALITY_CONTRACT = """
Design Quality Contract:

- Build a polished, production-quality website, not a plain demo or document page.
- Use the shared primitives from src/components/ui.tsx: Container, Section, SectionHeader, Button, Card, and Badge.
- Use a centered hero by default, with a concise eyebrow/badge, strong headline, supporting copy, and clear CTA group.
- Center section headers by default. Keep body copy readable with max-width text containers.
- Wrap major content in max-width containers and use consistent section spacing.
- Use responsive grids for cards and feature/content lists.
- Keep cards, buttons, badges, typography, radius, colors, borders, and shadows consistent across the page.
- Create clear visual hierarchy with contrast, whitespace, section backgrounds, and intentional grouping.
- Avoid plain document-style, all-left-aligned pages. Do not stack long text blocks without visual structure.
- Ensure desktop and mobile layouts are both intentional and avoid horizontal overflow in the generated site.
"""


UI_PRIMITIVES_TSX = '''import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./ui.css";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ContainerProps = ComponentPropsWithoutRef<"div"> & {
  size?: "default" | "wide" | "narrow";
};

export function Container({ className, size = "default", ...props }: ContainerProps) {
  return <div className={cx("ui-container", `ui-container--${size}`, className)} {...props} />;
}

type SectionProps = ComponentPropsWithoutRef<"section"> & {
  tone?: "default" | "muted" | "accent" | "dark";
};

export function Section({ className, tone = "default", ...props }: SectionProps) {
  return <section className={cx("ui-section", `ui-section--${tone}`, className)} {...props} />;
}

type SectionHeaderProps = ComponentPropsWithoutRef<"div"> & {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "center",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cx("ui-section-header", `ui-section-header--${align}`, className)} {...props}>
      {eyebrow ? <Badge>{eyebrow}</Badge> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
};

export function Button({
  asChild = false,
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} {...props} />;
}

type CardProps = ComponentPropsWithoutRef<"div"> & {
  interactive?: boolean;
};

export function Card({ className, interactive = false, ...props }: CardProps) {
  return <div className={cx("ui-card", interactive && "ui-card--interactive", className)} {...props} />;
}

export function Badge({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cx("ui-badge", className)} {...props} />;
}
'''


UI_PRIMITIVES_CSS = """:root {
  --ui-bg: #ffffff;
  --ui-bg-muted: #f8fafc;
  --ui-bg-accent: #eef2ff;
  --ui-fg: #0f172a;
  --ui-muted: #64748b;
  --ui-border: rgba(15, 23, 42, 0.12);
  --ui-primary: #4f46e5;
  --ui-primary-strong: #4338ca;
  --ui-primary-soft: rgba(79, 70, 229, 0.1);
  --ui-radius: 1.25rem;
  --ui-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-width: 320px;
  background: var(--ui-bg);
  color: var(--ui-fg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
}

button,
input,
textarea,
select {
  font: inherit;
}

.ui-container {
  width: min(100% - 2rem, 72rem);
  margin-inline: auto;
}

.ui-container--narrow {
  width: min(100% - 2rem, 56rem);
}

.ui-container--wide {
  width: min(100% - 2rem, 84rem);
}

.ui-section {
  padding-block: clamp(4rem, 8vw, 7rem);
}

.ui-section--muted {
  background: var(--ui-bg-muted);
}

.ui-section--accent {
  background:
    radial-gradient(circle at top left, rgba(79, 70, 229, 0.16), transparent 32rem),
    var(--ui-bg-accent);
}

.ui-section--dark {
  background: #0f172a;
  color: white;
}

.ui-section-header {
  max-width: 48rem;
  margin: 0 auto clamp(2rem, 5vw, 4rem);
}

.ui-section-header--center {
  text-align: center;
}

.ui-section-header--left {
  margin-inline: 0;
  text-align: left;
}

.ui-section-header h2 {
  margin: 1rem 0 0;
  font-size: clamp(2rem, 5vw, 3.75rem);
  line-height: 1;
  letter-spacing: -0.045em;
}

.ui-section-header p {
  margin: 1rem auto 0;
  max-width: 42rem;
  color: var(--ui-muted);
  font-size: clamp(1rem, 2vw, 1.18rem);
  line-height: 1.75;
}

.ui-section--dark .ui-section-header p {
  color: rgba(255, 255, 255, 0.72);
}

.ui-button {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.75rem 1.15rem;
  font-weight: 700;
  text-decoration: none;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
  cursor: pointer;
}

.ui-button:hover {
  transform: translateY(-1px);
}

.ui-button--primary {
  background: var(--ui-primary);
  color: white;
  box-shadow: 0 16px 36px rgba(79, 70, 229, 0.25);
}

.ui-button--primary:hover {
  background: var(--ui-primary-strong);
}

.ui-button--secondary {
  border-color: var(--ui-border);
  background: white;
  color: var(--ui-fg);
}

.ui-button--ghost {
  background: transparent;
  color: var(--ui-fg);
}

.ui-button--sm {
  min-height: 2.25rem;
  padding: 0.5rem 0.85rem;
  font-size: 0.9rem;
}

.ui-button--lg {
  min-height: 3.25rem;
  padding: 0.9rem 1.4rem;
  font-size: 1.05rem;
}

.ui-card {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--ui-shadow);
  padding: clamp(1.25rem, 3vw, 2rem);
}

.ui-card--interactive {
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.ui-card--interactive:hover {
  transform: translateY(-4px);
  border-color: rgba(79, 70, 229, 0.28);
  box-shadow: 0 28px 90px rgba(15, 23, 42, 0.12);
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  border: 1px solid rgba(79, 70, 229, 0.18);
  border-radius: 999px;
  background: var(--ui-primary-soft);
  color: var(--ui-primary-strong);
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@media (max-width: 720px) {
  .ui-section {
    padding-block: 3.5rem;
  }

  .ui-container,
  .ui-container--narrow,
  .ui-container--wide {
    width: min(100% - 1.25rem, 100%);
  }
}
"""


DESIGN_SYSTEM_FILES = {
    "src/components/ui.tsx": ("Shared Radix UI + CSS design-system primitives: Container, Section, SectionHeader, Button, Card, and Badge.", "tsx"),
    "src/components/ui.css": ("Shared design-system CSS tokens and primitive styles for layout, cards, buttons, badges, typography, and spacing.", "css"),
}


RADIX_SLOT_PACKAGE = "@radix-ui/react-slot"
FILE_VALIDATION_REPAIR_ATTEMPTS = 2



FILE_GENERATION_RULES = """

Rules:

- Return ONLY the file contents. No markdown fences, no explanation.

- TypeScript/React files must compile with `tsc -b` and `vite build`.
- The template uses the React 17+ JSX transform. Do not add `import React from "react";`
  unless the `React` identifier is explicitly used in code.

- You may import local files and npm packages listed in the plan.

- For layout and repeated UI, import and use Container, Section, SectionHeader, Button, Card, and Badge from "./components/ui" or "../components/ui".

- Prefer composing pages from those primitives instead of raw unstructured divs.

- When importing JSON, use ONLY field paths that exist in the provided JSON content.

- Never render nested JSON objects directly in JSX; format them into strings first.

- Browser code must not use Node/CommonJS globals such as require(), process.env, __dirname, __filename, or Buffer.

- Use Vite ESM imports for src assets, and use `${import.meta.env.BASE_URL}assets/name.ext` for files in public/assets.

- Do not import files from public/ through relative paths like ../../public/assets/foo.svg.

- Do not reference local binary/media files unless they are explicitly generated or provided.
  If music, video, map, menu, contact, price, hours, or other facts are missing, show a
  placeholder/disabled state such as "To be provided" or "Needs confirmation" instead of inventing facts.

- JSON must be valid JSON.

- For src/App.tsx, export default the App component.
- If a child component imports its own JSON data, use it with no props from App.tsx (e.g. `<PizzaShopInfo />`).

- Do not use react-router-dom v5 APIs like Switch; use v6 Routes/Route only if routing is required.

- For SVG files, return raw XML containing an <svg> element only. No markdown, no explanation.

"""



RESUME_AFTER_FIX = {

    "plan": "plan",

    "generate": "generate",

    "repair": "repair",

    "sync": "sync",

    "dependency": "sync",

    "build": "sync",

    "runtime": "sync",

    "fix": "sync",

}





def _generation_order(plan: ProjectPlan) -> list:

    def sort_key(item) -> tuple[int, str]:

        path = item.path.lower()

        if path.endswith(".json"):

            return (0, path)

        if path.endswith((".css", ".svg")):

            return (1, path)

        return (2, path)



    return sorted(plan.files, key=sort_key)





def _json_context(generated: dict[str, str]) -> str:

    chunks = [

        f"### {path}\n{content}"

        for path, content in sorted(generated.items())

        if path.endswith(".json")

    ]

    return "\n\n".join(chunks) if chunks else "none"





def _llm() -> ChatOpenAI:

    api_key = get_openai_api_key()

    if not api_key:

        raise ValueError("OPENAI_API_KEY is not configured")

    return ChatOpenAI(model=OPENAI_MODEL, api_key=api_key, temperature=0.2)





def _file_type(path: str) -> str:

    if path.endswith(".json"):

        return "json"

    if path.endswith(".css"):

        return "css"

    if path.endswith(".svg"):

        return "svg"

    return "tsx"


def _npm_root(spec: str) -> str:
    if spec.startswith("@"):
        version_at = spec.rfind("@")
        if version_at > 0:
            return spec[:version_at]
        return spec
    return spec.split("@", 1)[0]


def _without_failed_specs(specs: list[str], failed_specs: list[str]) -> list[str]:
    failed = set(failed_specs)
    return [spec for spec in specs if spec not in failed]


def _failed_specs_from_error(error: str, attempted_specs: list[str]) -> list[str]:
    exact_patterns = [
        r"Invalid npm package name: (?P<spec>\S+)",
        r"npm package not found: (?P<spec>\S+)",
    ]
    for pattern in exact_patterns:
        match = re.search(pattern, error)
        if match:
            spec = match.group("spec").strip()
            return [spec] if spec in attempted_specs else [spec]
    return attempted_specs



def _claim_key(file: str, line: int, code: str) -> tuple[str, int, str]:
    clean_code = str(code).upper().removeprefix("TS")
    return (normalize_posix_path(file), int(line), clean_code)


def _validate_build_fix_claims(errors, fix_result, patched: set[str], proposed_packages: list[str]) -> None:
    if not errors:
        return
    claims = fix_result.error_fixes or []
    if not claims:
        raise ValueError(
            "Build fix must include error_fixes: one diagnosis/evidence/change claim for every "
            "current TypeScript error. Notes alone are not enough."
        )

    claim_keys = {
        _claim_key(claim.file, claim.line, claim.code)
        for claim in claims
    }
    missing = [
        f"{err.file}:{err.line}:TS{err.code}"
        for err in errors
        if _claim_key(err.file, err.line, err.code) not in claim_keys
    ]
    if missing:
        raise ValueError(
            "Build fix error_fixes must cover every current TypeScript error. "
            f"Missing claim(s): {', '.join(missing)}"
        )

    errors_by_key = {
        _claim_key(err.file, err.line, err.code): err
        for err in errors
    }
    proposed_roots = {_npm_root(spec) for spec in proposed_packages}
    shared_patches = {
        path for path in patched if path.startswith("src/data/") or "type" in path.lower()
    }
    component_contract_patches = {
        path for path in patched if path.startswith("src/components/") and path.endswith((".tsx", ".ts"))
    }
    for claim in claims:
        if not claim.diagnosis.strip() or not claim.evidence_used.strip() or not claim.change_summary.strip():
            raise ValueError(
                "Each error_fixes item must include non-empty diagnosis, evidence_used, and change_summary."
            )

        claim_file = normalize_posix_path(claim.file)
        patch_path = normalize_posix_path(claim.patch_path) if claim.patch_path else ""
        claim_error = errors_by_key.get(_claim_key(claim.file, claim.line, claim.code))
        if proposed_packages and (not patched or patch_path in proposed_roots):
            continue
        if claim_file in patched or patch_path in patched or shared_patches:
            continue
        if _is_component_props_contract_error(claim_file, claim.code, claim_error) and component_contract_patches:
            continue
        raise ValueError(
            "Each error_fixes item must point to an actual patch_path, package change, "
            f"or shared source/data/type patch. Unmatched claim: {claim_file}:{claim.line}:TS{claim.code}"
        )


def _is_component_props_contract_error(claim_file: str, code: str, error) -> bool:
    clean_code = str(code).upper().removeprefix("TS")
    if clean_code != "2322":
        return False
    if not claim_file.endswith(".tsx"):
        return False
    if error is None:
        return False
    return "IntrinsicAttributes" in error.message and "Property" in error.message





def _should_give_up(state: AgentState) -> bool:
    if state.get("fix_attempts", 0) >= MAX_TOTAL_FIX_ATTEMPTS:
        return True
    stage = state.get("failure_stage") or state.get("resume_stage")
    if stage == "dependency" and state.get("dep_attempts", 0) >= MAX_DEP_FIX_ATTEMPTS:
        return True
    if stage == "build" and state.get("build_fix_attempts", 0) >= MAX_BUILD_FIX_ATTEMPTS:
        return True
    if stage == "runtime" and state.get("runtime_fix_attempts", 0) >= MAX_RUNTIME_FIX_ATTEMPTS:
        return True
    if state.get("invalid_fix_attempts", 0) >= MAX_INVALID_FIX_ATTEMPTS:
        return True
    return False





def _pending(

    stage: str,

    error: str,

    *,

    target_file: str = "",

    generated_files: dict[str, str] | None = None,

    **extra,

) -> dict:

    update: dict = {

        "pending_error": error,

        "failure_stage": stage,

        "target_file": target_file,

        "error": None,

        **extra,

    }

    if generated_files is not None:

        update["generated_files"] = generated_files

    return update





def _route_if_pending(state: AgentState, success: str) -> str:

    if state.get("error"):

        return "fail"

    if state.get("pending_error"):

        if _should_give_up(state):

            return "fail"

        return "fix"

    return success





def _invoke_planner(message: str, error_context: str = "") -> ProjectPlan:

    planner = _llm().with_structured_output(ProjectPlan)

    user_content = message

    if error_context:

        user_content = f"{message}\n\nPrevious planning error:\n{error_context}"

    plan = planner.invoke(

        [

            SystemMessage(content=PLANNER_PROMPT),

            HumanMessage(content=user_content),

        ]

    )

    if not any(item.path.lower() == "src/app.tsx" for item in plan.files):

        raise ValueError("Plan must include src/App.tsx")

    return _ensure_design_system_plan(plan)


def _ensure_design_system_plan(plan: ProjectPlan) -> ProjectPlan:
    planned_paths = {item.path.replace("\\", "/").lower() for item in plan.files}
    files = list(plan.files)

    for path, (description, file_type) in DESIGN_SYSTEM_FILES.items():
        if path.lower() not in planned_paths:
            files.append(FilePlanItem(path=path, description=description, file_type=file_type))

    dependencies = merge_package_specs(plan.npm_dependencies, [RADIX_SLOT_PACKAGE])
    return ProjectPlan(summary=plan.summary, files=files, npm_dependencies=dependencies)





def plan_project(state: AgentState) -> dict:

    try:

        plan = _invoke_planner(state["message"], state.get("pending_error", ""))

        return {

            "plan": plan.model_dump(),

            "error": None,

            "pending_error": "",

            "failure_stage": "",

            "target_file": "",

            "build_success": False,

            "build_attempts": 0,

            "build_fix_attempts": 0,

            "runtime_attempts": 0,

            "runtime_fix_attempts": 0,

            "fix_attempts": 0,

            "invalid_fix_attempts": 0,

            "dep_attempts": 0,

            "legacy_peer_deps": False,

            "build_log": "",

            "pending_npm": [],

            "pending_dev_npm": [],

            "failed_npm_specs": [],

            "last_fix_rejection": "",

            "last_error_signature": "",

            "last_error_signatures": [],

            "build_no_progress_count": 0,

            "stale_fix_count": 0,

        }

    except Exception as exc:

        logger.warning("Planning failed for project %s: %s", state["project_id"], exc)

        return _pending("plan", f"Planning failed: {exc}")





def _generate_single_file(

    state: AgentState,

    plan: ProjectPlan,

    item,

    generated: dict[str, str],

    file_manifest: str,

) -> str:
    normalized_item_path = item.path.replace("\\", "/")

    if normalized_item_path == "src/components/ui.tsx":
        return UI_PRIMITIVES_TSX

    if normalized_item_path == "src/components/ui.css":
        return UI_PRIMITIVES_CSS

    prior = "\n".join(f"{path} (already generated)" for path in generated.keys())

    data_context = ""

    if item.file_type in {"tsx", "ts"}:

        data_context = f"""

Data files already generated (use these exact field paths):

{_json_context(generated)}

"""

    prompt = f"""Generate file: {item.path}

Type: {item.file_type}

Purpose: {item.description}



User request:

{state["message"]}



Project summary:

{plan.summary}



Project file manifest:

{file_manifest}



Already generated:

{prior or "none"}



Requested npm packages:

{", ".join(plan.npm_dependencies) if plan.npm_dependencies else "none"}

{data_context}

{DESIGN_QUALITY_CONTRACT if item.file_type in {"tsx", "css"} else ""}

{FILE_GENERATION_RULES}

"""

    if state.get("pending_error") and state.get("target_file") == item.path:

        prompt += f"\nPrevious generation error for this file:\n{state['pending_error']}\n"



    response = _llm().invoke(

        [

            SystemMessage(content="You generate production-ready project files using the project's shared design-system primitives."),

            HumanMessage(content=prompt),

        ]

    )

    return _clean_or_repair_generated_file(
        raw_content=str(response.content),
        state=state,
        plan=plan,
        item=item,
        generated=generated,
        file_manifest=file_manifest,
    )


def _clean_or_repair_generated_file(
    *,
    raw_content: str,
    state: AgentState,
    plan: ProjectPlan,
    item,
    generated: dict[str, str],
    file_manifest: str,
) -> str:
    current_raw = raw_content
    last_error: Exception | None = None

    for attempt in range(FILE_VALIDATION_REPAIR_ATTEMPTS + 1):
        try:
            content = clean_generated_content(current_raw, item.file_type)
            if not is_valid_entry_tsx(item.path, content):
                raise ValueError(f"{item.path} is not a valid App entry component")
            return content
        except Exception as exc:
            last_error = exc
            if attempt >= FILE_VALIDATION_REPAIR_ATTEMPTS or not _is_repairable_generation_error(item):
                raise
            logger.info(
                "Repairing invalid generated file %s after validation error: %s",
                item.path,
                exc,
            )
            current_raw = _repair_generated_file_content(
                raw_content=current_raw,
                validation_error=str(exc),
                state=state,
                plan=plan,
                item=item,
                generated=generated,
                file_manifest=file_manifest,
                attempt=attempt + 1,
            )

    if last_error:
        raise last_error
    raise ValueError(f"Failed to validate generated file: {item.path}")


def _is_repairable_generation_error(item) -> bool:
    normalized_path = item.path.replace("\\", "/").lower()
    return item.file_type in {"json", "svg"} or normalized_path == "src/app.tsx"


def _repair_generated_file_content(
    *,
    raw_content: str,
    validation_error: str,
    state: AgentState,
    plan: ProjectPlan,
    item,
    generated: dict[str, str],
    file_manifest: str,
    attempt: int,
) -> str:
    prior = "\n".join(f"{path} (already generated)" for path in generated.keys())
    format_rules = {
        "json": "Return valid JSON only. Do not include markdown fences, comments, trailing commas, or unescaped quotes.",
        "svg": "Return raw SVG XML only. It must contain one <svg> element and no markdown fences.",
        "tsx": "Return valid TSX only. If this is src/App.tsx, define and export a default App component.",
    }.get(item.file_type, "Return only the corrected file contents.")

    response = _llm().invoke(
        [
            SystemMessage(content="You repair invalid generated file contents. Return only the corrected file contents."),
            HumanMessage(
                content=f"""Repair generated file: {item.path}
Type: {item.file_type}
Purpose: {item.description}
Repair attempt: {attempt} of {FILE_VALIDATION_REPAIR_ATTEMPTS}

Validation error:
{validation_error}

User request:
{state["message"]}

Project summary:
{plan.summary}

Project file manifest:
{file_manifest}

Already generated:
{prior or "none"}

Rules:
- Preserve the intended meaning and data from the invalid output.
- Fix only validity/format problems needed for this file to pass validation.
- {format_rules}

Invalid output:
{raw_content}
"""
            ),
        ]
    )
    return str(response.content)





def generate_files(state: AgentState) -> dict:

    if state.get("error"):

        return {}



    plan = ProjectPlan.model_validate(state["plan"])

    generated = normalize_generated_files(dict(state.get("generated_files", {})))

    file_manifest = "\n".join(f"- {item.path}: {item.description}" for item in plan.files)



    for item in _generation_order(plan):

        if item.path in generated:

            continue



        try:

            content = _generate_single_file(state, plan, item, generated, file_manifest)

            generated[item.path] = content
            generated = normalize_generated_files(generated)

            logger.info("Generated %s", item.path)

        except Exception as exc:

            logger.warning("Failed to generate %s: %s", item.path, exc)

            return _pending(

                "generate",

                f"Failed to generate {item.path}: {exc}",

                target_file=item.path,

                generated_files=generated,

            )



    return {"generated_files": generated, "pending_error": "", "failure_stage": "", "target_file": ""}





def repair_missing_imports(state: AgentState) -> dict:

    if state.get("error"):

        return {}



    project_dir = Path(state["workspace_path"])

    generated = normalize_generated_files(dict(state.get("generated_files", {})))

    missing = find_missing_local_files(generated, project_dir)



    if not missing:

        return {"generated_files": generated}



    llm = _llm()

    for path in missing:

        try:

            response = llm.invoke(

                [

                    SystemMessage(content="Generate a minimal valid project file to satisfy a missing import."),

                    HumanMessage(

                        content=(

                            f"Generate file: {path}\n"

                            f"User request: {state['message']}\n"

                            f"{FILE_GENERATION_RULES}"

                        )

                    ),

                ]

            )

            generated[path] = clean_generated_content(str(response.content), _file_type(path))
            generated = normalize_generated_files(generated)

        except Exception as exc:

            logger.warning("Failed to repair %s: %s", path, exc)

            return _pending(

                "repair",

                f"Failed to repair {path}: {exc}",

                target_file=path,

                generated_files=generated,

            )



    logger.info("Repaired missing files: %s", ", ".join(missing))

    return {"generated_files": generated, "pending_error": "", "failure_stage": "", "target_file": ""}





def sync_project(state: AgentState) -> dict:

    if state.get("error"):

        return {}



    project_dir = Path(state["workspace_path"])

    generated = normalize_generated_files(dict(state.get("generated_files", {})))

    if not generated:

        return _pending("sync", "No files generated")



    missing = find_missing_local_files(generated, project_dir)

    if missing:

        return _pending(

            "repair",

            f"Missing local imports: {', '.join(missing)}",

            target_file=missing[0],

            generated_files=generated,

        )



    try:

        for path, content in generated.items():

            safe_path = normalize_posix_path(path)

            write_project_file(state["project_id"], safe_path, content)

    except Exception as exc:

        logger.warning("Failed to write files for project %s: %s", state["project_id"], exc)

        return _pending("sync", f"Failed to write project files: {exc}", generated_files=generated)



    plan = ProjectPlan.model_validate(state["plan"])

    failed_specs = state.get("failed_npm_specs", [])
    plan_specs = _without_failed_specs(plan.npm_dependencies, failed_specs)
    extra = _without_failed_specs(state.get("pending_npm", []), failed_specs)
    dev_extra = _without_failed_specs(state.get("pending_dev_npm", []), failed_specs)

    npm_specs = merge_package_specs(plan_specs, extra)
    dev_npm_specs = merge_package_specs(dev_extra)

    try:

        installed = install_planned_dependencies(

            project_dir,

            npm_specs,

            generated,

            legacy_peer_deps=state.get("legacy_peer_deps", False),

            failed_specs=failed_specs,

            dev_packages=dev_npm_specs,

        )

    except Exception as exc:

        dep_attempts = state.get("dep_attempts", 0) + 1

        attempted_specs = [*npm_specs, *dev_npm_specs]
        newly_failed = _failed_specs_from_error(str(exc), attempted_specs)
        failed = list(dict.fromkeys([*failed_specs, *newly_failed]))

        logger.warning(

            "Dependency install failed for project %s (attempt %s): %s",

            state["project_id"],

            dep_attempts,

            exc,

        )

        return _pending(

            "dependency",

            str(exc),

            generated_files=generated,

            dep_attempts=dep_attempts,

            failed_npm_specs=failed,

        )



    if installed:

        logger.info("Installed packages: %s", ", ".join(installed))



    return {

        "generated_files": generated,

        "pending_npm": [],

        "pending_dev_npm": [],

        "pending_error": "",

        "failure_stage": "",

        "target_file": "",

        "failed_npm_specs": [],

    }





def run_build(state: AgentState) -> dict:

    if state.get("error"):

        return {}



    project_dir = Path(state["workspace_path"])

    logger.info("Starting production build for project %s", state["project_id"])

    try:

        ok, log = try_build_vite_project(project_dir, state["project_id"])

    except Exception as exc:

        ok, log = False, str(exc)



    if ok:

        logger.info("Build succeeded for project %s", state["project_id"])

        return {

            "build_success": True,

            "build_log": log,

            "pending_error": "",

            "failure_stage": "",

            "last_error_signature": "",

            "last_error_signatures": [],

            "build_no_progress_count": 0,

            "stale_fix_count": 0,

        }



    attempts = state.get("build_attempts", 0) + 1

    logger.warning("Build failed for project %s (attempt %s)", state["project_id"], attempts)

    return _pending(

        "build",

        log,

        build_success=False,

        build_log=log,

        build_attempts=attempts,

    )





def smoke_project(state: AgentState) -> dict:

    if state.get("error"):

        return {}

    result = run_runtime_smoke_test(

        state["project_id"],

        base_url=APP_BASE_URL,

        timeout_ms=RUNTIME_SMOKE_TIMEOUT_MS,

    )

    if result.ok:

        logger.info("Runtime smoke test passed for project %s", state["project_id"])

        return {

            "pending_error": "",

            "failure_stage": "",

            "target_file": "",

            "build_log": state.get("build_log", ""),

        }

    if result.infrastructure_error:

        logger.error("Runtime smoke test infrastructure failed for project %s: %s", state["project_id"], result.log)

        return {

            "error": result.log,

            "build_log": result.log,

        }

    project_dir = Path(state["workspace_path"])
    asset_warnings = runtime_missing_asset_warnings(project_dir, state["project_id"], result.errors)
    if is_degradable_missing_asset_failure(result.errors, asset_warnings):
        warnings = [*state.get("warnings", []), *warning_dicts(asset_warnings)]
        logger.warning(
            "Runtime smoke test degraded for project %s with %s warning(s): %s",
            state["project_id"],
            len(asset_warnings),
            result.log,
        )
        return {
            "pending_error": "",
            "failure_stage": "",
            "target_file": "",
            "build_log": result.log,
            "warnings": warnings,
        }

    attempts = state.get("runtime_attempts", 0) + 1

    logger.warning(

        "Runtime smoke test failed for project %s (attempt %s): %s",

        state["project_id"],

        attempts,

        result.log,

    )

    return _pending(

        "runtime",

        result.log,

        build_success=False,

        build_log=result.log,

        runtime_attempts=attempts,

    )



def fix_project(state: AgentState) -> dict:

    if state.get("error"):

        return {}



    fix_attempts = state.get("fix_attempts", 0)
    attempted_fix_specs: list[str] = []

    stage = state.get("failure_stage", "build")

    error = state.get("pending_error", "")

    target_file = state.get("target_file", "")



    if not error:

        return {}



    build_log = state.get("build_log") or error

    sig = error_signature(build_log) if stage == "build" else ""

    prev_sig = state.get("last_error_signature", "")

    current_signatures = error_signatures(build_log) if stage == "build" else []

    previous_signatures = state.get("last_error_signatures", [])

    current_signature_set = set(current_signatures)

    previous_signature_set = set(previous_signatures)

    no_progress = (
        stage == "build"
        and bool(current_signature_set)
        and bool(previous_signature_set)
        and previous_signature_set.issubset(current_signature_set)
    )

    stale = (

        state.get("build_no_progress_count", state.get("stale_fix_count", 0)) + 1

        if no_progress

        else 0

    )

    logger.info(

        "Auto-fix attempt %s for project %s (stage=%s, file=%s)",

        fix_attempts + 1,

        state["project_id"],

        stage,

        target_file or "-",

    )



    try:

        if stage == "plan":

            plan = _invoke_planner(state["message"], error)

            result = {

                "plan": plan.model_dump(),

                "generated_files": {},
            "warnings": [],

            }

        elif stage == "generate" and target_file:

            plan = ProjectPlan.model_validate(state["plan"])

            item = next((f for f in plan.files if f.path == target_file), None)

            if item is None:

                raise ValueError(f"Target file not in plan: {target_file}")

            generated = dict(state.get("generated_files", {}))

            file_manifest = "\n".join(f"- {f.path}: {f.description}" for f in plan.files)

            content = _generate_single_file(state, plan, item, generated, file_manifest)

            generated[target_file] = content

            result = {"generated_files": generated}

        else:

            project_dir = Path(state["workspace_path"])

            attempt = {

                "dependency": state.get("dep_attempts", 0),

                "build": state.get("build_fix_attempts", 0) + 1,

                "runtime": state.get("runtime_fix_attempts", 0) + 1,

            }.get(stage, fix_attempts + 1)

            max_attempts = {

                "dependency": MAX_DEP_FIX_ATTEMPTS,

                "build": MAX_BUILD_FIX_ATTEMPTS,

                "runtime": MAX_RUNTIME_FIX_ATTEMPTS,

            }.get(stage, MAX_TOTAL_FIX_ATTEMPTS)



            build_log = state.get("build_log") or error

            type_diags = build_type_diagnostics(project_dir, build_log) if stage == "build" else []

            type_diag_text = type_diagnostics_text(type_diags) if stage == "build" else ""

            missing_type_specs = missing_type_candidates(type_diags) if stage == "build" else []

            debug_contexts = build_debug_contexts(project_dir, build_log) if stage == "build" else []

            debug_context_text = build_debug_context_text(debug_contexts) if stage == "build" else ""

            build_progress_text = (
                build_progress_diagnostics(
                    current_signatures,
                    previous_signatures,
                    stale,
                )
                if stage == "build"
                else ""
            )

            runtime_diags = build_runtime_diagnostics(project_dir, build_log) if stage == "runtime" else []

            runtime_diag_text = runtime_diagnostics_text(runtime_diags) if stage == "runtime" else ""

            tsc_hints = build_fix_hints(build_log) if stage == "build" else ""



            fix_result = request_project_fix(

                project_dir=project_dir,

                user_message=state["message"],

                error_message=error,

                failure_stage=stage,

                attempt=attempt,

                max_attempts=max_attempts,

                pending_npm=state.get("pending_npm", []),

                pending_dev_npm=state.get("pending_dev_npm", []),

                legacy_peer_deps=state.get("legacy_peer_deps", False),

                generated_files=state.get("generated_files", {}),

                target_file=target_file,

                build_log=build_log,

                failed_npm_specs=state.get("failed_npm_specs", []),

                previous_fix_rejection=state.get("last_fix_rejection", ""),

                type_diagnostics=type_diag_text,

                build_progress_diagnostics=build_progress_text,

                build_debug_context=debug_context_text,

                runtime_diagnostics=runtime_diag_text,

                tsc_hints=tsc_hints,

                stale_fix_count=stale,

            )

            runtime_fix_deps = [
                dep for dep in fix_result.npm_dependencies if not _npm_root(dep).startswith("@types/")
            ]
            dev_fix_deps = merge_package_specs(
                fix_result.dev_dependencies,
                [dep for dep in fix_result.npm_dependencies if _npm_root(dep).startswith("@types/")],
            )
            attempted_fix_specs = merge_package_specs(runtime_fix_deps, dev_fix_deps)

            validate_package_specs(
                project_dir,
                runtime_specs=runtime_fix_deps,
                dev_specs=dev_fix_deps,
                failed_specs=state.get("failed_npm_specs", []),
            )



            if stage == "build":

                tsc_errors = parse_tsc_errors(build_log)
                error_files = {e.file for e in tsc_errors}

                patched = {normalize_posix_path(p.path) for p in fix_result.patches}
                proposed_packages = merge_package_specs(
                    runtime_fix_deps,
                    dev_fix_deps,
                )
                _validate_build_fix_claims(tsc_errors, fix_result, patched, proposed_packages)

                if error_files and not error_files.intersection(patched) and not proposed_packages:

                    raise ValueError(

                        "Fix must patch at least one file with TypeScript errors: "

                        f"{', '.join(sorted(error_files))}. "

                        f"Patched: {', '.join(sorted(patched)) or 'none'}"

                    )

                if missing_type_specs and not proposed_packages:

                    raise ValueError(

                        "Type diagnostics found verified missing type package candidate(s): "

                        f"{', '.join(missing_type_specs)}. "

                        "A source-only patch is unlikely to fix this third-party typing error; "

                        "include the appropriate dev_dependencies or explain via a different package change."

                    )

            before_generated = dict(state.get("generated_files", {}))
            generated = dict(before_generated)

            for patch in fix_result.patches:

                safe_path = normalize_posix_path(patch.path)

                generated[safe_path] = clean_generated_content(

                    patch.content,

                    _file_type(safe_path),

                )

            if stage == "build":
                patched_files = {normalize_posix_path(p.path) for p in fix_result.patches}
                validate_build_fix_evidence(
                    project_dir,
                    debug_contexts,
                    before_generated,
                    generated,
                    patched_files,
                    proposed_packages,
                    stale,
                )

            if stage == "runtime":
                patched_files = {normalize_posix_path(p.path) for p in fix_result.patches}
                validate_runtime_fix(project_dir, runtime_diags, generated, patched_files)



            plan = ProjectPlan.model_validate(state["plan"]) if state.get("plan") else None
            failed_specs = state.get("failed_npm_specs", [])
            plan_specs = _without_failed_specs(plan.npm_dependencies if plan else [], failed_specs)

            pending = merge_package_specs(

                _without_failed_specs(state.get("pending_npm", []), failed_specs),

                plan_specs,

                runtime_fix_deps,

            )

            pending_dev = merge_package_specs(

                _without_failed_specs(state.get("pending_dev_npm", []), failed_specs),

                dev_fix_deps,

            )

            legacy_peer_deps = state.get("legacy_peer_deps", False) or fix_result.use_legacy_peer_deps

            next_build_fix_attempts = (

                state.get("build_fix_attempts", 0) + 1

                if stage == "build"

                else state.get("build_fix_attempts", 0)

            )

            next_runtime_fix_attempts = (

                state.get("runtime_fix_attempts", 0) + 1

                if stage == "runtime"

                else state.get("runtime_fix_attempts", 0)

            )



            result = {

                "generated_files": generated,

                "pending_npm": pending,

                "pending_dev_npm": pending_dev,

                "legacy_peer_deps": legacy_peer_deps,

                "last_error_signature": sig if stage == "build" else prev_sig,

                "last_error_signatures": (
                    current_signatures if stage == "build" else state.get("last_error_signatures", [])
                ),

                "build_no_progress_count": (
                    stale if stage == "build" else state.get("build_no_progress_count", 0)
                ),

                "stale_fix_count": stale if stage == "build" else state.get("stale_fix_count", 0),

                "build_fix_attempts": next_build_fix_attempts,

                "runtime_fix_attempts": next_runtime_fix_attempts,

                "invalid_fix_attempts": 0,

                "last_fix_rejection": "",

            }

            if fix_result.notes:

                logger.info("Fix notes: %s", fix_result.notes)

            logger.info(

                "Patched %s files, %s npm specs",

                len(fix_result.patches),

                len(runtime_fix_deps) + len(dev_fix_deps),

            )

    except Exception as exc:

        invalid_patch = (
            "Fix must patch at least one file with TypeScript errors" in str(exc)
            or "Type diagnostics found verified missing type package candidate" in str(exc)
            or "Proposed npm spec does not exist" in str(exc)
            or "already ships TypeScript types" in str(exc)
            or "already marked failed" in str(exc)
            or "Runtime diagnosis requires" in str(exc)
            or "No-progress build fix must address" in str(exc)
            or "No-progress build fix patched" in str(exc)
            or "Build fix must include error_fixes" in str(exc)
            or "Build fix error_fixes must cover" in str(exc)
            or "Each error_fixes item" in str(exc)
        )

        next_invalid_fix_attempts = (
            state.get("invalid_fix_attempts", 0) + 1 if invalid_patch else 0
        )

        next_fix_attempts = fix_attempts if invalid_patch else fix_attempts + 1

        next_build_fix_attempts = (
            state.get("build_fix_attempts", 0)
            if invalid_patch or stage != "build"
            else state.get("build_fix_attempts", 0) + 1
        )

        next_runtime_fix_attempts = (
            state.get("runtime_fix_attempts", 0)
            if invalid_patch or stage != "runtime"
            else state.get("runtime_fix_attempts", 0) + 1
        )

        logger.warning("Auto-fix attempt %s failed: %s", next_fix_attempts, exc)

        newly_failed_specs = (
            _failed_specs_from_error(str(exc), attempted_fix_specs)
            if attempted_fix_specs
            else []
        )
        next_failed_specs = list(
            dict.fromkeys([*state.get("failed_npm_specs", []), *newly_failed_specs])
        )

        if _should_give_up(
            {
                **state,
                "fix_attempts": next_fix_attempts,
                "invalid_fix_attempts": next_invalid_fix_attempts,
                "build_fix_attempts": next_build_fix_attempts,
                "runtime_fix_attempts": next_runtime_fix_attempts,
                "last_error_signatures": current_signatures
                if stage == "build"
                else state.get("last_error_signatures", []),
                "build_no_progress_count": stale
                if stage == "build"
                else state.get("build_no_progress_count", 0),
                "stale_fix_count": stale,
                "failed_npm_specs": next_failed_specs,
            }
        ):

            if next_invalid_fix_attempts >= MAX_INVALID_FIX_ATTEMPTS:
                reason = f"{next_invalid_fix_attempts} invalid fix proposal(s) rejected"
            elif stale >= MAX_STALE_FIX_ATTEMPTS:
                reason = f"TypeScript error set made no progress {stale} time(s)"
            else:
                reason = f"{next_fix_attempts} fix attempt(s) exhausted"

            return {
                "error": f"Auto-fix stopped ({reason}): {exc}",
                "failed_npm_specs": next_failed_specs,
            }

        return {

            **_pending(stage, f"Auto-fix failed: {exc}", target_file=target_file),

            "fix_attempts": next_fix_attempts,

            "invalid_fix_attempts": next_invalid_fix_attempts,

            "build_fix_attempts": next_build_fix_attempts,

            "runtime_fix_attempts": next_runtime_fix_attempts,

            "resume_stage": stage,

            "last_error_signature": sig if stage == "build" else prev_sig,

            "last_error_signatures": (
                current_signatures if stage == "build" else state.get("last_error_signatures", [])
            ),

            "build_no_progress_count": (
                stale if stage == "build" else state.get("build_no_progress_count", 0)
            ),

            "stale_fix_count": stale if stage == "build" else state.get("stale_fix_count", 0),

            "failed_npm_specs": next_failed_specs,

            "last_fix_rejection": str(exc)[:2000] if invalid_patch else "",

        }



    return {

        **result,

        "fix_attempts": fix_attempts + 1,

        "pending_error": "",

        "failure_stage": "",

        "target_file": "",

        "resume_stage": stage,

        "error": None,

    }





def finalize(state: AgentState) -> dict:

    files = sorted(state.get("generated_files", {}).keys())

    fix_attempts = state.get("fix_attempts", 0)

    build_attempts = state.get("build_attempts", 0)

    dep_attempts = state.get("dep_attempts", 0)
    runtime_attempts = state.get("runtime_attempts", 0)
    warnings = state.get("warnings", [])



    reply = f"Generated {len(files)} files and passed the production build."
    if state.get("reply"):
        reply += f" {state['reply']}"
    if warnings:
        reply += f" There are {len(warnings)} information or asset warnings; the preview was preserved and warnings were returned to the frontend."

    if fix_attempts or dep_attempts:

        reply += " (auto-repaired"

        if fix_attempts:

            reply += f" {fix_attempts} times"

        if dep_attempts:

            reply += f", npm install retried {dep_attempts} times"

        if build_attempts:

            reply += f", succeeded after {build_attempts} failed build attempts"
        if runtime_attempts:

            reply += f", runtime smoke retried {runtime_attempts} times"

        reply += ")"



    return {

        "files": files,

        "reply": reply,

        "build_log": state.get("build_log", ""),

        "warnings": warnings,

        "error": None,

    }


def finalize_draft(state: AgentState) -> dict:
    files = sorted(state.get("generated_files", {}).keys())
    fix_attempts = state.get("fix_attempts", 0)
    dep_attempts = state.get("dep_attempts", 0)
    warnings = state.get("warnings", [])

    reply = f"Generated {len(files)} draft files. Live preview updates first, and backend verification runs separately."
    if fix_attempts or dep_attempts:
        reply += " (auto-repaired"
        if fix_attempts:
            reply += f" {fix_attempts} times"
        if dep_attempts:
            reply += f", npm install retried {dep_attempts} times"
        reply += ")"

    return {
        "files": files,
        "reply": reply,
        "build_log": state.get("build_log", ""),
        "warnings": warnings,
        "error": None,
    }


def mark_failure(state: AgentState) -> dict:

    if state.get("error"):

        return {"build_log": state.get("build_log", "")}



    stage = state.get("failure_stage") or state.get("resume_stage") or "unknown"

    detail = state.get("pending_error") or "unknown error"

    stale = state.get("stale_fix_count", 0)

    if stale >= MAX_STALE_FIX_ATTEMPTS:

        reason = f"TypeScript error set made no progress {stale} time(s)"

    elif stage == "dependency" and state.get("dep_attempts", 0) >= MAX_DEP_FIX_ATTEMPTS:

        reason = f"{state.get('dep_attempts', 0)} dependency fix attempt(s) exhausted"

    elif stage == "build" and state.get("build_fix_attempts", 0) >= MAX_BUILD_FIX_ATTEMPTS:

        reason = f"{state.get('build_fix_attempts', 0)} build fix attempt(s) exhausted"

    elif stage == "runtime" and state.get("runtime_fix_attempts", 0) >= MAX_RUNTIME_FIX_ATTEMPTS:

        reason = f"{state.get('runtime_fix_attempts', 0)} runtime fix attempt(s) exhausted"

    else:

        reason = f"{state.get('fix_attempts', 0)} total auto-fix attempt(s) exhausted"

    return {

        "error": (

            f"Failed at stage '{stage}' after {reason}. "

            f"Last error: {detail}"

        ),

        "build_log": state.get("build_log", ""),

    }





def _route_after_fix(state: AgentState) -> str:

    if state.get("error"):

        return "fail"

    if state.get("pending_error"):

        if _should_give_up(state):

            return "fail"

        return "fix"

    return RESUME_AFTER_FIX.get(state.get("resume_stage", "sync"), "sync")





def build_website_builder_graph():

    graph = StateGraph(AgentState)

    graph.add_node("plan", plan_project)

    graph.add_node("generate", generate_files)

    graph.add_node("repair", repair_missing_imports)

    graph.add_node("sync", sync_project)

    graph.add_node("build", run_build)

    graph.add_node("smoke", smoke_project)

    graph.add_node("fix", fix_project)

    graph.add_node("finalize", finalize)

    graph.add_node("mark_failure", mark_failure)



    graph.add_edge(START, "plan")

    graph.add_conditional_edges(

        "plan",

        lambda s: _route_if_pending(s, "generate"),

        {"generate": "generate", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "generate",

        lambda s: _route_if_pending(s, "repair"),

        {"repair": "repair", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "repair",

        lambda s: _route_if_pending(s, "sync"),

        {"sync": "sync", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "sync",

        lambda s: _route_if_pending(s, "build"),

        {"build": "build", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "build",

        lambda s: _route_if_pending(s, "smoke") if s.get("build_success") else _route_if_pending(s, "fix"),

        {"smoke": "smoke", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "smoke",

        lambda s: _route_if_pending(s, "finalize"),

        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},

    )

    graph.add_conditional_edges(

        "fix",

        _route_after_fix,

        {

            "plan": "plan",

            "generate": "generate",

            "repair": "repair",

            "sync": "sync",

            "fix": "fix",

            "smoke": "smoke",

            "fail": "mark_failure",

        },

    )

    graph.add_edge("finalize", END)

    graph.add_edge("mark_failure", END)

    return graph.compile()





def build_website_edit_graph():

    graph = StateGraph(AgentState)

    graph.add_node("sync", sync_project)
    graph.add_node("build", run_build)
    graph.add_node("smoke", smoke_project)
    graph.add_node("fix", fix_project)
    graph.add_node("finalize", finalize)
    graph.add_node("mark_failure", mark_failure)

    graph.add_edge(START, "sync")

    graph.add_conditional_edges(
        "sync",
        lambda s: _route_if_pending(s, "build"),
        {"build": "build", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "build",
        lambda s: _route_if_pending(s, "smoke") if s.get("build_success") else _route_if_pending(s, "fix"),
        {"smoke": "smoke", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "smoke",
        lambda s: _route_if_pending(s, "finalize"),
        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "fix",
        _route_after_fix,
        {"sync": "sync", "fix": "fix", "smoke": "smoke", "fail": "mark_failure"},
    )

    graph.add_edge("finalize", END)
    graph.add_edge("mark_failure", END)
    return graph.compile()


def build_website_draft_graph():
    graph = StateGraph(AgentState)

    graph.add_node("plan", plan_project)
    graph.add_node("generate", generate_files)
    graph.add_node("repair", repair_missing_imports)
    graph.add_node("sync", sync_project)
    graph.add_node("fix", fix_project)
    graph.add_node("finalize", finalize_draft)
    graph.add_node("mark_failure", mark_failure)

    graph.add_edge(START, "plan")
    graph.add_conditional_edges(
        "plan",
        lambda s: _route_if_pending(s, "generate"),
        {"generate": "generate", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "generate",
        lambda s: _route_if_pending(s, "repair"),
        {"repair": "repair", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "repair",
        lambda s: _route_if_pending(s, "sync"),
        {"sync": "sync", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "sync",
        lambda s: _route_if_pending(s, "finalize"),
        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "fix",
        _route_after_fix,
        {"plan": "plan", "generate": "generate", "repair": "repair", "sync": "sync", "fix": "fix", "fail": "mark_failure"},
    )

    graph.add_edge("finalize", END)
    graph.add_edge("mark_failure", END)
    return graph.compile()


website_builder_graph = build_website_builder_graph()
website_edit_graph = build_website_edit_graph()
website_draft_graph = build_website_draft_graph()


