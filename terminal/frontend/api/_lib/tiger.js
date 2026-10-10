// Headline history in Tiger Data (TimescaleDB). Snapshots in the key-value store keep only the latest response; every
// live headline the site has served is also written here, so sentiment can be charted over time.
// Secret comes only from the env var TIGER_DB_URL. Without it the site works as before and /api/history says n/a.
import pg from "pg";

const url = process.env.TIGER_DB_URL;
export const tigerOn = !!url;

let pool = null, ready = null;
function db() {
  if (!pool) {
    const u = new URL(url);
    u.search = ""; // TLS is set below; sslmode params in the URL change meaning across pg versions
    pool = new pg.Pool({ connectionString: u.toString(), ssl: true, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000 });
  }
  return pool;
}

function ensure() {
  ready ||= db().query(`
    create table if not exists kd_headlines (
      published_at timestamptz not null, ticker text not null, model text not null, url text not null,
      title text not null, source text, label text not null, p_bull real, p_bear real, p_neut real,
      first_seen timestamptz not null default now(),
      primary key (ticker, model, url, published_at));
    select create_hypertable('kd_headlines', by_range('published_at'), if_not_exists => true);
  `).catch((e) => { ready = null; throw e; });
  return ready;
}

// Insert the labeled live headlines from one /api/headlines response. Existing rows are left alone.
export async function saveHeadlines(body) {
  const rows = (body?.headlines || []).filter((h) => h.time && h.title && h.label);
  if (!tigerOn || body?.source !== "live" || !rows.length) return 0;
  await ensure();
  const col = (f) => rows.map(f);
  const r = await db().query(`
    insert into kd_headlines (published_at, ticker, model, url, title, source, label, p_bull, p_bear, p_neut)
    select * from unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                         $8::real[], $9::real[], $10::real[])
    on conflict do nothing`,
    [col((h) => h.time), col(() => String(body.ticker).toUpperCase()), col(() => body.model || "general"),
     col((h) => h.url || h.title), col((h) => h.title), col((h) => h.source || null), col((h) => h.label),
     col((h) => h.p_bull ?? null), col((h) => h.p_bear ?? null), col((h) => h.p_neut ?? null)]);
  return r.rowCount;
}

// Daily Bullish/Bearish/Neutral counts for a ticker from the stored headlines.
export async function history(ticker, days = 30, model = "general") {
  await ensure();
  const q = await db().query(`
    select to_char(time_bucket('1 day', published_at) at time zone 'UTC', 'YYYY-MM-DD') as day, label, count(*)::int as n
    from kd_headlines where ticker = $1 and model = $2 and published_at > now() - make_interval(days => $3)
    group by 1, 2 order by 1`, [ticker, model, days]);
  const t = await db().query(`select count(*)::int as n, min(published_at) as first, max(published_at) as last
    from kd_headlines where ticker = $1 and model = $2`, [ticker, model]);
  const byDay = new Map();
  for (const r of q.rows) {
    const d = r.day;
    if (!byDay.has(d)) byDay.set(d, { day: d, Bullish: 0, Bearish: 0, Neutral: 0 });
    byDay.get(d)[r.label] = r.n;
  }
  return { ticker, model, store: "tiger", window_days: days, days: [...byDay.values()],
           total_stored: t.rows[0].n, first: t.rows[0].first, last: t.rows[0].last };
}
