"""Single-term review routes (issue 381).

Leads refresh the review basis (the page does so when it opens), create
batches and read the summary; the reviewer of a batch reads its groups and contexts and records decisions.
Groups, contexts and decisions hold clinical phrases: browser sessions only
(``token_scopes``). Every route refuses while the project setting is off.
"""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.application.single_terms import (
    DEFAULT_CONTEXTS,
    MAX_CONTEXTS,
    GroupState,
    SingleTermAncestorsView,
    SingleTermBasisView,
    SingleTermBatchRequest,
    SingleTermBatchView,
    SingleTermContextsView,
    SingleTermDecisionRequest,
    SingleTermDecisionView,
    SingleTermGroupView,
    SingleTermService,
    SingleTermSummaryView,
)
from ontotator.auth.audit import Actor

router = APIRouter(prefix="/api/v1/projects/{key}/single-terms", tags=["single-terms"])


class SingleTermCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)


def _service(request: Request, principal: PrincipalDep) -> SingleTermService:
    return SingleTermService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
    )


@router.post("/basis")
def refresh_basis(
    key: str, request: Request, principal: PrincipalDep
) -> SingleTermBasisView | None:
    """The newest basis, refreshed when the accepted final results changed;
    null while there is no final result."""
    return _service(request, principal).refresh_basis(key)


@router.get("/summary")
def summary(
    key: str, request: Request, principal: PrincipalDep
) -> SingleTermSummaryView:
    return _service(request, principal).summary(key)


@router.get("/groups")
def groups(
    key: str,
    request: Request,
    principal: PrincipalDep,
    language: str | None = Query(None, max_length=8),
    state: GroupState | None = None,
    batch: int | None = None,
) -> list[SingleTermGroupView]:
    return _service(request, principal).groups(
        key, language=language, state=state, batch_id=batch
    )


@router.get("/groups/{group_id}/contexts")
def contexts(
    key: str,
    group_id: str,
    request: Request,
    principal: PrincipalDep,
    batch: int | None = None,
    limit: int = Query(DEFAULT_CONTEXTS, ge=1, le=MAX_CONTEXTS),
    offset: int = Query(0, ge=0),
) -> SingleTermContextsView:
    return _service(request, principal).contexts(
        key, group_id, batch_id=batch, limit=limit, offset=offset
    )


@router.get("/groups/{group_id}/ancestors")
def ancestors(
    key: str,
    group_id: str,
    request: Request,
    principal: PrincipalDep,
    batch: int | None = None,
) -> SingleTermAncestorsView:
    """The terms the group's term can be generalised to."""
    return _service(request, principal).ancestors(key, group_id, batch_id=batch)


@router.post("/batches")
def create_batch(
    key: str, body: SingleTermBatchRequest, request: Request, principal: PrincipalDep
) -> SingleTermBatchView:
    return _service(request, principal).create_batch(key, body)


@router.get("/batches")
def batches(
    key: str, request: Request, principal: PrincipalDep
) -> list[SingleTermBatchView]:
    return _service(request, principal).batches(key)


@router.get("/batches/{batch_id}")
def batch(
    key: str, batch_id: int, request: Request, principal: PrincipalDep
) -> SingleTermBatchView:
    return _service(request, principal).batch(key, batch_id)


@router.post("/batches/{batch_id}/abandon")
def abandon_batch(
    key: str,
    batch_id: int,
    body: SingleTermCommandRequest,
    request: Request,
    principal: PrincipalDep,
) -> SingleTermBatchView:
    return _service(request, principal).abandon(key, batch_id, body.request_id)


@router.post("/batches/{batch_id}/decisions")
def decide(
    key: str,
    batch_id: int,
    body: SingleTermDecisionRequest,
    request: Request,
    principal: PrincipalDep,
) -> SingleTermDecisionView:
    return _service(request, principal).decide(key, batch_id, body)
