/**
 * MOCKUP for the owner's sign-off (#595, docs/design/manual-sentence-pairing.md): when a text has no sentence
 * alignment, the reviewer pairs source and translation sentences by hand. The rows are the segment-pair rows of #579;
 * new is the "Next pair" composer under them. Synthetic texts, no API, nothing saved. Dev builds only
 * (`?mockup=pairing`, see src/mockups/MockupRoot.tsx).
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { splitSentences } from "../translation/sentences";
import { Button, HelpButton, HelpText, InlineMessage, Kbd, MenuButton, ReasonButton, useHelp } from "../ui";
import { AppShell } from "../ui/AppShell";
import {
  crossing, extend, nextSelection, pair, pairedIndexes, pairLabel, pairReason, pairState, rowOrder, setChecked, toggle, unpair,
  type ManualPair, type Selection, type Side,
} from "./manualPairing";
import "./mockups.css";

const SOURCE = "The patient, a 34-year-old woman, was admitted with recurrent headaches. She reported nausea and sensitivity to light for three days. On examination, blood pressure was 142/88 mmHg and the pulse was 76/min. There were no focal neurological deficits. MRI of the head showed no abnormality. Laboratory values, including CRP and blood count, were within normal limits. We diagnosed a migraine without aura. Treatment with ibuprofen 400 mg was started. A follow-up visit is planned in four weeks.";
const TRANSLATION = "Die Patientin, eine 34-jährige Frau, wurde mit wiederkehrenden Kopfschmerzen aufgenommen. Sie berichtete seit drei Tagen über Übelkeit. Zudem bestand eine Lichtempfindlichkeit. Bei der Untersuchung betrug der Blutdruck 142/88 mmHg, der Puls 76/min. Es fanden sich keine fokalen neurologischen Defizite. Das MRT des Kopfes war unauffällig. Die Laborwerte einschließlich CRP und Blutbild lagen im Normbereich. Wir stellten die Diagnose einer Migräne ohne Aura. Eine Behandlung mit Ibuprofen 400 mg wurde begonnen. Eine Wiedervorstellung ist in vier Wochen geplant.";
const EDITED = TRANSLATION.replace("der Puls 76/min.", "der Puls 76/min (Ruhe).");

const sideName: Record<Side, string> = { source: "Source (English)", translation: "Translation (German)" };

export function PairingMockup(): JSX.Element {
  const [translationText, setTranslationText] = useState(TRANSLATION);
  const source = useMemo(() => splitSentences(SOURCE, "en"), []);
  const translation = useMemo(() => splitSentences(translationText, "de"), [translationText]);
  const original = useMemo(() => splitSentences(TRANSLATION, "de"), []);
  const counts = { source: source.length, translation: translation.length };
  // Start: three pairs made, the first two checked (row 2 is 1:2), the third checked before the edit button is used.
  const [pairs, setPairs] = useState<ManualPair[]>(() => [
    setChecked({ id: 1, source: [0, 1], translation: [0, 1], checkedHash: null, origin: "manual" }, original, true),
    setChecked({ id: 2, source: [1, 2], translation: [1, 3], checkedHash: null, origin: "manual" }, original, true),
    setChecked({ id: 3, source: [2, 3], translation: [3, 4], checkedHash: null, origin: "manual" }, original, true),
  ]);
  const [selection, setSelection] = useState<Selection>(() => ({ source: [3], translation: [4] }));
  const [nextId, setNextId] = useState(4);
  const [undo, setUndo] = useState<ManualPair | null>(null);
  const help = useHelp();

  const taken = { source: pairedIndexes(pairs, "source"), translation: pairedIndexes(pairs, "translation") };
  const rows = rowOrder(pairs);
  const crossed = crossing(pairs);
  const states = rows.map(row => pairState(row, translation));
  const checked = states.filter(state => state === "checked").length;
  const stale = states.filter(state => state === "stale").length;
  const reason = pairReason(selection);

  const commit = () => {
    if (reason) return;
    const next = pair(pairs, selection, nextId);
    setPairs(next); setNextId(nextId + 1); setUndo(null);
    setSelection(nextSelection(next, counts));
  };
  const remove = (row: ManualPair) => {
    const next = unpair(pairs, row.id);
    setPairs(next); setUndo(row);
    setSelection({ source: [...Array(row.source[1] - row.source[0]).keys()].map(i => i + row.source[0]), translation: [...Array(row.translation[1] - row.translation[0]).keys()].map(i => i + row.translation[0]) });
  };
  const onComposerKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    else if (event.key === "s") { event.preventDefault(); setSelection(s => ({ ...s, source: extend(s.source, taken.source, counts.source) })); }
    else if (event.key === "t") { event.preventDefault(); setSelection(s => ({ ...s, translation: extend(s.translation, taken.translation, counts.translation) })); }
  };
  const cell = (row: ManualPair, side: Side) => {
    const sentences = side === "source" ? source : translation;
    const [start, end] = row[side];
    if (start === end) return <span className="mockup-missing">{side === "source" ? "Not in the source" : "Not in the translation"}</span>;
    return sentences.slice(start, end).map(s => s.text).join(" ");
  };
  const list = (side: Side) => {
    const sentences = side === "source" ? source : translation;
    const free = sentences.filter(s => !taken[side].has(s.index));
    return <div className="mockup-pool" role="group" aria-label={`${sideName[side]}, not paired yet`}>
      <h4>{sideName[side]} <span className="muted">· {free.length} not paired</span></h4>
      {free.length === 0 ? <p className="muted">Every sentence is paired.</p> : <ul>
        {free.map(s => {
          const on = selection[side].includes(s.index);
          return <li key={s.index}><button type="button" className="mockup-sentence" aria-pressed={on}
            onClick={() => setSelection(sel => ({ ...sel, [side]: toggle(sel[side], s.index, taken[side]) }))}>
            <span className="mockup-sentence-n" aria-hidden="true">{s.index + 1}</span><span>{s.text}</span>
          </button></li>;
        })}
      </ul>}
    </div>;
  };
  const allPaired = taken.source.size === counts.source && taken.translation.size === counts.translation;

  return <AppShell user={{ username: "rev", pseudonym: "rev-07", display_name: "Rhea Reviewer" } as never} density="reading"
    breadcrumb={[{ label: "My tasks" }, { label: "Translation review · DEMO-017 · en → de" }]}>
    <section className="mockup-pairing" aria-label="Translation review (mockup)">
      <div className="mockup-banner" role="note">
        Mockup for sign-off (#595): synthetic letter, nothing is saved.{" "}
        <Button size="sm" onClick={() => setTranslationText(translationText === EDITED ? TRANSLATION : EDITED)}>
          {translationText === EDITED ? "Undo the simulated edit" : "Simulate an edit of the blood pressure sentence"}
        </Button>
      </div>
      <div className="translation-tools mockup-tools" role="group" aria-label="Text view">
        <label className="form-checkbox-row"><input type="checkbox" className="form-checkbox" checked readOnly /> <span>Check by segment pairs</span></label>
        <HelpButton help={help} topic="Pairing by hand" />
        <span className="mockup-tools-status" role="status">
          {`${pairs.length} pairs · ${taken.source.size} of ${counts.source} source and ${taken.translation.size} of ${counts.translation} translated sentences paired · ${checked} checked`}
          {stale > 0 && <strong className="mockup-stale-count">{` · ${stale} changed`}</strong>}
        </span>
      </div>
      <HelpText help={help}>
        <p>This text has no sentence alignment, so you pair the sentences yourself. <strong>Next pair</strong> selects the next unpaired sentence of each text.
          Add a sentence with <Kbd>S</Kbd> (source) or <Kbd>T</Kbd> (translation), or tap it; press <Kbd>Enter</Kbd> or <strong>Pair</strong>.
          A pair is checked like any segment pair; editing its translation makes it <em>changed since checked</em>. <strong>⋯ › Unpair</strong> gives its sentences back.</p>
      </HelpText>
      <InlineMessage tone="info" live={false}>No sentence alignment came with this translation. Pair the sentences by hand, or use <strong>Mark checked sentences</strong> as before.</InlineMessage>

      <div className="mockup-rows" role="table" aria-label="Segment pairs">
        <div className="mockup-row mockup-row--head" role="row">
          <span role="columnheader">#</span><span role="columnheader">{sideName.source}</span><span role="columnheader">{sideName.translation}</span>
          <span role="columnheader">Checked</span><span role="columnheader"><span className="visually-hidden">Actions</span></span>
        </div>
        {rows.map((row, index) => {
          const state = states[index];
          return <div key={row.id} role="row" className={`mockup-row mockup-row--${state}`}>
            <span role="cell" className="mockup-row-n">{index + 1}<span className="mockup-origin" title="Paired by hand">✎</span></span>
            <span role="cell" className="mockup-cell" data-side="Source">{cell(row, "source")}</span>
            <span role="cell" className="mockup-cell" data-side="Translation">{cell(row, "translation")}
              {crossed.has(row.id) && <span className="mockup-note">Another order than in the source.</span>}
              {state === "stale" && <span className="mockup-note">Changed since checked.</span>}
            </span>
            <span role="cell" className="mockup-check-cell">
              <button type="button" className={`mockup-check mockup-check--${state}`} aria-pressed={state === "checked"}
                aria-label={`Pair ${index + 1}: ${state === "checked" ? "checked" : state === "stale" ? "changed since checked, check again" : "not checked"}`}
                onClick={() => setPairs(ps => ps.map(p => p.id === row.id ? setChecked(p, translation, state !== "checked") : p))}>
                <span aria-hidden="true">{state === "checked" ? "✓" : state === "stale" ? "!" : ""}</span>
              </button>
            </span>
            <span role="cell"><MenuButton label={`Actions for pair ${index + 1}`} buttonLabel="⋯" items={[
              { id: "unpair", label: "Unpair", description: "The sentences go back to Next pair; the check is dropped.", onSelect: () => remove(row) },
            ]} /></span>
          </div>;
        })}
      </div>
      {undo && <p className="mockup-undo" role="status">Pair unpaired; its sentences are selected below. <Button size="sm" onClick={() => {
        setPairs(ps => [...ps, undo]); setUndo(null); setSelection(nextSelection([...pairs, undo], counts));
      }}>Undo</Button></p>}

      <section className="mockup-composer" aria-labelledby="next-pair-heading" onKeyDown={onComposerKey}>
        <h3 id="next-pair-heading">Next pair</h3>
        {allPaired ? <p>Every sentence is paired. Check the rows above.</p> : <>
          <div className="mockup-pools">{list("source")}{list("translation")}</div>
          <div className="mockup-composer-bar">
            <span className="mockup-composer-summary">{`${selection.source.length} source · ${selection.translation.length} translated`}</span>
            <Button size="sm" onClick={() => setSelection(s => ({ ...s, source: extend(s.source, taken.source, counts.source) }))}>+ Source sentence <Kbd>S</Kbd></Button>
            <Button size="sm" onClick={() => setSelection(s => ({ ...s, translation: extend(s.translation, taken.translation, counts.translation) }))}>+ Translated sentence <Kbd>T</Kbd></Button>
            <ReasonButton variant="primary" reason={reason} onClick={commit}>{pairLabel(selection)} <Kbd>Enter</Kbd></ReasonButton>
          </div>
        </>}
      </section>
    </section>
  </AppShell>;
}
