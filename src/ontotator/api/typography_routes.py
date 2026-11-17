"""Typography hints of a text version and across a project (issue 454).

Computed from the stored text on every request and never stored. A hint
carries a rule code and a position, never text, and blocks nothing. Who may
read a text may read its hints, and nobody else: both routes use the rule of
the text route (``require_case_text`` / ``readable_case_documents``).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, select
from sqlalchemy.orm import aliased

from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.authz.policy import Action, can
from ontotator.authz.scoped import ScopedRepository
from ontotator.authz.visibility import current_access, readable_case_documents
from ontotator.domain.errors import DomainError
from ontotator.domain.typography import (
    TypographyRule,
    count_by_rule,
    typography_hints,
)
from ontotator.storage.tables import DocumentRow

router = APIRouter(
    prefix="/api/v1/projects/{key}",
    tags=["typography"],
    route_class=EncodedParameterRoute,
)

# Texts read per page of the project list: its cost is bounded by this
# number, not by the size of the project.
PROJECT_PAGE_DEFAULT = 100
PROJECT_PAGE_MAX = 200
VERSION_HINTS_DEFAULT = 500
VERSION_HINTS_MAX = 2000


class TypographyHintView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rule: TypographyRule
    start: int = Field(
        description="First code point of the hint (zero-based, Unicode code points, as annotation spans)."
    )
    end: int = Field(description="Code point after the last one of the hint.")


class VersionTypographyHints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    text_sha256: str
    total: int
    counts: dict[str, int] = Field(description="Number of hints per rule code.")
    hints: list[TypographyHintView]
    truncated: bool = Field(description="True when 'hints' holds fewer than 'total'.")


class TextTypographyCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    case_id: str
    language: str
    version: int
    total: int
    counts: dict[str, int]


class ProjectTypographyHints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    texts: list[TextTypographyCounts] = Field(
        description="The texts of this page that have at least one hint."
    )
    scanned: int = Field(description="Number of texts this page looked at.")
    next_after: str | None = Field(
        description="Pass as 'after' for the next page; null on the last page."
    )


def _repo(request: Request) -> ScopedRepository:
    return ScopedRepository(request.app.state.repo.db, get_access(request))


@router.get("/documents/{doc:path}/typography-hints")
def version_typography_hints(
    key: str,
    doc: str,
    request: Request,
    principal: PrincipalDep,
    limit: Annotated[int, Query(ge=1, le=VERSION_HINTS_MAX)] = VERSION_HINTS_DEFAULT,
) -> VersionTypographyHints:
    """Spacing errors and invisible characters of one text version."""
    repo = _repo(request)
    with repo.db.snapshot():
        document = repo.get_variant_text(key, doc)
        if document is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
    hints = typography_hints(document.text)
    return VersionTypographyHints(
        document_id=document.document_id,
        text_sha256=document.text_sha256,
        total=len(hints),
        counts=count_by_rule(hints),
        hints=[
            TypographyHintView(rule=hint.rule, start=hint.start, end=hint.end)
            for hint in hints[:limit]
        ],
        truncated=len(hints) > limit,
    )


@router.get("/typography-hints")
def project_typography_hints(
    key: str,
    request: Request,
    principal: PrincipalDep,
    after: Annotated[
        str | None, Query(description="'next_after' of the previous page.")
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=PROJECT_PAGE_MAX, description="Texts to look at per page."),
    ] = PROJECT_PAGE_DEFAULT,
    versions: Annotated[
        Literal["newest", "all"],
        Query(description="Only the newest version of each text, or every one."),
    ] = "newest",
) -> ProjectTypographyHints:
    """Hint counts per text, one page of texts at a time (ordered by document ID).

    Lists the texts the caller may read. The positions of a text's hints are
    read with the route of that version.
    """
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        project_id = repo._require_project(conn, key)
        fresh = current_access(conn, repo.access, project_id, key)
        if not can(fresh, Action.VIEW_PROJECT, key):
            raise DomainError("PROJECT_NOT_FOUND")
        visibility = readable_case_documents(conn, fresh, project_id, key)
        query = select(
            DocumentRow.document_id,
            DocumentRow.case_id,
            DocumentRow.language,
            DocumentRow.version,
            DocumentRow.text,
        ).where(DocumentRow.project_id == project_id)
        if not visibility.all:
            query = query.where(DocumentRow.document_id.in_(visibility.document_ids))
        if after is not None:
            query = query.where(DocumentRow.document_id > after)
        if versions == "newest":
            newer = aliased(DocumentRow)
            query = query.where(
                ~select(newer.document_id)
                .where(
                    and_(
                        newer.project_id == DocumentRow.project_id,
                        newer.external_id == DocumentRow.external_id,
                        newer.language == DocumentRow.language,
                        newer.version > DocumentRow.version,
                    )
                )
                .exists()
            )
        # One row more than the page tells whether another page follows.
        rows = conn.execute(
            query.order_by(DocumentRow.document_id).limit(limit + 1)
        ).all()
    page = rows[:limit]
    texts = []
    for row in page:
        hints = typography_hints(row.text)
        if hints:
            texts.append(
                TextTypographyCounts(
                    document_id=row.document_id,
                    case_id=row.case_id,
                    language=row.language,
                    version=row.version,
                    total=len(hints),
                    counts=count_by_rule(hints),
                )
            )
    return ProjectTypographyHints(
        texts=texts,
        scanned=len(page),
        next_after=page[-1].document_id if len(rows) > limit else None,
    )
