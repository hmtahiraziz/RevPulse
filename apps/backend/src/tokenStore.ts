import { sql } from "./db.js";
import { refreshAccessToken, type HubSpotTokenResponse } from "./hubspot.js";

// Refresh a bit before actual expiry to avoid racing the deadline.
const EXPIRY_SKEW_MS = 60 * 1000;

interface TokenRow {
  portal_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
}

/** Persists (inserts or updates) tokens for a portal. */
export async function saveTokens(
  portalId: number,
  tokens: HubSpotTokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await sql`
    INSERT INTO hubspot_tokens (portal_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (${portalId}, ${tokens.access_token}, ${tokens.refresh_token}, ${expiresAt.toISOString()}, now())
    ON CONFLICT (portal_id) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = now()
  `;
}

/** Lists all connected portals (no secrets returned). */
export async function listPortals(): Promise<{ portalId: number; updatedAt: string }[]> {
  const rows = (await sql`
    SELECT portal_id, updated_at FROM hubspot_tokens ORDER BY updated_at DESC
  `) as Pick<TokenRow, "portal_id" | "updated_at">[];
  return rows.map((r) => ({ portalId: Number(r.portal_id), updatedAt: r.updated_at }));
}

/**
 * Returns a valid access token for the portal, refreshing and persisting a new
 * one if the stored token is expired (or about to expire). Returns null if the
 * portal has never connected.
 */
export async function getValidAccessToken(portalId: number): Promise<string | null> {
  const rows = (await sql`
    SELECT portal_id, access_token, refresh_token, expires_at, updated_at
    FROM hubspot_tokens
    WHERE portal_id = ${portalId}
  `) as TokenRow[];

  const row = rows[0];
  if (!row) return null;

  const expiresAtMs = new Date(row.expires_at).getTime();
  const isExpired = Date.now() >= expiresAtMs - EXPIRY_SKEW_MS;

  if (!isExpired) return row.access_token;

  const refreshed = await refreshAccessToken(row.refresh_token);
  await saveTokens(portalId, refreshed);
  return refreshed.access_token;
}
