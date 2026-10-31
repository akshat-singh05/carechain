import { useEffect, useState } from "react";
import {
  getPatientRecordIds,
  getMyConsents,
  grantConsent,
  revokeConsent,
  getAuditTrail,
  getPendingNotifications,
} from "../api/client";
import { Alert, AuditTable, Badge, Button, Card, CopyButton, CopyText, Empty, Field, Icon, Stat, Tabs, formatWhen } from "../components/ui.jsx";

function consentStatus(c) {
  if (c.revoked) return ["Revoked", "amber"];
  if (Number(c.validUntil) * 1000 < Date.now()) return ["Expired", "gray"];
  return ["Active", "green"];
}

export default function PatientView({ user }) {
  const [tab, setTab] = useState("overview");
  const [recordIds, setRecordIds] = useState([]);
  const [consents, setConsents] = useState([]);
  const [trail, setTrail] = useState([]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [providerAddress, setProviderAddress] = useState("");
  const [purpose, setPurpose] = useState("treatment");
  const [durationHours, setDurationHours] = useState(24);

  async function refresh() {
    try {
      const [{ recordIds }, { consents }, { entries }, pendingInfo] = await Promise.all([
        getPatientRecordIds(user.address),
        getMyConsents(),
        getAuditTrail(user.address),
        getPendingNotifications(user.address),
      ]);
      setRecordIds(recordIds);
      setConsents(consents);
      setTrail(entries);
      setPending(pendingInfo);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitGrant(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const validFrom = Math.floor(Date.now() / 1000);
      const validUntil = validFrom + Number(durationHours) * 3600;
      await grantConsent({ providerAddress, purpose, validFrom, validUntil });
      setProviderAddress("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke(id) {
    setError(null);
    try {
      await revokeConsent(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  // Emergency accesses the patient has not acknowledged yet (remembered per patient in this browser).
  const seenKey = `carechain_seen_emergencies_${user.address}`;
  const readSeen = () => {
    try { return JSON.parse(localStorage.getItem(seenKey) || "[]"); } catch { return []; }
  };
  const [seen, setSeen] = useState(readSeen);
  const unseen = (pending?.events || []).filter((e) => !seen.includes(e.eventId));
  function dismissEmergencies() {
    const all = (pending?.events || []).map((e) => e.eventId);
    try { localStorage.setItem(seenKey, JSON.stringify(all)); } catch { /* storage unavailable */ }
    setSeen(all);
  }

  const active = consents.filter((c) => consentStatus(c)[0] === "Active").length;
  const emergencies = trail.filter((e) => e.isEmergency).length;

  return (
    <div>
      {unseen.length > 0 && (
        <Alert kind="warning" onClose={dismissEmergencies}>
          <strong>Emergency access on your records.</strong>{" "}
          {unseen.length === 1 ? "A clinician used break-glass access" : `${unseen.length} break-glass accesses were used`} on your records.
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {unseen.slice(-3).map((e) => (
              <li key={e.eventId}>
                {formatWhen(e.timestamp)} — “{e.reason}” (responder <code>{e.responder.slice(0, 8)}…{e.responder.slice(-4)}</code>)
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview", icon: "layers" },
          { id: "consents", label: "Consents", icon: "key", count: consents.length },
          { id: "audit", label: "Audit trail", icon: "list", count: trail.length },
        ]}
      />

      {tab === "overview" && (
        <>
          <div className="grid-stats">
            <Stat icon="file" tone="blue" value={recordIds.length} label="Records on the ledger" />
            <Stat icon="check" tone="green" value={active} label="Active consents" />
            <Stat icon="list" tone="blue" value={trail.length} label="Audit events" />
            <Stat icon="bolt" tone={emergencies ? "red" : "amber"} value={emergencies} label="Emergency accesses" />
          </div>
          <Card title="My records" icon="file" subtitle="Record identifiers anchored on-chain. The clinical content itself is encrypted off-chain." flush>
            {recordIds.length === 0 ? (
              <Empty icon="file" title="No records yet" text="Records appear here after a provider uploads and anchors them for you." />
            ) : (
              <ul className="rec-list">
                {recordIds.map((id) => (
                  <li key={id}>
                    <span className="ico"><Icon name="file" size={16} /></span>
                    <span className="id">{id}</span>
                    <CopyButton value={id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === "consents" && (
        <div className="grid-2">
          <Card title="Grant consent" icon="key" subtitle="Allow a registered provider to read your records for a stated purpose.">
            <form onSubmit={submitGrant}>
              <Field label="Provider address" hint="The provider’s blockchain address (0x…, 42 characters).">
                <input className="mono-input" value={providerAddress} onChange={(e) => setProviderAddress(e.target.value)} placeholder="0x…" />
              </Field>
              <div className="row">
                <Field label="Purpose">
                  <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                </Field>
                <Field label="Duration (hours)">
                  <input type="number" min="1" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} />
                </Field>
              </div>
              <div className="actions">
                <Button type="submit" busy={busy} icon="check">Grant consent (all records)</Button>
              </div>
            </form>
          </Card>

          <Card title="My consents" icon="list" subtitle="Revoking takes effect immediately." flush>
            {consents.length === 0 ? (
              <Empty icon="key" title="No consents yet" text="Grant a provider access to see it listed here." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>ID</th><th>Provider</th><th>Valid until</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {consents.map((c) => {
                      const [label, kind] = consentStatus(c);
                      return (
                        <tr key={c.consentId}>
                          <td className="num">#{c.consentId}</td>
                          <td><CopyText value={c.provider} /></td>
                          <td className="when">{formatWhen(c.validUntil)}</td>
                          <td><Badge kind={kind}>{label}</Badge></td>
                          <td>{label === "Active" && <button className="btn danger sm" onClick={() => doRevoke(c.consentId)}>Revoke</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "audit" && (
        <Card title="Audit trail" icon="list" subtitle="Every action on your records, in order. This log is append-only and cannot be edited." flush>
          <AuditTable entries={trail} />
        </Card>
      )}
    </div>
  );
}
