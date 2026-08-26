from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, asc, func, case
from sqlalchemy.exc import IntegrityError
import database, models, schemas
from auth import get_current_user

router = APIRouter()


def _is_own_worker(worker_id: int, current: Dict[str, Any]) -> bool:
    return current.get("role") == "worker" and str(worker_id) == str(current.get("sub"))


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a search for "50%off" or "c_" matches
    literally (and '%%%' can't force a degenerate full-scan pattern)."""
    return (
        term.replace("\\", r"\\")
        .replace("%", r"\%")
        .replace("_", r"\_")
    )



def _worker_view(worker: models.Worker, include_email: bool, include_phone: bool = False) -> Dict[str, Any]:
    """Serialize a worker. Email is only included for the worker themself —
    the directory is for hiring, not for harvesting contact details.
    Phone/alternate_phone are likewise stripped from the list endpoints
    (/workers, /smart-match): unbounded pagination there makes bulk number
    harvesting trivial. The single-worker detail view keeps phone visible —
    a targeted lookup is hiring intent, and the client's Call action needs it."""
    return {
        "id": worker.id,
        "full_name": worker.full_name,
        "phone": worker.phone if include_phone else None,
        "email": worker.email if include_email else None,
        "age": worker.age,
        "alternate_phone": worker.alternate_phone if include_phone else None,
        "skill": worker.skill,
        "experience_years": worker.experience_years,
        "bio": worker.bio,
        "timings": worker.timings,
        "hourly_rate": float(worker.hourly_rate) if worker.hourly_rate is not None else None,
        "availability": worker.availability,
        "current_status": worker.current_status,
        "profile_image": worker.profile_image,
        "city": worker.city,
        "pincode": worker.pincode,
        "location": worker.location,
        "latitude": worker.latitude,
        "longitude": worker.longitude,
        "rating": worker.rating,
        "total_jobs": worker.total_jobs,
        "completed_jobs": worker.completed_jobs,
        "aadhaar_verified": worker.aadhaar_verified,
        "created_at": worker.created_at,
        "preferred_language": worker.preferred_language,
    }


@router.get("", response_model=List[schemas.WorkerResponse])
def list_workers(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Return a paginated list of workers (authenticated users only)."""
    workers = (
        db.query(models.Worker)
        .order_by(models.Worker.id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_worker_view(w, include_email=False, include_phone=False) for w in workers]


def _smart_sort_criteria(sort_by: Optional[str], haversine):
    """Build ORDER BY criteria from sort_by — a single key OR a
    comma-separated priority list like "rating,wage_asc" (the app's filter
    sheet is multi-select and numbers the picks 1., 2., …).

    Unknown keys are skipped so one bad token can't break the rest. The
    caller always appends id-asc afterwards for deterministic pagination.
    `haversine` is the distance expression when the caller supplied lat/lng;
    'location' without a reference point is skipped."""
    if not sort_by:
        return []
    criteria = []
    for key in (k.strip() for k in sort_by.split(",")):
        if key == "location" and haversine is not None:
            criteria.append(asc(haversine))
        elif key == "wage_asc":
            # nulls_last: workers without a rate shouldn't top "cheapest first"
            criteria.append(asc(models.Worker.hourly_rate).nulls_last())
        elif key == "wage_desc":
            criteria.append(desc(models.Worker.hourly_rate).nulls_last())
        elif key == "experience":
            criteria.append(desc(models.Worker.experience_years).nulls_last())
        elif key == "rating":
            criteria.append(desc(models.Worker.rating).nulls_last())
        elif key == "jobs":
            criteria.append(desc(models.Worker.completed_jobs).nulls_last())
    return criteria


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
        query = query.filter(models.Worker.skill.ilike(f"%{_escape_like(q)}%", escape="\\"))
    
    # Distance expression, set only when the caller supplied a reference
    # point — used both for the radius filter and 'location' sorting.
    haversine = None
    if lat is not None and lng is not None:
        # Workers without coordinates can't be geo-ranked — exclude them
        # explicitly (NULL math would drop them from the results anyway).
        query = query.filter(
            models.Worker.latitude.isnot(None),
            models.Worker.longitude.isnot(None),
        )
        # Haversine formula in KM. The acos argument is clamped to [-1, 1]
        # with a CASE (portable across Postgres and SQLite): float rounding
        # can push it slightly past 1.0 for near-identical coordinates, and
        # Postgres raises "input value is out of range" (an unhandled 500)
        # instead of returning 0.
        acos_arg = (
            func.sin(func.radians(lat)) * func.sin(func.radians(models.Worker.latitude)) +
            func.cos(func.radians(lat)) * func.cos(func.radians(models.Worker.latitude)) *
            func.cos(func.radians(models.Worker.longitude) - func.radians(lng))
        )
        clamped = case((acos_arg > 1.0, 1.0), (acos_arg < -1.0, -1.0), else_=acos_arg)
        haversine = func.acos(clamped) * 6371
        # Clamp the radius so radius=1e9 can't defeat the geo filter.
        query = query.filter(haversine <= min(radius if radius else 10.0, 100.0))

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

    # Single key or comma-separated priority list; id-asc as the final
    # tiebreaker keeps skip/limit pagination deterministic. (Note: calling
    # order_by() twice REPLACES the criteria in SQLAlchemy, so everything
    # must be applied in one call — a previous version applied the location
    # sort first and then silently overwrote it here.)
    criteria = _smart_sort_criteria(sort_by, haversine)
    query = query.order_by(*criteria, models.Worker.id.asc())

    return [_worker_view(w, include_email=False, include_phone=False) for w in query.offset(skip).limit(limit).all()]


@router.get("/{worker_id}", response_model=schemas.WorkerResponse)
def get_worker(
    worker_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get a specific worker by ID (authenticated). Email is only included
    when the worker fetches their own profile. Phone stays visible here —
    the client's Call action and contact row read it from this endpoint."""
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return _worker_view(
        worker,
        include_email=_is_own_worker(worker_id, current),
        include_phone=True,
    )

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

    data = worker_update.model_dump(exclude_unset=True)

    # Login identity cannot be rewritten from an authenticated session: email
    # gates the OTP password-reset flow, so a hijacked session that could
    # silently swap it would own the account forever. Changing it requires
    # re-verification of the new address (not built yet), so it is rejected
    # outright. Unchanged echoes from profile forms are allowed through.
    for field in ("email", "phone"):
        new_value = data.get(field)
        if new_value:
            current_value = getattr(worker, field, None)
            changed = (
                str(current_value or "").strip().lower() != str(new_value).strip().lower()
            )
            if changed:
                raise HTTPException(
                    status_code=400,
                    detail=f"{field.capitalize()} cannot be changed here — it requires verifying the new value first",
                )

    for key, value in data.items():
        if value is None:
            continue
        if hasattr(worker, key):
            setattr(worker, key, value)

    try:
        db.commit()
    except IntegrityError:
        # email/phone already taken by another worker — surface a clean 409
        # instead of an unhandled 500 on the unique constraint.
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or phone is already in use by another account")
    db.refresh(worker)
    return worker
