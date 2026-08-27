from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from booking_status import normalize_status

router = APIRouter()


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


# Whitelist of profile fields a client may write. Anything else (id, user_id,
# role, created_at, ...) is ignored — prevents mass-assignment of server-owned
# columns. The typed ProfileUpdate schema already rejects unknown keys, this
# keeps the two layers consistent.
_EDITABLE_PROFILE_FIELDS = {
    "full_name", "phone", "email", "preferred_language", "notification_enabled",
    "bio", "address", "city", "state", "pincode", "latitude", "longitude",
    "profile_image",
}


def _apply_profile_payload(profile: models.UserProfile, payload: schemas.ProfileUpdate) -> None:
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key in _EDITABLE_PROFILE_FIELDS:
            setattr(profile, key, value)


def _get_or_create_profile(db: Session, user_id: int, role: str) -> models.UserProfile:
    """Get an existing extended profile or create a blank one.

    Two concurrent first calls (e.g. the app opening two screens at once)
    used to create two rows; the unique (user_id, role) constraint now makes
    the loser re-fetch the winner's row instead."""
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
        try:
            db.commit()
        except IntegrityError:
            # Lost the race — another request created the row first.
            db.rollback()
            profile = (
                db.query(models.UserProfile)
                .filter(
                    models.UserProfile.user_id == user_id,
                    models.UserProfile.role == role,
                )
                .first()
            )
        if profile is not None:
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
    payload: schemas.ProfileUpdate,
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
    payload: schemas.ProfileUpdate,
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
        # Full contact/address details are only justified while a job is
        # actually happening (or happened). A worker who was merely assigned
        # — even on a booking either side rejected — must not keep permanent
        # access to the client's address and contact details.
        rows = (
            db.query(models.Booking.status)
            .filter(
                models.Booking.user_id == user_id,
                models.Booking.worker_id == caller_id,
            )
            .all()
        )
        shares_booking = any(
            normalize_status(s) in ("pending", "upcoming", "completed")
            for (s,) in rows
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

    # Login identity cannot be rewritten from an authenticated session: email
    # gates the OTP password-reset flow, so a hijacked session that could
    # silently swap it would own the account forever. Changing it requires
    # re-verification of the new value (not built yet), so it is rejected.
    # Unchanged echoes from profile forms are allowed through.
    for field in ("email", "phone"):
        new_value = data.get(field)
        if new_value:
            current_value = getattr(user, field, None)
            changed = (
                str(current_value or "").strip().lower() != str(new_value).strip().lower()
            )
            if changed:
                raise HTTPException(
                    status_code=400,
                    detail=f"{field.capitalize()} cannot be changed here — it requires verifying the new value first",
                )

    for field, value in data.items():
        if value is None:
            continue
        if field == "role":
            continue  # role cannot be changed via profile update
        if hasattr(user, field):
            setattr(user, field, value)

    try:
        db.commit()
    except IntegrityError:
        # email/phone unique constraint — surface a clean 409 instead of an
        # unhandled 500.
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or phone is already in use by another account")
    db.refresh(user)
    return user


@router.get("/worker/{worker_id}/reviews", response_model=List[schemas.RatingReviewResponse])
def get_worker_reviews(
    worker_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Get reviews RECEIVED BY a worker (authenticated read), latest first.
    Worker-written reviews about clients share worker_id but are excluded."""
    from sqlalchemy import or_
    reviews = (
        db.query(models.RatingReview)
        .filter(
            models.RatingReview.worker_id == worker_id,
            or_(
                models.RatingReview.reviewer_role == "user",
                models.RatingReview.reviewer_role.is_(None),
            ),
        )
        .order_by(models.RatingReview.created_at.desc(), models.RatingReview.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return reviews