from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime
import database, models, schemas
from auth import get_current_user

router = APIRouter()


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


# Whitelist of profile fields a client may write. Anything else (id, user_id,
# role, created_at, ...) is ignored — prevents mass-assignment of server-owned
# columns via an arbitrary JSON body.
_EDITABLE_PROFILE_FIELDS = {
    "full_name", "phone", "email", "preferred_language", "notification_enabled",
    "bio", "address", "city", "state", "pincode", "latitude", "longitude",
    "profile_image",
}


def _apply_profile_payload(profile: models.UserProfile, payload: Dict[str, Any]) -> None:
    for key, value in payload.items():
        if key in _EDITABLE_PROFILE_FIELDS:
            setattr(profile, key, value)


def _get_or_create_profile(db: Session, user_id: int, role: str) -> models.UserProfile:
    """Get an existing extended profile or create a blank one."""
    profile = (
        db.query(models.UserProfile)
        .filter(
            models.UserProfile.user_id == user_id,
            models.UserProfile.role == role,
        )
        .first()
    )
    if profile is None:
        profile = models.UserProfile(user_id=user_id, role=role)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/me")
def get_my_profile(db: Session = Depends(database.get_db),
                   current: Dict[str, Any] = Depends(get_current_user)):
    """Return the current user's extended profile (database-backed, not in-memory)."""
    uid = _current_user_id(current)
    role = current.get("role", "user")
    profile = _get_or_create_profile(db, uid, role)
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "role": profile.role,
        "full_name": profile.full_name,
        "phone": profile.phone,
        "email": profile.email,
        "preferred_language": profile.preferred_language,
        "notification_enabled": profile.notification_enabled,
        "bio": profile.bio,
        "address": profile.address,
        "city": profile.city,
        "state": profile.state,
        "pincode": profile.pincode,
        "latitude": profile.latitude,
        "longitude": profile.longitude,
        "profile_image": profile.profile_image,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@router.post("/me")
def create_my_profile(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Create or replace the current user's extended profile."""
    uid = _current_user_id(current)
    role = current.get("role", "user")
    profile = _get_or_create_profile(db, uid, role)
    _apply_profile_payload(profile, payload)
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    return get_my_profile(db, current)


@router.put("/me")
def update_my_profile(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Partial update of the current user's extended profile."""
    uid = _current_user_id(current)
    role = current.get("role", "user")
    profile = _get_or_create_profile(db, uid, role)
    _apply_profile_payload(profile, payload)
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    return get_my_profile(db, current)


@router.get("/user/{user_id}")
def get_user_profile(
    user_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get a user profile.

    Full details are only returned when the caller is allowed to see them:
    the user themself, or a worker who shares a booking with this user
    (workers need the job address/contact). Everyone else gets a minimal
    public shape so profiles can't be scraped for contact details."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    caller_id = _current_user_id(current)
    caller_role = current.get("role", "user")
    is_self = caller_role == "user" and caller_id == user_id
    shares_booking = False
    if caller_role == "worker":
        shares_booking = (
            db.query(models.Booking.id)
            .filter(
                models.Booking.user_id == user_id,
                models.Booking.worker_id == caller_id,
            )
            .first()
            is not None
        )

    if not (is_self or shares_booking):
        return {
            "id": user.id,
            "full_name": user.full_name,
            "profile_image": user.profile_image,
        }
    return schemas.UserResponse.model_validate(user)


@router.put("/user/{user_id}", response_model=schemas.UserResponse)
def update_user_profile(
    user_id: int,
    user_update: schemas.UserBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Update a user profile (partial — only non-null fields are written).
    Users can only update their own profile. Worker tokens can never write
    user rows — the two tables have overlapping ids, so an id-only check
    would let worker #N edit user #N (a different person)."""
    if current.get("role", "user") != "user" or user_id != _current_user_id(current):
        raise HTTPException(status_code=403, detail="You can only update your own profile")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    data = user_update.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is None:
            continue
        if field == "role":
            continue  # role cannot be changed via profile update
        if hasattr(user, field):
            setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.get("/worker/{worker_id}/reviews", response_model=List[schemas.RatingReviewResponse])
def get_worker_reviews(worker_id: int, skip: int = 0, limit: int = 10, db: Session = Depends(database.get_db)):
    """Get reviews for a worker (public read)."""
    reviews = db.query(models.RatingReview).filter(
        models.RatingReview.worker_id == worker_id
    ).offset(skip).limit(limit).all()
    return reviews