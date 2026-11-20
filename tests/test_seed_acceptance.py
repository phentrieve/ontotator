"""DB-free guards for the host-only local acceptance seed adapter."""

import hashlib
import json
import os
import re
import runpy
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_acceptance.py"


@pytest.fixture
def seed():
    return runpy.run_path(str(SCRIPT))


def config(seed, **changes):
    values = dict(
        project="ontotator-acceptance-check",
        image="sha256:" + "a" * 64,
        source_sha="b" * 40,
        app_port=18080,
        pg_port=15543,
    )
    return seed["configuration"](**(values | changes))


@pytest.mark.parametrize(
    "changes",
    [
        {"project": "existing-production"},
        {"project": "ontotator-acceptance/other"},
        {"image": "ontotator-dev:local"},
        {"source_sha": "main"},
        {"app_port": 80000},
        {"app_port": 15543},
        {"pg_port": 0},
    ],
)
def test_rejects_ambiguous_or_unsafe_stack_identity(seed, changes):
    with pytest.raises(ValueError):
        config(seed, **changes)


def test_host_is_derived_from_explicit_loopback_port(seed):
    assert config(seed)["host"] == "http://127.0.0.1:18080"


@pytest.mark.parametrize(
    "users,projects,ontologies",
    [
        ("admin\tp\tAdmin\tactive, admin\ndemo-reviewer\tp\tR\tactive", "", ""),
        ("admin\tp\tAdmin\tactive, admin", "other\tOther\t2 documents\t1 member", ""),
        ("admin\tp\tAdmin\tactive, admin", "", "some stored ontology"),
        ("someone\tp\tOther\tactive, admin", "", ""),
    ],
)
def test_refuses_populated_or_unexpected_stack_before_any_seed(
    seed, users, projects, ontologies
):
    with pytest.raises(ValueError, match="fresh"):
        seed["require_fresh"](users, projects, ontologies)


def test_only_expected_bootstrap_identity_is_fresh(seed):
    seed["require_fresh"]("admin\tp\tAdministrator\tactive, admin\n", "", "")


def test_fresh_accepts_the_current_users_list_with_e_mail_and_projects(seed):
    # `ontotator admin users list` prints six columns since e-mail and projects were added.
    seed["require_fresh"](
        "admin\tann-0001\tAdministrator\tactive, admin\t-\t-\n", "", ""
    )


def test_local_output_must_be_new_and_inside_ignored_acceptance_area(seed, tmp_path):
    root = tmp_path / "checkout"
    root.mkdir()
    allowed = root / "build" / "acceptance" / "run"
    assert seed["output_path"](root, allowed) == allowed
    with pytest.raises(ValueError):
        seed["output_path"](root, root / "examples" / "credentials")
    allowed.mkdir(parents=True)
    with pytest.raises(ValueError, match="exists"):
        seed["output_path"](root, allowed)


def test_identity_requires_exact_images_project_and_finished_migration(seed):
    cfg = config(seed)
    services = {
        name: {
            "Image": cfg["image"],
            "Config": {
                "Labels": {
                    "com.docker.compose.project": cfg["project"],
                    "com.docker.compose.service": name,
                }
            },
            "State": {"Status": "running", "Health": {"Status": "healthy"}},
        }
        for name in ("app", "migrate", "postgres")
    }
    services["migrate"]["State"] = {"Status": "exited", "ExitCode": 0}
    seed["require_service_identity"](cfg, services)
    services["app"]["Image"] = "sha256:" + "c" * 64
    with pytest.raises(ValueError, match="image"):
        seed["require_service_identity"](cfg, services)
    services["app"]["Image"] = cfg["image"]
    services["migrate"]["State"]["ExitCode"] = 1
    with pytest.raises(ValueError, match="migration"):
        seed["require_service_identity"](cfg, services)
    services["migrate"]["State"]["ExitCode"] = 0
    services["postgres"]["Config"]["Labels"]["com.docker.compose.project"] = "other"
    with pytest.raises(ValueError, match="project"):
        seed["require_service_identity"](cfg, services)


