export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenant_id: string;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
};
export type Tenant = { id: string; name: string; primary_color: string; logo_url?: string | null };
export type Session = { user: User; tenant: Tenant };

export type League = {
  league_id: string;
  name: string;
  sport_id: string;
  tenant_id?: string;
  team_count?: number;
  qualification_spots?: number;
};
export type Fixture = {
  match_id: string;
  league_id: string;
  sport_id: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  scheduled_at: string | null;
  home_score: number | null;
  away_score: number | null;
  version: number;
};
export type MatchEvent = {
  sequence: number;
  event_id: string;
  type: string;
  payload: Record<string, any>;
  compensated: boolean;
  compensated_by: string | null;
};
export type Side = { team_id: string; score: number; wickets?: number | null; overs?: string | null; fair_play?: number };
export type Match = {
  match_id: string;
  sport_id: string;
  league_id: string | null;
  status: 'upcoming' | 'in_progress' | 'completed';
  outcome: string;
  winner_team_id: string | null;
  home: Side;
  away: Side;
  version: number;
  events: MatchEvent[];
  showcase: { variant_id: string; product_name: string; price_minor: number } | null;
};
export type StandingRow = {
  rank: number;
  team_id: string;
  team_name?: string;
  name?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
  status: 'clinched' | 'eliminated' | 'still_possible';
};
export type Standings = { league_id: string; qualification_spots: number; table: StandingRow[] };
export type Club = {
  club_id: string;
  name: string;
  home_venue?: { name: string; lat?: number; lng?: number } | null;
  social?: { twitter?: string; instagram?: string } | null;
  history?: { season: string; played: number; won: number; drawn: number; lost: number }[];
  staff?: { name: string; role: string }[];
  roster?: { player_id: string; name: string; position: string; role: string; squad_id?: string }[];
};
export type Variant = { variant_id: string; label: string; price_minor: number; currency: string; stock: number };
export type Product = { product_id: string; name: string; description?: string; variants: Variant[] };
export type Sport = { sport_id: string; name: string; scoring_model?: string; scoring_events: Record<string, any> };
export type Roster = {
  squads: { squad_id: string; name: string; players: { player_id: string; name: string; position: string; role: string }[] }[];
  league_id: string;
  other_squads?: { squad_id: string; name: string }[];
  transfer_window?: { open: string; close: string };
};
export type Receipt = {
  payload: {
    order_id: string;
    customer_id: string;
    items: { variant_id: string; quantity: number; unit_price_minor: number }[];
    subtotal_minor: number;
    discount_minor: number;
    total_minor: number;
    currency: string;
    paid_at: string;
  };
  signature: string;
  pdf_base64?: string;
  /** Client-side only: variant_id -> "Product name (Size)" captured from the cart at checkout. */
  item_names?: Record<string, string>;
};
export type CartItem = {
  variant_id: string;
  product_name: string;
  label: string;
  price_minor: number;
  currency: string;
  quantity: number;
};
