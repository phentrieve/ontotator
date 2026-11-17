"""Typography hints: spacing errors and invisible characters of texts.

One read-only tool, ``list_typography_hints``. A hint is a rule code and a
position; the server computes it on request and stores nothing. Without
``ONTOTATOR_MCP_READ_CONTENT=1`` the tool has no way to return text: the
argument that adds excerpts exists only when the content tools do.
"""

from __future__ import annotations

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
DocumentId = Annotated[
    str | None,
    Field(
        description=(
            "ID of one text version (document_id from list_texts): its hints"
            " with positions. None: the number of hints of each text of the"
            " project."
        )
    ),
]
After = Annotated[
    str | None,
    Field(description="Project list only: 'next_after' of the page before."),
]
AllVersions = Annotated[
    bool,
    Field(
        description=(
            "Project list only: also count earlier versions of a text, not"
            " only its newest."
        )
    ),
]
# Code points of the text shown on each side of a hint.
CONTEXT = 30


def with_excerpts(hints: list[dict[str, Any]], text: str) -> None:
    """Add ``text`` and ``context`` to each hint: ``[start, end)`` in code points."""
    for hint in hints:
        start, end = hint.get("start"), hint.get("end")
        if isinstance(start, int) and isinstance(end, int) and end <= len(text):
            hint["text"] = text[start:end]
            hint["context"] = text[max(0, start - CONTEXT) : end + CONTEXT]


def register_typography(
    server: MCPServer, api: OntotatorClient, *, read_content: bool
) -> None:
    async def hints(
        project: str,
        document_id: str | None,
        after: str | None,
        all_versions: bool,
        include_text: bool,
    ) -> dict[str, Any]:
        if document_id is None:
            listed: dict[str, Any] = await api.get(
                project_path(project, "typography-hints"),
                after=after,
                versions="all" if all_versions else None,
            )
            return listed
        found: dict[str, Any] = await api.get(
            project_path(project, "documents", seg(document_id), "typography-hints")
        )
        if include_text:
            text = await api.get(
                project_path(project, "documents", seg(document_id), "text")
            )
            with_excerpts(found["hints"], text["text"])
        return found

    if read_content:

        @register(server, scopes="read", effect="read")
        async def list_typography_hints(
            project: Project,
            document_id: DocumentId = None,
            after: After = None,
            all_versions: AllVersions = False,
            include_text: Annotated[
                bool,
                Field(
                    description=(
                        "With document_id: also return the characters of each"
                        " hint ('text') and the text around it ('context')."
                        " Off by default: clinical text then stays out of the"
                        " result."
                    )
                ),
            ] = False,
        ) -> dict[str, Any]:
            """Spacing errors and invisible characters: of one text version, or counted per text of a project.

            Rules: double space, space before punctuation, missing space
            after punctuation, whitespace at the end of a line or of the
            text (a single final line break is fine), tab, zero-width character, soft
            hyphen, control character. A hint is a rule code with 'start'
            and 'end' (Unicode code points, as annotation passages); it
            blocks nothing and is not stored. Without document_id: one page
            of texts with their counts per rule ('next_after' for the next
            page; only texts with a hint are listed). Text is returned only
            with include_text, which exists because this server runs with
            ONTOTATOR_MCP_READ_CONTENT=1.
            """
            return await hints(project, document_id, after, all_versions, include_text)

    else:

        @register(server, scopes="read", effect="read")
        async def list_typography_hints(  # type: ignore[misc]
            project: Project,
            document_id: DocumentId = None,
            after: After = None,
            all_versions: AllVersions = False,
        ) -> dict[str, Any]:
            """Spacing errors and invisible characters: of one text version, or counted per text of a project.

            Rules: double space, space before punctuation, missing space
            after punctuation, whitespace at the end of a line or of the
            text (a single final line break is fine), tab, zero-width character, soft
            hyphen, control character. A hint is a rule code with 'start'
            and 'end' (Unicode code points, as annotation passages); it
            blocks nothing and is not stored. Without document_id: one page
            of texts with their counts per rule ('next_after' for the next
            page; only texts with a hint are listed). No text is returned:
            excerpts need a server started with ONTOTATOR_MCP_READ_CONTENT=1.
            """
            return await hints(project, document_id, after, all_versions, False)
