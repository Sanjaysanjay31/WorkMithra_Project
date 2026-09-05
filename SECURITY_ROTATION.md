# Zero-Trust Security & Credential Rotation Runbook

> **Audience:** DevOps Engineers, Security Auditors, and Production Maintainers  
> **Status:** Active Protocol  
> **Classification:** Confidential Operational Procedure  
> **Scope:** WorkMithra API Gateway, Database, Storage, Payment Gateway, and AI Providers

---

## 1. Executive Summary & Security Posture

WorkMithra adheres to a **Zero-Trust Security Architecture**. Environment variables and external service credentials must never be committed to source control, shared across unencrypted channels, or embedded into client-side application bundles.

This document outlines:
1. The complete inventory of secrets utilized by the WorkMithra platform.
2. Step-by-step procedures for rotating credentials without service interruption.
3. Mitigation strategies for historical repository leaks.
4. Post-rotation verification and health check protocols.

---

## 2. Secrets Inventory & Risk Matrix

| Secret / Identifier | Associated Service | Risk Level | Blast Radius if Compromised | Rotation Frequency |
|---|---|:---:|---|:---:|
| `DATABASE_URL` | Supabase PostgreSQL | **CRITICAL** | Direct read/write access to all 16 database tables | 90 Days / Immediate on leak |
| `JWT_SECRET` | Backend Auth Gateway | **CRITICAL** | Forgery of user/worker auth tokens & role escalation | 90 Days / Immediate on leak |
| `RAZORPAY_KEY_SECRET` | Razorpay Merchant Gateway | **CRITICAL** | Unauthorized refunds, fraudulent verification | 90 Days / Immediate on leak |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Event Ingestion | **HIGH** | Forgery of `payment.captured` webhook callbacks | 90 Days / Immediate on leak |
| `SUPABASE_KEY` (Anon) | Supabase Storage Bucket | **MEDIUM** | Direct unauthorized uploads to `all_images` bucket | 180 Days |
| `SARVAM_API_KEY` | Sarvam AI Indic Engine | **MEDIUM** | API credit drain / Quota exhaustion | 90 Days / Immediate on leak |
| `GEMINI_API_KEY` | Google AI Studio | **MEDIUM** | Quota exhaustion for LLM & fallback services | 90 Days / Immediate on leak |
| `GROQ_API_KEY` | Groq Cloud | **LOW** | Low-latency inference quota drain | 90 Days / Immediate on leak |
| `google-services.json` | Firebase Cloud Messaging | **LOW** | Android push notification delivery interruption | Annual |

---

## 3. Step-by-Step Credential Rotation Runbooks

### 3.1 Supabase Database Password & Connection String (`DATABASE_URL`)

The database connection string contains direct administrative credentials for your PostgreSQL cluster.

