import logging
import os
import sqlite3
from pathlib import Path

os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

from langgraph.checkpoint.memory import InMemorySaver

from app.core.config import WORKSPACE_DIR

logger = logging.getLogger(__name__)

def _checkpoint_path() -> Path:
    directory = WORKSPACE_DIR / ".builder"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "langgraph-checkpoints.sqlite3"


def create_checkpointer():
    try:
        from langgraph.checkpoint.sqlite import SqliteSaver
    except ModuleNotFoundError:
        logger.warning(
            "langgraph-checkpoint-sqlite is unavailable; using in-memory checkpoints. "
            "Install backend requirements for durable resume support."
        )
        return InMemorySaver()

    connection = sqlite3.connect(_checkpoint_path(), check_same_thread=False)
    return SqliteSaver(connection)


checkpointer = create_checkpointer()
