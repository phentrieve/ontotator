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
- bumps the MCP pin in [mcp/README.md](mcp/README.md) to the new tag (`ontotator@vX.Y.Z#subdirectory=mcp`, three places). The MCP tests fail until the pin matches the version in `pyproject.toml`.

Pushing the tag publishes the Docker image (see [docs/operations.md](docs/operations.md)).

## Security

Do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
