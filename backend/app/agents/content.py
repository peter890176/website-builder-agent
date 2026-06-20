import json
import re


def extract_code_block(content: str) -> str:
    text = content.strip()
    fence_match = re.search(
        r"```(?:tsx|ts|jsx|typescript|css|json|svg|javascript|js)?\s*(.*?)\s*```",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if fence_match:
        text = fence_match.group(1).strip()
    return text


def strip_language_marker(content: str) -> str:
    markers = ("typescript", "tsx", "javascript", "json", "css", "svg")
    first_line = content.split("\n", 1)[0].strip().lower()
    if first_line in markers and "\n" in content:
        return content.split("\n", 1)[1].strip()
    return content


def normalize_svg_content(content: str) -> str:
    cleaned = strip_language_marker(extract_code_block(content))
    svg_match = re.search(r"<svg\b", cleaned, re.IGNORECASE)
    if svg_match:
        return cleaned[svg_match.start() :].strip()

    if cleaned.lstrip().startswith("<"):
        return cleaned.strip()

    raise ValueError("SVG file must contain an <svg> element")


def clean_generated_content(content: str, file_type: str) -> str:
    cleaned = strip_language_marker(extract_code_block(content))

    if file_type == "json":
        json.loads(cleaned)
        return cleaned

    if file_type == "svg":
        return normalize_svg_content(content)

    return cleaned


def is_valid_entry_tsx(path: str, source: str) -> bool:
    if path.replace("\\", "/").lower() != "src/app.tsx":
        return True
    lowered = source.lower()
    return ("function app" in lowered or "const app" in lowered) and "export default" in lowered
