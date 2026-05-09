# WorkMithra API Reference

## Base URL
```
http://localhost:8000
```

---

## Authentication Endpoints

### 1. Send OTP
Send an OTP to user's email for verification.

**Endpoint:** `POST /send-otp`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "OTP sent successfully"
}
```

**Status Codes:**
- `200` - OTP sent successfully
- `500` - Failed to send OTP

---

### 2. Verify OTP
Verify the OTP sent to email.

**Endpoint:** `POST /verify-otp`

**Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "message": "OTP verified"
}
```

**Status Codes:**
- `200` - OTP verified successfully
- `400` - OTP not found, expired, or invalid

---

### 3. Register User
Register a new user or worker account.

**Endpoint:** `POST /register`

**Request:**
```json
{
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "password": "secure_password_123",
  "role": "user"
}
```

**Role Options:**
- `"user"` - For customers hiring workers
- `"worker"` - For service providers

**Response:**
```json
{
  "id": 1,
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "role": "user",
  "is_verified": true,
  "is_active": true,
  "profile_image": null,
  "gender": null,
  "city": null,
  "state": null,
  "pincode": null,
  "latitude": null,
  "longitude": null,
  "created_at": "2026-05-09T12:00:00"
}
```

**Status Codes:**
- `200` - Registration successful
- `400` - Email/Phone already registered or invalid role

---

### 4. Login User
Login with email or phone number.

**Endpoint:** `POST /login`

**Request:**
```json
{
  "identifier": "john@example.com",
  "password": "secure_password_123"
}
```

