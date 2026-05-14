from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas

router = APIRouter()


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
def create_entry(payload: schemas.JobHistoryBase, db: Session = Depends(database.get_db)):
    """Record a completed job. Also bumps the worker's completed_jobs counter."""
    j = models.JobHistory(
        booking_id=payload.booking_id,
        worker_id=payload.worker_id,
        user_id=payload.user_id,
        completion_notes=payload.completion_notes,
        completed_at=payload.completed_at or datetime.utcnow(),
    )
    db.add(j)
    db.commit()
    db.refresh(j)

    if payload.worker_id is not None:
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
    limit: int = 100,
    db: Session = Depends(database.get_db),
):
    """List job history entries (latest first)."""
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
def get_entry(entry_id: int, db: Session = Depends(database.get_db)):
    j = db.query(models.JobHistory).filter(models.JobHistory.id == entry_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job history entry not found")
    return _to_dict(j)


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, db: Session = Depends(database.get_db)):
    j = db.query(models.JobHistory).filter(models.JobHistory.id == entry_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job history entry not found")
    db.delete(j)
    db.commit()
    return {"ok": True}
