from types import SimpleNamespace

from app.api.routes import projects
from app.schemas.diagnostics import ProjectDiagnosticsResponse


def _diagnostics(project_id: str, *, passed: bool, build_log: str) -> ProjectDiagnosticsResponse:
    return ProjectDiagnosticsResponse(
        project_id=project_id,
        status="passed" if passed else "failed",
        build_log=build_log,
    )


def _prepare_build(monkeypatch) -> None:
    monkeypatch.setattr(projects, "collect_project_sources", lambda _project_dir: {})
    monkeypatch.setattr(projects, "try_build_vite_project", lambda _project_dir, _project_id: (True, "build ok"))
    monkeypatch.setattr(projects, "build_diagnostics_from_log", _diagnostics)
    monkeypatch.setattr(projects, "_attach_source_changes", lambda *_args, **_kwargs: None)


def test_ready_requires_browser_check(monkeypatch, tmp_path) -> None:
    _prepare_build(monkeypatch)
    monkeypatch.setattr(
        projects,
        "run_runtime_smoke_test",
        lambda *_args, **_kwargs: SimpleNamespace(
            ok=True,
            infrastructure_error=False,
            errors=[],
            log="browser ok",
        ),
    )

    result = projects._verify_project_with_repair("project-1", tmp_path)

    assert result.status == "passed"
    assert "Website opened successfully in a browser" in result.notes


def test_browser_failure_uses_runtime_repair_then_rechecks(monkeypatch, tmp_path) -> None:
    _prepare_build(monkeypatch)
    browser_results = iter(
        [
            SimpleNamespace(
                ok=False,
                infrastructure_error=False,
                errors=["pageerror: broken interaction"],
                log="browser failed",
            ),
            SimpleNamespace(
                ok=True,
                infrastructure_error=False,
                errors=[],
                log="browser ok",
            ),
        ]
    )
    monkeypatch.setattr(projects, "run_runtime_smoke_test", lambda *_args, **_kwargs: next(browser_results))
    repair_stages: list[str] = []

    def repair(*_args, failure_stage="build", **_kwargs):
        repair_stages.append(failure_stage)
        return True

    monkeypatch.setattr(projects, "_apply_verify_repair", repair)

    result = projects._verify_project_with_repair("project-1", tmp_path)

    assert result.status == "passed"
    assert repair_stages == ["runtime"]


def test_browser_infrastructure_failure_is_not_marked_ready(monkeypatch, tmp_path) -> None:
    _prepare_build(monkeypatch)
    monkeypatch.setattr(
        projects,
        "run_runtime_smoke_test",
        lambda *_args, **_kwargs: SimpleNamespace(
            ok=False,
            infrastructure_error=True,
            errors=[],
            log="browser unavailable",
        ),
    )

    result = projects._verify_project_with_repair("project-1", tmp_path)

    assert result.status == "failed"
    assert result.runtime_errors == ["browser unavailable"]
    assert "browser unavailable" in result.build_log
