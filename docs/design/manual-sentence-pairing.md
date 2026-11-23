# Pairing source and translation sentences by hand (#595) — design note

**Status: mockup for sign-off — not to be merged.** Refs #595, #560, #579.

## Where this fits

- **#560** asks for checks per *segment pair* instead of per side.
- **#579** (draft, waits for sign-off) builds the pair rows: source and
  translation side by side, a check per row, *changed since checked* on any
  non-whitespace edit (B4-3), ⋯ merge/split, storage in the review draft
  (`segment_pairs`, a private working aid like #256). Its pairs come from an
  aligner.
- On 2026-11-22 the owner decided that the **first alignment comes from the
  translation pipeline** (ontospan 1.3, phentrieve/ontospan#16). Until then,
  and for texts where it is missing or fails, a reviewer can only use
  *Mark checked sentences*, which checks each side on its own.

**#595 adds one thing to #579: a way to make the pairs by hand.** It reuses
#579's rows, pair model, check rule, ⋯ menu and storage unchanged; a manual
pair is a segment pair with `origin: "manual"`. Nothing here replaces or
duplicates #579's aligner, merge/split or archive handling.

## The prototype

`npm run dev`, then `/?mockup=pairing` (dev builds only; `main.tsx` loads the
mockup behind `import.meta.env.DEV`). Synthetic English letter with a German
translation (9 and 10 sentences, one 1:2). Model: `src/mockups/manualPairing.ts`
(pure, tested in `tests/manualPairingMockup.test.ts`); screen:
`src/mockups/PairingMockup.tsx`.

- **Rows** above: the pairs made so far, in source order, exactly as #579
  (check box per row; amber with *Changed since checked* after an edit; ✎
  marks a pair made by hand).
- **Next pair** below: the sentences of each text not paired yet, as two lists
  of buttons. The **next unpaired sentence of each text is already selected**
  (1:1 in reading order), so most pairs are one key: <kbd>Enter</kbd>.
- **n:m**: <kbd>S</kbd> / **+ Source sentence** and <kbd>T</kbd> /
  **+ Translated sentence** add the following sentence; a tap on a sentence
  next to the selection adds it, on its edge removes it, elsewhere starts the
  selection there. A selection is always contiguous. The button names what it
  does: *Pair 1:2*, *Not in the translation* (1:0), *Not in the source* (0:1).
- **Out of order**: a pair whose translation comes before an earlier pair's
  is allowed and labelled *Another order than in the source*.
- **Unpair**: ⋯ › **Unpair** gives the sentences back to Next pair (selected,
  ready to pair again), drops the check, and offers **Undo**.
- Use the banner's **Simulate an edit** button to see a checked pair turn
  *changed since checked*.

## Options

### 1. Interaction

| Option | For | Against |
| --- | --- | --- |
| **A. Next-pair composer** (prototype) | Follows reading order, so the common 1:1 case is one key; n:m with two keys; the same buttons on phone and tablet (B4-5); keyboard-first; the rows grow top-down into exactly #579's view. | A second area under the rows; long texts need the list to scroll. |
| B. Select a source sentence, then its translation, in the flowing columns | No new area; close to *Mark checked sentences*. | Two clicks per pair also for the common case; n:m needs modifier clicks (shift), which touch lacks; finding the counterpart by eye remains. |
| C. Drag from a source sentence to a translation sentence | Direct. | No keyboard path, poor on touch and in long texts (scrolling while dragging), fails WCAG 2.5.7 without an alternative. |

### 2. n:m

(a) **Contiguous n:m, including 1:0 and 0:1** (prototype; the shape #579
uses); (b) 1:1 only, n:m via #579's merge; (c) any sets, also non-contiguous.

### 3. Unpair and re-pair

(a) **Unpair drops the check; Undo restores it; a re-pair starts unchecked**
(prototype); (b) a re-pair with the same ranges and unchanged translation gets
its check back automatically; (c) unpair is refused for checked pairs.

### 4. A pipeline alignment arrives later for a text with manual pairs

(a) **Manual pairs win; the alignment fills only the stretches between them**
(as #579's *Align again* keeps merged/split pairs); (b) ask the reviewer once:
keep mine / take the alignment; (c) the alignment replaces manual pairs, and
checks carry over where ranges and text match.

### 5. Who may pair

(a) **Only the reviewer of the assignment, in their draft** (the pairs are a
private working aid like #256 and #579); (b) anyone who may edit the
translation, stored with the text version.

### 6. Manual vs. automatic pairs

(a) **A small ✎ in the row number with the tooltip *Paired by hand***
(prototype); (b) no difference; (c) a coloured row band (rejected: colour
alone, and rows already use green and amber for the check state).

## Storage and dependency

No new API: a manual pair is a `segment_pairs` entry of #579 with
`origin: "manual"` (source range, translation range, check hash of the
translation). So **#595 lands after #579's pair rows**, and can land
**before the pipeline alignment** of ontospan 1.3: the row view then starts
empty and Next pair builds it. If #579's rule-based aligner is not merged
(owner decision of 2026-11-22), the rows and storage of #579 are still needed;
the aligner itself is not.

## Recommendation

1. **Interaction A, the Next-pair composer**, with contiguous **n:m including
   1:0 and 0:1** (2a).
2. **Unpair drops the check, with Undo** (3a): simple, nothing hidden.
3. **Manual pairs win over a later pipeline alignment**, which fills the gaps
   (4a), the same rule as #579's *Align again*.
4. **Only the reviewer, in the draft** (5a); ✎ marks manual pairs (6a).
5. Offer Next pair whenever no alignment exists for the text, and in #579's
   fallback cases; *Mark checked sentences* stays until both are signed off.

## Questions for the owner

1. **Interaction**: (a) **Next-pair composer under the rows** *(recommended)*,
   (b) select source then translation in the flowing columns, (c) drag.
2. **n:m**: (a) **contiguous n:m with 1:0 and 0:1** *(recommended)*, (b) 1:1
   only, then merge, (c) any sets.
3. **A later pipeline alignment** for a text with manual pairs: (a) **manual
   pairs win, the alignment fills the gaps** *(recommended)*, (b) ask the
   reviewer, (c) the alignment replaces them.
4. **Who and where**: (a) **the reviewer only, as a draft working aid, manual
   pairs marked ✎** *(recommended)*, (b) anyone who may edit the
   translation, stored with the text version.
