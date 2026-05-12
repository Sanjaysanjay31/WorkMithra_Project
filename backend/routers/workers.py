from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, asc
import database, models, schemas

router = APIRouter()


@router.get("", response_model=List[schemas.WorkerResponse])
def list_workers(skip: int = 0, limit: int = 20, db: Session = Depends(database.get_db)):
    """Return a paginated list of workers."""
    workers = db.query(models.Worker).offset(skip).limit(limit).all()
    return workers


@router.get("/smart-match", response_model=List[schemas.WorkerResponse])
def smart_match_workers(
    q: Optional[str] = None,
    min_wage: Optional[float] = None,
    max_wage: Optional[float] = None,
    min_experience: Optional[float] = None,
    min_rating: Optional[float] = None,
    min_jobs: Optional[int] = None,
    verified_only: Optional[bool] = False,
    availability: Optional[str] = None,
    sort_by: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius: Optional[float] = 10.0, # default 10km
    skip: int = 0, limit: int = 20,
    db: Session = Depends(database.get_db)
):
    query = db.query(models.Worker)
    
    if q:
        query = query.filter(models.Worker.skill.ilike(f"%{q}%"))
    
    if lat is not None and lng is not None:
        from sqlalchemy import func
        # Haversine formula in KM
        # 6371 * acos(cos(radians(lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(lng)) + sin(radians(lat)) * sin(radians(latitude)))
        haversine = func.acos(
            func.sin(func.radians(lat)) * func.sin(func.radians(models.Worker.latitude)) +
            func.cos(func.radians(lat)) * func.cos(func.radians(models.Worker.latitude)) *
            func.cos(func.radians(models.Worker.longitude) - func.radians(lng))
        ) * 6371
        query = query.filter(haversine <= radius)
        if sort_by == 'location':
             query = query.order_by(asc(haversine))

    if min_wage is not None:
        query = query.filter(models.Worker.hourly_rate >= min_wage)
    if max_wage is not None:
        query = query.filter(models.Worker.hourly_rate <= max_wage)
    if min_experience is not None:
        query = query.filter(models.Worker.experience_years >= min_experience)
    if min_rating is not None:
        query = query.filter(models.Worker.rating >= min_rating)
    if min_jobs is not None:
        query = query.filter(or_(models.Worker.completed_jobs >= min_jobs, models.Worker.total_jobs >= min_jobs))
    if verified_only:
        query = query.filter(models.Worker.aadhaar_verified == True)
        
    if availability == 'now':
        query = query.filter(or_(models.Worker.availability == True, models.Worker.current_status == 'available'))
    elif availability == 'today':
        query = query.filter(models.Worker.current_status != 'offline')
        
    if sort_by == 'wage_asc':
        query = query.order_by(asc(models.Worker.hourly_rate))
    elif sort_by == 'wage_desc':
        query = query.order_by(desc(models.Worker.hourly_rate))
    elif sort_by == 'experience':
        query = query.order_by(desc(models.Worker.experience_years))
    elif sort_by == 'rating':
        query = query.order_by(desc(models.Worker.rating))
    elif sort_by == 'jobs':
        query = query.order_by(desc(models.Worker.completed_jobs))
    
    return query.offset(skip).limit(limit).all()


@router.get("/{worker_id}", response_model=schemas.WorkerResponse)
def get_worker(worker_id: int, db: Session = Depends(database.get_db)):
    """Get a specific worker by ID."""
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker

@router.put("/{worker_id}", response_model=schemas.WorkerResponse)
def update_worker(worker_id: int, worker_update: schemas.WorkerResponse, db: Session = Depends(database.get_db)):
    """Update a specific worker's profile."""
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    # Update fields
    for key, value in worker_update.dict(exclude_unset=True).items():
        if hasattr(worker, key) and key != "id":
            setattr(worker, key, value)
            
    db.commit()
    db.refresh(worker)
    return worker
