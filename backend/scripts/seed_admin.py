#!/usr/bin/env python
"""Seed (or update) the WorkMithra admin account.

Creates a user row with role='admin'. The normal /login endpoint resolves any
non-worker login against the users table and copies the row's role into the
JWT, so the seeded account can log in immediately — no separate admin auth
path. Idempotent: re-running ensures the account exists and is active; the
password is only overwritten when --reset-password is passed (or the account
has no password yet).

Security: there is NO default email or password. The email must come from
--email or ADMIN_EMAIL, so a predictable account like admin@workmithra.com can
never be provisioned by accident. When --password/ADMIN_PASSWORD is omitted a
strong random password is generated and printed ONCE at the end.

Usage:
    python scripts/seed_admin.py --email EMAIL [--password PASSWORD]
                                 [--name NAME] [--phone PHONE] [--reset-password]

Environment overrides: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE
(already-set env vars always win over nothing; CLI flags win over env).
"""

import argparse
import os
import secrets
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

# auth.py requires JWT_SECRET at import time. Load backend/.env explicitly so
# the script works from any working directory; already-set env vars win, so
# test/CI overrides are never clobbered.
from dotenv import load_dotenv

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from database import SessionLocal, engine
from models import Base, User
from auth import hash_password

DEFAULT_NAME = "WorkMithra Admin"


def seed_admin(db, email, password, full_name=DEFAULT_NAME, phone=None, reset_password=False):
    """Create or update the admin account. Returns (user, created)."""
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("email is required")
    if not password:
        raise ValueError("password is required")

    user = db.query(User).filter(User.email == email).first()
    created = user is None
    if created:
        user = User(email=email, full_name=full_name or DEFAULT_NAME, phone=phone)
        db.add(user)
    # Re-running heals a demoted/deactivated admin instead of failing loudly.
    user.role = "admin"
    user.is_active = True
    if created or reset_password or not user.hashed_password:
        user.hashed_password = hash_password(password)
    db.commit()
    db.refresh(user)
    return user, created


def main():
    parser = argparse.ArgumentParser(description="Seed the WorkMithra admin account")
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL"))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD"))
    parser.add_argument("--name", default=os.getenv("ADMIN_NAME", DEFAULT_NAME))
    parser.add_argument("--phone", default=os.getenv("ADMIN_PHONE"))
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Overwrite the password of an existing admin account",
    )
    args = parser.parse_args()

    # No predictable fallback email: an admin account must be chosen
    # deliberately, or a stray `python scripts/seed_admin.py` would create a
    # well-known credential guarding service CRUD.
    if not (args.email or "").strip():
        parser.error("--email (or ADMIN_EMAIL) is required")

    # No default password either. When none is supplied we mint a strong random
    # one and print it exactly once, below, for the operator to store.
    generated_password = False
    password = args.password
    if not password:
        password = secrets.token_urlsafe(12)
        generated_password = True

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Snapshot the pre-seed role so silent re-promotion of an existing
        # (possibly demoted/deactivated) account is at least announced loudly.
        existing = (
            db.query(User).filter(User.email == args.email.strip().lower()).first()
        )
        previous_role = None if existing is None else existing.role

        user, created = seed_admin(
            db,
            args.email,
            password,
            full_name=args.name,
            phone=args.phone,
            reset_password=args.reset_password,
        )
    except Exception as e:
        db.rollback()
        print(f"Error seeding admin: {e}")
        sys.exit(1)
    finally:
        db.close()

    print(f"{'Created' if created else 'Updated'} admin account:")
    print(f"  id:    {user.id}")
    print(f"  email: {user.email}")
    print(f"  name:  {user.full_name}")
    print(f"  role:  {user.role}")
    if not created and previous_role != "admin":
        print(f"  NOTE: this account previously had role='{previous_role}' and has been re-promoted to 'admin'.")
    if created or args.reset_password:
        if generated_password:
            print("Generated password (shown once — store it in a password manager now):")
            print(f"  {password}")
        print("Log in via POST /login with the email and password above.")


if __name__ == "__main__":
    main()
