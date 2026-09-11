import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createExperiment,
  getTemplates,
  previewDesign,
  type MetricDirection,
  type MetricType,
  type Preview,
  type Template,
} from "../api.js";
import { ErrorState, LoadingCard, Page, Segmented, Stepper } from "../components/ui.js";

const METRIC_TYPE_OPTIONS: Array<{ value: MetricType; label: string }> = [
  { value: "rating_0_10", label: "Rating 0 to 10" },
  { value: "minutes", label: "Minutes" },
  { value: "count", label: "Count" },
  { value: "yes_no", label: "Yes or no" },
];

const DIRECTION_OPTIONS: Array<{ value: MetricDirection; label: string }> = [
  { value: "higher_better", label: "Higher is better" },
  { value: "lower_better", label: "Lower is better" },
];

const BLOCK_COUNT_OPTIONS = [
  { value: 6, label: "6" },
  { value: 8, label: "8" },
  { value: 10, label: "10" },
  { value: 12, label: "12" },
];

const WALK_DONE_KEY = "bk_walk_done";

function formatP(p: number): string {
  return p.toLocaleString("en-US", { maximumSignificantDigits: 2 });
}

type LoadState = "loading" | "ready" | "error";

export function Design() {
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [templates, setTemplates] = useState<Template[]>([]);

  const [substanceName, setSubstanceName] = useState("");
  const [metricName, setMetricName] = useState("");
  const [metricType, setMetricType] = useState<MetricType>("rating_0_10");
  const [metricDirection, setMetricDirection] = useState<MetricDirection>("higher_better");
  const [blockLengthDays, setBlockLengthDays] = useState(5);
  const [numBlocks, setNumBlocks] = useState(6);
  const [washoutNote, setWashoutNote] = useState("Skip 1 day between blocks.");
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [walkDone, setWalkDone] = useState(true);

  useEffect(() => {
    setWalkDone(localStorage.getItem(WALK_DONE_KEY) === "1");
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoadState("loading");
    try {
      const list = await getTemplates();
      setTemplates(list);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // Live power statement: recompute on discrete control changes, debounced so
  // the control values themselves stay instant.
  useEffect(() => {
    if (loadState !== "ready") return;
    const controller = new AbortController();
    setPreviewing(true);
    const handle = setTimeout(async () => {
      try {
        const result = await previewDesign(
          {
            substance_name: substanceName.trim() || undefined,
            metric_type: metricType,
            block_length_days: blockLengthDays,
            num_blocks: numBlocks,
            template_id: templateId,
          },
          controller.signal
        );
        setPreview(result);
      } catch {
        // Keep the last good value on a transient failure.
      } finally {
        setPreviewing(false);
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [loadState, substanceName, metricType, blockLengthDays, numBlocks, templateId]);

  function applyTemplate(t: Template) {
    setSubstanceName(t.substance_name);
    setMetricName(t.metric_name);
    setMetricType(t.metric_type);
    setMetricDirection(t.metric_direction);
    setBlockLengthDays(t.block_length_days);
    setNumBlocks(t.num_blocks);
    setWashoutNote(t.washout_note);
    setTemplateId(t.id);
  }

  const blocked = preview?.safety.blocked ?? false;
  const canLock =
    !submitting &&
    acknowledged &&
    substanceName.trim().length > 0 &&
    metricName.trim().length > 0 &&
    !blocked;

  function finishWalk() {
    localStorage.setItem(WALK_DONE_KEY, "1");
    setWalkDone(true);
  }

  async function onLock() {
    if (!canLock) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createExperiment({
        substance_name: substanceName.trim(),
        metric_name: metricName.trim(),
        metric_type: metricType,
        metric_direction: metricDirection,
        block_length_days: blockLengthDays,
        num_blocks: numBlocks,
        washout_note: washoutNote.trim(),
        acknowledged,
      });
      finishWalk();
      navigate(`/experiments/${created.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return (
      <Page>
        <LoadingCard />
      </Page>
    );
  }
  if (loadState === "error") {
    return (
      <Page>
        <ErrorState
          title="We could not load this page."
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void loadTemplates()}
        />
      </Page>
    );
  }

  return (
    <Page>
      <h1>Design your blind test</h1>
      <p className="safety-line" role="note">
        Supplements and behavior only, not prescription drugs. This is not medical advice.
      </p>

      {!walkDone && (
        <div className="card walk" aria-label="Getting started">
          <ol className="walk-steps">
            <li className={substanceName.trim() ? "done" : ""}>
              Pick a template or name what you are testing.
            </li>
            <li className={acknowledged ? "done" : ""}>
              Confirm this is a supplement, not a prescription drug.
            </li>
            <li>Lock your design to seal it.</li>
          </ol>
          <button type="button" className="btn btn-ghost walk-skip" onClick={finishWalk}>
            Skip
          </button>
        </div>
      )}

      <section className="card">
        <span className="field-label">Start from a template</span>
        <div className="chips">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip${templateId === t.id ? " chip-active" : ""}`}
              aria-pressed={templateId === t.id}
              onClick={() => applyTemplate(t)}
            >
              {t.substance_name}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="substance">What are you testing?</label>
          <input
            id="substance"
            value={substanceName}
            placeholder="Theanine"
            autoComplete="off"
            onChange={(e) => setSubstanceName(e.target.value)}
          />
          {blocked && (
            <p className="field-error" role="alert">
              {substanceName.trim()} looks like a prescription drug. This app is for supplements and
              behavior changes. Choose something else.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="metric">What will you measure each day?</label>
          <input
            id="metric"
            value={metricName}
            placeholder="Afternoon focus"
            autoComplete="off"
            onChange={(e) => setMetricName(e.target.value)}
          />
        </div>

        <Segmented
          label="Kind of score"
          options={METRIC_TYPE_OPTIONS}
          value={metricType}
          onChange={setMetricType}
        />
        <Segmented
          label="Which way is better?"
          options={DIRECTION_OPTIONS}
          value={metricDirection}
          onChange={setMetricDirection}
        />

        <Stepper
          label="Days per block"
          value={blockLengthDays}
          min={3}
          max={14}
          onChange={setBlockLengthDays}
        />
        <Segmented
          label="Number of blocks"
          options={BLOCK_COUNT_OPTIONS}
          value={numBlocks}
          onChange={setNumBlocks}
        />
      </section>

      <section className="card power" aria-live="polite">
        <div className={`power-body${previewing ? " power-updating" : ""}`}>
          {preview ? (
            <>
              <p className="power-run">This runs about {preview.run_length_days} days.</p>
              <p className="power-stmt">
                With {numBlocks} blocks you can spot a change of about {preview.mde}{" "}
                {preview.mde_units}. The best p-value this design can reach is{" "}
                {formatP(preview.p_value_floor)}.
              </p>
              {!preview.can_reach_significance && (
                <p className="field-error">
                  This design cannot reach a clear result. Add blocks so the test can decide.
                </p>
              )}
              <p className="fine-print">
                A short run can miss a small effect. Setting this before you start is what keeps the
                answer honest.
              </p>
            </>
          ) : (
            <div className="skeleton skeleton-line" />
          )}
        </div>
      </section>

      <section className="card">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I understand this tests a supplement or a behavior change, not a prescription drug, and is
            not medical advice.
          </span>
        </label>

        {submitError && (
          <p className="field-error" role="alert">
            {submitError}
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary lock-btn"
          onClick={() => void onLock()}
          disabled={!canLock}
          aria-busy={submitting}
        >
          {submitting ? "Locking…" : "Lock and pre-register"}
        </button>
      </section>
    </Page>
  );
}
