/** The comparison table of one group (spec §3, mockup variant B): people as columns, fields as rows. */
import { useLayoutEffect, useRef } from "react";
import type { ConsolidationGroupView, ConsolidationPersonView } from "../api/client";
import { AxisValue } from "../ui/AxisValue";
import { COHORT_TAG } from "../editor/modifiers";
import "../editor/modifiers.css";
import { IconBot, IconCheck, IconWarning } from "../ui/icons";
import { allAgree, type ComparisonRow, type ModifierToggleCell, peopleOf } from "./groupModel";
import { personName } from "./lanes";
import { LaneKey } from "./TextPane";

const TOOL_PROPOSAL = "From a tool proposal";
/** The role tag of a cohort term ("Occasional [Cohort term]"), as in the term search. */
const COHORT = <> <span className="candidate-role">{COHORT_TAG}</span></>;

export interface ComparisonTableProps {
  /** The group name (text excerpt) for the caption. */
  name: string;
  group: ConsolidationGroupView;
  people: readonly ConsolidationPersonView[];
  rows: readonly ComparisonRow[];
  /** Resolved or read-only: values only, no take buttons. */
  readOnly?: boolean;
  /** Saving: the buttons stay focusable but do nothing. */
  busy?: boolean;
  onChoose: (rowId: string, value: string) => void;
}

/** Issue 525: "Severe HP:0012828 “schwere”": the term ID after the label, muted, without "·" (DN-10). */
function ToggleLabel({ toggle }: { toggle: ModifierToggleCell }): JSX.Element {
  const term = toggle.term;
  if (!term || !term.label || term.label === term.id || !toggle.label.startsWith(term.label)) return <>{toggle.label}</>;
  return <>{term.label} <span className="cons-muted">{term.id}</span>{toggle.label.slice(term.label.length)}</>;
}

/** A member's modifiers, one line each; in a conflicting row each carries its ✓ toggle (DN-1), read-only the kept ones
 *  their "kept" tag. No "·" (DN-10). */
function ModifierList({ owner, toggles, interactive, kept, busy, onPress }: { owner: string; toggles: readonly ModifierToggleCell[]; interactive: boolean;
  kept: boolean; busy: boolean; onPress: (id: string) => void }): JSX.Element {
  return <ul className="cons-mod-list" aria-label={`Modifiers of ${owner}`}>{toggles.map(toggle => <li key={toggle.id}><span className="cons-value">
    <span><ToggleLabel toggle={toggle} />{toggle.majority && ` ${toggle.majority}`}{toggle.cohort && COHORT}
      {toggle.otherText && <> <span className="cons-muted">other text chosen</span></>}</span>
    {kept && toggle.pressed && <span className="cons-tag">kept</span>}
    {interactive && <button type="button" className="cons-take" aria-pressed={toggle.pressed} aria-disabled={busy || undefined} aria-label={toggle.name}
      onClick={() => { if (!busy) onPress(toggle.id); }}><IconCheck /></button>}
  </span></li>)}</ul>;
}

/** Every row is shown (M2 M-7e): rows to decide first and highlighted, then the rest; agreed rows muted. */
export function orderRows(rows: readonly ComparisonRow[]): ComparisonRow[] {
  return [...rows.filter(row => row.conflict), ...rows.filter(row => !row.conflict)];
}

