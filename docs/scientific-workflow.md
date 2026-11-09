# A small scientific annotation workflow

Ontotator records annotation and consolidation results. A submitted
consolidation is not automatically an adjudicated gold standard. Consolidation
displays source provenance; annotation from scratch (`independent` mode) shows
neither proposals nor other people's work.

## Before distributing work

Use a versioned task profile and a pinned ontology. State the annotation unit,
allowed types/axes, evidence requirements and inclusion/exclusion rules in a
shared annotation guideline. Record that guideline's version in the study
protocol alongside package/profile identities. Annotation is distributed
in `independent` mode; `review` is the consolidator's mode of a consolidation
round and is never distributed on its own.

A text's annotation mode (from proposals or from scratch) is fixed by its
first annotation work. A lead can still change it: the change names whose
submitted work is discarded, revokes the text's assignments and records who
changed it, when and why. Discarded submissions are kept but no longer count
for progress, consolidation inputs, final results or the annotation export;
"Restore…" makes them count again while no new annotation has started. The
work-package export still carries every submission.

Retain the original work package and the distributed application artifact. For
language comparisons, fix the search resources and language selection for each
condition. English remains available in every condition. Historical packages
without recorded search conditions cannot retroactively establish the software
or translation resources used for old searches.

## Preserve search conditions

A package without captured conditions is fixed at its first package-specific
ontology use. Install the intended translations before opening cases or querying
that package's ontologies. Later global translation uploads are available for new
packages; they do not change the resources of a package already captured.

Exports carry content-addressed translation bytes and optional
`manifest.search_conditions`: ontology digest, translation filenames/digests,
index parameters, application artifact identity and Python/numerical-library
versions. The case editor lists languages from those package resources. English
and the selected translations form the fitted search corpus; disabled languages
do not affect its ranks or scores.

Keep the application artifact and its locked environment as well as the export.
New search events refer to their `search_condition_id` and record actual
`execution` conditions, including the fitting languages. `runtime_drift` marks a
difference from the captured software/index conditions. Imported historical
conditions and events retain their original identity; using the same resource
bytes in a different runtime does not establish exact numerical reproduction.
Legacy events remain without this metadata.

If the task profile declares an external ontology rather than embedding it, a
fresh workspace still needs that exact ontology file. Its declared digest is
checked. Captured translations are included in the export and do not require
the importing machine's global translation files.

## Technical pilot with two annotators

1. Choose a small package containing positive findings, a genuine negative
   case, a case without proposals, and a difficult case likely to produce an
   uncertain review. Include at least one repeated or discontinuous mention.
2. Give two annotators their own user accounts and the same original package,
   ontology, application and guideline. The annotator ID is the logged-in
   user's pseudonym, so each person works under their own ID.
3. Each annotator works independently. Before submission, confirm that the
   whole text and each required layer were checked.
4. Reopen one submitted case, make a correction and submit again. Export the
   whole package for each annotator, retaining both exports unchanged.
5. Import one export into a fresh database. Log in as the same annotator, open
   their work and verify that its annotations and evidence are restored.
   Multiple rounds require explicit round selection.
6. Consolidate the two submissions of each case, accept the consolidations
   and create the final export. Check case coverage in `index.csv`, the
   negative and uncertain cases and the corrected case's quoted evidence in
   `findings.csv`, and the two annotators' agreement in `agreement.csv`.

This is a technical acceptance procedure. A clinician pilot is still needed to
assess whether the guideline and workflow produce useful, consistent annotation.

## Results for analysis

Ontotator has no analysis command. The results come as exports, which a
lead creates on the Export page; the research data exports are also
available as `ontotator admin export`, `export-edit-log` and
`export-translation-reviews`:

- **Final export** (ZIP, format `ontotator-final-export/v2`): the accepted
  final result of each text and the work behind it. Its files are described
  below.
- **Annotation results** (T1 bundle): the latest submission of every person,
  mode and text, final or not, for analyses outside the final results.
