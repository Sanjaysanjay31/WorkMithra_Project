# WorkMithra

A multilingual local-services marketplace that connects clients with verified blue-collar workers — plumbers, electricians, carpenters, painters, AC technicians, and more. Built to remove the language barrier between an English/Hindi-speaking client and a Telugu/Tamil/Kannada-speaking worker by translating chat messages in real time.

---

## Who is it for?

- **Clients** who need a trusted local worker for a one-off home job and want a clear price agreed upfront.
- **Workers** who want a steady stream of nearby clients without depending on word-of-mouth or middlemen.

## What problem does it solve?

1. **Language barrier** — clients and workers in India often speak different languages. Chat messages auto-translate using AI so both sides read in their own language.
2. **No price transparency** — instead of a fixed rate, the worker quotes the price after a short chat. Both sides see and confirm the same number before the job is booked.
3. **Trust** — Aadhaar-style verification, ratings, and past-work history so a client can pick a worker confidently.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile + Web app | React Native (Expo Router), TypeScript |
| Backend API | FastAPI (Python 3.13) |
| Database | PostgreSQL (hosted on Supabase) |
| Real-time | Socket.IO (`python-socketio`) |
| Storage (images) | Supabase Storage |
| AI | Translation, language detection, speech-to-text (cloud APIs) |
| Auth | Email/OTP + password (passlib bcrypt) |

Mobile, Android emulator, iOS simulator, and web browser all run from the same Expo codebase.

---

## Modules

### 1. Authentication (`app/login.tsx`, `app/register.tsx`, `app/forgot-password.tsx`)
Email/phone + password login with role selection (User / Worker). OTP-based password reset over email. Session is persisted client-side and a `role` flag drives which navigation bar the app shows.

### 2. Home / Discover (`app/homePage.tsx`)
Smart worker search. Free-text or voice query → AI extracts the intended domain (e.g. "leak ni fix cheyalantunna" → "Plumber"). Multi-select sort (rating, distance, wage, experience, jobs) and rich filters (verified-only, availability, wage range).

### 3. Worker Detail (`app/worker_info.tsx`)
Worker profile with five tabs:
- **Profile** — basics, wage, experience, verification.
- **Reviews** — submit a star rating, read past client feedback.
- **Chat** — opens the AI translation chat.
- **Booking** — pick date (calendar picker), time (clock picker), describe the problem, optionally enter the agreed price.
- **Map** — distance + OpenStreetMap route from the client's location to the worker.

### 4. Client (User) Module
WorkMithra has two roles in the same `users` table distinguished by a `role` field: **Client** (books services) and **Worker** (provides services). The Client module covers the full consumer journey:

1. **Register** → OTP verify → account created
2. **Login** → token issued, session persisted locally
3. **Home / Discover** → browse or smart-match workers (text or voice search)
4. **Worker detail** → view profile, reviews, location
5. **Booking** → pick date/time, describe the problem, agree on a price after chat
6. **Chat** → real-time AI-translated messaging with the worker
7. **Review + Rating** → submit feedback after the job is complete
8. **Notifications** → status updates on bookings (accept/decline/complete)

The same screens adapt for Workers via the `role` flag, so a single codebase serves both sides.

### 5. AI Translation Chat (`app/chat.tsx`)
Each user picks their preferred language; messages are auto-translated to the other side's language and TTS read-aloud is one tap away. Conversation history is persisted in Postgres and polled every 3s so a worker logged in on the other device sees new messages without refresh — WhatsApp-style.

### 6. AI Voice Assistant (`components/ai-assistant.tsx`)
A floating, always-available voice assistant that sits on every screen for users and workers who cannot read or type comfortably. Tap the mic, speak in any supported Indian language, and the assistant transcribes (STT), understands intent via AI, and either reads the answer aloud (TTS) or navigates the app on the user's behalf — "naaku plumber kavali" jumps straight to the search results, "na bookings chupinchu" opens the Bookings page. Designed specifically for uneducated workers and clients so the entire app is usable hands-free, by voice alone, without ever needing to read the screen.

### 7. Booking + Dynamic Pricing (`app/bookings.tsx`, `app/worker_bookings.tsx`)
A booking starts with **no price**. After a short chat, either side can fill in the agreed amount, which is saved as `estimated_price` on the booking. The worker accepts/declines; the client sees a real-time notification. Status flow: `pending → upcoming → success` (or `rejected`).

### 8. Worker Dashboard (`app/worker_dashboard.tsx`)
Hero card with profile photo / initials avatar, average rating, total jobs, and total earnings. Past Work tab lists every completed booking with the client's review.

