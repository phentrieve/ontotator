"""Migration 0039: OAuth tables and ``api_tokens.oauth_grant_id`` on live data."""

from collections.abc import Iterator

import pytest
from pg_harness import unmigrated_database_url
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ontotator.storage.schema import upgrade

REVISION = "0039"
PREVIOUS = "0038"
S = "ontotator"


@pytest.fixture
def migrated(tmp_path) -> Iterator[Engine]:
    url = unmigrated_database_url(tmp_path / "oauth-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {S}.users (username, display_name, pseudonym)"
                " VALUES ('ann', 'Ann', 'ann-0001')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {S}.api_tokens (token_sha256, name, kind, owner_id,"
                " scopes, expires_at) SELECT :digest, 'script', 'system', id,"
                f" ARRAY['read', 'admin'], now() + interval '1 day' FROM {S}.users"
            ),
            {"digest": "d" * 64},
        )
    upgrade(url, REVISION)
    yield engine
    engine.dispose()


def _client(conn) -> int:  # type: ignore[no-untyped-def]
    return int(
        conn.execute(
            text(
                f"INSERT INTO {S}.oauth_clients (client_id, name, redirect_uris,"
                " auth_method) VALUES ('otc_x', 'Claude',"
                " ARRAY['https://claude.ai/cb'], 'none') RETURNING id"
            )
        ).scalar_one()
    )


def _grant(conn, scopes: list[str]) -> int:  # type: ignore[no-untyped-def]
    client = _client(conn)
    return int(
        conn.execute(
            text(
                f"INSERT INTO {S}.oauth_grants (client_id, user_id, scopes, resource,"
                " expires_at) SELECT :client, id, :scopes, 'https://ex.org/mcp',"
                f" now() + interval '90 days' FROM {S}.users RETURNING id"
            ),
            {"client": client, "scopes": scopes},
        ).scalar_one()
    )


def test_existing_tokens_stay_without_a_grant(migrated: Engine) -> None:
    with migrated.begin() as conn:
        row = conn.execute(
            text(f"SELECT kind, oauth_grant_id FROM {S}.api_tokens")
        ).one()
        assert row.kind == "system" and row.oauth_grant_id is None
        for table in ("oauth_clients", "oauth_grants", "oauth_codes"):
            assert (
                conn.execute(text(f"SELECT count(*) FROM {S}.{table}")).scalar_one()
                == 0
            )


def test_a_grant_never_holds_the_admin_scope(migrated: Engine) -> None:
    with (
        pytest.raises(IntegrityError, match="ck_oauth_grants_scopes"),
        migrated.begin() as conn,
    ):
        _grant(conn, ["read", "admin"])


def test_an_oauth_access_token_is_a_personal_token(migrated: Engine) -> None:
    with migrated.begin() as conn:
        grant = _grant(conn, ["read"])
    with (
        pytest.raises(IntegrityError, match="ck_api_tokens_oauth_kind"),
        migrated.begin() as conn,
    ):
        conn.execute(
            text(f"UPDATE {S}.api_tokens SET oauth_grant_id = :grant"),
            {"grant": grant},
        )


def test_a_public_client_has_no_secret(migrated: Engine) -> None:
    with (
        pytest.raises(IntegrityError, match="ck_oauth_clients_secret"),
        migrated.begin() as conn,
    ):
        conn.execute(
            text(
                f"INSERT INTO {S}.oauth_clients (client_id, secret_sha256, name,"
                " redirect_uris, auth_method) VALUES ('otc_y', 'x', 'C',"
                " ARRAY['https://c/cb'], 'none')"
            )
        )


def test_the_application_role_cannot_delete_grants(migrated: Engine) -> None:
    with migrated.begin() as conn:
        _grant(conn, ["read"])
    with pytest.raises(DBAPIError, match="permission denied"), migrated.begin() as conn:
        conn.execute(text("SET ROLE ontotator_app"))
        conn.execute(text(f"DELETE FROM {S}.oauth_grants"))
