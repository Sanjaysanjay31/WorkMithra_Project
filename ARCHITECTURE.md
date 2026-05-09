# WorkMithra System Architecture

## 📊 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    WorkMithra Application                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐                      ┌──────────────────┐
│   Frontend      │ ◄──────HTTP/JSON───► │     Backend      │
│                 │                      │                  │
│  React Native   │                      │     FastAPI      │
│  + Expo         │                      │                  │
│                 │                      │  SQLAlchemy ORM  │
│ - Login         │                      │  Bcrypt Auth     │
│ - Register      │                      │  SendGrid Email  │
│ - Role Switch   │                      │                  │
│ - Dashboard     │                      │  Port: 8000      │
│                 │                      │                  │
└─────────────────┘                      └──────────────────┘
        │                                          │
        │                                          │
        │              ┌────────────────────────────┤
        │              │                            │
        └──────────────┘                            │
                                                    │
                                        ┌───────────▼────────┐
                                        │   SQLite/MySQL     │
                                        │   Database         │
                                        │                    │
                                        │  unified "users"   │
                                        │  table             │
                                        └────────────────────┘
```

---

## 🔄 Data Flow Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     USER REGISTRATION FLOW                     │
└──────────────────────────────────────────────────────────────┘

        Frontend                          Backend
        ════════════════════════════════════════════

1. User App
   │
   ├─► Choose Role (User/Worker)
   │
   ├─► Send OTP ─────────────────► /send-otp endpoint
   │   (Email input)              ├─► Generate OTP
   │                               ├─► Send via SendGrid
   │                               └─► Store in memory (4 min)
   │
   ├─► Display OTP Input
   │
   ├─► Verify OTP ────────────────► /verify-otp endpoint
   │   (OTP code)                  ├─► Check expiry
   │                               ├─► Match OTP
   │                               └─► Mark verified
   │
   ├─► Registration Form
   │   (Name, Phone, Email,
   │    Password, Role)
   │
   ├─► Submit ─────────────────────► /register endpoint
   │                                ├─► Validate input
   │                                ├─► Hash password (bcrypt)
   │                                ├─► Check duplicates
   │                                ├─► Insert to DB
   │                                └─► Return user data
   │
   └─► Success ◄────────────────────── User created!
       Redirect to Login
```

---

## 🔐 User Model Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   UNIFIED USER MODEL                        │
└────────────────────────────────────────────────────────────┘

┌─────────────────────┐         ┌──────────────────────┐
│   Basic Fields      │         │   Status Fields      │
├─────────────────────┤         ├──────────────────────┤
│ • id                │         │ • role               │
│ • full_name         │         │   - "user"           │
│ • phone             │         │   - "worker"         │
│ • email             │         │ • is_verified        │
│ • hashed_password   │         │ • is_active          │
│ • profile_image     │         │ • created_at         │
│ • gender            │         │ • updated_at         │
│ • address           │         │                      │
│ • city              │         │                      │
│ • state             │         │                      │
│ • pincode           │         │                      │
└─────────────────────┘         └──────────────────────┘

┌──────────────────────────────────────────────────────────┐
│   Worker-Specific Fields (populated when role='worker')   │
├──────────────────────────────────────────────────────────┤
│ • skill                    • hourly_rate                  │
│ • experience_years         • availability                 │
│ • bio                      • current_status               │
│ • rating                   • aadhaar_verified             │
│ • total_jobs               • latitude                     │
│ • completed_jobs           • longitude                    │
│ • cancelled_jobs                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🔌 API Endpoints Structure

```
BASE URL: http://localhost:8000

┌─ AUTHENTICATION ────────────────────────────────────────┐
│                                                          │
│ POST   /send-otp          → Send OTP to email           │
│ POST   /verify-otp        → Verify OTP code             │
│ POST   /register          → Register with role          │
│ POST   /login             → Login with credentials      │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌─ ROLE MANAGEMENT ───────────────────────────────────────┐
│                                                          │
│ POST   /switch-role/{id}  → Switch role (user↔worker)   │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌─ USER PROFILES ─────────────────────────────────────────┐
│                                                          │
│ GET    /user/{id}         → Get user profile            │
│ PUT    /user/{id}         → Update user profile         │
│ GET    /workers           → List all workers            │
│ PUT    /worker/{id}/profile → Update worker details     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🎨 Frontend Component Hierarchy

```
App Root
│
├── Stack Navigator
│   │
│   ├── Login Screen (login.tsx)
│   │   ├── Logo Container
│   │   ├── Email/Phone Input
│   │   ├── Password Input (with toggle)
│   │   ├── Login Button
│   │   ├── Divider
│   │   └── Register Button
│   │
│   ├── Register Screen (register.tsx)
│   │   │
│   │   ├── Step 1: Role Selection
│   │   │   ├── User Card (with icon)
│   │   │   ├── Worker Card (with icon)
│   │   │   └── Continue Button
│   │   │
│   │   └── Step 2: Account Creation
│   │       ├── Back Button
│   │       ├── Full Name Input
│   │       ├── Phone Input
│   │       ├── Email Input + OTP Button
│   │       ├── OTP Input + Verify Button
│   │       ├── Password Input
│   │       ├── Confirm Password Input
│   │       └── Register Button
│   │
│   └── Dashboard (tabs)
│       ├── Role Switcher (role-switcher.tsx)
│       │   ├── Role Indicator Button
│       │   └── Role Selection Modal
│       │       ├── User Option
│       │       └── Worker Option
│       │
│       └── User Content
│           ├── Explore Tab
│           ├── Profile Tab
│           └── Settings Tab
```

---

## 🔄 Role Switching Flow

```
┌─────────────────────────────────────────────────────────┐
│                    ROLE SWITCHING                        │
└─────────────────────────────────────────────────────────┘

