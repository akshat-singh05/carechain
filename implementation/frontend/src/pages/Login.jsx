import { useState } from "react";
import { login } from "../api/client";
import { Alert, Button, Field, Icon } from "../components/ui.jsx";

const DEMO = [
  ["patient1", "Patient"],
  ["doctor1", "Doctor"],
  ["erdoctor1", "ER doctor"],
  ["auditor1", "Auditor"],
  ["admin", "Admin"],
];

const FEATURES = [
  ["lock", "Records stay encrypted", "Clinical content is AES-256 encrypted off-chain; only hashes and pointers reach the ledger."],
  ["key", "Patient-controlled consent", "Time-, purpose- and scope-bound permissions that can be revoked at any moment."],
  ["bolt", "Accountable emergency access", "Break-glass requires a credential and a reason, is rate-limited and always flagged."],
  ["list", "Tamper-evident audit trail", "Every grant, denial and override is appended to an immutable on-chain log."],
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("patient1");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await login(username, password);
      localStorage.setItem("carechain_token", token);
      localStorage.setItem("carechain_user", JSON.stringify(user));
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <aside className="login-hero">
        <div className="brand">
          <span className="brand-mark"><Icon name="shield" size={18} /></span>
          CareChain
        </div>
        <div>
          <h1>Healthcare data sharing that patients can trust.</h1>
          <p>A permissioned-ledger platform for exchanging health records with consent, encryption and a complete audit trail.</p>
          <ul className="feature-list">
            {FEATURES.map(([icon, title, text]) => (
              <li key={title}>
                <span className="ico"><Icon name={icon} size={17} /></span>
                <div><strong>{title}</strong><span>{text}</span></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="login-foot">BCSE329P · Blockchain and Distributed Ledger Technology Lab · VIT</div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="lead">Use your CareChain account to continue.</p>
          <form onSubmit={submit}>
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <Alert kind="error">{error}</Alert>}
            <Button type="submit" busy={busy} kind="block">{busy ? "Signing in…" : "Sign in"}</Button>
          </form>

          <div className="demo-box">
            <h3>Demo accounts</h3>
            <div className="chips">
              {DEMO.map(([u, label]) => (
                <button key={u} type="button" className="chip" aria-pressed={username === u} onClick={() => { setUsername(u); setPassword("password123"); }}>
                  {label}
                </button>
              ))}
            </div>
            <p>Seeded by <code>npm run seed:local</code>. All demo accounts use the password <code>password123</code>.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
