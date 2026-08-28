from app.agents.state import AgentState
from app.core.config import (
    MAX_BUILD_FIX_ATTEMPTS,
    MAX_DEP_FIX_ATTEMPTS,
    MAX_INVALID_FIX_ATTEMPTS,
    MAX_RUNTIME_FIX_ATTEMPTS,
    MAX_TOTAL_FIX_ATTEMPTS,
)


RESUME_AFTER_FIX = {
    "plan": "plan",
    "generate": "generate",
    "repair": "repair",
    "sync": "sync",
    "dependency": "sync",
    "build": "sync",
    "runtime": "sync",
    "fix": "sync",
}


def should_give_up(state: AgentState) -> bool:
    if state.get("fix_attempts", 0) >= MAX_TOTAL_FIX_ATTEMPTS:
        return True
    stage = state.get("failure_stage") or state.get("resume_stage")
    if stage == "dependency" and state.get("dep_attempts", 0) >= MAX_DEP_FIX_ATTEMPTS:
        return True
    if stage == "build" and state.get("build_fix_attempts", 0) >= MAX_BUILD_FIX_ATTEMPTS:
        return True
    if stage == "runtime" and state.get("runtime_fix_attempts", 0) >= MAX_RUNTIME_FIX_ATTEMPTS:
        return True
    return state.get("invalid_fix_attempts", 0) >= MAX_INVALID_FIX_ATTEMPTS


def route_if_pending(state: AgentState, success: str) -> str:
    if state.get("error"):
        return "fail"
    if state.get("pending_error"):
        return "fail" if should_give_up(state) else "fix"
    return success


def route_after_fix(state: AgentState) -> str:
    if state.get("error"):
        return "fail"
    if state.get("pending_error"):
        return "fail" if should_give_up(state) else "fix"
    return RESUME_AFTER_FIX.get(state.get("resume_stage", "sync"), "sync")


def route_after_approval(state: AgentState, success: str) -> str:
    return "fail" if state.get("error") else success
