import { useId } from "react";
import { Checkbox, Kbd, Textarea } from "../ui";
import { chooseDecision } from "./decisionOrigin";
import { categoryLabels, clinicalChangeFacts, clinicalChangeHints, decisionDescriptions, decisionLabels, issueMessages, OFFERED_DECISIONS, rationaleHint, retiredQueryNote } from "./labels";
import type {
  ClinicalCategory,
  IssueCode,
  ReviewDecisionCode,
  ReviewForm as ReviewFormValue,
} from "./reviewRules";

export interface ReviewFormProps {
  value: Partial<ReviewFormValue>;
  issues: readonly IssueCode[];
  onChange: (next: Partial<ReviewFormValue>) => void;
  /** Radio choice; default: onChange(chooseDecision(value, decision)). The screen uses it to set origin "user". */
  onChooseDecision?: (decision: ReviewDecisionCode) => void;
  /** Failed automatic checks of the reviewed run; selects the rationale hint for Accepted unchanged. */
  failedCheckCount?: number;
  /** Text of the auto-selection note (autoNoteText), rendered as role="status" under "Accepted with corrections". */
  autoNote?: string | null;
  readOnly?: boolean;
  /** Offered decisions; default the three of OFFERED_DECISIONS with their number keys. A restricted set shows no number keys. */
  decisions?: readonly ReviewDecisionCode[];
  /** Hints that replace `decisionDescriptions` (a lead correction of an accepted version, issue 341 b). */
  descriptions?: Partial<Record<ReviewDecisionCode, string>>;
}

const allDecisions = OFFERED_DECISIONS;
const categories = Object.keys(categoryLabels) as ClinicalCategory[];

/**
 * Fields shown by state (spec A.4):
 *
 * | Decision                  | Clinically relevant change | Categories            | Rationale                 |
 * | ------------------------- | -------------------------- | --------------------- | ------------------------- |
 * | none                      | hidden                     | hidden                | hidden                    |
 * | Accepted unchanged        | hidden (*)                 | hidden (*)            | optional (**)             |
 * | Accepted with corrections | checkbox                   | when ticked, required | optional, required ticked |
 * | Query / Rejected          | fact line (always yes)     | shown, required       | shown, required           |
 *
 * (*) Shown while a stored draft sets it, so a value that blocks submission can be cleared.
 * (**) Required when automatic checks failed (R-12).
 * The rationale also stays visible whenever it holds text.
 */
export function ReviewForm({ value, issues, onChange, onChooseDecision, failedCheckCount = 0, autoNote = null, readOnly = false, decisions = allDecisions, descriptions }: ReviewFormProps) {
  const numberKeys = decisions === allDecisions;
  const id = useId();
  const decision = value.decision;
  // Issue 590: an editable draft that still holds the retired Query shows its note, not the fields of a decision.
  const queryDraft = decision === "query" && !readOnly;
  const implied = (decision === "query" && !queryDraft) || decision === "rejected";
  const clinical = implied || (!queryDraft && value.clinical_change === true);
  const chosen = !queryDraft && (value.categories?.length ?? 0) > 0;
  const showCheckbox = !implied && !queryDraft && (value.clinical_change === true || decision === "accepted_corrected");
  const showCategories = clinical || chosen;
  const showRationale = decision !== undefined || clinical || (value.rationale ?? "") !== "";

  return (
    <fieldset className="review-form" disabled={readOnly}>
      <legend className="review-sr-only">Translation review</legend>
      <fieldset className="review-decisions">
        <legend className="review-form-legend" data-decision-legend tabIndex={-1}>Decision</legend>
        {decisions.map((option, index) => [
          <label className="review-decision" htmlFor={`${id}-${option}`} key={option}>
            <input
              id={`${id}-${option}`}
              className="form-checkbox"
              type="radio"
              name={`${id}-decision`}
              value={option}
              aria-labelledby={`${id}-${option}-label`}
              aria-describedby={`${id}-${option}-hint`}
              checked={decision === option}
              onChange={() => {
                if (readOnly) return;
                if (onChooseDecision) onChooseDecision(option);
                else onChange(chooseDecision(value, option) as Partial<ReviewFormValue>);
              }}
            />
            <span className="review-decision-text">
              <span className="review-decision-label" id={`${id}-${option}-label`}>{decisionLabels[option]}</span>
              <span className="review-decision-hint" id={`${id}-${option}-hint`}>{descriptions?.[option] ?? decisionDescriptions[option]}</span>
            </span>
            {numberKeys && <Kbd>{index + 1}</Kbd>}
          </label>,
          option === "accepted_corrected" && <p key="auto-note" role="status" className="review-auto-note">{autoNote ?? ""}</p>,
        ])}
      </fieldset>
      {decision === "query" && <p className="review-fact" role="note">{retiredQueryNote}</p>}
      {implied && decision !== "query" && <p className="review-fact">{clinicalChangeFacts[decision]}</p>}
      {showCheckbox && (
        <Checkbox
          id={`${id}-clinical-change`}
          label="Clinically relevant change"
          hint={decision ? clinicalChangeHints[decision] : undefined}
          checked={value.clinical_change === true}
          onChange={(event) => {
            if (readOnly) return;
            onChange(event.target.checked
              ? { ...value, clinical_change: true }
              : { ...value, clinical_change: false, categories: [] });
          }}
        />
      )}
      {showCategories && (
        <fieldset className="review-categories" disabled={readOnly || !clinical}>
          <legend className="review-form-legend">Clinical change categories</legend>
          <p className="review-form-hint">Choose at least one.</p>
          {categories.map((category) => (
            <Checkbox
              key={category}
              id={`${id}-category-${category}`}
              label={categoryLabels[category]}
              checked={value.categories?.includes(category) ?? false}
              onChange={(event) => {
                if (readOnly || !clinical) return;
                const current = value.categories ?? [];
                const next = event.target.checked
                  ? [...current.filter((item) => item !== category), category]
                  : current.filter((item) => item !== category);
                onChange({ ...value, categories: next });
              }}
            />
          ))}
        </fieldset>
      )}
      {showRationale && (
        <Textarea
          id={`${id}-rationale`}
          label="Rationale"
          hint={rationaleHint(decision, clinical, failedCheckCount)}
          rows={3}
          value={value.rationale ?? ""}
          onChange={(event) => {
            if (!readOnly) onChange({ ...value, rationale: event.target.value });
          }}
        />
      )}
      {issues.length > 0 && (
        <ol className="review-issues" aria-label="Review issues">
          {issues.map((issue, index) => <li key={`${issue}-${index}`}>{issueMessages[issue]}</li>)}
        </ol>
      )}
    </fieldset>
  );
}
