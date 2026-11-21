"""Thin authenticated translation-review task endpoints."""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.api.typography_routes import TypographyHintView
from ontotator.application.translation_reviews import (
    CheckedSentences,
    CheckedSentencesSave,
    ReviewWorkspace,
    SegmentPairs,
    TranslationReviewRecord,
    TranslationReviewService,
)

router = APIRouter(
    prefix="/api/v1", tags=["translation-reviews"], route_class=EncodedParameterRoute
)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=0)
    text: str
    form: dict[str, Any]


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=0)


class DraftResponse(BaseModel):
    revision: int


class DraftTypographyHintsView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(description="Draft revision the hints were computed for.")
    total: int
    counts: dict[str, int] = Field(description="Number of hints per rule code.")
    hints: list[TypographyHintView]
    truncated: bool = Field(description="True when 'hints' holds fewer than 'total'.")


def _service(request: Request) -> TranslationReviewService:
    return TranslationReviewService(request.app.state.repo.db, request.app.state.jobs)


@router.get("/translation-reviews/{assignment_id}")
def open_review(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> ReviewWorkspace:
    return _service(request).open(get_access(request), assignment_id)


@router.put("/translation-reviews/{assignment_id}/draft")
def save_review(
    assignment_id: int, body: DraftRequest, request: Request, principal: PrincipalDep
) -> DraftResponse:
    return DraftResponse(
        revision=_service(request).save_draft(
            get_access(request), assignment_id, **body.model_dump()
        )
    )


@router.get("/translation-reviews/{assignment_id}/draft/typography-hints")
def draft_typography_hints(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> DraftTypographyHintsView:
    """Spacing errors and invisible characters of the saved draft text.

    Rule codes and positions only, as the hints of a text version; shown in
    the confirmation of "Submit review…". They block nothing.
    """
    found = _service(request).draft_typography_hints(get_access(request), assignment_id)
    return DraftTypographyHintsView(
        revision=found.revision,
        total=found.total,
        counts=found.counts,
        hints=[
            TypographyHintView(rule=hint.rule, start=hint.start, end=hint.end)
            for hint in found.hints
        ],
        truncated=found.truncated,
    )


@router.put("/translation-reviews/{assignment_id}/checked-sentences")
def save_checked_sentences(
    assignment_id: int,
    body: CheckedSentencesSave,
    request: Request,
    principal: PrincipalDep,
) -> CheckedSentences:
    """The reviewer's own checked-sentence marks; not part of the review.

    With ``base``, only the change from ``base`` to the sent marks is applied, so
    marks set meanwhile in another tab stay; the answer is the stored marks.
    """
    return _service(request).save_checked_sentences(
        get_access(request), assignment_id, body, base=body.base
    )


@router.put("/translation-reviews/{assignment_id}/segment-pairs")
def save_segment_pairs(
    assignment_id: int,
    body: SegmentPairs,
    request: Request,
    principal: PrincipalDep,
) -> SegmentPairs:
    """The reviewer's own segment pairs and their checks; not part of the review."""
    return _service(request).save_segment_pairs(
        get_access(request), assignment_id, body
    )


@router.post("/translation-reviews/{assignment_id}/submit")
def submit_review(
    assignment_id: int, body: SubmitRequest, request: Request, principal: PrincipalDep
) -> TranslationReviewRecord:
    return _service(request).submit(
        get_access(request), assignment_id, expected_revision=body.expected_revision
    )


@router.get("/projects/{key}/documents/{doc:path}/translation-reviews")
def review_records(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> list[TranslationReviewRecord]:
    return _service(request).records(get_access(request), key, doc)


@router.get("/projects/{key}/translation-reviews")
def project_review_records(
    key: str, request: Request, principal: PrincipalDep
) -> list[TranslationReviewRecord]:
    """Every submitted translation review of the project, oldest first."""
    return _service(request).project_records(get_access(request), key)
