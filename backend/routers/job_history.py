from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from sqlalchemy.exc import IntegrityError
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from booking_status import normalize_status

router = APIRouter()


def _assert_own_worker(worker_id: int, current: Dict[str, Any]) -> None:
    """Workers may only write their own job history."""
    if current.get("role") != "worker" or str(worker_id) != str(current.get("sub")):
        raise HTTPException(status_code=403, detail="You can only manage your own job history")


def _current_uid(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _assert_can_read(entry: models.JobHistory, current: Dict[str, Any]) -> None:
    """Job history entries expose user/worker ids and free-text completion
    notes (often addresses/contact details), so reads are scoped to the
    participants — never any authenticated stranger."""
    uid = _current_uid(current)
    if current.get("role") == "worker":
        if entry.worker_id != uid:
            raise HTTPException(status_code=403, detail="Not your job history")
    else:
        if entry.user_id != uid:
            raise HTTPException(status_code=403, detail="Not your job history")


def _to_dict(j: models.JobHistory) -> Dict[str, Any]:
    return {
        "id": j.id,
        "booking_id": j.booking_id,
        "worker_id": j.worker_id,
        "user_id": j.user_id,
        "completion_notes": j.completion_notes,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
    }


@router.post("/")
def create_entry(
    payload: schemas.JobHistoryBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Record a completed job. Also bumps the worker's completed_jobs counter.

    Requires a COMPLETED booking belonging to this worker — history entries
    (and the stats they drive) can't be fabricated without real work."""
    if payload.worker_id is None:
        raise HTTPException(status_code=400, detail="worker_id is required")
    _assert_own_worker(payload.worker_id, current)

    if payload.booking_id is None:
        raise HTTPException(status_code=400, detail="booking_id is required")

    booking = db.query(models.Booking).filter(models.Booking.id == payload.booking_id).first()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.worker_id != payload.worker_id:
        raise HTTPException(status_code=403, detail="This booking belongs to another worker")
    # Normalize so legacy spellings ("success") count as completed too.
    if normalize_status(booking.status) != "completed":
        raise HTTPException(status_code=400, detail="Only completed bookings can be added to job history")

    # One history entry per booking — prevents double-counting job stats.
    existing = (
        db.query(models.JobHistory)
        .filter(models.JobHistory.booking_id == payload.booking_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This booking already has a job history entry")

    j = models.JobHistory(
        booking_id=payload.booking_id,
        worker_id=payload.worker_id,
        user_id=booking.user_id,  # always from the booking, never client-supplied
        completion_notes=payload.completion_notes,
        completed_at=payload.completed_at or datetime.utcnow(),
    )
    db.add(j)
    # Atomic counter bump in the SAME transaction as the insert — split
    # commits could leave history and stats inconsistent on partial failure,
    # and read-modify-write loses concurrent updates.
    db.query(models.Worker).filter(models.Worker.id == payload.worker_id).update(
        {
            "completed_jobs": func.coalesce(models.Worker.completed_jobs, 0) + 1,
            "total_jobs": func.coalesce(models.Worker.total_jobs, 0) + 1,
        },
        synchronize_session=False,
    )
    try:
        db.commit()
    except IntegrityError:
        # Lost the race on uq_job_history_booking_id: a concurrent request
        # recorded this booking first. Surface the same 400 as the
        # check-then-insert path above instead of an unhandled 500.
        db.rollback()
        raise HTTPException(status_code=400, detail="This booking already has a job history entry")
    db.refresh(j)

    return _to_dict(j)


@router.get("/")
def list_history(
    worker_id: Optional[int] = None,
    user_id: Optional[int] = None,
    booking_id: Optional[int] = None,
    with_worker: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List the CALLER's job history entries (latest first).

    Scoped to the authenticated identity — a worker sees entries for their own
    worker id, a client sees entries where they are the user. Filters that
    point at someone else's data are rejected, not silently honored.

    with_worker narrows the caller's OWN history to jobs done by one worker
    (e.g. a client viewing "my jobs with this worker" on a worker's page). It
    never widens the scope — it is applied on top of the caller filter."""
    uid = _current_uid(current)
    q = db.query(models.JobHistory)
    if current.get("role") == "worker":
        if worker_id is not None and worker_id != uid:
            raise HTTPException(status_code=403, detail="You can only read your own job history")
        q = q.filter(models.JobHistory.worker_id == uid)
    else:
        if user_id is not None and user_id != uid:
            raise HTTPException(status_code=403, detail="You can only read your own job history")
        if worker_id is not None:
            # A client has no "own" worker id — historically this parameter
            # was silently ignored for user tokens, which made the worker page
            # show the client's ENTIRE history instead of one worker's. Fail
            # loudly and point at the right parameter instead.
            raise HTTPException(
                status_code=400,
                detail="worker_id is not valid for client tokens — use with_worker to filter your history by worker",
            )
        q = q.filter(models.JobHistory.user_id == uid)
    if with_worker is not None:
        q = q.filter(models.JobHistory.worker_id == with_worker)
    if booking_id is not None:
        q = q.filter(models.JobHistory.booking_id == booking_id)
    rows = (
        q.order_by(models.JobHistory.completed_at.desc().nullslast(), models.JobHistory.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_to_dict(r) for r in rows]


@router.get("/{entry_id}")
def get_entry(
    entry_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    j = db.query(models.JobHistory).filter(models.JobHistory.id == entry_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job history entry not found")
    _assert_can_read(j, current)
    return _to_dict(j)


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    j = db.query(models.JobHistory).filter(models.JobHistory.id == entry_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job history entry not found")
    # Entries without a worker_id are orphaned; only the worker who owns the entry
    # may delete it. Never allow deletion of someone else's (or orphaned) rows.
    if j.worker_id is None:
        raise HTTPException(status_code=403, detail="This entry has no owning worker and cannot be deleted")
    _assert_own_worker(j.worker_id, current)

    worker_id = j.worker_id
    db.delete(j)
    # Keep the worker's counters in sync, atomically in the same transaction.
    # The CASE guards against driving a legacy counter negative (portable
    # across Postgres and SQLite, unlike GREATEST).
    _decrement = lambda col: case(  # noqa: E731
        (func.coalesce(col, 0) > 0, func.coalesce(col, 0) - 1),
        else_=0,
    )
    db.query(models.Worker).filter(models.Worker.id == worker_id).update(
        {
            "completed_jobs": _decrement(models.Worker.completed_jobs),
            "total_jobs": _decrement(models.Worker.total_jobs),
        },
        synchronize_session=False,
    )
    db.commit()
    return {"ok": True}
