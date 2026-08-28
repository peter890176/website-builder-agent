from typing import Any

from langgraph.types import interrupt

from app.agents.state import AgentState
from app.schemas.plan import ProjectPlan
from app.services.dependencies import merge_package_specs


def _approved(decision: Any) -> bool:
    if isinstance(decision, bool):
        return decision
    if isinstance(decision, dict):
        return decision.get("action") == "approve" or decision.get("approved") is True
    return str(decision).strip().lower() in {"approve", "approved", "yes", "true"}


def approve_dependencies(state: AgentState) -> dict:
    if not state.get("require_approval"):
        return {}

    plan = ProjectPlan.model_validate(state["plan"])
    packages = merge_package_specs(plan.npm_dependencies, state.get("pending_npm", []))
    dev_packages = merge_package_specs(state.get("pending_dev_npm", []))
    if not packages and not dev_packages:
        return {}

    decision = interrupt(
        {
            "kind": "dependency_install",
            "question": "Approve the dependencies requested by the agent?",
            "packages": packages,
            "dev_packages": dev_packages,
            "project_id": state["project_id"],
            "run_id": state.get("run_id", ""),
        }
    )
    if not _approved(decision):
        return {
            "approval_status": "rejected",
            "error": "Dependency installation was rejected by the reviewer.",
        }
    return {"approval_status": "approved"}


def approve_repair(state: AgentState) -> dict:
    if not state.get("require_approval"):
        return {}

    decision = interrupt(
        {
            "kind": "repair",
            "question": "Approve another autonomous repair attempt?",
            "stage": state.get("failure_stage", "unknown"),
            "error": state.get("pending_error", ""),
            "attempt": state.get("fix_attempts", 0) + 1,
            "project_id": state["project_id"],
            "run_id": state.get("run_id", ""),
        }
    )
    if not _approved(decision):
        return {
            "approval_status": "rejected",
            "error": "The autonomous repair was rejected by the reviewer.",
        }
    return {"approval_status": "approved"}
