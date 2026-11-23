# Hierarchy-aware agreement (#600) — design note

**Status: mockup for sign-off — not to be merged.** Refs #600, #303, #601.

## Problem

Agreement counts "Seizure" against "Focal seizure" on the same passage as a
plain miss. Since #303 such pairs are recognised (`term_related`, the count
`related_term_conflicts`), but no figure uses the hierarchy. Granularity is the
most common disagreement in ontology annotation, so `term_f1` and the
annotation F1 values understate how close two annotators are, and one number
cannot tell a granularity difference from a real conflict.

## Fixed points (not up for decision)

- The **strict and tolerant figures stay unchanged and stay the default**. The
  new figure is added next to them in `agreement.csv`,
  `agreement-summary.csv` and `GET /api/v1/projects/{key}/agreement`.
- The **pairing does not change**. Credit is given only to *term conflicts*
  that the existing optimal one-to-one matching of `ontospan.agreement`
  already formed (same layer, overlapping or identical evidence). So every
  other value is identical with and without the hierarchy.
- The **pinned release is the only source** of the hierarchy (`is_a`,
  transitive, via the `ancestors` lookup Ontotator already passes for #303).
  No information content, no corpus statistics: the figure is reproducible from
  the export and the pinned release.
- The credit is **symmetric**. Between two annotators there is no reference,
  unlike Phentrieve's `ontology_credit.py`, where a too specific prediction
  earns more than a too general one.
- The computation lives in **ontospan** (`ontospan.agreement`), shared with
  the benchmark. The branch `feat/hierarchy-agreement` of phentrieve/ontospan
  already adds `related` and `annotation_hierarchical_f1` (with full credit,
  option A below).

## Formula

For one pair of submissions with `n_a` and `n_b` findings:

```
hierarchical_f1 = 2 × (equal + compatible + Σ credit(pair)) / (n_a + n_b)
```

where the sum runs over the paired term conflicts and `credit` is in [0, 1].
A pair gets credit only when its terms are ancestor and descendant **and its
axes are equal** (assertion, temporality …): "Seizure, present" against
"Focal seizure, absent" is a real conflict. This is also the ontospan branch's
rule. (Ontotator's existing `related_term_conflicts` counts related pairs
whatever their axes; it stays as it is.)

Pooled and macro figures follow the existing rules: pooled sums the counts and
the credits over all pairs; macro averages per text, then over texts.

## Options for the weight

With `up(t)` = the term and all its ancestors:

| Option | credit for ancestor/descendant | Seizure / Focal seizure | Short stature / Growth abnormality (2 steps) | Notes |
| --- | --- | --- | --- | --- |
| **A. Full** (ontospan branch) | 1 | 1 | 1 | A "lenient" F1. The gap to tolerant F1 is exactly the granularity share. Not *partial* credit: a far ancestor counts as much as an exact match. |
| **B. Fixed half** | 0.5 | 0.5 | 0.5 | One rule in one sentence. Recomputable from the exported counts alone (`equal`, `compatible`, the new `hierarchy_credited` count, `findings_a/b`), for any other weight too. Ignores distance. |
| **C. Per step** | 0.5^steps, steps = \|up(specific)\| − \|up(general)\| | 0.5 | 0.25 | Distance matters. In a DAG "steps" also counts the extra parents of the specific term; it depends on how finely a branch of the ontology is modelled. Needs a credit sum per pair in the export. |
| **D. Depth ratio** | \|up(general)\| / \|up(specific)\| (Jaccard of the up-sets) | 0.75 | 0.5 | Parameter-free. Deep, fine distinctions earn almost full credit; the same one step costs more near the root. Uneven HPO depth makes it hard to explain. |

**Siblings** ("Focal seizure" against "Generalized seizure"): no credit in any
option by default. They are often mutually exclusive clinically, and every
term shares ancestors with almost every other near the root, so a shared-
ancestor rule would reward unrelated pairs too. A fixed small sibling credit
(for example 0.25) is possible as an add-on; it is in the prototype
(`sibling_credit`).

## Worked example

Synthetic tree (HPO-like labels, not the real graph), up-set sizes in brackets:
Phenotypic abnormality (1) › Abnormality of the nervous system (2) › Seizure
(3) › Focal seizure (4) / Generalized seizure (4); … › Abnormal muscle tone (3)
› Hypotonia (4) › Generalized hypotonia (5); Phenotypic abnormality ›
Growth abnormality (2) › Abnormal body height (3) › Short stature (4);
Phenotypic abnormality › Fever (2).

Text: *"Focal seizures since infancy, later a generalized seizure. Marked
hypotonia. No fever. Short stature and a small head; developmental delay."* — two annotators,
six findings each, all with the same axes except where noted.

| # | Annotator A | Annotator B | Matching | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Focal seizure | Seizure | term conflict, child/parent | 1 | 0.5 | 0.5 | 0.75 |
| 2 | Hypotonia | Generalized hypotonia | term conflict, parent/child | 1 | 0.5 | 0.5 | 0.8 |
| 3 | Short stature | Growth abnormality | term conflict, 2 steps | 1 | 0.5 | 0.25 | 0.5 |
| 4 | Fever (absent) | Fever (absent) | equal | 1 | 1 | 1 | 1 |
| 5 | Generalized seizure | Focal seizure | term conflict, siblings | 0 | 0 | 0 | 0 |
| 6 | Developmental delay | — | a only | 0 | 0 | 0 | 0 |
| 7 | — | Microcephaly | b only | 0 | 0 | 0 | 0 |

| Figure | Value |
| --- | --- |
| Strict = tolerant F1 (today) | 2 × 1 / 12 = **0.167** |
| Hierarchical F1, A (full) | 2 × 4 / 12 = **0.667** |
| Hierarchical F1, B (half) | 2 × 2.5 / 12 = **0.417** |
| Hierarchical F1, C (per step) | 2 × 2.25 / 12 = **0.375** |
| Hierarchical F1, D (depth ratio) | 2 × 3.05 / 12 = **0.508** |
| B with sibling credit 0.25 | 2 × 2.75 / 12 = 0.458 |

These numbers are the test `tests/test_hierarchy_credit.py`; the prototype
`src/ontotator/domain/hierarchy_credit.py` implements all four rules on the
`ancestors` lookup and checks that each is symmetric, bounded by [0, 1], never
gives a farther ancestor more credit, never gives credit for other axes or
unrelated terms, and never lowers the figure below the tolerant F1.

## Display (mockup)

`?mockup=agreement` in a dev build (`npm run dev`) shows an **Agreement**
section on the Progress page (screenshots in the PR): four figures (strict,
tolerant, **hierarchical** marked *new*, term F1), a breakdown of the paired
findings (same term; parent and child with the same context — credited;
parent and child with another context; other term; other context; one
annotator only), and the figures per pair of annotators with the gain from
the hierarchy. A (?) explains the rule in one paragraph. Progress has no
Agreement section today; the API route exists.

## Recommendation

1. **Option B, fixed credit ½**, ancestor or descendant at any distance, axes
   equal, siblings 0. It is partial credit (what #600 asks for), it is stated
   in one sentence in the export guide, and it is recomputable from the
   exported counts — a reader who prefers full credit (A) or none gets it from
   the same columns. C and D depend on how finely each HPO branch is modelled,
   which a reader cannot see in the export.
2. **Columns**: `annotation_hierarchical_f1` (F1 columns) and
   `hierarchy_credited` (count of credited pairs), in agreement.csv,
   agreement-summary.csv and the route; `related_term_conflicts` stays.
3. **ontospan**: the branch `feat/hierarchy-agreement` gives full credit.
   Change it to take `related_weight: float = 0.5` (or let Ontotator compute
   the F1 from `related`), release it as ontospan 1.3.x, then pin it here.
4. **UI**: the Agreement section on Progress as in the mockup, after the
   export columns (a separate PR).
5. Cohen's kappa for context axes (#601) uses the same matched pairs and can
   go in the same section later; it is independent of this decision.

## Questions for the owner

1. **Weight** for a parent/child pair: (a) full credit 1 (ontospan branch as
   is), (b) **fixed ½** *(recommended)*, (c) halves per step, (d) depth ratio.
2. **Siblings**: (a) **no credit** *(recommended)*, (b) a fixed small credit
   (0.25), (c) decide later on real data.
3. **Context**: must the axes agree for credit? (a) **yes, as in the ontospan
   branch** *(recommended)*, (b) no, any related pair.
4. **Where it shows**: (a) **exports, API and an Agreement section on
   Progress** *(recommended)*, (b) exports and API only, (c) the Agreement
   section with the hierarchical figure behind a toggle.
