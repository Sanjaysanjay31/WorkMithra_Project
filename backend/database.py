from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set in backend/.env. "
        "Point it at your Postgres/Supabase database (or a sqlite:/// URL for local dev)."
    )

# SQLite engines don't accept the pool_size/max_overflow kwargs used for
# Postgres, so only pass them for real server databases.
_is_sqlite = DATABASE_URL.startswith("sqlite")
_engine_kwargs = {
    "pool_pre_ping": True,   # validate connection before use; drops dead ones
    "pool_recycle": 300,     # recycle connections older than 5 minutes
}
if not _is_sqlite:
    _engine_kwargs.update({"pool_size": 5, "max_overflow": 10})

engine = create_engine(DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
