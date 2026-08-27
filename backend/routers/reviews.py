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


def _parse_review_images(raw: Optional[str]) -> List[str]:
    """The review_images column stores a JSON array of URLs. Corrupt/legacy
    values degrade to an empty list instead of breaking the response."""
    if not raw:
        return []
    try:
        parsed = _json.loads(raw)
    except Exception:
        return []
    return [str(u) for u in parsed] if isinstance(parsed, list) else []


def _to_dict(r: models.RatingReview, reviewer_name: Optional[str]) -> Dict[str, Any]:
    return {
        "id": r.id,
        "booking_id": r.booking_id,
        "user_id": r.user_id,
        # Display name of whoever WROTE the review (pseudonymized) — for
        # client-written reviews this is the user, for worker-written ones
        # the worker. Kept under the legacy `user_name` key so existing
        # clients keep rendering.
        "user_name": reviewer_name,
        "worker_id": r.worker_id,
        # 'user' = client reviewed the worker (legacy default),
        # 'worker' = worker reviewed the client.
        "reviewer_role": r.reviewer_role or "user",
        "rating": float(r.rating) if r.rating is not None else 0.0,
        "review_text": r.review_text,
        "review_image": r.review_image,
        "review_images": _parse_review_images(r.review_images),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _reviewer_names(db: Session, rows: List[models.RatingReview]) -> Dict[int, str]:
    """Batch-resolve reviewer display names in ONE query per table.

    The reviewer depends on the review direction: client-written reviews show
    the user's name, worker-written ones the worker's name."""
    user_ids = {r.user_id for r in rows if (r.reviewer_role or "user") == "user" and r.user_id is not None}
    worker_ids = {r.worker_id for r in rows if r.reviewer_role == "worker" and r.worker_id is not None}
    names: Dict[int, str] = {}
    if user_ids:
        for uid, name in (
            db.query(models.User.id, models.User.full_name)
            .filter(models.User.id.in_(user_ids))
            .all()
        ):
            # Key by review id space is ambiguous (user/worker ids overlap),
            # so callers look up via the helper below instead of this dict.
            names[("user", uid)] = _pseudonym(name)
    if worker_ids:
        for wid, name in (
            db.query(models.Worker.id, models.Worker.full_name)
            .filter(models.Worker.id.in_(worker_ids))
            .all()
        ):
            names[("worker", wid)] = _pseudonym(name)
    return names


def _reviewer_name_for(names: Dict[Any, str], r: models.RatingReview) -> Optional[str]:
    if (r.reviewer_role or "user") == "worker":
        return names.get(("worker", r.worker_id)) if r.worker_id is not None else None
    return names.get(("user", r.user_id)) if r.user_id is not None else None


def _single_dict(db: Session, r: models.RatingReview) -> Dict[str, Any]:
    names = _reviewer_names(db, [r])
    return _to_dict(r, _reviewer_name_for(names, r))


# Reviews a worker RECEIVED are client-written (legacy rows have no role set).
def _received_by_worker_filter():
    from sqlalchemy import or_
    return or_(
        models.RatingReview.reviewer_role == "user",
        models.RatingReview.reviewer_role.is_(None),
    )


def _recompute_worker_rating(db: Session, worker_id: int) -> None:
    """Recalculate the worker's average rating from ratings_reviews.

    Runs inside the CALLER's transaction (no commit here) so the review
    insert/delete and the rating update land atomically — the previous
    separate commit left the cached rating stale whenever the second
    write failed or the process crashed between the two commits.

    Only reviews the worker RECEIVED count (client-written). Reviews the
    worker WROTE about clients also carry worker_id but must not affect
    the worker's own rating."""
    avg = (
        db.query(func.avg(models.RatingReview.rating))
        .filter(
            models.RatingReview.worker_id == worker_id,
            _received_by_worker_filter(),
        )
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
    """Create a new review. The reviewer is always the authenticated caller.

    Reviews are bidirectional:
      - clients (role 'user') review WORKERS — payload.worker_id is required;
      - workers (role 'worker') review CLIENTS — payload.user_id is required.

    Either direction requires a COMPLETED booking between the pair — ratings
    can't be fabricated without real work. Each side may leave one review per
    booking (uniqueness on booking_id + reviewer_role)."""
    role = current.get("role", "user")
    if role == "worker":
        if payload.user_id is None:
            raise HTTPException(status_code=400, detail="user_id is required")
    elif payload.worker_id is None:
        raise HTTPException(status_code=400, detail="worker_id is required")
    if payload.rating is None or payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")
    # Images are optional URLs (uploaded beforehand via /upload-review-image).
    # Only accept http(s) so a reviewer can't stash arbitrary payloads here.
    review_image = (payload.review_image or "").strip() or None
    if review_image is not None and not review_image.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="review_image must be an http(s) URL")
    # Up to FIVE photos per review. The schema already caps the array (422),
    # but validate again here for a clean 400 and defense against schema drift.
    image_urls = [u.strip() for u in (payload.review_images or []) if u and u.strip()]
    if len(image_urls) > 5:
        raise HTTPException(status_code=400, detail="A review can include at most 5 images")
    for u in image_urls:
        if not u.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Each review image must be an http(s) URL")
    # Backward compatibility: single-image readers (older app builds) only
    # look at review_image — keep it pointing at the first photo.
    if not review_image and image_urls:
        review_image = image_urls[0]

    reviewer_id = _current_user_id(current)

    if role == "worker":
        # Worker reviewing a client: user_id is the REVIEWED client.
        reviewed_user = db.query(models.User).filter(models.User.id == payload.user_id).first()
        if reviewed_user is None:
            raise HTTPException(status_code=404, detail="User not found")

        booking_q = db.query(models.Booking).filter(
            models.Booking.worker_id == reviewer_id,
            models.Booking.user_id == payload.user_id,
            models.Booking.status.in_(_COMPLETED_STATUSES),
        )
        if payload.booking_id is not None:
            booking_q = booking_q.filter(models.Booking.id == payload.booking_id)
        booking = booking_q.first()
        if booking is None:
            raise HTTPException(
                status_code=403,
                detail="You can only review a client after a completed booking with them",
            )

        existing = (
            db.query(models.RatingReview)
            .filter(
                models.RatingReview.booking_id == booking.id,
                models.RatingReview.reviewer_role == "worker",
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="You have already reviewed this client for that booking")

        review = models.RatingReview(
            booking_id=booking.id,
            user_id=payload.user_id,
            worker_id=reviewer_id,
            reviewer_role="worker",
            rating=float(payload.rating),
            review_text=payload.review_text,
            review_image=review_image,
            review_images=_json.dumps(image_urls) if image_urls else None,
            created_at=datetime.utcnow(),
        )
        db.add(review)
        try:
            # flush so a lost race on the unique (booking_id, reviewer_role)
            # constraint surfaces as a clean 409, not an unhandled 500.
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="You have already reviewed this client for that booking")
        # Clients have no stored rating aggregate — nothing to recompute.
        db.commit()
        db.refresh(review)
        return _single_dict(db, review)

    # Client reviewing a worker (the original direction). A worker token must
    # not be able to create (or collide with) reviews via a same-numbered
    # user id — the role branch above is the only worker path in.
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
        .filter(
            models.RatingReview.booking_id == booking.id,
            _received_by_worker_filter(),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This booking has already been reviewed")

    review = models.RatingReview(
        booking_id=booking.id,
        user_id=reviewer_id,
        worker_id=payload.worker_id,
        reviewer_role="user",
        rating=float(payload.rating),
        review_text=payload.review_text,
        review_image=review_image,
        review_images=_json.dumps(image_urls) if image_urls else None,
        created_at=datetime.utcnow(),
    )
    db.add(review)
    try:
        # flush (not commit) so the new row is visible to the average query;
        # the rating recompute below then lands in the SAME transaction.
        db.flush()
    except IntegrityError:
        # Lost a race on the unique (booking_id, reviewer_role) constraint —
        # the other request created the review first.
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
    mine: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """List reviews (latest first), filtered by who is being REVIEWED:

      - worker_id=W -> reviews RECEIVED BY worker W (client-written)
      - user_id=U   -> reviews RECEIVED BY client U (worker-written)
      - mine=true   -> reviews WRITTEN BY the authenticated caller (the
        bookings screens use the booking_ids to swap "Rate" for
        "View my rating" once a job has been reviewed)

    Authenticated callers only — an open listing would let anyone enumerate
    which user reviewed which worker (the raw reviewer user_id is part of
    each row)."""
    q = db.query(models.RatingReview)
    if mine:
        caller_id = _current_user_id(current)
        if current.get("role", "user") == "worker":
            q = q.filter(
                models.RatingReview.reviewer_role == "worker",
                models.RatingReview.worker_id == caller_id,
            )
        else:
            q = q.filter(
                _received_by_worker_filter(),
                models.RatingReview.user_id == caller_id,
            )
    if worker_id is not None:
        q = q.filter(
            models.RatingReview.worker_id == worker_id,
            _received_by_worker_filter(),
        )
    if user_id is not None:
        q = q.filter(
            models.RatingReview.user_id == user_id,
            models.RatingReview.reviewer_role == "worker",
        )
    rows = q.order_by(models.RatingReview.created_at.desc(), models.RatingReview.id.desc()).offset(skip).limit(limit).all()
    names = _reviewer_names(db, rows)
    return [_to_dict(r, _reviewer_name_for(names, r)) for r in rows]


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
    # Reviews belong to whoever WROTE them. Users and workers have overlapping
    # id spaces, so both the role AND the matching side's id must line up —
    # an id-only check would let worker #N delete user #N's review.
    caller_id = _current_user_id(current)
    caller_role = current.get("role", "user")
    if (review.reviewer_role or "user") == "worker":
        is_owner = caller_role == "worker" and review.worker_id == caller_id
    else:
        is_owner = caller_role == "user" and review.user_id == caller_id
    if not is_owner:
        raise HTTPException(status_code=403, detail="You can only delete your own review")
    worker_id = review.worker_id
    counts_toward_worker_rating = (review.reviewer_role or "user") == "user"
    db.delete(review)
    # Same transaction as the recompute — deletion and the rating update
    # commit together or not at all. Worker-written reviews never fed the
    # worker's rating, so deleting one must not trigger a recompute.
    db.flush()
    if worker_id is not None and counts_toward_worker_rating:
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
    rows) is fetched for the bucket distribution. Only reviews the worker
    RECEIVED count — reviews they wrote about clients share worker_id but
    are excluded."""
    count, average = db.query(
        func.count(models.RatingReview.id),
        func.avg(models.RatingReview.rating),
    ).filter(
        models.RatingReview.worker_id == worker_id,
        models.RatingReview.rating.isnot(None),
        _received_by_worker_filter(),
    ).one()
    distribution = {str(i): 0 for i in range(1, 6)}
    rows = db.query(models.RatingReview.rating).filter(
        models.RatingReview.worker_id == worker_id,
        models.RatingReview.rating.isnot(None),
        _received_by_worker_filter(),
    ).all()
    for (r,) in rows:
        b = max(1, min(5, int(round(float(r)))))
        distribution[str(b)] += 1
    return {
        "count": int(count or 0),
        "average": round(float(average), 2) if average is not None else 0.0,
        "distribution": distribution,
    }
