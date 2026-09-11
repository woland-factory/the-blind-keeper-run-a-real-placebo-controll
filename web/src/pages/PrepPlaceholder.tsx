import { Link, useParams } from "react-router-dom";
import { Page } from "../components/ui.js";

// Reserved "opens next" state for capsule prep (EPIC 3). Not a dead button and
// not any prep functionality.
export function PrepPlaceholder() {
  const { id } = useParams<{ id: string }>();
  return (
    <Page>
      <section className="card">
        <h1>Capsule prep opens next</h1>
        <p>This is where you will fill and seal your numbered packets.</p>
        <Link className="btn btn-ghost" to={id ? `/experiments/${id}` : "/"}>
          Back
        </Link>
      </section>
    </Page>
  );
}
