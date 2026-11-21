import type { TaskSummary } from "../api/client";
import { taskText } from "../app/identity";
import type { ClinicalCategory, IssueCode, ReviewDecisionCode } from "./reviewRules";
import { formatTime } from "../app/submissionLabels";

/** English presentation keyed by domain codes, ready for later translation. */
export const decisionLabels: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "Accepted unchanged",
  accepted_corrected: "Accepted with corrections",
  query: "Query",
  rejected: "Rejected",
};

/**
 * Issue 553 (prototype): the decisions a reviewer chooses from. Query is no longer offered: a question goes to the
 * lead through "Ask the lead" and the review stays open. Reviews submitted as Query keep their label in history.
 */
export const OFFERED_DECISIONS: readonly ReviewDecisionCode[] = ["accepted_unchanged", "accepted_corrected", "rejected"];
/** Under the decisions, while an older draft still holds Query. */
export const retiredQueryNote = "Query is no longer a decision. Choose one of the decisions above. To ask the lead, use Ask the lead: your review stays open.";
/** Next to a submitted review that was a Query. */
export const retiredQueryHistory = "No longer offered. Questions now go to the lead with Ask the lead.";

export const categoryLabels: Readonly<Record<ClinicalCategory, string>> = {
  omission: "Omission",
  addition: "Addition",
  assertion: "Negation or certainty",
  value: "Number or unit",
  anatomy: "Anatomy or laterality",
  terminology: "Terminology",
  source: "Problem in the source",
};

export const issueMessages: Readonly<Record<IssueCode, string>> = {
  TEXT_EMPTY: "The proposed text must not be empty.",
  TEXT_CHANGED: "You edited the text. Choose Accepted with corrections, or undo your edits.",
  CLINICAL_CHANGE_NOT_ALLOWED: "Accepted unchanged cannot include a clinical change.",
  TEXT_UNCHANGED: "Accepted with corrections needs changed text.",
  CLINICAL_CHANGE_REQUIRED: "A query or rejection needs a clinical change.",
  CATEGORY_REQUIRED: "A clinical change needs a category.",
  RATIONALE_REQUIRED: "A clinical change needs a rationale.",
  CHECK_RATIONALE_REQUIRED: "An automatic check failed. Say in the rationale why you accept the translation unchanged.",
  CATEGORIES_WITHOUT_CHANGE: "Categories need a clinical change.",
};

/** Issue codes only the server reports (no client-side counterpart in checkReview). */
const serverIssueMessages: Readonly<Record<string, string>> = {
  LEAD_CORRECTION_DECISION: "A lead correction is submitted as Accepted with corrections.",
};

/** Message for an issue code from a REVIEW_INVALID refusal; unknown codes stay visible as codes. */
export function reviewIssueMessage(code: string): string {
  if (Object.prototype.hasOwnProperty.call(issueMessages, code)) return issueMessages[code as IssueCode];
  if (Object.prototype.hasOwnProperty.call(serverIssueMessages, code)) return serverIssueMessages[code];
  return `Review issue: ${code}`;
}

/** Lead-correction mode (spec F1): the lead submits only Accepted with corrections. */
export const leadCorrectionNote = "You are correcting this translation as project lead.";
export const leadCorrectionKeyHint = "Ctrl + Enter submits";
/** Issue 341 b: the lead's correction of an accepted version becomes a new version that is reviewed again. */
export const acceptedCorrection = {
  note: "You are correcting this accepted translation as project lead. The corrected text becomes a new version that is reviewed again.",
  /** A further correction after the lead's corrected version was rejected or queried. */
  noteNotAccepted: "You are correcting this translation as project lead. The corrected text becomes a new version that is reviewed again.",
  description: "Your corrected version is reviewed again.",
  consequence: "Your corrected text will be saved as a new version, which starts as a correction with review On. This version stays accepted, and the annotation work on it stays here.",
  consequenceNotAccepted: "Your corrected text will be saved as a new version, which starts as a correction with review On.",
  outcome: "Your corrected text was saved as a new version. It is reviewed again before annotation.",
} as const;

/** Short hint shown under each decision option; the confirmation dialog keeps `decisionConsequences`. */
export const decisionDescriptions: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "Correct as it stands. No edits.",
  accepted_corrected: "Your corrected version is accepted.",
  query: "Meaning may differ clinically. Not accepted.",
  rejected: "Changes clinical meaning. Not accepted.",
};

/** Query and Rejected always mean a clinically relevant change; this line replaces the checkbox for them. */
export const clinicalChangeFacts: Readonly<Record<"query" | "rejected", string>> = {
  query: "Clinically relevant change: yes, always for a query.",
  rejected: "Clinically relevant change: yes, always for a rejection.",
};

