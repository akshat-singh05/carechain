import { useEffect, useState } from "react";
import {
  getPatientRecordIds,
  getMyConsents,
  grantConsent,
  revokeConsent,
  getAuditTrail,
  getPendingNotifications,
} from "../api/client";

export default function PatientView({ user }) {
  const [recordIds, setRecordIds] = useState([]);
  const [consents, setConsents] = useState([]);
  const [trail, setTrail] = useState([]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

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
    try {
      const validFrom = Math.floor(Date.now() / 1000);
      const validUntil = validFrom + Number(durationHours) * 3600;
      await grantConsent({ providerAddress, purpose, validFrom, validUntil });
      setProviderAddress("");
      refresh();
    } catch (err) {
      setError(err.message);
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

  return (
    <div>
      {pending?.pendingNotification && (
        <div className="notice">
          You have an unread emergency-access notification below — a clinician used break-glass access
          on one of your records.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>My records</h2>
        {recordIds.length === 0 && <p>No records anchored yet.</p>}
        <ul>
          {recordIds.map((id) => (
            <li key={id} style={{ fontFamily: "monospace", fontSize: 12 }}>{id}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Grant consent</h2>
        <form onSubmit={submitGrant}>
          <label>Provider address</label>
          <input value={providerAddress} onChange={(e) => setProviderAddress(e.target.value)} placeholder="0x..." />
          <div className="row">
            <div>
              <label>Purpose</label>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            <div>
              <label>Duration (hours)</label>
              <input type="number" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} />
            </div>
          </div>
          <button type="submit">Grant consent (all records)</button>
        </form>
      </div>

      <div className="card">
        <h2>My consents</h2>
        <table>
          <thead>
            <tr><th>ID</th><th>Provider</th><th>Valid until</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {consents.map((c) => (
              <tr key={c.consentId}>
                <td>{c.consentId}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{c.provider}</td>
                <td>{new Date(c.validUntil * 1000).toLocaleString()}</td>
                <td>{c.revoked ? "Revoked" : "Active"}</td>
                <td>
                  {!c.revoked && <button className="danger" onClick={() => doRevoke(c.consentId)}>Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Audit trail</h2>
        <table>
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            {trail.map((e) => (
              <tr key={e.entryId}>
                <td>{new Date(e.timestamp * 1000).toLocaleString()}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{e.actor}</td>
                <td>
                  <span className={`badge ${e.isEmergency ? "emergency" : e.action === "ACCESS_GRANTED" ? "granted" : "denied"}`}>
                    {e.action}
                  </span>
                </td>
                <td>{e.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
