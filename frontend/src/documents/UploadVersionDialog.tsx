/**
 * "Upload new version…" on the newest version row of a translation (issue 341 a): the lead brings in a text
 * made elsewhere. Two steps in one dialog: the text (pasted, or one UTF-8 .txt file that only fills the text)
 * with how it was made, then the changes against the current version ("Show changes" marks) before it is
 * saved. The new version is always a correction of this version, ready for review with review On; accepting
 * it stays "Accept this version…". The work on the current version is listed before saving, as in the lead
 * correction (`correctionConsequences`). While a translation review of the version is open nothing can be
 * uploaded.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type DocumentVersionView, type VersionUploadPreview, type VersionUploadRequest } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { readBytes } from "../guidelines/fileChecks";
import { DiffView, TextView } from "../translation/DiffView";
import { diffTextBounded, type TextDiffPart } from "../translation/textDiff";
import { Button, Dialog, InlineMessage, Textarea, TextInput } from "../ui";
import { correctionConsequences } from "./LeadCorrectionPanel";
import { versionName } from "./labels";

export type UploadMethod = VersionUploadRequest["method"];

/** Largest text file the dialog reads (the server bounds the text itself). */
export const MAX_UPLOAD_FILE_BYTES = 1_000_000;

/** Number of changed passages: runs of inserted or deleted words, joined across unchanged white space. */
export function changedPassages(parts: readonly TextDiffPart[]): number {
  let count = 0, inside = false;
  for (const part of parts) {
    if (part.op !== "equal") { if (!inside) count += 1; inside = true; } else if (part.text.trim() !== "") inside = false;
  }
  return count;
}

/** Why no version can be uploaded after this one (`VERSION_UPLOAD_NOT_AVAILABLE` reasons). */
export function uploadRefusal(reason: string | null | undefined, short: string): string | null {
  switch (reason) {
    case "review_open": return "A translation review of this version is open. Withdraw it with Remove… in the reviewer’s row of the Translation part before you upload a new version.";
    case "not_newest": return "A newer version of this translation exists. Reload the row to see it.";
    case "discarded": return "This translation was discarded. Reload the row to see its current state.";
    case "unchanged": return `No changes to ${short}. Nothing is saved.`;
    default: return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function refusedSave(error: unknown, short: string): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "VARIANT_REVIEW_STALE") return "The text of this version changed. Reload the row to see the current text.";
  if (error.code !== "VERSION_UPLOAD_NOT_AVAILABLE") return null;
  return uploadRefusal(isRecord(error.details) && typeof error.details.reason === "string" ? error.details.reason : null, short);
}

