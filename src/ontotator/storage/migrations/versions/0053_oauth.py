"""OAuth for remote MCP clients (issue 388).

Purely additive: four new, empty tables (``oauth_clients``,
``oauth_grants``, ``oauth_codes``, ``oauth_refresh_tokens``) with their
indexes and grants, and one nullable column ``api_tokens.oauth_grant_id``
with a foreign key, a check and an index. Adding a nullable column without
a default rewrites no row; the check and the foreign key are created
``NOT VALID`` and validated afterwards, which scans ``api_tokens`` (small)
without blocking writes.

Only SHA-256 digests of client secrets, codes and refresh tokens are
stored. The application role may revoke, mark used and record last use
(UPDATE) but never delete grants or refresh tokens: the audit trail names
grants by their id. It may delete ``oauth_clients`` and ``oauth_codes``
rows, which the server does only for a client that never got a grant
(open registration would otherwise fill the table for good).

The downgrade drops all of it and revokes the OAuth access tokens first;
production migrates forward only.
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0053"
down_revision = "0050"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
SCOPES = (
    "cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'import',"
    " 'export', 'project-admin']::text[]"
)


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def _id() -> sa.Column[int]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False)


def _created() -> sa.Column[datetime]:
    return sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False)


def _fk(table: str, column: str, target: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{SCHEMA}.{target}.id"], name=f"fk_{table}_{column}"
    )


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        _id(),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("secret_sha256", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("redirect_uris", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("auth_method", sa.Text(), nullable=False),
        sa.Column("grant_types", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("registered_from", sa.Text(), nullable=True),
        _created(),
        sa.PrimaryKeyConstraint("id", name="pk_oauth_clients"),
        sa.UniqueConstraint("client_id", name="uq_oauth_clients_client_id"),
        sa.CheckConstraint(
            "auth_method IN ('none', 'client_secret_post', 'client_secret_basic')",
            name="ck_oauth_clients_auth_method",
        ),
        sa.CheckConstraint(
            "(auth_method = 'none') = (secret_sha256 IS NULL)",
            name="ck_oauth_clients_secret",
        ),
        sa.CheckConstraint(
            "cardinality(redirect_uris) BETWEEN 1 AND 5",
            name="ck_oauth_clients_redirect_uris",
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 100", name="ck_oauth_clients_name"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "oauth_grants",
        _id(),
        sa.Column("client_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("resource", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        _created(),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("last_used_at", _ts(), nullable=True),
        sa.Column("revoked_at", _ts(), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oauth_grants"),
        _fk("oauth_grants", "client_id", "oauth_clients"),
        _fk("oauth_grants", "user_id", "users"),
        sa.CheckConstraint(SCOPES, name="ck_oauth_grants_scopes"),
        sa.CheckConstraint("expires_at > created_at", name="ck_oauth_grants_lifetime"),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)",
            name="ck_oauth_grants_revoked",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_oauth_grants_user_id_revoked_at",
        "oauth_grants",
        ["user_id", "revoked_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_oauth_grants_client_id", "oauth_grants", ["client_id"], schema=SCHEMA
    )
    op.create_table(
        "oauth_codes",
        _id(),
        sa.Column("code_sha256", sa.Text(), nullable=False),
        sa.Column("client_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("code_challenge", sa.Text(), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("resource", sa.Text(), nullable=False),
        _created(),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("used_at", _ts(), nullable=True),
        sa.Column("revoked_at", _ts(), nullable=True),
        sa.Column("grant_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oauth_codes"),
        sa.UniqueConstraint("code_sha256", name="uq_oauth_codes_code_sha256"),
        _fk("oauth_codes", "client_id", "oauth_clients"),
        _fk("oauth_codes", "user_id", "users"),
        _fk("oauth_codes", "grant_id", "oauth_grants"),
        sa.CheckConstraint(SCOPES, name="ck_oauth_codes_scopes"),
        sa.CheckConstraint(
            "expires_at > created_at"
            " AND expires_at <= created_at + interval '10 minutes'",
            name="ck_oauth_codes_lifetime",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_oauth_codes_grant_id", "oauth_codes", ["grant_id"], schema=SCHEMA
    )
    op.create_table(
        "oauth_refresh_tokens",
        _id(),
        sa.Column("grant_id", sa.BigInteger(), nullable=False),
        sa.Column("token_sha256", sa.Text(), nullable=False),
        _created(),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("used_at", _ts(), nullable=True),
        sa.Column("successor_nonce", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oauth_refresh_tokens"),
        sa.UniqueConstraint(
            "token_sha256", name="uq_oauth_refresh_tokens_token_sha256"
        ),
        _fk("oauth_refresh_tokens", "grant_id", "oauth_grants"),
        sa.CheckConstraint(
            "expires_at > created_at", name="ck_oauth_refresh_tokens_lifetime"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_oauth_refresh_tokens_grant_id",
        "oauth_refresh_tokens",
        ["grant_id"],
        schema=SCHEMA,
    )
    op.add_column(
        "api_tokens",
        sa.Column("oauth_grant_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.api_tokens ADD CONSTRAINT"
        " fk_api_tokens_oauth_grant_id FOREIGN KEY (oauth_grant_id)"
        f" REFERENCES {SCHEMA}.oauth_grants (id) NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.api_tokens ADD CONSTRAINT ck_api_tokens_oauth_kind"
        " CHECK (oauth_grant_id IS NULL OR kind = 'personal') NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.api_tokens VALIDATE CONSTRAINT"
        " fk_api_tokens_oauth_grant_id"
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.api_tokens VALIDATE CONSTRAINT ck_api_tokens_oauth_kind"
    )
    op.create_index(
        "ix_api_tokens_oauth_grant_id",
        "api_tokens",
        ["oauth_grant_id"],
        schema=SCHEMA,
    )
    for table in (
        "oauth_clients",
        "oauth_grants",
        "oauth_codes",
        "oauth_refresh_tokens",
    ):
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.{table} TO {APP_ROLE}")
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{table}_id_seq TO {APP_ROLE}"
        )
    for table in ("oauth_clients", "oauth_codes"):
        op.execute(f"GRANT DELETE ON {SCHEMA}.{table} TO {APP_ROLE}")


def downgrade() -> None:
    """Remove OAuth again (tests of later migrations step back below it).

    An OAuth access token would otherwise stay behind as a plain personal
    token without its grant, so every one still usable is revoked first.
    """
    op.execute(
        f"UPDATE {SCHEMA}.api_tokens SET revoked_at = now(),"
        " revoked_reason = 'oauth_removed'"
        " WHERE oauth_grant_id IS NOT NULL AND revoked_at IS NULL"
    )
    op.drop_index("ix_api_tokens_oauth_grant_id", "api_tokens", schema=SCHEMA)
    op.drop_constraint("ck_api_tokens_oauth_kind", "api_tokens", schema=SCHEMA)
    op.drop_constraint(
        "fk_api_tokens_oauth_grant_id", "api_tokens", type_="foreignkey", schema=SCHEMA
    )
    op.drop_column("api_tokens", "oauth_grant_id", schema=SCHEMA)
    for table in (
        "oauth_refresh_tokens",
        "oauth_codes",
        "oauth_grants",
        "oauth_clients",
    ):
        op.drop_table(table, schema=SCHEMA)
