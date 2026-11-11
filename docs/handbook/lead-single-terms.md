# Lead: single-term review

This chapter is for project leads and for the members they ask to review single terms. A single-term review checks, after the final results are accepted, whether each annotated phrase maps to its term on its own, without the sentence around it. The accepted phrases are exported as single-term cases. Back to the [lead overview](lead.md).

The review runs after annotation and consolidation and changes neither: it does not touch submissions, consolidations or final results. A wrong term in its context is a mistake in the final result; correct it there (see [Term wrong in its context](#term-wrong-in-its-context)).

## How the review works

(accept final results →) open **Single terms** → create review batches → reviewers decide → export the single-term cases

1. Review basis: when you open **Single terms**, Ontotator freezes the accepted final results as the review basis, and freezes them anew whenever they have changed since. It takes every finding of an HPO phenotype layer in them and leaves out those that cannot stand alone as a phrase (see [Findings not offered](#findings-not-offered)).
2. Groups: the places where the same phrase was annotated with the same term, in one language, form a group. Case, soft hyphens and runs of spaces do not count: *Short stature* and *short  stature* are one group. A reviewer decides a group once, for all its places.
3. Batches: you give open groups to one project member as a review batch, optionally with a blind sample for a second reviewer.
4. Decisions: for each group, the reviewer first judges the phrase alone, then reads up to five of its places in their texts, then accepts, adjusts or rejects it. A batch is done when every group in it is decided.
5. Changed results: decided groups keep their decision when the basis is frozen anew; only new and stale groups open again.
6. Export: on **Export**, the format **Single-term cases (reviewed phrases)** writes the accepted groups.

## Turn on the single-term review

What for: offer the review in a project. It is off by default and cannot be turned on in a practice project.

1. Open **Settings**, tab **Workflow**, and go to the card **Single-term review**.
2. Tick **Review single terms of the final results**.
3. Click the **Save changes** button of the card.

The sidebar then shows **Single terms** to you, and to every member who has a review batch. Every project member may review; there is nobody to choose beforehand. Turning the setting off hides the page and the export format; the basis, batches and decisions stay stored and come back when you turn it on again. The change is recorded in the project audit.

## The Single terms page

What for: see what is left to review and hand out batches.

1. In the sidebar, click **Single terms**.

The review starts once at least one final result is accepted; until then the page says so. The first time you open it after that, and whenever the accepted final results have changed since, the page freezes them as a new review basis. The line under the heading names the date of the basis.

The page shows, per language, the groups and how many are decided, open, stale and blocked. A warning line names the groups in a phrase conflict and the blocked groups still to re-cut or reject; it disappears once they are decided. Below it are the agreement of the second blind review, the review batches and, per language, the findings that were not offered.

A decision carries over to a new basis while its group still exists and its term (and the more general term, if the reviewer chose one) is still active in the ontology release of every place. Otherwise the group is **stale**: it counts as open again and goes into the next batch. A place that is new in a decided group takes the decision over; the export marks it as not seen by the reviewer.

### Findings not offered

These findings are left out of the review. The page counts them per rule and language:

| Rule | Left out |
| --- | --- |
| not an HPO layer | Findings of other layers. |
| assertion not present | Absent or uncertain findings, negated ones included. |
| experiencer not patient | Findings about family members or other persons. |
| left unresolved | Findings left unresolved in consolidation. |
| whole-text finding | Findings without a text passage. |
| discontinuous passage | A mention of several separate pieces of text. |
| span shared with another term | Another finding of the same text has exactly this passage. |
| obsolete term | The term is obsolete or unknown in the release of the text. |

One more rule does not leave a group out but blocks it: its passage overlaps another finding of the text (*contains other finding*). A blocked group can only be re-cut or rejected. A negation inside the passage blocks nothing: when the term itself names it, as in *Gehen nicht möglich* for *Inability to walk*, it belongs in the passage. Two flags only inform the reviewer: a modifier lies inside the passage, or the term is outside *Phenotypic abnormality* (HP:0000118).

## Create a review batch

What for: give open groups to one reviewer.

1. On **Single terms**, click **New review batch…**.
2. Choose the **Reviewer**: any member of the project, you included.
3. Choose the **Language**, or keep **All languages**. The hint below counts the open groups a new batch can take, stale ones included; groups already in another open batch are left out.
4. Optionally, enter **At most this many groups (optional)** to keep the batch small.
5. For a check of the reviewers' agreement, tick **Draw a sample for a second reviewer** and choose a **Second reviewer**, who must be another person. The sample is 20 % of the batch's groups per language, at least 50, or all if there are fewer. It follows from the group IDs, so the same groups give the same sample.
6. Click **Create batch**.

Creating a batch first freezes the final results anew if they have changed. The groups of the batch are fixed when you create it. If the reviewer annotated or consolidated one of the texts of its groups, a message says so; the batch is still created, and their decisions on those groups are marked as not independent in the export.

Tell the reviewer that the batch is waiting: they find it under **My tasks**, in the table **Single-term review**, and under **Single terms**. The second reviewer gets a batch of their own and does not see the first reviewer's decisions.

## Follow batches

The table **Review batches** shows each batch with its groups, reviewer, progress and state: **open**, **done** (every group decided) or **abandoned**.

- **Continue** or **Open** shows the batch as its reviewer sees it; a batch of another person is read-only for you.
- **Abandon…** ends a batch you no longer want. Its decisions stop counting and its groups open again for a new batch. This cannot be undone.

A decision counts as soon as the reviewer records it; there is nothing to submit. To change a decision, the reviewer opens the group and clicks **Undo**, then decides again: the newest decision counts. A group the reviewer has decided can go into a later batch when it becomes stale.

Under the counts, the page shows the agreement of the second blind review: how many groups were reviewed twice, the share of agreeing decisions and Cohen's kappa (κ) with its reading in words: *slight* (up to 0.20), *fair* (up to 0.40), *moderate* (up to 0.60), *substantial* (up to 0.80) or *almost perfect* (above), after Landis and Koch. Accepting and adjusting count as acceptance, rejecting as rejection.

## Review a batch

What for: decide each group of your batch. This part is for every reviewer, leads included.

1. On **My tasks**, click **Start** or **Continue** at your batch under **Single-term review**, or in the sidebar click **Single terms**, then **Continue** at your batch. The groups are listed on the left; the buttons above the list show the open, conflicting, blocked and decided groups.
2. **Step 1 · Phrase only**: read the phrase and its term and answer the question *Would a clinician map this phrase alone, without its sentence, to this term?* Click **Yes, as a phrase** (`Y`) or **No** (`N`). The answer is recorded before you see any context.
3. **Step 2 · Contexts**: read the phrase in up to five of its places, with some text before and after. **Show more contexts** loads further places.
4. **Step 3 · Decision**:
   - **Accept** (`A`): the phrase alone means this term.
   - **Adjust…** (`E`): re-cut the passage or choose a more general term; see [Adjust a group](#adjust-a-group).
   - **Reject** (`R`): choose a reason first: *needs context*, *ambiguous abbreviation*, *too general*, *only usable rewritten (words inside removed)* (the phrase would map alone only without some words inside it; a re-cut keeps those words) or *other*.

   **Note (optional)** adds a comment to the decision.
5. A decided group shows its decision: for a re-cut the new phrase, for a more general term its name. **Undo** after a decision opens the group again. The newest decision of a group counts.

When every group is decided, the batch says it is done; nothing else is needed. The phrase stays as it is in the text: there is no way to rewrite it. Your judgment is about the phrase alone; whether the finding was right in its sentence was decided in annotation and consolidation.

### Adjust a group

One adjustment per decision: re-cut the passage or generalise the term, not both.

- **Re-cut the span**: choose the place under **Occurrence** if there are several, then click the first and the last word of the new passage, or drag over them. The new passage must overlap the annotated one, stay within the text and overlap no other finding; the server checks this. Only this one place goes into the export, with the new passage.
- **Or generalise the term**: choose one of the more general terms listed under the annotated term, nearest first; the nearest are marked *(parent)*. Only terms that are active ancestors of the annotated term in the release of every place of the group are listed, never *All*, the branches directly under it such as *Phenotypic abnormality*, or the organ-system terms directly under *Phenotypic abnormality* such as *Abnormality of the nervous system*. A more general term does not lift a block.

**Resulting case** shows what will be exported. Click **Accept adjusted case**, or **Cancel**.

### Blocked groups

A blocked group cannot be accepted as it is. Re-cut it so that the passage no longer overlaps the other finding, or reject it.

### Phrase conflicts

The same phrase in one language was annotated with several terms. A case gets exactly one term. Answer step 1 by choosing the term the phrase alone maps to, or **None of them**. Then click **Use this term** at the right group: the other groups of the phrase are rejected with the reason *conflict*, which is set only this way. **Reject all: needs context** rejects every group of the phrase. **Undo these decisions** opens them again.

### Term wrong in its context

If a place shows that the finding itself is wrong, the final result of that text has an error. Do not reject the phrase for that. A lead corrects the final result through a problem report on the text ([Decide on a problem report](lead-results.md#decide-on-a-problem-report), [Change a final result](lead-results.md#change-a-final-result)); reviewers ask a lead to do so. After the correction, the next time a lead opens **Single terms** the basis is frozen anew.

## Export the single-term cases

What for: download the phrases the review accepted, as cases for analysis.

1. On **Export**, card **Final results**, choose **Single-term cases (reviewed phrases)** under **Format**. The format is offered while the single-term review is on.
2. Click **Create final export**, then **Download (ZIP)** when it is ready.

The export freezes the current final results and the decisions recorded until you click; later decisions go into a new export. Each case is a phrase with its HPO term and every place it occurs in the selected results. Only accepted and adjusted groups are cases; open, blocked, stale and rejected groups are only counted in report.json, as are the findings not offered and the second-review agreement. The ZIP also holds the selected results as an Ontospan bundle, the same file as in the results with receipt of the same check, and the texts. The files are described in the [scientific workflow guide](../scientific-workflow.md#single-term-review).

An operator can create the same file on the command line with `ontotator admin export PROJECT OUT.zip --format single-term`, from the newest final export. It is refused if that export was made while the review was off: then a lead creates a new final export first.