- **Edit log** (JSONL): one line per edit event in order, with the time (UTC,
  to the second), the text, the person's pseudonym, the working mode, the
  command and the submission it went into. No user or session ids.
- **Translation reviews**: see the
  [translation review export guide](translation-review-export.md).
- **Single-term cases** (ZIP, format `ontotator-final-single-terms/v1`):
  the phrases a single-term review accepted, each with its HPO term and its
  occurrences in the final results; see
  [Single-term review](#single-term-review).

People appear as pseudonyms in every export.

### Files of the final export

| File | Content |
|---|---|
| `README.txt` | Plain-language guide to the archive, with the left-out texts, the texts taken out of the work plan and the warnings acknowledged at export. |
| `index.csv` | One row per selected result (`row_type` `selected`), left-out text (`omitted`), earlier submission the results refer to (`provenance`), other annotation of a text accepted directly (`compared`) and text taken out of the work plan (`planned_out`), naming the bundle file and entry that holds it. |
| `planned-out.csv` | Only when texts were taken out of the work plan: one row per such text with its plan revision, time and reason. |
| `selected-results.ontospan.zip` | The final results as an Ontospan bundle, one unit per result. |
| `provenance-results.ontospan.zip` | The submissions the final results were consolidated or carried from. Not final results. |
| `compared-results.ontospan.zip` | For a text whose result was accepted directly, without consolidation: the other people's latest annotations of it, so that the agreement covers every text. Not final results. |
| `source-texts.jsonl` | The exact text versions, one per line; `source_text_line` in the tables names the line. |
| `findings.csv` | One row per finding of every submission in the two bundles. |
| `agreement.csv` | The agreement of every two annotators on each text. |
| `agreement-summary.csv` | The agreement over the project. |
| `proposals.csv` | Per tool and annotator what became of the tool's proposals, and per tool its precision and recall. |
| `receipt.json` | Audit receipt: selections, warnings, omissions, texts taken out of the work plan (`planned_out`), review decisions, proposal checks, consolidations and the SHA-256 of every other file. |

The CSV files are UTF-8 with a byte order mark and CRLF line ends. Text
positions are Unicode code points into the canonical text of the line of
`source-texts.jsonl` named in `source_text_line`. The tables are computed
from the two bundles, so each row describes what the bundles hold.

An Ontospan bundle of the final export names, per text, the ontology release recorded with its submission,
which can be older than the project's current release. If its texts were made
under different releases, the newest keeps the layer ID and each older release
gets a layer of its own, `<layer id>@<digest prefix>`, with its release and digest.

### Texts taken out of the work plan

A text a lead took out of the work plan, that is, whose annotation was on
and was turned off and stays off at export, is not part of the final
results. So that the exported subset stays documented, the export names it:
`README.txt` lists it under *Taken out of the work plan*, grouped by plan
revision, time and reason (one line per group, then the case IDs), `index.csv` has a
row with `row_type` `planned_out` that fills only `case_id` and `language`,
and `planned-out.csv` (UTF-8 with byte order mark, CRLF) has one row per text
in case and language order:

- `case_id`, `language`: the text;
- `plan_revision`: the revision of the case's work plan the change wrote;
- `planned_out_at`: the time of the change in UTC, for example
  `2026-11-05T10:44:01.000000Z`;
- `reason`: the reason the lead entered in **Plan…**, or the discard reason
  when discarding a translation took it out; empty without one;
- `final_result_kept`: `true` when the text had a final result, which stays
  in Ontotator and is not exported; `false` otherwise.

When a text was taken out more than once, the latest change counts. Texts
that were never in the plan are not listed. The same entries are under
`planned_out` in `receipt.json`. The file is left out when no text was taken
out; an export of a snapshot frozen before this record existed has neither
the rows nor the README section, so its files stay byte-identical.

### findings.csv

One row per finding (annotation) of each unit of `selected-results.ontospan.zip`,
`compared-results.ontospan.zip` and `provenance-results.ontospan.zip`, in the order of `index.csv`:

- the text: `case_id`, `language`, `document_id`, `text_version`,
  `source_text_line`;
- the submission: `row_type` (`selected`, `compared` or `provenance`), `submission_id`,
  `submission_kind`, `archive_file`, `bundle_entry`, `pseudonym`;
- the finding: `annotation_id`, `layer_id`, `term_id`, `term_label` (the
  term's name in the release the text names), `ontology` and
  `ontology_release`;
- one `value_<axis>` column per value field (for example `value_assertion`),
  and `defaulted_values`, the value fields nobody chose (basis `defaulted`),
  joined by `;`;
- `modifiers`: the modifier term IDs, joined by `;`;
- `origin`: how the finding came about. `scratch` for annotation from
  scratch. In a proposal check `confirmed` (a proposal confirmed as it was),
  `changed` (the person's correction of a proposal), `added` (no proposal)
  or `uncertain` (a proposal left uncertain; kept in the bundle with its
  reviewer flag, but no finding of the person). In a result carried to a new
  text version `carried` or `added`. In a consolidation `matched`, `decided`
  or `added`, as under `consolidations` in `receipt.json`;
- `unresolved`: `yes` when the finding carries a reviewer's uncertain flag;
- `mentions`: each passage as `start-end`; the parts of a passage that is
  interrupted are joined by `+`, passages by `;`, for example
  `12-20+31-37;80-88`. `covered_text` quotes the passages in the same way.
  A finding of the whole text without a passage has both empty. The
  positions are authoritative when a quoted passage itself contains `+` or
  `;`.

An annotation whose assertion is `absent` is a finding; a text with no
finding is a checked negative.

### agreement.csv and agreement-summary.csv

`agreement.csv` compares, on each text version, every two annotation
submissions by different people that the bundles hold (annotation from
scratch and proposal checks; consolidations and carried results are no
annotation of their own). For a consolidated text these are the submissions
the consolidation merged, and only those: work submitted on the text after
the consolidation is not compared. For a text whose result was accepted
directly (the selected result is an annotation from scratch or a proposal
check), the export adds the other people's latest live annotations of it
(`compared-results.ontospan.zip`), chosen when the export is prepared as the annotation
results export chooses them, so that texts accepted because everyone agreed
are not left out. A result carried to a new text version gets no compared
annotations; its agreement is that of the earlier work it was carried from.
Proposals a proposal check left uncertain are not counted as findings.

The rows follow the text versions the bundles hold, so a text whose result
was carried or consolidated from work on an earlier version also has rows
for that earlier version (`text_version` and `source_text_line` name it).
They are the agreement behind the text's final result, and for a carried
result the only one; filter on `text_version` to compare one version only.

Each row names the text, both submissions and pseudonyms, and gives the
values of `ontospan.agreement`, the matching Ontotator's consolidation and the
ontospan benchmark share. Findings pair only within a layer, one to one, by
an optimal assignment:

- `annotation_strict_f1`: same term, values and passages;
- `annotation_tolerant_f1`: same term and values, overlapping passages (a
  finding of the whole text and one with a passage also match);
- `mention_strict_f1`, `mention_tolerant_f1`: the same per passage;
- `term_f1`: the sets of terms with their values, regardless of passages;
- `modifier_agreement`: the share of matched findings with the same
  modifiers, empty without matched findings.

The counts behind them follow: `findings_a`, `findings_b`, `equal`,
`compatible`, `axis_conflicts` (same term, other values), `term_conflicts`
(other term on overlapping text), `a_only`, `b_only`, the mention and term
counts, `modifiers_compared`, `modifiers_agreeing` and
`related_term_conflicts`: those `term_conflicts` whose terms are ancestor
and descendant in the layer's ontology ("Seizure" and "Focal seizure"). It
only flags the smaller disagreement; every F1 value counts such a pair as a
term conflict, as before. Two submissions without findings agree (F1 1).

`agreement-summary.csv` has two rows. `macro_mean` averages each value over
the pairs of a text, then over the texts. `pooled` computes each value from
the counts summed over all pairs (micro average) and lists those sums.
Without any pair (for example when every text had one annotator), both rows
have `pairs` 0 and empty values.

The same figures are available before an export: `GET
/api/v1/projects/{key}/agreement` (token scope `read`; leads only, like the
final export, because it names the annotators) computes them with the same
code for the current final results. Its `summary` and `pairs` are the rows of
the two files (unrounded, without `source_text_line`); `annotator_pairs` and
`texts` apply the summary to the pairs of two people and of one text. The MCP
tool `agreement_summary` reads it.

Only F1 values are given. Span annotation has no countable negatives (every
place in a text where nobody marked anything would be one), so chance-corrected
coefficients such as Cohen's kappa are not defined for it. Define in the study
protocol which value is the primary measure; ontology-aware matching (an
ancestor term as a partial match) is not part of these values;
`related_term_conflicts` counts such pairs without changing them.

### proposals.csv

Rows of `row_type` `annotator`, one per tool, tool version and person, count
the person's proposal checks in the bundles: `submissions`, `proposals` (the
proposals decided), `confirmed`, `rejected`, `changed` and `uncertain` (the
decision words of Ontotator; `receipt.json` writes `corrected` for
`changed`), and `added`, the findings the person added without a proposal.
`tool` and `tool_version` are the name and version of the proposal's actor
as the imported bundle recorded them (the actor ID when it had no name). A
round on a text without proposals counts its findings under an empty tool.

Rows of `row_type` `source`, one per tool and version, compare the tool's
proposals on each text with that text's selected final result, using the
tolerant matching of `agreement.csv`: `texts` (texts with a selected result
on which the tool had the chance to propose), `proposals`, `final_findings`,
`matched`, `precision` (`matched / proposals`) and `recall`
(`matched / final_findings`), pooled over the texts. The tool had the chance
on a text when an imported proposal set of that text names it as a tool
actor. A text where it proposed nothing in that set still counts: with no
proposals, all its final findings are misses, so recall is not overstated by
leaving out the texts the tool was silent on. This includes a unit whose tool
set holds no finding at all: the import keeps no proposal set for it (the
text is imported without proposals), but records that the set's tools ran
there. Such a record of an earlier version of a corrected text also counts
for the correction, as the reanchored proposals of a set with findings do.
Texts imported before this record existed (before migration 0032) count only
through their stored proposal sets: there a tool's silent texts are missing
from its recall. Proposals on texts without a selected result in the export
are not compared, nor are texts where the tool did propose but no proposal
check worked on its proposals.

Preserve uncertain targets and ambiguous branches for adjudication. Hashes
establish content identity; the annotator ID is the logged-in user's
pseudonym, so it names the account that did the work.

## Undo, redo and reset in the edit log

The edit log (**Export** › **Research data** › **Edit log**, or
`ontotator admin export-edit-log`) has one line per edit event in order. The
commands of one user action share a `step_id`. An undo, redo or reset in the
editor is an event of its own (`undo_step` and `redo_step` with the `step`
they take back or bring back, `reset_changes`), and its `state` is the content
it put back; earlier events are never changed.

## Working time

A project records working time only when its lead ticks **Record working time**
(Settings › Workflow, off by default). Annotation and translation review tasks
then count the person's active time; consolidations are not timed. An interval
starts when the task opens, or on the first input after a pause, and ends when
the editor pauses: after 3 minutes without keyboard, pointer, scroll or
selection input (`idle`, the 3 minutes count as reading time), when the tab is
hidden (`hidden`), on **Pause timer** (`manual_pause`) or when the task is left
(`closed`). The server's receipt times are the start and end; the browser's
clock only orders a batch. An interval never ends later than 4 minutes (one
heartbeat gap plus the idle threshold) after its last heartbeat; one whose
heartbeats stopped, for example a closed laptop, ends at its last heartbeat as
`lost`. Time a browser spent offline is therefore not counted.

Export it from **Export** › **Research data** › **Working time**
(`<project>-work-time-<timestamp>.jsonl`). Like the edit log it is pseudonymised: `annotator` is the
person's pseudonym and the file holds no user, session or assignment ids. One
line per closed interval, in the order the server recorded them:

```json
{"record":"interval","interval":12,"annotator":"ann-0003","document_id":"EN100017","task":"annotate","mode":"scratch","started_at":"2026-11-03T09:00:00Z","ended_at":"2026-11-03T09:12:41Z","active_seconds":761,"end_reason":"idle"}
```

followed by one active total per annotator, text, task and mode:

```json
{"record":"task_total","annotator":"ann-0003","document_id":"EN100017","task":"annotate","mode":"scratch","intervals":3,"active_seconds":1405}
```

`mode` is `proposals` or `scratch` for annotation and `translation_review` for a
review. Times are UTC to the second; `active_seconds` is rounded per line, so
the total is computed before rounding. Working time is a measure of effort, not
of quality: compare modes and texts in the study protocol, and keep in mind that
reading without input counts for at most 3 minutes at a time.

## Annotation from proposals in the export

In an "Annotate from proposals" round the person goes through the tool's
proposals one by one, confirms, rejects or corrects each, and adds the findings
the tool missed. In the final export these submissions have
`submission_kind` `proposal_check` in `index.csv`. `receipt.json` holds their
decisions under `proposal_checks`, keyed by submission ID:

- `proposal_set`: the tool proposal set the round worked on (`id` and
  `annotation_set_id`; `null` values for seed proposals without a set).
- `decisions`: one entry per proposal with `proposal_ref` (the proposal's
  URN), `proposal_annotation_id`, `proposal_version`, `decision` (`confirmed`,
  `rejected`, `corrected` or `uncertain`), `corrected_annotation_id` (the
  corrected finding, for `corrected`) and `note`.
- `added_annotation_ids`: findings the person added that are not proposals.
- `counts`: the number of each decision and of added findings.

The proposals of a round are the **newest proposal set of the document when the
round was created**. A set without any finding is never that set: a later run
of a tool that found nothing on the text leaves the proposals of the earlier
set as the targets. Older sets on the same document are never targets and are
not in the record. A later import does not change an existing round; its
proposals only become targets of rounds created after it.

`proposals.csv` gives the counts per tool and person ready made. A precision
from the decisions alone is computed per proposal set: group the records by
`proposal_set.annotation_set_id` and compute
`confirmed / (confirmed + rejected + corrected)`. A corrected proposal counts as
not exact. `uncertain` decisions are reported separately and left out of
precision. Added findings are what the tool missed. The precision in
`proposals.csv` instead compares the proposals with the final result.

## Consolidated findings in the export

Since export format `ontotator-final-export/v2` (the `format` field of
`receipt.json`), the receipt tells how each finding of a consolidation came
about. In the Ontospan bundle every such finding has provenance method `merged`, so
the bundle alone cannot tell an automatically taken-over match from a
consolidator's decision. `receipt.json` holds `consolidations`, keyed by the
submission ID of every consolidation in the archive (selected and
provenance-only):

- `consolidator`: the consolidator's pseudonym (the submission's author).
- `findings`: one entry per finding of the submission, in bundle order, with
  `annotation_id`, `version` and
  - `origin`: `matched` (every annotator marked the same finding; it was taken
    over automatically and not changed), `decided` (the consolidator resolved
    the group, or changed a taken-over finding) or `added` (the consolidator
    added it outside the groups);
  - `decision`: the group's consolidation action, `auto`, `keep` or `choose`;
    `null` for `added` findings and for findings decided in the editor
    without the consolidation view;
  - `edited`: the finding was changed after its group was resolved;
  - `guidelines_unclear`: the consolidator flagged the group;
  - `decision_ids`: the review decisions (under `review_decisions`) that
    produced the finding.
- `counts`: the number of `matched`, `decided` and `added` findings.

The record is derived from the consolidation's stored decisions at export
time, so it is also complete for consolidations submitted before v2. Version
v1 receipts have no `consolidations`; the decisions' `consolidation.action`
under `review_decisions` holds the same information per group there.

## Phenopackets of the final results

The final export can also be created as Phenopackets (export format
`ontotator-final-phenopackets/v1`, the `format` field of `receipt.json` and
`report.json`). It is derived from the same frozen snapshot as the final
export, with the conversion of ontospan (`ontospan.phenopacket`), and is lossy
by design. The complete selected results travel with it:

- `phenopackets/NNNNN.json`: one Phenopacket v2 (protobuf JSON) per selected
  result. `id` and `subject.id` are the text's exported `document_id`. Texts
  are not grouped by patient: Ontotator has no patient identity.
- `reports/NNNNN.json`: for the Phenopacket of the same number, the case,
  language, submission ID and `ontospan_report`, ontospan's counts of what it
  exported and left out (`omitted_family`, `omitted_other_person`,
  `omitted_unknown_experiencer`, `omitted_uncertain`, `skipped_other_layers`,
  plus `historical` and `frequency_modifiers` for exported findings that lose
  meaning). `left_out_unresolved` counts findings left unresolved in
  consolidation: Phenopackets cannot hold a reviewer resolution, so Ontotator
  leaves them out before the conversion.
- `report.json`: every text's record and the `totals`.
- `selected-results.ontospan.zip`: the selected results as an Ontospan bundle
  (bundle ID `selected-<snapshot ID>`). It is written with the same serializer,
  bundle ID and time (the snapshot's) as the selected results of the final
  export of the same snapshot, so the two files are byte for byte the same.
  `receipt.json` names it under `selected_results` and lists its SHA-256 under
  `files`, like every other file.

Uncertain assertions are not included (ontospan's default). Each feature's
evidence has a reference id of the form
`urn:ontospan:selected-<snapshot ID>:<set ID>:<annotation ID>`, each part
percent-encoded (`ontospan.parse_annotation_ref` decodes it), which names its
finding (annotation set and annotation) in `selected-results.ontospan.zip` of
the same ZIP.

Time is carried over only as ontospan converts it. A feature's `onset` is
filled only from an HPO onset modifier of the finding (a term under *Onset*,
HP:0003674); nothing else sets a time. The temporality axis is not represented:
a historical finding becomes a feature like a current one, since a Phenopacket
cannot say "in the past", and `historical` counts these findings per text. The
temporality of each finding stays in `selected-results.ontospan.zip`.

On the command line, `ontotator admin export PROJECT OUT.zip --format phenopacket` exports the
Phenopackets of the project's newest final-result snapshot.

## Single-term review

A single-term review asks, after the final results are accepted, whether
each annotated phrase maps to its HPO term on its own, without its sentence.
Its output is a set of phrase-term cases, for example for testing how a
tool maps short phrases. It is optional (Settings › Workflow, off by
default, not available in practice projects) and runs outside annotation
and consolidation: it never changes a submission or a final result. The
handbook chapter [Lead: single-term review](handbook/lead-single-terms.md)
describes the screens.

### Candidates and groups

A lead freezes the current final results as a *review basis* (a final-result
snapshot, made with the same code as the final export). The candidates are
derived from the selected results of that snapshot with the conversion of
the final export, so they are exactly the findings of
`selected-results.ontospan.zip`. Each mention of a finding is one
*occurrence*. The rules, in the order they apply:

| Rule | Result |
|---|---|
| Not an HPO phenotype layer | excluded `other_layer` |
| Assertion other than present | excluded `not_present` |
| Experiencer other than the patient | excluded `not_patient` |
| Left unresolved in consolidation | excluded `unresolved` |
| Finding without a mention (document level) | excluded `no_span` |
| Mention of more than one segment | excluded `discontinuous` |
| Another finding of the same result has a mention with exactly this span | excluded `shared_span` |
| Term obsolete or unknown in the result's release | excluded `obsolete_term` |
| Span overlaps or contains a segment of another finding (any assertion) | blocked `contains_other_finding` |
| Span contains a negation cue of its language (whole word, any case) | blocked `negation_in_span` |
| A modifier segment overlaps the span | flag `modifier_in_span` |
| Term not under *Phenotypic abnormality* (HP:0000118) | flag `outside_phenotypic_abnormality` |

"Another finding" is another finding of an HPO phenotype layer of the same
result; uncertain proposal-check targets are not findings. Temporality is
not a rule. A rule for non-verbalised measurements is not applied: neither
the task profile nor a finding marks a measurement. Negation cues are set
per language by the lead; an empty list blocks nothing.

Occurrences form a group by `(language, phrase, term)`. The phrase is the
covered text without soft hyphens, with runs of whitespace collapsed to one
space, in Unicode NFC and lower case (Python `str.lower`, so "ß" stays "ß").
The group ID is the SHA-256 of `ontotator-single-term-group/v1` and the
canonical JSON of the key, so the same phrase and term keep the same ID
across bases. A group shows its most frequent surface form (ties:
lexicographic) and keeps every surface form with its count. Groups of the
same language and phrase with different terms are in a *phrase conflict*.

### Review and decisions

A lead gives groups to reviewers in batches. Reviewers are members the lead
grants the single-term reviewer capability, or leads. A batch freezes the
group IDs it holds when it is created. The optional blind second review
draws, per language, a share of the batch (20 % by default, at least 50
groups or all if fewer), chosen by the group IDs' hash, so the sample is
repeatable; it goes to a different reviewer, who does not see the first
decision. If a reviewer annotated or consolidated any text of a group, their
decision on it records `reviewer_independent=false`.

For each group, the reviewer records a phrase-only judgment (`would_accept`
or `would_reject`) to the question "Would a clinician map this phrase alone,
without its sentence, to this term?" before any context is shown. Then they
read up to five occurrences (more on request) with 200 code points of text
on either side, and decide:

- `accept`: the phrase as annotated with the annotated term;
- `adjust_span`: a verbatim re-cut of one occurrence. The new span must
  overlap the annotated one, overlap no other finding and contain no
  negation cue;
- `adjust_term`: a more general term, which must be an active ancestor of
  the annotated term in the release of every occurrence;
- `reject` with a reason: `needs_context`, `ambiguous_abbreviation`,
  `too_general`, `term_wrong_out_of_context`, `contains_other_finding`,
  `negation_in_span`, `conflict` (only for groups in a phrase conflict) or
  `other`;
- `withdrawn`: takes back the decision and opens the group again.

One adjustment per decision; no free-text rewrite. A blocked group accepts
only `adjust_span` or `reject`. In a phrase conflict at most one group can be
accepted; the others are rejected with `conflict`, or all are rejected. The
newest decision per group and role counts. Decisions count as soon as they
are recorded; those of an abandoned batch no longer count. Reviewers never see
annotator or consolidator pseudonyms, tool proposals or working time, and
decisions record no working time. A term that is wrong in its context is a
final-result error, corrected through a problem report on the text, not a
single-term decision.

Second-review agreement compares the newest primary and second decision of
each group reviewed twice, with `accept`, `adjust_span` and `adjust_term`
counted as acceptance and `reject` as rejection: the percentage of agreeing
pairs and Cohen's kappa (`null` when chance agreement is certain).

### Repeatability

When the lead refreshes the basis, decisions carry over by group ID. A
decision stays valid while its group exists and its term, and an adjusted
term, is present and not obsolete in the release of every occurrence.
Otherwise the group is *stale* and opens again. It is stale too when an
accepted group has become blocked, when the re-cut occurrence of an
`adjust_span` is gone, or when an adjusted term is no longer an ancestor.
An occurrence that is new in a decided group inherits the decision and is
marked `seen_by_reviewer=false`. A group is `open`, `blocked` (open, but not
acceptable as it is), `decided` or `stale`. A new basis opens only new and
stale groups.

Bases, batches and decisions are append-only (the database refuses updates
and deletions); only the batch state (open, submitted, abandoned) changes.
Each basis stores the SHA-256 of its derivation, and a recomputation with a
different digest is refused. Every step is in the project audit.

### Files of the single-term export

The single-term export (Export › Final results › Format › *Single-term cases
(reviewed phrases)*, or `ontotator admin export PROJECT OUT.zip --format
single-term` for the newest final export made while the review was on;
format `ontotator-final-single-terms/v1`) freezes a final-result snapshot like
the final export and adds to it the decisions in force at the request (their
IDs, SHA-256 and the negation cues). A decision recorded later is not in the
file; the same snapshot always gives the same bytes. The candidates are
derived from the snapshot again and the newest frozen primary decision of
each group applies.

| File | Content |
|---|---|
| `README.txt` | Plain-language guide to the archive, with the snapshot, the number of decisions and their SHA-256. |
| `cases.jsonl` | One case per line: a phrase that alone maps to an HPO term, with its occurrences and the review. |
| `report.json` | Counts: exclusions per rule and language, blocked and conflict groups, groups per state, decisions per kind and reject reason, second-review agreement and the yield per language. |
| `selected-results.ontospan.zip` | The selected final results as an Ontospan bundle, byte for byte the same file as in the final export of the same snapshot; every `annotation_ref` points into it. |
| `source-texts.jsonl` | The exact text versions, one per line, as in the final export. |
| `receipt.json` | Format, snapshot ID and SHA-256, the frozen decision IDs and their SHA-256, the negation cues, selections, omissions, texts taken out of the work plan and the SHA-256 of every other file. |

Only groups whose decision is `accept`, `adjust_span` or `adjust_term` become
cases; open, blocked, stale and rejected groups are only counted. `accept`
and `adjust_term` write every occurrence of the group; `adjust_span` writes
only the re-cut occurrence, with its new span, since the others were not
judged in that cut. Cases with the same language, normalised text and final
term merge into one. A case of `cases.jsonl` holds:

- `case_id`: SHA-256 of `ontotator-single-term-case/v1` and the canonical
  JSON of `(language, normalised text, HPO ID)`;
- `language`, `text` (the most frequent surface form), `surface_variants`
  (each form with its count);
- `text_origin`: `verbatim`, or `span_adjusted` when every occurrence comes
  from a re-cut; `hpo_id`, `term_label` and `hpo_origin`: `annotated`, or
  `generalised` when every occurrence carries a more general term;
- `flags`: `modifier_in_span`, `outside_phenotypic_abnormality`;
- `occurrences`: per occurrence `document_id`, `source_text_sha256`,
  `text_version`, `source_text_line`, `start` and `end` (Unicode code points
  into the text of that line of `source-texts.jsonl`), the written `text`
  and the annotated span and term, `annotation_ref`
  (`urn:ontospan:selected-<snapshot ID>:<set ID>:<annotation ID>`, as in the
  Phenopackets), `axes`, `modifiers`, `ontology_release`, `ontology_digest`,
  the `decision_id` it came from and `seen_by_reviewer`;
- `review`: `decision_id`, `group_id`, `phrase_only`, `decision`, `reason`,
  `original_text`, `original_term`, `reviewer` (`ontotator:<pseudonym>`),
  `reviewer_independent`, `guideline_version`, `guideline_sha256` and
  `decided_at` (UTC, to the second), with `second_review` (the second
  decision and whether it agrees) for a sampled group; `merged_reviews`
  lists the reviews of further groups merged into the case.

A generalised term that is active but no ancestor of the annotated term in
the release of one occurrence fails the job with `SINGLE_TERM_MIXED_RELEASE`;
one absent or obsolete in a release makes the group stale.
