# HubSpot OAuth App

A TypeScript monorepo that implements the HubSpot public-app OAuth flow, stores
per-portal tokens in Neon Postgres, and uses them to fetch CRM Contacts.

- **Backend** (`apps/backend`) — Node + Express + TypeScript. Owns the OAuth
  handshake, token storage/refresh, and a proxy endpoint for HubSpot data.
- **Frontend** (`apps/frontend`) — React + Vite + TypeScript. A simple UI to
  connect a HubSpot account and view fetched contacts.

## Architecture

```
apps/
  backend/    Express API: /api/auth/install, /oauth-callback, /api/contacts, /api/portals
  frontend/   React app: Connect button + contacts table
```

Tokens are keyed by HubSpot `portal_id` (hub id), so multiple HubSpot accounts
can be connected at once (multi-tenant).

### OAuth flow

1. User clicks **Connect HubSpot** → browser hits `GET /api/auth/install`.
2. Backend redirects to HubSpot's authorize page.
3. User approves → HubSpot redirects to `GET /oauth-callback?code=...`.
4. Backend exchanges the code for `access_token` + `refresh_token`, reads the
   `portal_id`, and upserts the row in Neon.
5. Backend redirects the browser back to the frontend with `?portalId=...`.
6. Frontend calls `GET /api/contacts?portalId=...`; the backend loads the token
   (auto-refreshing if expired) and returns HubSpot contacts.

## Prerequisites

- Node.js 18+
- A HubSpot developer account
- A Neon project (Postgres)

## 1. Create a HubSpot public app

1. Go to the [HubSpot Developer Portal](https://developers.hubspot.com/) and
   create (or open) a developer account.
2. **Apps → Create app**.
3. On the **Auth** tab, copy the **Client ID** and **Client secret**.
4. Under **Redirect URLs**, add exactly:
   `http://localhost:3000/oauth-callback`
   (The `HUBSPOT_REDIRECT_URI` env var must match this value exactly. For
   projects-based HubSpot apps this URL is defined in the project config and is
   read-only in the UI, so set your env vars to match whatever it shows.)
5. Under **Scopes**, add `crm.objects.contacts.read` (the `oauth` scope is
   included automatically).

## 2. Create a Neon database

1. Sign in to [Neon](https://neon.tech/) and create a project.
2. In **Connection Details**, copy the connection string (keep
   `?sslmode=require`). This is your `DATABASE_URL`.

The `hubspot_tokens` table is created automatically on backend startup.

## 3. Configure environment variables

Create the env files from the examples:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Fill in `apps/backend/.env`:

| Variable                | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `HUBSPOT_CLIENT_ID`     | From the HubSpot app Auth tab                       |
| `HUBSPOT_CLIENT_SECRET` | From the HubSpot app Auth tab                       |
| `HUBSPOT_REDIRECT_URI`  | `http://localhost:3000/oauth-callback`              |
| `HUBSPOT_SCOPES`        | `crm.objects.contacts.read oauth`                   |
| `DATABASE_URL`          | Neon connection string                              |
| `FRONTEND_URL`          | `http://localhost:5173`                             |
| `PORT`                  | `3000`                                              |
| `STRIPE_SECRET_KEY`     | Optional. Enables Stripe revenue enrichment (test key ok) |

`apps/frontend/.env` only needs `VITE_API_URL=http://localhost:3000`.

### Optional: Stripe revenue enrichment

If you set `STRIPE_SECRET_KEY` (a test key like `sk_test_...` is fine), the
dashboard matches HubSpot contacts to Stripe customers **by email** and shows:

- A **Revenue** column (lifetime paid charges) with a **Sub** badge for active
  subscriptions.
- **Total revenue** and **Paying customers** summary cards.
- Sort-by-revenue and a "paying only" filter.

If the key is not set, the app runs exactly as before and all revenue UI is
hidden. Matching is by lowercased email; contacts with no matching Stripe
customer simply show no revenue.

## 4. Install & run

```bash
npm install          # installs both workspaces
npm run dev          # runs backend (3000) + frontend (5173) together
```

Open http://localhost:5173, click **Connect HubSpot**, approve the scopes, and
the contacts table will populate.

## Available scripts (root)

| Script                  | What it does                              |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | Run backend + frontend concurrently        |
| `npm run dev:backend`   | Backend only                               |
| `npm run dev:frontend`  | Frontend only                              |
| `npm run build`         | Type-check + build both apps               |
| `npm run start:backend` | Run the compiled backend                   |

## Notes / follow-ups

- v1 has no per-user login/sessions; a connected `portalId` identifies a HubSpot
  account. Add auth + associate portals to users for production.
- Tokens are stored in plaintext in Neon for v1. Encrypt at rest (or use a
  secrets manager) before going to production.
- No migration framework in v1 — the table is created via
  `CREATE TABLE IF NOT EXISTS` on boot.