### 9. Profile (`app/profile.tsx`, `app/worker_profile.tsx`)
Editable personal/work/location/verification details. Profile photo upload goes straight to Supabase Storage (`all_images` bucket). Logout and "Switch Role" both clear the local cache so the next account login starts clean.

### 10. Notifications (`app/notifications.tsx`)
Per-user feed (worker or client) populated by booking events, price quotes, and accept/decline actions.

---

## Backend API Reference

All endpoints are served by FastAPI from [`backend/`](backend/). Real-time events run over Socket.IO via [`socket_manager.py`](backend/socket_manager.py).

### 1. Auth & User Account — [`backend/main.py`](backend/main.py)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/register` | New user signup (client or worker) |
| POST | `/login` | Authenticate, return session token |
| POST | `/send-otp` | Send OTP for verification |
| POST | `/verify-otp` | Verify the OTP code |
| POST | `/change-password` | Update password (authenticated) |
| POST | `/reset-password` | Forgot-password reset flow |
| POST | `/upload-profile-image` | Upload profile picture to Supabase Storage |

### 2. Profiles — [`backend/routers/profiles.py`](backend/routers/profiles.py)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/profiles/me` | Current logged-in user's profile |
| POST / PUT | `/profiles/me` | Create / update own profile |
| GET | `/profiles/user/{user_id}` | View another user's profile |
| PUT | `/profiles/user/{user_id}` | Update a user (admin/self) |
| GET | `/profiles/worker/{worker_id}/reviews` | All reviews for a worker |
| POST | `/profiles/review` | Client submits a review + rating |

### 3. Workers — [`backend/routers/workers.py`](backend/routers/workers.py)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/workers` | List all workers (search / filter) |
| GET | `/workers/smart-match` | AI-ranked best workers for a query |
| GET | `/workers/{worker_id}` | Single worker detail |
| PUT | `/workers/{worker_id}` | Worker updates own details |

### 4. Bookings — [`backend/routers/bookings.py`](backend/routers/bookings.py)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/bookings` | Client creates a booking |
| GET | `/bookings` | All bookings for the logged-in user |
| GET | `/bookings/{booking_id}` | Single booking detail |
| PUT | `/bookings/{booking_id}` | Update status / price (accept, reject, complete) |

### 5. Chat — [`backend/routers/chat.py`](backend/routers/chat.py) + [`backend/socket_events.py`](backend/socket_events.py)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/chat` | Send a message (persisted) |
| GET | `/chat/{user_id}/messages` | All messages for a user |
| GET | `/chat/conversation/{u1}/{u2}` | Full conversation between two users |

### 6. AI Services — [`backend/routers/ai.py`](backend/routers/ai.py)
| Endpoint | Purpose |
|---|---|
| `/ai/tts` | Text → Speech |
| `/ai/stt` | Speech → Text |
| `/ai/detect-lang` | Detect language of input text |
| `/ai/translate` | Translate between Indian languages / English |
| `/ai/extract` | Extract booking intent/details from free text or voice |
| `/ai/chat` | AI assistant chatbot endpoint |

### Request / Response Flow
```
Mobile App (Expo)  ──HTTP REST──▶  FastAPI (main.py + routers/)
                   ──WebSocket──▶  socket_manager.py
                                          │
                                          ▼
                              SQLAlchemy ORM (models.py)
                                          │
                                          ▼
                              PostgreSQL (Supabase)
```

- [`schemas.py`](backend/schemas.py) — Pydantic request/response validation
- [`models.py`](backend/models.py) — DB tables: `User`, `Worker`, `Booking`, `ChatMessage`, `RatingReview`
- [`database.py`](backend/database.py) — DB session / engine setup

---


## Project Status

Working: auth, search, booking flow, dynamic pricing, multilingual chat with persistence, profile management, role-aware navigation, notifications.


---

## Future Enhancements

- **In-app video calling** 
    <br>Let a client and worker hop on a quick video call before booking to inspect the problem visually (e.g. show the leaking pipe), reducing wrong-quote situations.
- **AI-verified worker status** 
  <br>Automated background check that scores a worker's profile completeness, document authenticity (Aadhaar / skill certificate OCR), and review consistency, and surfaces an "AI Verified" badge once thresholds are met.
- **Video proof of completed work**
  <br> Workers upload a short before/after clip after each job. The AI grades the work quality (cleanliness, completion) and the score feeds into the worker's overall rating, making the rating system harder to game and more meaningful.
- **Skill assessments** 
  <br> Short voice/video quizzes per skill (plumbing, wiring) graded by AI to certify domain expertise.
- **Dynamic surge pricing** 
  <br> Suggest a fair price band based on local demand, time-of-day, and worker availability.
- **Multi-worker jobs** — book a small crew for bigger jobs (deep cleaning, moving, painting a whole house) with split payments.
