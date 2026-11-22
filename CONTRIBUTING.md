# Contributing

Thanks for your interest in Ontotator. Bug reports, feature ideas and pull requests are welcome.

## Development setup

Follow [Run from source](README.md#run-from-source) and [Development](README.md#development) in the README. In short: `uv sync --dev --locked`, `npm --prefix frontend ci`, and a running Docker for the PostgreSQL and browser tests.

## Checks

Run the full gate locally with `bash scripts/check.sh`, or `bash scripts/check.sh --quick` for static checks plus the tests affected by your change (see [local checks](docs/operations/local-checks.md)). You can also run the single tools for the area you touched and rely on CI: every pull request runs the full gate on GitHub Actions. A pull request is ready for review when CI is green.

API changes must keep the committed OpenAPI and TypeScript contracts in sync; the gate fails on drift.

UI changes must keep the user handbook in [docs/handbook/](docs/handbook/) in sync. CI checks that every bold UI label in the handbook still exists in `frontend/src`, and that a chapter changes when the code mapped to it in `docs/handbook/coverage.toml` changes. For changes without a visible effect, such as refactors, add the trailer line `Handbook: unchanged` to a commit message.

## Branches and pull requests

- Branch from `main` and name the branch after the change type, for example `fix/term-search`, `feat/export-filter`, `docs/readme` or `chore/repo-tidy`.
- Keep one topic per pull request and reference related issues (`Fixes #123`).
- Pull requests are squash-merged into `main`.

## Commit messages

Use short, imperative subjects in the [Conventional Commits](https://www.conventionalcommits.org/) style seen in the history: `fix: ...`, `feat: ...`, `docs: ...`, `test: ...`, `ci: ...`, `build: ...`, `chore: ...`, optionally with a scope such as `fix(problems): ...`.

## Releases

A release is one pull request `release: X.Y.Z`; its merge commit on `main` is tagged `vX.Y.Z`. The pull request:

- adds a `[X.Y.Z] - YYYY-MM-DD` heading under `[Unreleased]` in `CHANGELOG.md` and updates the compare links at the end;
- sets the version in `pyproject.toml`, `src/ontotator/__init__.py` and `frontend/package.json`, and in `uv.lock`, `frontend/package-lock.json` and `contracts/openapi.json` with them (the gate fails on contract drift);
- sets the same version for the MCP server in `mcp/pyproject.toml` and `mcp/src/ontotator_mcp/__init__.py`, and in `mcp/uv.lock` with them (`cd mcp && uv lock`). `ontotator-mcp --version`, its User-Agent and `whoami` show it;
- bumps the MCP pin in [mcp/README.md](mcp/README.md) to the new tag (`ontotator@vX.Y.Z#subdirectory=mcp`, three places);
- sets `version` and `date-released` in [`CITATION.cff`](CITATION.cff) to the new version and the date of its CHANGELOG heading.

The MCP tests fail until the MCP version and the pin match the version in `pyproject.toml`; `tests/test_citation_metadata.py` fails until `CITATION.cff` matches it and the CHANGELOG. [`.zenodo.json`](.zenodo.json) has no version: Zenodo takes it from the tag. Change it only with `CITATION.cff` (title, abstract, license, authors), as the same test checks.

After the merge:

1. Tag the merge commit and push the tag: `git tag -a vX.Y.Z -m vX.Y.Z <merge commit>`, `git push origin vX.Y.Z`. Pushing the tag publishes the Docker image (see [docs/operations.md](docs/operations.md)); check that the **Docker publish** run passed.
2. Publish a GitHub release for the tag (`gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file <the release's CHANGELOG section>`). A tag alone gets no DOI: Zenodo archives a release only when it is **published** on GitHub, not a draft.
3. Once Zenodo has archived it, check the new DOI on the Zenodo record. The README's "How to cite" names the concept DOI, which always resolves to the newest version, once it exists.

Steps only the repository owner can do, outside this repository:

- **Zenodo integration (once; postponed by the owner on 2026-11-22, B6-5):** sign in to [Zenodo](https://zenodo.org/) with the GitHub account that administers `phentrieve/ontotator`, open **GitHub** in the account settings and switch the repository on. From then on each published release gets a DOI. Releases published before that get none; to archive one, publish a new release. Then add the concept DOI to `README.md` ("How to cite") and as `doi` to `CITATION.cff`.
- **ontospan release:** `pyproject.toml` and `uv.lock` pin `ontospan` to commit `311f93e`, two commits after its only tag `v1.2.1`. In `phentrieve/ontospan`: tag that commit (for example `v1.2.2`), publish a GitHub release (with Zenodo switched on there too, for its own DOI) and, if wanted, publish it on PyPI. Then, in this repository, pin the tag instead of the commit, in one pull request: `"ontospan @ git+https://github.com/phentrieve/ontospan.git@v1.2.2"` in `pyproject.toml` (or `"ontospan==1.2.2"` once it is on PyPI, which also lets `allow-direct-references` go), `uv lock`, and check that `uv.lock` still resolves to the same commit `311f93e`. Do not pin `v1.2.1`: it lacks the two commits after it that the current pin includes.

## Security

Do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
