import { Router } from "express";
import { getAllContacts } from "../hubspot.js";
import { getValidAccessToken } from "../tokenStore.js";
import { getAllCustomersWithRevenue, isStripeEnabled } from "../stripe.js";

export const revenueIntelRouter = Router();

const isBlank = (v: string | null | undefined): boolean => !v || v.trim() === "";

// Cross-references HubSpot contacts with Stripe billing to surface mismatches.
revenueIntelRouter.get("/revenue-intel", async (req, res) => {
  const portalId = Number(req.query.portalId);
  if (!Number.isFinite(portalId) || portalId <= 0) {
    return res.status(400).json({ error: "invalid_portal_id" });
  }

  if (!isStripeEnabled) {
    return res.json({ enabled: false });
  }

  try {
    const accessToken = await getValidAccessToken(portalId);
    if (!accessToken) {
      return res.status(404).json({ error: "portal_not_connected" });
    }

    const [contacts, customers] = await Promise.all([
      getAllContacts(accessToken),
      getAllCustomersWithRevenue(),
    ]);

    // HubSpot email -> display name, for joining Stripe data back to a contact.
    const hubspotByEmail = new Map<string, string>();
    for (const c of contacts) {
      const email = c.properties.email;
      if (isBlank(email)) continue;
      const name = `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim();
      hubspotByEmail.set(email!.toLowerCase(), name || "(no name)");
    }

    const stripeEmails = new Set(customers.map((c) => c.email.toLowerCase()));

    // Revenue leaks: paying in Stripe but not present in HubSpot.
    const leaks = customers
      .filter((c) => !hubspotByEmail.has(c.email.toLowerCase()))
      .filter((c) => c.totalSpend > 0 || c.subscriptionStatus !== "none")
      .map((c) => ({
        email: c.email,
        name: c.name,
        totalSpend: c.totalSpend,
        currency: c.currency,
        subscriptionStatus: c.subscriptionStatus,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    // Ghost contacts: in HubSpot but no Stripe customer / payments.
    const ghosts = contacts
      .filter((c) => !isBlank(c.properties.email))
      .filter((c) => !stripeEmails.has(c.properties.email!.toLowerCase()))
      .map((c) => ({
        id: c.id,
        name:
          `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim() ||
          "(no name)",
        email: c.properties.email,
      }));

    // Churn risk: canceled or past-due subscriptions (with HubSpot name if known).
    const churnRisk = customers
      .filter((c) => c.subscriptionStatus === "canceled" || c.subscriptionStatus === "past_due")
      .map((c) => ({
        email: c.email,
        name: hubspotByEmail.get(c.email.toLowerCase()) ?? c.name,
        totalSpend: c.totalSpend,
        currency: c.currency,
        subscriptionStatus: c.subscriptionStatus,
        inHubspot: hubspotByEmail.has(c.email.toLowerCase()),
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    // Top customers by lifetime spend.
    const topCustomers = [...customers]
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 10)
      .map((c) => ({
        email: c.email,
        name: hubspotByEmail.get(c.email.toLowerCase()) ?? c.name,
        totalSpend: c.totalSpend,
        currency: c.currency,
        subscriptionStatus: c.subscriptionStatus,
        inHubspot: hubspotByEmail.has(c.email.toLowerCase()),
      }));

    const totalBilled = customers.reduce((s, c) => s + c.totalSpend, 0);
    const matchedCount = customers.filter((c) =>
      hubspotByEmail.has(c.email.toLowerCase())
    ).length;

    res.json({
      enabled: true,
      currency: customers[0]?.currency ?? "usd",
      totals: {
        totalBilled,
        stripeCustomers: customers.length,
        hubspotContacts: contacts.length,
        matchedCount,
        leaksCount: leaks.length,
        ghostsCount: ghosts.length,
        churnCount: churnRisk.length,
      },
      leaks,
      ghosts,
      churnRisk,
      topCustomers,
    });
  } catch (err) {
    console.error("[api/revenue-intel] failed:", err);
    res.status(500).json({ error: "failed_to_build_revenue_intel" });
  }
});
