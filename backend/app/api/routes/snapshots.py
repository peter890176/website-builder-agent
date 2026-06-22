from fastapi import APIRouter, HTTPException

from app.schemas.snapshot import (
    HistoryResponse,
    RestoreSnapshotResponse,
    SnapshotCompareFile,
    SnapshotCompareResponse,
    SnapshotCreateRequest,
    SnapshotDetailResponse,
    SnapshotListResponse,
)
from app.services.history import list_history_events
from app.services.snapshot import compare_snapshots, create_snapshot, delete_snapshot, get_snapshot, list_snapshots, read_snapshot_files, restore_snapshot

router = APIRouter(prefix="/api/projects/{project_id}", tags=["snapshots"])


@router.post("/snapshots", response_model=SnapshotDetailResponse)
def post_snapshot(project_id: str, body: SnapshotCreateRequest) -> SnapshotDetailResponse:
    snapshot = create_snapshot(
        project_id,
        label=body.label,
        kind=body.kind,
        prompt=body.prompt,
        notes=body.notes,
    )
    return SnapshotDetailResponse(snapshot=snapshot, files=read_snapshot_files(project_id, snapshot.id))


@router.get("/snapshots", response_model=SnapshotListResponse)
def get_snapshots(project_id: str) -> SnapshotListResponse:
    return SnapshotListResponse(snapshots=list_snapshots(project_id))


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse)
def get_snapshot_detail(project_id: str, snapshot_id: str) -> SnapshotDetailResponse:
    try:
        return SnapshotDetailResponse(
            snapshot=get_snapshot(project_id, snapshot_id),
            files=read_snapshot_files(project_id, snapshot_id),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Snapshot not found") from exc


@router.delete("/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse)
def delete_snapshot_detail(project_id: str, snapshot_id: str) -> SnapshotDetailResponse:
    try:
        snapshot = delete_snapshot(project_id, snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Snapshot not found") from exc
    return SnapshotDetailResponse(snapshot=snapshot, files={})


@router.post("/snapshots/{snapshot_id}/restore", response_model=RestoreSnapshotResponse)
def post_restore_snapshot(project_id: str, snapshot_id: str) -> RestoreSnapshotResponse:
    try:
        snapshot, changed_files = restore_snapshot(project_id, snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Snapshot not found") from exc
    return RestoreSnapshotResponse(snapshot=snapshot, changed_files=changed_files)


@router.get("/snapshots/{from_snapshot_id}/compare/{to_snapshot_id}", response_model=SnapshotCompareResponse)
def get_snapshot_compare(project_id: str, from_snapshot_id: str, to_snapshot_id: str) -> SnapshotCompareResponse:
    try:
        from_snapshot, to_snapshot, changes = compare_snapshots(project_id, from_snapshot_id, to_snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Snapshot not found") from exc
    return SnapshotCompareResponse(
        from_snapshot=from_snapshot,
        to_snapshot=to_snapshot,
        files=[SnapshotCompareFile.model_validate(item) for item in changes],
    )


@router.get("/history", response_model=HistoryResponse)
def get_history(project_id: str) -> HistoryResponse:
    return HistoryResponse(events=list_history_events(project_id))
