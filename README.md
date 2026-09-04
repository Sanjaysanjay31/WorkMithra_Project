# WorkMithra

A multilingual local-services marketplace that connects clients with verified blue-collar workers — plumbers, electricians, carpenters, painters, AC technicians, and more. WorkMithra removes the language barrier between an English/Hindi-speaking client and a Telugu/Tamil/Kannada-speaking worker by translating chat in real time, and makes the entire app usable by voice for people who cannot read or type comfortably.

---

## 📌 Overview

WorkMithra is a two-sided platform with a single Expo codebase serving **Clients** (who book services) and **Workers** (who provide them). Clients discover nearby workers through smart, location-aware search, agree on a price through AI-translated chat, book a job, track its status in real time, and review the worker after completion — and workers do the same in reverse. Every screen is available in five UI languages (English, Telugu, Hindi, Tamil, Kannada), and a floating voice assistant lets illiterate or semi-literate users operate the whole app hands-free.

| | |
|---|---|
| **Product** | WorkMithra — "Work" + "Mithra" (friend) |
| **Client app** | Expo (Android APK + Web) |
| **Backend** | FastAPI on Render |
| **Database** | PostgreSQL on Supabase |
| **Real-time** | Socket.IO + Expo Push notifications |

---

## 🎯 Problem Statement

**Who is facing it** → Urban and semi-urban Indian households that need reliable help for home jobs, and the millions of blue-collar workers (plumbers, electricians, carpenters, painters, mechanics) who depend on word-of-mouth and middlemen for work.

**What they are facing** →
1. **Language barrier** — the client and the available worker often speak different languages, so they cannot describe the problem or agree on terms.
2. **No price transparency** — workers quote verbally, prices change mid-job, and there is no record of what was agreed.
3. **No trust signal** — no way to see a worker's history, ratings, or verification before letting them into your home.
4. **Digital exclusion** — most worker-facing apps assume literacy; a large share of the workforce cannot read or type.

**Why it matters** → These frictions keep a huge informal workforce under-employed and force clients into unreliable, unvetted arrangements. Both sides lose money and trust on every transaction.

**What the solution looks like** → One marketplace where discovery is location-based, the price is negotiated and recorded in-app, chat auto-translates into each side's own language, every completed job produces a verified two-way review, and voice is a first-class input everywhere.

**Success looks like** → A client can describe a leaking pipe by voice in Telugu, find a verified plumber within 10 km, agree on ₹400 in chat (each reading in their own language), get the job done, and rate the worker — while the worker builds a portable reputation and a steady stream of nearby clients, all without typing a word.

---

## 💡 Solution

WorkMithra is a mobile-first marketplace with role-aware experiences:

- **For clients:** search workers by skill/voice/location, compare ratings, wages, and distance, chat with auto-translation, book with an agreed price, get real-time status notifications, and review each completed job (with photos).
- **For workers:** a dashboard with earnings, ratings, and job history; incoming job requests they can accept/decline; price negotiation; availability management; and reviews from clients after every job.
- **For both:** a persistent AI-translated chat, a floating voice assistant, an in-app notification inbox plus Android system push notifications, and profiles with tabbed layouts (Details / Reviews / Settings).

The platform runs on one Expo codebase (Android + Web), one FastAPI backend, and one Postgres database, with AI capabilities (LLM, TTS, STT, translation) orchestrated across multiple Indian and global providers with automatic fallback.

---

## ✨ Key Features

- 🔐 **Dual-role authentication** — separate Client and Worker accounts with JWT sessions, OTP verification, email verification, and password reset.
- 🗣️ **Real-time translated chat** — messages auto-translate into each participant's preferred language; Socket.IO delivery with Postgres persistence and TTS read-aloud.
- 🎙️ **Voice-first AI assistant** — floating on every screen; speak in any supported Indian language to search, navigate, or ask questions (STT → LLM intent → TTS / navigation).
- 📍 **Smart worker discovery** — Haversine distance ranking, radius filter (default 10 km), filters for wage, experience, rating, jobs done, verification, and availability; multi-criteria sorting.
- 💰 **Price negotiation** — bookings start without a price; either side can propose an amount, the other accepts; the agreed number is recorded before the job proceeds.
- 🔄 **Live booking lifecycle** — `pending → upcoming → completed` (or `rejected`), with real-time notifications on every transition.
- ⭐ **Per-booking two-way reviews** — after each completed job the client reviews the worker *and* the worker reviews the client; each booking gets its own review, with up to 5 photos each.
- 🔔 **Notifications everywhere** — in-app inbox + live socket badge while the app is open; Android system push notifications (Expo Push + FCM) when it is closed.
- 🌐 **5-language UI** — English, Telugu, Hindi, Tamil, Kannada; the choice is a device preference that survives logout.
- 📅 **Worker availability** — workers mark available days; clients can filter by availability.
- 🖼️ **Photo uploads** — profile photos and review photos stored in Supabase Storage with server-side validation.
- 📊 **Worker dashboard** — average rating, total jobs, total earnings, past work with reviews.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│   Expo Router app (Android APK + Web) — one codebase, two roles │
│   REST (lib/api.ts)   Socket.IO (lib/socket.ts)   Push (FCM)    │
└───────────────┬─────────────────────┬───────────────────────────┘
                │ HTTPS               │ WebSocket
                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND (Render)                     │
