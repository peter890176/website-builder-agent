from app.api.routes import projects
from app.services.agent_state import graph_config


def test_graph_config_requires_thread_id() -> None:
    try:
        graph_config("")
    except ValueError as exc:
        assert "run_id" in str(exc)
    else:
        raise AssertionError("Expected an empty run_id to be rejected")


def test_draft_graph_receives_checkpoint_thread_id(monkeypatch, tmp_path) -> None:
    captured: dict = {}

    class FakeGraph:
        def invoke(self, state, config):
            captured["state"] = state
            captured["config"] = config
            return state

    monkeypatch.setattr(projects, "website_draft_graph", FakeGraph())

    result = projects._run_generate_draft("project-1", "Build a portfolio", tmp_path)

    thread_id = captured["config"]["configurable"]["thread_id"]
    assert thread_id.startswith("project-1:draft:")
    assert captured["state"]["run_id"] == thread_id
    assert result["error"] is None
