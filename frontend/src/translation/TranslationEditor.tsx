import { forwardRef, useMemo, type ChangeEvent, type CompositionEvent, type FocusEvent } from "react";
import { paragraphNodes } from "./DiffView";
import { diffText } from "./textDiff";
import "./translation.css";

export interface TranslationEditorProps {
  id: string;
  labelledBy: string;
  describedBy?: string;
  machineText: string;
  value: string;
  lang?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Marks spaces, tabs, line ends and other invisible characters in the mirror; the textarea keeps its text (issue 454). */
  showInvisibles?: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  /** Blur, composition start and end of the textarea, so a caller can defer work during IME composition. */
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
}

/**
 * The single editable translation surface. The textarea grows with its text inside
 * one scrollport; a hidden mirror behind it lays out the same characters, marks text
 * that differs from the machine translation and carries the paragraph markers that
 * coupled scrolling reads. The mirror never shows text of its own. It is inert, so the
 * browser's own find (Ctrl+F) counts a passage once, in the textarea, not twice (issue 533).
 */
export const TranslationEditor = forwardRef<HTMLDivElement, TranslationEditorProps>(function TranslationEditor(
  { id, labelledBy, describedBy, machineText, value, lang, readOnly = false, disabled = false, showInvisibles = false, onChange, onBlur, onCompositionStart, onCompositionEnd }, ref,
) {
  const mirror = useMemo(() => paragraphNodes(value, diffText(machineText, value), { deletions: false, invisibles: showInvisibles }), [machineText, value, showInvisibles]);
  return <div ref={ref} className={`translation-editor${showInvisibles ? " show-invisibles" : ""}`}>
    <div className="translation-editor-sizer">
      {/* React 18 has no inert property: the empty string sets the attribute. */}
      <div className="translation-editor-mirror" aria-hidden="true" {...{ inert: "" }}>{mirror}{"​"}</div>
      <textarea id={id} className="translation-editor-input" aria-labelledby={labelledBy} aria-describedby={describedBy}
        value={value} lang={lang} readOnly={readOnly} disabled={disabled} onChange={onChange}
        onBlur={onBlur} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd} />
    </div>
  </div>;
});
