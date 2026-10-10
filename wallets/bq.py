"""Budget-guarded BigQuery runner for the wallets experiment.

Every query is dry-run first. It runs only if the dry-run estimate is at most PER_QUERY_GB and the running
total (ledger) plus the estimate stays at most TOTAL_GB; otherwise it raises NeedsApproval and nothing is billed.
Each real run sets maximum_bytes_billed, so BigQuery itself refuses to scan more than the approved amount.
Ledger: $WALLETS_DATA/bq_ledger.jsonl (one line per dry run and per real run).

Usage: from bq import run; df = run("name", sql)
Auth: Application Default Credentials (gcloud auth application-default login); project from $WALLETS_GCP_PROJECT.
"""
import json, os, time
from pathlib import Path

DATA = Path(os.path.expanduser(os.getenv("WALLETS_DATA", "~/scratch/poc1/wallets")))
LEDGER = DATA / "bq_ledger.jsonl"
FAILURES = Path(__file__).with_name("FAILURES.md")
PER_QUERY_GB, TOTAL_GB = 100, 500
GB = 1024 ** 3


class NeedsApproval(RuntimeError):
    pass


def _client():
    from google.cloud import bigquery
    project = os.getenv("WALLETS_GCP_PROJECT")
    if not project:
        raise RuntimeError("Set WALLETS_GCP_PROJECT to the Google Cloud project ID.")
    return bigquery, bigquery.Client(project=project)


def billed_so_far():
    if not LEDGER.exists():
        return 0
    return sum(r.get("bytes_billed", 0) for r in map(json.loads, LEDGER.read_text().splitlines()) if r["kind"] == "run")


def _log(rec):
    DATA.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), **rec}) + "\n")


def log_failure(what, err):
    """Append a key or data failure to FAILURES.md (no secret values, ever)."""
    new = not FAILURES.exists()
    with FAILURES.open("a") as f:
        if new:
            f.write("# Key and data failures\n\n")
        f.write(f"- {time.strftime('%Y-%m-%d %H:%M')} {what}: {type(err).__name__}: {str(err)[:300]}\n")


def estimate(name, sql):
    bigquery, client = _client()
    job = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
    est = job.total_bytes_processed or 0
    _log({"kind": "dry_run", "name": name, "bytes_est": est})
    return est


def run(name, sql, to_parquet=None):
    """Dry-run, check the budget, then run with maximum_bytes_billed. Returns a DataFrame."""
    try:
        est = estimate(name, sql)
    except Exception as e:
        log_failure(f"dry run '{name}'", e)
        raise
    total = billed_so_far()
    if est > PER_QUERY_GB * GB:
        raise NeedsApproval(f"'{name}' would scan {est / GB:.1f} GB (> {PER_QUERY_GB} GB per query). Ask before running.")
    if total + est > TOTAL_GB * GB:
        raise NeedsApproval(f"'{name}' ({est / GB:.1f} GB) would take the total to {(total + est) / GB:.1f} GB (> {TOTAL_GB} GB).")
    bigquery, client = _client()
    cap = max(int(est * 1.1), 10 * 1024 ** 2)  # 10% headroom, at least 10 MB (BigQuery's minimum billing unit)
    cfg = bigquery.QueryJobConfig(maximum_bytes_billed=cap)
    t0 = time.time()
    try:
        job = client.query(sql, job_config=cfg)
        df = job.result().to_dataframe()
    except Exception as e:
        log_failure(f"query '{name}'", e)
        raise
    _log({"kind": "run", "name": name, "bytes_est": est, "bytes_billed": job.total_bytes_billed or 0,
          "rows": len(df), "seconds": round(time.time() - t0, 1), "job_id": job.job_id})
    if to_parquet:
        df.to_parquet(DATA / to_parquet)
    return df


if __name__ == "__main__":
    print(f"billed so far: {billed_so_far() / GB:.2f} GB of {TOTAL_GB} GB budget")
