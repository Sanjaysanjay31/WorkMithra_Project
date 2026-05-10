from fastapi import APIRouter, Depends, HTTPException
from typing import List
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas

router = APIRouter()


@router.post("/", response_model=dict)
def send_message(message: schemas.ChatMessageBase, db: Session = Depends(database.get_db)):
    """Send a chat message."""
    if not message.sender_id or not message.receiver_id:
        raise HTTPException(status_code=400, detail="sender_id and receiver_id are required")
    
    new_message = models.ChatMessage(
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        booking_id=message.booking_id,
        message=message.message,
        sent_at=datetime.utcnow(),
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)
    return {"id": new_message.id, "status": "sent"}


@router.get("/{user_id}/messages", response_model=List[schemas.ChatMessageBase])
def get_user_messages(user_id: int, skip: int = 0, limit: int = 50, db: Session = Depends(database.get_db)):
    """Get messages for a user."""
    messages = db.query(models.ChatMessage).filter(
        (models.ChatMessage.receiver_id == user_id) | (models.ChatMessage.sender_id == user_id)
    ).offset(skip).limit(limit).all()
    return messages


@router.get("/conversation/{user_id}/{other_user_id}", response_model=List[schemas.ChatMessageBase])
def get_conversation(user_id: int, other_user_id: int, skip: int = 0, limit: int = 50, db: Session = Depends(database.get_db)):
    """Get conversation between two users."""
    messages = db.query(models.ChatMessage).filter(
        ((models.ChatMessage.sender_id == user_id) & (models.ChatMessage.receiver_id == other_user_id)) |
        ((models.ChatMessage.sender_id == other_user_id) & (models.ChatMessage.receiver_id == user_id))
    ).offset(skip).limit(limit).all()
    return messages
