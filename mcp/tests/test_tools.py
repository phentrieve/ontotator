from __future__ import annotations

import hashlib
import io
import os
import zipfile
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import PT_A, PT_B, FakeApi, refusal, token_view
from mcp import Client
from shapes import build, page, panel, row, submission, work

from ontotator_mcp import __version__
from ontotator_mcp.config import ConfigError, Settings
from ontotator_mcp.server import build_server

P = "/api/v1/projects/{key}"
ROWS = f"{P}/document-rows"
PANEL = "/api/v1/projects/{key}/document-rows/{case_id}/{language}/final-panel"
pytestmark = pytest.mark.anyio


async def test_whoami_drops_the_csrf_token(fake: FakeApi, mcp_client: Client) -> None:
    fake.on(
        "GET",
        "/api/v1/auth/me",
        build("CurrentUser", username="lead", csrf_token="secret-csrf"),
    )
    fake.on("GET", "/api/v1/about", build("About", version=__version__))
    result = await call(mcp_client, "whoami", {})
    assert result["user"]["username"] == "lead"
    assert "csrf_token" not in result["user"]
    # Both versions, and no warning while they are the same (#486).
    assert result["server"]["version"] == __version__
    assert result["mcp_server"]["version"] == __version__
    assert "warning" not in result
    # The content tools are a setting of this MCP server (#485).
    assert result["mcp_server"]["content_tools"] is False
    assert "MCP client's configuration" in result["mcp_server"]["content_tools_note"]
    assert result["url"] == "https://ontotator.test"
    assert result["token"]["kind"] == "personal"
    assert "warning" not in result["token"]


async def test_whoami_with_a_project_token_names_its_project(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/me/token",
        token_view(kind="project", project_key="ward-7", scopes=["read", "export"]),
    )
    fake.on("GET", "/api/v1/about", build("About", version="0.10.1"))
    result = await call(mcp_client, "whoami", {})
    assert result["user"] is None
    assert result["token"]["project_key"] == "ward-7"
    assert "ward-7" in result["note"]
    # A project token gets the server's version too (#485), and a plain
    # warning when this MCP server is another release (#486).
    assert result["server"]["version"] == "0.10.1"
    assert result["mcp_server"]["version"] == __version__
    assert f"ontotator-mcp {__version__}" in result["warning"]
    assert "0.10.1" in result["warning"] and "restart" in result["warning"]
    # A project token cannot read /auth/me; whoami does not try.
    assert fake.templates() == [("GET", "/api/v1/me/token"), ("GET", "/api/v1/about")]


async def test_whoami_says_when_the_content_tools_are_on(
    fake: FakeApi, settings: Settings
) -> None:
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    async with Client(server) as client:
        result = await call(client, "whoami", {})
    assert result["mcp_server"]["content_tools"] is True


async def test_whoami_reports_the_token_and_warns_before_it_expires(
    fake: FakeApi, mcp_client: Client
) -> None:
    soon = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    fake.on("GET", "/api/v1/me/token", token_view(expires_at=soon, scopes=["export"]))
    result = await call(mcp_client, "whoami", {})
    token = result["token"]
    assert token["scopes"] == ["export"]
    assert 2 < token["expires_in_days"] <= 3
    assert "expires soon" in token["warning"]
    assert "secret" not in token
    # Without the read scope the user is not read; the version is.
    assert result["user"] is None
    assert "version" in result["server"]
    assert fake.templates() == [("GET", "/api/v1/me/token"), ("GET", "/api/v1/about")]


async def test_upload_texts_streams_files_and_returns_the_check(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    bundle = tmp_path / "phentrieve.zip"
    bundle.write_bytes(b"PK-bundle-bytes")
    fake.on("POST", f"{P}/uploads", {"upload_id": 7, "job_id": 70})
    plan = build(
        "ImportPlan",
        counts={"cases": 2, "proposals": 5},
        committable=True,
        warnings=[build("Issue", code="W", unit="u", message="note")],
    )
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build(
            "UploadView",
            id=7,
            kind="t1",
            status="ready",
            preview=plan,
            plan_sha256="a" * 64,
            files=[build("UploadFileInfo", filename="phentrieve.zip")],
        ),
    )
    result = await call(
        mcp_client,
        "upload_texts",
        {"project": "ward-7", "paths": [str(bundle)], "format": "ontospan"},
    )
    assert result["upload_id"] == 7
    assert result["kind"] == "ontospan"
    assert result["committable"] is True
    assert result["counts"] == {"cases": 2, "proposals": 5}
    assert result["local_files"] == [str(bundle.resolve())]
    [upload] = fake.calls_to("POST", f"{P}/uploads")
    body = upload.request.content
    assert b'name="kind"\r\n\r\nt1' in body
    assert b'name="files[]"; filename="phentrieve.zip"' in body
    assert b"PK-bundle-bytes" in body
    assert fake.calls_to("GET", "/api/v1/jobs/{job_id}")


async def test_plain_text_needs_a_language(mcp_client: Client, tmp_path: Path) -> None:
    text = tmp_path / "case-1.txt"
    text.write_text("Ataxia.")
    with pytest.raises(ToolFailed, match="language"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(text)], "format": "text"},
        )


async def test_a_missing_file_is_named(mcp_client: Client, tmp_path: Path) -> None:
    with pytest.raises(ToolFailed, match="No such file"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(tmp_path / "x.zip")], "format": "ontospan"},
        )


async def test_a_relative_path_is_refused(fake: FakeApi, mcp_client: Client) -> None:
    with pytest.raises(ToolFailed, match="absolute path"):
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": ["texts.zip"], "format": "ontospan"},
        )
    with pytest.raises(ToolFailed, match="absolute path"):
        await call(mcp_client, "download_export", {"job_id": 1, "path": "out.zip"})
    assert not fake.calls_to("POST", f"{P}/uploads")


