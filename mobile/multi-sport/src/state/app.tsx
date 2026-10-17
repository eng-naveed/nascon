import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { api, ApiError, friendlyCode, getBaseUrl, loadServerUrl, loadToken, ping, setNetworkHandler, setToken, setUnauthorizedHandler } from '@/api/client';
import type { CartItem, Receipt, Session } from '@/api/types';
import {
  cacheClear, kvDel, kvGet, kvSet, queueAdd, queueList, queueRemove, resultsClear, resultsList, resultsSave,
  type QueuedAction, type QueueRow, type ResultRow,
} from '@/db';
import { isoNow, safeColor, uid } from '@/theme';

type Ctx = {
  ready: boolean;
  session: Session | null;
  primary: string;
  online: boolean;
  syncing: boolean;
  queue: QueueRow[];
  results: ResultRow[];
  lastSyncMsg: string | null;
  leagueId: string | null;
  setLeagueId: (id: string) => void;
  cart: CartItem[];
  addToCart: (i: Omit<CartItem, 'quantity'>) => void;
  setQty: (variantId: string, q: number) => void;
  clearCart: () => void;
  receipt: Receipt | null;
  setReceipt: (r: Receipt | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  sync: () => Promise<void>;
  clearResults: () => Promise<void>;
  submitAction: (
    type: QueuedAction['type'],
    payload: Record<string, unknown>,
    baseVersion: number,
    summary: string,
  ) => Promise<'sent' | 'queued'>;
  serverUrl: string;
  refreshServerUrl: () => void;
};

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [netOk, setNetOk] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [lastSyncMsg, setLastSyncMsg] = useState<string | null>(null);
  const [leagueId, setLeagueIdState] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceiptState] = useState<Receipt | null>(null);
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const deviceId = useRef<string>('');
  const syncingRef = useRef(false);

  // NetInfo can wrongly report "disconnected" (simulators, captive Wi-Fi), so server reachability decides.
  const online = reachable;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const refreshQueue = useCallback(async () => {
    setQueue(await queueList());
    setResults(await resultsList());
  }, []);

  // boot
  useEffect(() => {
    (async () => {
      setServerUrl(await loadServerUrl());
      await loadToken();
      let id = await kvGet('device_id');
      if (!id) {
        id = uid('dev-');
        await kvSet('device_id', id);
      }
      deviceId.current = id;
      const s = await kvGet('session');
      const t = await loadToken();
      if (s && t) {
        try {
          setSession(JSON.parse(s));
        } catch {}
      }
      const lg = await kvGet('league_id');
      if (lg) setLeagueIdState(lg);
      const r = await kvGet('receipt');
      if (r) {
        try {
          setReceiptState(JSON.parse(r));
        } catch {}
      }
      await refreshQueue();
      setReady(true);
    })();
  }, [refreshQueue]);

  // connectivity
  useEffect(() => {
    setNetworkHandler((ok) => setReachable(ok));
    const unsub = NetInfo.addEventListener((st) => {
      setNetOk(st.isConnected !== false);
      ping().then(setReachable);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      setReachable(await ping());
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [netOk, serverUrl]);

  const logout = useCallback(async () => {
    await setToken(null);
    await kvDel('session');
    await cacheClear();
    setSession(null);
    setLeagueIdState(null);
    setCart([]);
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // expired token: ask user to sign in again (pending queue is kept)
      logout();
    });
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<any>('/api/v1/auth/login', { body: { email: email.trim(), password }, auth: false });
    await setToken(r.token);
    const s: Session = { user: r.user, tenant: r.tenant };
    await kvSet('session', JSON.stringify(s));
    setSession(s);
    if (r.user.league_id) {
      setLeagueIdState(r.user.league_id);
      await kvSet('league_id', r.user.league_id);
    }
  }, []);

  const setLeagueId = useCallback((id: string) => {
    setLeagueIdState(id);
    kvSet('league_id', id).catch(() => {});
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    const items = await queueList();
    if (items.length === 0) {
      setLastSyncMsg('Nothing to sync. Everything is up to date.');
      return;
    }
    if (!sessionRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const body = {
        device_id: deviceId.current,
        actions: items.map((i) => ({
          action_id: i.action_id,
          type: i.type,
          queued_at: i.queued_at,
          base_version: i.base_version,
          payload: i.payload,
        })),
      };
      const res = await api<any>('/api/v1/offline-sync', { body, timeoutMs: 20000 });
      const now = isoNow();
      const rows: ResultRow[] = [];
      for (const it of items) {
        const r = (res.results ?? []).find((x: any) => x.action_id === it.action_id);
        if (!r) continue;
        rows.push({
          action_id: it.action_id,
          type: it.type,
          summary: it.summary,
          status: r.status,
          resolution: r.resolution ?? null,
          error_code: r.error_code ?? null,
          at: now,
        });
      }
      await resultsSave(rows);
      await queueRemove(rows.map((r) => r.action_id));
      const sm = res.summary ?? {};
      setLastSyncMsg(
        `Sync finished: ${sm.applied ?? 0} applied, ${sm.rejected ?? 0} rejected, ${sm.duplicate ?? 0} already done.`,
      );
    } catch (e) {
      if (e instanceof ApiError && !e.network) setLastSyncMsg('The server could not process the sync. Your actions are still saved and will be retried.');
      else setLastSyncMsg('Could not reach the server. Your actions are saved and will sync when you are back online.');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshQueue();
    }
  }, [refreshQueue]);

  // auto sync when online and queue non-empty
  useEffect(() => {
    if (online && session && queue.length > 0 && !syncing) {
      const t = setTimeout(() => sync(), 800);
      return () => clearTimeout(t);
    }
  }, [online, session, queue.length, syncing, sync]);

  const submitAction = useCallback(
    async (type: QueuedAction['type'], payload: Record<string, unknown>, baseVersion: number, summary: string) => {
      const enqueue = async () => {
        await queueAdd(
          { action_id: uid('act-'), type, queued_at: isoNow(), base_version: baseVersion, payload },
          summary,
        );
        await refreshQueue();
        return 'queued' as const;
      };
      if (!onlineRef.current) return enqueue();
      try {
        await api(type === 'score_event' ? '/api/v1/events' : '/api/v1/roster/transfer', { body: payload });
        return 'sent' as const;
      } catch (e) {
        if (e instanceof ApiError && e.network) return enqueue();
        throw e;
      }
    },
    [refreshQueue],
  );

  const addToCart = useCallback((i: Omit<CartItem, 'quantity'>) => {
    setCart((c) => {
      const ex = c.find((x) => x.variant_id === i.variant_id);
      if (ex) return c.map((x) => (x.variant_id === i.variant_id ? { ...x, quantity: Math.min(10, x.quantity + 1) } : x));
      return [...c, { ...i, quantity: 1 }];
    });
  }, []);
  const setQty = useCallback((id: string, q: number) => {
    setCart((c) => (q <= 0 ? c.filter((x) => x.variant_id !== id) : c.map((x) => (x.variant_id === id ? { ...x, quantity: Math.min(10, q) } : x))));
  }, []);
  const clearCart = useCallback(() => setCart([]), []);
  const setReceipt = useCallback((r: Receipt | null) => {
    setReceiptState(r);
    if (r) kvSet('receipt', JSON.stringify({ ...r, pdf_base64: r.pdf_base64 })).catch(() => {});
  }, []);
  const clearResults = useCallback(async () => {
    await resultsClear();
    await refreshQueue();
  }, [refreshQueue]);

  const primary = safeColor(session?.tenant?.primary_color);

  const value = useMemo<Ctx>(
    () => ({
      ready, session, primary, online, syncing, queue, results, lastSyncMsg, leagueId, setLeagueId, cart, addToCart,
      setQty, clearCart, receipt, setReceipt, login, logout, sync, clearResults, submitAction, serverUrl,
      refreshServerUrl: () => setServerUrl(getBaseUrl()),
    }),
    [ready, session, primary, online, syncing, queue, results, lastSyncMsg, leagueId, setLeagueId, cart, addToCart, setQty, clearCart, receipt, setReceipt, login, logout, sync, clearResults, submitAction, serverUrl],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
void friendlyCode;