/** Hint under "Rationale"; it asks for a note when Accepted unchanged overrides failed checks. */
export function rationaleHint(decision: ReviewDecisionCode | undefined, clinical: boolean, failedCheckCount: number): string {
  if (clinical) return "Required for a clinically relevant change.";
  if (decision === "accepted_unchanged" && failedCheckCount > 0) return "Required: an automatic check failed. Say why the flagged difference is correct.";
  return "Optional.";
}

export const decisionKeyHint = "Ctrl + Enter submits, 1–3 choose a decision outside the text";

/** What submitting each decision will do, for the confirmation dialog. */
export const decisionConsequences: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "The translation will be accepted unchanged and becomes available for annotation.",
  accepted_corrected: "Your corrected text will be saved as a new version, which is accepted and becomes available for annotation. The machine translation stays as it was.",
  query: "The translation will be marked as reviewed with a query. It will not be accepted for annotation.",
  rejected: "The translation will be marked as reviewed and rejected. It will not be accepted for annotation.",
};

/** What submitting did, for the success message. */
export const decisionOutcomes: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "The translation was accepted unchanged and is available for annotation.",
  accepted_corrected: "Your corrected text was saved as a new version, which is accepted for annotation.",
  query: "The translation is marked as reviewed with a query. It is not accepted for annotation.",
  rejected: "The translation is marked as reviewed and rejected. It is not accepted for annotation.",
};

/** The "Next task" button after submitting (spec A.5). */
export function nextTaskLabel(task: Pick<TaskSummary, "case_id" | "external_id" | "document_id" | "language" | "version" | "origin">): string {
  return `Next task: ${taskText(task)}`;
}

/**
 * The next task after a translation review when it is the reviewer's own annotation task on the same text, whose
 * translation is finished for annotation (accepted, nothing else pending).
 */
export const annotateThisTextLabel = "Annotate this text now";

/** Open tasks left in the project after submitting, besides the one just submitted. */
export function remainingTasksText(count: number): string {
  if (count <= 0) return "No more open tasks in this project.";
  return `${count} more open ${count === 1 ? "task" : "tasks"} in this project.`;
}

/** Hint under "Clinically relevant change", following the review rules for each decision (the checkbox is shown for the Accepted decisions only). */
export const clinicalChangeHints: Readonly<Record<ReviewDecisionCode, string>> = {
  accepted_unchanged: "Not allowed with Accepted unchanged. Clear it or choose another decision.",
  accepted_corrected: "Tick this if your correction changes the clinical meaning.",
  query: "Required for a query.",
  rejected: "Required for a rejection.",
};

const humanize = (code: string): string => {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unnamed check";
};

/** Known automatic translation check codes; unknown codes are turned into words. */
export const checkLabels: Readonly<Record<string, string>> = {
  units_added: "Units added in translation",
  numbers_changed: "Numbers changed in translation",
};

export function checkLabel(code: unknown): string {
  const value = typeof code === "string" ? code : "";
  return Object.prototype.hasOwnProperty.call(checkLabels, value) ? checkLabels[value] : humanize(value);
}

/** Draft explanations; confirmed by the maintainer before release. */
export const checkExplanations: Readonly<Record<string, string>> = {
  units_added: "The translation run's check found a unit of measurement in the translation that it did not find in the source.",
  numbers_changed: "The translation run's check found numbers in the translation that differ from those in the source.",
};
export const unknownCheckExplanation = "The translation run reported this check as failed. Ontotator has no description for it; ask the project lead what it checks.";
export const checkNoLocation = "It does not point to a text location; compare the texts yourself.";

const valueCheckCodes: ReadonlySet<string> = new Set(["units_added", "numbers_changed"]);
/** What to do when a check failed but the translation is right; only number and unit checks name the category. */
export function checkDeviationGuidance(code: string): string {
  const start = "Choose Accepted unchanged (or Accepted with corrections if you edited it). You can say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected";
  return valueCheckCodes.has(code) ? `${start} with the category Number or unit.` : `${start}.`;
}

export function checkExplanation(code: string): string {
  return Object.hasOwn(checkExplanations, code) ? checkExplanations[code] : unknownCheckExplanation;
}

/**
 * Ontotator's own check of the reviewed version (issue 484): more passages in brackets than the source has. It is
 * no check of the translation run: it is not counted with them and asks for no rationale.
 */
