# ⚡ WorkMithra Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Python 3.8+
- Node.js 14+
- npm or yarn

---

## Step 1: Backend Setup (2 minutes)

```bash
# Navigate to backend folder
cd backend

# Activate virtual environment
# Windows:
WorkMithra\Scripts\activate
# macOS/Linux:
source WorkMithra/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (for development, keys are optional)
echo "SENDGRID_API_KEY=test_key" > .env
echo "SENDER_EMAIL=test@example.com" >> .env

# Start backend server
uvicorn main:app --reload
```

✅ Backend running on: `http://localhost:8000`

---

## Step 2: Frontend Setup (2 minutes)

In a new terminal:

```bash
# From project root
npm install

# Start Expo development server
npx expo start

# In Expo CLI:
# Press 'i' for iOS simulator
# Press 'a' for Android emulator
# Press 'w' for web (if configured)
```

✅ Frontend ready on mobile emulator

---

## Step 3: Test the App (1 minute)

### Register as User
1. Click "Create New Account"
2. Select **"User"** role
3. Fill in form:
   - Name: John Doe
   - Phone: 9876543210
   - Email: john@example.com
   - Password: password123
4. Send OTP (check backend console for code)
5. Verify with OTP code
6. Create account

### Register as Worker
1. Same process but select **"Worker"** role
2. Can now access worker-specific features

### Test Login
1. Enter email/phone
2. Enter password
3. Successfully logged in!

### Test Role Switching
1. After login, tap role indicator
2. Choose different role
3. Confirm switch
4. Role updated!

---

## 📱 API Testing

### Quick Test with cURL

**Register:**
```bash
curl -X POST "http://localhost:8000/register" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test User",
    "phone": "9876543210",
    "email": "test@example.com",
    "password": "password123",
    "role": "user"
  }'
```

**Login:**
```bash
curl -X POST "http://localhost:8000/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "password123"
  }'
```

**Get User:**
```bash
curl http://localhost:8000/user/1
```

---

## 📁 File Structure

```
workmithra/
├── backend/
│   ├── main.py              ← API endpoints
│   ├── models.py            ← Database models
│   ├── schemas.py           ← Validation schemas
│   ├── database.py          ← DB connection
│   ├── requirements.txt
│   └── WorkMithra/          ← Virtual environment
├── app/
│   ├── register.tsx         ← Registration
│   ├── login.tsx            ← Login
│   └── (tabs)/              ← Main app screens
├── components/
│   ├── role-switcher.tsx    ← Role switching component
│   └── [other components]
├── package.json
├── IMPLEMENTATION_GUIDE.md  ← Full documentation
├── MIGRATION_GUIDE.md       ← Database migration
├── API_REFERENCE.md         ← API endpoints
└── README.md
```

---

## 🔍 Backend Console Output

You should see:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete

# When OTP is requested (development mode):
DEBUG: OTP for john@example.com is 123456
```

---

## 📊 Testing User Flows

### Flow 1: User Registration
```
Select Role → Fill Form → Send OTP → Verify OTP → Create Account → Login
```

### Flow 2: Worker Registration
```
Select Role → Fill Form → Send OTP → Verify OTP → Create Account → Login
```

### Flow 3: Role Switching
```
Login → Tap Role → Select New Role → Confirm → Role Updated
```

---

## ⚙️ Environment Configuration

### Development (.env)
```env
SENDGRID_API_KEY=test_key_or_empty
SENDER_EMAIL=test@example.com
DATABASE_URL=sqlite:///./workmithra.db
```

### Production (.env)
```env
SENDGRID_API_KEY=your_actual_sendgrid_key
SENDER_EMAIL=your_business_email@example.com
DATABASE_URL=mysql+pymysql://user:password@host/workmithra
```

---

## 🐛 Troubleshooting

### Backend won't start
```bash
# Clear Python cache
find . -type d -name __pycache__ -exec rm -r {} +

# Reinstall packages
pip uninstall -r requirements.txt -y
pip install -r requirements.txt

# Try again
uvicorn main:app --reload
```

### Frontend issues
```bash
# Clear Expo cache
npx expo start -c

# Reinstall node modules
rm -rf node_modules package-lock.json
npm install

# Restart Expo
npx expo start
```

### Database locked
```bash
# SQLite database is locked
# Solution: Stop backend and delete database
rm backend/workmithra.db
# Restart backend - new DB will be created
```

---

## 📖 View Full Documentation

- **Complete Guide:** See `IMPLEMENTATION_GUIDE.md`
- **Database Migration:** See `MIGRATION_GUIDE.md`
- **All API Endpoints:** See `API_REFERENCE.md`

---

## 💡 Pro Tips

1. **Check Backend Console** for OTP codes (dev mode)
2. **Use same email** if re-registering test account
3. **Switch roles** to test different UIs
4. **Test on real device** by using `expo go` app
5. **Read error messages** - they're very descriptive

---

## 🎨 Design Specs

- **Dimensions:** 535px × 600px
- **Primary Color:** #6F42C1 (Purple)
- **Secondary Color:** #FF6B6B (Red)
- **Accent Color:** #4ECDC4 (Teal)

---

## ✅ What's New

✅ Unified user/worker model
✅ Beautiful registration flow with role selection
✅ Enhanced login page
✅ Role switching functionality
✅ Complete API documentation
✅ Migration guide included
✅ Professional UI/UX design

---

## 🚢 Deploy to Production

### Backend
```bash
# Use production ASGI server
pip install gunicorn
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

### Frontend
```bash
# Build for production
eas build --platform all

# or use Expo Go for quick testing
```

---

## 📞 Need Help?

1. Check `API_REFERENCE.md` for endpoint details
2. Review `IMPLEMENTATION_GUIDE.md` for architecture
3. See `MIGRATION_GUIDE.md` for database setup
4. Check backend console logs for errors

---

## ⏱️ Time Estimates

| Task | Time |
|------|------|
| Backend setup | 2 min |
| Frontend setup | 2 min |
| First registration | 3 min |
| Test all flows | 5 min |
| **Total** | **12 min** |

---

**Happy coding! 🚀**

For detailed information, refer to the documentation files in the project root.