def test_public_input_manifest_matches_byte_stable_shipped_inputs(seed):
    manifest = seed["verify_inputs"]()
    assert manifest["documents"] == 6
    assert manifest["tool_proposals"] == 6
    assert manifest["writer_git"] == "4105ec1259fc04d927d78258fcf4c99f8f014b6a"


def test_full_input_set_requires_its_separate_manifest_and_hashes_every_translation(
    seed, tmp_path
):
    names = ["hp.json", "profile.json", "demo.zip", "cases.json", "hp-de.babelon.tsv"]
    for name in names:
        (tmp_path / name).write_bytes(name.encode())
    manifest = {
        "input_kind": "full-hpo/v1",
        "translations": ["hp-de.babelon.tsv"],
        "sha256": {name: hashlib.sha256(name.encode()).hexdigest() for name in names},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    assert seed["verify_inputs"](tmp_path)["translations"] == ["hp-de.babelon.tsv"]
    (tmp_path / "hp-de.babelon.tsv").write_bytes(b"changed")
    with pytest.raises(ValueError, match="hash mismatch"):
        seed["verify_inputs"](tmp_path)


def test_original_four_file_manifest_cannot_be_relaxed_by_adding_translations(
    seed, tmp_path
):
    manifest = {
        "translations": ["hp-de.babelon.tsv"],
        "sha256": {"hp-de.babelon.tsv": "a" * 64},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        seed["verify_inputs"](tmp_path)


def test_full_input_manifest_rejects_traversal_and_unlisted_files(seed, tmp_path):
    for names in [["../hp-de.babelon.tsv"], ["hp-dtp.babelon.tsv"]]:
        (tmp_path / "manifest.json").write_text(
            json.dumps(
                {"input_kind": "full-hpo/v1", "translations": names, "sha256": {}}
            )
        )
        with pytest.raises(ValueError):
            seed["verify_inputs"](tmp_path)


def test_dirty_snapshot_digest_identifies_actual_source_bytes_without_ignored_runtime(
    seed, tmp_path
):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text("private-runtime/\n")
    (tmp_path / "source.py").write_text("first")
    before = seed["source_tree_digest"](tmp_path)
    (tmp_path / "private-runtime").mkdir()
    (tmp_path / "private-runtime" / "credentials.json").write_text("private")
    assert seed["source_tree_digest"](tmp_path) == before
    (tmp_path / "source.py").write_text("second")
    assert seed["source_tree_digest"](tmp_path) != before


def test_snapshot_identity_is_explicit_and_requires_a_sha256(seed):
    cfg = config(seed, snapshot_sha256="c" * 64)
    assert cfg["snapshot_sha256"] == "c" * 64
    with pytest.raises(ValueError):
        config(seed, snapshot_sha256="main")


def test_candidate_image_requires_both_base_revision_and_exact_dirty_snapshot(seed):
    cfg = config(seed, snapshot_sha256="c" * 64)
    image = {
        "Config": {
            "Labels": {
                "org.opencontainers.image.revision": cfg["source_sha"],
                "org.opencontainers.image.source-snapshot-sha256": cfg[
                    "snapshot_sha256"
                ],
            }
        }
    }
    seed["require_image_identity"](cfg, image)
    image["Config"]["Labels"]["org.opencontainers.image.source-snapshot-sha256"] = (
        "d" * 64
    )
    with pytest.raises(ValueError, match="snapshot"):
        seed["require_image_identity"](cfg, image)


def test_full_hpo_builder_regenerates_bundle_profile_and_translation_inventory_offline(
    seed, tmp_path
):
    import shutil

    import ontospan

    builder = runpy.run_path(str(SCRIPT.with_name("prepare_full_hpo_acceptance.py")))
    source = tmp_path / "sources"
    source.mkdir()
    fixtures = SCRIPT.parents[1] / "tests/fixtures"
    (source / "hp.json").write_bytes((fixtures / "hp.json").read_bytes() + b"\n")
    for name in ["hp-de.babelon.tsv", "hp-es.babelon.tsv"]:
        shutil.copyfile(fixtures / name, source / name)

    def descriptor(name):
        return {"filename": name, "sha256": seed["digest"](source / name)}

    manifest = {
        "schema": "ontotator-full-hpo-sources/v1",
        "release": "2026-06-23",
        "ontology": descriptor("hp.json"),
        "translations": [
            descriptor("hp-de.babelon.tsv"),
            descriptor("hp-es.babelon.tsv"),
        ],
    }
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(json.dumps(manifest))
    output = tmp_path / "new-inputs"
    builder["prepare_inputs"](source, output, source_manifest)
    generated = seed["verify_inputs"](output)
    profile = json.loads((output / "profile.json").read_text())
    assert profile["profile_id"] == "full-hpo-acceptance/v1"
    assert profile["ontologies"][0]["sha256"] == descriptor("hp.json")["sha256"]
    _, units = ontospan.read_bundle(output / "demo.zip")
    assert len(units) == 6
    assert all(
        layer.ontology.sha256 == descriptor("hp.json")["sha256"]
        for unit in units
        for layer in unit.annotation_set.layers
    )
    assert generated["translations"] == ["hp-de.babelon.tsv", "hp-es.babelon.tsv"]
    assert (output / "demo.zip").read_bytes() != (
        SCRIPT.parents[1] / "examples/acceptance/demo.zip"
    ).read_bytes()
    with pytest.raises(ValueError, match="exists"):
        builder["prepare_inputs"](source, output, source_manifest)


def test_compose_adapter_keeps_explicit_identity_and_overrides_ambient_ports(
    seed, tmp_path, monkeypatch
):
    cfg = config(seed)
    monkeypatch.setenv("ONTOTATOR_DEV_PORT", "9999")
    monkeypatch.setenv("GITHUB_TOKEN_FILE", "unrelated-private-token")
    cfg.update(
        base_compose="checked-out-base.yml",
        override="immutable-image.json",
        env_file="run.env",
    )
    cfg["environment"] = seed["compose_environment"](cfg, tmp_path)
    stack = seed["Stack"](cfg)
    assert stack.command == [
        "docker",
        "compose",
        "--project-name",
        cfg["project"],
        "--env-file",
        "run.env",
        "-f",
        "checked-out-base.yml",
        "-f",
        "immutable-image.json",
    ]
    assert stack.env["ONTOTATOR_DEV_PORT"] == "18080"
    assert stack.env["GITHUB_TOKEN_FILE"] == str(tmp_path / "unused-build-token")
    assert stack.env["ONTOTATOR_MIGRATE_TARGET"] == "head"


def test_private_files_cannot_overwrite_an_existing_attempt(seed, tmp_path):
    path = tmp_path / "credentials.json"
    seed["write_private"](path, {"test": "first"})
    with pytest.raises(FileExistsError):
        seed["write_private"](path, {"test": "replacement"})
    assert '"first"' in path.read_text()


def test_command_failure_never_exposes_captured_setup_code(seed, monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], 1, stdout=b"private-code", stderr=b"private-code"
        ),
    )
    with pytest.raises(RuntimeError) as error:
        seed["checked"](["docker", "compose"], env={})
    assert "private-code" not in str(error.value)