export const addedBrackets = {
  band: "More passages in brackets than in the source:",
  counts: (translation: number, source: number): string => `${translation} in the translation, ${source} in the source`,
  title: "Passages in brackets added in translation",
  explanation: "Ontotator compared this version with the source. A translation sometimes adds a second name in brackets, for example a lay term followed by the Latin or English term. One finding is then named twice. Found:",
  passagesTerm: "Passages in brackets that the source does not have in this form",
  truncated: "There are more; only the first ones are listed.",
  addedTerm: "If the translation added a passage",
  addedAdvice: "Remove it and choose Accepted with corrections. If you are not sure, choose Query with the category Addition.",
  rightTerm: "If the passages are right",
  rightAdvice: "Decide as usual. This check asks for no rationale.",
} as const;

export function failedChecksTitle(count: number): string {
  return count === 1 ? "1 automatic check failed" : `${count} automatic checks failed`;
}

/** Check label without "in translation", for lists of several checks; unknown codes keep `checkLabel`. */
export function shortCheckLabel(code: unknown): string {
  const label = checkLabel(code);
  return typeof code === "string" && Object.hasOwn(checkLabels, code) ? label.replace(/ in translation$/, "") : label;
}

/** One-line summary of failed checks: "{n} automatic check(s) failed: {labels}". */
export function checkBandText(failedCodes: readonly string[]): string {
  const count = failedCodes.length;
  if (count === 1) return `1 automatic check failed: ${checkLabel(failedCodes[0])}`;
  const [first, second] = failedCodes.map(shortCheckLabel);
  const labels = count === 2 ? `${first} and ${second}` : `${first}, ${second} and ${count - 2} more`;
  return `${count} automatic checks failed: ${labels}`;
}

export function calmCheckText(count: number): string {
  return count === 1 ? "1 automatic check passed." : `All ${count} automatic checks passed.`;
}

export function allChecksLine(passed: number, failed: number, ofVersion?: number): string {
  return `${ofVersion === undefined ? "All checks" : `Checks of v${ofVersion}`}: ${passed} passed, ${failed} failed`;
}

/**
 * The checks band of a version after the first: the automatic checks ran on the translation run's text (`checked`,
 * usually v1), not on the reviewed `version`, so a failed one is named as a check of that version and asks for nothing.
 */
export function earlierChecksText(checked: number, version: number, failedCodes: readonly string[]): string {
  const start = `The automatic checks ran on v${checked}, not on this version (v${version}).`;
  if (failedCodes.length === 0) return start;
  const failed = checkBandText(failedCodes).replace(/ failed: /, ` failed on v${checked}: `);
  return `${start} ${failed}.`;
}

/** "Submit this review?" while a source update of the translation is open: the ordinary submit does not resolve it. */
export function sourceUpdatesOpenTitle(count: number): string {
  return count === 1 ? "1 source update is not reviewed." : `${count} source updates are not reviewed.`;
}
export const sourceUpdatesOpenText = "The source text was updated after this translation was made. Submitting here accepts the translation against the original source and leaves the update open; this review can then no longer resolve it, and the lead has to assign another review. To check the translation against the updated source with this review, click Review source update.";

/** What the reviewer's text is compared with: the first version of a machine translation, else the version they were given. */
export function baselineName(variant: { origin: string }): string {
  return variant.origin === "machine_translation" ? "the machine translation" : "the version you were given";
}

/** The note under the translation: what the marks mean, and for a later version where its own changes are shown. */
export function translationNote(variant: { origin: string; version: number }, state: "changes" | "edited" | "same", previous?: number): string {
  const baseline = baselineName(variant);
  if (variant.origin === "machine_translation")
    return state === "changes" ? `Showing changes against ${baseline}. Turn off Show changes to edit.` : state === "edited" ? `Underlined text differs from ${baseline}.` : `Same as ${baseline}.`;
  const compare = previous === undefined ? "" : ` Compare shows what changed since v${previous}.`;
  return state === "changes" ? `Showing your changes against ${baseline} (v${variant.version}). Turn off Show changes to edit.${compare}`
    : `${state === "edited" ? "Underlined text differs from" : "Same as"} ${baseline} (v${variant.version}).${compare}`;
}

/** What follows a decision; a corrected text never changes the version it was made from. */
export function decisionConsequence(decision: ReviewDecisionCode, variant: { origin: string }): string {
  return decisionConsequences[decision].replace("The machine translation stays", `${baselineName(variant).replace(/^t/, "T")} stays`);
}

/** "12 November 2026" from a calendar date ("2026-11-12"), without a time zone shift. */
function calendarDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