│  main.py — auth, startup migrations, rate limiting, CORS        │
│  routers/ — workers, bookings, chat, reviews, profiles,         │
│             notifications, availability, job_history, ai, …     │
│  socket_manager.py + socket_events.py — real-time rooms         │
│  services/providers/ — AI orchestrator (Sarvam→Gemini→Groq)     │
└───────┬──────────────────────┬──────────────────────┬───────────┘
        │ SQLAlchemy           │ HTTP                 │ HTTP
        ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│ PostgreSQL       │  │ Supabase Storage │  │ AI providers        │
│ (Supabase)       │  │ bucket:          │  │ Sarvam / Gemini /   │
│ 16 tables        │  │ all_images       │  │ Groq (LLM·TTS·STT)  │
└──────────────────┘  └──────────────────┘  └─────────────────────┘
                                                    │
                                    Expo Push service (exp.host)
                                      delivers to Android via FCM
```

- **Frontend** talks only to the FastAPI backend (never directly to the database).
- **Real-time:** Socket.IO rooms per user/role for chat messages, booking updates, and notification badges.
- **Push:** the backend registers Expo push tokens per account and fans every notification out through the Expo Push API, which routes to FCM on Android.
- **AI:** a provider orchestrator tries Sarvam, then Gemini, then Groq, per capability (chat, translation, TTS, STT), so one provider's outage or quota exhaustion degrades gracefully.

---

## 🔄 How It Works

**Client journey**

1. Register (email/phone + password) → OTP/email verification → account created.
2. Home screen: type, speak, or filter to discover workers (`/workers/smart-match` ranks by distance and criteria).
3. Open a worker: profile, reviews, chat, booking, and map tabs.
4. Chat with the worker — each message auto-translated to the reader's language.
5. Book a date/time and describe the problem. Either side proposes a price; the other accepts.
6. Worker accepts the request → status becomes `upcoming`; both sides get notified.
7. Worker submits a **work report** (photos + note + final price) → status becomes `awaiting_payment`; client is notified to pay.
8. Client pays via **Razorpay** (test checkout) → payment is verified via HMAC; status remains `awaiting_payment` with `paid=True`.
9. Client submits a **review + rating** → review is saved, booking is **auto-completed** (`completed` status, job history recorded, worker stats updated). The bookings screen switches from "Rate worker" to "View my rating" once reviewed.

**Worker journey**

1. Register as a worker → set skills, wage, experience, location, availability, verification details.
2. Dashboard shows rating, jobs, earnings, and past work.
3. Incoming requests arrive in real time (socket + push); accept, decline, or counter the price.
4. Submit a **work report** (photos + note + final price) when the job is done. If the client doesn't pay within a reasonable time, **report non-payment** → booking becomes `unpaid` and a 1-star review is auto-posted on the client. Otherwise, wait for payment + client review, then review the client for that booking.

**Notification flow**

```
Backend event (booking accepted / price quoted / job completed / new message)
   ├─► notifications table            → in-app inbox + unread badge (socket)
   └─► Expo Push API → FCM → Android  → system alert even when app is closed
                                          (tap deep-links into the app)
