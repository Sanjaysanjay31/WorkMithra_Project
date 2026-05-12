import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

def update_schema():
    with engine.connect() as conn:
        print("Checking for email column in workers table...")
        result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='workers' AND column_name='email'"))
        if not result.fetchone():
            print("Adding email column...")
            conn.execute(text("ALTER TABLE workers ADD COLUMN email VARCHAR(255) UNIQUE"))
            conn.commit()
        else:
            print("Email column already exists.")

        print("Checking for hashed_password column in workers table...")
        result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='workers' AND column_name='hashed_password'"))
        if not result.fetchone():
            print("Adding hashed_password column...")
            conn.execute(text("ALTER TABLE workers ADD COLUMN hashed_password VARCHAR(255)"))
            conn.commit()
        else:
            print("Hashed_password column already exists.")

if __name__ == "__main__":
    update_schema()
    print("Done.")
