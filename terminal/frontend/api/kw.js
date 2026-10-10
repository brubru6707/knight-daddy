// KNIGHTWATCH public API (one Vercel function; vercel.json rewrites /api/* here).
//
// Reads are a mirror: the Oscar worker fetches every URL the frontend uses from the real backend and pushes the
// responses (POST /api/snapshot, secret required); GETs replay them. Training is a job queue: the browser creates a
// job (train password), the worker claims it, runs it on Oscar, and pushes progress. One job at a time.
// Secrets come only from env vars: KW_PUSH_SECRET (worker), KW_TRAIN_PASSWORD (Train button), ELEVENLABS_API_KEY
// (read-aloud), TIGER_DB_URL (headline history in Tiger Data, see _lib/tiger.js).
import crypto from "node:crypto";
import { backend, getJSON, setJSON, del, setIfAbsent } from "./_lib/store.js";
import { history, saveHeadlines, tigerOn } from "./_lib/tiger.js";

const STALE_MS = 10 * 60 * 1000;      // a job with no update for 10 min is considered dead
const WORKER_ONLINE_MS = 2 * 60 * 1000; // worker must have polled within 2 min to accept new jobs
const now = () => Date.now();

function same(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// "headlines?ticker=nvda&source=live&refresh=true" -> "headlines?source=live&ticker=NVDA"
export function canonical(path, query = {}) {
  const [p, qs] = String(path).replace(/^\/+|\/+$/g, "").split("?");
  const params = new URLSearchParams(qs || "");
  for (const [k, v] of Object.entries(query)) if (k !== "path") params.set(k, Array.isArray(v) ? v[0] : v);
  params.delete("refresh");
  if (params.has("ticker")) params.set("ticker", params.get("ticker").toUpperCase());
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.length ? `${p}?${new URLSearchParams(sorted).toString()}` : p;
}

function routeOf(req) {
  let p = req.query?.path;
  if (Array.isArray(p)) p = p.join("/");
  if (!p) p = new URL(req.url, "http://x").pathname.replace(/^\/api\/?/, "");
  return String(p).replace(/^\/+|\/+$/g, "");
}

const send = (res, code, body) => res.status(code).json(body);
const jobKey = (id) => `kw:job:${id}`;

async function activeJob() {
  const id = await getJSON("kw:job:active");
  if (!id) return null;
  const job = await getJSON(jobKey(id));
  if (!job) { await del("kw:job:active"); return null; }
  if (["done", "failed"].includes(job.status) || now() - (job.updated_at || job.created_at) > STALE_MS) {
    if (!["done", "failed"].includes(job.status)) {   // dead worker: release the lock
      job.status = "failed"; job.error = "no progress for 10 minutes (Oscar worker stopped?)";
      await setJSON(jobKey(id), job, { ex: 86400 });
    }
    await del("kw:job:active");
    return null;
  }
  return job;
}

// Job progress in the same shape as the backend's /api/specialist/status, so the frontend code is unchanged.
function statusFromJob(job, workerSeen) {
  const p = job.progress || {};
  if (job.status === "queued") {
    const ago = workerSeen ? Math.round((now() - workerSeen) / 1000) : null;
    return { ticker: job.ticker, quick: !!job.quick, phase: "queued", running: true, step: 0, total_steps: null, losses: [],
             note: `waiting for the Oscar worker${ago !== null ? ` (last seen ${ago}s ago)` : ""}` };
  }
  if (job.status === "failed") return { ...p, ticker: job.ticker, phase: "failed", running: false, error: job.error || p.error };
  return { ...p, ticker: job.ticker, running: job.status === "running" && !["done", "failed"].includes(p.phase) };
}

// Copy a live headlines snapshot into Tiger once per pushed version. Never fails the request.
async function syncToTiger(key, snap) {
  if (!tigerOn || !key.startsWith("headlines?") || snap.body?.source !== "live") return;
  const mark = `kw:tiger:${key}`, version = snap.pushed_at || "unversioned";
  try {
    if ((await getJSON(mark)) === version || (await getJSON("kw:tiger:down"))) return;
    await saveHeadlines(snap.body);
    await setJSON(mark, version, { ex: 7 * 86400 });
  } catch (e) {
    console.error("tiger sync failed:", e.message);
    await setJSON("kw:tiger:down", true, { ex: 300 }).catch(() => {}); // back off 5 min so reads stay fast
  }
}

// ElevenLabs text-to-speech for a pushed briefing. Cached per briefing id; capped per day to protect the quota.
const TTS_DAILY_CAP = 60;
async function briefingAudio(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return send(res, 503, { detail: "Read-aloud is not available on the public site." });
  const id = String(req.query.id || "");
  const meta = await getJSON("kw:meta");
  const tickers = req.query.ticker ? [String(req.query.ticker).toUpperCase()] : meta?.tickers || [];
  let b = null;
  for (const t of tickers) {
    const snap = await getJSON(`kw:get:${canonical("briefing", { ticker: t })}`);
    if (snap?.body?.status === "ok" && (!id || snap.body.id === id)) { b = snap.body; break; }
  }
  if (!b) return send(res, 404, { detail: "No briefing with that id on the public site." });
  const cacheKey = `kw:audio:${b.id}`;
  let mp3 = await getJSON(cacheKey);
  if (!mp3) {
    const day = `kw:tts:${new Date().toISOString().slice(0, 10)}`;
    const used = (await getJSON(day)) || 0;
    if (used >= TTS_DAILY_CAP) return send(res, 429, { detail: "Read-aloud limit for today reached." });
    await setJSON(day, used + 1, { ex: 2 * 86400 });
    const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // premade "George"
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: String(b.text).slice(0, 1500), model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
    });
    if (!r.ok) return send(res, 502, { detail: `ElevenLabs HTTP ${r.status}` });
    mp3 = Buffer.from(await r.arrayBuffer()).toString("base64");
    await setJSON(cacheKey, mp3, { ex: 2 * 86400 }).catch(() => {}); // cache is best effort
  }
  res.setHeader("content-type", "audio/mpeg");
  return res.status(200).send(Buffer.from(mp3, "base64"));
}

