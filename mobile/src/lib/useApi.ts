import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export interface ApiState<T> { data: T | null; err: string | null; status: number | null; loading: boolean }

interface Result<T> { key: string | null; data: T | null; err: string | null; status: number | null }

// Fetch `path` whenever it changes (null = skip). `nonce` forces a reload.
// Loading is derived (result key != request key), so the effect only sets state from the fetch callbacks.
export function useApi<T>(path: string | null, nonce = 0): ApiState<T> {
  const key = path ? `${path}#${nonce}` : null;
  const [res, setRes] = useState<Result<T>>({ key: null, data: null, err: null, status: null });
  useEffect(() => {
    if (!path || !key) return;
    let live = true;
    api<T>(path)
      .then((data) => live && setRes({ key, data, err: null, status: 200 }))
      .catch((e: unknown) => {
        if (!live) return;
        const status = e instanceof ApiError ? e.status : null;
        setRes({ key, data: null, err: e instanceof Error ? e.message : String(e), status });
      });
    return () => { live = false; };
  }, [path, key]);
  if (!key) return { data: null, err: null, status: null, loading: false };
  if (res.key !== key) return { data: null, err: null, status: null, loading: true };
  return { data: res.data, err: res.err, status: res.status, loading: false };
}
