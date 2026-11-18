"""Lead tools for re-planning and corrections while a project runs (issue 346).

New rounds, annotation mode changes and their restore, the final result of
one text, translation corrections, work plan undo, text changes and the
decisions on problem reports. Every tool that removes or replaces work
does a dry run without ``confirm`` and changes nothing then; the dry run
reads the state the write is checked against (a revision, the submissions
to discard), and the write sends exactly that, so the server refuses it if
the project changed in between.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import (
    HINTS,
    OntotatorError,
    check_preview_token,
    stale_note,
)
from ontotator_mcp.models import Replacement, TextRef
from ontotator_mcp.tooling import register, tool_message
from ontotator_mcp.tools_people import assignment_summary
from ontotator_mcp.tools_setup import _cut, unknown_texts
from ontotator_mcp.tools_status import rows

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
AssignmentId = Annotated[int, Field(description="The task's ID (list_assignments).")]
DocumentId = Annotated[
    str, Field(description="Text version ID (list_texts, versions).")
]
Confirm = Annotated[
    bool, Field(description="False: dry run, changes nothing. True: apply.")
]
ExpectedRevision = Annotated[
    int | None,
    Field(
        ge=0,
        description=(
            "The revision of the final result the dry run showed"
            " (plan.revision; 0: none). With it the call is refused when the"
            " final result changed since the dry run."
        ),
    ),
]
WithdrawTasks = Annotated[
    bool,
    Field(
        description=(
            "Apply even if the change withdraws tasks or final results; without"
            " it such a change is refused and its consequences are returned."
        )
    ),
]
CONFIRMATION = "WORK_PLAN_CONFIRMATION_REQUIRED"


async def find_assignment(
    api: OntotatorClient, project: str, assignment_id: int
) -> dict[str, Any]:
    """The task with its ``workflow_revision``, as the lead's task list shows it."""
    listed: list[dict[str, Any]] = await api.get(project_path(project, "assignments"))
    for item in listed:
        if item.get("id") == assignment_id:
            return item
    raise OntotatorError(
        f"Project {project} has no current task {assignment_id} (list_assignments)."
    )


def _round_summary(view: dict[str, Any] | None) -> dict[str, Any] | None:
    if view is None:
        return None
    return {
        key: view.get(key)
        for key in (
            "round_id",
            "kind",
            "state",
            "round_ordinal",
            "submission_count",
            "latest_submission_id",
        )
    }


def _needs_confirmation(exc: OntotatorError) -> dict[str, Any]:
    """A refusal that names what the change would withdraw, as a result."""
    return {
        "applied": False,
        "consequences": exc.details,
        "note": "The change withdraws the work listed; pass withdraw_tasks to"
        " apply it anyway.",
    }


async def _text_change_preview(
    api: OntotatorClient, project: str, source: dict[str, Any], target: str
) -> dict[str, Any]:
    preview: dict[str, Any] = await api.post(
        project_path(project, "text-changes/preview"),
        source | {"target_document_id": target},
    )
    return preview


