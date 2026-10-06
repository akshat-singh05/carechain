const BASE = "/api";

function authHeaders() {
  const token = localStorage.getItem("carechain_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      body = { error: res.statusText };
    }
    throw new Error(body.error || `Request failed with ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.arrayBuffer();
}

export async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return handle(res);
}

export async function uploadRecord(patientAddress, file) {
  const form = new FormData();
  form.append("patientAddress", patientAddress);
  form.append("file", file);
  const res = await fetch(`${BASE}/records/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  return handle(res);
}

export async function uploadBatch(patientAddress, files) {
  const form = new FormData();
  form.append("patientAddress", patientAddress);
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${BASE}/records/upload-batch`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  return handle(res);
}

export async function getPatientRecordIds(patientAddress) {
  const res = await fetch(`${BASE}/records/patient/${patientAddress}`, { headers: authHeaders() });
  return handle(res);
}

export async function getRecordMeta(recordId) {
  const res = await fetch(`${BASE}/records/${recordId}/meta`, { headers: authHeaders() });
  return handle(res);
}

export async function getRecordContent(recordId, purpose) {
  const res = await fetch(`${BASE}/records/${recordId}/content?purpose=${encodeURIComponent(purpose || "treatment")}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return handle(res); // will throw with parsed error
  return res.blob();
}

export async function grantConsent(payload) {
  const res = await fetch(`${BASE}/consent/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function revokeConsent(consentId) {
  const res = await fetch(`${BASE}/consent/${consentId}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handle(res);
}

export async function getMyConsents() {
  const res = await fetch(`${BASE}/consent/mine`, { headers: authHeaders() });
  return handle(res);
}

export async function requestAccess(payload) {
  const res = await fetch(`${BASE}/access/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function emergencyAccessRequest(payload) {
  const res = await fetch(`${BASE}/emergency/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function getPendingNotifications(patientAddress) {
  const res = await fetch(`${BASE}/emergency/pending/${patientAddress}`, { headers: authHeaders() });
  return handle(res);
}

export async function getAuditTrail(patientAddress) {
  const res = await fetch(`${BASE}/audit/${patientAddress}`, { headers: authHeaders() });
  return handle(res);
}