```

---

## 🤖 AI Integration

All AI endpoints live in `backend/routers/ai.py` + `backend/routers/assistant.py`, backed by a provider orchestrator (`backend/services/providers/`) with sequential fallback **Sarvam → Gemini → Groq**:

| Capability | Endpoint | Used for |
|---|---|---|
| Chat / intent | `POST /ai/chat` | Voice assistant answers + intent understanding |
| Intent extraction | `POST /ai/extract` | "leak ni fix cheyalantunna" → domain "Plumber" |
| Translation | `POST /ai/translate` | Chat messages into the reader's language |
| Language detection | `POST /ai/detect-lang` | Pick the right translation direction |
| Text-to-speech | `POST /ai/tts` | Read answers and messages aloud (Indian voices) |
| Speech-to-text | `POST /ai/stt` | Voice notes and voice search |
| Assistant history | `GET/POST /assistant/` | Persisted per-user assistant conversation |

**Voice assistant** (`components/ai-assistant.tsx`): a floating, always-available assistant for users who cannot read or type. Tap the mic, speak in any supported language — the assistant transcribes, understands intent, and either answers aloud or navigates the app ("naaku plumber kavali" jumps to search results, "na bookings chupinchu" opens Bookings). The entire app is usable by voice alone.

All AI endpoints are authenticated, input-bounded (text length / audio size caps), and rate-limited per IP to protect provider quotas.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Mobile + Web app | React Native via **Expo Router** (SDK 54), TypeScript, React Compiler + New Architecture |
| Navigation / UI | expo-router, @react-navigation, react-native-reanimated, gesture-handler |
| Real-time client | socket.io-client |
| Device APIs | expo-location, expo-notifications, expo-image-picker, expo-audio / expo-av, expo-secure-store |
| Backend API | **FastAPI** (Python 3.13+; runs 3.14 on Render), Uvicorn |
| Real-time server | python-socketio + websockets |
| Database | **PostgreSQL** (Supabase), SQLAlchemy 2.x ORM |
| Image storage | **Supabase Storage** (public bucket `all_images`) |
| Auth | PyJWT + passlib/bcrypt, OTP & email verification, token-version revocation |
| Rate limiting | slowapi (per-IP) |
| AI providers | Sarvam AI, Google Gemini, Groq (orchestrated fallback) |
| Push | expo-notifications + Expo Push API + Firebase Cloud Messaging (V1) |
| Builds / deploy | EAS Build (Android APK), Render (backend) |
| Testing | pytest (backend), Jest + React Testing Library (frontend), tsc |

---

## 📱 Application Modules

| Screen | Purpose |
|---|---|
| `app/index.tsx`, `login.tsx`, `register.tsx`, `forgot-password.tsx` | Auth: role selection, OTP/email verification, password reset |
| `app/homePage.tsx` | Client home: smart search (text/voice), filters, worker cards |
| `app/worker_info.tsx` | Worker detail: Profile / Reviews (per-booking) / Chat / Booking / Map tabs |
| `app/bookings.tsx` | Client bookings: Present/Past split, price negotiation, "Rate worker" → "View my rating" |
| `app/chat.tsx` | AI-translated real-time chat with TTS |
| `app/notifications.tsx` | In-app notification inbox (per role) |
| `app/profile.tsx` | Client profile: Details / My Reviews / Settings tabs, change password, photo upload |
| `app/user_profile.tsx` | Client as seen by a worker, incl. worker→client per-booking reviews |
| `app/worker_dashboard.tsx` | Worker home: rating, jobs, earnings, past work |
| `app/worker_bookings.tsx` | Worker requests: accept/decline/complete, review client |
| `app/worker_profile.tsx` | Worker profile: Details / Reviews / Settings tabs |
| `app/worker_availability.tsx` | Manage available days |
| `components/ai-assistant.tsx` | Floating voice assistant (every screen) |
| `components/bottom-nav.tsx` | Role-aware navigation bar |

Role switching re-logs into a different account type; each role sees its own navigation, screens, and notification feed.

---

## 🗄️ Database Design

PostgreSQL on Supabase; tables are created by `Base.metadata.create_all()` at startup, and schema drift is handled by **idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations** in `backend/main.py` (no manual migration tool needed).

| Table | Purpose |
|---|---|
| `users` | Client accounts (auth + profile basics) |
| `workers` | Worker accounts (separate table; **id spaces overlap with users** — every cross-reference carries an explicit role) |
| `services` | Service catalog (Plumbing, Electrical, …) |
| `worker_services` | Many-to-many worker ↔ service (unique pair) |
| `bookings` | Jobs: date/time, status, problem, estimated/final price, `price_proposed_by`, geo-point |
| `payments` | Razorpay test-mode payment records (order, verify, status) |
| `ratings_reviews` | Two-way reviews: `reviewer_role`, `booking_id`, UNIQUE(`booking_id`, `reviewer_role`), up to 5 images |
| `user_profiles` | Extended client profile fields |
| `notifications` | Per-recipient in-app notifications (audience = user/worker) |
| `push_tokens` | Expo push tokens per account (registered/deregistered on login/logout) |
| `otp_verification` | OTP codes for phone/email verification |
| `email_verification` | Email verification tokens |
| `chat_messages` | Chat: sender/receiver id **+ role** (ids alone are ambiguous), optional booking link |
| `worker_availability` | Available days per worker (unique per day) |
| `job_history` | Completed-job ledger feeding dashboards |
| `assistant_history` | Persisted AI-assistant conversations per user+role |

Design notes:
- **Overlapping id spaces:** users and workers are separate tables whose numeric ids overlap, so chat participants, reviewers, and notification recipients always store `(id, role)` pairs.
- **Per-booking reviews:** the old one-review-per-pair constraint was replaced with UNIQUE(`booking_id`, `reviewer_role`) — every completed job gets its own review in each direction.
- Startup also creates indexes and backing unique indexes for check-then-insert upserts (race protection), each wrapped so a legacy-data conflict logs and continues instead of aborting boot.

---

## 🔐 Authentication & Security

- **JWT sessions** (PyJWT) with role claims; `JWT_SECRET` is mandatory — the server refuses to start without it.
- **Password hashing** with passlib/bcrypt.
- **OTP verification** for signup and **email-based password reset**; short-lived codes/tokens stored server-side.
- **Session revocation:** `token_version` columns on both users and workers let the backend invalidate all outstanding tokens for an account (e.g., after password change); `reset_jti` blocks reuse of a reset token.
- **Authorization:** every router resolves the caller from the JWT and scopes queries to the caller's id **and role**; worker/client ids are never trusted from the client side (e.g., the push-token role comes from the JWT, never the request body).
- **Rate limiting** (slowapi) on auth and all paid AI endpoints; AI inputs are size-bounded.
- **CORS** restricted to an allow-list (`ALLOWED_ORIGINS`).
- **Upload validation:** the backend checks image magic bytes (JPEG/PNG/GIF/WebP only, ≤ 5 MB, SVG rejected) before storing in Supabase Storage; review images are limited to 5 per review and must be http(s) URLs.
- **Secrets hygiene:** `.env` files, `google-services.json`, and FCM service-account keys are gitignored; EAS uploads are filtered by `.easignore` so Firebase client config reaches the builder while real secrets never do.

---

## 📍 Location & Worker Discovery

- Workers carry `latitude`/`longitude`; clients can share location via expo-location.
- `GET /workers/smart-match` supports:
  - free-text query `q` (AI-extracted domain from voice or text),
  - `lat`/`lng` + `radius` (km, default 10) using a **Haversine** distance expression,
  - filters: `min_wage`/`max_wage`, `min_experience`, `min_rating`, `min_jobs`, `verified_only`, `availability`,
  - sorting by rating, distance (`location`), wage, experience, or jobs,
  - bounded pagination (`limit ≤ 100`).
- The worker detail **Map tab** shows distance and an OpenStreetMap route from client to worker.
- Bookings store the job address + coordinates so workers know where to go.

---

## 📂 Project Structure

```
WorkMithra/
├── app/                    # Expo Router screens (client + worker modules)
├── components/             # ai-assistant, bottom-nav, avatar, modals, …
├── lib/                    # api, socket, push, i18n, storage, types, …
├── shared/                 # booking-status.json (single source of truth,
│                           #   consumed by frontend AND backend)
├── __tests__/              # Jest tests for screens + libs
├── assets/                 # icons, splash, adaptive icon
├── app.json                # Expo config (android.googleServicesFile, plugins)
├── eas.json                # EAS Build profiles (preview = APK, production)
├── .easignore              # EAS upload filter (allows google-services.json)
├── .env                    # EXPO_PUBLIC_API_URL (gitignored)
└── backend/
    ├── main.py             # app factory, auth routes, startup migrations
    ├── models.py           # SQLAlchemy models (16 tables)
    ├── schemas.py          # Pydantic request/response models
    ├── database.py         # engine/session
    ├── auth.py             # JWT issue/verify, current-user dependency
    ├── socket_manager.py   # Socket.IO server + rooms
    ├── socket_events.py    # real-time event handlers/emitters
    ├── rate_limit.py       # slowapi limiter
    ├── booking_status.py   # canonical status spec (mirrors shared/)
    ├── routers/            # workers, bookings, chat, reviews, profiles,
    │                       # notifications, availability, job_history,
    │                       # ai, assistant, services, worker_services
    ├── services/providers/ # AI orchestrator: sarvam, gemini, groq
    └── tests/              # pytest suite (119 tests)
