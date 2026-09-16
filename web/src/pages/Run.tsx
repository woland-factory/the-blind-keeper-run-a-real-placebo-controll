import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiRequestError,
  breakBlind,
  getToday,
  submitCheckIn,
  unblind,
  type BreakBlindReveal,
  type PlaceboGuess,
  type TodayView,
} from "../api.js";
import { ErrorState, LoadingCard, Page, Segmented, Stepper } from "../components/ui.js";

type Load =
  | { status: "loading" }
  | { status: "ready"; today: TodayView }
  | { status: "error" };

/** A simple phase state: a heading, a line, and a way back. */
function PhaseCard({
  heading,
  body,
  backTo,
  backLabel,
}: {
  heading: string;
  body: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <Page>
      <section className="card">
        <h1>{heading}</h1>
        <p className="subhead">{body}</p>
        <Link className="btn btn-ghost full" to={backTo}>
          {backLabel}
        </Link>
      </section>
    </Page>
  );
}

/** The complete phase: the run is done, and the reveal is one press away. */
function CompleteCard({ id }: { id: string }) {
  const navigate = useNavigate();
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReveal() {
    if (revealing) return;
    setRevealing(true);
    setError(null);
    try {
      await unblind(id);
      navigate(`/experiments/${id}/verdict`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422) {
        // The run is no longer revealable here (voided, or a race): the summary
        // shows the right next step.
        navigate(`/experiments/${id}`);
        return;
      }
      setError("Check your connection and try again.");
      setRevealing(false);
    }
  }

  return (
    <Page>
      <section className="card">
        <h1>Your run is complete</h1>
        <p className="subhead">
          Every block is logged. The schedule stays sealed until you reveal the verdict.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary full"
          onClick={() => void onReveal()}
          disabled={revealing}
          aria-busy={revealing}
        >
          {revealing ? "Revealing…" : "Reveal the verdict"}
        </button>
        <Link className="btn btn-ghost full" to={`/experiments/${id}`}>
          Back to summary
        </Link>
      </section>
    </Page>
  );
}

/** The unblinded phase: the verdict is stored and waiting. */
function UnblindedCard({ id }: { id: string }) {
  return (
    <Page>
      <section className="card">
        <h1>Your verdict is ready</h1>
        <Link className="btn btn-primary full" to={`/experiments/${id}/verdict`}>
          See the verdict
        </Link>
        <Link className="btn btn-ghost full" to={`/experiments/${id}`}>
          Back to summary
        </Link>
      </section>
    </Page>
  );
}