def test_existing_attempt_refuses_before_docker_or_network(seed, tmp_path, monkeypatch):
    (tmp_path / "seed-started.json").write_text("{}")
    globals_ = seed["seed"].__globals__
    monkeypatch.setitem(
        globals_, "load_prepared", lambda directory: {"directory": str(tmp_path)}
    )

    def forbidden(*args, **kwargs):
        pytest.fail(
            "No Docker or network operation may run on an existing seed attempt"
        )

    monkeypatch.setitem(globals_, "Stack", forbidden)
    with pytest.raises(ValueError, match="already attempted"):
        seed["seed"](tmp_path)


class FakeApi:
    def __init__(self, settings):
        self.settings = settings
        self.calls = []

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "PATCH":
            self.settings = self.settings | body
        return self.settings


def shipped_profile():
    root = Path(__file__).resolve().parents[1] / "examples" / "acceptance"
    return json.loads((root / "profile.json").read_text(encoding="utf-8"))


def test_seed_plan_sets_the_clinical_creation_defaults(seed):
    assert "ensure_creation_defaults" in seed["seed"].__code__.co_names
    api = FakeApi(
        {
            "profile": shipped_profile(),
            "creation_defaults": {},
            "hidden_axis_values": {},
        }
    )
    assert seed["ensure_creation_defaults"](api) is True
    patches = [call for call in api.calls if call[0] == "PATCH"]
    assert patches == [
        (
            "PATCH",
            "/api/v1/projects/acceptance/settings",
            {"creation_defaults": api.settings["creation_defaults"]},
        )
    ]
    for kinds in api.settings["creation_defaults"].values():
        for values in kinds.values():
            assert values == {
                "assertion": "present",
                "experiencer": "patient",
                "temporality": "current",
            }