const uploadMethodWords: Readonly<Record<string, string>> = {
  machine_translation: "Machine translation", human_translation: "Human translation", manual_correction: "Corrected by hand",
};
export interface VersionOriginFacts {
  kind: "upload" | "review_correction" | "lead_correction" | "editorial_correction" | "correction"; previous_version: number; at?: string | null;
  method?: string | null; provider?: string | null; model?: string | null; made_on?: string | null; made_by?: string | null; note?: string | null;
}
/**
 * "Translation details" of a version after the first: how this version was made, by whom and when, never the
 * translation run of the first version. Rows of term and value, in reading order.
 */
export function versionOriginRows(origin: VersionOriginFacts): [string, string][] {
  const rows: [string, string][] = [];
  if (origin.kind === "upload") {
    rows.push(["This version", [uploadMethodWords[origin.method ?? ""] ?? "Uploaded text", origin.provider?.trim(), origin.model?.trim()].filter(Boolean).join(", ")]);
    rows.push(["Uploaded", ["by the project lead", origin.at ? `on ${formatTime(origin.at)}` : null].filter(Boolean).join(" ")]);
    const made = [origin.made_on ? `on ${calendarDay(origin.made_on)}` : null, origin.made_by?.trim() ? `by ${origin.made_by.trim()}` : null].filter(Boolean).join(" ");
    if (made) rows.push(["Made", made]);
    if (origin.note?.trim()) rows.push(["Note", origin.note.trim()]);
  } else if (origin.kind === "editorial_correction") {
    // "Fix typos…": spacing, typos or grammar fixed by a lead without a review; the note is the recorded reason.
    rows.push(["This version", `Typos fixed by the project lead${origin.at ? ` on ${formatTime(origin.at)}` : ""}`]);
    if (origin.note?.trim()) rows.push(["What was fixed", origin.note.trim()]);
  } else {
    rows.push(["This version", origin.kind === "lead_correction" ? "Corrected by the project lead" : origin.kind === "review_correction" ? "Corrected in a translation review" : "Correction"]);
    if (origin.at) rows.push(["Corrected", `on ${formatTime(origin.at)}`]);
  }
  rows.push(["Version before", `v${origin.previous_version}`]);
  return rows;
}

/** Translation status of a document after a review, in words. */
export const translationStatusWords: Readonly<Record<string, string>> = {
  translated: "Translated",
  automatic_check_failed: "Automatic check failed",
  ready_for_review: "Ready for review",
  reviewed: "Reviewed",
  accepted: "Accepted",
};

export function translationStatusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(translationStatusWords, status) ? translationStatusWords[status] : humanize(status);
}

export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Coupled scrolling notes (editor-axes-and-coupled-scroll spec 2.6). */
export const couplingNote = "Paragraphs are paired by position, not by meaning. Merged or split paragraphs shift the pairing.";
export const couplingEditingNote = "While you edit, only the other texts follow your translation.";
export function paragraphCountsDiffer(source: number, translation: number): string {
  return `Paragraphs differ (source ${source}, translation ${translation}); the other text may show a neighbouring paragraph.`;
}
export function comparisonCountsDiffer(translation: number, comparison: number): string {
  return `Paragraphs differ (translation ${translation}, comparison ${comparison}); the other text may show a neighbouring paragraph.`;
}
export function paragraphCountChanged(before: number, after: number): string {
  return `Your edits changed the number of paragraphs (${before} → ${after}). Pairing after that point may be off.`;
}
export const showMatchingLabel = "Show matching paragraph";
export const showMatchingTitle = "Scroll the other text to the paragraph paired with the one at your cursor or the one you clicked.";
export const showMatchingShortcut = "Show the paragraph paired with the one at your cursor";
const paneWords: Record<string, string> = { source: "source", target: "translation", comparison: "comparison" };
/**
 * Result of "Show matching paragraph" for the polite status (spec 2.6), e.g. "Source paragraph 4 is shown next to
 * translation paragraph 4."; several shown panes are joined with "and". Paragraph numbers are zero-based here.
 */
export function matchingParagraphStatus(anchor: { paneId: string; paragraph: number }, shown: ReadonlyArray<{ paneId: string; paragraph: number }>, estimate: boolean): string {
  const phrase = ({ paneId, paragraph }: { paneId: string; paragraph: number }) => `${paneWords[paneId] ?? paneId} paragraph ${paragraph + 1}`;
  const list = shown.map(phrase).join(" and ");
  const sentence = `${list.charAt(0).toUpperCase()}${list.slice(1)} ${shown.length > 1 ? "are" : "is"} shown next to ${phrase(anchor)}.`;
  return estimate ? `${sentence} Paragraph counts differ, so this is an estimate.` : sentence;
}