/** The schedule reveal, shown once right after the user voids the run. */
function Reveal({ id, reveal }: { id?: string; reveal: BreakBlindReveal }) {
  return (
    <Page>
      <section className="card">
        <h1>Your run is voided</h1>
        <p className="subhead">Here is the schedule you were following.</p>
        <table className="sheet-table reveal-table">
          <thead>
            <tr>
              <th>Packet</th>
              <th>What it was</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {reveal.blocks.map((b) => (
              <tr key={b.code}>
                <td>{b.code}</td>
                <td>{b.contents}</td>
                <td>
                  {b.block_start_date} to {b.block_end_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link className="btn btn-ghost full" to={id ? `/experiments/${id}` : "/"}>
          Back to summary
        </Link>
      </section>
    </Page>
  );
}

const GUESS_OPTIONS: Array<{ value: PlaceboGuess; label: string }> = [
  { value: "placebo", label: "Blank" },
  { value: "active", label: "Supplement" },
  { value: "unsure", label: "Not sure" },
];

/** The metric input, chosen by the experiment's metric type. */
function MetricField({
  today,
  value,
  onChange,
}: {
  today: TodayView;
  value: number | null;
  onChange: (next: number) => void;
}) {
  if (today.metric_type === "rating_0_10") {
    return (
      <Stepper label={today.metric_name} value={value ?? 0} min={0} max={10} onChange={onChange} />
    );
  }
  if (today.metric_type === "yes_no") {
    return (
      <Segmented
        label={today.metric_name}
        options={[
          { value: 1, label: "Yes" },
          { value: 0, label: "No" },
        ]}
        value={value ?? -1}
        onChange={onChange}
      />
    );
  }
  const max = today.metric_type === "minutes" ? 1440 : 10000;
  const inputId = "metric-value";
  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>
        {today.metric_name}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
    </div>
  );
}

function RunDashboard({
  id,
  today,
  onChecked,
  onVoided,
}: {
  id: string;
  today: TodayView;
  onChecked: (next: TodayView) => void;
  onVoided: (reveal: BreakBlindReveal) => void;
}) {
  const initialValue = today.metric_type === "rating_0_10" ? 0 : null;
  const [metricValue, setMetricValue] = useState<number | null>(initialValue);
  const [guess, setGuess] = useState<PlaceboGuess | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [breaking, setBreaking] = useState(false);
  const [breakError, setBreakError] = useState<string | null>(null);

  const canSave =
    guess !== null && metricValue !== null && !Number.isNaN(metricValue) && !saving;

  async function onSave() {
    if (guess === null || metricValue === null || Number.isNaN(metricValue) || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await submitCheckIn(id, {
        metric_value: metricValue,
        note,
        placebo_guess: guess,
      });
      onChecked(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Already checked in today: reflect the done state from the server.
        try {
          onChecked(await getToday(id));
          return;
        } catch {
          // Fall through to the generic message below.
        }
      }
      setSaveError("Check your connection and try again.");
      setSaving(false);
    }
  }

  async function onBreak() {
    if (breaking) return;
    setBreaking(true);
    setBreakError(null);
    try {
      const reveal = await breakBlind(id);
      onVoided(reveal);
    } catch {
      setBreakError("Check your connection and try again.");
      setBreaking(false);
    }
  }

  return (
    <Page>
      <h1 className="visually-hidden">Your run</h1>

      <section className="today-code" aria-label="Today's packet">
        <span className="today-code-label">Open packet</span>
        <span className="today-code-value">{today.today_code}</span>
      </section>

      <p className="run-progress">
        <span>{today.sealed_day_streak} sealed days</span>
        <span>{today.days_remaining} days left</span>
      </p>

      <section className="card" aria-live="polite">
        {today.check_in_done ? (
          <>
            <h2>Checked in for today</h2>
            <p className="subhead">Come back tomorrow for the next packet.</p>
          </>
        ) : (
          <>
            <h2>Today's check-in</h2>
            <MetricField today={today} value={metricValue} onChange={setMetricValue} />
            <Segmented
              label="Your guess: was today the blank or the supplement?"
              options={GUESS_OPTIONS}
              value={guess ?? ""}
              onChange={(next) => setGuess(next as PlaceboGuess)}
            />
            <div className="field">
              <label className="field-label" htmlFor="checkin-note">
                Note (optional)
              </label>
              <textarea
                id="checkin-note"
                className="note-input"
                rows={2}
                maxLength={500}
                placeholder="Anything worth remembering about today."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {saveError && (
              <p className="field-error" role="alert">
                {saveError}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary full"
              onClick={() => void onSave()}
              disabled={!canSave}
              aria-busy={saving}
            >
              {saving ? "Saving…" : "Save check-in"}
            </button>
          </>
        )}
      </section>

      <section className="break-blind" aria-label="Break the blind">
        {confirming ? (
          <div className="card break-confirm">
            <p className="break-warn">
              Breaking the blind reveals the schedule and voids this run. You cannot undo it.
            </p>
            {breakError && (
              <p className="field-error" role="alert">
                {breakError}
              </p>
            )}
            <div className="break-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onBreak()}
                disabled={breaking}
                aria-busy={breaking}
              >
                {breaking ? "Revealing…" : "Reveal and void"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={breaking}
              >
                Keep it sealed
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
            Break the blind
          </button>
        )}
      </section>
    </Page>
  );
}

export function Run() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reveal, setReveal] = useState<BreakBlindReveal | null>(null);

  const fetchToday = useCallback(async () => {
    if (!id) return;
    setLoad({ status: "loading" });
    try {
      const today = await getToday(id);
      setLoad({ status: "ready", today });
    } catch {
      setLoad({ status: "error" });
    }
  }, [id]);

  useEffect(() => {
    void fetchToday();
  }, [fetchToday]);

  // Shown once, right after the user voids the run.
  if (reveal) {
    return <Reveal id={id} reveal={reveal} />;
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
          onAction={() => void fetchToday()}
        />
      </Page>
    );
  }

  const today = load.today;
  const backTo = id ? `/experiments/${id}` : "/";

  if (today.phase === "running") {
    return (
      <RunDashboard
        id={id!}
        today={today}
        onChecked={(next) => setLoad({ status: "ready", today: next })}
        onVoided={(r) => setReveal(r)}
      />
    );
  }
  if (today.phase === "complete") {
    return <CompleteCard id={id!} />;
  }
  if (today.phase === "voided") {
    return (
      <PhaseCard
        heading="Your run is voided"
        body="You broke the blind, so this run cannot count as evidence."
        backTo={backTo}
        backLabel="Back to summary"
      />
    );
  }
  if (today.phase === "prepped") {
    return (
      <PhaseCard
        heading="Start your run first"
        body="Prepare your capsules, then start the run."
        backTo={id ? `/experiments/${id}/prep` : "/"}
        backLabel="Prepare your capsules"
      />
    );
  }
  // unblinded: the verdict is stored and waiting.
  return <UnblindedCard id={id!} />;
}