def test_creation_defaults_are_idempotent_on_an_existing_project(seed):
    api = FakeApi(
        {
            "profile": shipped_profile(),
            "creation_defaults": {},
            "hidden_axis_values": {},
        }
    )
    seed["ensure_creation_defaults"](api)
    api.calls.clear()
    assert seed["ensure_creation_defaults"](api) is False
    assert [call[0] for call in api.calls] == ["GET"]


def test_seed_defaults_match_the_server_rule(seed):
    from ontotator.domain.profiles import TaskProfile
    from ontotator.projects.service import clinical_creation_defaults

    profile = shipped_profile()
    hidden = {"hpo-layer": {"temporality": ["current"]}}
    assert seed["clinical_creation_defaults"](profile, hidden) == (
        clinical_creation_defaults(TaskProfile.model_validate(profile), hidden)
    )


def prepared_run(seed, tmp_path, monkeypatch):
    """Run the real ``prepare`` in a temporary checkout, without Git or Docker."""
    root = tmp_path / "checkout"
    root.mkdir()
    base = SCRIPT.parents[1] / "docker-compose.dev.yml"
    (root / "docker-compose.dev.yml").write_bytes(base.read_bytes())
    globals_ = seed["prepare"].__globals__
    monkeypatch.setitem(globals_, "ROOT", root)
    monkeypatch.setitem(
        globals_,
        "checked",
        lambda command, *, env, data=None: "" if "status" in command else "b" * 40,
    )
    directory = root / "build" / "acceptance" / "run"
    seed["prepare"](config(seed), directory)
    return directory


def test_prepare_writes_a_read_only_demo_login_override_used_after_seed_only(
    seed, tmp_path, monkeypatch
):
    directory = prepared_run(seed, tmp_path, monkeypatch)
    override = json.loads((directory / "demo-logins.override.json").read_text())
    assert override == {
        "services": {
            "app": {
                "environment": {
                    "ONTOTATOR_DEMO_LOGINS_FILE": "/run/ontotator-demo-logins.json"
                },
                "volumes": [
                    {
                        "type": "bind",
                        "source": str(directory / "demo-logins.json"),
                        "target": "/run/ontotator-demo-logins.json",
                        "read_only": True,
                        "bind": {"create_host_path": False},
                    }
                ],
            }
        }
    }
    # Absolute: a relative source would resolve against the checkout.
    assert Path(override["services"]["app"]["volumes"][0]["source"]).is_absolute()
    commands = json.loads((directory / "commands.json").read_text())
    demo = str(directory / "demo-logins.override.json")
    # The first start, which seed verifies, has no demo logins.
    assert demo not in commands["start"]
    assert commands["restart"][-6:] == ["-f", demo, "up", "-d", "--no-build", "--wait"]
    assert commands["restart"][:-6] == commands["start"][:-4]
    assert commands["host"].startswith("http://127.0.0.1:")
    # The Compose environment of every command stays without the setting.
    assert "ONTOTATOR_DEMO_LOGINS_FILE" not in (directory / "compose.env").read_text()
    identity = json.loads((directory / "identity.json").read_text())
    assert identity["demo_logins_override"] == demo
    assert seed["load_prepared"](directory)["demo_logins_override"] == demo


