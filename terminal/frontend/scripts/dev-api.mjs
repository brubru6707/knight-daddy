// Local stand-in for Vercel: serves dist/ and routes /api/* to api/kw.js with Vercel-style req/res helpers.
// Uses the in-memory store unless UPSTASH/KV env vars are set. Usage: node scripts/dev-api.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/kw.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 3001);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/")) {
    let raw = "";
    for await (const c of req) raw += c;
    req.query = Object.fromEntries(u.searchParams);
    req.query.path = u.pathname.replace(/^\/api\//, "");      // what the vercel.json rewrite does
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
    return handler(req, res);
  }
  let f = path.join(root, "dist", u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(path.join(root, "dist")) || !fs.existsSync(f)) f = path.join(root, "dist", "index.html");
  res.setHeader("content-type", types[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`dev-api on http://127.0.0.1:${port} (store: ${process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "memory"})`));