1. Navigate to the **[Supabase Dashboard](https://supabase.com/dashboard)**.
2. Select your WorkMithra project ➔ **Project Settings** (gear icon) ➔ **Database**.
3. Scroll down to **Database Password** and click **Reset Database Password**.
4. Generate a cryptographically random 32-character alphanumeric password.
5. In your production hosting environment (e.g., Render Dashboard):
   - Update `DATABASE_URL` with the new pooled connection string:
     ```
     postgresql://postgres.<project-ref>:<NEW_PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
     ```
6. In local development:
   - Update `backend/.env` with the new connection string.
7. Trigger a zero-downtime redeployment of the backend service.

---

### 3.2 JWT Secret (`JWT_SECRET`) & Session Revocation

The `JWT_SECRET` signs and validates authentication tokens for both Clients and Workers.

> [!WARNING]
> Changing `JWT_SECRET` will immediately invalidate all active sessions across web and mobile clients, requiring users to log in again.

1. Generate a secure 64-character hexadecimal key:
   ```powershell
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
2. Update the variable in your production hosting dashboard and `backend/.env`:
   ```env
   JWT_SECRET=your_new_generated_64_char_hexadecimal_secret_string
   ```
3. *(Optional)* To selectively revoke sessions without rotating the global key:
   - Increment `token_version` on specific `users` or `workers` database records:
     ```sql
     UPDATE users SET token_version = token_version + 1 WHERE id = <TARGET_USER_ID>;
     UPDATE workers SET token_version = token_version + 1 WHERE id = <TARGET_WORKER_ID>;
     ```
4. Restart the backend API gateway to apply the new secret.

---

### 3.3 Razorpay Keys & Webhook Secret (`RAZORPAY_*`)

Razorpay keys control payment order generation, client checkout verification, and server-to-server webhook reconciliation.

1. Log in to the **[Razorpay Dashboard](https://dashboard.razorpay.com/)**.
2. Navigate to **Account & Settings** ➔ **API Keys**.
3. Click **Regenerate Key**:
   - Razorpay provides an option to keep the old key active for **24 hours** to ensure zero-downtime transitions.
4. Copy the new **Key ID** and **Key Secret**.
5. Update `backend/.env` and your production deployment:
   ```env
   RAZORPAY_KEY_ID=rzp_live_... (or rzp_test_...)
   RAZORPAY_KEY_SECRET=your_new_razorpay_key_secret
   ```
6. Navigate to **Account & Settings** ➔ **Webhooks**:
   - Edit the existing webhook pointing to `https://<your-domain>/payments/webhook`.
   - Update the **Secret** field with a newly generated high-entropy secret.
   - Update `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`.
7. Verify order creation and webhook receipt using test events.

---

### 3.4 Supabase Anon Key (`SUPABASE_KEY`) & Storage RLS

1. Go to **[Supabase Dashboard](https://supabase.com/dashboard)** ➔ **Project Settings** ➔ **API**.
2. Under **Project API Keys**, locate the `anon` / `public` key.
3. Click **Rotate Key** (select immediate invalidation or scheduled grace period).
4. Update `SUPABASE_KEY` in `backend/.env`.
5. Verify Storage Row Level Security (RLS) policies:
   - Ensure the `all_images` bucket restricts file extensions and limits file size to ≤ 5MB.
   - The backend validates magic bytes before writing, but public policies should prevent direct unauthorized overwrites.

---

### 3.5 AI Provider Keys (Sarvam, Gemini, Groq)

WorkMithra's AI Orchestrator features **automatic multi-model fallback** (Sarvam ➔ Gemini ➔ Groq). Rotating one key does not take down the AI pipeline.

#### Sarvam AI (`SARVAM_API_KEY`):
1. Navigate to **[Sarvam Dashboard](https://dashboard.sarvam.ai/)**.
2. Delete the old API key and create a new key.
3. Update `SARVAM_API_KEY` in `backend/.env`.

#### Google Gemini (`GEMINI_API_KEY`):
1. Navigate to **[Google AI Studio](https://aistudio.google.com/app/apikey)**.
2. Revoke the existing key and click **Create API Key**.
3. Update `GEMINI_API_KEY` in `backend/.env`.

#### Groq Cloud (`GROQ_API_KEY`):
1. Navigate to **[Groq Console](https://console.groq.com/keys)**.
2. Delete the compromised key and create a new one.
3. Update `GROQ_API_KEY` in `backend/.env`.

---

## 4. Git History Scrubbing & Repository Sanitization

If an environment file (e.g. root `.env`) was inadvertently tracked in past git commits, rotating the keys renders old secrets useless. However, to maintain a clean security audit log:

### Option A: Using `git-filter-repo` (Recommended)
```bash
# 1. Install git-filter-repo
pip install git-filter-repo

# 2. Scrub .env from all historical commits
git filter-repo --path .env --invert-paths --force

# 3. Force push the sanitized history to remote
git push origin --force --all
git push origin --force --tags
```

### Option B: Using BFG Repo-Cleaner
```bash
# 1. Download BFG jar
java -jar bfg.jar --delete-files .env

# 2. Clean git references
git reflog expire --expire=now --all && git gc --prune=now --aggressive

# 3. Force push
git push origin --force --all
```

---

## 5. Defensive Verification & Health Check

After completing credential rotation, execute this automated verification protocol:

```powershell
# 1. Verify Backend Boots Cleanly
cd backend
.\workmithra\Scripts\python.exe -m uvicorn main:app --port 8000
# Expected output: [INFO] Application startup complete. Uvicorn running on http://127.0.0.1:8000

# 2. Check Database & Health Endpoint
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"
# Expected response: {"status": "ok", "database": "up"}

# 3. Run the Automated Pytest Suite (All 158 Tests)
.\workmithra\Scripts\python.exe -m pytest tests -q
# Expected output: 158 passed in ...s (0:01:58)

# 4. Run Frontend Jest Suite (All 57 Tests)
cd ..
npm test
# Expected output: Test Suites: 18 passed, 18 total. Tests: 57 passed, 57 total.
```

---

## 6. Incident Response & Escalation Matrix

If a production credential leak is detected:
1. **T+0m:** Revoke the compromised key immediately at the provider dashboard.
2. **T+5m:** Deploy a replacement key to the Render hosting environment.
3. **T+15m:** Inspect access logs (Supabase Auth Logs, Razorpay Webhook Logs, AI Studio Quotas) for abnormal activity.
4. **T+30m:** Increment `token_version` on all user/worker accounts if JWT secret was compromised.
5. **T+45m:** Log incident report and update this runbook with preventative safeguards.