async def test_files_dir_limits_what_is_read_and_written(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    inside = allowed / "guide.md"
    inside.write_text("# Guide")
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET")
    (allowed / "link.md").symlink_to(secret)
    fake.on("POST", f"{P}/guidelines", build("GuidelineSummary"))
    _export_job(fake, b"zip-bytes")
    limited = replace(settings, files_dirs=(allowed.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        for path in (
            str(secret),
            str(allowed / "link.md"),
            str(allowed / ".." / "secret.txt"),
        ):
            with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
                await call(client, "publish_guideline", {"project": "p", "path": path})
        for name in ("set_task_profile", "create_project"):
            args: dict[str, Any] = {"project": "p", "profile_path": str(secret)}
            if name == "create_project":
                args = {
                    "key": "k",
                    "name": "K",
                    "pins": [],
                    "profile_path": str(secret),
                }
            with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
                await call(client, name, args)
        assert not fake.calls_to("POST", f"{P}/guidelines")
        assert b"SECRET" not in b"".join(c.request.content for c in fake.calls)

        published = await call(
            client, "publish_guideline", {"project": "p", "path": str(inside)}
        )
        assert published["local_files"] == [str(inside.resolve())]

        with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
            await call(
                client,
                "download_export",
                {"job_id": 9, "path": str(tmp_path / "out.zip")},
            )
        assert not (tmp_path / "out.zip").exists()
        done = await call(
            client, "download_export", {"job_id": 9, "path": str(allowed / "out.zip")}
        )
        assert done["path"] == str((allowed / "out.zip").resolve())


@pytest.mark.parametrize(("latest", "sent"), [(None, ""), (2, "2")])
async def test_publish_guideline_names_the_latest_version_it_saw(
    fake: FakeApi,
    settings: Settings,
    tmp_path: Path,
    latest: int | None,
    sent: str,
) -> None:
    guide = tmp_path / "guide.md"
    guide.write_text("# Guide")
    fake.on(
        "GET",
        f"{P}/guidelines",
        build("GuidelineListing", latest_version=latest, current=None, versions=[]),
    )
    fake.on("POST", f"{P}/guidelines", build("GuidelineSummary"))
    limited = replace(settings, files_dirs=(tmp_path.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        await call(client, "publish_guideline", {"project": "p", "path": str(guide)})
    [post] = fake.calls_to("POST", f"{P}/guidelines")
    form = post.request.content.decode()
    # The route takes a form field: empty when the project has no guideline.
    assert f'name="expected_latest_version"\r\n\r\n{sent}\r\n' in form
    # No label given: the field is sent empty, which the server reads as none.
    assert 'name="label"\r\n\r\n\r\n' in form


async def test_publish_guideline_sends_the_label(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    guide = tmp_path / "guide.md"
    guide.write_text("# Guide")
    fake.on(
        "GET",
        f"{P}/guidelines",
        build("GuidelineListing", latest_version=1, current=None, versions=[]),
    )
    fake.on(
        "POST", f"{P}/guidelines", build("GuidelineSummary", version=2, label="3.1")
    )
    limited = replace(settings, files_dirs=(tmp_path.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        summary = await call(
            client,
            "publish_guideline",
            {"project": "p", "path": str(guide), "label": "3.1"},
        )
    [post] = fake.calls_to("POST", f"{P}/guidelines")
    assert 'name="label"\r\n\r\n3.1\r\n' in post.request.content.decode()
    assert (summary["version"], summary["label"]) == (2, "3.1")


async def test_guideline_notes_state_their_limit(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    """Issue 486: one line of at most 280 characters, said in the schema and
    refused before anything is sent."""
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    for tool, argument in (
        ("publish_guideline", "change_note"),
        ("withdraw_guideline", "reason"),
    ):
        schema = tools[tool].input_schema["properties"][argument]
        text = str(schema)
        assert "'maxLength': 280" in text, tool
        assert "annotators see it" in text and "one line" in text, tool
    guide = tmp_path / "guide.md"
    guide.write_text("# Guide")
    with pytest.raises(ToolFailed, match="at most 280"):
        await call(
            mcp_client,
            "publish_guideline",
            {"project": "p", "path": str(guide), "change_note": "x" * 281},
        )
    with pytest.raises(ToolFailed, match="at most 280"):
        await call(
            mcp_client,
            "withdraw_guideline",
            {"project": "p", "version": 1, "reason": "x" * 281},
        )
    assert fake.calls == []


async def test_without_files_dir_local_files_are_refused(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    text = tmp_path / "case.zip"
    text.write_bytes(b"PK")
    fake.on("GET", "/api/v1/auth/me", build("CurrentUser", username="lead"))
    _export_job(fake, b"zip-bytes")
    unset = replace(settings, files_dirs=())
    server = build_server(unset, transport=httpx.MockTransport(fake))
    tools: list[tuple[str, dict[str, Any]]] = [
        ("upload_texts", {"project": "p", "paths": [str(text)], "format": "ontospan"}),
        ("upload_ontology_files", {"paths": [str(text)]}),
        ("publish_guideline", {"project": "p", "path": str(text)}),
        ("set_task_profile", {"project": "p", "profile_path": str(text)}),
        (
            "create_project",
            {"key": "k", "name": "K", "pins": [], "profile_path": str(text)},
        ),
        ("download_export", {"job_id": 9, "path": str(tmp_path / "out.zip")}),
    ]
    async with Client(server) as client:
        for name, args in tools:
            with pytest.raises(ToolFailed) as refused:
                await call(client, name, args)
            assert "set ONTOTATOR_MCP_FILES_DIR" in str(refused.value), name
        # Nothing was sent, written or even looked up.
        assert not fake.calls
        assert not (tmp_path / "out.zip").exists()
        # Tools without local files work as before.
        me = await call(client, "whoami", {})
        assert me["user"]["username"] == "lead"


async def test_symbolic_links_never_leave_files_dir(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("SECRET")
    (outside / "keep.zip").write_bytes(b"KEEP")
    # A linked folder, a link to a file and a dangling link, all inside.
    (allowed / "linked").symlink_to(outside, target_is_directory=True)
    (allowed / "out.zip").symlink_to(outside / "keep.zip")
    (allowed / "new.zip").symlink_to(outside / "new.zip")
    fake.on("POST", f"{P}/guidelines", build("GuidelineSummary"))
    _export_job(fake, b"zip-bytes")
    limited = replace(settings, files_dirs=(allowed.resolve(),))
    server = build_server(limited, transport=httpx.MockTransport(fake))
    async with Client(server) as client:
        with pytest.raises(ToolFailed, match="outside the folders"):
            await call(
                client,
                "publish_guideline",
                {"project": "p", "path": str(allowed / "linked" / "secret.md")},
            )
        for target in ("linked/new.zip", "out.zip", "new.zip"):
            with pytest.raises(ToolFailed, match="outside the folders"):
                await call(
                    client,
                    "download_export",
                    {"job_id": 9, "path": str(allowed / target), "overwrite": True},
                )
    assert not fake.calls_to("POST", f"{P}/guidelines")
    assert sorted(path.name for path in outside.iterdir()) == ["keep.zip", "secret.md"]
    assert (outside / "keep.zip").read_bytes() == b"KEEP"


@pytest.mark.parametrize("name", [".", ".."])
async def test_dot_segments_stay_one_segment(
    fake: FakeApi, mcp_client: Client, name: str
) -> None:
    # httpx drops dot segments: unencoded, ".." would reach another route.
    fake.on("GET", f"{P}/members", [])
    fake.on("PUT", MEMBER, _member("ann", ["annotator"]))
    await call(mcp_client, "list_people", {"project": name})
    [listed] = fake.calls_to("GET", f"{P}/members")
    encoded = name.replace(".", "%2E").encode()
    assert listed.request.url.raw_path == b"/api/v1/projects/" + encoded + b"/members"
    await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": name, "roles": ["annotator"]},
    )
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.request.url.raw_path == b"/api/v1/projects/p/members/" + encoded


def _member(username: str, roles: list[str]) -> dict[str, Any]:
    return build("Member", username=username, roles=roles)


def _task(task: str, status: str = "open", **extra: Any) -> dict[str, Any]:
    return (
        build(
            "AssignmentView",
            id=len(task) + len(status) + len(extra),
            document_id=f"d-{task}-{status}",
            task=task,
            status=status,
            revoked_at=None,
            lead_correction=False,
        )
        | extra
    )


MEMBER = f"{P}/members/{{username}}"


async def test_adding_roles_needs_no_confirm(fake: FakeApi, mcp_client: Client) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["annotator"])])
    fake.on("PUT", MEMBER, _member("ann", ["adjudicator", "annotator"]))
    result = await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": "ann", "roles": ["annotator", "adjudicator"]},
    )
    assert result["applied"] is True
    assert result["plan"]["added_roles"] == ["adjudicator"]
    assert result["plan"]["removed_roles"] == []
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.json()["roles"] == ["annotator", "adjudicator"]
    assert not fake.calls_to("GET", f"{P}/assignments")


async def test_removing_a_person_is_a_dry_run_without_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["adjudicator", "annotator"])])
    fake.on(
        "GET",
        f"{P}/assignments",
        [
            _task("annotate"),
            _task("annotate", "submitted"),
            _task("review", "in_progress"),
            _task("annotate", revoked_at="2026-11-01T10:00:00Z"),
            _task("translation_review", lead_correction=True),
        ],
    )
    args: dict[str, Any] = {"project": "p", "username": "ann", "roles": []}
    dry = await call(mcp_client, "set_member_roles", args)
    assert dry["applied"] is False
    plan = dry["plan"]
    assert plan["current_roles"] == ["adjudicator", "annotator"]
    assert plan["removed_roles"] == ["adjudicator", "annotator"]
    assert [t["task"] for t in plan["open_tasks"]] == ["annotate", "review"]
    assert "block the change" in plan["consequences"][1]
    assert "logged out" in plan["consequences"][0]
    assert not fake.calls_to("PUT", MEMBER)
    [listed] = fake.calls_to("GET", f"{P}/assignments")
    assert listed.request.url.params["username"] == "ann"

    fake.on("PUT", MEMBER, _member("ann", []))
    applied = await call(
        mcp_client,
        "set_member_roles",
        args | {"revoke_assignments": True, "confirm": True},
    )
    assert applied["applied"] is True
    assert "2 open task(s) are withdrawn." in applied["plan"]["consequences"]
    [put] = fake.calls_to("PUT", MEMBER)
    assert put.json() == {"roles": [], "revoke_assignments": True}


async def test_unchanged_roles_change_nothing(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/members", [_member("ann", ["annotator"])])
    result = await call(
        mcp_client,
        "set_member_roles",
        {"project": "p", "username": "ann", "roles": ["annotator"]},
    )
    assert result["applied"] is False
    assert not fake.calls_to("PUT", MEMBER)


@pytest.mark.parametrize(
    "error", [httpx.WriteError, httpx.ReadError, httpx.RemoteProtocolError]
)
async def test_a_connection_closed_during_an_upload_names_the_size(
    fake: FakeApi, mcp_client: Client, tmp_path: Path, error: type[Exception]
) -> None:
    big = tmp_path / "big.zip"
    big.write_bytes(b"x" * 2_500_000)

    def cut(request: httpx.Request) -> httpx.Response:
        raise error("connection closed")

    fake.on("POST", f"{P}/uploads", cut)
    with pytest.raises(ToolFailed) as raised:
        await call(
            mcp_client,
            "upload_texts",
            {"project": "p", "paths": [str(big)], "format": "ontospan"},
        )
    assert "closed the connection during the upload" in str(raised.value)
    assert "2.5 MB" in str(raised.value)
    assert "upload limit" in str(raised.value)
    assert "Cannot reach" not in str(raised.value)


def test_files_dir_comes_from_the_environment(tmp_path: Path) -> None:
    env = {
        "ONTOTATOR_URL": "https://o.test",
        "ONTOTATOR_TOKEN": "t",
        "ONTOTATOR_MCP_FILES_DIR": f"{tmp_path}{os.pathsep}{tmp_path / 'b'}",
    }
    with pytest.raises(ConfigError, match="not a folder"):
        Settings.from_env(env)
    (tmp_path / "b").mkdir()
    assert Settings.from_env(env).files_dirs == (
        tmp_path.resolve(),
        (tmp_path / "b").resolve(),
    )
    with pytest.raises(ConfigError, match="absolute"):
        Settings.from_env(env | {"ONTOTATOR_MCP_FILES_DIR": "relative/dir"})
    assert Settings.from_env(env | {"ONTOTATOR_MCP_FILES_DIR": ""}).files_dirs == ()


async def test_commit_upload_sends_the_checked_plan(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build("UploadView", id=7, status="ready", plan_sha256="b" * 64),
    )
    fake.on("POST", f"{P}/uploads/{{upload_id}}/commit", {"upload_id": 7, "job_id": 71})
    result = await call(
        mcp_client,
        "commit_upload",
        {
            "project": "ward-7",
            "upload_id": 7,
            "plan_languages": {"de": {"review": True, "annotate": True}},
            "accept_external_review": None,
        },
    )
    assert result["job"]["status"] == "succeeded"
    [commit] = fake.calls_to("POST", f"{P}/uploads/{{upload_id}}/commit")
    assert commit.json() == {
        "plan_sha256": "b" * 64,
        "plan_languages": {"de": {"review": True, "annotate": True}},
    }


async def test_commit_refuses_an_upload_that_is_not_ready(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/uploads/{{upload_id}}",
        build("UploadView", id=7, status="invalid", plan_sha256=None),
    )
    with pytest.raises(ToolFailed, match="'invalid', not ready"):
        await call(mcp_client, "commit_upload", {"project": "p", "upload_id": 7})
    assert not fake.calls_to("POST", f"{P}/uploads/{{upload_id}}/commit")


async def test_pins_are_only_previewed_without_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    pins = [{"ontology_id": "HP", "sha256": "c" * 64}]
    fake.on("POST", f"{P}/pins/preview", build("RepinReport", report_sha256="r1"))
    dry = await call(mcp_client, "set_ontology_pins", {"project": "p", "pins": pins})
    assert dry["applied"] is False
    assert not fake.calls_to("POST", f"{P}/pins/apply")
    done = await call(
        mcp_client, "set_ontology_pins", {"project": "p", "pins": pins, "confirm": True}
    )
    assert done["applied"] is True
    [apply] = fake.calls_to("POST", f"{P}/pins/apply")
    assert apply.json()["report_sha256"] == "r1"


async def test_distribute_texts_previews_then_assigns_with_the_digest(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/document-rows/case-ids",
        {"case_ids": ["c1", "c2"], "total": 2, "truncated": False},
    )
    fake.on(
        "POST",
        f"{P}/assignments/batch/preview",
        build("BatchPreview", digest="d1", per_text=2),
    )
    args = {
        "project": "p",
        "language": "en",
        "usernames": ["ann1", "ann2"],
        "mode": "each",
    }
    dry = await call(mcp_client, "distribute_texts", args)
    assert dry["assigned"] is False
    assert not fake.calls_to("POST", f"{P}/assignments/batch")
    await call(mcp_client, "distribute_texts", args | {"confirm": True})
    [batch] = fake.calls_to("POST", f"{P}/assignments/batch")
    assert batch.json()["expected_preview_digest"] == "d1"
    assert batch.json()["case_ids"] == ["c1", "c2"]
    # Every case: by case ID.
    assert batch.json()["sort"] == "case"
    assert batch.json()["confirm_unreviewed_translation"] is False
    for preview in fake.calls_to("POST", f"{P}/assignments/batch/preview"):
        assert "confirm_unreviewed_translation" not in preview.json()

    fake.calls.clear()
    await call(
        mcp_client,
        "distribute_texts",
        args | {"confirm": True, "confirm_unreviewed_translation": True},
    )
    [batch] = fake.calls_to("POST", f"{P}/assignments/batch")
    assert batch.json()["confirm_unreviewed_translation"] is True


async def test_distribute_texts_keeps_the_order_of_case_ids(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 488: the caller's order is the order of assignment, and so the
    order in each person's My tasks."""
    fake.on(
        "POST",
        f"{P}/assignments/batch/preview",
        build("BatchPreview", digest="d1", per_text=1),
    )
    args = {
        "project": "p",
        "language": "en",
        "usernames": ["ann1"],
        "mode": "one",
        "case_ids": ["c9", "c2", "c5"],
        "confirm": True,
    }
    await call(mcp_client, "distribute_texts", args)
    [preview] = fake.calls_to("POST", f"{P}/assignments/batch/preview")
    [batch] = fake.calls_to("POST", f"{P}/assignments/batch")
    for sent in (preview.json(), batch.json()):
        assert sent["case_ids"] == ["c9", "c2", "c5"]
        assert sent["sort"] == "given"


async def test_assign_texts_sends_the_rows_in_their_order(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", f"{P}/assignments", build("AssignResponse"))
    rows = [
        {"document_id": "c9-de", "username": "ann1"},
        {"document_id": "c2-en", "username": "ann1"},
        {"document_id": "c5-de", "username": "ann1"},
    ]
    await call(mcp_client, "assign_texts", {"project": "p", "assignments": rows})
    [sent] = fake.calls_to("POST", f"{P}/assignments")
    assert sent.json()["rows"] == rows


async def test_assign_tools_say_in_which_order_the_tasks_appear(
    mcp_client: Client,
) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    for name in ("assign_texts", "distribute_texts"):
        description = " ".join((tools[name].description or "").split())
        assert "in the order of assignment" in description, name


async def test_work_plan_sets_the_mode_with_the_previewed_revisions(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/work-plans/bulk/preview",
        build("BulkPreview", revisions={"c1": 4}),
    )
    args = {
        "project": "p",
        "language": "en",
        "case_ids": ["c1"],
        "annotation_mode": "proposals",
        "confirm": True,
    }
    await call(mcp_client, "update_work_plan", args)
    [saved] = fake.calls_to("PUT", f"{P}/work-plans/bulk")
    assert saved.json()["expected_revisions"] == {"c1": 4}
    assert saved.json()["languages"]["en"]["annotation_mode"] == "proposals"
    assert saved.json()["confirm"] is True


async def test_list_texts_reads_every_page(fake: FakeApi, mcp_client: Client) -> None:
    pages = {
        "1": page([row("c1", work=[work("submitted", "ann-0001")])], 1, 2),
        "2": page([row("c2")], 2, 2),
    }
    fake.on("GET", ROWS, lambda request: pages[request.url.params["page"]])
    result = await call(
        mcp_client,
        "list_texts",
        {"project": "p", "stage": ["final"], "fields": ["document_id", "work"]},
    )
    assert [t["case_id"] for t in result["texts"]] == ["c1", "c2"]
    assert result["texts"][0]["document_id"] == "c1-en-v1"
    assert result["texts"][0]["work"][0]["person"] == {
        "username": None,
        "display_name": None,
        "pseudonym": "ann-0001",
    }
    assert set(result["texts"][0]) == {"case_id", "language", "document_id", "work"}
    first = fake.calls_to("GET", ROWS)[0].request.url.params
    assert first.get_list("stage") == ["final"]


async def test_list_texts_shows_a_lead_pause_and_filters_on_it(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 464: the text's pause with its reason, and what pauses each task."""
    paused = row("c1", work=[work("in_progress", "ann-0001")])
    paused["lead_pause"] = {
        "reason": "Clinic is checking",
        "paused_by": {"pseudonym": "ann-0009", "display_name": "Carla Diaz"},
        "paused_at": "2026-11-17T09:30:00Z",
    }
    paused["work"][0]["pause_causes"] = ["lead"]
    fake.on("GET", ROWS, page([paused, row("c2")], 1, 1))
    result = await call(
        mcp_client,
        "list_texts",
        {"project": "p", "paused_by_lead": True, "fields": ["all"]},
    )
    first, second = result["texts"]
    assert first["lead_pause"] == {
        "reason": "Clinic is checking",
        "paused_by": {
            "username": None,
            "display_name": "Carla Diaz",
            "pseudonym": "ann-0009",
        },
        "paused_at": "2026-11-17T09:30:00Z",
    }
    assert first["work"][0]["paused_by"] == ["lead"]
    assert second["lead_pause"] is None
    sent = fake.calls_to("GET", ROWS)[0].request.url.params
    assert sent.get_list("flags") == ["lead_paused"]


def _results(fake: FakeApi) -> None:
    """Three texts: one agreeing, one differing, one with an open annotation."""
    rows = [
        row("agree", work=[work("submitted", "a"), work("submitted", "b")]),
        row("differ", work=[work("submitted", "a"), work("submitted", "b")]),
        row("open", work=[work("submitted", "a"), work("in_progress", "b")]),
    ]
    fake.on("GET", ROWS, page(rows))
    panels = {
        "agree": panel(
            [submission("s1", "agree-en-v1"), submission("s2", "agree-en-v1")],
            all_match=True,
        ),
        "differ": panel(
            [submission("s3", "differ-en-v1"), submission("s4", "differ-en-v1")],
            all_match=False,
            matching=1,
        ),
        "open": panel([submission("s5", "open-en-v1")], all_match=False),
    }
    fake.on(
        "GET",
        PANEL,
        lambda request: panels[request.url.raw_path.decode().split("/")[-3]],
    )


ACCEPT = f"{P}/final-selections/accept-agreeing"


def _preview(**fields: Any) -> dict[str, Any]:
    skipped = build(
        "AgreeingSkip",
        case_id="differ",
        language="en",
        reason="differ",
        message="No result you may accept agrees in full.",
    )
    text = build(
        "AgreeingText",
        case_id="agree",
        language="en",
        document_id="agree-en-v1",
        submission_id="s1",
        findings=2,
    )
    return (
        build(
            "AcceptAgreeingView",
            project="p",
            applied=False,
            texts=[text],
            skipped=[skipped],
            already_final=3,
            unknown_case_ids=["nope"],
            preview_token=PT_A,
        )
        | fields
    )


async def test_accept_agreeing_texts_dry_run_asks_the_server_once(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", ACCEPT, _preview())
    result = await call(
        mcp_client, "accept_agreeing_texts", {"project": "p", "case_ids": ["agree"]}
    )
    assert fake.templates() == [("POST", ACCEPT)]
    [request] = fake.calls_to("POST", ACCEPT)
    assert request.json() == {"preview": True, "case_ids": ["agree"]}
    assert result["applied"] is False
    assert [t["case_id"] for t in result["would_accept"]] == ["agree"]
    assert result["skipped"][0]["message"].startswith("No result")
    assert result["skipped_by_reason"] == {"differ": 1}
    assert result["unknown_case_ids"] == ["nope"]
    assert (result["already_final"], result["preview_token"]) == (3, PT_A)


async def test_accept_agreeing_texts_applies_the_dry_runs_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", ACCEPT, _preview(applied=True))
    with pytest.raises(ToolFailed, match="preview_token"):
        await call(
            mcp_client, "accept_agreeing_texts", {"project": "p", "confirm": True}
        )
    assert not fake.calls
    result = await call(
        mcp_client,
        "accept_agreeing_texts",
        {"project": "p", "confirm": True, "preview_token": PT_A},
    )
    [request] = fake.calls_to("POST", ACCEPT)
    assert request.json() == {"preview_token": PT_A}
    assert [t["submission_id"] for t in result["accepted"]] == ["s1"]
    assert not fake.calls_to("PUT", f"{P}/final-selections")


async def test_accept_agreeing_texts_stale_token_returns_a_fresh_dry_run(
    fake: FakeApi, mcp_client: Client
) -> None:
    fresh = _preview(texts=[], preview_token=PT_B)
    fake.on("POST", ACCEPT, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    result = await call(
        mcp_client,
        "accept_agreeing_texts",
        {"project": "p", "confirm": True, "preview_token": PT_A},
    )
    assert result["applied"] is False and result["stale"] is True
    assert (result["would_accept"], result["preview_token"]) == ([], PT_B)


CHANGE = f"{P}/final-selections/bulk-change"
TEXTS = [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}]


def _change_preview(**fields: Any) -> dict[str, Any]:
    change = build(
        "FinalChange",
        case_id="c1",
        language="en",
        expected_revision=1,
        from_submission_id="s1",
        submission_id="s2",
        kind="consolidation",
        eligible_submissions=3,
    )
    skip = build(
        "FinalChangeSkip",
        case_id="c2",
        language="en",
        reason="already_newest",
        message="The final result is already the newest submission.",
    )
    return (
        build(
            "BulkChangeFinalView",
            project="p",
            applied=False,
            texts=2,
            change_count=1,
            skipped_count=1,
            skipped_by_reason={"already_newest": 1},
            changes=[change],
            skipped=[skip],
            preview_token=PT_A,
        )
        | fields
    )


async def test_change_final_results_dry_run_then_confirm_with_its_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", CHANGE, _change_preview())
    result = await call(
        mcp_client, "change_final_results", {"project": "p", "texts": TEXTS}
    )
    [request] = fake.calls_to("POST", CHANGE)
    assert request.json() == {
        "rows": TEXTS,
        "rule": "newest_submission",
        "preview": True,
    }
    assert result["applied"] is False
    assert [c["submission_id"] for c in result["would_change"]] == ["s2"]
    assert result["skipped_by_reason"] == {"already_newest": 1}
    assert (result["change_count"], result["preview_token"]) == (1, PT_A)
    with pytest.raises(ToolFailed, match="preview_token"):
        await call(
            mcp_client,
            "change_final_results",
            {"project": "p", "texts": TEXTS, "confirm": True},
        )
    fake.on("POST", CHANGE, _change_preview(applied=True))
    done = await call(
        mcp_client,
        "change_final_results",
        {
            "project": "p",
            "texts": TEXTS,
            "confirm": True,
            "preview_token": PT_A,
        },
    )
    assert fake.calls_to("POST", CHANGE)[-1].json() == {
        "rows": TEXTS,
        "rule": "newest_submission",
        "preview_token": PT_A,
    }
    assert done["applied"] is True
    assert [c["case_id"] for c in done["changed"]] == ["c1"]
    assert not fake.calls_to("PUT", f"{P}/final-selections")


async def test_change_final_results_stale_token_returns_a_fresh_dry_run(
    fake: FakeApi, mcp_client: Client
) -> None:
    fresh = _change_preview(changes=[], change_count=0, preview_token=PT_B)
    fake.on("POST", CHANGE, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    result = await call(
        mcp_client,
        "change_final_results",
        {
            "project": "p",
            "texts": TEXTS,
            "confirm": True,
            "preview_token": PT_A,
        },
    )
    assert result["applied"] is False and result["stale"] is True
    assert (result["would_change"], result["preview_token"]) == ([], PT_B)


UNDO_CHANGE = f"{CHANGE}/undo"


def _undo_preview(**fields: Any) -> dict[str, Any]:
    restore = build(
        "FinalRestore",
        case_id="c1",
        language="en",
        document_id="c1-en",
        submission_id="s1",
        version=1,
        from_document_id="c1-en",
        from_submission_id="s2",
        from_version=1,
        selected_by=build("PersonRefView", pseudonym="ann-0001", display_name="Mia"),
        selected_at="2026-11-17T09:00:00Z",
    )
    return (
        build(
            "BulkChangeFinalUndoView",
            project="p",
            undo_id=41,
            applied=False,
            expires_at="2026-11-17T12:00:00Z",
            texts=1,
            restore_count=1,
            blocked_count=0,
            restores=[restore],
            blocked=[],
            exports_since=0,
        )
        | fields
    )


async def test_a_confirmed_change_of_final_results_names_its_undo(
    fake: FakeApi, mcp_client: Client
) -> None:
    handle = {"id": 41, "expires_at": "2026-11-17T12:00:00Z"}
    fake.on("POST", CHANGE, _change_preview())
    dry = await call(
        mcp_client, "change_final_results", {"project": "p", "texts": TEXTS}
    )
    assert "undo" not in dry
    fake.on("POST", CHANGE, _change_preview(applied=True, undo=handle))
    done = await call(
        mcp_client,
        "change_final_results",
        {
            "project": "p",
            "texts": TEXTS,
            "confirm": True,
            "preview_token": PT_A,
        },
    )
    assert done["undo"] == handle


async def test_undo_change_final_results_dry_run_then_confirm(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("POST", UNDO_CHANGE, _undo_preview(exports_since=1))
    args: dict[str, Any] = {"project": "p", "undo_id": 41}
    dry = await call(mcp_client, "undo_change_final_results", args)
    [request] = fake.calls_to("POST", UNDO_CHANGE)
    assert request.json() == {"undo_id": 41, "preview": True}
    assert dry["applied"] is False and dry["exports_since"] == 1
    assert dry["would_restore"] == [
        {
            "case_id": "c1",
            "language": "en",
            "submission_id": "s1",
            "version": 1,
            "replaces_submission_id": "s2",
            "chosen_by": {
                "username": None,
                "display_name": "Mia",
                "pseudonym": "ann-0001",
            },
            "chosen_at": "2026-11-17T09:00:00Z",
        }
    ]
    assert (dry["restore_count"], dry["blocked"], dry["blocked_count"]) == (1, [], 0)

    fake.on("POST", UNDO_CHANGE, _undo_preview(applied=True))
    done = await call(mcp_client, "undo_change_final_results", args | {"confirm": True})
    assert fake.calls_to("POST", UNDO_CHANGE)[-1].json() == {"undo_id": 41}
    assert done["applied"] is True
    assert [item["submission_id"] for item in done["restored"]] == ["s1"]
    assert not fake.calls_to("PUT", f"{P}/final-selections")


async def test_a_refused_undo_of_final_results_lists_the_texts_in_the_way(
    fake: FakeApi, mcp_client: Client
) -> None:
    block = build(
        "FinalRestoreBlock",
        case_id="c1",
        language="en",
        reason="tasks",
        message="A task of the text changed since.",
    )
    fresh = _undo_preview(
        restores=[], restore_count=0, blocked=[block], blocked_count=1
    )
    fake.on(
        "POST",
        UNDO_CHANGE,
        refusal(409, "BULK_UNDO_STALE", {"reason": "changed", "preview": fresh}),
    )
    args: dict[str, Any] = {"project": "p", "undo_id": 41, "confirm": True}
    result = await call(mcp_client, "undo_change_final_results", args)
    assert result["applied"] is False and result["refused"] is True
    assert result["blocked"] == [
        {
            "case_id": "c1",
            "language": "en",
            "reason": "tasks",
            "message": "A task of the text changed since.",
        }
    ]
    assert result["would_restore"] == []
    # Expired, used up, or another lead's: the server's refusal as it is.
    fake.on("POST", UNDO_CHANGE, refusal(409, "BULK_UNDO_STALE", {"reason": "expired"}))
    with pytest.raises(ToolFailed, match="BULK_UNDO_STALE"):
        await call(mcp_client, "undo_change_final_results", args)


def _agreement_text(case_id: str) -> dict[str, Any]:
    summary = build("AgreementSummary")
    return build(
        "TextAgreement", case_id=case_id, document_id=f"{case_id}-en", **summary
    )


async def test_agreement_summary_reads_the_project_agreement_in_one_call(
    fake: FakeApi, mcp_client: Client
) -> None:
    pooled = build("AgreementPooled", texts=2, pairs=3, annotation_strict_f1=0.5)
    fake.on(
        "GET",
        f"{P}/agreement",
        build(
            "ProjectAgreement",
            selected_texts=2,
            summary=build("AgreementSummary", pooled=pooled),
            texts=[_agreement_text("c1"), _agreement_text("c2")],
            pairs=[build("PairAgreement", case_id="c1"), build("PairAgreement")],
        ),
    )
    result = await call(mcp_client, "agreement_summary", {"project": "p"})
    assert fake.templates() == [("GET", f"{P}/agreement")]
    assert result["summary"]["pooled"]["annotation_strict_f1"] == 0.5
    assert [t["case_id"] for t in result["texts"]] == ["c1", "c2"]
    assert "pairs" not in result
    only = await call(
        mcp_client,
        "agreement_summary",
        {"project": "p", "case_ids": ["c1"], "include_pairs": True},
    )
    assert [t["case_id"] for t in only["texts"]] == ["c1"]
    assert [p["case_id"] for p in only["pairs"]] == ["c1"]
    assert only["summary"] == result["summary"]


async def test_consolidation_takes_every_eligible_submission(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    await call(
        mcp_client,
        "start_consolidation",
        {"project": "p", "case_id": "differ", "language": "en", "reviewer": "carla"},
    )
    [start] = fake.calls_to("POST", f"{P}/consolidations")
    body = start.json()
    assert body["source_submission_ids"] == ["s3", "s4"]
    assert body["document_id"] == "differ-en-v1"
    assert body["reviewer"] == "carla"
    assert body["request_id"]


async def test_final_export_needs_acknowledged_warnings(
    fake: FakeApi, mcp_client: Client
) -> None:
    warning = build("FinalWarning", id="w1", cause_revision=2)
    omission = build("FinalOmission", case_id="c9", language="de")
    fake.on(
        "POST",
        f"{P}/exports/final/preflight",
        build(
            "FinalPreflight",
            warnings=[warning],
            omissions=[omission],
            state_digest="e" * 64,
        ),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 90})
    with pytest.raises(ToolFailed, match="1 warning"):
        await call(mcp_client, "start_export", {"project": "p", "kind": "final"})
    with pytest.raises(ToolFailed, match="no final result"):
        await call(
            mcp_client,
            "start_export",
            {"project": "p", "kind": "final", "acknowledge_warnings": True},
        )
    assert not fake.calls_to("POST", f"{P}/exports/final")
    job = await call(
        mcp_client,
        "start_export",
        {
            "project": "p",
            "kind": "final",
            "acknowledge_warnings": True,
            "accept_omissions": True,
        },
    )
    assert job["id"] == 90
    [export] = fake.calls_to("POST", f"{P}/exports/final")
    body = export.json()
    assert body["state_digest"] == "e" * 64
    assert body["acknowledged_warnings"] == [{"id": "w1", "cause_revision": 2}]
    assert body["accepted_omissions"] == [{"case_id": "c9", "language": "de"}]


@pytest.mark.parametrize(
    ("kind", "body"),
    [
        ("annotations", {"kind": "t1"}),
        ("edit_log", {"kind": "edit_log"}),
        ("work_time", {"kind": "work_time"}),
    ],
)
async def test_other_exports_use_the_export_route(
    fake: FakeApi, mcp_client: Client, kind: str, body: dict[str, str]
) -> None:
    fake.on("POST", f"{P}/exports", {"job_id": 5})
    result = await call(
        mcp_client, "start_export", {"project": "p", "kind": kind, "wait": False}
    )
    assert result == {"job_id": 5, "kind": kind, "status": "queued"}
    assert fake.calls_to("POST", f"{P}/exports")[0].json() == body


async def test_working_time_summary_reads_the_project_sums(
    fake: FakeApi, mcp_client: Client
) -> None:
    sums = {
        "record": True,
        "modes": [
            {
                "mode": "scratch",
                "texts": 2,
                "total_seconds": 600,
                "median_seconds_per_text": 300,
            }
        ],
    }
    fake.on("GET", f"{P}/work-time", sums)
    assert await call(mcp_client, "working_time_summary", {"project": "p"}) == sums


async def test_project_audit_passes_its_filters(
    fake: FakeApi, mcp_client: Client
) -> None:
    events = {"events": [], "total": 0, "limit": 20, "offset": 40}
    fake.on("GET", f"{P}/audit", events)
    result = await call(
        mcp_client,
        "project_audit",
        {
            "project": "p",
            "action": ["work_plan.update", "assignment.*"],
            "person": "ann-0001",
            "api_token_id": 7,
            "since": "2026-11-01T00:00:00Z",
            "limit": 20,
            "offset": 40,
        },
    )
    assert result == events
    [request] = fake.calls_to("GET", f"{P}/audit")
    params = request.request.url.params
    assert params.get_list("action") == ["work_plan.update", "assignment.*"]
    assert params["person"] == "ann-0001"
    assert params["api_token_id"] == "7"
    assert params["since"] == "2026-11-01T00:00:00+00:00"
    assert "until" not in params
    assert (params["limit"], params["offset"]) == ("20", "40")


async def test_list_jobs_passes_its_filters(fake: FakeApi, mcp_client: Client) -> None:
    jobs = {"jobs": [], "total": 0, "limit": 50, "offset": 0}
    fake.on("GET", f"{P}/jobs", jobs)
    result = await call(
        mcp_client,
        "list_jobs",
        {
            "project": "p",
            "kind": ["final_t1_export"],
            "status": ["failed", "succeeded"],
            "requester": "ann-0004",
            "error_code": "EXPORT_FAILED",
        },
    )
    assert result == jobs
    [request] = fake.calls_to("GET", f"{P}/jobs")
    params = request.request.url.params
    assert params.get_list("kind") == ["final_t1_export"]
    assert params.get_list("status") == ["failed", "succeeded"]
    assert params["requester"] == "ann-0004"
    assert params["error_code"] == "EXPORT_FAILED"


def _export_job(fake: FakeApi, content: bytes, **job: Any) -> None:
    fake.on(
        "GET",
        "/api/v1/jobs/{job_id}",
        {
            "id": 9,
            "kind": "final_t1_export",
            "status": "succeeded",
            "result": {"sha256": hashlib.sha256(content).hexdigest()},
            "error": None,
            "created_at": "2026-11-01T10:00:00Z",
            "finished_at": "2026-11-01T10:00:05Z",
        }
        | job,
    )
    fake.on("GET", "/api/v1/jobs/{job_id}/download", content)


async def test_download_writes_the_file_and_checks_its_digest(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"zip-bytes")
    target = tmp_path / "final.zip"
    result = await call(
        mcp_client, "download_export", {"job_id": 9, "path": str(target)}
    )
    assert target.read_bytes() == b"zip-bytes"
    assert result["bytes"] == 9
    assert result["kind"] == "final"
    with pytest.raises(ToolFailed, match="exists already"):
        await call(mcp_client, "download_export", {"job_id": 9, "path": str(target)})
    await call(
        mcp_client,
        "download_export",
        {"job_id": 9, "path": str(target), "overwrite": True},
    )
    assert [p.name for p in tmp_path.iterdir()] == ["final.zip"]


async def test_a_corrupt_download_is_removed(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"expected", result={"sha256": "0" * 64})
    target = tmp_path / "final.zip"
    with pytest.raises(ToolFailed, match="does not match"):
        await call(mcp_client, "download_export", {"job_id": 9, "path": str(target)})
    assert list(tmp_path.iterdir()) == []


async def test_a_corrupt_download_keeps_the_file_it_would_replace(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"corrupt", result={"sha256": "0" * 64})
    target = tmp_path / "final.zip"
    target.write_bytes(b"the previous good export")
    with pytest.raises(ToolFailed, match="does not match"):
        await call(
            mcp_client,
            "download_export",
            {"job_id": 9, "path": str(target), "overwrite": True},
        )
    assert target.read_bytes() == b"the previous good export"
    assert [p.name for p in tmp_path.iterdir()] == ["final.zip"]


async def test_an_unfinished_job_is_not_downloaded(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"", status="running", finished_at=None)
    with pytest.raises(ToolFailed, match="'running'"):
        await call(
            mcp_client, "download_export", {"job_id": 9, "path": str(tmp_path / "a")}
        )
    assert not fake.calls_to("GET", "/api/v1/jobs/{job_id}/download")


async def test_a_refused_download_leaves_no_partial_file(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"x")
    fake.on(
        "GET",
        "/api/v1/jobs/{job_id}/download",
        refusal(403, "TOKEN_SCOPE_MISSING", "The API token needs the 'export' scope."),
    )
    with pytest.raises(ToolFailed, match="TOKEN_SCOPE_MISSING"):
        await call(
            mcp_client, "download_export", {"job_id": 9, "path": str(tmp_path / "a")}
        )
    assert list(tmp_path.iterdir()) == []


async def test_get_job_waits_until_done(fake: FakeApi, mcp_client: Client) -> None:
    states = iter(["queued", "running", "succeeded"])

    def job(request: httpx.Request) -> dict[str, Any]:
        return build("JobView", id=3, kind="t1_export", status=next(states))

    fake.on("GET", "/api/v1/jobs/{job_id}", job)
    result = await call(mcp_client, "get_job", {"job_id": 3, "wait": True})
    assert result["status"] == "succeeded"
    assert len(fake.calls) == 3


async def test_resources_read_settings_guideline_and_readme(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/settings", build("ProjectSettings", name="Ward 7"))
    current = build("GuidelineSummary", version=3)
    fake.on(
        "GET",
        f"{P}/guidelines",
        build(
            "GuidelineListing", current=current, latest_version=3, versions=[current]
        ),
    )
    fake.on(
        "GET",
        f"{P}/guidelines/{{version}}",
        build("GuidelineDocument", version=3, body="# Annotate every phenotype"),
    )
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("README.txt", "Final export of Ward 7")
    _export_job(fake, archive.getvalue())

    settings = await mcp_client.read_resource("ontotator://projects/ward-7/settings")
    assert '"name": "Ward 7"' in settings.contents[0].text
    guideline = await mcp_client.read_resource("ontotator://projects/ward-7/guideline")
    assert guideline.contents[0].text == "# Annotate every phenotype"
    readme = await mcp_client.read_resource("ontotator://jobs/9/readme")
    assert readme.contents[0].text == "Final export of Ward 7"
    assert fake.calls_to("GET", f"{P}/guidelines/{{version}}")[
        0
    ].request.url.path.endswith("/guidelines/3")


async def test_case_ids_with_slashes_stay_one_segment(
    fake: FakeApi, mcp_client: Client
) -> None:
    _results(fake)
    fake.on("GET", PANEL, panel([], all_match=False))
    with pytest.raises(ToolFailed):
        await call(
            mcp_client,
            "start_consolidation",
            {"project": "p", "case_id": "a/b", "language": "en", "reviewer": "c"},
        )
    [request] = fake.calls_to("GET", PANEL)
    assert b"/document-rows/a%2Fb/en/final-panel" in request.request.url.raw_path


async def test_phenopackets_are_a_final_export_in_that_format(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/exports/final/preflight",
        build("FinalPreflight", warnings=[], omissions=[], state_digest="e" * 64),
    )
    fake.on("POST", f"{P}/exports/final", {"job_id": 91})
    for kind, export_format in (("phenopackets", "phenopacket"), ("final", "t1")):
        fake.calls.clear()
        result = await call(
            mcp_client, "start_export", {"project": "p", "kind": kind, "wait": False}
        )
        assert result == {"job_id": 91, "kind": kind, "status": "queued"}
        [export] = fake.calls_to("POST", f"{P}/exports/final")
        assert export.json()["format"] == export_format


async def test_a_phenopacket_export_downloads_like_the_others(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _export_job(fake, b"pp", kind="final_phenopacket_export")
    result = await call(
        mcp_client, "download_export", {"job_id": 9, "path": str(tmp_path / "p.zip")}
    )
    assert result["kind"] == "phenopackets"


ARCHIVES = "/api/v1/admin/project-archives"


def _archive_job(fake: FakeApi, content: bytes, **job: Any) -> None:
    fake.on(
        "GET",
        f"{ARCHIVES}/jobs/{{job_id}}",
        build(
            "ArchiveJobView",
            id=4,
            kind="project_archive_export",
            status="succeeded",
            result={"sha256": hashlib.sha256(content).hexdigest(), "project": "p"},
            finished_at="2026-11-01T10:00:05Z",
        )
        | job,
    )
    fake.on("GET", f"{ARCHIVES}/jobs/{{job_id}}/download", content)


async def test_a_project_archive_is_exported_and_downloaded(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    fake.on("POST", f"{ARCHIVES}/export", {"job_id": 4})
    _archive_job(fake, b"archive")
    job = await call(
        mcp_client,
        "export_project_archive",
        {"project": "p", "include_ontology_files": False},
    )
    assert job["status"] == "succeeded"
    [started] = fake.calls_to("POST", f"{ARCHIVES}/export")
    assert started.json() == {"project_key": "p", "include_ontology_files": False}
    # Archive jobs have their own routes; the generic job routes are not used.
    assert not fake.calls_to("GET", "/api/v1/jobs/{job_id}")
    target = tmp_path / "archive.zip"
    result = await call(
        mcp_client, "download_project_archive", {"job_id": 4, "path": str(target)}
    )
    assert target.read_bytes() == b"archive"
    assert result["project"] == "p" and result["bytes"] == 7


async def test_a_project_archive_download_stays_in_files_dir(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    _archive_job(fake, b"archive")
    for files_dirs in ((allowed.resolve(),), ()):
        limited = replace(settings, files_dirs=files_dirs)
        server = build_server(limited, transport=httpx.MockTransport(fake))
        async with Client(server) as client:
            with pytest.raises(ToolFailed, match="ONTOTATOR_MCP_FILES_DIR"):
                await call(
                    client,
                    "download_project_archive",
                    {"job_id": 4, "path": str(tmp_path / "out.zip")},
                )
    assert not (tmp_path / "out.zip").exists()
    assert not fake.calls_to("GET", f"{ARCHIVES}/jobs/{{job_id}}/download")


async def test_only_a_finished_archive_export_is_downloaded(
    fake: FakeApi, mcp_client: Client, tmp_path: Path
) -> None:
    _archive_job(fake, b"", kind="project_archive_import")
    with pytest.raises(ToolFailed, match="not a project archive export"):
        await call(
            mcp_client,
            "download_project_archive",
            {"job_id": 4, "path": str(tmp_path / "a.zip")},
        )
    _archive_job(fake, b"", status="failed", error="boom", finished_at=None)
    with pytest.raises(ToolFailed, match="'failed': boom"):
        await call(
            mcp_client,
            "download_project_archive",
            {"job_id": 4, "path": str(tmp_path / "a.zip")},
        )
    assert list(tmp_path.iterdir()) == []
