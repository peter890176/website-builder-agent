import json
import uuid
from pathlib import Path

from app.schemas.snapshot import HistoryEvent
from app.services.workspace import ensure_project_dir

BUILDER_DIR = ".builder"
HISTORY_FILE = "history.json"


def _history_path(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path / HISTORY_FILE


def list_history_events(project_id: str) -> list[HistoryEvent]:
    path = _history_path(project_id)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [HistoryEvent.model_validate(item) for item in data]


def append_history_event(
    project_id: str,
    *,
    event_type: str,
    message: str,
    metadata: dict | None = None,
) -> HistoryEvent:
    events = list_history_events(project_id)
    event = HistoryEvent(
        id=uuid.uuid4().hex[:12],
        type=event_type,
        message=message,
        metadata=metadata or {},
    )
    events.append(event)
    _history_path(project_id).write_text(
        json.dumps([item.model_dump() for item in events[-500:]], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return event
