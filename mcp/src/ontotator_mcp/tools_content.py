"""Content tools: the text of a version and submitted annotations (opt-in).

Registered only with ``ONTOTATOR_MCP_READ_CONTENT=1``: they put clinical
text and annotation content into the model's context, which the server does
not do by default. All of them only read, and only immutable, submitted
work: drafts and other unsubmitted work have no route a token can reach.

Each tool returns what its HTTP route returns for the token's owner; author
labels are the route's (with names hidden during consolidation, "Annotator
A" for the consolidator). The text itself, and the text of annotated
passages, is added only with ``include_text``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.tooling import NOT_A_CASE_ID, listing, register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
DocumentId = Annotated[
    str,
    Field(
        description="ID of one text version (document_id from list_texts)."
        + NOT_A_CASE_ID
    ),
]
IncludeText = Annotated[
    bool,
    Field(
        description=(
            "Also return text of the document. Off by default: clinical text"
            " then stays out of the result."
        )
    ),
]
VersionKind = Literal[
    "own", "proposals", "stage_result", "release", "submission", "final"
]
# Names of the tools of this module, for the server and the tests.
CONTENT_TOOLS = (
    "get_text_version",
    "list_annotation_versions",
    "get_annotation_version",
    "get_submission",
    "get_consolidation_inputs",
)
# What get_consolidation_inputs keeps of a round and of the task.
ROUND_FIELDS = (
    "round_id",
    "kind",
    "state",
    "active",
    "round_ordinal",
    "input_count",
    "input_submission_ids",
)
TASK_FIELDS = (
    "project_key",
    "document_id",
    "external_id",
    "status",
    "active_round_id",
    "held",
)


def _with_span_text(segments: Any, text: str) -> None:
    """Add ``text`` to each segment: ``[start, end)`` in Unicode code points."""
    if not isinstance(segments, list):
        return
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        start, end = segment.get("start"), segment.get("end")
        if isinstance(start, int) and isinstance(end, int) and end <= len(text):
            segment["text"] = text[start:end]


def _evidence_text(evidence: Any, texts: dict[str, str]) -> None:
    if not isinstance(evidence, dict):
        return
    text = texts.get(evidence.get("document_id", ""))
    mention = evidence.get("mention")
    if text is None or not isinstance(mention, dict):
        return
    _with_span_text(mention.get("segments"), text)
    _with_span_text(mention.get("cue_segments"), text)


def _snapshot_text(snapshot: Any, texts: dict[str, str]) -> None:
    """The passages of one annotation snapshot: its evidence and modifiers."""
    if not isinstance(snapshot, dict):
        return
    for evidence in snapshot.get("evidence") or []:
        _evidence_text(evidence, texts)
    text = texts.get(snapshot.get("document_id", ""))
    annotation = snapshot.get("annotation")
    if text is None or not isinstance(annotation, dict):
        return
    for modifier in annotation.get("modifiers") or []:
        if isinstance(modifier, dict):
            _with_span_text(modifier.get("segments"), text)


def add_span_texts(body: dict[str, Any], texts: dict[str, str]) -> None:
    """Write the text of every annotated passage into ``body``, in place.

    ``texts`` maps a document ID to its text; passages on a document that
    is not in it (an earlier version without a readable text) keep their
    offsets only.
    """
    for snapshot in body.get("annotations") or []:
        _snapshot_text(snapshot, texts)
    for evidence in body.get("evidence") or []:
        _evidence_text(evidence, texts)
    for item in body.get("round_inputs") or []:
        if isinstance(item, dict):
            _snapshot_text(item.get("source_snapshot"), texts)
            _snapshot_text(item.get("target_snapshot"), texts)


def register_content(server: MCPServer, api: OntotatorClient) -> None:
    async def text_of(project: str, document_id: str) -> dict[str, Any]:
        found: dict[str, Any] = await api.get(
            project_path(project, "documents", seg(document_id), "text")
        )
        return found

    @register(server, scopes="read", effect="read")
    async def get_text_version(
        project: Project, document_id: DocumentId, include_text: IncludeText = False
    ) -> dict[str, Any]:
        """One text version: case, language, version, origin, predecessor, translation status, text hash.

        'derived_from' names the version it was corrected or translated
        from, 'translation' the translation run and its checks. The text
        itself is returned only with include_text. Exists because this MCP server runs with
        ONTOTATOR_MCP_READ_CONTENT=1.
        """
        version: dict[str, Any] = await api.get(
            project_path(project, "documents", seg(document_id), "variant")
        )
        if include_text:
            version["text"] = (await text_of(project, document_id))["text"]
        return version

    @register(server, scopes="read", effect="read")
    async def list_annotation_versions(
        project: Project, document_id: DocumentId
    ) -> dict[str, Any]:
        """The annotation states of a text version the token's owner may read: kind, id, label, time.

        Submitted work and imported tool proposals only, never a draft: a
        lead gets every submission of the text ('submission') and the
        proposal sets ('proposals'), anyone else their own submissions
        ('own'), in 'items'. get_annotation_version reads one by kind and id.
        Exists because this MCP server runs with ONTOTATOR_MCP_READ_CONTENT=1.
        """
        versions: list[dict[str, Any]] = await api.get(
            project_path(project, "documents", seg(document_id), "annotation-versions")
        )
        return listing(versions)

    @register(server, scopes="read", effect="read")
    async def get_annotation_version(
        project: Project,
        document_id: DocumentId,
        kind: Annotated[
            VersionKind, Field(description="'kind' from list_annotation_versions.")
        ],
        version_id: Annotated[
            str, Field(min_length=1, description="'id' from list_annotation_versions.")
        ],
        include_text: IncludeText = False,
    ) -> dict[str, Any]:
        """One annotation state of a text version: its annotations (term, values, note) and evidence.

        Passages are offsets into the text ('start', 'end' in Unicode code
        points); include_text adds the text of each passage. Only a state
        list_annotation_versions offers can be read. Exists because this MCP server runs with
        ONTOTATOR_MCP_READ_CONTENT=1.
        """
        state: dict[str, Any] = await api.get(
            project_path(
                project,
                "documents",
                seg(document_id),
                "annotation-versions",
                seg(kind),
                seg(version_id),
            )
        )
        if include_text:
            text = (await text_of(project, document_id))["text"]
            add_span_texts(state, {document_id: text})
        return state

    @register(server, scopes="read", effect="read")
    async def get_submission(
        project: Project,
        document_id: DocumentId,
        submission_id: Annotated[
            str,
            Field(min_length=1, description="submission_id from get_text_detail."),
        ],
        include_text: IncludeText = False,
    ) -> dict[str, Any]:
        """One submitted result: its annotations, evidence, proposal decisions and carried inputs.

        'summary' names the author as the web interface shows it to the
        token's owner. Passages are offsets into the text ('start', 'end'
        in Unicode code points). Without include_text the earlier text a
        carried round came from ('carried_from') is named without its text;
        with it, that text and the text of each passage are returned.
        Exists because this MCP server runs with
        ONTOTATOR_MCP_READ_CONTENT=1.
        """
        submission: dict[str, Any] = await api.get(
            project_path(
                project,
                "documents",
                seg(document_id),
                "submissions",
                seg(submission_id),
            )
        )
        carried = submission.get("carried_from")
        if not include_text:
            if isinstance(carried, dict):
                carried.pop("text", None)
            return submission
        texts = {document_id: (await text_of(project, document_id))["text"]}
        if isinstance(carried, dict) and isinstance(carried.get("text"), str):
            texts.setdefault(carried["document_id"], carried["text"])
        add_span_texts(submission, texts)
        return submission

    @register(server, scopes="read", effect="read")
    async def get_consolidation_inputs(
        assignment_id: Annotated[
            int,
            Field(
                ge=1,
                description="ID of your own consolidation task (assignment_id"
                " from list_my_tasks, task 'review').",
            ),
        ],
        include_text: IncludeText = False,
    ) -> dict[str, Any]:
        """The inputs of your own consolidation task: the submitted annotations it consolidates.

        For the consolidator the task is assigned to, as the consolidation
        screen of the web interface reads them: each round of the task with
        its inputs (term, values, note, passages, the submission each came
        from). With "Hide annotator names during consolidation" on, authors
        are 'annotator-a', 'annotator-b', … and every ID is the opaque ID
        the web interface shows you; pass a 'source_submission_id' to
        get_submission as it is. Anyone else's task, and a task that is not
        a consolidation, is refused. Passages are offsets into the text
        ('start', 'end' in Unicode code points); include_text adds the text
        of each passage on the task's text version. Your own decisions in
        the open consolidation are not part of it. Exists because this MCP
        server runs with ONTOTATOR_MCP_READ_CONTENT=1.
        """
        base = f"/api/v1/assignments/{seg(assignment_id)}"
        # The owner check of the route: only the token owner's own task.
        task: dict[str, Any] = await api.get(base)
        if task.get("task") != "review":
            raise OntotatorError(
                f"Task {assignment_id} is a '{task.get('task')}' task, not a"
                " consolidation; this tool reads only the inputs of a"
                " consolidation task (task 'review'). Nothing was read."
            )
        rounds: list[dict[str, Any]] = await api.get(f"{base}/rounds")
        listed = []
        for item in rounds:
            inputs: list[dict[str, Any]] = await api.get(
                f"/api/v1/rounds/{seg(item['round_id'])}/inputs"
            )
            listed.append(
                {name: item.get(name) for name in ROUND_FIELDS} | {"inputs": inputs}
            )
        project, document_id = task["project_key"], task["document_id"]
        if include_text:
            texts = {document_id: (await text_of(project, document_id))["text"]}
            for entry in listed:
                add_span_texts({"round_inputs": entry["inputs"]}, texts)
        return {
            "assignment_id": assignment_id,
            **{name: task.get(name) for name in TASK_FIELDS},
            "rounds": listed,
        }
