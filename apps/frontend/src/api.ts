const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Portal {
  portalId: number;
  updatedAt: string;
}

export interface Contact {
  id: string;
  properties: {
    firstname?: string | null;
    lastname?: string | null;
    email?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Full-page redirect that starts the OAuth flow on the backend.
export function getInstallUrl(): string {
  return `${API_URL}/api/auth/install`;
}

export function fetchPortals(): Promise<{ portals: Portal[] }> {
  return getJson("/api/portals");
}

export function fetchContacts(portalId: number): Promise<{ contacts: Contact[] }> {
  return getJson(`/api/contacts?portalId=${portalId}`);
}

export interface RevenueRow {
  contactId: string;
  email: string | null;
  stripeCustomerId: string;
  totalSpend: number;
  currency: string;
  activeSubscription: boolean;
  lastPaymentAt: string | null;
}

export interface RevenueResponse {
  enabled: boolean;
  rows: RevenueRow[];
  totalRevenue: number;
  payingCount: number;
}

export function fetchRevenue(portalId: number): Promise<RevenueResponse> {
  return getJson(`/api/revenue?portalId=${portalId}`);
}

export interface AuditContact {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  updatedAt: string;
}

export interface AuditField {
  count: number;
  pct: number;
  contacts: AuditContact[];
}

export interface DuplicateGroup {
  key: string;
  contacts: AuditContact[];
}

export interface AuditResponse {
  total: number;
  score: number;
  completeness: {
    missingEmail: AuditField;
    missingLastName: AuditField;
    missingPhone: AuditField;
    missingCompany: AuditField;
  };
  duplicates: {
    byName: DuplicateGroup[];
    byEmail: DuplicateGroup[];
    affectedCount: number;
  };
  staleness: { fresh: number; cooling: number; stale: number };
}

export function fetchAudit(portalId: number): Promise<AuditResponse> {
  return getJson(`/api/audit?portalId=${portalId}`);
}

export interface Deal {
  id: string;
  dealname: string;
  amount: number;
  stageId: string;
  stageLabel: string;
  pipelineLabel: string;
  closedate: string | null;
  probability: number;
  isClosed: boolean;
  isOpen: boolean;
  isWon: boolean;
  isLost: boolean;
  atRisk: boolean;
  updatedAt: string;
}

export interface StageAgg {
  stageId: string;
  label: string;
  order: number;
  count: number;
  value: number;
}

export interface DealsResponse {
  total: number;
  openCount: number;
  openValue: number;
  weightedForecast: number;
  winRate: number;
  wonCount: number;
  lostCount: number;
  atRiskCount: number;
  byStage: StageAgg[];
  deals: Deal[];
}

export function fetchDeals(portalId: number): Promise<DealsResponse> {
  return getJson(`/api/deals?portalId=${portalId}`);
}

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "none";

export interface LeakRow {
  email: string;
  name: string | null;
  totalSpend: number;
  currency: string;
  subscriptionStatus: SubscriptionStatus;
}

export interface GhostRow {
  id: string;
  name: string;
  email: string | null;
}

export interface CustomerRow {
  email: string;
  name: string | null;
  totalSpend: number;
  currency: string;
  subscriptionStatus: SubscriptionStatus;
  inHubspot: boolean;
}

export interface RevenueIntelResponse {
  enabled: boolean;
  currency?: string;
  totals?: {
    totalBilled: number;
    stripeCustomers: number;
    hubspotContacts: number;
    matchedCount: number;
    leaksCount: number;
    ghostsCount: number;
    churnCount: number;
  };
  leaks?: LeakRow[];
  ghosts?: GhostRow[];
  churnRisk?: CustomerRow[];
  topCustomers?: CustomerRow[];
}

export function fetchRevenueIntel(portalId: number): Promise<RevenueIntelResponse> {
  return getJson(`/api/revenue-intel?portalId=${portalId}`);
}
