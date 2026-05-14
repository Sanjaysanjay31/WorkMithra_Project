from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas

router = APIRouter()


@router.post("/", response_model=schemas.ServiceResponse)
def create_service(payload: schemas.ServiceCreate, db: Session = Depends(database.get_db)):
    """Create a new service (e.g. Plumbing, Electrician)."""
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
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(database.get_db),
):
    """List all services. `q` does a case-insensitive name match."""
    query = db.query(models.Service)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(models.Service.service_name.ilike(like))
    return query.order_by(models.Service.service_name.asc()).offset(skip).limit(limit).all()


@router.get("/{service_id}", response_model=schemas.ServiceResponse)
def get_service(service_id: int, db: Session = Depends(database.get_db)):
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    return s


@router.put("/{service_id}", response_model=schemas.ServiceResponse)
def update_service(service_id: int, payload: schemas.ServiceBase, db: Session = Depends(database.get_db)):
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    if payload.service_name is not None:
        s.service_name = payload.service_name
    s.description = payload.description
    s.icon = payload.icon
    s.base_price = payload.base_price
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{service_id}")
def delete_service(service_id: int, db: Session = Depends(database.get_db)):
    s = db.query(models.Service).filter(models.Service.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    db.delete(s)
    db.commit()
    return {"ok": True}
