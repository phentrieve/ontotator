/**
 * MOCKUP for the owner's sign-off (#600, docs/design/hierarchy-agreement.md): an Agreement section on the Progress
 * page with the hierarchy-aware figure next to the strict ones. Synthetic numbers only; no API call. Dev builds only
 * (`?mockup=agreement`, see src/mockups/MockupRoot.tsx).
 */
import { HelpButton, HelpText, useHelp } from "../ui";
import { AppShell } from "../ui/AppShell";
import "./mockups.css";

const RELEASE = "HPO 2026-06-23";
const POOLED = { strict: 0.62, tolerant: 0.71, hierarchical: 0.756, term: 0.69, texts: 24, pairs: 29 };

// Paired findings of every pair of annotators, summed (each pair of findings once); the rows add up to 1400 findings.
const BREAKDOWN = [
  { key: "equal", label: "Same term, same context", count: 434, credit: "1", tone: "same" },
  { key: "compatible", label: "Same term, compatible evidence", count: 63, credit: "1 (tolerant)", tone: "same" },
  { key: "related", label: "Parent and child term, same context", count: 64, credit: "½ (new)", tone: "related" },
  { key: "related-axes", label: "Parent and child term, other context", count: 9, credit: "0", tone: "conflict" },
  { key: "term", label: "Other term", count: 37, credit: "0", tone: "conflict" },
  { key: "axes", label: "Same term, other context", count: 21, credit: "0", tone: "conflict" },
] as const;
const ONLY_ONE = 144;

const PAIRS = [
  { a: "Ada", b: "Ben", texts: 12, strict: 0.64, tolerant: 0.73, hierarchical: 0.78, related: 30 },
  { a: "Ada", b: "Cleo", texts: 8, strict: 0.58, tolerant: 0.69, hierarchical: 0.72, related: 14 },
  { a: "Ben", b: "Cleo", texts: 9, strict: 0.61, tolerant: 0.7, hierarchical: 0.74, related: 20 },
];

const fmt = (value: number) => value.toFixed(2);
const delta = (value: number) => `+${value.toFixed(2)}`;

export function AgreementMockup(): JSX.Element {
  const help = useHelp();
  const pairedMax = Math.max(...BREAKDOWN.map(row => row.count));
  return <AppShell user={{ username: "lead", pseudonym: "lead", display_name: "Lea Lead" } as never} role="Lead" breadcrumb={[{ label: "Projects" }, { label: "Demo cohort (synthetic)" }, { label: "Progress" }]}>
    <section className="progress-page">
      <p className="mockup-banner" role="note">Mockup for sign-off (#600): synthetic numbers, not wired to the API.</p>
      <h1>Progress</h1>
      <p className="progress-lede">… pipeline and People as today …</p>

      <section className="mockup-agreement" aria-labelledby="agreement-heading">
        <div className="mockup-heading-row">
          <h2 id="agreement-heading">Agreement</h2>
          <HelpButton help={help} topic="Agreement" />
        </div>
        <HelpText help={help}>
          <p><strong>Strict F1</strong>: same term, same context and the same evidence. <strong>Tolerant F1</strong>: the evidence may only overlap.
            {" "}<strong>Hierarchical F1</strong>: like tolerant, and a pair whose terms are parent and child (at any distance) in the pinned release ({RELEASE}) with the same context counts as half a match.
            {" "}It is 2 × (same + compatible + ½ × parent/child) ÷ (findings of both). Sibling terms ("Focal seizure" and "Generalized seizure") get nothing.
            {" "}The pairing is the same for all three figures. The same values are in agreement.csv and agreement-summary.csv.</p>
        </HelpText>
        <p className="muted">Between annotators on the {POOLED.texts} texts with a final result, {POOLED.pairs} pairs of submissions, all pooled. Hierarchy: {RELEASE}.</p>

        <ul className="mockup-figures" aria-label="Pooled agreement">
          <li><span className="mockup-figure-label">Strict F1</span><span className="mockup-figure-n">{fmt(POOLED.strict)}</span><span className="mockup-figure-sub">same evidence</span></li>
          <li><span className="mockup-figure-label">Tolerant F1</span><span className="mockup-figure-n">{fmt(POOLED.tolerant)}</span><span className="mockup-figure-sub">overlapping evidence</span></li>
          <li className="mockup-figure--new">
            <span className="mockup-figure-label">Hierarchical F1 <span className="mockup-new">new</span></span>
            <span className="mockup-figure-n">{fmt(POOLED.hierarchical)}</span>
            <span className="mockup-figure-sub">{delta(POOLED.hierarchical - POOLED.tolerant)} from parent/child terms</span>
          </li>
          <li><span className="mockup-figure-label">Term F1</span><span className="mockup-figure-n">{fmt(POOLED.term)}</span><span className="mockup-figure-sub">terms per text, no evidence</span></li>
        </ul>

        <h3 id="agreement-breakdown">Where the annotators differ</h3>
        <table className="data-table mockup-breakdown" aria-labelledby="agreement-breakdown">
          <thead><tr><th scope="col">Paired findings</th><th scope="col" className="num">Pairs</th><th scope="col" className="mockup-bar-col"><span className="visually-hidden">Share</span></th><th scope="col">Counts as</th></tr></thead>
          <tbody>
            {BREAKDOWN.map(row => <tr key={row.key} className={`mockup-row--${row.tone}`}>
              <th scope="row">{row.tone === "related" && <span className="mockup-glyph" aria-hidden="true">⊂</span>}{row.label}</th>
              <td className="num">{row.count}</td>
              <td className="mockup-bar-col"><span className="mockup-bar" aria-hidden="true"><span style={{ width: `${(row.count / pairedMax) * 100}%` }} /></span></td>
              <td>{row.credit}</td>
            </tr>)}
            <tr className="mockup-row--conflict"><th scope="row">Marked by one annotator only</th><td className="num">{ONLY_ONE}<span className="cell-secondary">findings</span></td><td className="mockup-bar-col" /><td>0</td></tr>
          </tbody>
        </table>
        <p className="muted progress-people-note">64 of the 110 term differences are a parent and its child with the same context: a difference in granularity, not a conflict. 9 more are parent and child with another context (for example present and absent); they count as a conflict.</p>

        <h3 id="agreement-pairs">By pair of annotators</h3>
        <div className="data-table-scroll">
          <table className="data-table mockup-pairs" aria-labelledby="agreement-pairs">
            <thead><tr>
              <th scope="col">Annotators</th><th scope="col" className="num">Texts</th><th scope="col" className="num">Strict F1</th><th scope="col" className="num">Tolerant F1</th>
              <th scope="col" className="num">Hierarchical F1</th><th scope="col" className="num">Parent/child pairs</th>
            </tr></thead>
            <tbody>{PAIRS.map(pair => <tr key={`${pair.a}-${pair.b}`}>
              <th scope="row">{pair.a} · {pair.b}</th>
              <td className="num" data-label="Texts">{pair.texts}</td>
              <td className="num" data-label="Strict F1">{fmt(pair.strict)}</td>
              <td className="num" data-label="Tolerant F1">{fmt(pair.tolerant)}</td>
              <td className="num" data-label="Hierarchical F1"><strong>{fmt(pair.hierarchical)}</strong> <span className="muted">{delta(pair.hierarchical - pair.tolerant)}</span></td>
              <td className="num" data-label="Parent/child pairs">{pair.related}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="muted progress-people-note">Pooled over every text both annotated. The texts and their pairs are in agreement.csv of a final export.</p>
      </section>
    </section>
  </AppShell>;
}
