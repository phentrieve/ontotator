import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { Button, Dialog, InlineMessage } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { SettingsCard } from "./SettingsCard";

/**
 * Kinds of work in plain words, from the tables `PROJECT_HAS_WORK` names in `details.work` (issue 191). Several tables
 * are one kind; the order is the order of the sentence. A table not listed here is "other work".
 */
const WORK_KINDS: readonly (readonly [string, readonly string[]])[] = [
  ["texts", ["documents"]],
  ["tool proposals", ["proposal_sets", "proposal_annotations", "proposal_evidence", "empty_proposal_sets"]],
  ["tasks", ["assignments", "task_holds"]],
  ["drafts", ["drafts", "draft_snapshots", "annotation_snapshots", "evidence_snapshots", "edit_events", "search_events"]],
  ["submissions", ["submissions", "discarded_submissions", "discarded_variants"]],
  ["work rounds", ["work_rounds", "round_inputs", "round_submission_bindings", "round_workspace_bindings"]],
  ["translation reviews", ["translation_reviews", "translation_acceptances", "review_obligation_resolutions"]],
  ["text changes", ["text_change_resolutions"]],
  ["annotation mode changes", ["annotation_mode_changes"]],
  ["a work plan", ["work_plans", "work_plan_rows"]],
  ["a guideline", ["guideline_versions", "guideline_contents", "guideline_reads", "guideline_withdrawals"]],
  ["problem reports", ["problem_reports", "problem_report_events"]],
  ["final results", ["final_selections", "final_selection_events", "export_selection_snapshots"]],
  ["working time", ["work_intervals", "work_time_events"]],
  ["workflow commands", ["workflow_command_receipts"]],
  ["a committed upload", ["uploads"]],
];

/** "a", "a and b", "a, b and c". */
const listText = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * The refusal of a project with work, naming its kinds of work: "This project has texts, tasks and a guideline, so it
 * cannot be deleted." Null when the error is no `PROJECT_HAS_WORK` with a list of tables (the generic message applies).
 */
export function projectWorkText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== "PROJECT_HAS_WORK" || typeof error.details !== "object") return null;
  const work = error.details.work;
  if (!Array.isArray(work) || !work.length) return null;
  const tables = new Set(work.filter((item): item is string => typeof item === "string"));
  const kinds = WORK_KINDS.filter(([, names]) => names.some(name => tables.has(name))).map(([kind]) => kind);
  const known = new Set(WORK_KINDS.flatMap(([, names]) => names));
  if ([...tables].some(name => !known.has(name))) kinds.push("other work");
  if (!kinds.length) return null;
  return `This project has ${listText(kinds)}, so it cannot be deleted. Only a project nobody has worked in can be deleted.`;
}

export interface DeleteProjectSectionProps {
  projectKey: string;
  projectName: string;
  /** The project is gone: the caller leaves its pages. */
  onDeleted: () => void;
}

/**
 * "Delete this project" at the bottom of the General settings, for system administrators (issue 191). The server
 * decides whether the project has work; after a refusal the dialog names the work and offers only Close.
 */
export function DeleteProjectSection({ projectKey, projectName, onDeleted }: DeleteProjectSectionProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const refused = error != null;
  const close = () => { if (!busy) { setOpen(false); setError(null); } };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.adminDeleteProject(projectKey);
      setOpen(false);
      onDeleted();
    } catch (failure: unknown) {
      setError(failure);
      // The only way on is Close: move focus there, as the delete button is gone.
      window.setTimeout(() => closeButton.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };
  const workText = projectWorkText(error);
  return <SettingsCard className="settings-card--danger" title="Delete this project"
    hint="Only a project nobody has worked in can be deleted: no texts, tasks, guideline or other work.">
    <div><Button variant="danger" onClick={() => setOpen(true)}>Delete project…</Button></div>
    <Dialog open={open} title="Delete project?" size="sm" onClose={busy ? undefined : close} footer={refused
      ? <Button ref={closeButton} onClick={close}>Close</Button>
      : <>
        <Button disabled={busy} onClick={close}>Cancel</Button>
        <Button variant="danger-solid" loading={busy} onClick={() => { void remove(); }}>Delete project</Button>
      </>}>
      {refused
        ? workText ? <InlineMessage tone="error">{workText}</InlineMessage> : <ErrorNotice error={error} />
        : <>
          <p>{`“${projectName}” (key ${projectKey}) is deleted with its settings and members. Its key can be used again. Its audit entries stay.`}</p>
          <p>Only a project nobody has worked in can be deleted: no texts, tasks, guideline or other work.</p>
        </>}
    </Dialog>
  </SettingsCard>;
}