```

---

## ⚙️ Installation & Setup

**Prerequisites:** Node.js 20+, Python 3.13+, an Expo account (for builds), a Supabase project, and API keys for at least one AI provider.

### Frontend

```bash
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_URL
npm start                   # Expo dev server (Android / iOS / Web)
```

### Backend

```bash
cd backend
python -m venv workmithra && source workmithra/Scripts/activate   # or source workmithra/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill values (see Environment Variables)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required for physical-phone testing (Expo Go): without
it the server only listens on localhost and the phone cannot reach it.

Tables, indexes, and column migrations apply automatically at startup.

### Android push notifications (one-time)

1. Create a Firebase project and register an Android app with package `com.sanjaysanjay31.workmithra`.
2. Download `google-services.json` into the project root (gitignored; allowed through `.easignore` for EAS uploads).
3. Create a service account with the **Firebase Cloud Messaging API** role, generate a private key JSON, and upload it to Expo: `npx eas credentials:manager` → Android → Push notifications (FCM V1).

---

## 🔑 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Supabase) |
| `JWT_SECRET` | ✅ | JWT signing secret (server refuses to start without it) |
| `SUPABASE_URL` | ✅ | Supabase project URL (storage uploads) |
| `SUPABASE_KEY` | ✅ | Supabase **anon** key (never the service_role key) |
| `SUPABASE_BUCKET_NAME` | – | Storage bucket (default `all_images`) |
| `ALLOWED_ORIGINS` | – | CORS allow-list |
| `RATE_LIMITING` | – | `0` disables rate limiting (tests) |
| `SARVAM_API_KEY` | –* | Sarvam AI (LLM/TTS/STT) |
| `GEMINI_API_KEY` | –* | Google Gemini (LLM/TTS/STT + models config `GEMINI_*_MODEL`, `GEMINI_TTS_VOICE`, timeouts) |
| `GROQ_API_KEY` | –* | Groq (LLM/STT fallback; `GROQ_*_MODEL`, timeouts) |
| `RAZORPAY_KEY_ID` | –* | Razorpay **test-mode** Key ID (get from [dashboard.razorpay.com](https://dashboard.razorpay.com/app/keys)) |
| `RAZORPAY_KEY_SECRET` | –* | Razorpay **test-mode** Key Secret |

\* At least one AI provider key is needed for AI features; the orchestrator falls back through configured providers.

### Frontend (root `.env`)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL, inlined at build time (also set per-profile in `eas.json`) |

`EXPO_PUBLIC_*` vars are baked into the bundle at build time — changing them requires a rebuild. If unset, `lib/api.ts` falls back to a local dev URL (`10.0.2.2:8000` on Android emulators, `127.0.0.1:8000` elsewhere).

---

## ▶️ Running the Project

```bash
# 1. Backend (terminal 1)
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 2. Frontend (terminal 2)
npm start                # then press a = Android, w = web
```

### Testing on a physical phone with Expo Go (no Render deploy needed)

1. Connect the PC and the phone to the **same WiFi**.
2. Find the PC's LAN IP: `Get-NetIPAddress -AddressFamily IPv4` (the WiFi
   entry, e.g. `192.168.101.73`). Put it in root `.env`:
   `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000`.
3. Terminal 1 — backend, reachable on the LAN:
   `cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000`,
   then open `http://<LAN-IP>:8000/health` **from the phone's browser** —
   it must return `{"status":"ok","database":"up"}` before continuing.
4. Terminal 2 — `npx expo start` and scan the QR with Expo Go (update Expo Go
   to the latest version first — it must support SDK 57).
5. If the QR/bundle won't load: allow the ports through Windows Firewall
   (admin PowerShell):
   `New-NetFirewallRule -DisplayName "Expo Metro" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow`
   `New-NetFirewallRule -DisplayName "WorkMithra API" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`
6. No EAS build or `eas.json` change is needed for this: `preview`/`production`
   profiles already point at the Render URL, which only applies at build time.

- Android emulator: `EXPO_PUBLIC_API_URL` unset → app auto-targets `http://10.0.2.2:8000`.
- Web: `npm run web`.
- Lint/type-check/tests: `npm run lint`, `npx tsc --noEmit`, `npm test` (frontend); `pytest` in `backend/`.

---

## 🚀 Deployment

### Backend → Render

- FastAPI service deployed from the repo (`backend/` root dir), start command `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- Environment variables from the table above are set in the Render dashboard.
- Startup runs `create_all()` + idempotent index/column migrations, so deploys self-heal schema drift.
- Free-tier note: the instance sleeps after inactivity; the first request after a cold start can take ~50 s.

### App → EAS Build (Android APK)

```bash
npx eas build --platform android --profile preview      # internal APK
npx eas build --platform android --profile production   # store-ready (auto-incrementing version)
```

- `preview` profile: `buildType: apk`, internal distribution, `EXPO_PUBLIC_API_URL` pointed at the Render backend.
- `app.json` → `android.googleServicesFile` makes Expo inject the Google Services Gradle plugin automatically (no manual `android/` edits).
- `.easignore` controls the upload: `google-services.json` is included for the build, while `.env` files and FCM service-account keys are excluded; the same files stay out of git via `.gitignore`.
- Web deployment: `npx expo export --platform web` (any static host).

---

## 🧪 Testing

| Suite | Count | Command |
|---|---|---|
| Backend (pytest) | **134 tests** across 21 files | `cd backend && pytest` |
| Frontend (Jest) | **48 tests** across 18 suites | `npm test` |
| Type check | — | `npx tsc --noEmit` |
| Production bundle check | — | `npx expo export --platform android` |

Coverage highlights: booking lifecycle + price negotiation, per-booking two-way reviews (including duplicate-booking rejection), chat with role disambiguation, push-token registration, socket events/rooms, security (auth, session revocation), profile fields, AI provider fallback, and startup migrations. Tests run against SQLite in-memory with rate limiting disabled (`RATE_LIMITING=0`).

### Razorpay test-mode checkout

Payments run via Razorpay in **test mode** — no real money moves. Use these test credentials inside the Razorpay checkout modal:

| Field | Value |
|---|---|
| Card number | `4111 1111 1111 1111` |
| Expiry | Any future date e.g. `12/28` |
| CVV | `111` |
| OTP | `111111` |

Alternatively, use UPI: `success@razorpay` as the UPI ID. The backend verifies every payment with HMAC — tampering the amount client-side is detected and rejected.

If `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are not set in `backend/.env`, the payment endpoints return a clean 503 `"payments not configured"` — the app stays functional for all non-payment flows.

---

## 🔮 Future Enhancements

- **In-app video calling** — a quick video call before booking to inspect the problem visually (show the leaking pipe), reducing wrong quotes.
- **AI-verified worker status** — automated scoring of profile completeness, document authenticity (Aadhaar / skill-certificate OCR), and review consistency, surfacing an "AI Verified" badge.
- **Video proof of completed work** — workers upload before/after clips; AI grades work quality and feeds the rating, making ratings harder to game.
- **Skill assessments** — short voice/video quizzes per skill, AI-graded, to certify domain expertise.
- **Dynamic surge pricing** — suggest a fair price band from local demand, time of day, and availability.
- **Multi-worker jobs** — book a small crew for big jobs (deep cleaning, house painting) with split payments.
- **iOS push** — add `GoogleService-Info.plist` + APNs key to extend push to iOS builds.

---

## ⚠️ Limitations

- **Razorpay test-mode only** — payments use Razorpay in test mode; going live requires swapping `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `backend/.env` from test to production keys.
- **Android-only push** — FCM is configured for Android; iOS push needs APNs setup, and web relies on the in-app inbox + socket.
- **Push delivery requires the FCM V1 key upload** — until the service-account key is added in Expo credentials, system push won't deliver (in-app notifications still work).
- **Storage policy trade-off** — the `all_images` bucket allows anon uploads (the backend uploads without a Supabase user session); backend validation guards the app path, but direct bucket writes bypass it.
- **Cold starts** — the Render free tier sleeps; first request after idle can take ~50 s (sockets reconnect automatically).
- **Overlapping id spaces** — users and workers live in separate tables with overlapping ids; every integration point must carry an explicit role, which is enforced in code but is a permanent source of care.
- **Legacy data migrations** — pre-role chat rows needed a one-time manual backfill; startup migrations now prevent recurrence.
- **No admin panel** — moderation, worker verification, and service catalog changes are database-level operations today.
- **Worker verification is self-declared** — documents are recorded as profile fields; automated verification is a future item.
