import Stripe from "stripe";
import { config } from "./config.js";

// The client is only created when a secret key is configured. When absent, the
// revenue feature degrades gracefully (endpoints report `enabled: false`).
const stripe = config.STRIPE_SECRET_KEY
  ? new Stripe(config.STRIPE_SECRET_KEY)
  : null;

export const isStripeEnabled = stripe !== null;

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "none";

export interface CustomerRevenue {
  stripeCustomerId: string;
  totalSpend: number; // in major currency units (e.g. dollars)
  currency: string;
  activeSubscription: boolean;
  subscriptionStatus: SubscriptionStatus;
  lastPaymentAt: string | null;
}

export interface CustomerWithRevenue extends CustomerRevenue {
  email: string;
  name: string | null;
}

/** Normalizes Stripe's many subscription statuses into our simple buckets. */
function normalizeSubStatus(status: string | undefined): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

/**
 * Builds a map of lowercased email -> Stripe customer id by paginating through
 * the customer list once. Bounded to a few pages to keep it cheap.
 */
async function listCustomersByEmail(): Promise<Map<string, string>> {
  if (!stripe) return new Map();

  const map = new Map<string, string>();
  let startingAfter: string | undefined;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await stripe.customers.list({ limit: 100, starting_after: startingAfter });
    for (const c of res.data) {
      if (c.email) map.set(c.email.toLowerCase(), c.id);
    }
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }

  return map;
}

/** Aggregates lifetime spend + latest payment + subscription status for a customer. */
async function getCustomerRevenue(customerId: string): Promise<CustomerRevenue> {
  if (!stripe) {
    return {
      stripeCustomerId: customerId,
      totalSpend: 0,
      currency: "usd",
      activeSubscription: false,
      subscriptionStatus: "none",
      lastPaymentAt: null,
    };
  }

  const charges = await stripe.charges.list({ customer: customerId, limit: 100 });
  let totalMinor = 0;
  let currency = "usd";
  let lastPaymentAt: string | null = null;

  for (const ch of charges.data) {
    if (ch.paid && !ch.refunded) {
      totalMinor += ch.amount - ch.amount_refunded;
      currency = ch.currency;
      if (!lastPaymentAt) lastPaymentAt = new Date(ch.created * 1000).toISOString();
    }
  }

  // status: "all" returns the most recent subscription regardless of state.
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 1,
  });
  const subscriptionStatus = normalizeSubStatus(subs.data[0]?.status);

  return {
    stripeCustomerId: customerId,
    totalSpend: totalMinor / 100,
    currency,
    activeSubscription: subscriptionStatus === "active",
    subscriptionStatus,
    lastPaymentAt,
  };
}

/**
 * Returns every Stripe customer (with an email) enriched with spend + sub status.
 * Bounded by page count; per-customer calls run with limited concurrency.
 */
export async function getAllCustomersWithRevenue(): Promise<CustomerWithRevenue[]> {
  if (!stripe) return [];

  const basics: { id: string; email: string; name: string | null }[] = [];
  let startingAfter: string | undefined;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await stripe.customers.list({ limit: 100, starting_after: startingAfter });
    for (const c of res.data) {
      if (c.email) basics.push({ id: c.id, email: c.email, name: c.name ?? null });
    }
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }

  const out: CustomerWithRevenue[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < basics.length; i += CONCURRENCY) {
    const chunk = basics.slice(i, i + CONCURRENCY);
    const revenues = await Promise.all(
      chunk.map(async (b) => ({ b, rev: await getCustomerRevenue(b.id) }))
    );
    for (const { b, rev } of revenues) {
      out.push({ ...rev, email: b.email, name: b.name });
    }
  }

  return out;
}

/**
 * Given a set of contact emails, returns a map of email -> revenue for the ones
 * that match a Stripe customer. Only matched customers incur per-customer calls.
 */
export async function getRevenueByEmail(
  emails: string[]
): Promise<Map<string, CustomerRevenue>> {
  const result = new Map<string, CustomerRevenue>();
  if (!stripe) return result;

  const customerByEmail = await listCustomersByEmail();
  const wanted = new Set(emails.map((e) => e.toLowerCase()).filter(Boolean));

  const matches = [...customerByEmail.entries()].filter(([email]) => wanted.has(email));

  await Promise.all(
    matches.map(async ([email, customerId]) => {
      result.set(email, await getCustomerRevenue(customerId));
    })
  );

  return result;
}
