from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from rate_limit import limiter
from booking_status import normalize_status

router = APIRouter()

# Raw status values that count as completed — the canonical value plus any
# legacy spellings mapped to it in shared/booking-status.json. Comparing on
# the exact string "completed" would treat legacy rows ("success") as
# uncompleted, blocking reviews for genuinely finished jobs.
import json as _json
from pathlib import Path as _Path

try:
    _spec = _json.loads(
        (_Path(__file__).resolve().parent.parent.parent / "shared" / "booking-status.json")
        .read_text(encoding="utf-8")
    )
    _COMPLETED_STATUSES = ["completed"] + [
        k for k, v in _spec.get("legacy_map", {}).items() if v == "completed"
    ]
except Exception:
    _COMPLETED_STATUSES = ["completed", "success"]


def _current_user_id(current: Dict[str, Any]) -> int:
    try:
        return int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


def _pseudonym(name: Optional[str]) -> Optional[str]:
    """Reviewer names are shown publicly as 'First L.' so the directory
    can't be scraped for full identities."""
    if not name:
        return None
    parts = name.strip().split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def _to_dict(r: models.RatingReview, user_name: Optional[str]) -> Dict[str, Any]:
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


def _user_names(db: Session, user_ids: List[Optional[int]]) -> Dict[int, str]:
    """Batch-resolve reviewer display names in ONE query. The previous
    per-review lookup issued N extra queries for a list of N reviews."""
    ids = {i for i in user_ids if i is not None}
    if not ids:
        return {}
    rows = (
        db.query(models.User.id, models.User.full_name)
        .filter(models.User.id.in_(ids))
        .all()
    )
    return {uid: _pseudonym(name) for uid, name in rows}


def _single_dict(db: Session, r: models.RatingReview) -> Dict[str, Any]:
    names = _user_names(db, [r.user_id])
    return _to_dict(r, names.get(r.user_id) if r.user_id is not None else None)


def _recompute_worker_rating(db: Session, worker_id: int) -> None:
    """Recalculate the worker's average rating from ratings_reviews.

    Runs inside the CALLER's transaction (no commit here) so the review
    insert/delete and the rating update land atomically — the previous
    separate commit left the cached rating stale whenever the second
    write failed or the process crashed between the two commits."""
    avg = (
        db.query(func.avg(models.RatingReview.rating))
        .filter(models.RatingReview.worker_id == worker_id)
        .scalar()
    )
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if worker is not None:
        worker.rating = float(avg) if avg is not None else 0.0


@router.post("/")
@limiter.limit("10/minute")
def create_review(
    request: Request,
    payload: schemas.RatingReviewBase,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Create a new review. The reviewer is always the authenticated user.

    Reviews require a COMPLETED booking between the reviewer and the worker —
    ratings can't be fabricated without real work. One review per booking."""
    if payload.worker_id is None:
        raise HTTPException(status_code=400, detail="worker_id is required")
    if payload.rating is None or payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")
    # Reviews are written by clients about workers. A worker token must not be
    # able to create (or collide with) reviews via a same-numbered user id.
    if current.get("role", "user") != "user":
        raise HTTPException(status_code=403, detail="Only clients can write reviews")

    reviewer_id = _current_user_id(current)

    worker = db.query(models.Worker).filter(models.Worker.id == payload.worker_id).first()
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Find a completed booking between this reviewer and worker. If the client
    # supplied a booking_id it must be that one; otherwise any completed
    # booking between the pair is used.
    booking_q = db.query(models.Booking).filter(
        models.Booking.user_id == reviewer_id,
        models.Booking.worker_id == payload.worker_id,
        models.Booking.status.in_(_COMPLETED_STATUSES),
    )
    if payload.booking_id is not None:
        booking_q = booking_q.filter(models.Booking.id == payload.booking_id)
    booking = booking_q.first()
    if booking is None:
        raise HTTPException(
            status_code=403,
            detail="You can only review a worker after a completed booking with them",
        )

    existing = (
        db.query(models.RatingReview)
        .filter(models.RatingReview.booking_id == booking.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This booking has already been reviewed")

    review = models.RatingReview(
        booking_id=booking.id,
        user_id=reviewer_id,
        worker_id=payload.worker_id,
        rating=float(payload.rating),
        review_text=payload.review_text,
        created_at=datetime.utcnow(),
    )
    db.add(review)
    try:
        # flush (not commit) so the new row is visible to the average query;
        # the rating recompute below then lands in the SAME transaction.
        db.flush()
    except IntegrityError:
        # Lost a race on the unique booking_id constraint — the other request
        # created the review first.
        db.rollback()
        raise HTTPException(status_code=409, detail="This booking has already been reviewed")
    _recompute_worker_rating(db, payload.worker_id)
    db.commit()
    db.refresh(review)
    return _single_dict(db, review)


@router.get("/")
def list_reviews(
    worker_id: Optional[int] = None,
    user_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List reviews, optionally filtered by worker_id or user_id (latest first).

    Authenticated callers only — an open listing would let anyone enumerate
    which user reviewed which worker (the raw reviewer user_id is part of
    each row)."""
    q = db.query(models.RatingReview)
    if worker_id is not None:
        q = q.filter(models.RatingReview.worker_id == worker_id)
    if user_id is not None:
        q = q.filter(models.RatingReview.user_id == user_id)
    rows = q.order_by(models.RatingReview.created_at.desc(), models.RatingReview.id.desc()).offset(skip).limit(limit).all()
    names = _user_names(db, [r.user_id for r in rows])
    return [_to_dict(r, names.get(r.user_id) if r.user_id is not None else None) for r in rows]


@router.get("/{review_id}")
def get_review(
    review_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    review = db.query(models.RatingReview).filter(models.RatingReview.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return _single_dict(db, review)


@router.delete("/{review_id}")
def delete_review(
    review_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    review = db.query(models.RatingReview).filter(models.RatingReview.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    # Reviews belong to the client who wrote them. Worker tokens are rejected
    # outright — ids overlap between the users and workers tables, so an
    # id-only check would let worker #N delete user #N's review.
    if current.get("role", "user") != "user" or review.user_id != _current_user_id(current):
        raise HTTPException(status_code=403, detail="You can only delete your own review")
    worker_id = review.worker_id
    db.delete(review)
    # Same transaction as the recompute — deletion and the rating update
    # commit together or not at all.
    db.flush()
    if worker_id is not None:
        _recompute_worker_rating(db, worker_id)
    db.commit()
    return {"ok": True}


@router.get("/worker/{worker_id}/summary")
def review_summary(
    worker_id: int,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Returns { count, average, distribution: {1:n,2:n,3:n,4:n,5:n} }.
    Count/average are aggregated in SQL; only the rating column (not full
    rows) is fetched for the bucket distribution."""
    count, average = db.query(
        func.count(models.RatingReview.id),
        func.avg(models.RatingReview.rating),
    ).filter(
        models.RatingReview.worker_id == worker_id,
        models.RatingReview.rating.isnot(None),
    ).one()
    distribution = {str(i): 0 for i in range(1, 6)}
    rows = db.query(models.RatingReview.rating).filter(
        models.RatingReview.worker_id == worker_id,
        models.RatingReview.rating.isnot(None),
    ).all()
    for (r,) in rows:
        b = max(1, min(5, int(round(float(r)))))
        distribution[str(b)] += 1
    return {
        "count": int(count or 0),
        "average": round(float(average), 2) if average is not None else 0.0,
        "distribution": distribution,
    }
