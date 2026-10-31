import { useState } from "react";
import Login from "./pages/Login.jsx";
import PatientView from "./pages/PatientView.jsx";
import ProviderView from "./pages/ProviderView.jsx";
import AuditorView from "./pages/AuditorView.jsx";
import { Icon, shorten } from "./components/ui.jsx";

const ROLE_LABEL = { patient: "Patient", provider: "Provider", auditor: "Auditor", admin: "Administrator" };
const PAGE = {
  patient: ["My health records", "Control who can see your records, for what purpose and for how long. Every access is recorded on the ledger."],
  provider: ["Clinical workspace", "Upload encrypted records, request access with a stated purpose, or invoke accountable emergency access."],
  auditor: ["Audit console", "Read the tamper-evident access trail for any patient, including emergency overrides."],
  admin: ["Audit console", "Read the tamper-evident access trail for any patient, including emergency overrides."],
};

export default function App() {
  // Restore the session after a page refresh; an expired token is cleared by the API client on the first 401.
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("carechain_user");
      return saved && localStorage.getItem("carechain_token") ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  function logout() {
    localStorage.removeItem("carechain_token");
    localStorage.removeItem("carechain_user");
    setUser(null);
  }

  if (!user) return <Login onLogin={setUser} />;

  const [title, subtitle] = PAGE[user.role] || PAGE.patient;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Icon name="shield" size={18} /></span>
            CareChain
          </div>
          <div className="user-chip">
            <div className="user-meta">
              <div className="name">{user.username}</div>
              <div className="role">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
            <div className="avatar" aria-hidden="true">{user.username.slice(0, 2)}</div>
            <button className="btn secondary sm" onClick={logout}>
              <Icon name="logout" size={14} /> Log out
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <span className="chain-pill" title={user.address}>
            <span className="dot" /> Connected · {shorten(user.address, 6, 4)}
          </span>
        </div>

        {user.role === "patient" && <PatientView user={user} />}
        {user.role === "provider" && <ProviderView user={user} />}
        {(user.role === "auditor" || user.role === "admin") && <AuditorView user={user} />}
      </main>
    </>
  );
}
