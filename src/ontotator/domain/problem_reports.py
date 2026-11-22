"""Pure lifecycle rules of problem reports and their task pauses (no I/O)."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from ontotator.domain.errors import AccessDenied, DomainError

ReportState = Literal["open", "resolved", "withdrawn"]
# Issue 553: a report is a text problem or a question to the lead.
ReportKind = Literal["problem", "question"]
ReportAction = Literal[
    "resume", "resolve", "extend_hold", "restart", "withdraw", "reopen", "answer"
]
ReleaseAction = Literal["resume", "restart", "withdraw"]
CLOSED_STATES: frozenset[str] = frozenset({"resolved", "withdrawn"})
LEAD_ONLY: frozenset[str] = frozenset(
    {"resolve", "extend_hold", "restart", "reopen", "answer"}
)
ANSWER_REFUSED = "QUESTION_ANSWER_NOT_AVAILABLE"
# Longest quoted passage and proposed wording of a question (characters).
QUOTE_LIMIT = 2000


@dataclass(frozen=True)
class EventFact:
    actor_id: int
    action: str


def withdrawable(state: str, reporter_id: int, events: Iterable[EventFact]) -> bool:
    """Open and nobody but the reporter has acted (only own resumes so far)."""
    return state == "open" and all(
        event.actor_id == reporter_id and event.action == "resume" for event in events
    )


def check_permission(action: str, *, lead: bool, reporter: bool) -> None:
    if action == "withdraw":
        allowed = reporter
    elif action == "resume":
        allowed = lead or reporter
    else:
        allowed = lead and action in LEAD_ONLY
    if not allowed:
        raise AccessDenied("NOT_ALLOWED")


def _conflict(reason: str) -> DomainError:
    return DomainError("WORKFLOW_REVISION_CONFLICT", {"reason": reason})


def check_question(
    kind: str, quote: str | None, proposed_text: str | None
) -> tuple[str | None, str | None]:
    """The stored quote and proposed wording; blank parts are left out.

    A proposed wording needs a quote, and only a question carries either.
    """
    quote = quote if quote and quote.strip() else None
    proposed_text = proposed_text if proposed_text and proposed_text.strip() else None
    if kind != "question" and (quote or proposed_text):
        raise DomainError("QUESTION_PARTS_INVALID", {"reason": "not_a_question"})
    if proposed_text is not None and quote is None:
        raise DomainError("QUESTION_PARTS_INVALID", {"reason": "quote_required"})
    if len(quote or "") > QUOTE_LIMIT or len(proposed_text or "") > QUOTE_LIMIT:
        raise DomainError("QUESTION_PARTS_INVALID", {"reason": "too_long"})
    return quote, proposed_text


def check_answer(kind: str, *, take_proposed_text: bool, proposed: bool) -> None:
    """Only a question is answered; its proposed wording is taken only if it has one."""
    if kind != "question":
        raise DomainError(ANSWER_REFUSED, {"reason": "not_a_question"})
    if take_proposed_text and not proposed:
        raise DomainError(ANSWER_REFUSED, {"reason": "no_proposed_text"})


def take_proposed(text: str, quote: str, proposed_text: str) -> str:
    """``text`` with the quoted passage replaced by the proposed wording.

    The passage must occur exactly once; otherwise the asker's text has moved
    on and the lead answers without taking it.
    """
    if text.count(quote) != 1:
        raise DomainError(ANSWER_REFUSED, {"reason": "quote_not_found"})
    return text.replace(quote, proposed_text, 1)


def check_state(action: str, state: str, *, withdrawable_now: bool) -> None:
    if action == "reopen":
        if state not in CLOSED_STATES:
            raise _conflict("REPORT_OPEN")
        return
    if state in CLOSED_STATES and action != "resume":
        raise _conflict(
            "REPORT_RESOLVED" if state == "resolved" else "REPORT_WITHDRAWN"
        )
    if action == "withdraw" and not withdrawable_now:
        raise _conflict("REPORT_LEAD_ACTED")


def next_state(action: str, state: str) -> str:
    if action in {"resolve", "restart", "answer"}:
        return "resolved"
    if action == "withdraw":
        return "withdrawn"
    if action == "reopen":
        return "open"
    return state


def next_resolution(action: str, current: str | None, reason: str) -> str | None:
    if action in {"resolve", "restart", "answer"}:
        return reason
    if action == "reopen":
        return None
    return current
