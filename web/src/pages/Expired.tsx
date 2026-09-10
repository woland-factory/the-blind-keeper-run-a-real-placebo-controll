import { useNavigate } from "react-router-dom";
import { Page } from "../components/ui.js";

export function Expired() {
  const navigate = useNavigate();
  return (
    <Page>
      <section className="card" role="alert">
        <h1>That link expired</h1>
        <p>Sign-in links work once and last 15 minutes. Request a new one.</p>
        <button className="btn btn-primary" onClick={() => navigate("/")}>
          Send a new link
        </button>
      </section>
    </Page>
  );
}
