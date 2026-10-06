import { useState } from "react";
import Login from "./pages/Login.jsx";
import PatientView from "./pages/PatientView.jsx";
import ProviderView from "./pages/ProviderView.jsx";
import AuditorView from "./pages/AuditorView.jsx";

export default function App() {
  const [user, setUser] = useState(null);

  function logout() {
    localStorage.removeItem("carechain_token");
    setUser(null);
  }

  if (!user) {
    return (
      <div className="app-shell">
        <Login onLogin={setUser} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>CareChain</h1>
        <div>
          <span style={{ marginRight: 12, fontSize: 13 }}>
            {user.username} <span className="badge granted">{user.role}</span>
          </span>
          <button className="secondary" onClick={logout} style={{ width: "auto" }}>Log out</button>
        </div>
      </header>

      {user.role === "patient" && <PatientView user={user} />}
      {user.role === "provider" && <ProviderView user={user} />}
      {(user.role === "auditor" || user.role === "admin") && <AuditorView user={user} />}
    </div>
  );
}
