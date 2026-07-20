import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDeals, type Deal, type DealsResponse } from "./api.js";

interface Props {
  portalId: number;
}

type SortBy = "amount" | "closedate";

function money(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function toCsv(deals: Deal[]): string {
  const header = ["id", "dealname", "amount", "stage", "closedate", "atRisk"];
  const esc = (v: string | number | boolean | null) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = deals.map((d) =>
    [d.id, d.dealname, d.amount, d.stageLabel, d.closedate, d.atRisk].map(esc).join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(deals: Deal[]): void {
  const blob = new Blob([toCsv(deals)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "deals.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function DealsPipeline({ portalId }: Props) {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("amount");
  const [openOnly, setOpenOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDeals(portalId));
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [portalId]);

  useEffect(() => {
    load();
  }, [load]);

  const maxStageValue = useMemo(
    () => (data ? Math.max(1, ...data.byStage.map((s) => s.value)) : 1),
    [data]
  );

  const visibleDeals = useMemo(() => {
    if (!data) return [];
    const rows = openOnly ? data.deals.filter((d) => d.isOpen) : data.deals;
    return [...rows].sort((a, b) => {
      if (sortBy === "amount") return b.amount - a.amount;
      const at = a.closedate ? new Date(a.closedate).getTime() : Infinity;
      const bt = b.closedate ? new Date(b.closedate).getTime() : Infinity;
      return at - bt;
    });
  }, [data, sortBy, openOnly]);

  if (loading) {
    return (
      <section className="card">
        <h2>Sales Pipeline</h2>
        <p className="muted">Loading deals...</p>
      </section>
    );
  }

  if (error) {
    const needsScope = error === "missing_deals_scope";
    return (
      <section className="card">
        <div className="card-head">
          <h2>Sales Pipeline</h2>
          <button className="btn ghost" onClick={load}>
            Retry
          </button>
        </div>
        <div className="alert">
          {needsScope
            ? "This connection doesn't have deals access yet. Click \"Connect HubSpot\" and re-approve to grant the deals scope."
            : `Failed to load deals: ${error}`}
        </div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Sales Pipeline</h2>
        <button className="btn ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="stat-cards">
        <div className="stat-card revenue">
          <span className="stat-count">{money(data.openValue)}</span>
          <span className="stat-label">Open pipeline</span>
          <span className="stat-hint">{data.openCount} open deals</span>
        </div>
        <div className="stat-card paying">
          <span className="stat-count">{money(data.weightedForecast)}</span>
          <span className="stat-label">Weighted forecast</span>
          <span className="stat-hint">amount × stage probability</span>
        </div>
        <div className="stat-card fresh">
          <span className="stat-count">{data.winRate}%</span>
          <span className="stat-label">Win rate</span>
          <span className="stat-hint">
            {data.wonCount} won / {data.lostCount} lost
          </span>
        </div>
      </div>

      <div className="funnel">
        <h3>Open value by stage</h3>
        {data.byStage.length === 0 ? (
          <p className="muted">No open deals.</p>
        ) : (
          data.byStage.map((s) => (
            <div key={s.stageId} className="funnel-row">
              <span className="funnel-label">{s.label}</span>
              <div className="funnel-track">
                <div
                  className="funnel-bar"
                  style={{ width: `${(s.value / maxStageValue) * 100}%` }}
                />
              </div>
              <span className="funnel-value">
                {money(s.value)} <span className="muted">({s.count})</span>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="card-head" style={{ marginTop: 20 }}>
        <h3 style={{ margin: 0 }}>
          Deals {data.atRiskCount > 0 && <span className="muted">· {data.atRiskCount} at risk</span>}
        </h3>
        <div className="card-actions">
          <button
            className="btn ghost"
            onClick={() => setSortBy((s) => (s === "amount" ? "closedate" : "amount"))}
          >
            Sort: {sortBy === "amount" ? "Amount" : "Close date"}
          </button>
          <button className="btn ghost" onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? "Show all" : "Open only"}
          </button>
          <button className="btn ghost" onClick={() => downloadCsv(visibleDeals)}>
            Export CSV
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Deal</th>
            <th>Amount</th>
            <th>Stage</th>
            <th>Close date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleDeals.map((d) => (
            <tr key={d.id}>
              <td>{d.dealname}</td>
              <td>{money(d.amount)}</td>
              <td>{d.stageLabel}</td>
              <td>{d.closedate ?? "—"}</td>
              <td>
                {d.isWon ? (
                  <span className="badge fresh">Won</span>
                ) : d.isLost ? (
                  <span className="badge stale">Lost</span>
                ) : d.atRisk ? (
                  <span className="badge stale">At risk</span>
                ) : (
                  <span className="badge paying">Open</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
