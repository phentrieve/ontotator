"""Person references with the display-name rule of D1."""

from collections.abc import Iterable

from sqlalchemy import Connection, select

from ontotator.api.person_views import MemberRefView, PersonRefView
from ontotator.storage.tables import ProjectMembershipRow, UserRow


def person_refs(
    conn: Connection,
    user_ids: Iterable[int],
    *,
    viewer_id: int,
    viewer_is_lead: bool,
    logins_of_project: int | None = None,
) -> dict[int, PersonRefView]:
    """Display names only for lead viewers or for the viewer's own record.

    With ``logins_of_project`` (a project id) the references are
    ``MemberRefView``: they carry the login name as that project's members
    list shows it, to a lead and of the current members. A former member,
    or an administrator acting in the project, keeps the login to
    themselves. Without it no reference has a login name at all.
    """
    ids = sorted(set(user_ids))
    if not ids:
        return {}
    members: set[int] = set()
    if logins_of_project is not None and viewer_is_lead:
        members = set(
            conn.execute(
                select(ProjectMembershipRow.user_id).where(
                    ProjectMembershipRow.project_id == logins_of_project,
                    ProjectMembershipRow.user_id.in_(ids),
                )
            ).scalars()
        )
    refs: dict[int, PersonRefView] = {}
    for row in conn.execute(
        select(
            UserRow.id, UserRow.pseudonym, UserRow.display_name, UserRow.username
        ).where(UserRow.id.in_(ids))
    ):
        named = viewer_is_lead or row.id == viewer_id
        fields = {
            "pseudonym": row.pseudonym,
            "display_name": row.display_name if named else None,
            "is_me": row.id == viewer_id,
        }
        refs[row.id] = (
            PersonRefView(**fields)
            if logins_of_project is None
            else MemberRefView(
                **fields, username=row.username if row.id in members else None
            )
        )
    return refs
