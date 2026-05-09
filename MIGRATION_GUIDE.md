# Database Migration Guide

## Overview
This guide helps you migrate from separate `users` and `workers` tables to a unified `users` table with role-based access.

---

## ⚠️ Before You Start
- **Backup** your current database
- This is a **breaking change** - existing applications using the old schema will need updates
- Test in a development environment first

---

## Option 1: Start Fresh (Recommended for Development)

### Step 1: Delete Existing Database
```bash
# If using SQLite
rm database.db

# If using MySQL/PostgreSQL
DROP DATABASE workmithra;
CREATE DATABASE workmithra;
```

### Step 2: Run the Application
The new schema will be created automatically:
```bash
cd backend
python main.py
```

SQLAlchemy will create the new `users` table with all fields.

---

## Option 2: Migrate Existing Data

### Step 1: Export Current Data
```sql
-- Export current users data
SELECT * FROM users INTO OUTFILE 'users_backup.csv' FIELDS TERMINATED BY ',';

-- Export current workers data  
SELECT * FROM workers INTO OUTFILE 'workers_backup.csv' FIELDS TERMINATED BY ',';
```

### Step 2: Create Migration Script

Create a file `backend/migrate_db.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import models
from database import DATABASE_URL, Base

# Create engine
engine = create_engine(DATABASE_URL)

# Create new tables
Base.metadata.create_all(bind=engine)

# Get session
Session = sessionmaker(bind=engine)
session = Session()

print("✅ Database migration completed!")
print("New unified 'users' table created successfully.")

session.close()
```

### Step 3: Run Migration
```bash
cd backend
python migrate_db.py
```

---

## Step 3: Re-import Data

### For Users (registering as "user")
```python
# Re-import users with role='user'
new_user = models.User(
    full_name="User Name",
    phone="phone_number",
    email="email@example.com",
    hashed_password="hashed_pwd",
    role="user",
    is_verified=True,
    is_active=True
)
session.add(new_user)
```

### For Workers (registering as "worker")
```python
# Re-import workers with role='worker'
new_worker = models.User(
    full_name="Worker Name",
    phone="phone_number",
    email="email@example.com",
    hashed_password="hashed_pwd",
    role="worker",
    is_verified=True,
    is_active=True,
    skill="Plumbing",
    experience_years=5,
    hourly_rate=500.0,
    availability=True
)
session.add(new_worker)
```

---

## Schema Comparison

### Old Schema
```
USERS TABLE          WORKERS TABLE
├── id               ├── worker_id
├── full_name        ├── user_id (FK)
├── phone_number     ├── full_name
├── email            ├── phone
├── hashed_password  ├── skill
                     ├── experience_years
                     ├── hourly_rate
                     ├── availability
                     ├── rating
                     └── total_jobs
```

### New Schema
```
USERS TABLE (Unified)
├── id
├── full_name
├── phone
├── email
├── hashed_password
├── role (user/worker) ← NEW
├── is_verified ← NEW
├── is_active ← NEW
├── profile_image
├── gender
├── address
├── city
├── state
├── pincode
├── latitude
├── longitude
├── skill (worker only)
├── experience_years (worker only)
├── bio (worker only)
├── hourly_rate (worker only)
├── availability (worker only)
├── current_status (worker only)
├── rating (worker only)
├── total_jobs (worker only)
├── completed_jobs (worker only)
├── cancelled_jobs (worker only)
├── aadhaar_verified (worker only)
├── created_at
└── updated_at
```

---

## Data Migration Script

Save as `backend/migrate_data.py`:

```python
from sqlalchemy.orm import Session
from database import get_db, engine
import models

def migrate_existing_data():
    """
    Migrate data from old schema to new unified schema
    """
    db = next(get_db())
    
    # Example: Convert existing data
    try:
        # Get all users from old schema (if exists)
        # This is a placeholder - adjust based on your old schema
        
        print("✅ Data migration started...")
        
        # Your migration logic here
        
        db.commit()
        print("✅ Data migration completed successfully!")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Migration failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    migrate_existing_data()
```

---

## Environment Setup

### Update `.env` file
```env
SENDGRID_API_KEY=your_sendgrid_api_key
SENDER_EMAIL=your_sender_email@example.com
DATABASE_URL=sqlite:///./workmithra.db
# or for MySQL: DATABASE_URL=mysql+pymysql://user:password@localhost/workmithra
```

---

## Verification Checklist

After migration, verify:

- [ ] Database created successfully
- [ ] `users` table exists with all fields
- [ ] No `workers` table (old one removed/archived)
- [ ] Registration endpoint working
- [ ] Login endpoint working
- [ ] Role switching working
- [ ] OTP verification working
- [ ] User profiles retrievable

---

## Rollback Procedure

If migration fails:

### 1. Restore from Backup
```bash
# If using SQLite
cp workmithra.db.backup workmithra.db

# If using MySQL
mysql workmithra < backup.sql
```

### 2. Revert Code
```bash
git checkout HEAD -- backend/models.py backend/schemas.py backend/main.py
```

### 3. Restart Application
```bash
cd backend
python main.py
```

---

## Common Issues & Solutions

### Issue: "Column 'role' already exists"
**Solution:** Run migration with `ALTER TABLE` instead of creating new table
```sql
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
```

### Issue: Foreign key constraint errors
**Solution:** Disable foreign key checks during migration
```sql
SET FOREIGN_KEY_CHECKS=0;
-- Run migrations
SET FOREIGN_KEY_CHECKS=1;
```

### Issue: Data loss after migration
**Solution:** Always backup before migration
```bash
# SQLite backup
cp database.db database.db.backup

# MySQL backup
mysqldump -u root -p workmithra > backup.sql
```

---

## Post-Migration Steps

1. **Test Authentication**
   - Register as user
   - Register as worker
   - Test login

2. **Test Role Switching**
   - Register as user
   - Switch to worker
   - Verify worker fields

3. **Update Frontend API Calls**
   - Change `phone_number` to `phone`
   - Include `role` in registration
   - Handle new response format

4. **Monitor Logs**
   - Check for errors
   - Verify OTP sending
   - Check role switching logs

---

## Database Query Examples

### Get all users
```sql
SELECT * FROM users WHERE role = 'user';
```

### Get all workers
```sql
SELECT id, full_name, skill, hourly_rate, rating FROM users WHERE role = 'worker';
```

### Get workers by city
```sql
SELECT * FROM users WHERE role = 'worker' AND city = 'Mumbai';
```

### Get workers by skill
```sql
SELECT * FROM users WHERE role = 'worker' AND skill = 'Plumbing';
```

### Get verified users
```sql
SELECT * FROM users WHERE is_verified = TRUE;
```

---

## Support

For migration issues:
1. Check logs: `tail backend/debug-logs/*`
2. Review error messages in terminal
3. Consult IMPLEMENTATION_GUIDE.md
4. Backup and retry
