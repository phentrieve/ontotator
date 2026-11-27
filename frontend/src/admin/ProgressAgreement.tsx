import { useEffect, useState } from "react";
import { api, type AgreementPooled, type ProjectAgreement } from "../api/client";
import { HelpButton, HelpText, useHelp } from "../ui";

const figure = (value: number | null | undefined) => value == null ? "–" : value.toFixed(2);

interface BreakdownRow { key: string; label: string; count: number; credit: string; tone: "same" | "related" | "conflict" }

/** The paired findings of the pooled counts, by how they count (#600, #636). */
export function agreementBreakdown(pooled: AgreementPooled): BreakdownRow[] {
  const related = pooled.related_term_conflicts;
  return [
    { key: "equal", label: "Same term, same values and evidence", count: pooled.equal, credit: "1", tone: "same" },
    { key: "compatible", label: "Same term and values, overlapping evidence", count: pooled.compatible, credit: "1 (tolerant)", tone: "same" },
    { key: "related", label: "Parent and child term, same values", count: pooled.hierarchy_credited, credit: "½ (hierarchical)", tone: "related" },
    { key: "related-values", label: "Parent and child term, other values", count: related - pooled.hierarchy_credited, credit: "0", tone: "conflict" },
    { key: "term", label: "Other term", count: pooled.term_conflicts - related, credit: "0", tone: "conflict" },
    { key: "values", label: "Same term, other values", count: pooled.axis_conflicts, credit: "0", tone: "conflict" },
  ];
}

/** Progress › Agreement (#600, decided in #636): the figures of agreement.csv for the current final results.
 * Leads only, like the route; for anyone else, or when it fails, the rest of Progress stays as it is. */
