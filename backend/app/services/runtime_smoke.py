import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.core.config import PLAYWRIGHT_BROWSERS_PATH


BENIGN_CONSOLE_PATTERNS = [
    re.compile(r"favicon", re.IGNORECASE),
    re.compile(r"ResizeObserver loop", re.IGNORECASE),
    re.compile(r"chrome-extension://", re.IGNORECASE),
    re.compile(r"DevTools.*source map", re.IGNORECASE),
]


@dataclass
class RuntimeSmokeResult:
    ok: bool
    log: str
    errors: list[str] = field(default_factory=list)
    infrastructure_error: bool = False


def _is_benign(message: str) -> bool:
    return any(pattern.search(message) for pattern in BENIGN_CONSOLE_PATTERNS)


def _add_error(errors: list[str], message: str) -> None:
    if message not in errors:
        errors.append(message)


def _asset_failure_hint(url: str) -> str:
    filename = urlparse(url).path.rsplit("/", 1)[-1]
    if filename in {"marker-icon.png", "marker-icon-2x.png", "marker-shadow.png"}:
        return (
            "Likely Leaflet default marker asset path issue. "
            "Fix source by importing Leaflet CSS/assets via Vite ESM, for example "
            "`import 'leaflet/dist/leaflet.css'`, import marker icon URLs from "
            "`leaflet/dist/images/...`, and configure `L.Icon.Default.mergeOptions(...)`; "
            "do not patch dist files."
        )
    return (
        "Missing preview asset. Fix source asset references so production build emits and serves "
        "the file under the preview base path."
    )


def _browser_env() -> dict[str, str]:
    return {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": PLAYWRIGHT_BROWSERS_PATH}


def _is_missing_browser_error(message: str) -> bool:
    return "Executable doesn't exist" in message or "playwright install" in message


def _install_chromium() -> tuple[bool, str]:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            capture_output=True,
            text=True,
            check=False,
            timeout=240,
            env=_browser_env(),
        )
    except subprocess.TimeoutExpired:
        return False, "Timed out installing Playwright Chromium browser"

    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.returncode != 0:
        return False, output or "Playwright Chromium install failed"
    return True, output or "Playwright Chromium installed"


def run_runtime_smoke_test(
    project_id: str,
    *,
    base_url: str,
    timeout_ms: int,
) -> RuntimeSmokeResult:
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = PLAYWRIGHT_BROWSERS_PATH

    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        return RuntimeSmokeResult(
            ok=False,
            log=(
                "Browser runtime smoke test could not start: Playwright is not installed. "
                "Run `pip install -r backend/requirements.txt` and "
                "`python -m playwright install chromium`."
            ),
            infrastructure_error=True,
        )

    preview_url = f"{base_url.rstrip('/')}/api/projects/{project_id}/preview/"
    errors: list[str] = []

    try:
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(headless=True)
            except PlaywrightError as exc:
                if not _is_missing_browser_error(str(exc)):
                    raise
                installed, install_log = _install_chromium()
                if not installed:
                    return RuntimeSmokeResult(
                        ok=False,
                        infrastructure_error=True,
                        log=(
                            "Browser runtime smoke test could not install Playwright Chromium.\n"
                            f"{install_log}"
                        ),
                    )
                browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()

            def on_console(msg) -> None:
                if msg.type != "error":
                    return
                text = msg.text
                if not _is_benign(text):
                    _add_error(errors, f"console.error: {text}")

            def on_page_error(exc) -> None:
                message = str(exc)
                if not _is_benign(message):
                    _add_error(errors, f"pageerror: {message}")

            def on_response(response) -> None:
                url = response.url
                if f"/api/projects/{project_id}/preview/" in url and response.status >= 400:
                    _add_error(errors, f"HTTP {response.status}: {url}\n  hint: {_asset_failure_hint(url)}")

            def on_request_failed(request) -> None:
                url = request.url
                if f"/api/projects/{project_id}/preview/" in url:
                    failure = request.failure
                    _add_error(errors, f"requestfailed: {url} ({failure})")

            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("response", on_response)
            page.on("requestfailed", on_request_failed)

            page.goto(preview_url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1000)

            root_state = page.evaluate(
                """() => {
                    const root = document.querySelector('#root');
                    if (!root) return { exists: false, text: '', childCount: 0, visibleText: '' };
                    const text = (root.textContent || '').trim();
                    const visibleText = (document.body.innerText || '').trim();
                    return {
                        exists: true,
                        text,
                        visibleText,
                        childCount: root.childElementCount,
                    };
                }"""
            )

            if not root_state.get("exists"):
                _add_error(errors, "#root element was not found")
            elif root_state.get("childCount", 0) == 0:
                _add_error(errors, "#root has no rendered children")
            elif not root_state.get("visibleText"):
                _add_error(errors, "document.body has no visible text after rendering")

            browser.close()
    except PlaywrightError as exc:
        message = str(exc)
        if _is_missing_browser_error(message):
            return RuntimeSmokeResult(
                ok=False,
                infrastructure_error=True,
                log=(
                    "Browser runtime smoke test infrastructure is not ready: "
                    "Playwright Chromium executable is missing. "
                    f"Configured PLAYWRIGHT_BROWSERS_PATH={PLAYWRIGHT_BROWSERS_PATH}.\n"
                    f"{message}"
                ),
            )
        _add_error(errors, f"playwright error: {exc}")
    except Exception as exc:
        _add_error(errors, f"runtime smoke test failed: {exc}")

    if errors:
        return RuntimeSmokeResult(
            ok=False,
            errors=errors,
            log=(
                "Browser runtime smoke test failed.\n"
                f"URL: {preview_url}\n"
                + "\n".join(f"- {error}" for error in errors)
            ),
        )

    return RuntimeSmokeResult(
        ok=True,
        log=f"Browser runtime smoke test passed for {preview_url}",
    )
