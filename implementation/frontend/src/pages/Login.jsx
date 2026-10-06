import { useState } from "react";
import { login } from "../api/client";

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
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 380, margin: "80px auto" }}>
      <h2>CareChain login</h2>
      <form onSubmit={submit}>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
      {error && <div className="error">{error}</div>}
      <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
        Demo accounts (seeded by <code>npm run seed:local</code>): patient1, patient2, doctor1,
        erdoctor1 (emergency responder), auditor1, admin — all use password <code>password123</code>.
      </p>
    </div>
  );
}
