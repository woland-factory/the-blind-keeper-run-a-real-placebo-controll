import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../api.js";
import { Page } from "../components/ui.js";

export function Home({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      onSignedOut();
    }
  }

  return (
    <>
      <header className="app-bar">
        <span className="brand">blind-keeper</span>
        <button className="btn btn-ghost" onClick={onSignOut} disabled={signingOut} aria-busy={signingOut}>
          Sign out
        </button>
      </header>
      <Page>
        <p className="greeting">Signed in as {email}</p>
        <section className="card empty-state">
          <h1>Start your first blind test</h1>
          <p>
            You choose a supplement and a daily score. We keep the schedule secret so you stay blind. At
            the end you get a verdict.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/design")}>
            Design a test
          </button>
        </section>
      </Page>
    </>
  );
}
