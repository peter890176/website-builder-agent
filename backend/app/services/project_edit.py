import json
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.agents.content import clean_generated_content
from app.core.config import OPENAI_FIX_MODEL, get_openai_api_key
from app.schemas.build_fix import FilePatch
from app.services.build_fix import collect_project_sources


EDIT_SYSTEM_PROMPT = """You edit an existing Vite + React + TypeScript website.

Rules:
- Make the smallest set of changes needed to satisfy the user's edit request.
- Preserve the existing project structure and working behavior.
- Return FULL updated file contents for every file you patch.
- The project uses the React 17+ JSX transform. Do not add `import React from "react";`
  unless the `React` identifier is explicitly used in code.
- Do not rewrite the whole project unless the user explicitly asks for a redesign.
- Do not hallucinate missing facts or assets. Use placeholder, disabled state, or "To be provided / Needs confirmation" when information is missing.
- Static assets must live under public/assets/* and be referenced with `${import.meta.env.BASE_URL}assets/name.ext` from TSX.
- Do not reference local binary/media files unless they already exist or are explicitly provided.
- Add npm_dependencies only when the edited source imports a package that is not already installed.
"""


class ProjectEditResult(BaseModel):
    patches: list[FilePatch] = Field(
        default_factory=list,
        description="Full-file patches for existing or new files under src/ or public/.",
    )
    npm_dependencies: list[str] = Field(default_factory=list)
    dev_dependencies: list[str] = Field(default_factory=list)
    notes: str = Field(default="", description="Short summary of the edit")
    warnings: list[dict] = Field(default_factory=list)


def request_project_edit(
    project_dir: Path,
    user_message: str,
    *,
    context_files: list[str] | None = None,
    current_file: str | None = None,
    selected_text: str = "",
    selected_range: str = "",
    diagnostics_summary: str = "",
    existing_warnings: list[dict] | None = None,
) -> ProjectEditResult:
    api_key = get_openai_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    sources = collect_project_sources(project_dir)
    if not sources:
        raise RuntimeError("No existing project sources found to edit")

    manifest = "\n".join(f"- {path}" for path in sorted(sources))
    requested_context = {
        path.replace("\\", "/")
        for path in [*(context_files or []), current_file or ""]
        if path
    }
    context_sources = {
        path: sources[path]
        for path in sorted(requested_context)
        if path in sources
    }
    files_to_send = context_sources or sources
    files = "\n\n".join(
        f"### {path}\n{content[:7000]}" for path, content in sorted(files_to_send.items())
    )
    context_note = "\n".join(
        line
        for line in (
            f"Current file: {current_file or 'none'}",
            f"Selected range: {selected_range or 'none'}",
            f"Selected text:\n{selected_text}" if selected_text else "Selected text: none",
            f"Diagnostics summary:\n{diagnostics_summary}" if diagnostics_summary else "Diagnostics summary: none",
            (
                "Only full contents for selected context files are included below. "
                "Use the manifest to request or infer related files, but patch only files needed for the edit."
                if context_sources
                else "Full project contents are included below."
            ),
        )
    )
    package_json = project_dir / "package.json"
    package_text = package_json.read_text(encoding="utf-8") if package_json.is_file() else "{}"

    llm = ChatOpenAI(model=OPENAI_FIX_MODEL, api_key=api_key, temperature=0.1)
    editor = llm.with_structured_output(ProjectEditResult, method="function_calling")

    return editor.invoke(
        [
            SystemMessage(content=EDIT_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"User edit request:\n{user_message}\n\n"
                    f"Existing warnings:\n{json.dumps(existing_warnings or [], ensure_ascii=False)}\n\n"
                    f"Cursor-style edit context:\n{context_note}\n\n"
                    f"package.json:\n{package_text}\n\n"
                    f"Current file manifest:\n{manifest}\n\n"
                    f"Project files provided for this edit:\n{files}"
                )
            ),
        ]
    )


def clean_edit_patches(result: ProjectEditResult) -> ProjectEditResult:
    cleaned: list[FilePatch] = []
    for patch in result.patches:
        path = patch.path.replace("\\", "/")
        file_type = _file_type(path)
        cleaned.append(
            FilePatch(
                path=path,
                content=clean_generated_content(patch.content, file_type),
            )
        )
    return ProjectEditResult(
        patches=cleaned,
        npm_dependencies=result.npm_dependencies,
        dev_dependencies=result.dev_dependencies,
        notes=result.notes,
        warnings=result.warnings,
    )


def _file_type(path: str) -> str:
    if path.endswith(".json"):
        return "json"
    if path.endswith(".css"):
        return "css"
    if path.endswith(".svg"):
        return "svg"
    return "tsx"
