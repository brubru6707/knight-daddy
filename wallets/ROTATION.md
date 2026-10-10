# Credential rotation list

Credentials that were exposed (pasted into a chat, log, or file) and should be rotated or revoked.
Values are never recorded here.

| When (UTC-local) | Credential | Where exposed | Risk | Action |
|---|---|---|---|---|
| 2026-10-10 | Google OAuth authorization code for `gcloud auth application-default login` | Pasted into the Claude Code chat transcript | Low: single-use, and already consumed by the successful login on 2026-10-10, so it cannot be reused | Done: login completed. Optional: check the Google account's third-party access page (myaccount.google.com/permissions) and remove any "Google Cloud SDK" grant you don't recognize. |
