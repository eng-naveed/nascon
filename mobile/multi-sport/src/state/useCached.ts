import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheGet, cacheSet } from '@/db';
import { friendly } from '@/api/client';
import { useApp } from '@/state/app';

/** Network-first with SQLite fallback. `key` null disables. */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>, opts: { pollMs?: number } = {}) {
  const { online } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const load = useCallback(
    async (silent = false) => {
      if (!key) return;
      if (!silent) setLoading(true);
      if (!onlineRef.current) {
        const c = await cacheGet<T>(key);
        if (c) {
          setData(c.data);
          setFromCache(true);
          setUpdatedAt(c.updatedAt);
          setError(null);
        } else if (!silent) setError('You are offline and this has not been saved on this device yet.');
        setLoading(false);
        return;
      }
      try {
        const d = await fetcherRef.current();
        setData(d);
        setFromCache(false);
        setError(null);
        setUpdatedAt(new Date().toISOString());
        cacheSet(key, d);
      } catch (e) {
        const c = await cacheGet<T>(key);
        if (c) {
          setData(c.data);
          setFromCache(true);
          setUpdatedAt(c.updatedAt);
          setError(null);
        } else setError(friendly(e));
      }
      setLoading(false);
    },
    [key],
  );

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  // reload when connectivity flips
  useEffect(() => {
    load(true);
  }, [online, load]);
  useEffect(() => {
    if (!opts.pollMs || !online) return;
    const t = setInterval(() => load(true), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, online, load]);

  return { data, loading, error, fromCache, updatedAt, reload: () => load(false) };
}
