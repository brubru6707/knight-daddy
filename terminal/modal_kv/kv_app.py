"""KNIGHTWATCH key-value store on Modal (replaces Upstash Redis; Vercel's own Storage is full).

One small CPU web endpoint backed by a persistent modal.Dict. The Vercel API (frontend/api/_lib/store.js) calls it
with a shared secret. Operations: get, set, del, setnx (set only if absent; used as the one-job-at-a-time lock).
Note: modal.Dict entries expire after 7 days without access, which is fine for snapshots and jobs.

Deploy (credentials as env vars only):
  MODAL_TOKEN_ID=... MODAL_TOKEN_SECRET=... modal deploy terminal/modal_kv/kv_app.py
Requires the Modal Secret "knightwatch-kv" with KW_KV_SECRET (created from Python, never on a command line).
"""
import hmac
import os

import modal

app = modal.App("knightwatch-kv")
kv = modal.Dict.from_name("knightwatch-kv", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")


@app.function(image=image, secrets=[modal.Secret.from_name("knightwatch-kv")], scaledown_window=900)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel

    api = FastAPI()
    secret = os.environ["KW_KV_SECRET"]

    class Op(BaseModel):
        op: str
        key: str
        value: str | None = None

    @api.post("/kv")
    def op(body: Op, x_kw_kv_secret: str = Header(default="")):
        if not hmac.compare_digest(x_kw_kv_secret.encode(), secret.encode()):
            raise HTTPException(401, "bad secret")
        if len(body.key) > 512 or (body.value and len(body.value) > 4_000_000):
            raise HTTPException(413, "key or value too large")
        if body.op == "get":
            return {"value": kv.get(body.key)}
        if body.op == "set":
            kv[body.key] = body.value
            return {"value": True}
        if body.op == "del":
            kv.pop(body.key, None)
            return {"value": True}
        if body.op == "setnx":
            return {"value": kv.put(body.key, body.value, skip_if_exists=True)}
        raise HTTPException(400, "op must be get, set, del or setnx")

    @api.get("/health")
    def health():
        return {"ok": True}

    return api
