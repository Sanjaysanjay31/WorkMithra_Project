from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
import database, models, schemas

router = APIRouter()


def _to_dict(r: models.RatingReview, db: Session) -> Dict[str, Any]:
    user_name = None
    if r.user_id is not None:
        u = db.query(models.User).filter(models.User.id == r.user_id).first()
        if u is not None:
            user_name = u.full_name
    return {
        "id": r.id,
        "booking_id": r.booking_id,
        "user_id": r.user_id,
        "user_name": user_name,
        "worker_id": r.worker_id,
        "rating": float(r.rating) if r.rating is not None else 0.0,
        "review_text": r.review_text,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _recompute_worker_rating(db: Session, worker_id: int) -> None:
    """Recalculate the worker's average rating from ratings_reviews."""
    avg = (
        db.query(func.avg(models.RatingReview.rating))
        .filter(models.RatingReview.worker_id == worker_id)
        .scalar()
    )
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if worker is not None:
        worker.rating = float(avg) if avg is not None else 0.0
        db.commit()


@router.post("/")
def create_review(payload: schemas.RatingReviewBase, db: Session = Depends(database.get_db)):
    """Create a new review. Updates the worker's aggregate rating."""
    if payload.worker_id is None:
        raise HTTPException(status_code=400, detail="worker_id is required")
    if payload.rating is None or payload.rating < 0 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 0 and 5")

    review = models.RatingReview(
        booking_id=payload.booking_id,
        user_id=payload.user_id,
        worker_id=payload.worker_id,
        rating=float(payload.rating),
        review_text=payload.review_text,
        created_at=datetime.utcnow(),
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    _recompute_worker_rating(db, payload.worker_id)
    return _to_dict(review, db)


@router.get("/")
def list_reviews(
    worker_id: Optional[int] = None,
    user_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(database.get_db),
):
    """List reviews, optionally filtered by worker_id or user_id (latest first)."""
    q = db.query(models.RatingReview)
    if worker_id is not None:
        q = q.filter(models.RatingReview.worker_id == worker_id)
    if user_id is not None:
        q = q.filter(models.RatingReview.user_id == user_id)
    rows = q.order_by(models.RatingReview.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_dict(r, db) for r in rows]


@router.get("/{review_id}")
def get_review(review_id: int, db: Session = Depends(database.get_db)):
    review = db.query(models.RatingReview).filter(models.RatingReview.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return _to_dict(review, db)


@router.delete("/{review_id}")
def delete_review(review_id: int, db: Session = Depends(database.get_db)):
    review = db.query(models.RatingReview).filter(models.RatingReview.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    worker_id = review.worker_id
    db.delete(review)
    db.commit()
    if worker_id is not None:
        _recompute_worker_rating(db, worker_id)
    return {"ok": True}


@router.get("/worker/{worker_id}/summary")
def review_summary(worker_id: int, db: Session = Depends(database.get_db)):
    """Returns { count, average, distribution: {1:n,2:n,3:n,4:n,5:n} }."""
    rows = (
        db.query(models.RatingReview.rating)
        .filter(models.RatingReview.worker_id == worker_id)
        .all()
    )
    ratings = [r[0] for r in rows if r[0] is not None]
    count = len(ratings)
    average = (sum(ratings) / count) if count else 0.0
    distribution = {str(i): 0 for i in range(1, 6)}
    for r in ratings:
        bucket = max(1, min(5, int(round(r))))
        distribution[str(bucket)] += 1
    return {"count": count, "average": round(average, 2), "distribution": distribution}
