# WorkMithra: Unified User System Implementation

## Overview
The application has been restructured to use a unified User model where both users and workers are the same person but with different roles. Users can switch between roles (user/worker) as needed.

---

## ✅ Backend Changes

### 1. Updated Models (`backend/models.py`)
**Key Changes:**
- Unified `User` model replaces separate users and workers tables
- Added `role` field: "user" or "worker"
- Added all worker-specific fields to the User model
- Added verification and status tracking fields

**New User Model Fields:**
```
Basic Info:
- id, full_name, phone, email, hashed_password
- profile_image, gender, address, city, state, pincode

Location:
- latitude, longitude

Status & Verification:
- role (user/worker), is_verified, is_active
- created_at, updated_at

Worker-Specific Fields (when role='worker'):
- skill, experience_years, bio, hourly_rate
- availability, current_status (online/busy/offline)
- rating, total_jobs, completed_jobs, cancelled_jobs
- aadhaar_verified
```

### 2. Updated Schemas (`backend/schemas.py`)
**New Schemas:**
- `UserRegister`: Includes full_name, phone, email, password, role
- `UserLogin`: Email or phone login
- `OTPRequest` & `OTPVerify`: Email verification
- `UserResponse`: Basic user info
- `WorkerProfileResponse`: Extended worker details
- `RoleUpdate`: For switching roles
- `WorkerProfileUpdate`: For updating worker profiles

### 3. New API Endpoints (`backend/main.py`)

#### Authentication
- `POST /send-otp` - Send OTP to email
- `POST /verify-otp` - Verify OTP
- `POST /register` - Register with role selection
- `POST /login` - Login with email/phone

#### Role Management
- `POST /switch-role/{user_id}` - Switch between user and worker roles
- `GET /user/{user_id}` - Get user profile
- `PUT /user/{user_id}` - Update user profile
- `PUT /worker/{user_id}/profile` - Update worker profile
- `GET /workers` - Get all workers

#### Features:
- CORS middleware enabled for frontend communication
- Role validation during registration and switching
- Account status checking (active/inactive)
- Timestamps for all records

---

## 🎨 Frontend Changes

### 1. Enhanced Registration Page (`app/register.tsx`)
**Features:**
- **Two-step registration:**
  - Step 1: Role selection (User or Worker)
  - Step 2: Account creation with email OTP verification