def test_seed_refuses_a_changed_demo_login_override(seed, tmp_path, monkeypatch):
    directory = prepared_run(seed, tmp_path, monkeypatch)
    path = directory / "demo-logins.override.json"
    changed = json.loads(path.read_text())
    changed["services"]["app"]["volumes"][0]["read_only"] = False
    path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="demo login override"):
        seed["load_prepared"](directory)


def test_demo_logins_list_the_seeded_accounts_and_the_dev_admin(seed):
    passwords = {name: f"pw-{name}" for name in seed["ACTORS"]}
    assert seed["demo_logins"](passwords) == [
        {"username": "demo-lead", "password": "pw-demo-lead", "label": "Project lead"},
        {
            "username": "demo-reviewer",
            "password": "pw-demo-reviewer",
            "label": "Translation reviewer",
        },
        {
            "username": "demo-annotator",
            "password": "pw-demo-annotator",
            "label": "Annotator",
        },
        {
            "username": "admin",
            "password": "development-only-password",
            "label": "Administrator",
        },
    ]


def test_dev_admin_demo_password_matches_the_dev_compose_hash(seed):
    from argon2 import PasswordHasher

    compose = (SCRIPT.parents[1] / "docker-compose.dev.yml").read_text()
    stored = re.search(r"ONTOTATOR_ADMIN_PASSWORD_HASH: (\S+)", compose)
    assert stored is not None
    username, password, _ = seed["BOOTSTRAP_ADMIN"]
    assert username == "admin"
    assert PasswordHasher().verify(stored.group(1).replace("$$", "$"), password)


def test_written_demo_logins_follow_the_settings_safety_rules(seed, tmp_path):
    from ontotator import settings

    path = tmp_path / "demo-logins.json"
    passwords = {name: f"pw-{name}" for name in seed["ACTORS"]}
    seed["write_private"](path, seed["demo_logins"](passwords), mode=0o644)
    env = {"ONTOTATOR_DEMO_LOGINS_FILE": str(path), "ONTOTATOR_ENV": "development"}
    logins = settings.demo_logins(env, public_origin="http://127.0.0.1:18080")
    assert [login.username for login in logins] == [
        "demo-lead",
        "demo-reviewer",
        "demo-annotator",
        "admin",
    ]
    with pytest.raises(settings.SettingsError, match="production"):
        settings.demo_logins(
            env | {"ONTOTATOR_ENV": "production"},
            public_origin="http://127.0.0.1:18080",
        )
    with pytest.raises(settings.SettingsError, match="loopback"):
        settings.demo_logins(env, public_origin="https://ontotator.example.org")


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes")
def test_demo_login_file_is_readable_by_the_container_user_whatever_the_umask(
    seed, tmp_path
):
    previous = os.umask(0o077)
    try:
        seed["write_private"](tmp_path / "demo-logins.json", [], mode=0o644)
        seed["write_private"](tmp_path / "credentials.json", {})
    finally:
        os.umask(previous)
    assert stat.S_IMODE((tmp_path / "demo-logins.json").stat().st_mode) == 0o644
    assert stat.S_IMODE((tmp_path / "credentials.json").stat().st_mode) == 0o600
    with pytest.raises(FileExistsError):
        seed["write_private"](tmp_path / "demo-logins.json", [], mode=0o644)


def test_seed_writes_demo_logins_last_and_refuses_when_they_exist(
    seed, tmp_path, monkeypatch
):
    names = seed["seed"].__code__.co_names
    assert "demo_logins" in names
    (tmp_path / "demo-logins.json").write_text("[]")
    globals_ = seed["seed"].__globals__
    monkeypatch.setitem(
        globals_, "load_prepared", lambda directory: {"directory": str(tmp_path)}
    )
    monkeypatch.setitem(
        globals_, "Stack", lambda *args: pytest.fail("No Docker on a past attempt")
    )
    with pytest.raises(ValueError, match="already attempted"):
        seed["seed"](tmp_path)
