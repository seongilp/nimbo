"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetch a JSON endpoint on an interval. Expects the `{ ok, data }` envelope.
 * Keeps the previous data visible while refreshing to avoid layout flicker.
 */
export function usePoll<T>(url: string, intervalMs = 2000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useRef(true);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!active.current) return;
      if (json.ok) {
        setData(json.data as T);
        setError(null);
      } else {
        setError(json.error ?? "Request failed");
      }
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      if (active.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    active.current = true;
    setLoading(true);
    fetchOnce();
    if (intervalMs <= 0) return () => { active.current = false; };
    const id = setInterval(fetchOnce, intervalMs);
    return () => {
      active.current = false;
      clearInterval(id);
    };
  }, [fetchOnce, intervalMs]);

  return { data, error, loading, refresh: fetchOnce };
}
