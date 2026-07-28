import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchContacts,
  fetchPortals,
  fetchRevenue,
  getInstallUrl,
  type Contact,
  type Portal,
  type RevenueRow,
} from "./api.js";
import DataHealth from "./DataHealth.js";
import DealsPipeline from "./DealsPipeline.js";
import RevenueIntel from "./RevenueIntel.js";

const STORAGE_KEY = "hubspot.activePortalId";

type Health = "fresh" | "cooling" | "stale";
type Filter = Health | "all";
type SortBy = "health" | "revenue";
type Tab = "contacts" | "health" | "deals" | "revintel";

const TABS: { id: Tab; label: string }[] = [
  { id: "contacts", label: "Contacts" },
  { id: "health", label: "Data Health" },
  { id: "deals", label: "Sales Pipeline" },
  { id: "revintel", label: "Revenue Intelligence" },
];

const HEALTH_LABEL: Record<Health, string> = {
  fresh: "Fresh",
  cooling: "Cooling",
  stale: "Stale",
};

const DAY_MS = 1000 * 60 * 60 * 24;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

// Fresh < 7d, Cooling 7-30d, Stale > 30d (based on last modified).
function bucketOf(contact: Contact): Health {
  const days = daysSince(contact.updatedAt);
  if (days < 7) return "fresh";
  if (days <= 30) return "cooling";
  return "stale";
}

