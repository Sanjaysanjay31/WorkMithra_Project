# Legacy scripts — reference only

These one-off scripts are kept for historical reference. Do NOT run them:

- `test_socket.py` — manual socket smoke test from before JWT socket auth
  existed. It authenticates with a bare `user_id` and no token, which the
  server now rejects. Use `backend/tests/` instead.
- `update_workers_schema.py` — one-time migration that added the `email`
  column to the `workers` table. Already applied; the schema now lives in
  `backend/models.py`.
