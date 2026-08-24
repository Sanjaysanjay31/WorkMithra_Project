from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas
from auth import get_current_user

router = APIRouter()


def _assert_own_worker(worker_id: int, current: Dict[str, Any]) -> None:
    """Workers may only write their own job history."""
    if current.get("role") != "worker" or str(worker_id) != str(current.get("sub")):
        raise HTTPException(status_code=403, detail="You can only manage your own job history")


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
    if booking.status != "completed":
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
    db.commit()
    db.refresh(j)

    worker = db.query(models.Worker).filter(models.Worker.id == payload.worker_id).first()
    if worker is not None:
        worker.completed_jobs = (worker.completed_jobs or 0) + 1
        worker.total_jobs = (worker.total_jobs or 0) + 1
        db.commit()

    return _to_dict(j)


@router.get("/")
def list_history(
    worker_id: Optional[int] = None,
    user_id: Optional[int] = None,
    booking_id: Optional[int] = None,
    skip: int = 0,
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List job history entries (latest first). Requires authentication —
    entries expose user/worker ids and completion notes."""
    q = db.query(models.JobHistory)
    if worker_id is not None:
        q = q.filter(models.JobHistory.worker_id == worker_id)
    if user_id is not None:
        q = q.filter(models.JobHistory.user_id == user_id)
    if booking_id is not None:
        q = q.filter(models.JobHistory.booking_id == booking_id)
    rows = (
        q.order_by(models.JobHistory.completed_at.desc().nullslast())
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
    db.commit()

    # Keep the worker's counters in sync with the deleted entry.
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if worker is not None:
        worker.completed_jobs = max(0, (worker.completed_jobs or 0) - 1)
        worker.total_jobs = max(0, (worker.total_jobs or 0) - 1)
        db.commit()
    return {"ok": True}
