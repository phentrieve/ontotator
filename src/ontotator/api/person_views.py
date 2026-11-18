"""One person as another user sees them (spec "Identity", D1)."""

from pydantic import BaseModel


class PersonRefView(BaseModel):
    """``display_name`` only for lead callers or the caller's own record."""

    pseudonym: str
    display_name: str | None = None
    # The login name (issue 471), which API clients name a person by: only
    # in a project's task views, for a lead and of a current member of the
    # project, as the members list shows it. The audit and the job list
    # name nobody's login.
    username: str | None = None
    is_me: bool = False
