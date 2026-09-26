import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, requestMagicLink } from "../api.js";
import { Page } from "../components/ui.js";

export function Landing() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestMagicLink(email);
      navigate("/auth/check-email", { state: { email } });
    } catch (err) {
      // The server tells the user what went wrong (like a bad email). Only a
      // real network failure gets the connection message.
      setError(
        err instanceof ApiRequestError ? err.message : "Check your connection and try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <header className="hero">
        <h1>Run a real placebo test on yourself.</h1>
        <p className="subhead">
          Pick a supplement. Stay blind for a few weeks. Get an honest verdict you could not fake.
        </p>
      </header>

      <form className="card form" onSubmit={onSubmit} noValidate>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Sending" : "Send my sign-in link"}
        </button>
        <p className="fine-print">We email you a link. No password to remember.</p>
      </form>
    </Page>
  );
}
