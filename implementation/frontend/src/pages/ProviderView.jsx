import { useState } from "react";
import { uploadRecord, requestAccess, getRecordContent, emergencyAccessRequest } from "../api/client";

export default function ProviderView({ user }) {
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  // Upload
  const [uploadPatient, setUploadPatient] = useState("");
  const [file, setFile] = useState(null);

  // Normal access request
  const [reqPatient, setReqPatient] = useState("");
  const [reqRecordId, setReqRecordId] = useState("");
  const [reqPurpose, setReqPurpose] = useState("treatment");
  const [downloadUrl, setDownloadUrl] = useState(null);

  // Emergency
  const [erPatient, setErPatient] = useState("");
  const [erRecordId, setErRecordId] = useState("");
  const [erReason, setErReason] = useState("");

  async function submitUpload(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await uploadRecord(uploadPatient, file);
      setStatus(`Anchored record ${result.recordId} (tx ${result.txHash.slice(0, 10)}...)`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAccessRequest(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setDownloadUrl(null);
    try {
      const result = await requestAccess({ patientAddress: reqPatient, recordId: reqRecordId, purpose: reqPurpose });
      if (!result.granted) {
        setStatus("Access request denied by ConsentManager (no valid consent for this purpose/window).");
        return;
      }
      setStatus("Access granted. Fetching content...");
      const blob = await getRecordContent(reqRecordId, reqPurpose);
      setDownloadUrl(URL.createObjectURL(blob));
      setStatus("Access granted — record content ready to download below.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitEmergency(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await emergencyAccessRequest({ patientAddress: erPatient, recordId: erRecordId, reason: erReason });
      setStatus(
        `Break-glass access granted (event #${result.eventId}). Patient notification: ${
          result.notified ? "confirmed on-chain" : "pending"
        }.`
      );
      if (result.recordContentBase64) {
        const bytes = Uint8Array.from(atob(result.recordContentBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes]);
        setDownloadUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {status && <div className="notice">{status}</div>}

      <div className="card">
        <h2>Upload record</h2>
        <form onSubmit={submitUpload}>
          <label>Patient address</label>
          <input value={uploadPatient} onChange={(e) => setUploadPatient(e.target.value)} placeholder="0x..." />
          <label>File</label>
          <input type="file" onChange={(e) => setFile(e.target.files[0])} />
          <button type="submit">Encrypt + anchor record</button>
        </form>
      </div>

      <div className="card">
        <h2>Request access / view record</h2>
        <form onSubmit={submitAccessRequest}>
          <label>Patient address</label>
          <input value={reqPatient} onChange={(e) => setReqPatient(e.target.value)} placeholder="0x..." />
          <label>Record ID</label>
          <input value={reqRecordId} onChange={(e) => setReqRecordId(e.target.value)} placeholder="0x..." />
          <label>Purpose</label>
          <input value={reqPurpose} onChange={(e) => setReqPurpose(e.target.value)} />
          <button type="submit">Request access</button>
        </form>
        {downloadUrl && (
          <p style={{ marginTop: 8 }}>
            <a href={downloadUrl} download="record.bin">Download decrypted record</a>
          </p>
        )}
      </div>

      {user.role === "provider" && (
        <div className="card">
          <h2>Break-glass emergency access</h2>
          <p style={{ fontSize: 12, color: "#666" }}>
            Only works if your account is credentialed as an emergency responder (e.g. erdoctor1); the
            contract itself rejects this call otherwise. Every call here is logged with the isEmergency
            flag and flips the patient's pending-notification flag.
          </p>
          <form onSubmit={submitEmergency}>
            <label>Patient address</label>
            <input value={erPatient} onChange={(e) => setErPatient(e.target.value)} placeholder="0x..." />
            <label>Record ID</label>
            <input value={erRecordId} onChange={(e) => setErRecordId(e.target.value)} placeholder="0x..." />
            <label>Reason (required, becomes part of the audit entry)</label>
            <textarea value={erReason} onChange={(e) => setErReason(e.target.value)} rows={2} />
            <button type="submit" className="danger">Invoke break-glass access</button>
          </form>
        </div>
      )}
    </div>
  );
}
