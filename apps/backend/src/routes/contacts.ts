import { Router } from "express";
import { getContacts } from "../hubspot.js";
import { getValidAccessToken, listPortals } from "../tokenStore.js";

export const apiRouter = Router();

// Lists connected HubSpot portals.
apiRouter.get("/portals", async (_req, res) => {
  try {
    const portals = await listPortals();
    res.json({ portals });
  } catch (err) {
    console.error("[api/portals] failed:", err);
    res.status(500).json({ error: "failed_to_list_portals" });
  }
});

// Fetches CRM contacts for a given portal.
apiRouter.get("/contacts", async (req, res) => {
  const portalId = Number(req.query.portalId);
  if (!Number.isFinite(portalId) || portalId <= 0) {
    return res.status(400).json({ error: "invalid_portal_id" });
  }

  try {
    const accessToken = await getValidAccessToken(portalId);
    if (!accessToken) {
      return res.status(404).json({ error: "portal_not_connected" });
    }
    const contacts = await getContacts(accessToken);
    res.json({ contacts });
  } catch (err) {
    console.error("[api/contacts] failed:", err);
    res.status(500).json({ error: "failed_to_fetch_contacts" });
  }
});
