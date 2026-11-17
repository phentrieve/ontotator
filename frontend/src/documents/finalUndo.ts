/**
 * The Undo of a changed final result, offered in the message after the bulk "Change final…" and after one final
 * result was replaced in the text card: the server brings the earlier final result of every text back, or of none
 * when a text changed since (`finalUndoneText`, `finalUndoRefusal`).
 */
import { api } from "../api/client";
import { errorMessage } from "../admin/errors";
import type { ToastMessage } from "../ui/Toast";
import { finalUndoneText, finalUndoRefusal } from "./bulkFinalModel";

export interface FinalUndoHooks {
  onAnnounce: (message: string) => void;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
  /** The final results are back: refetch the rows. */
  onChanged: () => void;
}

/** "Final result of EN100022 en changed." (one final result replaced in the text card). */
export const finalChangedText = (name: string): string => `Final result of ${name} changed.`;

/**
 * The toast's Undo action for the server record `undoId`. `name` (one text, "EN100022 en") words the message for
 * one text: "The earlier final result of EN100022 en is back."
 */
export function finalUndoAction(projectKey: string, undoId: number, hooks: FinalUndoHooks, name?: string): () => void {
  return () => {
    hooks.onAnnounce("Saving…");
    api.bulkChangeFinalUndo(projectKey, undoId).then(view => {
      const done = finalUndoneText(view, name);
      hooks.onAnnounce(done);
      // The note on exports made meanwhile stays until dismissed.
      hooks.showToast({ message: done, ...(view.exports_since ? { persist: true } : {}) });
      hooks.onChanged();
    }, (failure: unknown) => {
      // All or nothing: the refusal names the first text that changed since.
      const text = finalUndoRefusal(failure) ?? errorMessage(failure);
      hooks.onAnnounce(text);
      hooks.showToast({ message: text, persist: true });
    });
  };
}
