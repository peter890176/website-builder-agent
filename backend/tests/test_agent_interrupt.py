import sqlite3

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.agents.approval import approve_repair
from app.agents.state import AgentState


def test_repair_interrupt_can_be_resumed() -> None:
    builder = StateGraph(AgentState)
    builder.add_node("approval", approve_repair)
    builder.add_edge(START, "approval")
    builder.add_edge("approval", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "repair-approval-test"}}
    state = {
        "project_id": "project-1",
        "run_id": "run-1",
        "require_approval": True,
        "failure_stage": "build",
        "pending_error": "TypeScript failed",
        "fix_attempts": 0,
    }

    interrupted = graph.invoke(state, config=config)
    assert interrupted["__interrupt__"][0].value["kind"] == "repair"

    resumed = graph.invoke(Command(resume={"action": "approve"}), config=config)
    assert resumed["approval_status"] == "approved"


def test_interrupt_can_resume_after_sqlite_reopen(tmp_path) -> None:
    database = tmp_path / "checkpoints.sqlite3"
    config = {"configurable": {"thread_id": "durable-repair-test"}}
    state = {
        "project_id": "project-1",
        "run_id": "run-1",
        "require_approval": True,
        "failure_stage": "build",
        "pending_error": "TypeScript failed",
        "fix_attempts": 0,
    }

    first_connection = sqlite3.connect(database, check_same_thread=False)
    first_builder = StateGraph(AgentState)
    first_builder.add_node("approval", approve_repair)
    first_builder.add_edge(START, "approval")
    first_builder.add_edge("approval", END)
    first_graph = first_builder.compile(checkpointer=SqliteSaver(first_connection))
    interrupted = first_graph.invoke(state, config=config)
    assert interrupted["__interrupt__"]
    first_connection.close()

    resumed_connection = sqlite3.connect(database, check_same_thread=False)
    resumed_builder = StateGraph(AgentState)
    resumed_builder.add_node("approval", approve_repair)
    resumed_builder.add_edge(START, "approval")
    resumed_builder.add_edge("approval", END)
    resumed_graph = resumed_builder.compile(checkpointer=SqliteSaver(resumed_connection))
    resumed = resumed_graph.invoke(Command(resume={"action": "approve"}), config=config)
    resumed_connection.close()

    assert resumed["approval_status"] == "approved"
