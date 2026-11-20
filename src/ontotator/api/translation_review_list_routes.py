"""The translation reviews of a project as a list for leads (issue 483).

One row per submitted translation review and per open one, with the reviewed
text, the reviewer, the decision, the rationale and the number of changed
passages. A lead judges a reviewer's work here and reads the rationale of
every review, also of an accepting one. Leads and system admins only (and
their tokens with ``read``); reviewers are person references, as on
Progress. ``GET /projects/{key}/translation-reviews`` stays the plain list
of records for a text's history and the MCP server.
"""

from datetime import datetime
from typing import Annotated, Any, Literal, get_args

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import (
    ColumnElement,
    Row,
    and_,
    false,
    func,
    literal,
    null,
    select,
    true,
    union_all,
)

from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.job_routes import authorized_project
from ontotator.api.person_views import PersonRefView
from ontotator.application.people import person_refs
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action
from ontotator.domain.text_changes import changed_passages
from ontotator.domain.translation_review import ClinicalCategory, ReviewDecisionCode
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    TranslationReviewRow,
    UserRow,
)

router = APIRouter(
    prefix="/api/v1/projects",
    tags=["translation-reviews"],
    route_class=EncodedParameterRoute,
)

ListDecision = Literal[
    "accepted_unchanged", "accepted_corrected", "query", "rejected", "open"
]
ListSort = Literal["-submitted", "submitted"]
MAX_LIMIT = 200
assert set(get_args(ReviewDecisionCode)) | {"open"} == set(get_args(ListDecision))


class TranslationReviewListRow(BaseModel):
    """One translation review of the project.

    ``decision`` is ``open`` for an assigned review that is not submitted
    (again); then ``review_id``, the form fields and ``submitted_at`` are
    null. ``changed_passages``: the passages the reviewer's text differs in
    from the reviewed text, compared by words (0 when the text is unchanged,
    null when the texts differ too much to count). ``created_variant_id``:
    the version an "accepted with corrections" review created.
    """

    review_id: int | None
    assignment_id: int
    document_id: str
    case_id: str
    language: str
    version: int
    reviewer: PersonRefView
    decision: ListDecision
    clinical_change: bool | None
    categories: list[ClinicalCategory]
    rationale: str | None
    changed_passages: int | None
    created_variant_id: str | None
    submitted_at: datetime | None
    assigned_at: datetime | None


class TranslationReviewListPage(BaseModel):
    reviews: list[TranslationReviewListRow]
    # Matching reviews in all; ``reviews`` is one page of them.
    total: int
    limit: int
    offset: int
    # Everyone with a translation review in the project, and the languages
    # of the reviewed texts: the choices of the filters, whatever is filtered.
    reviewers: list[PersonRefView]
    languages: list[str]


@router.get("/{key}/translation-review-list")
def translation_review_list(
    key: str,
    request: Request,
    principal: PrincipalDep,
    reviewer: Annotated[
        str | None, Query(description="The reviewer's pseudonym.")
    ] = None,
    decision: Annotated[list[ListDecision] | None, Query()] = None,
    language: Annotated[
        list[str] | None, Query(description="Languages of the reviewed texts.")
    ] = None,
    sort: Annotated[
        ListSort,
        Query(description="By submitted date; open reviews always come last."),
    ] = "-submitted",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TranslationReviewListPage:
    """Submitted and open translation reviews (leads and system admins)."""
    actor = Actor.user(principal.user_id, principal.username)
    review, task = TranslationReviewRow, AssignmentRow
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(
            conn, key, actor, Action.VIEW_PROGRESS, structure=False
        )
        entries = union_all(
            select(
                literal("review").label("kind"),
                review.id.label("id"),
                review.reviewer_user_id.label("user_id"),
                review.document_id.label("document_id"),
                review.decision.label("decision"),
                review.created_at.label("submitted_at"),
            ).where(review.project_id == project_id),
            select(
                literal("open"),
                task.id,
                task.user_id,
                task.document_id,
                literal("open"),
                null().cast(review.created_at.type),
            ).where(
                task.project_id == project_id,
                task.task == "translation_review",
                task.revoked_at.is_(None),
                task.status != "submitted",
            ),
        ).subquery("entries")
        document = and_(
            DocumentRow.project_id == project_id,
            DocumentRow.document_id == entries.c.document_id,
        )
        where: list[ColumnElement[bool]] = []
        if reviewer is not None:
            ids = (
                conn.execute(
                    select(UserRow.id).where(UserRow.pseudonym == reviewer.strip())
                )
                .scalars()
                .all()
            )
            where.append(entries.c.user_id.in_(ids) if ids else false())
        if decision:
            where.append(entries.c.decision.in_(decision))
        if language:
            where.append(DocumentRow.language.in_(language))
        condition = and_(true(), *where)
        total = conn.execute(
            select(func.count())
            .select_from(entries)
            .join(DocumentRow, document)
            .where(condition)
        ).scalar_one()
        date = entries.c.submitted_at
        page = conn.execute(
            select(
                entries,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.version,
                DocumentRow.text,
            )
            .join(DocumentRow, document)
            .where(condition)
            .order_by(
                (date.asc() if sort == "submitted" else date.desc()).nulls_last(),
                entries.c.kind.desc(),
                entries.c.id.asc() if sort == "submitted" else entries.c.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        ).all()
        records = {
            row.id: row
            for row in conn.execute(
                select(review).where(
                    review.id.in_([row.id for row in page if row.kind == "review"])
                )
            ).mappings()
        }
        assigned = dict(
            conn.execute(
                select(task.id, task.created_at).where(
                    task.id.in_(
                        [row.id for row in page if row.kind == "open"]
                        + [record.assignment_id for record in records.values()]
                    )
                )
            )
            .tuples()
            .all()
        )
        facets = conn.execute(
            select(entries.c.user_id, DocumentRow.language)
            .join(DocumentRow, document)
            .distinct()
        ).all()
        people = person_refs(
            conn,
            [row.user_id for row in facets],
            viewer_id=principal.user_id,
            viewer_is_lead=True,
        )

    def view(row: Row[Any]) -> TranslationReviewListRow:
        record = records.get(row.id) if row.kind == "review" else None
        assignment_id = row.id if record is None else record.assignment_id
        return TranslationReviewListRow(
            review_id=None if record is None else record.id,
            assignment_id=assignment_id,
            document_id=row.document_id,
            case_id=row.case_id,
            language=row.language,
            version=row.version,
            reviewer=people[row.user_id],
            decision=row.decision,
            clinical_change=None if record is None else record.clinical_change,
            categories=[] if record is None else record.categories,
            rationale=None if record is None else record.rationale,
            changed_passages=None
            if record is None
            else 0
            if record.proposed_text_sha256 == record.machine_text_sha256
            else changed_passages(row.text, record.proposed_text),
            created_variant_id=None if record is None else record.created_variant_id,
            submitted_at=row.submitted_at,
            assigned_at=assigned.get(assignment_id),
        )

    return TranslationReviewListPage(
        reviews=[view(row) for row in page],
        total=total,
        limit=limit,
        offset=offset,
        reviewers=sorted(
            people.values(),
            key=lambda person: (person.display_name or person.pseudonym).casefold(),
        ),
        languages=sorted({row.language for row in facets}),
    )
