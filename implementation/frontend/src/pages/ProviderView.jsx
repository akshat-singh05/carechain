import { useState } from "react";
import { uploadRecord, uploadBatch, requestAccess, getRecordContent, emergencyAccessRequest } from "../api/client";
import { Alert, Button, Card, CopyText, Field, Tabs } from "../components/ui.jsx";

export default function ProviderView({ user }) {
  const [tab, setTab] = useState("upload");
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null); // { kind, text, recordId? }
  const [busy, setBusy] = useState(null);

  // Upload
  const [uploadPatient, setUploadPatient] = useState("");
  const [files, setFiles] = useState([]);

  // Normal access request
  const [reqPatient, setReqPatient] = useState("");
  const [reqRecordId, setReqRecordId] = useState("");
  const [reqPurpose, setReqPurpose] = useState("treatment");
  const [downloadUrl, setDownloadUrl] = useState(null);

  // Emergency
  const [erPatient, setErPatient] = useState("");
  const [erRecordId, setErRecordId] = useState("");
  const [erReason, setErReason] = useState("");

  function changeTab(id) {
    setTab(id);
    setError(null);
    setStatus(null);
    setDownloadUrl(null);
  }

  async function submitUpload(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setBusy("upload");
    try {
      if (files.length > 1) {
        const result = await uploadBatch(uploadPatient, files);
        setStatus({
          kind: "success",
          text: `Merkle-batched ${result.records.length} records with ONE anchor tx (root ${result.merkleRoot.slice(0, 12)}..., batch #${result.batchId})`,
        });
      } else {
        const result = await uploadRecord(uploadPatient, files[0]);
        setStatus({ kind: "success", text: `Record encrypted and anchored on-chain (tx ${result.txHash.slice(0, 10)}...). Record ID:`, recordId: result.recordId });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function submitAccessRequest(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setDownloadUrl(null);
    setBusy("access");
    try {
      const result = await requestAccess({ patientAddress: reqPatient, recordId: reqRecordId, purpose: reqPurpose });
      if (!result.granted) {
        setStatus({ kind: "warning", text: "Access request denied by ConsentManager (no valid consent for this purpose/window)." });
        return;
      }
      const blob = await getRecordContent(reqRecordId, reqPurpose);
      setDownloadUrl(URL.createObjectURL(blob));
      setStatus({ kind: "success", text: "Access granted — record content ready to download below." });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function submitEmergency(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setBusy("emergency");
    try {
      const result = await emergencyAccessRequest({ patientAddress: erPatient, recordId: erRecordId, reason: erReason });
      setStatus({
        kind: "warning",
        text: `Break-glass access granted (event #${result.eventId}). Patient notification: ${result.notified ? "confirmed on-chain" : "pending"}.`,
      });
      if (result.recordContentBase64) {
        const bytes = Uint8Array.from(atob(result.recordContentBase64), (c) => c.charCodeAt(0));
        setDownloadUrl(URL.createObjectURL(new Blob([bytes])));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const tabs = [
    { id: "upload", label: "Upload record", icon: "upload" },
    { id: "access", label: "Request access", icon: "search" },
  ];
  if (user.role === "provider") tabs.push({ id: "emergency", label: "Emergency access", icon: "bolt" });

  const download = downloadUrl && (
    <div className="result-box">
      <span>Decrypted content is ready.</span>
      <a className="btn secondary sm" href={downloadUrl} download="record.bin" style={{ textDecoration: "none" }}>Download decrypted record</a>
    </div>
  );

  return (
    <div>
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {status && (
        <Alert kind={status.kind} onClose={() => setStatus(null)}>
          {status.text}
          {status.recordId && <div style={{ marginTop: 8 }}><CopyText value={status.recordId} full /></div>}
        </Alert>
      )}

      <Tabs active={tab} onChange={changeTab} tabs={tabs} />

      {tab === "upload" && (
        <Card title="Upload record" icon="upload" subtitle="Files are encrypted with AES-256-GCM, stored off-chain, and only their hash is anchored on the ledger.">
          <form onSubmit={submitUpload}>
            <Field label="Patient address" hint="The patient this record belongs to (0x…).">
              <input className="mono-input" value={uploadPatient} onChange={(e) => setUploadPatient(e.target.value)} placeholder="0x…" />
            </Field>
            <Field label="File(s)" hint="Choose several files to anchor them as one Merkle batch with a single transaction.">
              <input type="file" multiple onChange={(e) => setFiles([...e.target.files])} />
            </Field>
            <div className="actions">
              <Button type="submit" busy={busy === "upload"} icon="lock">Encrypt + anchor record</Button>
            </div>
          </form>
        </Card>
      )}

      {tab === "access" && (
        <Card title="Request access / view record" icon="search" subtitle="Access is granted only while the patient’s consent covers this record and purpose.">
          <form onSubmit={submitAccessRequest}>
            <Field label="Patient address">
              <input className="mono-input" value={reqPatient} onChange={(e) => setReqPatient(e.target.value)} placeholder="0x…" />
            </Field>
            <Field label="Record ID">
              <input className="mono-input" value={reqRecordId} onChange={(e) => setReqRecordId(e.target.value)} placeholder="0x…" />
            </Field>
            <Field label="Purpose" hint="Must match the purpose the patient consented to, e.g. treatment.">
              <input value={reqPurpose} onChange={(e) => setReqPurpose(e.target.value)} />
            </Field>
            <div className="actions">
              <Button type="submit" busy={busy === "access"} icon="key">Request access</Button>
            </div>
          </form>
          {download}
        </Card>
      )}

      {tab === "emergency" && user.role === "provider" && (
        <Card title="Break-glass emergency access" icon="bolt" tone="danger">
          <Alert kind="warning">
            Only works if your account is credentialed as an emergency responder (e.g. erdoctor1); the contract itself rejects this call
            otherwise. Every call is logged with the emergency flag and flips the patient’s pending-notification flag.
          </Alert>
          <form onSubmit={submitEmergency}>
            <div className="row">
              <Field label="Patient address">
                <input className="mono-input" value={erPatient} onChange={(e) => setErPatient(e.target.value)} placeholder="0x…" />
              </Field>
              <Field label="Record ID">
                <input className="mono-input" value={erRecordId} onChange={(e) => setErRecordId(e.target.value)} placeholder="0x…" />
              </Field>
            </div>
            <Field label="Reason (required)" hint="Becomes part of the permanent audit entry.">
              <textarea value={erReason} onChange={(e) => setErReason(e.target.value)} rows={3} />
            </Field>
            <div className="actions">
              <Button type="submit" kind="danger" busy={busy === "emergency"} icon="bolt">Invoke break-glass access</Button>
            </div>
          </form>
          {download}
        </Card>
      )}
    </div>
  );
}
