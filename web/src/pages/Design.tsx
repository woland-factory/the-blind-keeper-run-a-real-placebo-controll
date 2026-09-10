import { Link } from "react-router-dom";
import { Page } from "../components/ui.js";

// Reserved placeholder so the primary action on the home screen is never a dead
// button. The designer itself arrives in a later release.
export function Design() {
  return (
    <Page>
      <section className="card">
        <h1>The designer opens soon</h1>
        <p>This is where you will set up your first test.</p>
        <Link className="btn btn-ghost" to="/">
          Back
        </Link>
      </section>
    </Page>
  );
}