Current User (role="user")
│
├─ Tap Role Indicator
│  └─ Shows: "USER" with dropdown
│
├─ Open Role Selection Modal
│  ├─ Option 1: User (current role - checkmark)
│  ├─ Option 2: Worker (available - tap to switch)
│  └─ Loading overlay during request
│
├─ Send POST /switch-role/{user_id}
│  └─ Payload: { "role": "worker" }
│
├─ Backend Response
│  ├─ Validate role
│  ├─ Update database
│  └─ Return updated user object
│
├─ Show Success Alert
│  └─ "Role switched to worker"
│
└─ UI Updates
   ├─ Role indicator shows: "WORKER"
   ├─ User can now access worker features
   └─ Background color changes to worker theme
```

---

## 📊 Request/Response Pattern

```
FRONTEND REQUEST
────────────────────────────────────────
POST /register
Content-Type: application/json

{
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "password": "secure_password",
  "role": "user"
}

BACKEND PROCESSING
────────────────────────────────────────
1. Validate schema (Pydantic)
2. Check email/phone uniqueness
3. Hash password (bcrypt)
4. Create database record
5. Return response

FRONTEND RESPONSE
────────────────────────────────────────
HTTP 200 OK

{
  "id": 1,
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "role": "user",
  "is_verified": true,
  "is_active": true,
  "created_at": "2026-05-09T12:00:00"
}
```

---

## 🛡️ Security Architecture

```
┌──────────────────────────────────────────────────────────┐
│              SECURITY LAYERS                             │
└──────────────────────────────────────────────────────────┘

Input Layer
├─► Pydantic validation (type checking)
├─► Email validation (EmailStr)
├─► Phone format validation
└─► Password strength (recommended 8+ chars)

Authentication Layer
├─► Bcrypt password hashing (salted)
├─► OTP verification (4-minute expiry)
├─► Email verification before account creation
└─► Account status checking (is_active flag)

Authorization Layer
├─► Role-based access control (user/worker)
├─► Role validation on endpoints
└─► User ID verification

Data Layer
├─► Unique constraints (email, phone)
├─► Foreign key relationships
├─► Timestamps tracking (created_at, updated_at)
└─► Status flags (is_verified, is_active)

Communication Layer
├─► CORS enabled for frontend
├─► HTTPS ready (use in production)
├─► JSON validation
└─► Error handling with appropriate status codes
```

---

## 📈 Performance Considerations

```
Frontend Optimization
├─► React Native compiled code
├─► Expo managed platform
├─► Lazy loading of components
└─► Optimized re-renders with hooks

Backend Optimization
├─► SQLAlchemy query optimization
├─► Database indexing (primary keys, email, phone)
├─► Async request handling (FastAPI)
├─► Connection pooling (SQLAlchemy)
└─► Caching (OTP store in memory)

Database Optimization
├─► Indexed columns (id, email, phone)
├─► Normalized schema (no duplication)
├─► Efficient queries (single table lookup)
└─► Regular backups recommended
```

---

## 🚀 Deployment Architecture

```
Development Environment
├─► Backend: uvicorn main:app --reload
├─► Frontend: expo start
├─► Database: SQLite (workmithra.db)
└─► Port: 8000 (backend)

Production Environment
├─► Backend
│   ├─► Gunicorn/uWSGI
│   ├─► Nginx reverse proxy
│   └─► SSL/TLS certificate
├─► Frontend
│   ├─► Built Expo app
│   ├─► App Store/Play Store distribution
│   └─► Push notifications enabled
├─► Database
│   ├─► MySQL/PostgreSQL
│   ├─► Regular automated backups
│   └─► Read replicas for scaling
└─► Infrastructure
    ├─► Docker containers
    ├─► Kubernetes orchestration (optional)
    └─► CloudFlare CDN for static assets
```

---

## 📱 Device Compatibility

```
Frontend (React Native + Expo)
├─► iOS 12.0+
├─► Android 6.0+ (API 23+)
├─► Web (optional)
└─► Dimensions: 535px × 600px (optimized)

Backend (FastAPI)
├─► Python 3.8+
├─► Cross-platform (Windows, macOS, Linux)
└─► Scalable to production

Database
├─► SQLite (development)
├─► MySQL 5.7+ (production)
├─► PostgreSQL 10+ (production)
└─► Cloud options: AWS RDS, Google Cloud SQL
```

---

## 🎯 System Statistics

| Metric | Value |
|--------|-------|
| Total API Endpoints | 9 |
| Database Tables | 1 (unified) |
| Frontend Screens | 3 (Login, Register, Dashboard) |
| Components | 4 (Main + Role Switcher) |
| Max OTP Validity | 4 minutes |
| User Role Options | 2 (user, worker) |
| Status States | 4 (online, busy, offline, unknown) |
| App Dimensions | 535×600 px |

---

This architecture ensures:
✅ Scalability
✅ Security
✅ Maintainability
✅ Performance
✅ User Experience