const HEALTH_ORDER: Record<Health, number> = { stale: 0, cooling: 1, fresh: 2 };

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export default function App() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [activePortal, setActivePortal] = useState<number | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("health");
  const [payingOnly, setPayingOnly] = useState(false);
  const [tab, setTab] = useState<Tab>("contacts");

  const [revenueEnabled, setRevenueEnabled] = useState(false);
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [payingCount, setPayingCount] = useState(0);

  // On first load, read portalId / error returned from the OAuth callback.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    const portalId = params.get("portalId");

    if (oauthError) {
      setError(`OAuth failed: ${oauthError}`);
    }
    if (portalId) {
      localStorage.setItem(STORAGE_KEY, portalId);
      setActivePortal(Number(portalId));
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setActivePortal(Number(stored));
    }

    if (oauthError || portalId) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadPortals = useCallback(async () => {
    try {
      const { portals } = await fetchPortals();
      setPortals(portals);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadPortals();
  }, [loadPortals]);

  const loadData = useCallback(async (portalId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [contactsRes, revenueRes] = await Promise.all([
        fetchContacts(portalId),
        fetchRevenue(portalId).catch(() => null),
      ]);
      setContacts(contactsRes.contacts);

      if (revenueRes && revenueRes.enabled) {
        setRevenueEnabled(true);
        setRevenueRows(revenueRes.rows);
        setTotalRevenue(revenueRes.totalRevenue);
        setPayingCount(revenueRes.payingCount);
      } else {
        setRevenueEnabled(false);
        setRevenueRows([]);
        setTotalRevenue(0);
        setPayingCount(0);
      }
    } catch (err) {
      setError((err as Error).message);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePortal) loadData(activePortal);
  }, [activePortal, loadData]);

  // email (lowercased) -> revenue row, for quick lookup while rendering.
  const revenueByEmail = useMemo(() => {
    const map = new Map<string, RevenueRow>();
    for (const r of revenueRows) {
      if (r.email) map.set(r.email.toLowerCase(), r);
    }
    return map;
  }, [revenueRows]);

  const totalRevenueCurrency = revenueRows[0]?.currency ?? "usd";

  // Precompute each contact's health bucket + revenue once.
  const scored = useMemo(
    () =>
      contacts.map((c) => ({
        contact: c,
        health: bucketOf(c),
        revenue: c.properties.email
          ? revenueByEmail.get(c.properties.email.toLowerCase()) ?? null
          : null,
      })),
    [contacts, revenueByEmail]
  );

  const counts = useMemo(() => {
    const base = { fresh: 0, cooling: 0, stale: 0 } as Record<Health, number>;
    for (const { health } of scored) base[health] += 1;
    return base;
  }, [scored]);

  const visible = useMemo(() => {
    let rows = filter === "all" ? scored : scored.filter((s) => s.health === filter);
    if (payingOnly) rows = rows.filter((s) => s.revenue !== null);

    return [...rows].sort((a, b) => {
      if (sortBy === "revenue") {
        return (b.revenue?.totalSpend ?? -1) - (a.revenue?.totalSpend ?? -1);
      }
      return HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    });
  }, [scored, filter, sortBy, payingOnly]);

  const toggleFilter = (health: Health) =>
    setFilter((prev) => (prev === health ? "all" : health));

  const showCards = activePortal && !loading && contacts.length > 0;

  return (
    <div className="page">
      <header className="header">
        <h1>HubSpot Dashboard</h1>
        <a className="btn" href={getInstallUrl()}>
          Connect HubSpot
        </a>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="card">
        <h2>Connected portals</h2>
        {portals.length === 0 ? (
          <p className="muted">No portals connected yet. Click "Connect HubSpot" to start.</p>
        ) : (
          <ul className="portal-list">
            {portals.map((p) => (
              <li key={p.portalId}>
                <button
                  className={`portal ${activePortal === p.portalId ? "active" : ""}`}
                  onClick={() => {
                    localStorage.setItem(STORAGE_KEY, String(p.portalId));
                    setActivePortal(p.portalId);
                  }}
                >
                  Portal {p.portalId}
                </button>
                <span className="muted">
                  updated {new Date(p.updatedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activePortal && (
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {activePortal && tab === "health" && <DataHealth portalId={activePortal} />}
      {activePortal && tab === "deals" && <DealsPipeline portalId={activePortal} />}
      {activePortal && tab === "revintel" && <RevenueIntel portalId={activePortal} />}

      {tab === "contacts" && showCards && (
        <div className="stat-cards">
          {(["fresh", "cooling", "stale"] as Health[]).map((h) => (
            <button
              key={h}
              className={`stat-card ${h} ${filter === h ? "selected" : ""}`}
              onClick={() => toggleFilter(h)}
            >
              <span className="stat-count">{counts[h]}</span>
              <span className="stat-label">{HEALTH_LABEL[h]}</span>
              <span className="stat-hint">
                {h === "fresh" ? "< 7 days" : h === "cooling" ? "7–30 days" : "> 30 days"}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === "contacts" && showCards && revenueEnabled && (
        <div className="stat-cards two">
          <div className="stat-card revenue">
            <span className="stat-count">
              {formatMoney(totalRevenue, totalRevenueCurrency)}
            </span>
            <span className="stat-label">Total revenue</span>
            <span className="stat-hint">from matched Stripe customers</span>
          </div>
          <button
            className={`stat-card paying ${payingOnly ? "selected" : ""}`}
            onClick={() => setPayingOnly((v) => !v)}
          >
            <span className="stat-count">{payingCount}</span>
            <span className="stat-label">Paying customers</span>
            <span className="stat-hint">{payingOnly ? "showing only these" : "click to filter"}</span>
          </button>
        </div>
      )}

      {tab === "contacts" && (
      <section className="card">
        <div className="card-head">
          <h2>
            Contacts
            {filter !== "all" && (
              <span className="muted"> · {HEALTH_LABEL[filter]}</span>
            )}
            {payingOnly && <span className="muted"> · paying</span>}
          </h2>
          <div className="card-actions">
            {revenueEnabled && (
              <button
                className="btn ghost"
                onClick={() => setSortBy((s) => (s === "health" ? "revenue" : "health"))}
              >
                Sort: {sortBy === "health" ? "Health" : "Revenue"}
              </button>
            )}
            {(filter !== "all" || payingOnly) && (
              <button
                className="btn ghost"
                onClick={() => {
                  setFilter("all");
                  setPayingOnly(false);
                }}
              >
                Clear filter
              </button>
            )}
            {activePortal && (
              <button className="btn ghost" onClick={() => loadData(activePortal)}>
                Refresh
              </button>
            )}
          </div>
        </div>

        {!activePortal ? (
          <p className="muted">Select or connect a portal to view contacts.</p>
        ) : loading ? (
          <p className="muted">Loading contacts...</p>
        ) : contacts.length === 0 ? (
          <p className="muted">No contacts found for this portal.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>First name</th>
                <th>Last name</th>
                <th>Email</th>
                <th>Last activity</th>
                <th>Health</th>
                {revenueEnabled && <th>Revenue</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ contact, health, revenue }) => {
                const days = daysSince(contact.updatedAt);
                return (
                  <tr key={contact.id}>
                    <td>{contact.properties.firstname ?? "—"}</td>
                    <td>{contact.properties.lastname ?? "—"}</td>
                    <td>{contact.properties.email ?? "—"}</td>
                    <td>{days === 0 ? "today" : `${days}d ago`}</td>
                    <td>
                      <span className={`badge ${health}`}>{HEALTH_LABEL[health]}</span>
                    </td>
                    {revenueEnabled && (
                      <td>
                        {revenue ? (
                          <span className="revenue-cell">
                            {formatMoney(revenue.totalSpend, revenue.currency)}
                            {revenue.activeSubscription && (
                              <span className="badge paying">Sub</span>
                            )}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      )}
    </div>
  );
}
