from fastapi import APIRouter, Depends, HTTPException
from typing import List
from sqlalchemy.orm import Session
from datetime import datetime
import database, models, schemas

router = APIRouter()


@router.post("/", response_model=schemas.BookingResponse)
def create_booking(booking: schemas.BookingCreate, db: Session = Depends(database.get_db)):
    """Create a new booking."""
    if not booking.user_id or not booking.worker_id or not booking.service_id:
        raise HTTPException(status_code=400, detail="user_id, worker_id, and service_id are required")
    
    new_booking = models.Booking(
        user_id=booking.user_id,
        worker_id=booking.worker_id,
        service_id=booking.service_id,
        booking_date=booking.booking_date,
        booking_time=booking.booking_time,
        status=booking.status or 'pending',
        problem_description=booking.problem_description,
        estimated_price=booking.estimated_price,
        customer_address=booking.customer_address,
        latitude=booking.latitude,
        longitude=booking.longitude,
        created_at=datetime.utcnow(),
    )
    db.add(new_booking)
    db.commit()
    db.refresh(new_booking)
    return new_booking


@router.get("/", response_model=List[schemas.BookingResponse])
def list_bookings(skip: int = 0, limit: int = 20, db: Session = Depends(database.get_db)):
    """List all bookings."""
    bookings = db.query(models.Booking).offset(skip).limit(limit).all()
    return bookings


@router.get("/{booking_id}", response_model=schemas.BookingResponse)
def get_booking(booking_id: int, db: Session = Depends(database.get_db)):
    """Get a specific booking by ID."""
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking


@router.put("/{booking_id}", response_model=schemas.BookingResponse)
def update_booking(booking_id: int, booking_update: schemas.BookingCreate, db: Session = Depends(database.get_db)):
    """Update a booking."""
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking_update.status:
        booking.status = booking_update.status
    if booking_update.final_price is not None:
        booking.final_price = booking_update.final_price
    
    db.commit()
    db.refresh(booking)
    return booking
