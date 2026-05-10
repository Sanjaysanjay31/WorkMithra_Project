from fastapi import APIRouter, Depends, HTTPException
from typing import List
from sqlalchemy.orm import Session
import database, models, schemas

router = APIRouter()


@router.get("", response_model=List[schemas.WorkerResponse])
def list_workers(skip: int = 0, limit: int = 20, db: Session = Depends(database.get_db)):
    """Return a paginated list of workers."""
    workers = db.query(models.Worker).offset(skip).limit(limit).all()
    return workers


@router.get("/{worker_id}", response_model=schemas.WorkerResponse)
def get_worker(worker_id: int, db: Session = Depends(database.get_db)):
    """Get a specific worker by ID."""
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker
