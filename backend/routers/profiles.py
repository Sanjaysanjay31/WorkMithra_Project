from fastapi import APIRouter, Depends, HTTPException, Header, Body
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
import database, models, schemas

router = APIRouter()

# In-memory dev store for /profiles/me (keyed by X-User-Id header, default "guest")
_me_store: Dict[str, Dict[str, Any]] = {}


@router.get("/me")
def get_my_profile(x_user_id: Optional[str] = Header(default="guest")):
    """Return the current user's profile, or empty if none saved."""
    return _me_store.get(x_user_id or "guest", {})


@router.post("/me")
def create_my_profile(
    payload: Dict[str, Any] = Body(...),
    x_user_id: Optional[str] = Header(default="guest"),
):
    _me_store[x_user_id or "guest"] = payload
    return _me_store[x_user_id or "guest"]


@router.put("/me")
def update_my_profile(
    payload: Dict[str, Any] = Body(...),
    x_user_id: Optional[str] = Header(default="guest"),
):
    key = x_user_id or "guest"
    _me_store[key] = {**_me_store.get(key, {}), **payload}
    return _me_store[key]


@router.get("/user/{user_id}", response_model=schemas.UserResponse)
def get_user_profile(user_id: int, db: Session = Depends(database.get_db)):
    """Get a user profile."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/user/{user_id}", response_model=schemas.UserResponse)
def update_user_profile(user_id: int, user_update: schemas.UserBase, db: Session = Depends(database.get_db)):
    """Update a user profile (partial — only non-null fields are written)."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    data = user_update.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is None:
            continue
        if hasattr(user, field):
            setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.get("/worker/{worker_id}/reviews", response_model=List[schemas.RatingReviewResponse])
def get_worker_reviews(worker_id: int, skip: int = 0, limit: int = 10, db: Session = Depends(database.get_db)):
    """Get reviews for a worker."""
    reviews = db.query(models.RatingReview).filter(
        models.RatingReview.worker_id == worker_id
    ).offset(skip).limit(limit).all()
    return reviews


@router.post("/review", response_model=schemas.RatingReviewResponse)
def create_review(review: schemas.RatingReviewBase, db: Session = Depends(database.get_db)):
    """Create a review for a worker."""
    new_review = models.RatingReview(
        booking_id=review.booking_id,
        user_id=review.user_id,
        worker_id=review.worker_id,
        rating=review.rating,
        review_text=review.review_text,
    )
    db.add(new_review)
    db.commit()
    db.refresh(new_review)
    return new_review