export function ProgressAgreement({ projectKey, revision }: { projectKey: string; revision: number }): JSX.Element | null {
  const [value, setValue] = useState<ProjectAgreement | null>(null);
  const help = useHelp();
  useEffect(() => {
    let active = true;
    api.getProjectAgreement(projectKey).then(result => { if (active) setValue(result); }, () => { if (active) setValue(null); });
    return () => { active = false; };
  }, [projectKey, revision]);
  if (!value) return null;
  const pooled = value.summary.pooled;
  const rows = agreementBreakdown(pooled);
  const max = Math.max(1, ...rows.map(row => row.count));
  const oneOnly = pooled.a_only + pooled.b_only;
  const gain = pooled.annotation_hierarchical_f1 != null && pooled.annotation_tolerant_f1 != null
    ? pooled.annotation_hierarchical_f1 - pooled.annotation_tolerant_f1 : null;
  const termDifferences = pooled.term_conflicts;

  return <section className="progress-agreement" aria-labelledby="progress-agreement-heading">
    <div className="progress-heading-row">
      <h2 id="progress-agreement-heading">Agreement</h2>
      <HelpButton help={help} topic="Agreement" />
    </div>
    <HelpText help={help}>
      <p><strong>Strict F1</strong>: same term, same values and the same evidence. <strong>Tolerant F1</strong>: the evidence may only overlap.
        {" "}<strong>Hierarchical F1</strong>: like tolerant, and a pair whose terms are parent and child (at any distance) in the pinned ontology release, with the same values, counts as half a match:
        {" "}2 × (same + compatible + ½ × parent/child) ÷ (findings of both). Sibling terms (&quot;Focal seizure&quot; and &quot;Generalized seizure&quot;) count nothing.
        {" "}The pairing is the same for all figures. A final export writes the same values to agreement.csv and agreement-summary.csv.</p>
    </HelpText>
    {pooled.pairs === 0
      ? <p className="muted">No agreement yet. It compares the annotations of two people behind a final result, so it appears once a text annotated by two or more people has one.</p>
      : <>
        <p className="muted">{`Between annotators on the ${pooled.texts} ${pooled.texts === 1 ? "text" : "texts"} with a final result, ${pooled.pairs} ${pooled.pairs === 1 ? "pair" : "pairs"} of submissions, pooled.`}</p>
        <ul className="progress-figures" aria-label="Pooled agreement">
          <li><span className="progress-figure-label">Strict F1</span><span className="progress-figure-n">{figure(pooled.annotation_strict_f1)}</span><span className="progress-figure-sub">same evidence</span></li>
          <li><span className="progress-figure-label">Tolerant F1</span><span className="progress-figure-n">{figure(pooled.annotation_tolerant_f1)}</span><span className="progress-figure-sub">overlapping evidence</span></li>
          <li className="progress-figure--hierarchy">
            <span className="progress-figure-label">Hierarchical F1</span>
            <span className="progress-figure-n">{figure(pooled.annotation_hierarchical_f1)}</span>
            <span className="progress-figure-sub">{gain == null ? "no ontology to look up" : `+${gain.toFixed(2)} from parent/child terms`}</span>
          </li>
          <li><span className="progress-figure-label">Term F1</span><span className="progress-figure-n">{figure(pooled.term_f1)}</span><span className="progress-figure-sub">terms per text, no evidence</span></li>
        </ul>

        <h3 id="progress-agreement-breakdown">Where the annotators differ</h3>
        <div className="data-table-scroll">
          <table className="data-table progress-breakdown" aria-labelledby="progress-agreement-breakdown">
            <thead><tr><th scope="col">Paired findings</th><th scope="col" className="num">Pairs</th><th scope="col" className="progress-bar-col"><span className="visually-hidden">Share</span></th><th scope="col">Counts as</th></tr></thead>
            <tbody>
              {rows.map(row => <tr key={row.key} className={`progress-breakdown--${row.tone}`}>
                <th scope="row">{row.label}</th>
                <td className="num">{row.count}</td>
                <td className="progress-bar-col"><span className="progress-bar" aria-hidden="true"><span style={{ width: `${(row.count / max) * 100}%` }} /></span></td>
                <td>{row.credit}</td>
              </tr>)}
              <tr className="progress-breakdown--conflict"><th scope="row">Findings marked by one annotator only</th><td className="num">{oneOnly}</td><td className="progress-bar-col" /><td>0</td></tr>
            </tbody>
          </table>
        </div>
        {termDifferences > 0 && <p className="muted progress-people-note">{`${pooled.hierarchy_credited} of the ${termDifferences} term differences are a parent and its child with the same values: a difference in granularity rather than a conflict.`}</p>}

        {value.annotator_pairs.length > 0 && <>
          <h3 id="progress-agreement-pairs">By pair of annotators</h3>
          <div className="data-table-scroll">
            <table className="data-table progress-people-table" aria-labelledby="progress-agreement-pairs">
              <thead><tr>
                <th scope="col">Annotators</th><th scope="col" className="num">Texts</th><th scope="col" className="num">Strict F1</th><th scope="col" className="num">Tolerant F1</th>
                <th scope="col" className="num">Hierarchical F1</th><th scope="col" className="num">Parent/child pairs</th>
              </tr></thead>
              <tbody>{value.annotator_pairs.map(pair => <tr key={`${pair.pseudonym_a}-${pair.pseudonym_b}`}>
                <th scope="row">{pair.pseudonym_a} · {pair.pseudonym_b}</th>
                <td className="num" data-label="Texts">{pair.pooled.texts}</td>
                <td className="num" data-label="Strict F1">{figure(pair.pooled.annotation_strict_f1)}</td>
                <td className="num" data-label="Tolerant F1">{figure(pair.pooled.annotation_tolerant_f1)}</td>
                <td className="num" data-label="Hierarchical F1"><strong>{figure(pair.pooled.annotation_hierarchical_f1)}</strong></td>
                <td className="num" data-label="Parent/child pairs">{pair.pooled.hierarchy_credited}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="muted progress-people-note">Pooled over every text both annotated. Per text and pair, the values are in agreement.csv of a final export.</p>
        </>}
      </>}
  </section>;
}
