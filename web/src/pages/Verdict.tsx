import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError, getVerdict, type VerdictView } from "../api.js";
import { ErrorState, LoadingCard, Page } from "../components/ui.js";

type Load =
  | { status: "loading" }
  | { status: "ready"; view: VerdictView }
  | { status: "error" };

/** The effect stat: a signed number so a drop reads as a drop. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** p to three decimals, or the small-number form. */
function formatStatP(p: number): string {
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

/** The blind-integrity reading. Null when there is nothing to score. */
function blindLine(view: VerdictView): string | null {
  const v = view.verdict;
  if (v.guess_days_scored === 0) return null;
  if (v.blind_integrity_flag && v.significant) {
    return "You also guessed the days better than chance. Some of the gap may be expectation rather than the capsule. Weigh the result with that in mind.";
  }
  if (v.blind_integrity_flag && !v.significant) {
    return "You guessed the days better than chance, so the blind may have leaked. Treat this run's numbers with extra doubt.";
  }
  return "The blind held: your guesses stayed near chance.";
}

export function Verdict() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchVerdict = useCallback(async () => {
    if (!id) return;
    setLoad({ status: "loading" });
    try {
      const view = await getVerdict(id);
      setLoad({ status: "ready", view });
    } catch (err) {
      // A sealed run has no verdict yet: the summary's affordances take over.
      if (err instanceof ApiRequestError && err.status === 422) {
        navigate(`/experiments/${id}`, { replace: true });
        return;
      }
      setLoad({ status: "error" });
    }
  }, [id, navigate]);

  useEffect(() => {
    void fetchVerdict();
  }, [fetchVerdict]);

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
          onAction={() => void fetchVerdict()}
        />
      </Page>
    );
  }

  const { view } = load;
  const v = view.verdict;
  const hasEffect = v.effect_estimate !== null && v.permutation_p_value !== null;
  const blind = blindLine(view);

  return (
    <Page>
      <h1>Your verdict</h1>
      <p className="subhead">
        {view.substance_name}. {view.run_length_days} days, sealed until now.
      </p>

      <section className="card verdict-card">
        <h2>What the data says</h2>
        <p className="reveal-lead">{v.verdict_text}</p>
        {hasEffect && (
          <p className="stat-row">
            <span>
              Effect {signed(v.effect_estimate as number)} {v.effect_units}
            </span>
            <span>{formatStatP(v.permutation_p_value as number)}</span>
          </p>
        )}
      </section>

      <section className="card verdict-card">
        <h2>Could you feel it?</h2>
        <p className="reveal-lead">{v.guess_text}</p>
        {v.guess_days_unsure > 0 && (
          <p className="fine-print">{v.guess_days_unsure} unsure days sit out of the guess score.</p>
        )}
      </section>

      {blind && <p className="blind-line">{blind}</p>}
      <p className="adherence-line">
        You logged {v.days_logged} of {view.run_length_days} days.
      </p>

      <section className="card">
        <h2>How much this run could see</h2>
        <p>{v.power_note}</p>
      </section>

      <section className="card">
        <h2>The schedule, unsealed</h2>
        <table className="sheet-table reveal-table">
          <thead>
            <tr>
              <th>Packet</th>
              <th>What it was</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {view.blocks.map((b) => (
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
      </section>

      <Link className="btn btn-ghost full" to={id ? `/experiments/${id}` : "/"}>
        Back to summary
      </Link>
    </Page>
  );
}