**Identifier Options:**
- Email address
- Phone number

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "role": "user",
    "is_verified": true
  }
}
```

**Status Codes:**
- `200` - Login successful
- `400` - Invalid credentials
- `403` - Account inactive

---

## User Profile Endpoints

### 5. Get User Profile
Get complete user profile information.

**Endpoint:** `GET /user/{user_id}`

**Parameters:**
- `user_id` (path) - User ID (integer)

**Response:**
```json
{
  "id": 1,
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "role": "user",
  "is_verified": true,
  "is_active": true,
  "profile_image": "https://example.com/image.jpg",
  "gender": "Male",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "latitude": 19.0760,
  "longitude": 72.8777,
  "created_at": "2026-05-09T12:00:00"
}
```

**Status Codes:**
- `200` - Profile retrieved successfully
- `404` - User not found

---

### 6. Update User Profile
Update basic user information.

**Endpoint:** `PUT /user/{user_id}`

**Parameters:**
- `user_id` (path) - User ID (integer)

**Request:**
```json
{
  "gender": "Male",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

**Response:**
```json
{
  "id": 1,
  "full_name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "role": "user",
  "is_verified": true,
  "is_active": true,
  "gender": "Male",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "latitude": 19.0760,
  "longitude": 72.8777,
  "updated_at": "2026-05-09T13:00:00"
}
```

**Status Codes:**
- `200` - Profile updated successfully
- `404` - User not found

---

## Role Management Endpoints

### 7. Switch Role
Switch between user and worker roles.

**Endpoint:** `POST /switch-role/{user_id}`

**Parameters:**
- `user_id` (path) - User ID (integer)

**Request:**
```json
{
  "role": "worker"
}
```

**Response:**
```json
{
  "message": "Role switched to worker",
  "user": {
    "id": 1,
    "role": "worker"
  }
}
```

**Status Codes:**
- `200` - Role switched successfully
- `400` - Invalid role
- `404` - User not found

---

## Worker Profile Endpoints

### 8. Update Worker Profile
Update worker-specific information.

**Endpoint:** `PUT /worker/{user_id}/profile`

**Parameters:**
- `user_id` (path) - User ID (integer)

**Request:**
```json
{
  "skill": "Plumbing",
  "experience_years": 5,
  "bio": "Professional plumber with 5 years of experience",
  "hourly_rate": 500.0,
  "city": "Mumbai",
  "address": "123 Main Street, Mumbai",
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

**Response:**
```json
{
  "id": 1,
  "full_name": "John Doe",
  "role": "worker",
  "skill": "Plumbing",
  "experience_years": 5,
  "bio": "Professional plumber with 5 years of experience",
  "hourly_rate": 500.0,
  "city": "Mumbai",
  "address": "123 Main Street, Mumbai",
  "availability": true,
  "current_status": "online",
  "rating": 4.5,
  "total_jobs": 150,
  "completed_jobs": 145,
  "cancelled_jobs": 5,
  "aadhaar_verified": false
}
```

**Status Codes:**
- `200` - Profile updated successfully
- `403` - User is not a worker
- `404` - User not found

---

### 9. Get All Workers
Get list of all available workers.

**Endpoint:** `GET /workers`

**Query Parameters (Optional):**
- `city` - Filter by city
- `skill` - Filter by skill
- `min_rating` - Minimum rating
- `availability` - Available workers only

**Response:**
```json
[
  {
    "id": 2,
    "full_name": "Jane Smith",
    "phone": "9876543211",
    "email": "jane@example.com",
    "role": "worker",
    "skill": "Electrical",
    "experience_years": 8,
    "hourly_rate": 600.0,
    "city": "Mumbai",
    "rating": 4.8,
    "total_jobs": 200,
    "completed_jobs": 198,
    "cancelled_jobs": 2,
    "availability": true,
    "current_status": "online"
  },
  {
    "id": 3,
    "full_name": "Bob Johnson",
    "phone": "9876543212",
    "email": "bob@example.com",
    "role": "worker",
    "skill": "Carpentry",
    "experience_years": 10,
    "hourly_rate": 700.0,
    "city": "Delhi",
    "rating": 4.9,
    "total_jobs": 250,
    "completed_jobs": 248,
    "cancelled_jobs": 2,
    "availability": true,
    "current_status": "offline"
  }
]
```

**Status Codes:**
- `200` - Workers retrieved successfully
- `400` - Invalid query parameters

---

## Error Response Format

All error responses follow this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

**Common Errors:**

| Status Code | Error Message | Solution |
|---|---|---|
| 400 | "Email or Phone already registered" | Use different email/phone |
| 400 | "Invalid credentials" | Check email/phone and password |
| 400 | "OTP not found" | Request new OTP first |
| 400 | "OTP expired" | Request new OTP (expires in 4 min) |
| 400 | "Invalid OTP" | Check OTP and try again |
| 403 | "User account is inactive" | Contact support |
| 403 | "User is not a worker" | Must be worker to use worker endpoints |
| 404 | "User not found" | Invalid user ID |
| 500 | "Failed to send OTP" | Email service issue, try again |

---

## Request Headers

All requests should include:

```
Content-Type: application/json
```

---

## Rate Limiting

- **OTP requests:** Max 3 per email per hour
- **Login attempts:** Max 5 failed attempts per hour
- **API calls:** No rate limit (can be added later)

---

## Testing with cURL

### Register User
```bash
curl -X POST "http://localhost:8000/register" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "phone": "9876543210",
    "email": "john@example.com",
    "password": "secure_password",
    "role": "user"
  }'
```

### Send OTP
```bash
curl -X POST "http://localhost:8000/send-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com"
  }'
```

### Verify OTP
```bash
curl -X POST "http://localhost:8000/verify-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

### Login
```bash
curl -X POST "http://localhost:8000/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "john@example.com",
    "password": "secure_password"
  }'
```

### Get User Profile
```bash
curl -X GET "http://localhost:8000/user/1"
```

### Switch Role
```bash
curl -X POST "http://localhost:8000/switch-role/1" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "worker"
  }'
```

---

## Environment Variables

Required `.env` file in backend folder:

```env
SENDGRID_API_KEY=your_sendgrid_api_key
SENDER_EMAIL=your_email@example.com
DATABASE_URL=sqlite:///./workmithra.db
```

---

## Postman Collection

Import this Postman collection for easy testing:

1. Create new collection "WorkMithra"
2. Add requests from above
3. Set base URL to `{{base_url}}`
4. Create environment variable `base_url = http://localhost:8000`
5. Save responses as examples

---

## WebSocket Support (Future)

Planned endpoints:
- `WS /notifications` - Real-time notifications
- `WS /chat/{user_id}` - Direct messaging

---

## Version History

- **v1.0** (May 2026) - Initial release with unified user model
- **v1.1** - Planned: Messaging system
- **v1.2** - Planned: Payment integration
- **v2.0** - Planned: Advanced matching algorithm
