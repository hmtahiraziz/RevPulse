import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAudit,
  type AuditContact,
  type AuditResponse,
} from "./api.js";

interface Props {
  portalId: number;
}

interface DrillDown {
  title: string;
  contacts: AuditContact[];
}

function scoreClass(score: number): string {
  if (score >= 80) return "good";
  if (score >= 50) return "ok";
  return "bad";
}

function contactName(c: AuditContact): string {
  const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim();
  return name || "(no name)";
}

function toCsv(contacts: AuditContact[]): string {
  const header = ["id", "firstname", "lastname", "email", "phone", "company"];
  const escape = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const rows = contacts.map((c) =>
    [c.id, c.firstname, c.lastname, c.email, c.phone, c.company].map(escape).join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(filename: string, contacts: AuditContact[]): void {
  const blob = new Blob([toCsv(contacts)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataHealth({ portalId }: Props) {
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDrill(null);
    try {
      setAudit(await fetchAudit(portalId));
    } catch (err) {
      setError((err as Error).message);
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [portalId]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    if (!audit) return [];
    const c = audit.completeness;
    return [
      { key: "missingEmail", label: "Missing email", field: c.missingEmail },
      { key: "missingLastName", label: "Missing last name", field: c.missingLastName },
      { key: "missingPhone", label: "Missing phone", field: c.missingPhone },
      { key: "missingCompany", label: "Missing company", field: c.missingCompany },
    ];
  }, [audit]);

  const openDrill = (title: string, contacts: AuditContact[]) => {
    setDrill({ title, contacts });
  };

  if (loading) {
    return (
      <section className="card">
        <h2>Data Health</h2>
        <p className="muted">Analyzing contacts...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Data Health</h2>
          <button className="btn ghost" onClick={load}>
            Retry
          </button>
        </div>
        <div className="alert">{error}</div>
      </section>
    );
  }

  if (!audit) return null;

  const dupGroups = [
    ...audit.duplicates.byEmail.map((g) => ({ ...g, kind: "email" as const })),
    ...audit.duplicates.byName.map((g) => ({ ...g, kind: "name" as const })),
  ];
  const dupContacts = dupGroups.flatMap((g) => g.contacts);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Data Health</h2>
        <button className="btn ghost" onClick={load}>
          Re-run audit
        </button>
      </div>

      <div className="health-top">
        <div className={`score-ring ${scoreClass(audit.score)}`}>
          <span className="score-num">{audit.score}</span>
          <span className="score-max">/ 100</span>
        </div>
        <div className="score-caption">
          <strong>{audit.total}</strong> contacts analyzed
          <p className="muted">
            Score reflects field completeness, penalized by duplicate records.
          </p>
        </div>
      </div>

      <div className="stat-cards">
        {metrics.map((m) => (
          <button
            key={m.key}
            className="stat-card issue"
            disabled={m.field.count === 0}
            onClick={() => openDrill(m.label, m.field.contacts)}
          >
            <span className="stat-count">{m.field.count}</span>
            <span className="stat-label">{m.label}</span>
            <span className="stat-hint">{m.field.pct}% of contacts</span>
          </button>
        ))}
      </div>

      <div className="stat-cards two">
        <button
          className="stat-card issue"
          disabled={audit.duplicates.affectedCount === 0}
          onClick={() => openDrill("Duplicate contacts", dupContacts)}
        >
          <span className="stat-count">{audit.duplicates.affectedCount}</span>
          <span className="stat-label">Duplicate records</span>
          <span className="stat-hint">
            {dupGroups.length} group{dupGroups.length === 1 ? "" : "s"} by name/email
          </span>
        </button>
        <div className="stat-card">
          <span className="stat-count">{audit.staleness.stale}</span>
          <span className="stat-label">Stale contacts</span>
          <span className="stat-hint">not touched in 30+ days</span>
        </div>
      </div>

      {drill && (
        <div className="drilldown">
          <div className="card-head">
            <h3>
              {drill.title} <span className="muted">({drill.contacts.length})</span>
            </h3>
            <div className="card-actions">
              <button
                className="btn ghost"
                disabled={drill.contacts.length === 0}
                onClick={() =>
                  downloadCsv(
                    `${drill.title.toLowerCase().replace(/\s+/g, "-")}.csv`,
                    drill.contacts
                  )
                }
              >
                Export CSV
              </button>
              <button className="btn ghost" onClick={() => setDrill(null)}>
                Close
              </button>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Company</th>
              </tr>
            </thead>
            <tbody>
              {drill.contacts.map((c) => (
                <tr key={c.id}>
                  <td>{contactName(c)}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.company ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
