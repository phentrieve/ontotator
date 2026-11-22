# Design principles

This document describes the principles behind Ontotator's annotation model and
workflow. It started as the design for the first end-to-end workflow; the
service has since grown (multi-user projects, consolidation, translations), but
the rules below still apply. See the [operations guide](operations.md) for
deployment and the [work package formats](work-package-v2.md) for data exchange.

## Goal

Ontotator supports experts in creating and reviewing ontology annotations (for
example HPO terms) in clinical or other texts. It supports independent
annotation and review of existing annotations, regardless of whether they come
from people or tools. Text selection is the primary entry point, but annotations
without an evidence span are allowed, especially for imported proposals. The
text stays visible while the selected annotation's context fields are edited.

The service runs without external services, cloud accounts or LLM calls once the
pinned ontology release is loaded.

## Architecture

- Python backend (FastAPI, Pydantic) with authoritative server-side validation.
- TypeScript browser UI (React, Vite). TypeScript types are generated from the
  OpenAPI schema; they do not replace server-side validation.
- The built UI is served by the Python service. Node.js is needed only for
  development and building.
- Span handling and lexical ontology search are adapted from
  [hpo-span-annotator](https://github.com/JohannKaspar/hpo-span-annotator)
  (MIT, see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). Its storage
  format is not used as the exchange format.
- Cross-language format compatibility is secured by versioned contracts and
  shared test data, including hashes and Unicode offsets.

## Workflows

### Opening a work package

A package contains immutable document texts, document identities and checksums,
the ontology identity and, optionally, proposal sets of any origin. The ontology
release is checked against its release identity and checksum. Schema or checksum
errors reject the import as a whole; nothing is partially imported.

Independent annotation and proposal review use separate workspaces. Proposals
already seen cannot be "unseen" by switching modes, so a new independent session
is no proof of blinded annotation.

### Independent annotation

In this mode the browser receives no proposals and nothing derived from them.
Selecting text starts an annotation; ontology search adds the term. Further
evidence spans can be added to the same annotation. An explicit action creates
an annotation without evidence.

### Reviewing existing annotations

Human and machine inputs share one annotation model and the same import, editing,
validation, review and export rules. Origin is provenance, not a separate mode,
and implies no automatic quality rating or acceptance. A human annotation is not
accepted just because a human made it. Editability follows draft/submission and
versioning, not the kind of author.

The proposal list shows term, origin, existing evidence and existing assessments
with their origin. Missing information is never invented. The actions are
confirm, reject, edit and uncertain. Editing creates a linked human counterpart;
the original stays unchanged. Additional human annotations are always possible.

Reviewer uncertainty is a review decision, not a clinical assertion. Each
decision binds exactly the reviewed proposal version and, for edits, the version
of the human counterpart. Changing the counterpart later requires a new review.

A review round stores the explicitly selected set of annotation versions.
Historical versions and counterparts in the same package do not automatically
become additional required tasks. A different target set starts a new round; the
selection rules are the same for every origin.

### Saving and submitting

Changes are saved automatically. The UI distinguishes unsaved, saved and save
error. A failed write never appears as saved; local changes stay in the open
editor for a retry.

Edits, review decisions and submission go through one write queue. A mutation
that was saved but whose response was lost is recognised by its stable operation
ID and not applied twice. This is separate from conflicts with another browser
window: writes carry an expected revision, and a stale view gets a conflict
instead of overwriting other changes.

A case can be submitted explicitly with zero findings. In proposal review every
proposal needs a decision; "uncertain" counts as handled but stays open for later
consolidation. Submission also confirms that the whole text was checked for
further findings. It creates an immutable submission; editing again creates a new
draft without overwriting it. A submitted review is not yet a final reference
result.

## Data model and versioning

- An annotation has a stable ID, exactly one ontology term, context fields and
  zero or more evidence mentions.
- An evidence mention has a stable ID and one or more segments. Repeated mentions
  are separate objects; discontinuous mentions are several segments of one
  object.
- Several annotations may share evidence. Editing shared evidence creates a copy
  for the selected annotation; other annotations are never changed silently.
- Stable identities survive edits; immutable content versions get their own
  hashes. An annotation version hash also covers its evidence versions and the
  context definition.
- References to evidence bind ID and version. Several content versions of one
  stable ID may be stored and exported together; conflicting content under the
  same ID and version is invalid.
- Decisions, submissions and workspaces are kept per annotator. A second person
  never overwrites a first person's decision.
- Document state, review decision and clinical assertion state are separate.

Offsets are zero-based Unicode code point intervals with an exclusive end, over
the immutable imported text. The browser boundary converts UTF-16 indices
explicitly. Text is never normalised or corrected after import. The server
validates bounds, segment structure and text binding. Overlapping and nested
mentions are allowed.

Context fields come from a built-in versioned definition shared by UI and server
(for example assertion present/absent/uncertain, experiencer patient/other,
temporality current/historical/future). Any field may be explicitly unknown in a
draft; no clinical defaults are set automatically.

Workspace schema, exchange format and context definition are versioned
separately.

## Exchange formats

Packages and exported submissions must round-trip between installations without
losing information; grouped mentions, stable identities and unknown context
values are never flattened silently. Exported submissions keep their original
identities and hashes and can be imported without the original package. Earlier
submissions stay readable and can seed a new draft. An export from independent
annotation contains no hidden proposals.

Imports are atomic; archives may not write outside their target or expand
without limit. Unknown format versions are rejected. Converting source corpora
or spreadsheets into packages happens outside Ontotator.

## Search and UI

The UI shows a case list, the text and a panel for the selected annotation or
proposal. Context fields appear in that panel rather than on every proposal card.
Markers never rely on colour alone; review actions are keyboard accessible. Save
state and open decisions stay visible.

Search supports ontology IDs, labels, synonyms, lexical search and hierarchy
against the pinned ontology; there is no semantic (embedding) search. Query,
search route, candidates, actual rank, displayed position and selection are
logged together with the ontology and index identity. Scored lexical results are
shuffled reproducibly; exact matches, IDs and hierarchy results are not.
Transitive parent/child relations trigger a hint, never automatic removal or
replacement. Obsolete terms can be shown but not chosen for a new annotation;
imported problems stay visible.

## Panels and actions

A panel, dialog or row offers what the person can do next. It does not explain
itself under its buttons. Text under a control is read after the decision, is
often skipped, and makes every panel look like a manual. These rules apply to
every new screen; existing screens follow them as they are changed.

1. **Few, ranked actions.** Each panel has one primary action: the usual way.
   A decision between two equal ways (for example the two ways to decide a
   query) may show both. Every other way sits under **Other ways…** (a menu
   button), each item with one line on when to use it. A single other way may
   stay a plain secondary button. Cancel and Close are not counted.
2. **Labels say the consequence.** The label names what follows, not the size
   or kind of the edit: *Fix typos (no review)…*, *Correct it myself (counts as
   accepted)…*, *Accept v1 as it is…*. The dialog an action opens repeats the
   label in its title.
3. **Explanations come before the choice, or on demand.** Say what is decided
   first: who asked, what they said, what they propose. Keep it to a line above
   the actions, a disclosure (*Show the proposed text*), the description of a
   menu item or of a radio choice. Never a paragraph under the buttons.
4. **Greyed controls.** Hide what is not possible in this state. Keep a control
   greyed only when the person would otherwise look for it; then it stays
   focusable (`aria-disabled`), and the reason is its accessible description
   and tooltip. A press on it may show the reason in place. A validation
   message after a press (*Choose what changes.*) is not a hint and stays.
5. **Bigger decisions open a dialog.** A decision that needs the text, a reason
   or more than two ways opens a dialog. It does not expand a table row.
6. **Keyboard and screen reader.** Focus goes to the primary action when a
   dialog opens and back to the opener when it closes. Other ways… is a menu
   button (arrow keys, Escape). The descriptions of menu items and choices are
   their accessible descriptions.
7. **Help on demand is a visible (?).** An explanation that is needed only
   sometimes (a rule, what a choice means, why something moves or stays) sits
   behind a (?) button next to the field or heading it explains
   (`HelpButton` and `HelpText` in `ui/Help.tsx`; `help` on a `TextInput` or
   `Textarea`), never in a tooltip only. The
   (?) is a disclosure: it toggles a short text in place, works by touch and
   keyboard, Escape closes it, and its name is *Help: <topic>* (*Help: What
   did you fix?*). A hint that fits in a field goes into its placeholder
   instead. A greyed action uses `ReasonButton`: its reason is its accessible
   description and its `title`, and shows next to it on pointing, focus and
   press.

### Before and after

**Resolve… on a rejected or queried translation** (Documents row).

- Before: a panel expanded under the row, with six equal buttons and Cancel:
  *Accept the reviewer’s text…*, *Answer and accept the version as it is…*,
  *Reopen Ana Weber's review…*, *Assign a new review…*, *Correct the
  translation…*, *Discard the de translation…*. The reviewer's proposed text
  was not visible.
- After: a dialog. First the reviewer's reason, and for a query *Show the
  proposed text (1 passage changed)*. Then **Accept the reviewer’s text as
  v2…** (primary) and **Accept v1 as it is…**, or for a rejected version only
  **Correct it myself (counts as accepted)…**. Reopen, Assign a new review and
  Discard sit under **Other ways…**. A query without a proposed change does not
  offer *Accept the reviewer’s text* at all.

**Changing the text of an accepted version** (text card, Translation).

- Before: *Correct it myself…* and *Fix typos…* side by side, and a hint line
  under the buttons: *Correct it myself: you edit it here; it is reviewed
  again. Fix typos: spacing, typos, grammar; the status stays, no review.*
- After: one button, **Edit the translation…**. Its dialog asks *What
  changes?*: *Only spelling, spacing or grammar* (the meaning stays; no
  review, submitted annotations move to v2) or *The meaning changes* (v2 is
  reviewed again; annotations stay on v1). Where only the typo fix is possible,
  the button reads **Fix typos (no review)…**. *Ask a reviewer to correct…*
  and *Upload a corrected text…* sit under **Other ways…**. No hint line.

## Acceptance criteria

1. A synthetic package with human and machine proposals is imported, reviewed,
   submitted, reopened and exported without information loss.
2. Confirm, reject, edit, uncertain and add each keep the unchanged source and a
   separate human decision. Identical annotations with different origins get the
   same actions, validation rules and state transitions.
3. An annotation without evidence gains evidence without losing its stable ID.
4. Repeated and discontinuous mentions stay distinguishable in a round trip;
   overlap and nesting work.
5. Shared evidence can be changed for one annotation without changing the other
   or moving its decision.
6. Non-BMP characters, combining characters and line breaks give correct
   selection, storage and redisplay boundaries.
7. Independent annotation never sends proposals to the browser.
8. Zero-finding submission and submission with uncertain decisions are
   distinguishable; both are separate from final acceptance.
9. Stale write revisions, malformed packages and wrong ontologies are rejected
   without data loss. Save errors are visible.
10. A second annotator gets separate records without overwriting existing
    decisions. Submissions survive further editing.
11. Two submissions from before and after an evidence correction can be imported
    together into a fresh installation and read with their original hashes; the
    historical review target set is preserved.
12. A quick edit immediately followed by a review decision causes no
    self-inflicted conflict. After a lost response, a retry applies exactly one
    mutation and keeps later local changes.
