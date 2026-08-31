from langgraph.graph import END, START, StateGraph

from app.agents.approval import approve_dependencies, approve_repair
from app.agents.checkpoint import checkpointer
from app.agents.graph import (
    finalize,
    finalize_draft,
    fix_project,
    generate_files,
    mark_failure,
    plan_project,
    repair_missing_imports,
    run_build,
    smoke_project,
    sync_project,
)
from app.agents.routing import route_after_approval, route_after_fix, route_if_pending
from app.agents.state import AgentState


def build_website_builder_graph():
    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_project)
    graph.add_node("generate", generate_files)
    graph.add_node("repair", repair_missing_imports)
    graph.add_node("approve_dependencies", approve_dependencies)
    graph.add_node("sync", sync_project)
    graph.add_node("build", run_build)
    graph.add_node("smoke", smoke_project)
    graph.add_node("approve_repair", approve_repair)
    graph.add_node("fix", fix_project)
    graph.add_node("finalize", finalize)
    graph.add_node("mark_failure", mark_failure)

    graph.add_edge(START, "plan")
    graph.add_conditional_edges(
        "plan",
        lambda state: route_if_pending(state, "generate"),
        {"generate": "generate", "fix": "fix", "approve_repair": "approve_repair", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "generate",
        lambda state: route_if_pending(state, "repair"),
        {"repair": "repair", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "repair",
        lambda state: route_if_pending(state, "approve_dependencies"),
        {"approve_dependencies": "approve_dependencies", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "approve_dependencies",
        lambda state: route_after_approval(state, "sync"),
        {"sync": "sync", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "sync",
        lambda state: route_if_pending(state, "build"),
        {"build": "build", "fix": "fix", "approve_repair": "approve_repair", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "build",
        lambda state: route_if_pending(state, "smoke") if state.get("build_success") else route_if_pending(state, "fix"),
        {"smoke": "smoke", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "smoke",
        lambda state: route_if_pending(state, "finalize"),
        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "approve_repair",
        lambda state: route_after_approval(state, "fix"),
        {"fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "fix",
        route_after_fix,
        {
            "plan": "plan",
            "generate": "generate",
            "repair": "repair",
            "sync": "sync",
            "fix": "fix",
            "smoke": "smoke",
            "fail": "mark_failure",
        },
    )
    graph.add_edge("finalize", END)
    graph.add_edge("mark_failure", END)
    return graph.compile(checkpointer=checkpointer)


def build_website_edit_graph():
    graph = StateGraph(AgentState)
    graph.add_node("approve_dependencies", approve_dependencies)
    graph.add_node("sync", sync_project)
    graph.add_node("build", run_build)
    graph.add_node("smoke", smoke_project)
    graph.add_node("approve_repair", approve_repair)
    graph.add_node("fix", fix_project)
    graph.add_node("finalize", finalize)
    graph.add_node("mark_failure", mark_failure)

    graph.add_edge(START, "approve_dependencies")
    graph.add_conditional_edges(
        "approve_dependencies",
        lambda state: route_after_approval(state, "sync"),
        {"sync": "sync", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "sync",
        lambda state: route_if_pending(state, "build"),
        {"build": "build", "fix": "fix", "approve_repair": "approve_repair", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "build",
        lambda state: route_if_pending(state, "smoke") if state.get("build_success") else route_if_pending(state, "fix"),
        {"smoke": "smoke", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "smoke",
        lambda state: route_if_pending(state, "finalize"),
        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "approve_repair",
        lambda state: route_after_approval(state, "fix"),
        {"fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "fix",
        route_after_fix,
        {"sync": "sync", "fix": "fix", "smoke": "smoke", "fail": "mark_failure"},
    )
    graph.add_edge("finalize", END)
    graph.add_edge("mark_failure", END)
    return graph.compile(checkpointer=checkpointer)


def build_website_draft_graph():
    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_project)
    graph.add_node("generate", generate_files)
    graph.add_node("repair", repair_missing_imports)
    graph.add_node("approve_dependencies", approve_dependencies)
    graph.add_node("sync", sync_project)
    graph.add_node("approve_repair", approve_repair)
    graph.add_node("fix", fix_project)
    graph.add_node("finalize", finalize_draft)
    graph.add_node("mark_failure", mark_failure)

    graph.add_edge(START, "plan")
    graph.add_conditional_edges(
        "plan",
        lambda state: route_if_pending(state, "generate"),
        {"generate": "generate", "fix": "fix", "approve_repair": "approve_repair", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "generate",
        lambda state: route_if_pending(state, "repair"),
        {"repair": "repair", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "repair",
        lambda state: route_if_pending(state, "approve_dependencies"),
        {"approve_dependencies": "approve_dependencies", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "approve_dependencies",
        lambda state: route_after_approval(state, "sync"),
        {"sync": "sync", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "sync",
        lambda state: route_if_pending(state, "finalize"),
        {"finalize": "finalize", "fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "approve_repair",
        lambda state: route_after_approval(state, "fix"),
        {"fix": "fix", "fail": "mark_failure"},
    )
    graph.add_conditional_edges(
        "fix",
        route_after_fix,
        {
            "plan": "plan",
            "generate": "generate",
            "repair": "repair",
            "sync": "sync",
            "fix": "fix",
            "fail": "mark_failure",
        },
    )
    graph.add_edge("finalize", END)
    graph.add_edge("mark_failure", END)
    return graph.compile(checkpointer=checkpointer)


website_builder_graph = build_website_builder_graph()
website_edit_graph = build_website_edit_graph()
website_draft_graph = build_website_draft_graph()
