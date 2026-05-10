#!/usr/bin/env python
"""Seed demo worker data into the database."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import engine, SessionLocal
from models import Base, User, Worker
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Create tables
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Demo workers
workers_data = [
    {
        "full_name": "Ramesh Kumar",
        "skill": "Plumber",
        "experience_years": 5,
        "rating": 4.8,
        "completed_jobs": 42,
        "phone": "+91-9876543210",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Ramesh",
        "hourly_rate": 500,
        "bio": "Expert plumber with 5 years of experience",
    },
    {
        "full_name": "Priya Singh",
        "skill": "Electrician",
        "experience_years": 7,
        "rating": 4.9,
        "completed_jobs": 58,
        "phone": "+91-9876543211",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Priya",
        "hourly_rate": 600,
        "bio": "Licensed electrician with excellent service record",
    },
    {
        "full_name": "Amit Patel",
        "skill": "Carpenter",
        "experience_years": 8,
        "rating": 4.7,
        "completed_jobs": 65,
        "phone": "+91-9876543212",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Amit",
        "hourly_rate": 550,
        "bio": "Skilled carpenter specializing in furniture and repairs",
    },
    {
        "full_name": "Vijay Rao",
        "skill": "Painter",
        "experience_years": 4,
        "rating": 4.6,
        "completed_jobs": 31,
        "phone": "+91-9876543213",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Vijay",
        "hourly_rate": 400,
        "bio": "Professional painter with eye for detail",
    },
    {
        "full_name": "Suresh Kumar",
        "skill": "Plumber",
        "experience_years": 6,
        "rating": 4.5,
        "completed_jobs": 37,
        "phone": "+91-9876543214",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Suresh",
        "hourly_rate": 480,
        "bio": "Reliable plumber available for 24/7 emergencies",
    },
    {
        "full_name": "Anita Sharma",
        "skill": "Electrician",
        "experience_years": 5,
        "rating": 4.9,
        "completed_jobs": 44,
        "phone": "+91-9876543215",
        "city": "Bangalore",
        "profile_image": "https://placehold.co/60x60?text=Anita",
        "hourly_rate": 580,
        "bio": "Expert in electrical installations and repairs",
    },
]

try:
    # Check if workers already exist
    existing_count = db.query(Worker).count()
    if existing_count > 0:
        print(f"Database already contains {existing_count} workers. Skipping seed.")
        db.close()
        sys.exit(0)
    
    # Add workers
    for w_data in workers_data:
        worker = Worker(
            full_name=w_data["full_name"],
            skill=w_data["skill"],
            experience_years=w_data["experience_years"],
            rating=w_data["rating"],
            completed_jobs=w_data["completed_jobs"],
            phone=w_data["phone"],
            city=w_data["city"],
            profile_image=w_data["profile_image"],
            hourly_rate=w_data.get("hourly_rate"),
            bio=w_data.get("bio"),
        )
        db.add(worker)
    
    db.commit()
    print(f"Successfully seeded {len(workers_data)} workers into the database!")
    
except Exception as e:
    db.rollback()
    print(f"Error seeding database: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
