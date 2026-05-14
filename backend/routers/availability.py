from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
import database, models, schemas

router = APIRouter()


def _to_dict(a: models.WorkerAvailability) -> Dict[str, Any]:
    return {
        "id": a.id,
        "worker_id": a.worker_id,
        "available_day": a.available_day,
        "start_time": a.start_time.strftime("%H:%M") if a.start_time else None,
        "end_time": a.end_time.strftime("%H:%M") if a.end_time else None,
        "is_available": bool(a.is_available),
    }


@router.post("/")
def create_availability(payload: schemas.WorkerAvailabilityBase, db: Session = Depends(database.get_db)):
    """Add an availability slot for a worker. (worker_id, available_day) pair is upserted."""
    if not payload.worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")
    worker = db.query(models.Worker).filter(models.Worker.id == payload.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    existing = (
        db.query(models.WorkerAvailability)
        .filter(
            models.WorkerAvailability.worker_id == payload.worker_id,
            models.WorkerAvailability.available_day == payload.available_day,
        )
        .first()
    )
    if existing:
        existing.start_time = payload.start_time
        existing.end_time = payload.end_time
        existing.is_available = payload.is_available if payload.is_available is not None else True
        db.commit()
        db.refresh(existing)
        return _to_dict(existing)

    a = models.WorkerAvailability(
        worker_id=payload.worker_id,
        available_day=payload.available_day,
        start_time=payload.start_time,
        end_time=payload.end_time,
        is_available=payload.is_available if payload.is_available is not None else True,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _to_dict(a)


@router.get("/")
def list_availability(
    worker_id: Optional[int] = None,
    db: Session = Depends(database.get_db),
):
    q = db.query(models.WorkerAvailability)
    if worker_id is not None:
        q = q.filter(models.WorkerAvailability.worker_id == worker_id)
    return [_to_dict(r) for r in q.all()]


@router.put("/{slot_id}")
def update_availability(slot_id: int, payload: schemas.WorkerAvailabilityBase, db: Session = Depends(database.get_db)):
    a = db.query(models.WorkerAvailability).filter(models.WorkerAvailability.id == slot_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Availability slot not found")
    if payload.available_day is not None:
        a.available_day = payload.available_day
    if payload.start_time is not None:
        a.start_time = payload.start_time
    if payload.end_time is not None:
        a.end_time = payload.end_time
    if payload.is_available is not None:
        a.is_available = payload.is_available
    db.commit()
    db.refresh(a)
    return _to_dict(a)


@router.delete("/{slot_id}")
def delete_availability(slot_id: int, db: Session = Depends(database.get_db)):
    a = db.query(models.WorkerAvailability).filter(models.WorkerAvailability.id == slot_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Availability slot not found")
    db.delete(a)
    db.commit()
    return {"ok": True}
