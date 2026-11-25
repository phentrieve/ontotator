import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProblemReportView } from "../api/client";
import { NOTIFICATIONS_CHANGED } from "../notifications/notificationsEvents";

export interface TaskQuestions {
  /** The asker's questions on this task, newest first; null before the first load. */
  questions: ProblemReportView[] | null;
  error: unknown;
  reload: () => Promise<void>;
  put: (question: ProblemReportView) => void;
}

const newestFirst = (a: ProblemReportView, b: ProblemReportView): number => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");

/**
 * The asker's questions on one task (issue 553). Loads on mount, on window focus and when the bell's unread count
 * changes (issue 651): an answer to this person is a notification, so it shows up while they stay in the task, and
 * the bell entry that opens the task they are already in (the same route) shows it too, since opening marks it read.
 */
export function useTaskQuestions(projectKey: string, assignmentId: number): TaskQuestions {
  const [questions, setQuestions] = useState<ProblemReportView[] | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const counter = useRef(0), mounted = useRef(true);
  const reload = useCallback(async () => {
    const request = ++counter.current;
    try {
      const list = await api.listQuestions(projectKey, { assignmentId });
      if (mounted.current && request === counter.current) { setQuestions([...list].sort(newestFirst)); setError(undefined); }
    } catch (failure) {
      if (mounted.current && request === counter.current) setError(failure);
    }
  }, [projectKey, assignmentId]);
  const put = useCallback((question: ProblemReportView) => {
    setQuestions(values => {
      const list = values ?? [];
      return list.some(value => value.report_id === question.report_id)
        ? list.map(value => value.report_id === question.report_id ? question : value)
        : [question, ...list];
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    return () => { mounted.current = false; window.removeEventListener("focus", onFocus); window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus); };
  }, [reload]);
  return { questions, error, reload, put };
}
