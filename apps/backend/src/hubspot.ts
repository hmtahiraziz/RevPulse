import axios from "axios";
import { config } from "./config.js";

const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const API_BASE = "https://api.hubapi.com";

export interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export interface HubSpotTokenInfo {
  hub_id: number;
  user: string;
  hub_domain: string;
  scopes: string[];
  token: string;
}

export interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

/** Builds the HubSpot authorization URL the user is redirected to. */
export function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: config.HUBSPOT_CLIENT_ID,
    redirect_uri: config.HUBSPOT_REDIRECT_URI,
    scope: config.HUBSPOT_SCOPES,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchanges the authorization code from the callback for tokens. */
export async function exchangeCodeForToken(code: string): Promise<HubSpotTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.HUBSPOT_CLIENT_ID,
    client_secret: config.HUBSPOT_CLIENT_SECRET,
    redirect_uri: config.HUBSPOT_REDIRECT_URI,
    code,
  });
  const { data } = await axios.post<HubSpotTokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
}

/** Uses a refresh token to obtain a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<HubSpotTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.HUBSPOT_CLIENT_ID,
    client_secret: config.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const { data } = await axios.post<HubSpotTokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
}

/** Reads metadata for an access token, including the portal (hub_id). */
export async function getTokenInfo(accessToken: string): Promise<HubSpotTokenInfo> {
  const { data } = await axios.get<HubSpotTokenInfo>(
    `${API_BASE}/oauth/v1/access-tokens/${accessToken}`
  );
  return data;
}

const CONTACT_PROPERTIES = "firstname,lastname,email,phone,company,createdate,lastmodifieddate";

/** Fetches a page of CRM contacts using a valid access token. */
export async function getContacts(accessToken: string): Promise<HubSpotContact[]> {
  const { data } = await axios.get<{ results: HubSpotContact[] }>(
    `${API_BASE}/crm/v3/objects/contacts`,
    {
      params: { limit: 100, properties: CONTACT_PROPERTIES },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return data.results;
}

/**
 * Fetches all contacts by following the pagination cursor, capped to keep the
 * audit bounded. Suitable for whole-portal data-quality analysis.
 */
export async function getAllContacts(
  accessToken: string,
  maxPages = 10
): Promise<HubSpotContact[]> {
  const all: HubSpotContact[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const { data } = await axios.get<{
      results: HubSpotContact[];
      paging?: { next?: { after?: string } };
    }>(`${API_BASE}/crm/v3/objects/contacts`, {
      params: { limit: 100, properties: CONTACT_PROPERTIES, after },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    all.push(...data.results);
    after = data.paging?.next?.after;
    if (!after) break;
  }

  return all;
}

export interface HubSpotDeal {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotDealStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: { isClosed?: string; probability?: string };
}

export interface HubSpotDealPipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: HubSpotDealStage[];
}

const DEAL_PROPERTIES =
  "dealname,amount,dealstage,pipeline,closedate,createdate,hs_lastmodifieddate";

/** Fetches all deals by following the pagination cursor (capped). */
export async function getAllDeals(
  accessToken: string,
  maxPages = 10
): Promise<HubSpotDeal[]> {
  const all: HubSpotDeal[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const { data } = await axios.get<{
      results: HubSpotDeal[];
      paging?: { next?: { after?: string } };
    }>(`${API_BASE}/crm/v3/objects/deals`, {
      params: { limit: 100, properties: DEAL_PROPERTIES, after },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    all.push(...data.results);
    after = data.paging?.next?.after;
    if (!after) break;
  }

  return all;
}

/** Fetches deal pipelines and their stages (labels, order, probability). */
export async function getDealPipelines(
  accessToken: string
): Promise<HubSpotDealPipeline[]> {
  const { data } = await axios.get<{ results: HubSpotDealPipeline[] }>(
    `${API_BASE}/crm/v3/pipelines/deals`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data.results;
}
