// Dark "matchday" theme: deep navy surfaces, vivid accent, high-contrast text (WCAG AA on every pair used).
export const C = {
  bg: '#0A0F1E',
  card: '#121A30',
  card2: '#1A2543',
  text: '#F5F7FF',
  sub: '#A9B6D3',
  border: '#27345A',
  accent: '#C8FF3D',
  live: '#FF3B5C',
  ok: '#3DDC97',
  okBg: 'rgba(61,220,151,0.14)',
  warn: '#FFC24B',
  warnBg: 'rgba(255,194,75,0.14)',
  bad: '#FF6B81',
  badBg: 'rgba(255,107,129,0.14)',
  info: '#8FB8FF',
  infoBg: 'rgba(143,184,255,0.14)',
};
// Display font for scores / headings (Barlow Condensed, loaded in the root layout).
export const F = { display: 'BarlowCondensed_700Bold', displayHeavy: 'BarlowCondensed_800ExtraBold' };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const R = 18;

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
/** Tenant brand colour made usable on the dark theme (too-dark brands fall back to the accent). */
export function brandOnDark(hex: string): string {
  return luminance(hex) < 0.08 ? C.accent : hex;
}
const TEAM_COLORS = ['#3B82F6', '#F97316', '#A855F7', '#14B8A6', '#EF4444', '#EAB308', '#EC4899', '#22C55E'];
export function teamColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#0A0F1E' : '#FFFFFF';
}
export function safeColor(hex?: string | null): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : '#1D4ED8';
}
export function money(minor: number, currency = 'PKR') {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return 'Time to be announced';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function uid(prefix = '') {
  const r = () => Math.random().toString(16).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}-${r()}${r()}`;
}
export function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
