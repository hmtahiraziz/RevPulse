import { neon } from "@neondatabase/serverless";
import { config } from "./config.js";

export const sql = neon(config.DATABASE_URL);

/**
 * Creates the tokens table if it does not exist. Runs once on boot.
 * Tokens are keyed by HubSpot portal (hub_id) so the app is multi-tenant:
 * each connected HubSpot account owns exactly one row.
 */
export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS hubspot_tokens (
      portal_id     BIGINT PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    TIMESTAMPTZ NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Backwards-compat: an earlier schema keyed this table on `hub_id`.
  // Rename it to `portal_id` (idempotent) so existing tokens are preserved.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hubspot_tokens' AND column_name = 'hub_id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hubspot_tokens' AND column_name = 'portal_id'
      ) THEN
        ALTER TABLE hubspot_tokens RENAME COLUMN hub_id TO portal_id;
      END IF;
    END $$;
  `;

  console.log("[db] hubspot_tokens table ready");
}
