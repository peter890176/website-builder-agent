import json
from pathlib import Path


TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates" / "vite-react-ts"


def test_vite_template_has_tailwind_vite_integration() -> None:
    package_json = json.loads((TEMPLATE_DIR / "package.json").read_text(encoding="utf-8"))
    dev_dependencies = package_json["devDependencies"]
    vite_config = (TEMPLATE_DIR / "vite.config.ts").read_text(encoding="utf-8")
    index_css = (TEMPLATE_DIR / "src" / "index.css").read_text(encoding="utf-8")

    assert dev_dependencies["tailwindcss"]
    assert dev_dependencies["@tailwindcss/vite"]
    assert "import tailwindcss from '@tailwindcss/vite'" in vite_config
    assert "tailwindcss()" in vite_config
    assert '@import "tailwindcss";' in index_css


def test_starter_uses_real_tailwind_utilities_without_legacy_css() -> None:
    app_source = (TEMPLATE_DIR / "src" / "App.tsx").read_text(encoding="utf-8")

    assert 'className="flex min-h-screen' in app_source
    assert "App.css" not in app_source
    assert not (TEMPLATE_DIR / "src" / "App.css").exists()
