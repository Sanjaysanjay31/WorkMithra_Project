from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload
import database, models, schemas

router = APIRouter()


def _to_dict(ws: models.WorkerService) -> Dict[str, Any]:
    return {
        "id": ws.id,
        "worker_id": ws.worker_id,
        "service_id": ws.service_id,
        "experience_level": ws.experience_level,
        "service_price": float(ws.service_price) if ws.service_price is not None else None,
        "service_name": ws.service.service_name if ws.service else None,
        "service_icon": ws.service.icon if ws.service else None,
    }


@router.post("/")
def attach_service(payload: schemas.WorkerServiceBase, db: Session = Depends(database.get_db)):
    """Attach a service to a worker (with optional price + experience level)."""
    worker = db.query(models.Worker).filter(models.Worker.id == payload.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    service = db.query(models.Service).filter(models.Service.id == payload.service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    existing = (
        db.query(models.WorkerService)
        .filter(
            models.WorkerService.worker_id == payload.worker_id,
            models.WorkerService.service_id == payload.service_id,
        )
        .first()
    )
    if existing:
        existing.experience_level = payload.experience_level
        existing.service_price = payload.service_price
        db.commit()
        db.refresh(existing)
        return _to_dict(existing)

    ws = models.WorkerService(
        worker_id=payload.worker_id,
        service_id=payload.service_id,
        experience_level=payload.experience_level,
        service_price=payload.service_price,
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return _to_dict(ws)


@router.get("/")
def list_worker_services(
    worker_id: Optional[int] = None,
    service_id: Optional[int] = None,
    db: Session = Depends(database.get_db),
):
    """List worker-service links. Filter by worker_id and/or service_id."""
    q = db.query(models.WorkerService).options(joinedload(models.WorkerService.service))
    if worker_id is not None:
        q = q.filter(models.WorkerService.worker_id == worker_id)
    if service_id is not None:
        q = q.filter(models.WorkerService.service_id == service_id)
    return [_to_dict(r) for r in q.all()]


@router.delete("/{link_id}")
def detach_service(link_id: int, db: Session = Depends(database.get_db)):
    ws = db.query(models.WorkerService).filter(models.WorkerService.id == link_id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Worker-service link not found")
    db.delete(ws)
    db.commit()
    return {"ok": True}


@router.delete("/")
def detach_by_pair(
    worker_id: int,
    service_id: int,
    db: Session = Depends(database.get_db),
):
    """Convenience: detach by (worker_id, service_id) pair."""
    ws = (
        db.query(models.WorkerService)
        .filter(
            models.WorkerService.worker_id == worker_id,
            models.WorkerService.service_id == service_id,
        )
        .first()
    )
    if not ws:
        raise HTTPException(status_code=404, detail="Worker-service link not found")
    db.delete(ws)
    db.commit()
    return {"ok": True}
