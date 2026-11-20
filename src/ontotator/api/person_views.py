"""One person as another user sees them (spec "Identity", D1)."""

from pydantic import BaseModel


class PersonRefView(BaseModel):
    """``display_name`` only for lead callers or the caller's own record."""

    pseudonym: str
    display_name: str | None = None
    is_me: bool = False


class MemberRefView(PersonRefView):
    """A person in a lead's task views (Documents rows, previews of the bulk
    actions), with the login name API clients name a person by (issue 471).

    ``username`` only for a lead and of a current member of the project, as
    the members list shows it; otherwise None. Every other view uses
    ``PersonRefView``, which has no such field: problem reports, the audit
    and the job list name nobody's login.
    """

    username: str | None = None
