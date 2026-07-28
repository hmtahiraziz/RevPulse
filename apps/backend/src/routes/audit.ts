import { Router } from "express";
import { getAllContacts, type HubSpotContact } from "../hubspot.js";
import { getValidAccessToken } from "../tokenStore.js";

export const auditRouter = Router();

const DAY_MS = 1000 * 60 * 60 * 24;

interface AuditContact {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  updatedAt: string;
}

const isBlank = (v: string | null | undefined): boolean => !v || v.trim() === "";

function toAuditContact(c: HubSpotContact): AuditContact {
  return {
    id: c.id,
    firstname: c.properties.firstname ?? null,
    lastname: c.properties.lastname ?? null,
    email: c.properties.email ?? null,
    phone: c.properties.phone ?? null,
    company: c.properties.company ?? null,
    updatedAt: c.updatedAt,
  };
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

// Returns a data-quality report for the whole connected portal.
auditRouter.get("/audit", async (req, res) => {
  const portalId = Number(req.query.portalId);
  if (!Number.isFinite(portalId) || portalId <= 0) {
    return res.status(400).json({ error: "invalid_portal_id" });
  }

  try {
    const accessToken = await getValidAccessToken(portalId);
    if (!accessToken) {
      return res.status(404).json({ error: "portal_not_connected" });
    }

    const raw = await getAllContacts(accessToken);
    const contacts = raw.map(toAuditContact);
    const total = contacts.length;

    const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
    const field = (predicate: (c: AuditContact) => boolean) => {
      const list = contacts.filter(predicate);
      return { count: list.length, pct: pct(list.length), contacts: list };
    };

    const completeness = {
      missingEmail: field((c) => isBlank(c.email)),
      missingLastName: field((c) => isBlank(c.lastname)),
      missingPhone: field((c) => isBlank(c.phone)),
      missingCompany: field((c) => isBlank(c.company)),
    };

    // Duplicate detection: group by normalized full name and by email.
    const groupBy = (keyOf: (c: AuditContact) => string | null) => {
      const map = new Map<string, AuditContact[]>();
      for (const c of contacts) {
        const key = keyOf(c);
        if (!key) continue;
        const arr = map.get(key) ?? [];
        arr.push(c);
        map.set(key, arr);
      }
      return [...map.entries()]
        .filter(([, arr]) => arr.length > 1)
        .map(([key, arr]) => ({ key, contacts: arr }));
    };

    const byName = groupBy((c) => {
      const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim().toLowerCase();
      return name || null;
    });
    const byEmail = groupBy((c) => (c.email ? c.email.trim().toLowerCase() : null));

    const dupContactIds = new Set<string>();
    for (const g of [...byName, ...byEmail]) {
      for (const c of g.contacts) dupContactIds.add(c.id);
    }

    // Staleness buckets (based on last modified).
    let fresh = 0,
      cooling = 0,
      stale = 0;
    for (const c of contacts) {
      const d = daysSince(c.updatedAt);
      if (d < 7) fresh++;
      else if (d <= 30) cooling++;
      else stale++;
    }

    // Overall score: weighted field completeness, penalized by duplicate ratio.
    const complete = (missing: number) => (total === 0 ? 0 : (total - missing) / total);
    const fieldScore =
      0.35 * complete(completeness.missingEmail.count) +
      0.25 * complete(completeness.missingLastName.count) +
      0.2 * complete(completeness.missingPhone.count) +
      0.2 * complete(completeness.missingCompany.count);
    const dupRatio = total === 0 ? 0 : dupContactIds.size / total;
    const score = total === 0 ? 0 : Math.round(100 * fieldScore * (1 - 0.5 * dupRatio));

    res.json({
      total,
      score,
      completeness,
      duplicates: {
        byName,
        byEmail,
        affectedCount: dupContactIds.size,
      },
      staleness: { fresh, cooling, stale },
    });
  } catch (err) {
    console.error("[api/audit] failed:", err);
    res.status(500).json({ error: "failed_to_run_audit" });
  }
});
