from __future__ import annotations

import re


UI_COMPONENT_CONTRACT = """Shared UI contract (all generated and repaired files must follow this):
- Badge accepts variant="default" | "primary" | "success" | "warning". Never use tone.
- Button accepts variant="primary" | "secondary" | "outline" | "ghost". For links use href directly or asChild with an <a>; do not put href on a native button.
- SectionHeader accepts align="center" | "left". Never use centered.
- Tailwind CSS 4 is installed. Theme colours, typography, radius, shadows, layout, and responsive styling remain project-specific through Tailwind utilities; this contract only fixes TypeScript prop names and behaviour.
"""


def ui_contract_diagnostics(sources: dict[str, str], build_log: str) -> str:
    """Summarise shared UI prop drift so a repair fixes the cause, not each call site."""
    ui_source = sources.get("src/components/ui.tsx", "")
    if not ui_source:
        return "No shared src/components/ui.tsx file was found."

    counts: dict[tuple[str, str], int] = {}
    for path, line, prop in re.findall(
        r"([^:\n]+):(\d+):\d+\s+TS2322[\s\S]*?Property '([^']+)' does not exist",
        build_log,
    ):
        source = sources.get(path, "")
        line_index = max(int(line) - 1, 0)
        nearby = "\n".join(source.splitlines()[max(0, line_index - 1): line_index + 2])
        component = next((name for name in ("Badge", "Button", "SectionHeader") if f"<{name}" in nearby), "unknown")
        counts[(component, prop)] = counts.get((component, prop), 0) + 1

    if not counts:
        return "No shared UI prop drift was detected."

    groups = ", ".join(
        f"{component}.{prop} ({count} error(s))"
        for (component, prop), count in sorted(counts.items())
    )
    return (
        f"Detected shared UI contract drift: {groups}. "
        "Inspect src/components/ui.tsx and repair the shared contract or all affected call sites together. "
        "Do not treat these as unrelated per-page errors.\n\n"
        f"{UI_COMPONENT_CONTRACT}"
    )
