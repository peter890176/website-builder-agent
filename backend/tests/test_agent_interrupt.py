import sqlite3

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.agents.approval import approve_dependencies, approve_repair
from app.agents.state import AgentState


def _dependency_state() -> AgentState:
    return {
        "project_id": "project-1",
        "run_id": "run-1",
        "require_approval": True,
        "plan": {
            "summary": "Dashboard",
            "files": [{"path": "src/App.tsx", "description": "Dashboard UI", "file_type": "tsx"}],
            "npm_dependencies": ["recharts"],
        },
    }


def test_repair_compatibility_node_no_longer_interrupts() -> None:
    result = approve_repair({"pending_error": "TypeScript failed"})
    assert result == {"approval_status": "approved"}


def test_dependency_interrupt_can_be_resumed() -> None:
    builder = StateGraph(AgentState)
    builder.add_node("approval", approve_dependencies)
    builder.add_edge(START, "approval")
    builder.add_edge("approval", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "dependency-approval-test"}}

    interrupted = graph.invoke(_dependency_state(), config=config)
    assert interrupted["__interrupt__"][0].value["kind"] == "dependency_install"

    resumed = graph.invoke(Command(resume={"action": "approve"}), config=config)
    assert resumed["approval_status"] == "approved"


def test_interrupt_can_resume_after_sqlite_reopen(tmp_path) -> None:
    database = tmp_path / "checkpoints.sqlite3"
    config = {"configurable": {"thread_id": "durable-dependency-test"}}

    first_connection = sqlite3.connect(database, check_same_thread=False)
    first_builder = StateGraph(AgentState)
    first_builder.add_node("approval", approve_dependencies)
    first_builder.add_edge(START, "approval")
    first_builder.add_edge("approval", END)
    first_graph = first_builder.compile(checkpointer=SqliteSaver(first_connection))
    interrupted = first_graph.invoke(_dependency_state(), config=config)
    assert interrupted["__interrupt__"]
    first_connection.close()

    resumed_connection = sqlite3.connect(database, check_same_thread=False)
    resumed_builder = StateGraph(AgentState)
    resumed_builder.add_node("approval", approve_dependencies)
    resumed_builder.add_edge(START, "approval")
    resumed_builder.add_edge("approval", END)
    resumed_graph = resumed_builder.compile(checkpointer=SqliteSaver(resumed_connection))
    resumed = resumed_graph.invoke(Command(resume={"action": "approve"}), config=config)
    resumed_connection.close()

    assert resumed["approval_status"] == "approved"
