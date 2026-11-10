# Lead: single-term review

This chapter is for project leads and for the members they ask to review single terms. A single-term review checks, after the final results are accepted, whether each annotated phrase maps to its term on its own, without the sentence around it. The accepted phrases are exported as single-term cases. Back to the [lead overview](lead.md).

The review runs after annotation and consolidation and changes neither: it does not touch submissions, consolidations or final results. A wrong term in its context is a mistake in the final result; correct it there (see [Term wrong in its context](#term-wrong-in-its-context)).

## How the review works

(accept final results →) start the review basis → create review batches → reviewers decide → refresh the basis later → export the single-term cases

1. Review basis: you freeze the current final results. Ontotator takes every finding of an HPO phenotype layer in them and leaves out those that cannot stand alone as a phrase (see [Findings not offered](#findings-not-offered)).
2. Groups: the places where the same phrase was annotated with the same term, in one language, form a group. Case, soft hyphens and runs of spaces do not count: *Short stature* and *short  stature* are one group. A reviewer decides a group once, for all its places.
3. Batches: you give a part of the open groups to one reviewer as a review batch, optionally with a blind sample for a second reviewer.
4. Decisions: for each group, the reviewer first judges the phrase alone, then reads up to five of its places in their texts, then accepts, adjusts or rejects it.
5. Refresh: when more final results are accepted or results change, you refresh the basis. Decided groups keep their decision; only new and stale groups open again.
6. Export: on **Export**, the format **Single-term cases (reviewed phrases)** writes the accepted groups.

## Turn on the single-term review

What for: offer the review in a project. It is off by default and cannot be turned on in a practice project.

1. Open **Settings**, tab **Workflow**, and go to the card **Single-term review**.
2. Tick **Review single terms of the final results**.
3. Under *Negation cues, German* (one field per language of the project), enter the words that negate a finding in that language, one per line, for example *no*, *not* and *without* for English. A phrase that holds one of them as a whole word, in any case, is blocked: it can only be re-cut or rejected.
4. Click the **Save changes** button of the card.

The sidebar then shows **Single terms** to you and to the single-term reviewers. Turning the setting off hides the page and the export format; the basis, batches and decisions stay stored and come back when you turn it on again. The change is recorded in the project audit.

## Choose the single-term reviewers

What for: let members review single terms. Leads review without being chosen.

1. Open **Settings**, tab **People**. The card **Single-term reviewers** is shown while the review is on.
2. Tick a member to let them review, untick to stop. Each change saves at once and is recorded in the project audit.

Reviewers see only the places of the groups in their own batches, never who annotated or consolidated them and never tool proposals. They see their own decisions only.

## Start or refresh the review basis

What for: freeze the final results the groups are derived from.

1. In the sidebar, click **Single terms**.
2. Click **Start single-term review**. Once a basis exists, the button reads **Refresh review basis**.

You need at least one accepted final result. The page then shows, per language, the groups, how many are decided, open, stale and blocked, and how many are in a phrase conflict. A warning line names the conflicts and the blocked groups still to re-cut or reject; it disappears once they are decided. Below it are the review batches, across the full width, and, per language, the findings that were not offered.

Refresh the basis after you accepted or changed final results. A decision carries over to the new basis while its group still exists and its term (and the more general term, if the reviewer chose one) is still active in the ontology release of every place. Otherwise the group is **stale** and opens again. A place that is new in a decided group takes the decision over; the export marks it as not seen by the reviewer.

### Findings not offered

These findings are left out of the review. The page counts them per rule and language:

| Rule | Left out |
| --- | --- |
| not an HPO layer | Findings of other layers. |
| assertion not present | Absent or uncertain findings. |
| experiencer not patient | Findings about family members or other persons. |
| left unresolved | Findings left unresolved in consolidation. |
| whole-text finding | Findings without a text passage. |
| discontinuous passage | A mention of several separate pieces of text. |
| span shared with another term | Another finding of the same text has exactly this passage. |
| obsolete term | The term is obsolete or unknown in the release of the text. |

Two more rules do not leave a group out but block it: its passage overlaps another finding (*contains other finding*), or it holds a negation cue (*negation in span*). A blocked group can only be re-cut or rejected. Two flags only inform the reviewer: a modifier lies inside the passage, or the term is outside *Phenotypic abnormality* (HP:0000118).

## Create a review batch

What for: give a part of the open groups to one reviewer.

1. On **Single terms**, click **New review batch…**.
2. Choose the **Language** (or **All languages**) and the **Layer** (or **All HPO layers**).
3. Under **Groups**, choose **All open and stale groups** or **Groups with occurrences in chosen texts** and enter the **Text IDs**. **At most this many groups (optional)** limits the batch. Groups already in another open batch are left out; the number in brackets counts only the groups a new batch can still take.
4. Choose the **Reviewer (single-term reviewers)**.
5. For a check of the reviewers' agreement, tick **Draw a sample for a second reviewer**, keep or change the **Share (%)** (20 % by default) and choose a **Second reviewer**, who must be another person. The sample has at least 50 groups per language, or all if there are fewer. It follows from the group IDs, so the same groups give the same sample.
6. Click **Create batch**.

The groups of the batch are fixed when you create it. If the reviewer annotated or consolidated one of the texts of its groups, a message says so; the batch is still created, and their decisions on those groups are marked as not independent in the export.

Tell the reviewer that the batch is waiting: they find it under **My tasks**, in the table **Single-term review**, and under **Single terms**. The second reviewer gets a batch of their own and does not see the first reviewer's decisions.

## Follow and close batches

The table **Review batches** shows each batch with its groups, reviewer, progress and state:

- **Continue** or **Open** shows the batch as its reviewer sees it; a batch of another person is read-only for you.
- **Reopen** opens a submitted batch again, for example after the reviewer asked to change a decision.
- **Abandon…** ends a batch you no longer want. Its decisions stop counting and its groups open again for a new batch. This cannot be undone.

A decision counts as soon as the reviewer records it, before the batch is submitted. Under the counts, the page shows the agreement of the second blind review: how many groups were reviewed twice, the share of agreeing decisions and Cohen's kappa. Accepting and adjusting count as acceptance, rejecting as rejection.

## Review a batch

What for: decide each group of your batch. This part is for every single-term reviewer, leads included.

1. On **My tasks**, click **Start** or **Continue** at your batch under **Single-term review**, or in the sidebar click **Single terms**, then **Continue** at your batch. The groups are listed on the left; the buttons above the list show the open, conflicting, blocked and decided groups.
2. **Step 1 · Phrase only**: read the phrase and its term and answer the question *Would a clinician map this phrase alone, without its sentence, to this term?* Click **Yes, as a phrase** (`Y`) or **No** (`N`). The answer is recorded before you see any context.
3. **Step 2 · Contexts**: read the phrase in up to five of its places, with some text before and after. **Show more contexts** loads further places.
4. **Step 3 · Decision**:
   - **Accept** (`A`): the phrase alone means this term.
   - **Adjust…** (`E`): re-cut the passage or choose a more general term; see [Adjust a group](#adjust-a-group).
   - **Reject** (`R`): choose a reason first: *needs context*, *ambiguous abbreviation*, *too general*, *term wrong out of context*, *contains other finding*, *negation in span*, *only usable rewritten (words inside removed)* (the phrase would map alone only without some words inside it; a re-cut keeps those words) or *other*.

   **Note (optional)** adds a comment to the decision.
5. A decided group shows its decision: for a re-cut the new phrase, for a more general term its name. **Undo** after a decision opens the group again. The newest decision of a group counts.
6. When every group is decided, click **Submit batch**. A lead can reopen it.

The phrase stays as it is in the text: there is no way to rewrite it. Your judgment is about the phrase alone; whether the finding was right in its sentence was decided in annotation and consolidation.

### Adjust a group

One adjustment per decision: re-cut the passage or generalise the term, not both.

- **Re-cut the span**: choose the place under **Occurrence** if there are several, then click the first and the last word of the new passage, or drag over them. The new passage must overlap the annotated one, stay within the text, overlap no other finding and hold no negation cue; the server checks this. Only this one place goes into the export, with the new passage.
- **Or generalise the term**: choose one of the more general terms listed under the annotated term, nearest first; the nearest are marked *(parent)*. Only terms that are active ancestors of the annotated term in the release of every place of the group are listed, never *All*, the branches directly under it such as *Phenotypic abnormality*, or the organ-system terms directly under *Phenotypic abnormality* such as *Abnormality of the nervous system*. A more general term does not lift a block.

**Resulting case** shows what will be exported. Click **Accept adjusted case**, or **Cancel**.

### Blocked groups

A blocked group cannot be accepted as it is. Re-cut it so that the passage no longer holds the negation or the other finding, or reject it, for example with *negation in span*.

### Phrase conflicts

The same phrase in one language was annotated with several terms. A case gets exactly one term. Answer step 1 by choosing the term the phrase alone maps to, or **None of them**. Then click **Use this term** at the right group: the other groups of the phrase are rejected with the reason *conflict*. **Reject all: needs context** rejects every group of the phrase. **Undo these decisions** opens them again.

### Term wrong in its context

If a place shows that the finding itself is wrong, the final result of that text has an error. Do not reject the phrase for that. A lead corrects the final result through a problem report on the text ([Decide on a problem report](lead-results.md#decide-on-a-problem-report), [Change a final result](lead-results.md#change-a-final-result)); reviewers ask a lead to do so. After the correction, refresh the review basis.

## Export the single-term cases

What for: download the phrases the review accepted, as cases for analysis.

1. On **Export**, card **Final results**, choose **Single-term cases (reviewed phrases)** under **Format**. The format is offered while the single-term review is on.
2. Click **Create final export**, then **Download (ZIP)** when it is ready.

The export freezes the current final results and the decisions recorded until you click; later decisions go into a new export. Each case is a phrase with its HPO term and every place it occurs in the selected results. Only accepted and adjusted groups are cases; open, blocked, stale and rejected groups are only counted in report.json, as are the findings not offered and the second-review agreement. The ZIP also holds the selected results as an Ontospan bundle, the same file as in the results with receipt of the same check, and the texts. The files are described in the [scientific workflow guide](../scientific-workflow.md#single-term-review).

An operator can create the same file on the command line with `ontotator admin export PROJECT OUT.zip --format single-term`, from the newest final export. It is refused if that export was made while the review was off: then a lead creates a new final export first.
