import { useState } from "react";
import { getAuditTrail } from "../api/client";
import { Alert, AuditTable, Button, Card, Field, Stat } from "../components/ui.jsx";

export default function AuditorView() {
  const [patientAddress, setPatientAddress] = useState("");
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { entries } = await getAuditTrail(patientAddress);
      setEntries(entries);
    } catch (err) {
      setEntries(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const emergencies = entries ? entries.filter((e) => e.isEmergency).length : 0;
  const denied = entries ? entries.filter((e) => e.action === "ACCESS_DENIED").length : 0;

  return (
    <div>
      <Card
        title="Look up a patient’s trail"
        icon="search"
        subtitle="AuditLog.sol restricts getPatientTrail to the patient, a registered auditor, or a hospital admin. This page works because your account holds the auditor role on-chain, not because of anything the front-end enforces."
      >
        <form onSubmit={lookup}>
          <Field label="Patient address">
            <input className="mono-input" value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} placeholder="0x…" />
          </Field>
          <div className="actions">
            <Button type="submit" busy={busy} icon="search">Load trail</Button>
          </div>
        </form>
        {error && <div style={{ marginTop: 14 }}><Alert kind="error" onClose={() => setError(null)}>{error}</Alert></div>}
      </Card>

      {entries && (
        <>
          <div className="grid-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Stat icon="list" tone="blue" value={entries.length} label="Total events" />
            <Stat icon="bolt" tone={emergencies ? "red" : "amber"} value={emergencies} label="Emergency accesses" />
            <Stat icon="lock" tone="amber" value={denied} label="Denied requests" />
          </div>
          <Card title="Audit trail" icon="list" flush>
            <AuditTable entries={entries} showEmergencyColumn />
          </Card>
        </>
      )}
    </div>
  );
}
