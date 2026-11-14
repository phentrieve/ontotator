/**
 * Copy of the text-change dialogs (spec "Copy › Text change"); pronouns are neutral ("them").
 * `from` and `to` are version names ("v1", "v2").
 */
import { plural } from "../app/labels";

export const RELOADED_MESSAGE = "The text or the task changed. Reloaded.";
export const CHECKING = "Checking…";

export const handleTitle = (text: string): string => `Handle text change: ${text}`;
export const openWorkLine = (person: string, from: string, to: string): string => `${person} has an open annotation on ${from}. The text is now ${to}.`;
export const moveLabel = (to: string): string => `Move to ${to}`;
export const moveDescription = (person: string, fromProposals = false): string => fromProposals
  ? `${person} continues on the corrected text. Their decisions on the proposals are carried; only items in changed passages are marked “check after text change”.`
  : `${person} continues on the corrected text. Their draft findings are carried and marked “check after text change”.`;
/** Work from proposals carries decisions and findings (issue 414): the counts name both. */
const items = (count: number, fromProposals: boolean, carried = false): string => !fromProposals
  ? plural(count, carried ? "carried finding" : "finding")
  : `${count} ${carried ? "carried " : ""}${count === 1 ? "decision or finding" : "decisions and findings"}`;
export const unplacedLine = (unplaced: number, findings: number, person: string, fromProposals = false): string =>
  `${unplaced} of ${items(findings, fromProposals)} could not be placed and need ${person}’s decision.`;
export const finishLabel = (person: string, from: string): string => `Let ${person} finish on ${from}`;
export const finishDescription = (person: string, to: string): string => `When ${person} submits, the result is carried to ${to} for them to check.`;
export const WITHDRAW_LABEL = "Withdraw";
/** Issue 235: why only Withdraw is offered, in plain words, and what the lead does next. */
export const notNewerLine = (from: string, to: string): string =>
  `The correction ${from} was not accepted, so this task cannot move to ${to}. That is why Withdraw is the only choice.`;
export const nextAfterWithdrawLine = (to: string): string => `Next: click Apply to withdraw the task, then assign an annotation of ${to}.`;
export const withdrawDescription = (person: string, to: string): string => `${person}’s task ends. Nothing of the draft is carried to ${to}; ${to} needs a new annotation.`;
export const heldLine = (person: string): string => `${person}’s task is paused by a problem report. Decide the report first.`;

export const movedMessage = (person: string, to: string): string => `${person} continues on ${to}.`;
export const finishingMessage = (person: string, from: string, to: string): string =>
  `${person} finishes on ${from}. The result is carried to ${to} when they submit.`;
export const withdrawnMessage = (person: string, to: string): string => `${person}’s task is withdrawn. ${to} needs a new annotation.`;

export const carryTitle = (to: string, text: string): string => `Carry to ${to}: ${text}`;
export function submittedLine(person: string, from: string, round: number | null, findings: number | null, fromProposals = false): string {
  const facts = [round ? `Round ${round}` : null, findings != null ? items(findings, fromProposals) : null].filter(Boolean).join(", ");
  return `${person} submitted on ${from}${facts ? ` (${facts})` : ""}.`;
}
export const authorLabel = (person: string): string => `${person} (author)`;
export const authorDescription = (to: string, fromProposals = false): string => fromProposals
  ? `Their decisions on the proposals are carried to ${to}; they check only the changed passages.`
  : `Their findings are carried to ${to} for them to check.`;
export const SOMEONE_ELSE = "Someone else…";
export const someoneElseDescription = (to: string, fromProposals = false): string => fromProposals
  ? `Another annotator continues on ${to} from these decisions; only the changed passages need a check.`
  : `Another annotator continues on ${to} from this result.`;
export const ALREADY_ANNOTATING = "already annotating this text";
export const fromScratchLabel = (to: string): string => `Annotate ${to} from scratch`;
export const FROM_SCRATCH_DESCRIPTION = "Nothing is carried; the assign dialog opens next.";
export const carriedMessage = (person: string, to: string, findings: number, fromProposals = false): string =>
  `${person} continues on ${to} with ${items(findings, fromProposals, true)}.`;
/** Issue 414: a carry of work from proposals waits for the new version's proposals; that can change, so Retry is offered. */
export const noTargetProposalsLine = (to: string): string =>
  `${to} has no proposals yet: their automatic transfer may still be running, or they must be imported. Wait for or import the proposals for ${to}, then try again.`;
export const CHOOSE_PERSON = "Choose a person first.";
