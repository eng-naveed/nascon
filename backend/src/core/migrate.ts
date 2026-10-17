import { pool } from './db';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (tenant_id text PRIMARY KEY, name text NOT NULL, primary_color text NOT NULL, logo_url text);
CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL, password_hash text NOT NULL,
  tenant_id text, league_id text, club_id text, player_id text);
CREATE TABLE IF NOT EXISTS rbac_entities (kind text NOT NULL, id text NOT NULL, tenant_id text NOT NULL, club_id text, PRIMARY KEY (kind, id));
CREATE TABLE IF NOT EXISTS clubs (club_id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, venue jsonb, social jsonb, staff jsonb, history jsonb);
CREATE TABLE IF NOT EXISTS sports (sport_id text PRIMARY KEY, config jsonb NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS leagues (league_id text PRIMARY KEY, tenant_id text, name text, sport_id text NOT NULL, config jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS matches (
  match_id text PRIMARY KEY, sport_id text NOT NULL, league_id text, home_team_id text NOT NULL, away_team_id text NOT NULL,
  scheduled_at text, showcase jsonb);
CREATE INDEX IF NOT EXISTS matches_league_idx ON matches(league_id);
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY, event_id text UNIQUE NOT NULL, match_id text NOT NULL, seq int NOT NULL, type text NOT NULL,
  payload jsonb NOT NULL, signature text NOT NULL, body_hash text NOT NULL, response jsonb NOT NULL, UNIQUE (match_id, seq));
CREATE TABLE IF NOT EXISTS products (product_id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, description text);
CREATE TABLE IF NOT EXISTS variants (
  variant_id text PRIMARY KEY, product_id text NOT NULL, label text NOT NULL, price_minor integer NOT NULL, currency text NOT NULL DEFAULT 'PKR',
  stock integer NOT NULL CHECK (stock >= 0), reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0));
CREATE TABLE IF NOT EXISTS orders (order_id text PRIMARY KEY, body_hash text NOT NULL, status text NOT NULL, response jsonb, customer_id text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS queue_events (id bigserial PRIMARY KEY, topic text NOT NULL, payload jsonb NOT NULL, created_at timestamptz DEFAULT now());
ALTER TABLE queue_events ADD COLUMN IF NOT EXISTS processed_at timestamptz;
CREATE TABLE IF NOT EXISTS roster_leagues (
  league_id text PRIMARY KEY, tenant_id text NOT NULL, sport_id text, window_open text NOT NULL, window_close text NOT NULL,
  max_squad_size int NOT NULL, required_positions jsonb NOT NULL, matches_in_progress jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS roster_squads (league_id text NOT NULL, squad_id text NOT NULL, club_id text, tenant_id text NOT NULL, name text, PRIMARY KEY (league_id, squad_id));
CREATE TABLE IF NOT EXISTS roster_players (player_id text PRIMARY KEY, league_id text NOT NULL, name text, position text);
CREATE TABLE IF NOT EXISTS roster_regs (
  player_id text PRIMARY KEY, league_id text NOT NULL, squad_id text, role text, reg_type text, parent_squad_id text, start_date text, loan_end_date text);
CREATE TABLE IF NOT EXISTS roster_audit (
  seq bigserial PRIMARY KEY, audit_id text, player_id text NOT NULL, league_id text NOT NULL, action text NOT NULL, from_squad_id text, to_squad_id text,
  effective_date text, who text, "when" text, state text, why text);
CREATE TABLE IF NOT EXISTS roster_requests (request_id text PRIMARY KEY, body_hash text NOT NULL, response jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sync_actions (device_id text NOT NULL, action_id text NOT NULL, result jsonb NOT NULL, PRIMARY KEY (device_id, action_id));
`;

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(8080)');
    await c.query(SCHEMA);
    await c.query('SELECT pg_advisory_unlock(8080)');
  } finally {
    c.release();
  }
}
