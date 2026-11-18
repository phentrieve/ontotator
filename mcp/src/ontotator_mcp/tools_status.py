"""Status tools: overview, progress, agreement, the project's audit and jobs."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path
from ontotator_mcp.tooling import person, register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
Stage = Literal["translation_review", "annotation", "final", "done"]
JobState = Literal["queued", "running", "succeeded", "failed"]


def _newest(row: dict[str, Any]) -> dict[str, Any] | None:
    versions = [v for v in row.get("versions", []) if not v.get("discarded")]
    newest = [v for v in versions if v.get("is_newest_in_chain")]
    chosen = newest or versions
    return chosen[-1] if chosen else None


def _lead_pause(pause: dict[str, Any] | None) -> dict[str, Any] | None:
    """A lead paused the text: why, who and when; else None."""
    if not pause:
        return None
    return {
        "reason": pause.get("reason"),
        "paused_by": person(pause.get("paused_by")),
        "paused_at": pause.get("paused_at"),
    }


def _named(ref: Any, label: Any) -> dict[str, Any] | None:
    """The person of ``ref``; of the pseudonym ``label`` when the row has no
    reference."""
    return person(ref) or person({"pseudonym": label})


# What list_texts can return of a text besides case_id and language.
TextField = Literal[
    "is_source",
    "document_id",
    "version",
    "origin",
    "translation_status",
    "in_plan",
    "plan",
    "stages",
    "next_step",
    "annotations_per_text",
    "over_limit",
    "work",
    "lead_pause",
    "final",
    "problem_reports",
]
# The short form: enough to find a text, see where it stands and act on it.
COMPACT_FIELDS: tuple[str, ...] = (
    "is_source",
    "document_id",
    "version",
    "stages",
    "next_step",
    "annotations_per_text",
    "over_limit",
)


def chosen(
    summary: dict[str, Any], fields: Sequence[str] | None, compact: tuple[str, ...]
) -> dict[str, Any]:
    """``summary`` with its key fields and the ``fields`` asked for (``all``:
    every field; None: the compact ones)."""
    if fields is not None and "all" in fields:
        return summary
    wanted = {"case_id", "language", *(compact if fields is None else fields)}
    return {name: value for name, value in summary.items() if name in wanted}


def workload_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """One person's workload: the person's three names, then the counts
    (``submitted`` also by task, from a server that splits it)."""
    names = person((entry.get("person") or {}) | {"username": entry.get("username")})
    counts = {
        name: value
        for name, value in entry.items()
        if name not in ("person", "username")
    }
    return (names or dict.fromkeys(("username", "display_name", "pseudonym"))) | counts


def audit_event(event: dict[str, Any], details: bool) -> dict[str, Any]:
    """One audit event in short: what, when, who and on what; the event's
    ``details`` only on request."""
    found = {
        "id": event.get("id"),
        "at": event.get("at"),
        "action": event.get("action"),
        "actor": person(event.get("actor")),
        "api_token": event.get("api_token"),
        "target_type": event.get("target_type"),
        "target_id": event.get("target_id"),
        "target_person": person(event.get("target_person")),
    }
    if found["actor"] is None:
        # No person: the system, a job or an account that is gone.
        found["actor_label"] = event.get("actor_label") or event.get("actor_kind")
    return found | ({"details": event.get("details")} if details else {})


def text_summary(row: dict[str, Any]) -> dict[str, Any]:
    """One row of the Documents table, without the display-only parts."""
    version = _newest(row) or {}
    stages = row.get("stages") or {}
    final = row.get("final")
    step = row.get("next_step") or {}
    return {
        "case_id": row.get("case_id"),
        "language": row.get("language"),
        "is_source": row.get("is_source"),
        "document_id": version.get("document_id"),
        "version": version.get("version"),
        "origin": version.get("origin"),
        "translation_status": version.get("translation_status"),
        "in_plan": row.get("in_plan", True),
        "plan": row.get("plan_row"),
        "stages": {name: (cell or {}).get("state") for name, cell in stages.items()},
        "next_step": step.get("code"),
        "annotations_per_text": (row.get("annotations_per_text") or {}).get(
            "effective"
        ),
        "over_limit": row.get("over_limit", False),
        "work": [
            {
                "assignment_id": item.get("assignment_id"),
                "task": item.get("task"),
                "status": item.get("status"),
                "document_id": item.get("document_id"),
                "person": _named(item.get("person"), item.get("author_label")),
                "paused_by": item.get("pause_causes", []),
            }
            for item in row.get("work", [])
        ],
        "lead_pause": _lead_pause(row.get("lead_pause")),
        "final": None
        if final is None
        else {
            "submission_id": final.get("submission_id"),
            "kind": final.get("kind"),
            "author": _named(final.get("author"), final.get("author_label")),
        },
        "problem_reports": len(row.get("problem_reports", [])),
    }


async def rows(
    api: OntotatorClient, project: str, **filters: Any
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Every row of every page matching ``filters``, and the first page's header."""
    first: dict[str, Any] = await api.get(
        project_path(project, "document-rows"), page=1, **filters
    )
    pages = [first]
    for page in range(2, int(first.get("page_count", 1)) + 1):
        pages.append(
            await api.get(project_path(project, "document-rows"), page=page, **filters)
        )
    found = [row for page in pages for group in page["groups"] for row in group["rows"]]
    return found, first


