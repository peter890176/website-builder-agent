from typing import TypedDict





class AgentState(TypedDict):

    message: str

    project_id: str

    workspace_path: str

    plan: dict

    generated_files: dict[str, str]

    pending_npm: list[str]
    pending_dev_npm: list[str]

    files: list[str]

    reply: str
    warnings: list[dict]

    error: str | None

    build_success: bool

    build_attempts: int
    build_fix_attempts: int
    runtime_attempts: int
    runtime_fix_attempts: int

    fix_attempts: int
    invalid_fix_attempts: int

    dep_attempts: int

    pending_error: str

    failure_stage: str

    target_file: str

    resume_stage: str

    legacy_peer_deps: bool

    build_log: str

    failed_npm_specs: list[str]
    last_fix_rejection: str
    last_error_signature: str
    last_error_signatures: list[str]
    build_no_progress_count: int
    stale_fix_count: int