const formatSize = (bytes: number) => (bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`);

/** Reads one UTF-8 .txt file; the message says what is wrong with it. */
export async function readTextFile(file: File): Promise<{ text: string } | { error: string }> {
  if (!file.name.toLowerCase().endsWith(".txt")) return { error: "Choose a text file (.txt)." };
  if (file.size > MAX_UPLOAD_FILE_BYTES) return { error: "This file is larger than 1 MB. Choose a smaller text file." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(file));
  } catch {
    return { error: "This file is not UTF-8 text. Save it as UTF-8 and choose it again." };
  }
  // A NUL byte is valid UTF-8 but never text: a binary file.
  if (text.includes("\u0000")) return { error: "This file is not UTF-8 text. Save it as UTF-8 and choose it again." };
  return text.trim() ? { text } : { error: "This file is empty." };
}

const METHODS: readonly { value: UploadMethod; label: (short: string) => string }[] = [
  { value: "machine_translation", label: () => "Machine translation" },
  { value: "human_translation", label: () => "Human translation" },
  { value: "manual_correction", label: short => `Correction of ${short} by hand` },
];

export interface UploadVersionDialogProps {
  row: DocumentRowView;
  version: DocumentVersionView;
  projectKey: string;
  /** Saved: the announcement ("EN100022 de v3 saved as a correction of v2. It is ready for review."). */
  onUploaded: (message: string) => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}

export function UploadVersionDialog({ row, version, projectKey, onUploaded, onClose, returnFocus }: UploadVersionDialogProps): JSX.Element {
  const id = useId();
  const writing = useRef(false);
  const short = versionName(version.version, version.chain_name, row.parallel_roots);
  const title = `Upload new version, ${row.case_id} ${row.language} ${short}`;
  /** What the server says before any text is known: availability and the work on this version. */
  const [state, setState] = useState<VersionUploadPreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [input, setInput] = useState<"paste" | "file">("paste");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [method, setMethod] = useState<UploadMethod | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [madeOn, setMadeOn] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  /** Step 2: the text as it would be stored and the current text to compare it with. */
  const [checked, setChecked] = useState<VersionUploadPreview | null>(null);
  /** The text the server found equal to the current version (the message stays until the text changes). */
  const [same, setSame] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.previewVersionUpload(projectKey, version.document_id).then(value => { if (live) setState(value); }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, version.document_id]);

  const text = input === "paste" ? pasted : file?.text ?? "";
  const next = state?.next_version ?? version.version + 1;
  const missingText = !text.trim();
  const missingMethod = method === null;
  const missingProvider = method === "machine_translation" && !provider.trim();
  const invalid = missingText || missingMethod || missingProvider;
  const blocked = state !== null && !state.available && state.reason !== "unchanged" ? uploadRefusal(state.reason, short) ?? "A new version cannot be uploaded here. Reload the row to see its current state." : null;
  const consequences = state ? correctionConsequences(state) : [];
  const annotated = state ? state.annotations.submitted + state.annotations.open > 0 : false;
  const parts = useMemo(() => (checked?.text != null && checked.previous_text != null ? diffTextBounded(checked.previous_text, checked.text) : null), [checked]);

  const choose = async (chosen: File | undefined) => {
    setFile(null); setFileError(null); setError(undefined);
    if (!chosen) return;
    const result = await readTextFile(chosen).catch(() => ({ error: "The file could not be read." }));
    if ("error" in result) { setFileError(result.error); setFileKey(key => key + 1); } else setFile({ name: chosen.name, size: chosen.size, text: result.text });
  };

  const check = async () => {
    setTried(true);
    if (writing.current || invalid) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const preview = await api.previewVersionUpload(projectKey, version.document_id, text);
      setState(preview);
      if (preview.available) setChecked(preview);
      else if (preview.reason === "unchanged") setSame(text);
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const save = async () => {
    if (writing.current || !checked || checked.text == null || method === null) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const saved = await api.uploadVersion(projectKey, version.document_id, {
        text: checked.text, expected_text_sha256: checked.text_sha256, method,
        ...(method === "machine_translation" ? { provider: provider.trim(), ...(model.trim() ? { model: model.trim() } : {}) } : {}),
        ...(madeOn ? { made_on: madeOn } : {}), ...(madeBy.trim() ? { made_by: madeBy.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      });
      onUploaded(`${textLabel(row)} v${saved.version} saved as a correction of ${short}. It is ready for review.`);
    } catch (failure: unknown) {
      setError(failure);
    } finally { writing.current = false; setBusy(false); }
  };

  const work = <>
    {consequences.length > 0 && <InlineMessage tone="warning" title={annotated ? `Annotation has work on v${version.version}.` : `v${version.version} has work.`}>
      {consequences.map(line => <span key={line} className="lead-correction-consequence">{line} </span>)}
    </InlineMessage>}
    <p className="field-hint">{`v${next} starts as a correction with review On.`}</p>
  </>;
  const refused = refusedSave(error, short);
  const failure = refused ? <InlineMessage tone="warning">{refused}</InlineMessage> : error !== undefined && <ErrorNotice error={error} />;
  const close = busy ? undefined : onClose;

  if (loadError !== undefined || blocked !== null) {
    return <Dialog open size="sm" title={title} onClose={onClose} returnFocus={returnFocus} footer={<Button onClick={onClose}>Close</Button>}>
      {loadError !== undefined ? <ErrorNotice error={loadError} /> : <InlineMessage tone="warning">{blocked}</InlineMessage>}
    </Dialog>;
  }

  if (checked !== null) {
    const count = parts ? changedPassages(parts) : null;
    return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
      footer={<>
        <Button disabled={busy} onClick={() => { setChecked(null); setError(undefined); }}>Back</Button>
        <Button variant="primary" loading={busy} onClick={() => { void save(); }}>{`Save as v${next}`}</Button>
      </>}>
      <div className="upload-version">
        <p className="upload-version-changes"><strong>{`Changes to ${short}`}</strong>{count !== null && ` · ${count} ${count === 1 ? "passage" : "passages"} changed`}</p>
        {parts
          ? <DiffView before={checked.previous_text ?? ""} after={checked.text ?? ""} parts={parts} lang={row.language} />
          : <>
            <p className="field-hint">The texts differ too much to mark the changes. This is the new text.</p>
            <TextView text={checked.text ?? ""} label="New text" lang={row.language} />
          </>}
        {work}
        {failure}
      </div>
    </Dialog>;
  }

  return <Dialog open size="lg" title={title} onClose={close} returnFocus={returnFocus}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} aria-disabled={invalid || busy ? true : undefined}
        aria-describedby={invalid && tried ? `${id}-missing` : undefined} onClick={() => { void check(); }}>Check changes</Button>
    </>}>
    <div className="upload-version">
      <p>{`The text becomes v${next}, a correction of ${short}.`}</p>
      {work}
      <span role="radiogroup" aria-label="Where the text comes from" className="segmented upload-version-input">
        {([["paste", "Paste text"], ["file", "Choose file"]] as const).map(([value, label]) =>
          <label key={value} className="segment" data-checked={input === value || undefined}>
            <input type="radio" name={`${id}-input`} value={value} checked={input === value} disabled={busy} onChange={() => { setInput(value); setError(undefined); }} />
            {label}
          </label>)}
      </span>
      {input === "paste"
        ? <Textarea id={`${id}-text`} label="New text" required rows={6} lang={row.language} value={pasted} disabled={busy}
          hint="Paste the whole text. Paragraphs are kept as pasted." error={tried && missingText ? "Paste the text." : undefined}
          onChange={event => { setPasted(event.target.value); setError(undefined); }} />
        : <div className="upload-version-file">
          <TextInput key={fileKey} id={`${id}-file`} type="file" label="Text file" required accept=".txt,text/plain" disabled={busy}
            hint="One UTF-8 text file (.txt). The file name does not matter here." error={fileError ?? (tried && missingText ? "Choose a text file." : undefined)}
            onChange={event => { void choose(event.target.files?.[0]); }} />
          {file && <p className="upload-version-file-facts">{`${file.name} · ${formatSize(file.size)}`}</p>}
        </div>}
      {same !== null && same === text && <InlineMessage tone="warning">{uploadRefusal("unchanged", short)}</InlineMessage>}
      <fieldset className="plan-step" aria-describedby={tried && missingMethod ? `${id}-method-error` : undefined}>
        <legend>How was this text made? (required)</legend>
        {METHODS.map(choice => <div key={choice.value} className="plan-option">
          <input type="radio" id={`${id}-method-${choice.value}`} name={`${id}-method`} checked={method === choice.value} disabled={busy} onChange={() => setMethod(choice.value)} />
          <label htmlFor={`${id}-method-${choice.value}`}>{choice.label(short)}</label>
        </div>)}
        {tried && missingMethod && <p id={`${id}-method-error`} className="field-hint field-hint-error" role="alert">Choose how the text was made.</p>}
      </fieldset>
      {method === "machine_translation" && <div className="upload-version-fields">
        <TextInput id={`${id}-provider`} label="Provider" required maxLength={200} value={provider} disabled={busy}
          error={tried && missingProvider ? "Enter the provider, for example DeepL." : undefined} onChange={event => setProvider(event.target.value)} />
        <TextInput id={`${id}-model`} label="Model or tool" maxLength={200} value={model} disabled={busy} onChange={event => setModel(event.target.value)} />
      </div>}
      <div className="upload-version-fields">
        <TextInput id={`${id}-made-on`} type="date" label="Made on" value={madeOn} disabled={busy} onChange={event => setMadeOn(event.target.value)} />
        <TextInput id={`${id}-made-by`} label="Made by" maxLength={200} value={madeBy} disabled={busy} onChange={event => setMadeBy(event.target.value)} />
      </div>
      <TextInput id={`${id}-note`} label="Note" maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      {failure}
      {invalid && tried && <p id={`${id}-missing`} className="action-reason">Fill in the required fields.</p>}
    </div>
  </Dialog>;
}
