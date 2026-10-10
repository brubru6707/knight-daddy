// Key-value store for the public site. Backends, first configured wins:
//   upstash: UPSTASH_REDIS_REST_URL/TOKEN (or Vercel's KV_REST_API_URL/TOKEN)
//   modal:   KW_KV_URL + KW_KV_SECRET (terminal/modal_kv/kv_app.py, a modal.Dict behind a tiny endpoint)
//   memory:  local tests only
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const kvUrl = process.env.KW_KV_URL, kvSecret = process.env.KW_KV_SECRET;
export const backend = url && token ? "upstash" : kvUrl && kvSecret ? "modal" : "memory";

async function modalKv(op, key, value) {
  const r = await fetch(kvUrl, { method: "POST", body: JSON.stringify({ op, key, value }),
    headers: { "content-type": "application/json", "x-kw-kv-secret": kvSecret } });
  if (!r.ok) throw new Error(`store ${op} failed: HTTP ${r.status}`);
  return (await r.json()).value;
}
const redis = backend === "upstash" ? new Redis({ url, token, automaticDeserialization: false }) : null;
const mem = globalThis.__kwMem || (globalThis.__kwMem = new Map()); // local dev only; not shared across instances

export async function getJSON(key) {
  const raw = redis ? await redis.get(key) : backend === "modal" ? await modalKv("get", key) : mem.get(key);
  return raw === null || raw === undefined ? null : JSON.parse(raw);
}

export async function setJSON(key, value, { ex } = {}) {
  const raw = JSON.stringify(value);
  if (redis) return redis.set(key, raw, ex ? { ex } : undefined);
  if (backend === "modal") return modalKv("set", key, raw); // modal.Dict: no per-key TTL (entries idle 7 days expire)
  mem.set(key, raw);
}

export async function del(key) {
  if (redis) return redis.del(key);
  if (backend === "modal") return modalKv("del", key);
  mem.delete(key);
}

// Set only if absent (used as the one-job-at-a-time lock). Returns true if this call took the lock.
export async function setIfAbsent(key, value, ex) {
  const raw = JSON.stringify(value);
  if (redis) return (await redis.set(key, raw, { nx: true, ex })) === "OK";
  if (backend === "modal") return modalKv("setnx", key, raw);
  if (mem.has(key)) return false;
  mem.set(key, raw);
  return true;
}
