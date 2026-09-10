import { Link, useLocation } from "react-router-dom";
import { Page } from "../components/ui.js";

export function CheckEmail() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <Page>
      <section className="card">
        <h1>Check your email</h1>
        <p>
          {email ? `We sent a sign-in link to ${email}.` : "We sent you a sign-in link."} Open it on this
          device to continue.
        </p>
        <p className="fine-print">The link works once and expires in 15 minutes.</p>
        <Link className="btn btn-ghost" to="/">
          Back
        </Link>
      </section>
    </Page>
  );
}
