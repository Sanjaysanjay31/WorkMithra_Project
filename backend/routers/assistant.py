from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas
from auth import get_current_user
from rate_limit import limiter

router = APIRouter()


def _current_user(current: Dict[str, Any]) -> tuple:
    """(user_id, role) from the authenticated token."""
    try:
        uid = int(current["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return uid, current.get("role", "user")


@router.get("/", response_model=List[schemas.AssistantMessageResponse])
def list_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """The logged-in user's assistant conversation, oldest first. Page with
    skip/limit — without skip, history beyond row 500 was unreachable."""
    uid, role = _current_user(current)
    rows = (
        db.query(models.AssistantMessage)
        .filter(
            models.AssistantMessage.user_id == uid,
            models.AssistantMessage.user_role == role,
        )
        .order_by(models.AssistantMessage.created_at.asc(), models.AssistantMessage.id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return rows


@router.post("/", response_model=schemas.AssistantMessageResponse)
@limiter.limit("30/minute")
def append_message(
    request: Request,
    payload: schemas.AssistantMessageCreate,
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Append one message to the caller's assistant history."""
    if payload.role not in ("ai", "me"):
        raise HTTPException(status_code=400, detail="role must be 'ai' or 'me'")
    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    uid, role = _current_user(current)
    msg = models.AssistantMessage(
        user_id=uid,
        user_role=role,
        role=payload.role,
        text=payload.text,
        created_at=datetime.utcnow(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.delete("/")
def clear_history(
    db: Session = Depends(database.get_db),
    current: Dict[str, Any] = Depends(get_current_user),
):
    """Delete the caller's entire assistant history."""
    uid, role = _current_user(current)
    deleted = (
        db.query(models.AssistantMessage)
        .filter(
            models.AssistantMessage.user_id == uid,
            models.AssistantMessage.user_role == role,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}