async function mirror(res, key, extra) {
  const snap = await getJSON(`kw:get:${key}`);
  if (snap) await syncToTiger(key, snap);
  if (!snap) {
    const meta = await getJSON("kw:meta");
    return send(res, 404, { detail: `Not available on the public site yet (${key}). Tracked tickers: ${(meta?.tickers || []).join(", ") || "none pushed yet"}.` });
  }
  return send(res, snap.status || 200, extra ? { ...snap.body, ...extra(snap) } : snap.body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.VERCEL && backend === "memory") // per-instance memory would silently lose data on Vercel
    return send(res, 503, { detail: "Database not connected: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on the Vercel project, then redeploy." });
  const route = routeOf(req);
  const method = req.method;
  const secretOk = same(req.headers["x-kw-secret"], process.env.KW_PUSH_SECRET);
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    // ---------- worker endpoints (shared secret) ----------
    if (route === "snapshot" && method === "POST") {
      if (!secretOk) return send(res, 401, { detail: "bad or missing x-kw-secret" });
      const items = Array.isArray(body.items) ? body.items : [];
      for (const it of items) {
        const key = canonical(it.path), snap = { status: it.status || 200, body: it.body, pushed_at: body.pushed_at };
        await setJSON(`kw:get:${key}`, snap);
        await syncToTiger(key, snap);
      }
      if (body.tickers) await setJSON("kw:meta", { tickers: body.tickers, pushed_at: body.pushed_at });
      return send(res, 200, { stored: items.length, store: backend });
    }
    if (route.startsWith("jobs/")) {
      if (!secretOk) return send(res, 401, { detail: "bad or missing x-kw-secret" });
      await setJSON("kw:worker:last_seen", now(), { ex: 3600 });
      if (route === "jobs/heartbeat" && method === "POST") return send(res, 200, { ok: true }); // worker alive, GPU busy
      const job = await activeJob();
      if (route === "jobs/claim" && method === "POST") {
        if (!job || job.status !== "queued") return send(res, 200, { job: null });
        Object.assign(job, { status: "running", claimed_at: now(), updated_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        return send(res, 200, { job });
      }
      if (!job || job.id !== body.id) return send(res, 409, { detail: "no such active job" });
      if (route === "jobs/progress" && method === "POST") {
        Object.assign(job, { progress: body.progress || {}, updated_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        return send(res, 200, { ok: true });
      }
      if (route === "jobs/finish" && method === "POST") {
        Object.assign(job, { status: body.status === "done" ? "done" : "failed", error: body.error || null,
                             progress: body.progress || job.progress, updated_at: now(), finished_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        await del("kw:job:active");
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { detail: "unknown jobs route" });
    }

    // ---------- public endpoints ----------
    if (route === "specialist/train" && method === "POST") {
      if (!process.env.KW_TRAIN_PASSWORD) return send(res, 503, { detail: "Training is disabled on this site (no KW_TRAIN_PASSWORD set)." });
      if (!same(req.headers["x-train-password"], process.env.KW_TRAIN_PASSWORD)) return send(res, 401, { detail: "Wrong train password." });
      const ticker = String(body.ticker || "").toUpperCase();
      const info = (await getJSON("kw:get:specialist/info"))?.body;
      if (!info?.supported?.includes(ticker)) return send(res, 400, { detail: `Specialists are available for ${(info?.supported || []).join(", ") || "no tickers yet"}.` });
      const seen = await getJSON("kw:worker:last_seen");
      if (!seen || now() - seen > WORKER_ONLINE_MS) return send(res, 503, { detail: "The Oscar GPU worker is offline right now, so training is unavailable." });
      const busy = await activeJob();
      if (busy) return send(res, 409, { detail: `GPU busy with a ${busy.ticker} run; try again when it finishes.` });
      const job = { id: crypto.randomUUID(), ticker, quick: !!body.quick, status: "queued", created_at: now(), updated_at: now(), progress: {} };
      if (!(await setIfAbsent("kw:job:active", job.id, 3600))) return send(res, 409, { detail: "Another training job just started." });
      await setJSON(jobKey(job.id), job, { ex: 86400 });
      await setJSON(`kw:job:last:${ticker}`, job.id, { ex: 86400 });
      return send(res, 200, { ticker, job: job.id });
    }
    if (route === "specialist/status" && method === "GET") {
      const ticker = String(req.query.ticker || "").toUpperCase();
      const id = await getJSON(`kw:job:last:${ticker}`);
      const job = id ? await getJSON(jobKey(id)) : null;
      const snap = await getJSON(`kw:get:${canonical("specialist/status", { ticker })}`);
      const snapTime = snap?.pushed_at ? Date.parse(snap.pushed_at) : 0;
      if (job && (job.status === "queued" || job.status === "running" || (job.updated_at || 0) > snapTime)) {
        await activeJob(); // releases a stale lock if needed
        const fresh = await getJSON(jobKey(id));
        return send(res, 200, statusFromJob(fresh, await getJSON("kw:worker:last_seen")));
      }
      return mirror(res, canonical("specialist/status", { ticker }));
    }
    if (route === "specialist/info" && method === "GET") {
      const job = await activeJob();
      return mirror(res, "specialist/info", () => ({ busy: !!job, busy_with: job ? "train" : null }));
    }
    if (route === "specialist/stream") return send(res, 410, { detail: "Use /api/specialist/status (polling) on the public site." });
    if (route === "briefing/audio" && method === "GET") return briefingAudio(req, res);
    if (route === "history" && method === "GET") {
      if (!tigerOn) return send(res, 503, { detail: "History store not connected (no TIGER_DB_URL)." });
      const ticker = String(req.query.ticker || "").toUpperCase();
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
      return send(res, 200, await history(ticker, days, req.query.model === "specialist" ? "specialist" : "general"));
    }
    if (route === "classify") return send(res, 503, { detail: "The model runs on Oscar; live classification is not available on the public site." });
    if (route === "health" && method === "GET") {
      const meta = await getJSON("kw:meta");
      const seen = await getJSON("kw:worker:last_seen");
      return mirror(res, "health", () => ({
        mode: "vercel", store: backend, snapshot_pushed_at: meta?.pushed_at || null, tracked_tickers: meta?.tickers || [],
        worker_online: !!seen && now() - seen < WORKER_ONLINE_MS, train_password_required: true,
        keys: { FINNHUB_API_KEY: false, GEMINI_API_KEY: false, ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY },
        history_store: tigerOn ? "tiger" : null,
      }));
    }
    if (method === "GET") return mirror(res, canonical(route, req.query));
    return send(res, 405, { detail: "method not allowed" });
  } catch (e) {
    return send(res, 500, { detail: `server error: ${e.message}` });
  }
}
