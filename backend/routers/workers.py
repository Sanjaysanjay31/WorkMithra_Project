from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, asc
import database, models, schemas
from auth import get_current_user

router = APIRouter()


def _is_own_worker(worker_id: int, current: Dict[str, Any]) -> bool:
    return current.get("role") == "worker" and str(worker_id) == str(current.get("sub"))


def _worker_view(worker: models.Worker, include_email: bool) -> Dict[str, Any]:
    """Serialize a worker. Email is only included for the worker themself —
    the directory is for hiring, not for harvesting contact details."""
    return {
        "id": worker.id,
        "full_name": worker.full_name,
        "phone": worker.phone,
        "email": worker.email if include_email else None,
        "skill": worker.skill,
        "experience_years": worker.experience_years,
        "bio": worker.bio,
        "hourly_rate": float(worker.hourly_rate) if worker.hourly_rate is not None else None,
        "availability": worker.availability,
        "current_status": worker.current_status,
        "profile_image": worker.profile_image,
        "city": worker.city,
        "location": worker.location,
        "latitude": worker.latitude,
        "longitude": worker.longitude,
        "rating": worker.rating,
        "total_jobs": worker.total_jobs,
        "completed_jobs": worker.completed_jobs,
        "aadhaar_verified": worker.aadhaar_verified,
        "created_at": worker.created_at,
    }


@router.get("", response_model=List[schemas.WorkerResponse])
def list_workers(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Return a paginated list of workers (authenticated users only)."""
    workers = db.query(models.Worker).offset(skip).limit(limit).all()
    return [_worker_view(w, include_email=False) for w in workers]


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
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
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

    return [_worker_view(w, include_email=False) for w in query.offset(skip).limit(limit).all()]


@router.get("/{worker_id}", response_model=schemas.WorkerResponse)
def get_worker(
    worker_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get a specific worker by ID (authenticated). Email is only included
    when the worker fetches their own profile."""
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return _worker_view(worker, include_email=_is_own_worker(worker_id, current))

@router.put("/{worker_id}", response_model=schemas.WorkerResponse)
def update_worker(
    worker_id: int,
    worker_update: schemas.WorkerUpdate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Update a worker's profile. Only the worker themselves may do this, and
    only editable fields are accepted (rating/counters are server-managed)."""
    if current.get("role") != "worker" or str(worker_id) != str(current.get("sub")):
        raise HTTPException(status_code=403, detail="You can only update your own worker profile")

    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    for key, value in worker_update.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        if hasattr(worker, key):
            setattr(worker, key, value)

    db.commit()
    db.refresh(worker)
    return worker
