from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import database, models, schemas
from auth import get_current_user

router = APIRouter()

# Canonical day names — free-text days ("funday") previously persisted as
# dead rows that never matched any booking check.
_VALID_DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
_DAY_ALIASES = {
    "mon": "monday", "tue": "tuesday", "tues": "tuesday", "wed": "wednesday",
    "thu": "thursday", "thur": "thursday", "thurs": "thursday",
    "fri": "friday", "sat": "saturday", "sun": "sunday",
}


def _normalize_day(day: Optional[str]) -> Optional[str]:
    if day is None:
        return None
    d = str(day).strip().lower()
    d = _DAY_ALIASES.get(d, d)
    if d not in _VALID_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"available_day must be one of: {', '.join(sorted(_VALID_DAYS))}",
        )
    return d


def _validate_window(start_time, end_time) -> None:
    if start_time is not None and end_time is not None and start_time >= end_time:
        raise HTTPException(status_code=400, detail="start_time must be before end_time")


def _assert_own_worker(worker_id: int, current: Dict[str, Any]) -> None:
    """Workers may only manage their own availability slots."""
    if current.get("role") != "worker" or str(worker_id) != str(current.get("sub")):
        raise HTTPException(status_code=403, detail="You can only manage your own availability")


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
def create_availability(
    payload: schemas.WorkerAvailabilityBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Add an availability slot for a worker. (worker_id, available_day) pair is upserted."""
    if not payload.worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")
    _assert_own_worker(payload.worker_id, current)
    worker = db.query(models.Worker).filter(models.Worker.id == payload.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    day = _normalize_day(payload.available_day)
    _validate_window(payload.start_time, payload.end_time)

    existing = (
        db.query(models.WorkerAvailability)
        .filter(
            models.WorkerAvailability.worker_id == payload.worker_id,
            models.WorkerAvailability.available_day == day,
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
        available_day=day,
        start_time=payload.start_time,
        end_time=payload.end_time,
        is_available=payload.is_available if payload.is_available is not None else True,
    )
    db.add(a)
    try:
        db.commit()
    except IntegrityError:
        # Lost the upsert race on the unique (worker_id, available_day)
        # index — update whichever row won instead of failing.
        db.rollback()
        winner = (
            db.query(models.WorkerAvailability)
            .filter(
                models.WorkerAvailability.worker_id == payload.worker_id,
                models.WorkerAvailability.available_day == day,
            )
            .first()
        )
        if winner is None:
            raise HTTPException(status_code=409, detail="Could not save this slot — try again")
        winner.start_time = payload.start_time
        winner.end_time = payload.end_time
        winner.is_available = payload.is_available if payload.is_available is not None else True
        db.commit()
        db.refresh(winner)
        return _to_dict(winner)
    db.refresh(a)
    return _to_dict(a)


@router.get("/")
def list_availability(
    worker_id: Optional[int] = None,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List availability slots. Workers default to their own slots; other
    callers must name a worker (clients checking slots before booking).
    Without this, an unscoped call dumped the entire table."""
    if worker_id is None:
        if current.get("role") == "worker":
            try:
                worker_id = int(current["sub"])
            except (KeyError, ValueError, TypeError):
                raise HTTPException(status_code=401, detail="Invalid token payload")
        else:
            raise HTTPException(status_code=400, detail="worker_id is required")
    q = db.query(models.WorkerAvailability).filter(
        models.WorkerAvailability.worker_id == worker_id
    )
    return [_to_dict(r) for r in q.all()]


@router.put("/{slot_id}")
def update_availability(
    slot_id: int,
    payload: schemas.WorkerAvailabilityBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    a = db.query(models.WorkerAvailability).filter(models.WorkerAvailability.id == slot_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Availability slot not found")
    _assert_own_worker(a.worker_id, current)

    new_day = _normalize_day(payload.available_day) if payload.available_day is not None else a.available_day
    new_start = payload.start_time if payload.start_time is not None else a.start_time
    new_end = payload.end_time if payload.end_time is not None else a.end_time
    _validate_window(new_start, new_end)

    # Moving a slot onto a day that already has a slot would create two
    # conflicting rows for the same (worker, day) — reject instead.
    if new_day != a.available_day:
        clash = (
            db.query(models.WorkerAvailability)
            .filter(
                models.WorkerAvailability.worker_id == a.worker_id,
                models.WorkerAvailability.available_day == new_day,
                models.WorkerAvailability.id != slot_id,
            )
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail="A slot for that day already exists")
        a.available_day = new_day
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
def delete_availability(
    slot_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    a = db.query(models.WorkerAvailability).filter(models.WorkerAvailability.id == slot_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Availability slot not found")
    _assert_own_worker(a.worker_id, current)
    db.delete(a)
    db.commit()
    return {"ok": True}
