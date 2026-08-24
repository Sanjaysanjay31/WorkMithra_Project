import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Disable per-IP rate limiting before any test module imports `main`.
# Every request in the suite comes from the same TestClient IP, which would
# otherwise trip the auth endpoint limits mid-run.
os.environ["RATE_LIMITING"] = "0"

# Point the app at a throwaway SQLite database BEFORE `database` is imported.
# load_dotenv() never overrides existing env vars, so this wins over the
# (production) DATABASE_URL in backend/.env — tests must never touch Supabase.
_db_path = os.path.join(tempfile.gettempdir(), "workmithra_tests.db")
if os.path.exists(_db_path):
    os.remove(_db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")

# SQLite engines don't accept the pool_size/max_overflow args used for Postgres.
import sqlalchemy

_orig_create_engine = sqlalchemy.create_engine


def _create_engine_for_tests(url, **kw):
    if str(url).startswith("sqlite"):
        kw = {k: v for k, v in kw.items() if k in ("pool_pre_ping",)}
    return _orig_create_engine(url, **kw)


sqlalchemy.create_engine = _create_engine_for_tests