def register_status(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes="read", effect="read")
    async def project_overview(
        project: Project,
        include_links: Annotated[
            bool,
            Field(
                description=(
                    "Also the Documents filter behind each count of 'stages'"
                    " ('links', for a link into the web interface). Off by"
                    " default: they are most of the answer."
                )
            ),
        ] = False,
    ) -> dict[str, Any]:
        """Where a project stands: settings, totals per stage, people and open decisions.

        Combines the project's settings, progress, the number of texts that
        need the lead and the warnings the final export would show.
        'workload' has one entry per person (username, display_name,
        pseudonym) with their open, paused and submitted tasks; 'submitted'
        is the sum of translation_reviews_submitted, annotations_submitted
        and reviews_submitted (consolidations).
        """
        settings = await api.get(project_path(project, "settings"))
        progress = await api.get(project_path(project, "progress"))
        summary = await api.get(project_path(project, "documents/summary"))
        warnings = await api.get(project_path(project, "workflow-warnings"))
        stages = progress.get("stages")
        if isinstance(stages, dict) and not include_links:
            stages = {
                name: {key: value for key, value in card.items() if key != "links"}
                if isinstance(card, dict)
                else card
                for name, card in stages.items()
            }
        return {
            "project": project,
            "name": settings.get("name"),
            "languages": settings.get("languages"),
            "annotations_per_text": settings.get("annotations_per_text"),
            "totals": progress.get("totals"),
            "lede": progress.get("lede"),
            "stages": stages,
            "workload": [workload_entry(e) for e in progress.get("workload", [])],
            "needs_decision": summary.get("needs_decision"),
            "final_results": len(warnings.get("selections", [])),
            "export_warnings": len(warnings.get("warnings", [])),
            "texts_without_final": len(warnings.get("omissions", [])),
        }

    @register(server, scopes="read", effect="read")
    async def get_progress(
        project: Project,
        view: Literal["texts", "people", "both"] = "both",
    ) -> dict[str, Any]:
        """Assignment progress per text version and per person (open, in progress, submitted).

        Long for a large project: 'texts' has one entry per text version.
        project_overview gives the totals and the workload alone.
        """
        progress: dict[str, Any] = await api.get(project_path(project, "progress"))
        result: dict[str, Any] = {"totals": progress.get("totals")}
        if view in ("texts", "both"):
            result["texts"] = progress.get("documents", [])
        if view in ("people", "both"):
            result["people"] = progress.get("people", [])
            result["workload"] = [
                workload_entry(entry) for entry in progress.get("workload", [])
            ]
        return result

    @register(server, scopes="read", effect="read")
    async def working_time_summary(project: Project) -> dict[str, Any]:
        """Recorded working time per annotation mode: texts, total and median per text.

        Only sums, as the lead's Progress page shows them; whether the
        project records working time at all is in 'record'. The single work
        intervals are in start_export with kind 'work_time'.
        """
        summary: dict[str, Any] = await api.get(project_path(project, "work-time"))
        return summary

    @register(server, scopes="read", effect="read")
    async def list_texts(
        project: Project,
        language: list[str] | None = None,
        stage: Annotated[
            list[Stage] | None, Field(description="Current stage of the text.")
        ] = None,
        query: Annotated[
            str | None, Field(description="Part of a case or text ID, or 'case-1 de'.")
        ] = None,
        proposals: Literal["with", "without"] | None = None,
        paused_by_lead: Annotated[
            bool, Field(description="Only texts a lead paused (pause_texts).")
        ] = False,
        over_limit: Annotated[
            bool,
            Field(
                description=(
                    "Only texts with more annotators than their annotations"
                    " per text (the web filter 'More annotators than the"
                    " limit')."
                )
            ),
        ] = False,
        fields: Annotated[
            list[TextField | Literal["all"]] | None,
            Field(
                description=(
                    "What to return of each text besides case_id and language."
                    " None: the short form (is_source, document_id, version,"
                    " stages, next_step, annotations_per_text, over_limit)."
                    " ['all']: everything, with 'work' (tasks and people),"
                    " 'final', 'lead_pause', 'plan' and the others."
                )
            ),
        ] = None,
        limit: Annotated[
            int, Field(ge=1, le=1000, description="At most this many texts.")
        ] = 100,
        offset: Annotated[
            int,
            Field(ge=0, description="Skip this many texts ('next_offset')."),
        ] = 0,
        page: Annotated[
            int | None,
            Field(
                ge=1,
                description=(
                    "Only this page of cases as the web interface pages them;"
                    " limit and offset then count within it. Usually None:"
                    " page with limit and offset."
                ),
            ),
        ] = None,
    ) -> dict[str, Any]:
        """The project's texts with IDs, stage, annotations per text and, on request, people and final result.

        Gives the document_id of each text's newest version, which
        assign_texts and start_consolidation need. A document_id is not the
        case ID. Returns at most 'limit' texts in a short form; 'text_count'
        counts all that match and 'next_offset' is the offset of the next
        call (None: that was the last). 'annotations_per_text' is the
        text's own value where it has one, else the project's; 'over_limit'
        says the text has more annotators than that. With fields: 'work'
        lists the tasks, each with its person (username, display_name,
        pseudonym) and 'paused_by' ('report' and/or 'lead'); 'lead_pause'
        says a lead paused the text (pause_texts), with the reason. The
        task 'review' is a consolidation.
        """
        flags = [
            name
            for name, on in (
                ("lead_paused", paused_by_lead),
                ("over_limit", over_limit),
            )
            if on
        ]
        filters: dict[str, Any] = {
            "language": language,
            "stage": stage,
            "q": query,
            "proposals": [proposals] if proposals else None,
            "flags": flags or None,
        }
        path = project_path(project, "document-rows")
        header: dict[str, Any] = await api.get(path, page=page or 1, **filters)
        found = [row for group in header["groups"] for row in group["rows"]]
        if page is None:
            # Further pages only as far as this call returns texts of them.
            for number in range(2, int(header.get("page_count", 1)) + 1):
                if len(found) >= offset + limit:
                    break
                more = await api.get(path, page=number, **filters)
                found += [row for group in more["groups"] for row in group["rows"]]
        part = found[offset : offset + limit]
        total = header.get("text_count") if page is None else len(found)
        end = offset + len(part)
        return {
            "texts": [
                chosen(text_summary(row), fields, COMPACT_FIELDS) for row in part
            ],
            "returned": len(part),
            "text_count": header.get("text_count"),
            "case_count": header.get("group_count"),
            "offset": offset,
            "next_offset": end
            if part and isinstance(total, int) and end < total
            else None,
            "page": page,
            "page_count": header.get("page_count"),
        }

    @register(server, scopes="read", effect="read")
    async def agreement_summary(
        project: Project,
        case_ids: Annotated[
            list[str] | None,
            Field(description="Only these cases in 'texts' and 'pairs'."),
        ] = None,
        include_pairs: Annotated[
            bool,
            Field(description="Also every pair of annotators per text (long)."),
        ] = False,
    ) -> dict[str, Any]:
        """Agreement of the annotations behind the final results, project-wide.

        The figures a final export would write now to agreement.csv and
        agreement-summary.csv, in one call: the summary (macro mean over
        texts and pooled F1 of the summed counts), per pair of annotators
        and per text. Only texts with a final result count; the summary
        always covers all of them. Leads only, as the final export.
        """
        found: dict[str, Any] = await api.get(project_path(project, "agreement"))
        texts = found.get("texts", [])
        pairs = found.get("pairs", [])
        if case_ids is not None:
            wanted = set(case_ids)
            texts = [t for t in texts if t.get("case_id") in wanted]
            pairs = [p for p in pairs if p.get("case_id") in wanted]
        result = {
            "selected_texts": found.get("selected_texts"),
            "summary": found.get("summary"),
            "annotator_pairs": found.get("annotator_pairs", []),
            "texts": texts,
        }
        if include_pairs:
            result["pairs"] = pairs
        return result

    @register(server, scopes="read", effect="read")
    async def project_audit(
        project: Project,
        action: Annotated[
            list[str] | None,
            Field(
                description=(
                    "Action names, e.g. 'work_plan.update'; 'assignment.*'"
                    " matches every assignment action."
                )
            ),
        ] = None,
        person: Annotated[
            str | None,
            Field(description="Pseudonym or login: what the person did or got."),
        ] = None,
        api_token_id: Annotated[
            int | None, Field(description="Only changes made with this API token.")
        ] = None,
        since: Annotated[datetime | None, Field(description="From this time.")] = None,
        until: Annotated[
            datetime | None, Field(description="Before this time (exclusive).")
        ] = None,
        include_details: Annotated[
            bool,
            Field(
                description=(
                    "Also each event's 'details' (what exactly changed: old"
                    " and new values, reasons, counts). Off by default: they"
                    " are most of the answer; narrow with action, person or"
                    " since first."
                )
            ),
        ] = False,
        limit: Annotated[int, Field(ge=1, le=500)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        """The project's audit trail: who changed what and with which token, newest first.

        Work plan, assignments, members, settings, imports, exports and
        final results; leads only. Each event in short: id, at, action,
        actor and target_person (display_name and pseudonym; the audit
        names nobody's login, so username is null: match by pseudonym; an
        actor that is no person has 'actor_label'), target_type, target_id
        and 'api_token', the id and name of the token a change was made
        with. 'total' counts every matching event; page with limit and
        offset.
        """
        page: dict[str, Any] = await api.get(
            project_path(project, "audit"),
            action=action,
            person=person,
            api_token_id=api_token_id,
            since=since.isoformat() if since else None,
            until=until.isoformat() if until else None,
            limit=limit,
            offset=offset,
        )
        return page | {
            "events": [
                audit_event(event, include_details) for event in page.get("events", [])
            ]
        }

    @register(server, scopes="read", effect="read")
    async def list_jobs(
        project: Project,
        kind: Annotated[
            list[str] | None,
            Field(description="Job kinds, e.g. 'final_t1_export', 't1_import'."),
        ] = None,
        status: list[JobState] | None = None,
        requester: Annotated[
            str | None, Field(description="Pseudonym or login of who started it.")
        ] = None,
        error_code: Annotated[
            str | None, Field(description="Only failed jobs with this error code.")
        ] = None,
        since: Annotated[
            datetime | None, Field(description="Created from this time.")
        ] = None,
        until: Annotated[
            datetime | None, Field(description="Created before this time.")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=500)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        """The project's import and export jobs, newest first, with state and error code.

        Finds a lost job ID and failed exports again; leads only. A job with
        a 'download_path' is a finished export that download_export can
        save (that needs the 'export' scope).
        """
        page: dict[str, Any] = await api.get(
            project_path(project, "jobs"),
            kind=kind,
            status=status,
            requester=requester,
            error_code=error_code,
            since=since.isoformat() if since else None,
            until=until.isoformat() if until else None,
            limit=limit,
            offset=offset,
        )
        return page
