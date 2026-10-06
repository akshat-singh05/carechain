import { useState } from "react";
import { getAuditTrail } from "../api/client";

export default function AuditorView() {
  const [patientAddress, setPatientAddress] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);

  async function lookup(e) {
    e.preventDefault();
    setError(null);
    try {
      const { entries } = await getAuditTrail(patientAddress);
      setEntries(entries);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Audit view</h2>
        <p style={{ fontSize: 12, color: "#666" }}>
          AuditLog.sol restricts <code>getPatientTrail</code> to the patient themselves, a registered
          auditor, or a hospital admin — this page works because your account holds AUDITOR_ROLE
          on-chain, not because of anything the frontend enforces.
        </p>
        <form onSubmit={lookup}>
          <label>Patient address</label>
          <input value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} placeholder="0x..." />
          <button type="submit">Load trail</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Purpose</th><th>Emergency?</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.entryId}>
                <td>{new Date(e.timestamp * 1000).toLocaleString()}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{e.actor}</td>
                <td>{e.action}</td>
                <td>{e.purpose}</td>
                <td>{e.isEmergency ? "Yes" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