- **UI Enhancements:**
  - Beautiful role selection cards with icons
  - Color-coded roles (Red for users, Teal for workers)
  - Purple primary branding (#6F42C1)
  - Modern shadows and elevation effects
  - Responsive design for 535x600 dimensions

- **Form Fields:**
  - Full Name (with person icon)
  - Phone Number (with phone icon)
  - Email (with OTP verification)
  - Password (with eye toggle)
  - Confirm Password

- **Functionality:**
  - OTP sent to email before account creation
  - Real-time form validation
  - Loading states with spinner
  - Success alerts with navigation

### 2. Improved Login Page (`app/login.tsx`)
**Features:**
- Modern, clean design with centered logo
- Icons for better UX (mail, lock, eye toggle)
- Password visibility toggle
- Show/hide password with eye icon
- Forgot password link
- Divider with "OR" text
- Quick register button
- Footer with terms & conditions link
- Responsive layout with KeyboardAvoidingView

**Styling:**
- Beautiful logo container (#f0e6ff background)
- Clean input fields with subtle borders
- Red login button (#FF6B6B) with shadow
- Purple register button (#6F42C1)
- Professional color scheme

### 3. New Role Switcher Component (`components/role-switcher.tsx`)
**Features:**
- Floating role indicator button
- Modal popup for role selection
- Smooth animations
- Active role highlight with checkmark
- Loading state during role switch
- Confirmation alerts

**Usage:**
```tsx
import { RoleSwitcher } from '@/components/role-switcher';

<RoleSwitcher 
  currentRole="user"
  userId={123}
  onRoleChange={(newRole) => console.log(newRole)}
/>
```

---

## 🎨 UI/UX Design Details

### Color Scheme
```
Primary Purple:     #6F42C1
Secondary Red:      #FF6B6B
Accent Teal:        #4ECDC4
Light Purple:       #f0e6ff
Background:         #f8f9fa
Card Background:    white
Border Light:       #e9ecef
Text Dark:          #212529
Text Gray:          #6c757d
Text Light:         #adb5bd
Success Green:      #10b981
```

### Typography
- Headers: Bold, 26-28px
- Subtitles: Semi-bold, 16-18px
- Labels: Semi-bold, 14px
- Body: Regular, 15px

### Border Radius
- Large buttons: 25px (pill shape)
- Cards/Inputs: 12-16px
- Icons: 20-24px (circular)

### Spacing
- Horizontal padding: 20px
- Vertical gaps: 20-24px between form fields
- Card margins: 15px between role options

---

## 📱 App Dimensions
- **Width:** 535px
- **Height:** 600px
- Optimized for mobile portrait orientation

---

## 🔄 Workflow

### User Registration
1. User selects role (User or Worker)
2. Enters personal details
3. Sends OTP to email
4. Verifies OTP
5. Creates password
6. Account created with selected role

### User Login
1. Enter email/phone
2. Enter password
3. Login successful
4. Redirect to dashboard

### Role Switching
1. User taps role indicator
2. Modal shows role options
3. Select new role
4. Confirmation alert
5. Role updated in database

---

## 🛠️ Tech Stack

### Backend
- **Framework:** FastAPI
- **Database:** SQLAlchemy ORM
- **Authentication:** bcrypt (password hashing)
- **Email:** SendGrid API
- **Validation:** Pydantic

### Frontend
- **Framework:** React Native + Expo
- **Routing:** Expo Router
- **Navigation:** Stack navigation
- **Icons:** Ionicons, MaterialCommunityIcons
- **Styling:** StyleSheet (React Native)

---

## 📋 Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(255),
  phone VARCHAR(255) UNIQUE,
  email VARCHAR(255) UNIQUE,
  hashed_password VARCHAR(255),
  role VARCHAR(50),
  is_verified BOOLEAN,
  is_active BOOLEAN,
  profile_image TEXT,
  gender VARCHAR(50),
  address TEXT,
  city VARCHAR(255),
  state VARCHAR(255),
  pincode VARCHAR(10),
  latitude DOUBLE,
  longitude DOUBLE,
  skill VARCHAR(255),
  experience_years INT,
  bio TEXT,
  hourly_rate DECIMAL(10,2),
  availability BOOLEAN,
  current_status VARCHAR(50),
  rating FLOAT,
  total_jobs INT,
  completed_jobs INT,
  cancelled_jobs INT,
  aadhaar_verified BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 🚀 Running the Application

### Start Backend
```bash
cd backend
source WorkMithra/Scripts/activate  # Windows: WorkMithra\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Start Frontend
```bash
npm install
npx expo start
```

---

## 📝 API Response Examples

### Register Response
```json
{
  "id": 1,
  "full_name": "John Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "role": "user",
  "is_verified": true,
  "is_active": true,
  "created_at": "2026-05-09T12:00:00"
}
```

### Login Response
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "role": "user",
    "is_verified": true
  }
}
```

### Switch Role Response
```json
{
  "message": "Role switched to worker",
  "user": {
    "id": 1,
    "role": "worker"
  }
}
```

---

## ✨ Key Features

✅ **Unified User Model** - Same person can be user and worker
✅ **Role Switching** - Change roles anytime
✅ **Beautiful UI** - Modern, professional design
✅ **OTP Verification** - Email-based verification
✅ **Worker Profiles** - Complete worker information
✅ **Responsive Design** - Optimized for mobile
✅ **Error Handling** - Comprehensive error messages
✅ **Loading States** - User feedback during operations

---

## 🔐 Security Considerations

- Passwords hashed with bcrypt
- OTP expires in 4 minutes
- Email verification required
- Account active status tracking
- Role-based access control

---

## 📞 Support

For issues or questions, refer to the API documentation or contact the development team.
