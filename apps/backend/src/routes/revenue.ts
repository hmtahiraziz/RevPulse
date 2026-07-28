import { Router } from "express";
import { getContacts } from "../hubspot.js";
import { getValidAccessToken } from "../tokenStore.js";
import { getRevenueByEmail, isStripeEnabled } from "../stripe.js";

export const revenueRouter = Router();

// Returns per-contact Stripe revenue (matched by email) plus totals.
// When Stripe isn't configured, responds with { enabled: false }.
revenueRouter.get("/revenue", async (req, res) => {
  const portalId = Number(req.query.portalId);
  if (!Number.isFinite(portalId) || portalId <= 0) {
    return res.status(400).json({ error: "invalid_portal_id" });
  }

  if (!isStripeEnabled) {
    return res.json({ enabled: false, rows: [], totalRevenue: 0, payingCount: 0 });
  }

  try {
    const accessToken = await getValidAccessToken(portalId);
    if (!accessToken) {
      return res.status(404).json({ error: "portal_not_connected" });
    }

    const contacts = await getContacts(accessToken);
    const emails = contacts
      .map((c) => c.properties.email)
      .filter((e): e is string => typeof e === "string" && e.length > 0);

    const revenueByEmail = await getRevenueByEmail(emails);

    const rows = contacts
      .map((c) => {
        const email = c.properties.email?.toLowerCase();
        const rev = email ? revenueByEmail.get(email) : undefined;
        if (!rev) return null;
        return {
          contactId: c.id,
          email: c.properties.email,
          stripeCustomerId: rev.stripeCustomerId,
          totalSpend: rev.totalSpend,
          currency: rev.currency,
          activeSubscription: rev.activeSubscription,
          lastPaymentAt: rev.lastPaymentAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const totalRevenue = rows.reduce((sum, r) => sum + r.totalSpend, 0);

    res.json({
      enabled: true,
      rows,
      totalRevenue,
      payingCount: rows.length,
    });
  } catch (err) {
    console.error("[api/revenue] failed:", err);
    res.status(500).json({ error: "failed_to_fetch_revenue" });
  }
});
