import { useCallback, useEffect, useState } from "react";
import {
  fetchRevenueIntel,
  getInstallUrl,
  type CustomerRow,
  type GhostRow,
  type LeakRow,
  type RevenueIntelResponse,
  type SubscriptionStatus,
} from "./api.js";

interface Props {
  portalId: number;
}

type DrillKind = "customers" | "ghosts";

interface DrillDown {
  title: string;
  kind: DrillKind;
  rows: (CustomerRow | LeakRow | GhostRow)[];
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

const SUB_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  none: "No sub",
};

function csvEscape(v: string | number | null): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]): void {
  const content = [
    header.join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RevenueIntel({ portalId }: Props) {
  const [data, setData] = useState<RevenueIntelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDrill(null);
    try {
      setData(await fetchRevenueIntel(portalId));
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

  if (loading) {
    return (
      <section className="card">
        <h2>Revenue Intelligence</h2>
        <p className="muted">Reconciling HubSpot contacts with Stripe billing...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Revenue Intelligence</h2>
          <button className="btn ghost" onClick={load}>
            Retry
          </button>
        </div>
        <div className="alert">{error}</div>
      </section>
    );
  }

  if (!data) return null;

  if (!data.enabled) {
    return (
      <section className="card">
        <h2>Revenue Intelligence</h2>
        <div className="empty-state">
          <p>
            Connect Stripe to unlock revenue reconciliation. Add a Stripe test key
            (<code>STRIPE_SECRET_KEY=sk_test_...</code>) to the backend
            <code>.env</code> and restart.
          </p>
          <p className="muted">
            Once connected, this tab surfaces revenue leaks, ghost contacts, churn
            risk, and your top customers.
          </p>
          <a className="btn" href={getInstallUrl()}>
            Reconnect HubSpot
          </a>
        </div>
      </section>
    );
  }

  const totals = data.totals!;
  const currency = data.currency ?? "usd";
  const leaks = data.leaks ?? [];
  const ghosts = data.ghosts ?? [];
  const churnRisk = data.churnRisk ?? [];
  const topCustomers = data.topCustomers ?? [];

  const openCustomers = (title: string, rows: (CustomerRow | LeakRow)[]) =>
    setDrill({ title, kind: "customers", rows });
  const openGhosts = (title: string, rows: GhostRow[]) =>
    setDrill({ title, kind: "ghosts", rows });

  return (
    <section className="card">
      <div className="card-head">
        <h2>Revenue Intelligence</h2>
        <button className="btn ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="stat-cards">
        <div className="stat-card revenue">
          <span className="stat-count">{formatMoney(totals.totalBilled, currency)}</span>
          <span className="stat-label">Total billed</span>
          <span className="stat-hint">{totals.stripeCustomers} Stripe customers</span>
        </div>
        <button
          className="stat-card issue"
          disabled={leaks.length === 0}
          onClick={() => openCustomers("Revenue leaks", leaks)}
        >
          <span className="stat-count">{totals.leaksCount}</span>
          <span className="stat-label">Revenue leaks</span>
          <span className="stat-hint">paying, not in HubSpot</span>
        </button>
        <button
          className="stat-card issue"
          disabled={ghosts.length === 0}
          onClick={() => openGhosts("Ghost contacts", ghosts)}
        >
          <span className="stat-count">{totals.ghostsCount}</span>
          <span className="stat-label">Ghost contacts</span>
          <span className="stat-hint">in HubSpot, never paid</span>
        </button>
        <button
          className="stat-card issue"
          disabled={churnRisk.length === 0}
          onClick={() => openCustomers("Churn risk", churnRisk)}
        >
          <span className="stat-count">{totals.churnCount}</span>
          <span className="stat-label">Churn risk</span>
          <span className="stat-hint">canceled / past due</span>
        </button>
      </div>

      <div className="drilldown">
        <div className="card-head">
          <h3>
            Top customers <span className="muted">(by lifetime spend)</span>
          </h3>
          <button
            className="btn ghost"
            disabled={topCustomers.length === 0}
            onClick={() =>
              downloadCsv(
                "top-customers.csv",
                ["name", "email", "totalSpend", "subscription", "inHubspot"],
                topCustomers.map((c) => [
                  c.name,
                  c.email,
                  c.totalSpend,
                  c.subscriptionStatus,
                  c.inHubspot ? "yes" : "no",
                ])
              )
            }
          >
            Export CSV
          </button>
        </div>
        {topCustomers.length === 0 ? (
          <p className="muted">No paying customers found yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Lifetime spend</th>
                <th>Subscription</th>
                <th>In HubSpot</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((c) => (
                <tr key={c.email}>
                  <td>{c.name ?? "(no name)"}</td>
                  <td>{c.email}</td>
                  <td>{formatMoney(c.totalSpend, c.currency)}</td>
                  <td>
                    <span className={`badge sub-${c.subscriptionStatus}`}>
                      {SUB_LABEL[c.subscriptionStatus]}
                    </span>
                  </td>
                  <td>{c.inHubspot ? "Yes" : <span className="badge issue">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drill && (
        <div className="drilldown">
          <div className="card-head">
            <h3>
              {drill.title} <span className="muted">({drill.rows.length})</span>
            </h3>
            <div className="card-actions">
              <button
                className="btn ghost"
                disabled={drill.rows.length === 0}
                onClick={() => {
                  const file = `${drill.title.toLowerCase().replace(/\s+/g, "-")}.csv`;
                  if (drill.kind === "ghosts") {
                    downloadCsv(
                      file,
                      ["name", "email"],
                      (drill.rows as GhostRow[]).map((r) => [r.name, r.email])
                    );
                  } else {
                    downloadCsv(
                      file,
                      ["name", "email", "totalSpend", "subscription"],
                      (drill.rows as (CustomerRow | LeakRow)[]).map((r) => [
                        r.name,
                        r.email,
                        r.totalSpend,
                        r.subscriptionStatus,
                      ])
                    );
                  }
                }}
              >
                Export CSV
              </button>
              <button className="btn ghost" onClick={() => setDrill(null)}>
                Close
              </button>
            </div>
          </div>

          {drill.kind === "ghosts" ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {(drill.rows as GhostRow[]).map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Lifetime spend</th>
                  <th>Subscription</th>
                </tr>
              </thead>
              <tbody>
                {(drill.rows as (CustomerRow | LeakRow)[]).map((r) => (
                  <tr key={r.email}>
                    <td>{r.name ?? "(no name)"}</td>
                    <td>{r.email}</td>
                    <td>{formatMoney(r.totalSpend, r.currency)}</td>
                    <td>
                      <span className={`badge sub-${r.subscriptionStatus}`}>
                        {SUB_LABEL[r.subscriptionStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
