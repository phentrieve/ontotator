"""Monitoring and QA tools: problem reports, guidelines, mode changes, one
text's history and translation reviews. All of them only read."""

from __future__ import annotations

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
DocumentId = Annotated[
    str,
    Field(description="ID of one text version (document_id from list_texts)."),
]
# Tasks that work in rounds: their rounds name the inputs and submissions.
ROUND_TASKS = ("annotate", "review")
# What a reviewer wrote in a translation review: the full corrected text and
# the free-text rationale. Returned only by an MCP server started with
# ONTOTATOR_MCP_READ_CONTENT=1, and there only with include_text.
REVIEW_CONTENT = ("proposed_text", "rationale")


def without_review_content(reviews: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The reviews without the reviewers' text; the text hashes stay."""
    return [
        {name: value for name, value in review.items() if name not in REVIEW_CONTENT}
        for review in reviews
    ]


ReviewDocument = Annotated[
    str | None, Field(description="Only reviews of this text version.")
]


def register_monitoring(
    server: MCPServer, api: OntotatorClient, *, read_content: bool
) -> None:
    @register(server, scopes="read", effect="read")
    async def get_problem_report(
        report_id: Annotated[
            str, Field(min_length=1, description="report_id from list_problem_reports.")
        ],
    ) -> dict[str, Any]:
        """One problem report with its events, holds and resolution.

        The route is not part of a project's path: until project tokens
        reach it, it needs a personal token.
        """
        report: dict[str, Any] = await api.get(
            f"/api/v1/problem-reports/{seg(report_id)}"
        )
        return report

    @register(server, scopes="read", effect="read")
    async def list_guidelines(project: Project) -> dict[str, Any]:
        """The project's guideline versions and who has read them.

        For leads each version names how many members were notified of it
        and opened it ('reach') and who has not seen it yet ('not_seen');
        the text of a version is the resource ontotator://projects/{project}/guideline.
        'version' counts the project's uploads and is the identifier; 'label'
        is the version the document gives itself ('3.1'), null without one.
        Name a version to people as '3.1 (v2)', as the app does.
        """
        listing: dict[str, Any] = await api.get(project_path(project, "guidelines"))
        return listing

    @register(server, scopes="read", effect="read")
    async def list_mode_changes(
        project: Project,
        case_id: Annotated[str | None, Field(description="Only this case.")] = None,
        language: Annotated[
            str | None, Field(description="Only this language.")
        ] = None,
    ) -> dict[str, Any]:
        """Changes of a text's annotation mode, newest first.

        Each names the old and new mode, the reason, who changed it, the
        work it discarded and whether it can be restored. Without filters
        the whole project's changes.
        """
        changes: dict[str, Any] = await api.get(
            project_path(project, "annotation-mode-changes"),
            case_id=case_id,
            language=language,
        )
        return changes

    @register(server, scopes="read", effect="read")
    async def get_text_detail(
        project: Project, document_id: DocumentId
    ) -> dict[str, Any]:
        """One text version's history: tasks, rounds, submissions and translation reviews.

        Names who worked on the text in which task and state, every round
        of annotation and consolidation with its inputs and submissions,
        every submitted result and every translation review. A paused task
        has 'held' with 'pause_causes': 'report' (a problem report) and/or
        'lead' (a lead paused the text, pause_texts). Findings are
        not part of it, nor the text a translation reviewer proposed or
        their rationale (list_translation_reviews returns them with
        include_text, when this MCP server runs with
        ONTOTATOR_MCP_READ_CONTENT=1, a setting in the MCP client's
        configuration of ontotator-mcp, not of the Ontotator server). The
        rounds come from a route outside the project's path: until project
        tokens reach it, it needs a personal token.
        """
        doc = seg(document_id)
        assignments: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"),
            document_id=document_id,
            include_revoked=True,
        )
        rounds: list[dict[str, Any]] = []
        for item in assignments:
            if item.get("task") in ROUND_TASKS:
                rounds.extend(
                    await api.get(f"/api/v1/assignments/{seg(item['id'])}/rounds")
                )
        submissions = await api.get(
            project_path(project, "documents", doc, "submissions")
        )
        reviews = await api.get(
            project_path(project, "documents", doc, "translation-reviews")
        )
        return {
            "document_id": document_id,
            "assignments": [
                {
                    name: item.get(name)
                    for name in (
                        "id",
                        "username",
                        "pseudonym",
                        "task",
                        "status",
                        "annotation_mode",
                        "created_at",
                        "updated_at",
                        "revoked_at",
                        "last_submission_id",
                        "held",
                        "hold_reason",
                        "pause_causes",
                        "lead_pause_reason",
                    )
                }
                for item in assignments
            ],
            "rounds": rounds,
            "submissions": submissions,
            "translation_reviews": without_review_content(reviews),
        }

    async def reviews_of(
        project: str, document_id: str | None, include_text: bool
    ) -> list[dict[str, Any]]:
        path = (
            project_path(project, "translation-reviews")
            if document_id is None
            else project_path(
                project, "documents", seg(document_id), "translation-reviews"
            )
        )
        reviews: list[dict[str, Any]] = await api.get(path)
        return reviews if include_text else without_review_content(reviews)

    # Two registrations, as list_typography_hints: without the opt-in the
    # argument that returns text does not exist, so no call can ask for it.
    if read_content:

        @register(server, scopes="read", effect="read")
        async def list_translation_reviews(
            project: Project,
            document_id: ReviewDocument = None,
            include_text: Annotated[
                bool,
                Field(
                    description=(
                        "Also return each review's 'proposed_text' (the full"
                        " text the reviewer submitted) and 'rationale'. Off by"
                        " default: clinical text then stays out of the result."
                    )
                ),
            ] = False,
        ) -> list[dict[str, Any]]:
            """Submitted translation reviews: decision, clinical change, categories, reviewer.

            Oldest first. A lead sees every review; anyone else their own.
            The text a reviewer proposed and their rationale are returned
            only with include_text, which exists because this MCP server
            runs with ONTOTATOR_MCP_READ_CONTENT=1; the text hashes always.
            """
            return await reviews_of(project, document_id, include_text)

    else:

        @register(server, scopes="read", effect="read")
        async def list_translation_reviews(  # type: ignore[misc]
            project: Project,
            document_id: ReviewDocument = None,
        ) -> list[dict[str, Any]]:
            """Submitted translation reviews: decision, clinical change, categories, reviewer.

            Oldest first. A lead sees every review; anyone else their own.
            The text a reviewer proposed and their rationale are not
            returned (the text hashes are): they need this MCP server
            (not the Ontotator server) to run with
            ONTOTATOR_MCP_READ_CONTENT=1, set in the MCP client's
            configuration of ontotator-mcp; whoami says whether it is on.
            """
            return await reviews_of(project, document_id, False)
