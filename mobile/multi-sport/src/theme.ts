export const C = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  text: '#111827',
  sub: '#4B5563',
  border: '#D1D5DB',
  ok: '#166534',
  okBg: '#DCFCE7',
  warn: '#92400E',
  warnBg: '#FEF3C7',
  bad: '#991B1B',
  badBg: '#FEE2E2',
  info: '#1E3A8A',
  infoBg: '#DBEAFE',
};
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const R = 12;

export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111827' : '#FFFFFF';
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