export function ComparisonTable({ name, group, people, rows, readOnly = false, busy = false, onChoose }: ComparisonTableProps): JSX.Element {
  const members = group.members;
  const names = peopleOf(people, members);
  // The width of the sticky label column: a pinned value starts after it (.cons-pin-value).
  const table = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const element = table.current;
    if (!element) return;
    const measure = () => element.style.setProperty("--cons-label-width", `${element.querySelector<HTMLElement>("thead td")?.offsetWidth ?? 0}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rows]);
  const rowClass = (row: ComparisonRow) => row.conflict && !readOnly ? "cons-row--conflict" : row.agreed !== null && members.length > 1 ? "cons-row--agreed" : undefined;
  // A hint (related terms, issue 303) is its own full-width line right after its row, so it is read once, after the
  // values it explains. Before it, a row to decide among many people says who holds which value (issue 470). Both
  // stay in view while the table scrolls sideways (.cons-pin).
  const below = (row: ComparisonRow, key: string, text: string) => <tr key={`${row.id}-${key}`} className={`cons-row-hint cons-row-${key}`}>
    <td colSpan={members.length + 1}><span className="cons-pin">{text}</span></td>
  </tr>;
  const line = (row: ComparisonRow) => [values(row),
    ...(row.split && row.conflict && !readOnly ? [below(row, "split", row.split)] : []),
    ...(row.hint ? [below(row, "hint", row.hint)] : [])];
  const values = (row: ComparisonRow) => <tr key={row.id} className={rowClass(row)}>
      <th scope="row">
        {row.conflict && !readOnly && <><IconWarning className="cons-conflict-mark" /><span className="visually-hidden">Conflict: </span></>}
        {row.label}
        {row.warnings?.map(warning => <span key={warning} className="cons-row-warning"><IconWarning className="cons-conflict-mark" />{warning}</span>)}
      </th>
      {/* B5-2: an agreed value stands under every person, so agreement is obvious; a narrow table shows it once across. */}
      {row.agreed !== null && members.length > 1 && row.cells.map(cell => <td key={cell.inputId} className="cons-agreed cons-agreed-each">
        {row.kind === "modifiers" && cell.toggles?.length
          ? cell.toggles.map((toggle, index) => <span key={toggle.id}>{index > 0 && ", "}<ToggleLabel toggle={toggle} />{toggle.cohort && COHORT}</span>)
          : row.kind === "axis" ? <AxisValue value={cell.value || null} /> : cell.display}
      </td>)}
      {row.agreed !== null
        ? <td colSpan={members.length} className={members.length > 1 ? "cons-agreed cons-agreed-once" : "cons-agreed"}><span className="cons-pin cons-pin-value">{row.kind === "modifiers" && row.cells[0].toggles?.length
          ? <>{row.cells[0].toggles.map((toggle, index) => <span key={toggle.id}>{index > 0 && ", "}<ToggleLabel toggle={toggle} />{toggle.cohort && COHORT}</span>)}{allAgree(members)}</>
          : row.kind === "axis" ? <><AxisValue value={row.cells[0].value || null} />{allAgree(members)}</>
          : row.agreed}</span></td>
        : row.cells.map((cell, index) => <td key={cell.inputId}>
          {row.kind === "modifiers"
            ? <ModifierList owner={personName(names[index].label)} toggles={cell.toggles ?? []} interactive={row.conflict && !readOnly}
              kept={row.conflict && readOnly} busy={busy}
              onPress={id => onChoose(row.id, id)} />
            : <span className="cons-value">
              {row.kind === "axis" ? <AxisValue value={cell.value} /> : cell.display}
              {/* Differing passages are choosable without being a conflict. */}
              {readOnly && (row.conflict || row.choosable) && cell.chosen && <span className="cons-tag">kept</span>}
              {(row.conflict || row.choosable) && !readOnly && <button type="button" className="cons-take" aria-pressed={cell.chosen} aria-disabled={busy || undefined}
                aria-label={`Take ${cell.display} from ${personName(names[index].label)} for ${row.label}`}
                onClick={() => { if (!busy) onChoose(row.id, cell.value); }}><IconCheck /></button>}
            </span>}
        </td>)}
    </tr>;
  return <div className="cons-compare-scroll"><table ref={table} className="cons-compare">
    <caption className="visually-hidden">Comparison of {name}</caption>
    <thead><tr><td />{members.map((member, index) => <th key={member.input_id} scope="col">
      <LaneKey people={people} personId={member.person_id} />{personName(names[index].label)}
      {member.from_tool_proposal && <span className="cons-bot" role="img" aria-label={TOOL_PROPOSAL} title={TOOL_PROPOSAL}><IconBot /></span>}
    </th>)}</tr></thead>
    <tbody>{orderRows(rows).map(line)}</tbody>
  </table></div>;
}
