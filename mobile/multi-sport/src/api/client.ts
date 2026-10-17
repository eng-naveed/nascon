import * as SecureStore from 'expo-secure-store';
import { kvGet, kvSet } from '@/db';

export const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:8080';

let baseUrl = DEFAULT_URL;
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onNetwork: ((ok: boolean) => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
export function setNetworkHandler(fn: (ok: boolean) => void) {
  onNetwork = fn;
}
export function getBaseUrl() {
  return baseUrl;
}
export async function loadServerUrl() {
  const saved = await kvGet('server_url');
  if (saved) baseUrl = saved;
  return baseUrl;
}
export async function saveServerUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  baseUrl = u || DEFAULT_URL;
  await kvSet('server_url', baseUrl);
  return baseUrl;
}

const TOKEN_KEY = 'nascon_jwt';
export async function loadToken() {
  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}
export async function setToken(t: string | null) {
  token = t;
  try {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  network: boolean;
  constructor(status: number, code: string, message: string, details?: unknown, network = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.network = network;
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token && opts.auth !== false ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    onNetwork?.(false);
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server.', undefined, true);
  }
  clearTimeout(timer);
  onNetwork?.(true);
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 401 && path !== '/api/v1/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? '', e?.details);
  }
  return json as T;
}

export async function ping(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    await fetch(baseUrl + '/health', { signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const FRIENDLY: Record<string, string> = {
  NETWORK: 'You appear to be offline or the server is not reachable.',
  UNAUTHENTICATED: 'Your email or password is not correct, or your session has expired.',
  FORBIDDEN: 'Your account is not allowed to do this.',
  MATCH_NOT_IN_PROGRESS: 'The match is not in progress, so scores cannot be added.',
  MATCH_NOT_FOUND: 'That match could not be found.',
  ILLEGAL_TRANSITION: 'That is not possible in the match\'s current state (for example it already started or ended).',
  TIE_NOT_ALLOWED: 'The score is level and a draw is not allowed in this sport. Declare a tie-break winner first.',
  INVALID_COMPENSATION: 'That event cannot be undone (it was already undone, or it is not a score event of this match).',
  EVENT_NOT_FOUND: 'The event to undo could not be found.',
  UNKNOWN_EVENT_TYPE: 'That scoring event does not exist for this sport.',
  INNINGS_COMPLETE: 'This team\'s innings is already complete.',
  SERIES_ALREADY_DECIDED: 'The series is already decided.',
  DUPLICATE_EVENT_ID: 'This event was already recorded with different details.',
  INVALID_BASE_VERSION: 'The device data was out of date, so the server kept its own version.',
  NOT_IN_SQUAD: 'The player is no longer in that squad.',
  SQUAD_FULL: 'The destination squad is already full.',
  TRANSFER_WINDOW_CLOSED: 'The transfer window is closed for that date.',
  PLAYER_ON_LOAN: 'The player is currently on loan and cannot be moved.',
  MIN_POSITION_VIOLATION: 'The squad would not have enough players in that position.',
  CROSS_TENANT_TRANSFER: 'Players cannot be moved between different organisations.',
  PLAYER_NOT_FOUND: 'That player could not be found.',
  SQUAD_NOT_FOUND: 'That squad could not be found.',
  LEAGUE_NOT_FOUND: 'That league could not be found.',
  VALIDATION_ERROR: 'Some details are missing or not valid. Please check and try again.',
  OUT_OF_STOCK: 'Sorry, an item in your cart just sold out.',
  PAYMENT_DECLINED: 'Your payment was declined. No money was taken. Try a different payment token.',
  PAYMENT_CAPTURE_FAILED: 'The payment could not be completed. No money was taken.',
  INVALID_DISCOUNT_CODE: 'That discount code is not valid.',
  VARIANT_NOT_FOUND: 'One of the items is no longer available.',
  DUPLICATE_ORDER_ID: 'This order was already submitted.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  PAYLOAD_TOO_LARGE: 'That request is too large.',
};

export function friendlyCode(code: string | null | undefined): string {
  if (!code) return '';
  return FRIENDLY[code] ?? 'The server could not accept this change.';
}

export function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (FRIENDLY[e.code]) return FRIENDLY[e.code];
    if (e.status >= 500) return 'The server had a problem. Please try again in a moment.';
    if (e.status === 404) return 'That item could not be found.';
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}
