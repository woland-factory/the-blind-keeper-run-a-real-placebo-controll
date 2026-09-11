import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getExperiment, type Experiment, type MetricDirection } from "../api.js";
import { ErrorState, LoadingCard, Page } from "../components/ui.js";

function directionLabel(d: MetricDirection): string {
  return d === "higher_better" ? "Higher is better" : "Lower is better";
}

type State =
  | { status: "loading" }
  | { status: "ready"; experiment: Experiment }
  | { status: "error" };

export function ExperimentLocked() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    if (!id) return;
    setState({ status: "loading" });
    try {
      const experiment = await getExperiment(id);
      setState({ status: "ready", experiment });
    } catch {
      setState({ status: "error" });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <Page>
        <LoadingCard />
      </Page>
    );
  }
  if (state.status === "error") {
    return (
      <Page>
        <ErrorState
          title="We could not load this page."
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void load()}
        />
      </Page>
    );
  }

  const e = state.experiment;
  return (
    <Page>
      <span className="badge">Locked</span>
      <h1>Your design is sealed</h1>
      <p className="subhead">
        You cannot change the metric or the schedule now. That is what makes the verdict honest.
      </p>

      <section className="card">
        <dl className="summary">
          <div>
            <dt>Testing</dt>
            <dd>{e.substance_name}</dd>
          </div>
          <div>
            <dt>Daily measure</dt>
            <dd>
              {e.metric_name}. {directionLabel(e.metric_direction)}.
            </dd>
          </div>
          <div>
            <dt>Schedule</dt>
            <dd>
              {e.num_blocks} blocks, {e.block_length_days} days each. {e.num_active_blocks} active,{" "}
              {e.num_blocks - e.num_active_blocks} blank.
            </dd>
          </div>
          <div>
            <dt>Run length</dt>
            <dd>About {e.run_length_days} days.</dd>
          </div>
          {e.washout_note && (
            <div>
              <dt>Between blocks</dt>
              <dd>{e.washout_note}</dd>
            </div>
          )}
        </dl>
      </section>

      <button
        type="button"
        className="btn btn-primary full"
        onClick={() => navigate(`/experiments/${e.id}/prep`)}
      >
        Prepare your capsules
      </button>
    </Page>
  );
}
