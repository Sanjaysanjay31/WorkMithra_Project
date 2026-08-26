# Credential Rotation Checklist (do this before the demo)

Code can't rotate secrets held in external provider dashboards — each item
below needs a human with account access. Items are ordered by risk.

## 1. HuggingFace token — COMPROMISED, rotate now

`backend/.env` itself says: *"AI keys — ROTATE IMMEDIATELY (these were posted
in chat)"*. The token was shared in plaintext outside this machine.

1. Log in at https://huggingface.co/settings/tokens
2. Revoke the exposed token.
3. Create a new **fine-grained** token with only `Make calls to Inference Providers` permission (no repo write).
4. Paste it into `backend/.env` as `HF_TOKEN=hf_...` and redeploy the backend.

## 2. Sarvam AI key — same exposure, same treatment

1. Regenerate at your Sarvam dashboard.
2. Update `SARVAM_API_KEY=` in `backend/.env`, redeploy.

## 3. Supabase database password

The connection string in `backend/.env` embeds the password directly
(`postgresql://postgres.<proj>:<password>@...pooler.supabase.com:6543/postgres`)
and it is weak/guessable.

1. Supabase dashboard → Project Settings → Database → **Reset database password**.
2. Update `DATABASE_URL` in `backend/.env` with the new password, redeploy.
3. The app reads the DB only through the backend, so no frontend change is needed.

## 4. Supabase anon key — leaked via git history

The root `.env` was committed before "Ignore environment files" (26ff7b9), so
`EXPO_PUBLIC_SUPABASE_ANON_KEY` and the project URL are visible to anyone who
can see the repository history. An anon key is designed to be client-visible,
**but only if Row Level Security is enforced everywhere**:

- Check: Authentication → Policies for every table; Storage → `all_images`
  bucket policies. If any policy is `true`/public beyond what you intend,
  treat data as exposed.
- Safest option: Supabase dashboard → Settings → API → **Rotate anon key**
  (invalidates old JWTs), then update it in `.env` and rebuild the frontend.

## 5. SendGrid API key — UNUSED, deleted from `.env`; revoke it in SendGrid

Email OTP was verified to go entirely through Supabase Auth — no code in the
backend references SendGrid/SMTP at all. The `SENDGRID_API_KEY` and
`SENDER_EMAIL` lines were removed from `backend/.env` on that basis.

Deleting the line only removes it from this machine — the key itself is still
alive in SendGrid's systems. Log in at
https://app.sendgrid.com/settings/api_keys and **delete the key** so it can
never be used by anyone who saw it. (If you ever need transactional email
later, create a fresh key then.)

## 6. Git history scrub (optional but recommended)

- `backend/.env` was never committed — nothing to scrub there.
- Root `.env` IS in history (commits up to 26ff7b9). If this repo is or will
  be public, either make it private or rewrite history
  (`git filter-repo --path .env --invert-refrefs` / BFG) and force-push.
- Rotating per sections above makes the leaked values worthless regardless.

## 7. After rotating — verify

```bash
# backend still boots with new secrets
cd backend && python -m uvicorn main:app --port 8000
# test suites still green
./workmithra/Scripts/python.exe -m pytest tests -q
```

Then update the deployed Render service's environment variables (Dashboard →
your service → Environment) — local `.env` changes do not deploy themselves.
