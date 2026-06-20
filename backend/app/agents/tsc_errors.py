import re
from dataclasses import dataclass

TSC_ERROR = re.compile(
    r"^(?P<file>(?:src|public)/[^\s(]+)\((?P<line>\d+),(?P<col>\d+)\): "
    r"error TS(?P<code>\d+): (?P<message>.+)$",
    re.MULTILINE,
)
CONTINUATION = re.compile(r"^\s+(?P<message>.+)$")


@dataclass(frozen=True)
class TscError:
    file: str
    line: int
    col: int
    code: str
    message: str

    def signature(self) -> str:
        return f"{self.file}:{self.line}:TS{self.code}:{self.message}"


def _merge_tsc_messages(log: str) -> list[tuple[str, int, int, str, str]]:
    rows: list[tuple[str, int, int, str, str]] = []
    for line in (log or "").splitlines():
        match = TSC_ERROR.match(line)
        if match:
            rows.append(
                (
                    match.group("file").replace("\\", "/"),
                    int(match.group("line")),
                    int(match.group("col")),
                    match.group("code"),
                    match.group("message").strip(),
                )
            )
            continue
        if rows:
            cont = CONTINUATION.match(line)
            if cont:
                prev = rows[-1]
                rows[-1] = (
                    prev[0],
                    prev[1],
                    prev[2],
                    prev[3],
                    f"{prev[4]} {cont.group('message').strip()}",
                )
    return rows


def parse_tsc_errors(log: str) -> list[TscError]:
    return [
        TscError(file=file, line=line, col=col, code=code, message=message)
        for file, line, col, code, message in _merge_tsc_messages(log)
    ]


def error_signature(log: str) -> str:
    errors = parse_tsc_errors(log)
    if not errors:
        return (log or "").strip()[:500]
    return "|".join(e.signature() for e in errors)


def error_signatures(log: str) -> list[str]:
    errors = parse_tsc_errors(log)
    if not errors:
        fallback = (log or "").strip()[:500]
        return [fallback] if fallback else []
    return [e.signature() for e in errors]


def build_progress_diagnostics(
    current: list[str],
    previous: list[str],
    no_progress_count: int,
) -> str:
    if not current:
        return "none"

    current_set = set(current)
    previous_set = set(previous)
    remaining = [sig for sig in current if sig in previous_set]
    resolved = [sig for sig in previous if sig not in current_set]
    new = [sig for sig in current if sig not in previous_set]

    lines = [
        f"Current TypeScript error count: {len(current)}",
        f"Previous TypeScript error count: {len(previous)}",
        f"Remaining previous errors: {len(remaining)}",
        f"Resolved previous errors: {len(resolved)}",
        f"New errors: {len(new)}",
    ]

    if no_progress_count > 0:
        lines.extend(
            [
                "",
                "IMPORTANT: The previous build-fix attempt did not reduce the TypeScript error set.",
                "Change strategy. Do not repeat the same source edit. Patch every file still listed",
                "in the current TypeScript errors unless a single shared source/data/API change clearly",
                "eliminates all remaining signatures.",
            ]
        )

    lines.append("")
    lines.append("Current signatures:")
    lines.extend(f"- {sig}" for sig in current)

    if remaining:
        lines.append("")
        lines.append("Still failing from previous attempt:")
        lines.extend(f"- {sig}" for sig in remaining)

    if resolved:
        lines.append("")
        lines.append("Resolved since previous attempt:")
        lines.extend(f"- {sig}" for sig in resolved)

    if new:
        lines.append("")
        lines.append("New signatures:")
        lines.extend(f"- {sig}" for sig in new)

    return "\n".join(lines)


def build_fix_hints(log: str) -> str:
    errors = parse_tsc_errors(log)
    if not errors:
        return "none"

    hints: list[str] = []
    error_files = sorted({e.file for e in errors})
    hints.append(f"Files with TypeScript errors (must patch at least one): {', '.join(error_files)}")

    for err in errors:
        if "IntrinsicAttributes" in err.message:
            hints.append(
                f"- {err.file}:{err.line}: A component is used with props it does not declare. "
                "Use package/type diagnostics before deciding whether this is local props drift "
                "or missing third-party type declarations."
            )
        if "LatLngTuple" in err.message or "LatLngExpression" in err.message:
            hints.append(
                f"- {err.file}:{err.line}: Use a tuple literal `[lat, lng]` typed as "
                f"`[number, number]` for react-leaflet coordinates, not a generic number[]."
            )
        if "is not assignable to type 'ReactNode'" in err.message:
            hints.append(
                f"- {err.file}:{err.line}: Do not render JSON objects directly in JSX; format strings first."
            )

    return "\n".join(hints)
