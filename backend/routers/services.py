from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
import database, models, schemas
from auth import get_current_user, require_role

router = APIRouter()


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so searches match literally instead of letting
    user-supplied % / _ build arbitrary patterns."""
    return (
        term.replace("\\", r"\\")
        .replace("%", r"\%")
        .replace("_", r"\_")
    )


@router.post("/", response_model=schemas.ServiceResponse)
def create_service(
    payload: schemas.ServiceCreate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(require_role("admin")),
):
    """Create a new service (e.g. Plumbing, Electrician). Admin only — the
    service catalog is global infrastructure, not user content."""
    if not payload.service_name or not payload.service_name.strip():
        raise HTTPException(status_code=400, detail="service_name is required")
    s = models.Service(
        service_name=payload.service_name.strip(),
        description=payload.description,
        icon=payload.icon,
        base_price=payload.base_price,
        created_at=datetime.utcnow(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.get("/", response_model=List[schemas.ServiceResponse])
def list_services(
    q: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(database.get_db),
):
    """List all services. `q` does a case-insensitive name match."""
    query = db.query(models.Service)
    if q:
        like = f"%{_escape_like(q.strip())}%"
        query = query.filter(models.Service.service_name.ilike(like, escape="\\"))
    return query.order_by(models.Service.service_name.asc()).offset(skip).limit(limit).all()


@router.get("/{service_id}", response_model=schemas.ServiceResponse)
def get_service(service_id: int, db: Session = Depends(database.get_db)):
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    return s


@router.put("/{service_id}", response_model=schemas.ServiceResponse)
def update_service(
    service_id: int,
    payload: schemas.ServiceUpdate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(require_role("admin")),
):
    """Update a service. Admin only. True partial update — only the fields
    present in the request body are written, so omitting a field keeps its
    current value instead of wiping it."""
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "service_name" and value is not None and not value.strip():
            raise HTTPException(status_code=400, detail="service_name cannot be empty")
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{service_id}")
def delete_service(
    service_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(require_role("admin")),
):
    """Delete a service. Admin only. Refuses when bookings or worker links
    still reference the service, so history is never orphaned."""
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    referenced = (
        db.query(models.Booking.id).filter(models.Booking.service_id == service_id).first() is not None
        or db.query(models.WorkerService.id).filter(models.WorkerService.service_id == service_id).first() is not None
    )
    if referenced:
        raise HTTPException(
            status_code=409,
            detail="Service is referenced by bookings or worker profiles and cannot be deleted",
        )
    db.delete(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Service is still referenced and cannot be deleted")
    return {"ok": True}
