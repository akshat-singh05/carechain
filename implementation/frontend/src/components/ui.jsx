import { useState } from "react";

const PATHS = {
  shield: "M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm-6.5 9a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.9M18 14.2A6.5 6.5 0 0121.5 20",
  file: "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5M9 13h6M9 17h6",
  key: "M15 7a4 4 0 11-3.9 4.9L4 19v-3H7v-2h2l2.1-2.1A4 4 0 0115 7z",
  alert: "M12 4l9 16H3L12 4zm0 6v4m0 3h.01",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-11v6m0-9h.01",
  x: "M6 6l12 12M18 6L6 18",
  copy: "M9 9h10v11H9V9zM5 15V4h10",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M5 20h14",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zm9 3l-4.5-4.5",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6v-9z",
  logout: "M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  layers: "M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
};

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const shorten = (v, head = 6, tail = 4) => (v && v.length > head + tail + 3 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v || "");

export function CopyText({ value, full = false, head = 8, tail = 6 }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      setTimeout(() => setOk(false), 1400);
    } catch {
      /* clipboard not available (e.g. insecure context) */
    }
  }
  return (
    <span className="addr" title={value}>
      <span>{full ? value : shorten(value, head, tail)}</span>
      <button type="button" className={ok ? "ok" : ""} onClick={copy} aria-label="Copy to clipboard">
        <Icon name={ok ? "check" : "copy"} size={14} />
      </button>
    </span>
  );
}

export function CopyButton({ value, label = "Copy" }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      setTimeout(() => setOk(false), 1400);
    } catch {
      /* clipboard not available */
    }
  }
  return (
    <button type="button" className="btn secondary sm" onClick={copy}>
      <Icon name={ok ? "check" : "copy"} size={14} /> {ok ? "Copied" : label}
    </button>
  );
}

export function Alert({ kind = "info", children, onClose }) {
  const icon = { info: "info", success: "check", warning: "alert", error: "alert" }[kind];
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="ico"><Icon name={icon} /></span>
      <div className="body">{children}</div>
      {onClose && <button type="button" className="x" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

export function Card({ title, subtitle, icon, tone, actions, children, flush }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className={`card-title ${tone || ""}`}>
            {icon && <span className="ico"><Icon name={icon} size={17} /></span>}
            <h2>{title}</h2>
          </div>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className={flush ? "" : "card-body"} style={flush ? { paddingTop: 14 } : undefined}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Button({ busy, icon, children, kind, ...rest }) {
  return (
    <button className={`btn ${kind || ""}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Badge({ kind = "gray", children }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Empty({ icon = "file", title, text }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={22} /></div>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function Stat({ icon, tone = "blue", value, label }) {
  return (
    <div className="stat">
      <div className={`ico ${tone}`}><Icon name={icon} size={20} /></div>
      <div>
        <div className="value">{value}</div>
        <div className="label">{label}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}>
          <Icon name={t.icon} size={16} />
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

const ACTIONS = {
  RECORD_ANCHORED: ["Record anchored", "blue"],
  BATCH_ANCHORED: ["Batch anchored", "blue"],
  CONSENT_GRANTED: ["Consent granted", "blue"],
  CONSENT_REVOKED: ["Consent revoked", "amber"],
  ACCESS_GRANTED: ["Access granted", "green"],
  ACCESS_DENIED: ["Access denied", "gray"],
  EMERGENCY_ACCESS: ["Emergency access", "red"],
};

export function ActionBadge({ action, emergency }) {
  const [label, kind] = ACTIONS[action] || [action, "gray"];
  return <Badge kind={emergency ? "red" : kind}>{label}</Badge>;
}

export const formatWhen = (ts) =>
  new Date(Number(ts) * 1000).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AuditTable({ entries, showEmergencyColumn }) {
  if (!entries.length) return <Empty icon="list" title="No audit entries yet" text="Actions on this patient's records will appear here." />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>When</th><th>Actor</th><th>Action</th><th>Purpose</th>{showEmergencyColumn && <th>Emergency</th>}</tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.entryId}>
              <td className="when">{formatWhen(e.timestamp)}</td>
              <td><CopyText value={e.actor} /></td>
              <td><ActionBadge action={e.action} emergency={e.isEmergency} /></td>
              <td>{e.purpose || <span className="num">—</span>}</td>
              {showEmergencyColumn && <td>{e.isEmergency ? <Badge kind="red">Yes</Badge> : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