def register_lead(server: MCPServer, api: OntotatorClient) -> None:
    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def start_new_round(
        project: Project,
        assignment_id: AssignmentId,
        kind: Annotated[
            Literal["carry_forward", "clean_restart"],
            Field(
                description=(
                    "'carry_forward': the person continues from one of their"
                    " submissions of this text. 'clean_restart': the current"
                    " round is abandoned and the person starts again from"
                    " the beginning; submitted work stays."
                )
            ),
        ],
        source_submission_id: Annotated[
            str | None,
            Field(
                description=(
                    "carry_forward: the submission to continue from (the dry"
                    " run lists them); None takes the only one."
                )
            ),
        ] = None,
        reason: Annotated[
            str | None, Field(description="Needed for clean_restart.")
        ] = None,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Give an annotation task a new round, after a dry run.

        The dry run shows the task, its current round and, for
        carry_forward, the submissions it can continue from. With confirm
        the round is created; the current round is superseded
        (carry_forward) or abandoned with its draft (clean_restart). A
        submitted annotation gets no new round while a consolidation of its
        text is open (CONSOLIDATION_OPEN): the dry run says so (``blocked``)
        and confirm changes nothing; have the consolidation finished or
        withdraw its task first.
        """
        if kind == "clean_restart" and not (reason or "").strip():
            raise OntotatorError("A clean restart needs a reason.")
        task = await find_assignment(api, project, assignment_id)
        base = f"/api/v1/assignments/{seg(assignment_id)}"
        listed: list[dict[str, Any]] = await api.get(f"{base}/rounds")
        current = next((r for r in listed if r.get("active")), None)
        sources: list[dict[str, Any]] = []
        # The server marks the submissions a new round cannot start from
        # right now (refused_by); a clean restart is refused the same way.
        if kind == "carry_forward" or task.get("status") == "submitted":
            sources = await api.get(f"{base}/round-sources")
        blocked = next(
            (str(s["refused_by"]) for s in sources if s.get("refused_by")), None
        )
        if kind == "carry_forward":
            if source_submission_id is None:
                if len(sources) != 1:
                    raise OntotatorError(
                        f"Task {assignment_id} has {len(sources)} submissions to"
                        " continue from; name source_submission_id: "
                        + ", ".join(str(s.get("submission_id")) for s in sources)
                    )
                source_submission_id = str(sources[0]["submission_id"])
            elif source_submission_id not in {s.get("submission_id") for s in sources}:
                raise OntotatorError(
                    f"{source_submission_id} is not a submission task"
                    f" {assignment_id} can continue from."
                )
        plan = {
            "task": assignment_summary(task),
            "current_round": _round_summary(current),
            "kind": kind,
            "source_submission_id": source_submission_id,
            "sources": _cut(sources) if kind == "carry_forward" else [],
            "consequence": (
                "The current round is abandoned with its draft; the person starts"
                " again from the beginning."
                if kind == "clean_restart"
                else "The current round is superseded; the person continues from"
                " the source submission."
            ),
        }
        if blocked:
            # What confirm would be refused with: no round would start.
            plan["consequence"] = "Nothing: the new round would be refused."
            return {
                "applied": False,
                "blocked": {
                    "code": blocked,
                    "message": HINTS.get(blocked, "The server would refuse it."),
                },
                "plan": plan,
            }
        if not confirm:
            return {"applied": False, "plan": plan}
        created: dict[str, Any] = await api.post(
            f"{base}/rounds",
            {
                "request_id": str(uuid.uuid4()),
                "expected_workflow_revision": task["workflow_revision"],
                "kind": kind,
                "source_submission_ids": (
                    [source_submission_id] if source_submission_id else []
                ),
                "reason": reason,
            },
        )
        return {"applied": True, "plan": plan, "round": _round_summary(created)}

    @register(server, scopes="project-admin", effect="destructive")
    async def change_annotation_mode(
        project: Project,
        case_id: str,
        language: str,
        mode: Annotated[
            Literal["proposals", "scratch"],
            Field(
                description=(
                    "'proposals': annotate from the machine proposals;"
                    " 'scratch': from an empty text."
                )
            ),
        ],
        reason: Annotated[str, Field(min_length=1, max_length=2000)],
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Change the annotation mode of a text that already has work, after a preview.

        The preview names every submission that is DISCARDED (annotations
        and consolidations of the text) and every task that is withdrawn.
        With confirm exactly those are discarded; the server refuses if
        the text changed since the preview. Nothing is deleted:
        restore_annotation_mode undoes the change while no new work started.
        """
        target = {"case_id": case_id, "language": language, "mode": mode}
        preview: dict[str, Any] = await api.post(
            project_path(project, "annotation-mode-changes/preview"), target
        )
        if not confirm:
            return {"applied": False, "preview": preview}
        result: dict[str, Any] = await api.post(
            project_path(project, "annotation-mode-changes"),
            target
            | {
                "reason": reason,
                "expected_revision": preview["revision"],
                "expected_submission_ids": [
                    item["submission_id"] for item in preview.get("submissions", [])
                ],
            },
        )
        return {"applied": True, "preview": preview, "result": result}

    @register(server, scopes="project-admin", effect="destructive")
    async def change_annotation_modes(
        project: Project,
        texts: Annotated[
            list[TextRef],
            Field(
                min_length=1,
                max_length=10000,
                description=(
                    "The texts, each {'case_id': ..., 'language': ...}: at most"
                    " 10000 per call, of at most 2000 cases."
                ),
            ),
        ],
        mode: Annotated[
            Literal["proposals", "scratch"],
            Field(
                description=(
                    "'proposals': annotate from the machine proposals;"
                    " 'scratch': from an empty text."
                )
            ),
        ],
        reason: Annotated[str, Field(min_length=1, max_length=2000)],
        confirm: Annotated[
            bool, Field(description="False: dry run. True: change the listed texts.")
        ] = False,
        preview_token: Annotated[
            str | None,
            Field(
                max_length=80,
                description=(
                    "With confirm: the preview_token of the dry run, so exactly"
                    " the texts it listed change."
                ),
            ),
        ] = None,
    ) -> dict[str, Any]:
        """Change the annotation mode of many texts that have work, after a
        dry run. THE WORK ON THEM IS DISCARDED.

        Like change_annotation_mode for each text: its submissions
        (annotations and consolidations) are DISCARDED and its tasks are
        withdrawn. The dry run names, per text, whose submissions and whose
        unsubmitted tasks, and the texts left as they are with the reason
        (final result chosen: withdraw it first; no work yet; already in
        this mode; no proposals), and the texts the project does not have
        (unknown_texts: another spelling, letter case or language). Confirm with its preview_token: every
        listed text changes, or none when anything changed since (a fresh
        dry run, ``stale``). THERE IS NO UNDO for the call as a whole: the
        answer has no ``undo`` and no tool takes it. restore_annotation_mode
        brings back one text at a time (its mode, submissions and tasks),
        and only while no new work started on that text.
        """
        path = project_path(project, "annotation-mode-changes/bulk")
        body: dict[str, Any] = {
            "rows": [text.model_dump() for text in texts],
            "mode": mode,
        }

        def summary(found: dict[str, Any], applied: bool) -> dict[str, Any]:
            def people(items: list[dict[str, Any]], key: str) -> list[str]:
                names = [
                    (item.get(key) or {}).get("display_name")
                    or (item.get(key) or {}).get("pseudonym")
                    for item in items
                ]
                return sorted({str(name) for name in names if name})

            changes = [
                {
                    "case_id": item.get("case_id"),
                    "language": item.get("language"),
                    "from_mode": item.get("from_mode"),
                    "discarded_submissions": len(item.get("submissions", [])),
                    "authors": people(item.get("submissions", []), "author"),
                    "withdrawn_unsubmitted_tasks": people(
                        [
                            task
                            for task in item.get("assignments", [])
                            if task.get("status") != "submitted"
                        ],
                        "person",
                    ),
                }
                for item in found.get("changes", [])
            ]
            skipped = [
                {key: item.get(key) for key in ("case_id", "language")}
                | {"message": tool_message(item)}
                for item in found.get("skipped", [])
            ]
            return {
                "applied": applied,
                "mode": found.get("mode"),
                "changed" if applied else "would_change": _cut(changes, 50),
                "change_count": found.get("change_count", len(changes)),
                "discarded_submission_count": found.get("submission_count"),
                "withdrawn_task_count": found.get("assignment_count"),
                "skipped_texts": _cut(skipped, 50),
                "skipped_by_reason": found.get("skipped_by_reason", {}),
                **unknown_texts(found),
                "preview_token": found.get("preview_token"),
            }

        if not confirm:
            preview: dict[str, Any] = await api.post(path, body | {"preview": True})
            return summary(preview, False)
        check_preview_token(preview_token)
        try:
            applied: dict[str, Any] = await api.post(
                path, body | {"preview_token": preview_token, "reason": reason}
            )
        except OntotatorError as exc:
            fresh = (
                exc.details.get("preview") if isinstance(exc.details, dict) else None
            )
            if exc.code != "PREVIEW_STALE" or not isinstance(fresh, dict):
                raise
            return summary(fresh, False) | {
                "stale": True,
                "note": stale_note("Texts", "changed"),
            }
        return summary(applied, True)

    @register(server, scopes=("read", "project-admin"), effect="changes")
    async def restore_annotation_mode(
        project: Project,
        case_id: str,
        language: str,
        change_id: Annotated[int, Field(description="From list_mode_changes.")],
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Undo an annotation mode change, after a preview.

        The preview shows the change: the submissions it brings back, the
        tasks it reinstates and whether it is still restorable (not once
        new annotation work started on the text). With confirm the previous
        mode, the submissions and the tasks are back.
        """
        listed = await api.get(
            project_path(project, "annotation-mode-changes"),
            case_id=case_id,
            language=language,
        )
        change = next(
            (c for c in listed.get("changes", []) if c.get("change_id") == change_id),
            None,
        )
        if change is None:
            raise OntotatorError(
                f"{case_id} {language} has no annotation mode change {change_id}."
            )
        if not confirm:
            return {"applied": False, "change": change}
        if not change.get("restorable"):
            raise OntotatorError(
                f"Change {change_id} cannot be restored:"
                f" {change.get('restore_blocked') or 'already restored'}."
            )
        # The restore is checked against the text's plan revision.
        plan = await api.post(
            project_path(project, "work-plans/bulk/preview"),
            {
                "case_ids": [case_id],
                "rows": [],
                "languages": {
                    language: {
                        "review": "keep",
                        "annotate": "keep",
                        "annotation_mode": "keep",
                    }
                },
            },
        )
        result: dict[str, Any] = await api.post(
            project_path(project, "annotation-mode-changes", seg(change_id), "restore"),
            {"expected_revision": plan["revisions"][case_id]},
        )
        return {"applied": True, "change": change, "result": result}

    @register(server, scopes=("read", "project-admin"), effect="changes")
    async def set_final_result(
        project: Project,
        case_id: str,
        language: str,
        submission_id: Annotated[
            str,
            Field(
                description=(
                    "The submission to accept (the dry run lists them); the"
                    " current final result to confirm it after a change."
                )
            ),
        ],
        confirm: Confirm = False,
        expected_revision: ExpectedRevision = None,
    ) -> dict[str, Any]:
        """Choose or change the final result of one text, after a dry run.

        The dry run shows the current final result with its revision
        (plan.revision), the text's submissions with their agreement and
        the causes a confirmation acknowledges (for example a corrected
        text). With confirm the submission becomes the final result,
        REPLACING an earlier one; naming the current one confirms it and
        acknowledges those causes. Pass the dry run's plan.revision as
        expected_revision: the call is then refused if the final result
        changed since the dry run. Without it the confirm call reads the
        final result again and replaces whatever is current. When the
        confirmed call replaced another final result, the answer carries
        ``undo`` (id and expires_at): undo_change_final_results takes that
        id and brings the earlier final result back, once, within 60
        minutes and while nothing else changed on the text. A first choice
        and a confirmation have no undo; withdraw_final_result takes a
        final result back.
        """
        found, _ = await rows(api, project, case=case_id, language=[language])
        row = next(
            (
                r
                for r in found
                if r.get("case_id") == case_id and r.get("language") == language
            ),
            None,
        )
        if row is None:
            raise OntotatorError(f"Project {project} has no text {case_id} {language}.")
        panel = await api.get(
            project_path(
                project, "document-rows", seg(case_id), seg(language), "final-panel"
            )
        )
        submissions = panel.get("submissions", [])
        chosen = next(
            (s for s in submissions if s.get("submission_id") == submission_id), None
        )
        if chosen is None:
            raise OntotatorError(
                f"{submission_id} is not a submission of {case_id} {language}: "
                + ", ".join(str(s.get("submission_id")) for s in submissions)
            )
        final = row.get("final")
        same = bool(final and final.get("submission_id") == submission_id)
        causes = panel.get("causes", []) if same else []
        revision = int(final["revision"]) if final else 0
        plan = {
            "current_final": final,
            "revision": revision,
            "chosen": chosen,
            "replaces_final": bool(final) and not same,
            "acknowledges": [
                {"code": c.get("code"), "cause_id": c.get("cause_id")} for c in causes
            ],
            "submissions": _cut(submissions),
            "agreement": panel.get("agreement"),
        }
        if not chosen.get("eligible", True):
            plan["note"] = "The token's owner may not accept this result."
        if not confirm:
            return {"applied": False, "plan": plan}
        if expected_revision is not None and expected_revision != revision:
            raise OntotatorError(
                f"The final result of {case_id} {language} changed since the dry"
                f" run (revision {revision}, expected {expected_revision});"
                " nothing was changed. Check the plan of a new dry run."
            )
        if same and not causes:
            return {"applied": False, "plan": plan, "note": "Nothing to change."}
        selected: dict[str, Any] = await api.put(
            project_path(project, "final-selections"),
            {
                "document_id": chosen["document_id"],
                "submission_id": submission_id,
                "expected_revision": revision,
                "acknowledged_cause_ids": [c["cause_id"] for c in causes],
            },
        )
        # A replaced final result can be taken back: the handle of
        # undo_change_final_results, as change_final_results returns it.
        undo = selected.pop("undo", None)
        answer = {"applied": True, "plan": plan, "final": selected}
        return answer | ({"undo": undo} if undo else {})

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def withdraw_final_result(
        project: Project,
        case_id: str,
        language: str,
        reason: Annotated[
            str,
            Field(
                min_length=1,
                max_length=2000,
                description="Why, e.g. 'Re-annotation with guideline 2.3'.",
            ),
        ],
        confirm: Confirm = False,
        expected_revision: ExpectedRevision = None,
    ) -> dict[str, Any]:
        """Withdraw the final result of one text, after a dry run.

        The text then has no final result until one is chosen again
        (set_final_result, accept_agreeing_texts); its submissions and
        consolidations stay, final exports already made stay as they are,
        and change_annotation_mode is possible again. The reason is recorded
        in the audit and the text's history. The dry run shows the final
        result and its revision (plan.revision); confirm needs that value as
        expected_revision and is refused if the final result changed since
        the dry run.
        """
        found, _ = await rows(api, project, case=case_id, language=[language])
        row = next(
            (
                r
                for r in found
                if r.get("case_id") == case_id and r.get("language") == language
            ),
            None,
        )
        if row is None:
            raise OntotatorError(f"Project {project} has no text {case_id} {language}.")
        final = row.get("final")
        if not final:
            raise OntotatorError(f"{case_id} {language} has no final result.")
        plan = {
            "current_final": final,
            "revision": int(final["revision"]),
            "consequences": [
                "The text has no final result until one is chosen again.",
                "Final exports already made stay as they are.",
                "The annotation mode can be changed again.",
                "Submissions and consolidations stay.",
            ],
        }
        if not confirm:
            return {"applied": False, "plan": plan}
        if expected_revision is None:
            raise OntotatorError(
                "Run the dry run first and pass its plan.revision as"
                " expected_revision with confirm."
            )
        # The server compares the revision: a final result that changed since
        # the dry run is refused there (REVISION_CONFLICT), not withdrawn.
        withdrawn: dict[str, Any] = await api.post(
            project_path(project, "final-selections", "withdraw"),
            {
                "case_id": case_id,
                "language": language,
                "expected_revision": expected_revision,
                "reason": reason,
            },
        )
        return {"applied": True, "plan": plan, "withdrawn": withdrawn}

    async def _variant(project: str, document_id: str) -> dict[str, Any]:
        found: dict[str, Any] = await api.get(
            project_path(project, "documents", seg(document_id), "variant")
        )
        return found

    @register(server, scopes=("read", "project-admin"), effect="changes")
    async def request_translation_correction(
        project: Project,
        document_id: DocumentId,
        username: Annotated[
            str, Field(description="The translation reviewer who corrects it.")
        ],
        reason: Annotated[str, Field(min_length=1)],
        confirm_language: bool = False,
    ) -> dict[str, Any]:
        """Ask for a new translation review of an accepted translation version.

        For a correction or a second opinion of a version that is accepted,
        however it was accepted (by a translation review, by a lead, or on
        import); any translation reviewer, with a reason. A version that is
        not accepted is refused (TRANSLATION_NOT_ACCEPTED). Gives the person a
        translation review task on this version; an earlier submitted review
        of theirs is reopened with the current text (the submitted review
        stays). The review itself is done in the web interface. For a
        rejected or queried translation, use start_lead_correction.
        """
        variant = await _variant(project, document_id)
        task: dict[str, Any] = await api.post(
            project_path(
                project,
                "documents",
                seg(document_id),
                "translation-correction-assignment",
            ),
            {
                "username": username,
                "expected_text_sha256": variant["text_sha256"],
                "reason": reason,
                "confirm_language": confirm_language,
            },
        )
        return assignment_summary(task)

    @register(server, scopes=("read", "project-admin"), effect="changes")
    async def start_lead_correction(
        project: Project, document_id: DocumentId, confirm_language: bool = False
    ) -> dict[str, Any]:
        """Take over the correction of a rejected, queried or accepted translation as the lead.

        Gives the token's owner, a lead of the project, a translation review
        task (``lead_correction``) on the newest version; the review itself
        is done in the web interface and submitted only as accepted after
        correction. The correction of an accepted version becomes a new
        version that is reviewed again; annotation work stays on the
        accepted version (handle it with the text-change tools). An earlier
        submitted review of the lead is withdrawn (it stays recorded).
        Calling it again returns the same task.
        """
        variant = await _variant(project, document_id)
        task: dict[str, Any] = await api.post(
            project_path(project, "documents", seg(document_id), "lead-correction"),
            {
                "expected_text_sha256": variant["text_sha256"],
                "confirm_language": confirm_language,
            },
        )
        return assignment_summary(task)

    @register(server, scopes="project-admin", effect="changes")
    async def accept_translation_version(
        project: Project,
        document_id: DocumentId,
        reason: Annotated[
            str,
            Field(min_length=1, description="Why it counts as reviewed (audited)."),
        ],
        expected_text_sha256: Annotated[
            str | None,
            Field(
                description=(
                    "With confirm: the text_sha256 the dry run returned, so the"
                    " text that was checked is the text that is accepted."
                )
            ),
        ] = None,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Accept exactly one translation version as reviewed outside Ontotator, after a dry run.

        Only the newest version of its translation: other translations of
        the same text stay as they are (unlike update_work_plan's
        accept_external_review). The dry run says whether the version is
        acceptable, the reason if not (accepted, reviewed, not_newest,
        discarded, review_open) and its text_sha256; confirm sends that
        hash back as expected_text_sha256 and is refused if the text
        changed since. The acceptance is recorded with the token owner's
        name, the reason and the time.
        """
        path = project_path(project, "variants", seg(document_id), "accept")
        if not confirm:
            plan: dict[str, Any] = await api.get(path)
            return {"applied": False, "plan": plan}
        if not expected_text_sha256:
            raise OntotatorError(
                "Run the dry run first and pass its text_sha256 as"
                " expected_text_sha256."
            )
        result: dict[str, Any] = await api.post(
            path, {"reason": reason, "expected_text_sha256": expected_text_sha256}
        )
        return {"applied": True, "result": result}

    @register(server, scopes="project-admin", effect="changes")
    async def upload_translation_version(
        project: Project,
        document_id: Annotated[
            str,
            Field(
                description=(
                    "The newest version of the translation (list_texts,"
                    " versions); the new version follows it."
                )
            ),
        ],
        text: Annotated[
            str, Field(min_length=1, description="The whole new text (UTF-8).")
        ],
        method: Annotated[
            Literal["machine_translation", "human_translation", "manual_correction"],
            Field(description="How the text was made."),
        ],
        provider: Annotated[
            str | None,
            Field(
                description=(
                    "Required for machine_translation, in the dry run too,"
                    " e.g. 'DeepL'."
                )
            ),
        ] = None,
        model: Annotated[
            str | None, Field(description="Model or tool, e.g. 'deepl-2026-10'.")
        ] = None,
        made_on: Annotated[
            str | None, Field(description="Date the text was made, YYYY-MM-DD.")
        ] = None,
        made_by: Annotated[
            str | None, Field(description="Person or group who made the text.")
        ] = None,
        note: Annotated[
            str | None, Field(description="Free note (shown on the row).")
        ] = None,
        expected_previous_sha256: Annotated[
            str | None,
            Field(
                description=(
                    "With confirm: the text_sha256 the dry run returned, so the"
                    " version that was compared is the version that is followed."
                )
            ),
        ] = None,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Upload a new version of one translation made elsewhere, after a dry run.

        The text becomes the next version of the translation: always a
        correction of document_id (the newest version of its translation),
        ready for review, with Review on for the text. Nothing is accepted:
        accept it afterwards with accept_translation_version, or assign a
        translation review. The dry run says whether a version can follow
        (reason if not: not_newest, discarded, review_open, unchanged),
        which number it gets, how many annotations, open consolidations and
        whether a final result stay on the current version (handle them with
        the text-change tools), and the text_sha256 of the current version;
        confirm sends that hash back as expected_previous_sha256 and is
        refused if a newer version arrived since. A source text is not
        uploaded here (import a package instead).
        """
        if method == "machine_translation" and not (provider or "").strip():
            raise OntotatorError(
                "A machine translation names its provider; nothing was checked or"
                " changed. Pass provider (e.g. 'DeepL'), in the dry run too."
            )
        base = project_path(project, "variants", seg(document_id), "versions")
        if not confirm:
            plan: dict[str, Any] = await api.post(f"{base}/preview", {"text": text})
            # The texts themselves are the caller's and the server's; the
            # plan keeps what decides the upload.
            stored = plan.pop("text", None) or ""
            previous = plan.pop("previous_text", None) or ""
            plan["text_characters"] = len(stored)
            plan["previous_text_characters"] = len(previous)
            return {"applied": False, "plan": plan}
        if not expected_previous_sha256:
            raise OntotatorError(
                "Run the dry run first and pass its text_sha256 as"
                " expected_previous_sha256."
            )
        body: dict[str, Any] = {
            "text": text,
            "expected_text_sha256": expected_previous_sha256,
            "method": method,
        }
        for name, value in (
            ("provider", provider),
            ("model", model),
            ("made_on", made_on),
            ("made_by", made_by),
            ("note", note),
        ):
            if value:
                body[name] = value
        result: dict[str, Any] = await api.post(base, body)
        return {"applied": True, "result": result}

    @register(server, scopes="project-admin", effect="changes")
    async def editorial_correction(
        project: Project,
        document_id: Annotated[
            str,
            Field(
                description=(
                    "The newest version of the translation (list_texts,"
                    " versions); the corrected version follows it."
                )
            ),
        ],
        replacements: Annotated[
            list[Replacement],
            Field(
                min_length=1,
                description=(
                    "The fixes: each 'old' passage must occur exactly once in"
                    " the text (add neighbouring words until it does) and is"
                    " replaced by 'new'; passages must not overlap."
                ),
            ),
        ],
        reason: Annotated[
            str,
            Field(min_length=1, description="Why the text is corrected (audited)."),
        ],
        expected_text_sha256: Annotated[
            str | None,
            Field(
                description=(
                    "With confirm: the text_sha256 the dry run returned, so the"
                    " text the fixes were checked against is the text corrected."
                )
            ),
        ] = None,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Fix spacing, typos or grammar in one translation, after a dry run.

        Not a translation review: the corrected text becomes the next version
        of the translation with the status of document_id, so an accepted
        text stays accepted (and a rejected or queried one stays so), and the
        correction is audited with its reason. A review assigned afterwards
        is a review of the corrected version; document_id takes no further
        review. A change of content belongs
        in a translation review (request_translation_correction,
        start_lead_correction). The dry run returns the diff, how many
        characters change, number_changes (the numbers the fixes change; a
        notice to check, nothing is refused for it), whether the correction
        is available (reason if not: not_newest, discarded, review_open,
        unchanged) and what follows: tasks_following (annotation tasks nobody
        opened move to the new version), the annotation work, open
        consolidations and a final result that stay on the current version
        (handle them with the text-change tools), findings of submitted
        annotations and tool proposals that are carried or need a check, and
        the text_sha256 of the current version; confirm sends that hash back
        as expected_text_sha256 and is refused if the text changed since.
        Only the token's owner as lead of the project can do this; a source
        text is not corrected here.
        """
        base = project_path(project, "documents", seg(document_id))
        fixes = [item.model_dump() for item in replacements]
        if not confirm:
            plan: dict[str, Any] = await api.post(
                f"{base}/editorial-correction/preview", {"replacements": fixes}
            )
            # The whole texts stay on the server; the diff names the passages.
            stored = plan.pop("text", None) or ""
            previous = plan.pop("previous_text", None) or ""
            plan["text_characters"] = len(stored)
            plan["previous_text_characters"] = len(previous)
            return {"applied": False, "plan": plan}
        if not expected_text_sha256:
            raise OntotatorError(
                "Run the dry run first and pass its text_sha256 as"
                " expected_text_sha256."
            )
        result: dict[str, Any] = await api.post(
            f"{base}/editorial-correction",
            {
                "replacements": fixes,
                "reason": reason,
                "expected_text_sha256": expected_text_sha256,
            },
        )
        return {"applied": True, "result": result}

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def discard_translation(
        project: Project,
        document_id: DocumentId,
        reason: Annotated[str, Field(min_length=1)],
        withdraw_tasks: WithdrawTasks = False,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Discard a translation version, after a dry run.

        The dry run shows the version and its current tasks. With confirm
        the version and its later corrections are discarded: no one
        reviews or annotates them any more. When that withdraws tasks or
        final results, the server refuses unless withdraw_tasks, and the
        result lists them.
        """
        variant = await _variant(project, document_id)
        tasks = await api.get(
            project_path(project, "assignments"), document_id=document_id
        )
        plan = {
            "variant": {
                key: variant.get(key)
                for key in (
                    "document_id",
                    "case_id",
                    "language",
                    "version",
                    "origin",
                    "translation_status",
                )
            },
            "tasks": _cut([assignment_summary(t) for t in tasks]),
        }
        if not confirm:
            return {"applied": False, "plan": plan}
        try:
            result: dict[str, Any] = await api.post(
                project_path(project, "variants", seg(document_id), "discard"),
                {"reason": reason, "confirm": withdraw_tasks},
            )
        except OntotatorError as exc:
            if exc.code != CONFIRMATION:
                raise
            return _needs_confirmation(exc) | {"plan": plan}
        return {"applied": True, "plan": plan, "result": result}

    @register(server, scopes="project-admin", effect="destructive")
    async def undo_work_plan(
        project: Project,
        undo: Annotated[
            dict[str, Any],
            Field(
                description=(
                    "The 'undo' object of an update_work_plan result (inside"
                    " 'result'), unchanged: its rows and revisions."
                )
            ),
        ],
        withdraw_tasks: WithdrawTasks = False,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Undo a work plan change of update_work_plan, after a dry run.

        Restores the exact earlier flags, annotation modes and final
        results of each row. The dry run lists the rows; with confirm they
        are restored, refused if a row changed since. Tasks assigned after
        the change are withdrawn only with withdraw_tasks; without it the
        result lists them.
        """
        undo_rows = undo.get("rows")
        revisions = undo.get("revisions")
        if not isinstance(undo_rows, list) or not isinstance(revisions, dict):
            raise OntotatorError(
                "undo must be the 'undo' object of an update_work_plan result."
            )
        plan = {"rows": _cut(undo_rows), "row_count": len(undo_rows)}
        if not undo_rows:
            return {"applied": False, "plan": plan, "note": "Nothing to undo."}
        if not confirm:
            return {"applied": False, "plan": plan}
        try:
            result: dict[str, Any] = await api.put(
                project_path(project, "work-plans/rows"),
                {
                    "rows": undo_rows,
                    "expected_revisions": revisions,
                    "undo": True,
                    "confirm": withdraw_tasks,
                },
            )
        except OntotatorError as exc:
            if exc.code != CONFIRMATION:
                raise
            return _needs_confirmation(exc) | {"plan": plan}
        return {"applied": True, "plan": plan, "result": result}

    @register(server, scopes="read", effect="read")
    async def annotation_target_preview(
        project: Project,
        annotations_per_text: Annotated[int, Field(ge=1, le=20)],
    ) -> dict[str, Any]:
        """How many texts already have more annotation tasks than a new target.

        Check this before lowering annotations_per_text with
        update_project_settings: those texts keep their extra tasks.
        """
        preview: dict[str, Any] = await api.get(
            project_path(project, "work-plans/annotation-target-preview"),
            annotations_per_text=annotations_per_text,
        )
        return preview

    @register(server, scopes="project-admin", effect="changes", idempotent=True)
    async def set_annotations_per_text(
        project: Project,
        case_id: str,
        language: str,
        annotations_per_text: Annotated[
            int | None,
            Field(
                ge=1,
                le=20,
                description=(
                    "The text's own number of annotators (target and limit),"
                    " e.g. 4 for a method comparison; None returns the text to"
                    " the project's annotations_per_text."
                ),
            ),
        ],
        reason: Annotated[str | None, Field(max_length=2000)] = None,
    ) -> dict[str, Any]:
        """Give one text (case + language) its own annotations per text.

        It replaces the project value for that text, for every version, as
        target and as limit; other texts keep the project value. Lowering
        it removes nobody. Assign afterwards with assign_texts.
        """
        result: dict[str, Any] = await api.put(
            project_path(
                project,
                "texts",
                seg(case_id),
                seg(language),
                "annotations-per-text",
            ),
            {"value": annotations_per_text, "reason": reason},
        )
        return result

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def move_task_to_version(
        project: Project,
        assignment_id: AssignmentId,
        target_document_id: Annotated[
            str, Field(description="The new text version (list_texts, versions).")
        ],
        confirm_unreviewed_translation: bool = False,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Move open annotation work to a new version of its text, after a dry run.

        The dry run counts the findings that can be placed on the new
        version and those in changed passages. With confirm the person
        continues on the new version with the placed findings; the old
        task is withdrawn and its draft kept as a snapshot.
        """
        task = await find_assignment(api, project, assignment_id)
        preview = await _text_change_preview(
            api, project, {"assignment_id": assignment_id}, target_document_id
        )
        plan = {"task": assignment_summary(task), "preview": preview}
        if not confirm:
            return {"applied": False, "plan": plan}
        moved: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/move-to-version",
            {
                "target_document_id": target_document_id,
                "expected_workflow_revision": task["workflow_revision"],
                "request_id": str(uuid.uuid4()),
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
            },
        )
        return {
            "applied": True,
            "plan": plan,
            "assignment": assignment_summary(moved["assignment"]),
            "round": _round_summary(moved.get("round")),
        }

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def handle_text_change(
        project: Project,
        assignment_id: AssignmentId,
        target_document_id: Annotated[
            str, Field(description="The new text version (list_texts, versions).")
        ],
        resolution: Annotated[
            Literal["finish_then_carry", "withdrawn"],
            Field(
                description=(
                    "'finish_then_carry': the person finishes on the old version"
                    " and the result is carried later (carry_submission)."
                    " 'withdrawn': the task is WITHDRAWN; its draft is kept."
                )
            ),
        ],
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Decide on open work on an old text version, after a dry run.

        The other choice is move_task_to_version. The dry run shows the
        task and what a move would carry; with confirm the decision is
        recorded, refused if the task changed since.
        """
        task = await find_assignment(api, project, assignment_id)
        preview = await _text_change_preview(
            api, project, {"assignment_id": assignment_id}, target_document_id
        )
        plan = {
            "task": assignment_summary(task),
            "resolution": resolution,
            "preview": preview,
        }
        if not confirm:
            return {"applied": False, "plan": plan}
        decided: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/text-change-resolution",
            {
                "resolution": resolution,
                "target_document_id": target_document_id,
                "expected_workflow_revision": task["workflow_revision"],
            },
        )
        return {
            "applied": True,
            "plan": plan,
            "assignment": assignment_summary(decided),
        }

    # The decision is final in every mode, 'dismiss' included.
    @register(server, scopes="project-admin", effect="destructive")
    async def carry_submission(
        project: Project,
        submission_id: Annotated[
            str, Field(description="A submission on an old version of the text.")
        ],
        target_document_id: Annotated[
            str, Field(description="The new text version (list_texts, versions).")
        ],
        mode: Annotated[
            Literal["author", "other", "dismiss"],
            Field(
                description=(
                    "'author': the author checks the carried findings on the"
                    " new version; 'other': another person (username) does;"
                    " 'dismiss': nothing is carried, the decision is recorded."
                )
            ),
        ] = "author",
        username: Annotated[
            str | None, Field(description="mode 'other': who checks them.")
        ] = None,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Carry a submitted annotation to a new version of its text, after a dry run.

        The dry run counts the findings that can be placed and lists the
        people who could check them. With confirm a new task carries the
        placed findings; the submission itself stays. The decision, 'dismiss'
        included, is final: the submission cannot be carried to this version
        again.
        """
        preview = await _text_change_preview(
            api, project, {"submission_id": submission_id}, target_document_id
        )
        if not confirm:
            return {"applied": False, "preview": preview}
        carried: dict[str, Any] = await api.post(
            project_path(project, "submissions", seg(submission_id), "carry"),
            {
                "target_document_id": target_document_id,
                "mode": mode,
                "username": username,
                "confirm_language": confirm_language,
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
                "request_id": str(uuid.uuid4()),
            },
        )
        assignment = carried.get("assignment")
        return {
            "applied": True,
            "preview": preview,
            "resolution": carried.get("resolution"),
            "carried_findings": carried.get("carried_findings"),
            "assignment": assignment_summary(assignment) if assignment else None,
        }

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def act_on_problem_report(
        report_id: Annotated[str, Field(description="list_problem_reports")],
        action: Annotated[
            Literal["resume", "resolve", "extend_hold", "restart", "reopen"],
            Field(
                description=(
                    "'resume': release the paused tasks (all the report paused,"
                    " or assignment_ids). 'resolve': close the report."
                    " 'extend_hold': also pause the tasks in assignment_ids."
                    " 'restart': release the reporter's task and START IT AGAIN"
                    " EMPTY (its draft is abandoned). 'reopen': open a closed"
                    " report again."
                )
            ),
        ],
        reason: Annotated[str, Field(min_length=1)],
        assignment_ids: Annotated[
            list[int],
            Field(description="resume or extend_hold: the tasks (pause candidates)."),
        ] = [],  # noqa: B006
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Decide on a problem report: pause, release, restart or resolve, after a dry run.

        The dry run shows the report (state, paused tasks) and the tasks it
        can pause (pause candidates). With confirm the action is applied,
        refused if the report changed since.
        """
        base = f"/api/v1/problem-reports/{seg(report_id)}"
        report: dict[str, Any] = await api.get(base)
        candidates = await api.get(f"{base}/pause-candidates")
        if action == "extend_hold" and not assignment_ids:
            raise OntotatorError("extend_hold needs assignment_ids (pause candidates).")
        plan = {
            "report": {
                key: report.get(key)
                for key in (
                    "report_id",
                    "case_id",
                    "language",
                    "task",
                    "assignment_id",
                    "reason",
                    "state",
                    "revision",
                    "held_assignment_ids",
                    "reporter_label",
                )
            },
            "pause_candidates": _cut(candidates),
            "action": action,
            "assignment_ids": assignment_ids,
        }
        if not confirm:
            return {"applied": False, "plan": plan}
        done: dict[str, Any] = await api.post(
            f"{base}/actions",
            {
                "request_id": str(uuid.uuid4()),
                "expected_revision": report["revision"],
                "action": action,
                "reason": reason,
                "assignment_ids": assignment_ids,
            },
        )
        return {
            "applied": True,
            "plan": plan,
            "state": done.get("state"),
            "held_assignment_ids": done.get("held_assignment_ids"),
            "new_round": _round_summary(done.get("new_round")),
        }
