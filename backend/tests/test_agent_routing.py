from app.agents.routing import route_after_approval, route_after_fix, route_if_pending


def test_pending_error_routes_to_fix() -> None:
    state = {"pending_error": "build failed", "failure_stage": "build", "fix_attempts": 0}

    assert route_if_pending(state, "smoke") == "fix"


def test_error_routes_to_failure() -> None:
    assert route_if_pending({"error": "fatal"}, "sync") == "fail"
    assert route_after_approval({"error": "rejected"}, "sync") == "fail"


def test_repair_resumes_at_validation_stage() -> None:
    assert route_after_fix({"resume_stage": "runtime"}) == "sync"
    assert route_after_fix({"resume_stage": "generate"}) == "generate"


def test_exhausted_repairs_route_to_failure() -> None:
    state = {
        "pending_error": "still broken",
        "failure_stage": "build",
        "build_fix_attempts": 4,
        "fix_attempts": 4,
    }

    assert route_if_pending(state, "smoke") == "fail"
