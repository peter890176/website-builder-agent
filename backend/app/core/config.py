import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
WORKSPACE_DIR = PROJECT_ROOT / "workspace"
TEMPLATE_DIR = BACKEND_DIR / "templates" / "vite-react-ts"

load_dotenv(BACKEND_DIR / ".env")

CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
OPENAI_FIX_MODEL = os.getenv("OPENAI_FIX_MODEL", "gpt-5.3-codex")
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://127.0.0.1:8000")
PLAYWRIGHT_BROWSERS_PATH = os.getenv(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(BACKEND_DIR / ".playwright-browsers"),
)
MAX_DEP_FIX_ATTEMPTS = int(os.getenv("MAX_DEP_FIX_ATTEMPTS", "2"))
MAX_BUILD_FIX_ATTEMPTS = int(os.getenv("MAX_BUILD_FIX_ATTEMPTS", "4"))
MAX_INVALID_FIX_ATTEMPTS = int(os.getenv("MAX_INVALID_FIX_ATTEMPTS", "3"))
MAX_RUNTIME_FIX_ATTEMPTS = int(os.getenv("MAX_RUNTIME_FIX_ATTEMPTS", "2"))
MAX_STALE_FIX_ATTEMPTS = int(os.getenv("MAX_STALE_FIX_ATTEMPTS", "2"))
MAX_TOTAL_FIX_ATTEMPTS = int(os.getenv("MAX_TOTAL_FIX_ATTEMPTS", "8"))
RUNTIME_SMOKE_TIMEOUT_MS = int(os.getenv("RUNTIME_SMOKE_TIMEOUT_MS", "10000"))
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
VERCEL_TOKEN = os.getenv("VERCEL_TOKEN", "")
NETLIFY_TOKEN = os.getenv("NETLIFY_TOKEN", "")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")


def get_openai_api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "")
