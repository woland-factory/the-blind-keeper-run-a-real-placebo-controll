import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { confirmPrep, getPrep, type PrepView } from "../api.js";
import { ErrorState, LoadingCard, Page } from "../components/ui.js";
import { markWalkDone } from "../walk.js";

type Load =
  | { status: "loading" }
  | { status: "ready"; prep: PrepView }
  | { status: "error" };

// The batch-to-contents link, stated once, naming no code.
function batchLinkText(prep: PrepView): string {
  const batch1 = prep.batches.find((b) => b.label === "Batch 1");
  const substanceInBatch1 = batch1?.contents === prep.substance_name;
  return substanceInBatch1
    ? `Put your ${prep.substance_name} capsules in Batch 1 and your blank capsules in Batch 2.`
    : `Put your blank capsules in Batch 1 and your ${prep.substance_name} capsules in Batch 2.`;
}

function PrepSheet({ prep }: { prep: PrepView }) {
  return (
    <section className="prep-sheet" aria-label="Prep sheet">
      <h2>Prep sheet</h2>
      <p>Fill each packet with the listed count, seal it, and write its code on it.</p>
      <table className="sheet-table">
        <thead>
          <tr>
            <th>Packet</th>
            <th>Batch</th>
            <th>Capsules</th>
          </tr>
        </thead>
        <tbody>
          {prep.packets.map((p) => (
            <tr key={p.code}>
              <td>{p.code}</td>
              <td>{p.batch}</td>
              <td>{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sheet-note">This sheet hides which batch is which, so you stay blind.</p>
    </section>
  );
}

function StartedState({ id, heading, body }: { id?: string; heading: string; body: string }) {
  return (
    <Page>
      <section className="card">
        <h1>{heading}</h1>
        <p className="subhead">{body}</p>
        <Link className="btn btn-ghost full" to={id ? `/experiments/${id}` : "/"}>
          Back to summary
        </Link>
      </section>
    </Page>
  );
}

export function Prep() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [stepIndex, setStepIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const fetchPrep = useCallback(async () => {
    if (!id) return;
    setLoad({ status: "loading" });
    try {
      const prep = await getPrep(id);
      setLoad({ status: "ready", prep });
    } catch {
      setLoad({ status: "error" });
    }
  }, [id]);

  useEffect(() => {
    void fetchPrep();
  }, [fetchPrep]);

  // A run that already started (here or on another device) is a first success
  // too, so clear the guided walk when we land on a run past prep.
  useEffect(() => {
    if (load.status === "ready" && load.prep.status !== "prepped") {
      markWalkDone();
    }
  }, [load]);

  // The guiding steps, built from the fetched prep. The confirm step is the last
  // step and is rendered specially, so total = guidance steps + 1.
  const steps = useMemo(() => {
    if (load.status !== "ready") return [];
    const prep = load.prep;
    const list: string[] = [
      `Make ${prep.substance_name} capsules and blank capsules that look the same.`,
      batchLinkText(prep),
    ];
    for (const p of prep.packets) {
      list.push(`Put ${p.count} capsules from ${p.batch} into a packet, seal it, and write ${p.code} on it.`);
    }
    list.push("Drop every sealed packet into a bag and shuffle it well.");
    return list;
  }, [load]);

  async function onStart() {
    if (!id || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await confirmPrep(id);
      // First success: the guided first-run walk is complete once a real run
      // starts. Clear it so it never appears again for this browser.
      markWalkDone();
      setStarted(true);
    } catch {
      setStartError("Check your connection and try again.");
      setStarting(false);
    }
  }

  if (load.status === "loading") {
    return (
      <Page>
        <LoadingCard />
      </Page>
    );
  }
  if (load.status === "error") {
    return (
      <Page>
        <ErrorState
          title="We could not load this page."
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void fetchPrep()}
        />
      </Page>
    );
  }

  // Confirmed in this session.
  if (started) {
    return (
      <StartedState
        id={id}
        heading="Your run starts today"
        body="Come back each day for the packet to open. We hold the schedule so you stay blind."
      />
    );
  }

  // Opened after the run already started: the fill map is sealed for good, so
  // do not re-enter prep as if unstarted.
  if (load.prep.status !== "prepped") {
    return (
      <StartedState
        id={id}
        heading="Your run is already going"
        body="Come back each day for the packet to open."
      />
    );
  }

  const prep = load.prep;
  const total = steps.length + 1;
  const onConfirmStep = stepIndex === steps.length;
  const stepNumber = stepIndex + 1;

  return (
    <>
      <Page>
        <div className="prep-live">
          <h1>Prepare your capsules</h1>
          <p className="step-counter">
            Step {stepNumber} of {total}
          </p>

          <section className="card prep-step" aria-live="polite">
            {onConfirmStep ? (
              <>
                <p className="prep-lead">
                  You are ready. Starting the run sets your schedule and keeps it sealed.
                </p>
                {startError && (
                  <p className="field-error" role="alert">
                    {startError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary full"
                  onClick={() => void onStart()}
                  disabled={starting}
                  aria-busy={starting}
                >
                  {starting ? "Starting…" : "Start the run"}
                </button>
              </>
            ) : (
              <p className="prep-step-text">{steps[stepIndex]}</p>
            )}
          </section>

          <div className="prep-nav">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
            >
              Back
            </button>
            {!onConfirmStep && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStepIndex((i) => Math.min(steps.length, i + 1))}
              >
                Next
              </button>
            )}
          </div>

          <button type="button" className="btn btn-ghost prep-print" onClick={() => window.print()}>
            Print prep sheet
          </button>
        </div>
      </Page>
      <PrepSheet prep={prep} />
    </>
  );
}
