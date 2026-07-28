import { Router } from "express";
import {
  getAllDeals,
  getDealPipelines,
  type HubSpotDeal,
  type HubSpotDealPipeline,
} from "../hubspot.js";
import { getValidAccessToken } from "../tokenStore.js";
import { config } from "../config.js";

export const dealsRouter = Router();

const isForbidden = (err: unknown): boolean =>
  (err as { response?: { status?: number } }).response?.status === 403;

/**
 * Loads deals + pipelines using the portal's OAuth token. If that token lacks
 * the deals scope (403) and a Private App token is configured, retries with it
 * so the feature works even when the public app can't grant the deals scope.
 */
async function loadDeals(
  oauthToken: string
): Promise<{ deals: HubSpotDeal[]; pipelines: HubSpotDealPipeline[]; via: string }> {
  try {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(oauthToken),
      getDealPipelines(oauthToken),
    ]);
    return { deals, pipelines, via: "oauth" };
  } catch (err) {
    if (isForbidden(err) && config.HUBSPOT_PRIVATE_APP_TOKEN) {
      const pat = config.HUBSPOT_PRIVATE_APP_TOKEN;
      const [deals, pipelines] = await Promise.all([
        getAllDeals(pat),
        getDealPipelines(pat),
      ]);
      return { deals, pipelines, via: "private_app" };
    }
    throw err;
  }
}

const DAY_MS = 1000 * 60 * 60 * 24;

interface StageInfo {
  label: string;
  pipelineLabel: string;
  displayOrder: number;
  probability: number;
  isClosed: boolean;
}

const num = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

const daysSince = (iso: string): number =>
  Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);

// Sales pipeline analytics for the connected portal.
dealsRouter.get("/deals", async (req, res) => {
  const portalId = Number(req.query.portalId);
  if (!Number.isFinite(portalId) || portalId <= 0) {
    return res.status(400).json({ error: "invalid_portal_id" });
  }

  try {
    const accessToken = await getValidAccessToken(portalId);
    if (!accessToken) {
      return res.status(404).json({ error: "portal_not_connected" });
    }

    const { deals, pipelines } = await loadDeals(accessToken);

    // Map stage id -> stage info (label, probability, closed flag).
    const stageMap = new Map<string, StageInfo>();
    for (const p of pipelines) {
      for (const s of p.stages) {
        stageMap.set(s.id, {
          label: s.label,
          pipelineLabel: p.label,
          displayOrder: s.displayOrder,
          probability: num(s.metadata?.probability),
          isClosed: s.metadata?.isClosed === "true",
        });
      }
    }

    const shape = (d: HubSpotDeal) => {
      const stageId = d.properties.dealstage ?? "";
      const stage = stageMap.get(stageId);
      const amount = num(d.properties.amount);
      const isClosed = stage?.isClosed ?? false;
      const probability = stage?.probability ?? 0;
      const isOpen = !isClosed;
      const atRisk = isOpen && daysSince(d.updatedAt) > 30;
      return {
        id: d.id,
        dealname: d.properties.dealname ?? "(unnamed deal)",
        amount,
        stageId,
        stageLabel: stage?.label ?? stageId ?? "Unknown",
        pipelineLabel: stage?.pipelineLabel ?? "",
        closedate: d.properties.closedate ?? null,
        probability,
        isClosed,
        isOpen,
        isWon: isClosed && probability >= 1,
        isLost: isClosed && probability <= 0,
        atRisk,
        updatedAt: d.updatedAt,
      };
    };

    const rows = deals.map(shape);

    const openDeals = rows.filter((r) => r.isOpen);
    const wonCount = rows.filter((r) => r.isWon).length;
    const lostCount = rows.filter((r) => r.isLost).length;

    const openValue = openDeals.reduce((s, r) => s + r.amount, 0);
    const weightedForecast = openDeals.reduce(
      (s, r) => s + r.amount * r.probability,
      0
    );
    const winRate =
      wonCount + lostCount === 0
        ? 0
        : Math.round((wonCount / (wonCount + lostCount)) * 100);

    // Funnel: value + count per open stage, ordered by pipeline display order.
    const stageAgg = new Map<string, { label: string; order: number; count: number; value: number }>();
    for (const r of openDeals) {
      const info = stageMap.get(r.stageId);
      const key = r.stageId;
      const cur =
        stageAgg.get(key) ??
        { label: r.stageLabel, order: info?.displayOrder ?? 999, count: 0, value: 0 };
      cur.count += 1;
      cur.value += r.amount;
      stageAgg.set(key, cur);
    }
    const byStage = [...stageAgg.entries()]
      .map(([stageId, v]) => ({ stageId, ...v }))
      .sort((a, b) => a.order - b.order);

    res.json({
      total: rows.length,
      openCount: openDeals.length,
      openValue,
      weightedForecast,
      winRate,
      wonCount,
      lostCount,
      atRiskCount: rows.filter((r) => r.atRisk).length,
      byStage,
      deals: rows,
    });
  } catch (err) {
    const e = err as { response?: { status?: number } };
    if (e.response?.status === 403) {
      return res.status(403).json({ error: "missing_deals_scope" });
    }
    console.error("[api/deals] failed:", err);
    res.status(500).json({ error: "failed_to_fetch_deals" });
  }
});
