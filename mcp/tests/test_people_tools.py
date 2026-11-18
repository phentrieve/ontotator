"""Accounts for a cohort, handing work on, and repeatable final exports."""

from __future__ import annotations

import csv
import json
import stat
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import PT_A, PT_B, FakeApi, marked, refusal
from mcp import Client
from shapes import build

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
USERS = "/api/v1/admin/users/"
RESET = "/api/v1/admin/users/{username}/reset-code"
REASSIGN = "/api/v1/assignments/{assignment_id}/reassign"


def _account(username: str, **fields: Any) -> dict[str, Any]:
    return (
        build(
            "AdminUser", username=username, display_name=username.title(), active=True
        )
        | fields
    )


def _created(request: httpx.Request) -> Any:
    import json

    body = json.loads(request.content)
    if body["username"] == "broken":
        return refusal(422, "USERNAME_INVALID", "bad name")
    user = _account(
        body["username"],
        email=body.get("email"),
        projects=[
            build("UserProject", project_key=item["project_key"], roles=item["roles"])
            for item in body.get("projects", [])
        ],
    )
    return {
        "user": user,
        "code": f"CODE-{body['username']}",
        "expires_at": "2026-11-06T10:00:00Z",
    }


async def test_create_users_skips_existing_and_writes_codes_to_a_private_file(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("GET", USERS, [_account("Ann")])
    fake.on("POST", USERS, _created)
    codes = tmp_path / "codes.csv"
    result = await call(
        mcp_client,
        "create_users",
        {
            "users": [
                {"username": "ann", "display_name": "Ann"},
                {"username": "bob", "display_name": "Bob", "email": "b@x.org"},
                {"username": "cy", "display_name": "Cy", "roles": ["adjudicator"]},
                {"username": "broken", "display_name": "B"},
            ],
            "project": "ward-7",
            "codes_path": str(codes),
        },
    )
    assert result["existing"] == ["ann"]
    assert [item["username"] for item in result["created"]] == ["bob", "cy"]
    assert [item["username"] for item in result["refused"]] == ["broken"]
    assert result["refused"][0]["code"] == "USERNAME_INVALID"
    # The codes are in the file only, readable by the user alone.
    assert result["codes_file"] == str(codes.resolve())
    assert "CODE-" not in str(result)
    assert stat.S_IMODE(codes.stat().st_mode) == 0o600
    with codes.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [(r["username"], r["code"], r["email"]) for r in rows] == [
        ("bob", "CODE-bob", "b@x.org"),
        ("cy", "CODE-cy", ""),
    ]
    sent = [call.json() for call in fake.calls_to("POST", USERS)]
    assert [body["projects"] for body in sent] == [
        [{"project_key": "ward-7", "roles": ["annotator"]}],
        [{"project_key": "ward-7", "roles": ["adjudicator"]}],
        [{"project_key": "ward-7", "roles": ["annotator"]}],
    ]
    # Repeating the call adds nobody twice, and keeps the file.
    fake.on("GET", USERS, [_account(name) for name in ("ann", "bob", "cy")])
    fake.calls.clear()
    again = await call(
        mcp_client,
        "create_users",
        {"users": [{"username": "bob", "display_name": "Bob"}]},
    )
    assert again["existing"] == ["bob"]
    assert again["codes"] == []
    assert not fake.calls_to("POST", USERS)


async def test_create_users_without_a_file_returns_the_codes_with_a_note(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", USERS, [])
    fake.on("POST", USERS, _created)
    result = await call(
        mcp_client,
        "create_users",
        {"users": [{"username": "dee", "display_name": "Dee"}]},
    )
    assert result["codes"][0]["code"] == "CODE-dee"
    assert "credentials" in result["note"]
    [post] = fake.calls_to("POST", USERS)
    assert "projects" not in post.json()


async def test_create_users_refuses_a_codes_file_outside_the_folders(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("GET", USERS, [])
    with pytest.raises(ToolFailed) as refused:
        await call(
            mcp_client,
            "create_users",
            {
                "users": [{"username": "eve", "display_name": "Eve"}],
                "codes_path": str(tmp_path.parent / "elsewhere.csv"),
            },
        )
    assert "outside the folders" in str(refused.value)
    assert not fake.calls_to("POST", USERS)


async def test_an_existing_codes_file_is_refused_before_any_code_is_issued(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("GET", USERS, [_account("pending", setup_pending=True)])
    codes = tmp_path / "codes.csv"
    codes.write_text("earlier codes", encoding="utf-8")
    for tool, arguments in (
        ("create_users", {"users": [{"username": "eve", "display_name": "Eve"}]}),
        ("issue_setup_codes", {"usernames": ["pending"]}),
    ):
        with pytest.raises(ToolFailed) as refused:
            await call(mcp_client, tool, arguments | {"codes_path": str(codes)})
        assert "exists already" in str(refused.value)
        # create_users has no overwrite, so it does not suggest one.
        offered = "pass overwrite" in str(refused.value)
        assert offered is (tool == "issue_setup_codes"), tool
    assert not fake.calls_to("POST", USERS)
    assert not fake.calls_to("POST", RESET)
    assert codes.read_text(encoding="utf-8") == "earlier codes"


async def test_issue_setup_codes_renews_only_pending_invitations(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on(
        "GET",
        USERS,
        [
            _account("pending", setup_pending=True),
            _account("working", setup_pending=False),
            _account("gone", active=False, setup_pending=True),
        ],
    )
    fake.on("POST", RESET, {"code": "NEW", "expires_at": "2026-11-06T10:00:00Z"})
    result = await call(
        mcp_client,
        "issue_setup_codes",
        {"usernames": ["pending", "working", "gone", "nobody"]},
    )
    assert [item["username"] for item in result["codes"]] == ["pending"]
    assert {item["username"]: item["reason"] for item in result["skipped"]} == {
        "working": "already set a password; pass include_active_accounts to reset it",
        "gone": "deactivated",
        "nobody": "no such user",
    }
    [post] = fake.calls_to("POST", RESET)
    assert post.request.url.path == "/api/v1/admin/users/pending/reset-code"
    fake.calls.clear()
    codes = tmp_path / "codes.csv"
    forced = await call(
        mcp_client,
        "issue_setup_codes",
        {
            "usernames": ["working"],
            "include_active_accounts": True,
            "codes_path": str(codes),
        },
    )
    assert "NEW" not in str(forced)
    with codes.open(encoding="utf-8") as handle:
        assert [row["username"] for row in csv.DictReader(handle)] == ["working"]


async def test_resetting_an_active_account_needs_a_codes_file(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", USERS, [_account("working", setup_pending=False)])
    fake.on("POST", RESET, {"code": "NEW", "expires_at": "2026-11-06T10:00:00Z"})
    with pytest.raises(ToolFailed) as refused:
        await call(
            mcp_client,
            "issue_setup_codes",
            {"usernames": ["working"], "include_active_accounts": True},
        )
    assert "needs codes_path" in str(refused.value)
    assert not fake.calls_to("POST", RESET)


async def test_issued_codes_file_escapes_cells_a_spreadsheet_would_run(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    """#386: a person sets their own display name and e-mail address; in the
    codes file a formula such as =1+1 is text, not a formula."""
    link = '=HYPERLINK("http://x","y")'
    fake.on(
        "GET",
        USERS,
        [
            _account(
                "pending", display_name="=1+1", email="+x@y.org", setup_pending=True
            ),
            _account("other", display_name=link, email=None, setup_pending=True),
        ],
    )
    fake.on(
        "POST", RESET, {"code": "AB3DE-FGH4K", "expires_at": "2026-11-06T10:00:00Z"}
    )
    codes = tmp_path / "codes.csv"
    await call(
        mcp_client,
        "issue_setup_codes",
        {"usernames": ["pending", "other"], "codes_path": str(codes)},
    )
    with codes.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert [(r["display_name"], r["email"], r["code"]) for r in rows] == [
        ("'=1+1", "'+x@y.org", "AB3DE-FGH4K"),
        ("'" + link, "", "AB3DE-FGH4K"),
    ]


@pytest.mark.parametrize(
    ("value", "cell"),
    [
        ("=1+1", "'=1+1"),
        ("-x", "'-x"),
        ("@x", "'@x"),
        ("\tx", "'\tx"),
        ("\rx", "'\rx"),
        ("'x", "''x"),
        ("-1", "-1"),
        ("+0.5e3", "+0.5e3"),
        ("Ann", "Ann"),
        (None, None),
    ],
)
def test_spreadsheet_cell_matches_the_server(value: Any, cell: Any) -> None:
    from ontotator_mcp.tools_people import spreadsheet_cell

    assert spreadsheet_cell(value) == cell


async def test_update_user_sends_only_the_named_fields(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("PATCH", "/api/v1/admin/users/{username}", _account("ann", active=False))
    result = await call(mcp_client, "update_user", {"username": "ann", "active": False})
    assert result["active"] is False
    [patch] = fake.calls_to("PATCH", "/api/v1/admin/users/{username}")
    assert patch.json() == {"active": False}
    with pytest.raises(ToolFailed, match="at least one field"):
        await call(mcp_client, "update_user", {"username": "ann"})


def _task(id: int, status: str = "open", **extra: Any) -> dict[str, Any]:
    return (
        build(
            "AssignmentView",
            id=id,
            username="leaving",
            document_id=f"d{id}",
            task="annotate",
            status=status,
            revoked_at=None,
            lead_correction=False,
        )
        | extra
    )


def _moved(request: httpx.Request) -> Any:
    import json

    old = int(request.url.path.split("/")[-2])
    body = json.loads(request.content)
    if old == 4:
        return refusal(409, "ASSIGNMENT_EXISTS", None)
    return _task(100 + old, username=body["username"])


async def test_hand_over_open_tasks_plans_then_reassigns_in_turn(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/assignments",
        [
            _task(1),
            _task(2, "in_progress"),
            _task(3),
            _task(4),
            _task(5, "submitted"),
            _task(6, revoked_at="2026-11-01T10:00:00Z"),
            _task(7, task="review"),
            _task(8, task="translation_review", lead_correction=True),
        ],
    )
    fake.on("POST", REASSIGN, _moved)
    args: dict[str, Any] = {
        "project": "ward-7",
        "from_username": " Leaving",  # as typed: the server's name is "leaving"
        "to_usernames": ["ann", "bob"],
    }
    dry = await call(mcp_client, "hand_over_open_tasks", args)
    assert dry["applied"] is False
    plan = dry["plan"]
    assert [(m["id"], m["to"]) for m in plan["moves"]] == [
        (1, "ann"),
        (3, "bob"),
        (4, "ann"),
    ]
    assert {k["id"] for k in plan["kept"]} == {2, 7, 8}
    assert not fake.calls_to("POST", REASSIGN)
    [listed] = fake.calls_to("GET", f"{P}/assignments")
    assert listed.request.url.params["username"] == "leaving"

    done = await call(mcp_client, "hand_over_open_tasks", args | {"confirm": True})
    assert done["applied"] is True
    assert [(r["assignment_id"], r["to"]) for r in done["reassigned"]] == [
        (1, "ann"),
        (3, "bob"),
    ]
    assert [(r["assignment_id"], r["code"]) for r in done["refused"]] == [
        (4, "ASSIGNMENT_EXISTS")
    ]
    bodies = [c.json() for c in fake.calls_to("POST", REASSIGN)]
    assert all(body["confirm_started"] is False for body in bodies)
    assert all(body["confirm_unreviewed_translation"] is False for body in bodies)

    fake.calls.clear()
    await call(
        mcp_client,
        "hand_over_open_tasks",
        args | {"confirm": True, "confirm_unreviewed_translation": True},
    )
    bodies = [c.json() for c in fake.calls_to("POST", REASSIGN)]
    assert all(body["confirm_unreviewed_translation"] is True for body in bodies)

    fake.calls.clear()
    started = await call(
        mcp_client,
        "hand_over_open_tasks",
        args | {"include_started": True},
    )
    assert 2 in [m["id"] for m in started["plan"]["moves"]]


async def test_hand_over_refuses_the_leaving_person_as_successor(
    mcp_client: Client,
) -> None:
    with pytest.raises(ToolFailed, match="cannot take their own tasks"):
        await call(
            mcp_client,
            "hand_over_open_tasks",
            {"project": "p", "from_username": "a", "to_usernames": ["A"]},
        )


async def test_single_task_tools_call_their_routes(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", REASSIGN, _task(9, username="bob"))
    moved = await call(
        mcp_client,
        "reassign_task",
        {"assignment_id": 1, "username": "bob", "confirm_started": True},
    )
    assert moved["username"] == "bob"
    [post] = fake.calls_to("POST", REASSIGN)
    assert post.json() == {
        "username": "bob",
        "confirm_started": True,
        "confirm_language": False,
        "confirm_unreviewed_translation": False,
    }
    await call(mcp_client, "withdraw_task", {"assignment_id": 1, "reason": "left"})
    [revoke] = fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/revoke")
    assert revoke.json() == {"reason": "left"}
    await call(mcp_client, "remove_task", {"assignment_id": 1})
    assert fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/remove")
    await call(mcp_client, "reopen_task", {"assignment_id": 1})
    assert fake.calls_to("POST", "/api/v1/assignments/{assignment_id}/reopen")


async def test_list_assignments_filters_by_state(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task(1), _task(2, "submitted"), _task(3)])
    result = await call(
        mcp_client,
        "list_assignments",
        {"project": "p", "status": ["open"], "limit": 1},
    )
    assert [item["id"] for item in result["assignments"]] == [1]
    assert result["count"] == 2
    assert result["truncated"] is True


async def test_a_final_export_with_a_request_id_can_be_repeated(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/exports/final/preflight",
        build("FinalPreflight", warnings=[], omissions=[], state_digest="c" * 64),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 5})
    args = {"project": "p", "kind": "final", "request_id": "nightly-2026-11-05"}
    await call(mcp_client, "start_export", args)
    await call(mcp_client, "start_export", args)
    sent = [c.json()["request_id"] for c in fake.calls_to("POST", f"{P}/exports/final")]
    assert sent == ["nightly-2026-11-05", "nightly-2026-11-05"]
    with pytest.raises(ToolFailed, match="final and Phenopackets exports only"):
        await call(
            mcp_client,
            "start_export",
            {"project": "p", "kind": "edit_log", "request_id": "x"},
        )


async def test_withdraw_guideline_names_the_latest_version_it_saw(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/guidelines",
        build("GuidelineListing", latest_version=3, current=None, versions=[]),
    )
    await call(
        mcp_client,
        "withdraw_guideline",
        {"project": "p", "version": 3, "reason": "wrong file"},
    )
    [post] = fake.calls_to("POST", f"{P}/guidelines/{{version}}/withdraw")
    assert post.request.url.path.endswith("/guidelines/3/withdraw")
    assert post.json() == {"reason": "wrong file", "expected_latest_version": 3}


BULK_REOPEN = f"{P}/bulk-task-actions/reopen"
BULK_WITHDRAW = f"{P}/bulk-task-actions/withdraw"


def _bulk(action: str, token: str, **fields: Any) -> dict[str, Any]:
    person = {"pseudonym": "ann-1", "display_name": "Tom Reis", "is_me": False}
    change = build(
        "BulkTaskView",
        case_id="c1",
        language="en",
        assignment_id=7,
        task="annotate",
        status="submitted",
        person=person,
    )
    kept = build(
        "BulkKeptTaskView",
        case_id="c1",
        language="en",
        assignment_id=8,
        task="annotate",
        status="open",
        person=person,
        reason="not_submitted",
        message="Not submitted yet.",
    )
    return (
        build(
            "BulkTaskActionView",
            action=action,
            applied=False,
            texts=1,
            changes=[change],
            kept=[kept],
            skipped=[],
            preview_token=token,
            undo=None,
        )
        | fields
    )


async def test_reopen_texts_dry_run_then_confirm_with_the_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    texts = [{"case_id": "c1", "language": "en"}]
    fake.on("POST", BULK_REOPEN, _bulk("reopen", PT_A))
    dry = await call(
        mcp_client,
        "reopen_texts",
        {"project": "p", "texts": texts, "reason": "Guideline 2.3"},
    )
    assert dry["applied"] is False
    assert dry["would_change"][0]["person"] == "Tom Reis"
    assert dry["kept"][0]["why"] == "Not submitted yet."
    # The server's token and a mark of the reason (#471).
    token = marked(PT_A, "Guideline 2.3")
    assert dry["preview_token"] == token
    [post] = fake.calls_to("POST", BULK_REOPEN)
    assert post.json() == {"rows": texts, "reason": "Guideline 2.3", "preview": True}
    with pytest.raises(ToolFailed):
        await call(
            mcp_client,
            "reopen_texts",
            {"project": "p", "texts": texts, "reason": "x", "confirm": True},
        )
    fake.on("POST", BULK_REOPEN, _bulk("reopen", PT_A, applied=True))
    done = await call(
        mcp_client,
        "reopen_texts",
        {
            "project": "p",
            "texts": texts,
            "reason": "Guideline 2.3",
            "confirm": True,
            "preview_token": token,
        },
    )
    assert done["applied"] is True and done["change_count"] == 1
    # The server gets its own token back, without the mark.
    assert fake.calls_to("POST", BULK_REOPEN)[-1].json()["preview_token"] == PT_A
    # Nothing to undo (the server sent none): no ``undo`` in the answer.
    assert "undo" not in done and "undo" not in dry


BULK_UNDO = f"{P}/bulk-task-actions/undo"
UNDO = {"id": 41, "expires_at": "2026-11-17T12:00:00Z"}


def _undo_view(**fields: object) -> dict[str, object]:
    task = build(
        "BulkUndoTaskView",
        case_id="c1",
        language="en",
        assignment_id=7,
        task="annotate",
        status="reopened",
        person=build("PersonRefView", display_name="Tom Reis"),
    )
    return build(
        "BulkUndoResult",
        undone=0,
        applied=False,
        undo_id=41,
        action="reopen",
        expires_at=UNDO["expires_at"],
        task_count=1,
        tasks=[task],
        blocked=None,
    ) | dict(fields)


@pytest.mark.parametrize(
    ("tool", "route", "extra"),
    [
        ("reopen_texts", BULK_REOPEN, {"reason": "Guideline 2.3"}),
        ("withdraw_open_tasks", BULK_WITHDRAW, {}),
    ],
)
async def test_an_applied_reopen_or_withdrawal_keeps_its_undo(
    fake: FakeApi, mcp_client: Client, tool: str, route: str, extra: dict[str, str]
) -> None:
    """The server's ``undo`` reaches the caller (review finding F1)."""
    action = "reopen" if tool == "reopen_texts" else "withdraw"
    fake.on("POST", route, _bulk(action, PT_A, applied=True, undo=UNDO))
    done = await call(
        mcp_client,
        tool,
        {
            "project": "p",
            "texts": [{"case_id": "c1", "language": "en"}],
            "confirm": True,
            "preview_token": marked(PT_A, extra.get("reason", "")),
        }
        | extra,
    )
    assert done["applied"] is True
    assert done["undo"] == UNDO


async def test_undo_reopen_or_withdraw_dry_run_then_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", BULK_UNDO, _undo_view())
    dry = await call(
        mcp_client, "undo_reopen_or_withdraw", {"project": "p", "undo_id": 41}
    )
    assert dry["applied"] is False and dry["blocked"] is None
    assert (dry["action"], dry["task_count"]) == ("reopen", 1)
    assert dry["would_restore"] == [
        {
            "case_id": "c1",
            "language": "en",
            "assignment_id": 7,
            "task": "annotate",
            "status": "reopened",
            "person": "Tom Reis",
        }
    ]
    [post] = fake.calls_to("POST", BULK_UNDO)
    assert post.json() == {"undo_id": 41, "preview": True}

    def answer(request: httpx.Request) -> dict[str, object]:
        if json.loads(request.content).get("preview"):
            return _undo_view()
        done = _undo_view(undone=1, applied=True)
        done["tasks"][0]["status"] = "submitted"  # type: ignore[index]
        return done

    fake.on("POST", BULK_UNDO, answer)
    done = await call(
        mcp_client,
        "undo_reopen_or_withdraw",
        {"project": "p", "undo_id": 41, "confirm": True},
    )
    assert done["applied"] is True
    assert done["restored"][0]["status"] == "submitted"
    assert fake.calls_to("POST", BULK_UNDO)[-1].json() == {"undo_id": 41}


async def test_undo_reopen_or_withdraw_changes_nothing_when_blocked(
    fake: FakeApi, mcp_client: Client
) -> None:
    blocked = {"reason": "changed", "message": "A task changed since the action."}
    fake.on("POST", BULK_UNDO, _undo_view(blocked=blocked))
    result = await call(
        mcp_client,
        "undo_reopen_or_withdraw",
        {"project": "p", "undo_id": 41, "confirm": True},
    )
    assert result["applied"] is False and result["refused"] is True
    assert result["blocked"] == blocked
    # Only previews were sent: nothing was applied.
    assert all(c.json().get("preview") for c in fake.calls_to("POST", BULK_UNDO))


async def test_undo_reopen_or_withdraw_names_a_used_or_expired_undo(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", BULK_UNDO, refusal(409, "BULK_UNDO_STALE", {"reason": "expired"}))
    with pytest.raises(ToolFailed, match="BULK_UNDO_STALE/expired"):
        await call(
            mcp_client, "undo_reopen_or_withdraw", {"project": "p", "undo_id": 41}
        )


async def test_withdraw_open_tasks_answers_a_stale_token_with_a_fresh_dry_run(
    fake: FakeApi, mcp_client: Client
) -> None:
    fresh = _bulk("withdraw", PT_B)
    fake.on("POST", BULK_WITHDRAW, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    result = await call(
        mcp_client,
        "withdraw_open_tasks",
        {
            "project": "p",
            "texts": [{"case_id": "c1", "language": "en"}],
            "over_limit_only": True,
            "confirm": True,
            "preview_token": marked(PT_A),
        },
    )
    assert result["stale"] is True and result["preview_token"] == marked(PT_B)
    # A well-formed token of another dry run looks like a change (#471).
    assert "or the preview_token is not the one" in result["note"]
    [post] = fake.calls_to("POST", BULK_WITHDRAW)
    assert post.json()["over_limit_only"] is True


BULK_START_ROUND = f"{P}/bulk-task-actions/start-round"


async def test_start_rounds_dry_run_confirm_and_stale_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    texts = [{"case_id": "c1", "language": "en"}]
    preview = _bulk("start_round", PT_A, kind="clean_restart")
    fake.on("POST", BULK_START_ROUND, preview)
    bare = {"project": "p", "texts": texts, "kind": "clean_restart"}
    # A clean restart without a reason fails at the dry run already (#471).
    with pytest.raises(ToolFailed, match="needs a reason"):
        await call(mcp_client, "start_rounds", bare)
    assert fake.calls_to("POST", BULK_START_ROUND) == []
    args = bare | {"reason": "New tool set"}
    token = marked(PT_A, "New tool set")
    dry = await call(mcp_client, "start_rounds", args)
    assert dry["applied"] is False and dry["preview_token"] == token
    assert dry["would_change"][0]["person"] == "Tom Reis"
    [post] = fake.calls_to("POST", BULK_START_ROUND)
    assert post.json() == {
        "rows": texts,
        "kind": "clean_restart",
        "reason": "New tool set",
        "preview": True,
    }
    # Not confirmed without the token, nor with another reason than the
    # dry run's, nor without a reason.
    for extra in (
        {},
        {"preview_token": token, "reason": "Another reason"},
        {"preview_token": token, "reason": None},
    ):
        with pytest.raises(ToolFailed):
            await call(mcp_client, "start_rounds", args | {"confirm": True} | extra)
    assert len(fake.calls_to("POST", BULK_START_ROUND)) == 1
    confirmed = args | {"confirm": True, "preview_token": token}
    fake.on("POST", BULK_START_ROUND, preview | {"applied": True})
    done = await call(mcp_client, "start_rounds", confirmed)
    assert done["applied"] is True and done["change_count"] == 1
    assert fake.calls_to("POST", BULK_START_ROUND)[-1].json() == {
        "rows": texts,
        "kind": "clean_restart",
        "reason": "New tool set",
        "preview_token": PT_A,
    }
    fresh = _bulk("start_round", PT_B, kind="clean_restart")
    fake.on("POST", BULK_START_ROUND, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    stale = await call(mcp_client, "start_rounds", confirmed)
    assert stale["stale"] is True
    assert stale["preview_token"] == marked(PT_B, "New tool set")


PAUSE_TEXTS = f"{P}/text-pauses/pause"
RELEASE_TEXTS = f"{P}/text-pauses/release"


def _pause(action: str, token: str, *, applied: bool = False) -> dict[str, Any]:
    task = {
        "assignment_id": 7,
        "document_id": "c1-en",
        "version": 1,
        "task": "annotate",
        "status": "in_progress",
        "person": {"pseudonym": "ann-0001", "display_name": "Tom Reis"},
        "paused_by_report": action == "release",
    }
    pause = {"reason": "Clinic is checking", "paused_by": None, "paused_at": "t"}
    return {
        "action": action,
        "applied": applied,
        "texts": 2,
        "change_count": 1,
        "skipped_count": 1,
        "task_count": 1,
        "still_paused_count": 1 if action == "release" else 0,
        "changes": [
            {
                "case_id": "c1",
                "language": "en",
                "pause": pause if action == "release" else None,
                "tasks": [task],
            }
        ],
        "skipped": [
            {
                "case_id": "c2",
                "language": "en",
                "reason": "already_paused" if action == "pause" else "not_paused",
                "message": "Already paused by a lead.",
                "pause": None,
            }
        ],
        "preview_token": token,
    }


async def test_pause_texts_dry_run_confirm_and_stale_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 464: pause on the dry-run, then confirm pattern."""
    texts = [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}]
    args = {"project": "p", "texts": texts, "reason": "Clinic is checking"}
    fake.on("POST", PAUSE_TEXTS, _pause("pause", PT_A))
    dry = await call(mcp_client, "pause_texts", args)
    assert dry["applied"] is False and dry["preview_token"] == PT_A
    assert dry["would_change"] == [
        {
            "case_id": "c1",
            "language": "en",
            "tasks_in_progress": 1,
            "people": ["Tom Reis"],
        }
    ]
    assert dry["skipped_texts"][0]["message"] == "Already paused by a lead."
    [post] = fake.calls_to("POST", PAUSE_TEXTS)
    assert post.json() == {
        "rows": texts,
        "reason": "Clinic is checking",
        "preview": True,
    }
    # Not confirmed without the dry run's token.
    with pytest.raises(ToolFailed):
        await call(mcp_client, "pause_texts", args | {"confirm": True})
    assert len(fake.calls_to("POST", PAUSE_TEXTS)) == 1
    confirmed = args | {"confirm": True, "preview_token": PT_A}
    fake.on("POST", PAUSE_TEXTS, _pause("pause", PT_A, applied=True))
    done = await call(mcp_client, "pause_texts", confirmed)
    assert done["applied"] is True and done["changed"][0]["case_id"] == "c1"
    assert fake.calls_to("POST", PAUSE_TEXTS)[-1].json() == {
        "rows": texts,
        "reason": "Clinic is checking",
        "preview_token": PT_A,
    }
    fresh = _pause("pause", PT_B)
    fake.on("POST", PAUSE_TEXTS, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    stale = await call(mcp_client, "pause_texts", confirmed)
    assert stale["stale"] is True and stale["preview_token"] == PT_B


async def test_release_texts_names_tasks_a_report_still_pauses(
    fake: FakeApi, mcp_client: Client
) -> None:
    texts = [{"case_id": "c1", "language": "en"}]
    fake.on("POST", RELEASE_TEXTS, _pause("release", PT_A))
    dry = await call(mcp_client, "release_texts", {"project": "p", "texts": texts})
    assert dry["still_paused_by_report"] == 1
    assert dry["would_change"][0] == {
        "case_id": "c1",
        "language": "en",
        "tasks_in_progress": 1,
        "people": ["Tom Reis"],
        "paused_because": "Clinic is checking",
        "still_paused_by_report": 1,
    }
    [post] = fake.calls_to("POST", RELEASE_TEXTS)
    assert post.json() == {"rows": texts, "preview": True}
    fake.on("POST", RELEASE_TEXTS, _pause("release", PT_A, applied=True))
    done = await call(
        mcp_client,
        "release_texts",
        {"project": "p", "texts": texts, "confirm": True, "preview_token": PT_A},
    )
    assert done["applied"] is True
    assert fake.calls_to("POST", RELEASE_TEXTS)[-1].json() == {
        "rows": texts,
        "preview_token": PT_A,
    }
