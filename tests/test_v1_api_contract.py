"""Offline contract snapshot and public synthetic runtime examples (not new models)."""

import json
import os
import subprocess
import sys

from v1_api_contract_fixtures import CONTRACT, EXPORTER, ROOT


def export(*args, cwd=None, env=None):
    return subprocess.run(
        [sys.executable, "-B", str(EXPORTER), *args],
        cwd=cwd or ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
    )


def test_snapshot_matches_actual_app_from_arbitrary_cwd(tmp_path):
    before = CONTRACT.stat()
    result = export("--check", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert CONTRACT.stat().st_mtime_ns == before.st_mtime_ns
    assert list(tmp_path.iterdir()) == []


def test_export_is_deterministic_and_ignores_ambient_configuration(tmp_path):
    output = tmp_path / "schema.json"
    env = {
        **os.environ,
        "OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB": "invalid",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE": "/must/not/read",
        "OPEN_NOTEBOOK_DATA_DIR": str(tmp_path / "must-not-create"),
        "PYTHON_DOTENV_DISABLED": "0",
    }
    (tmp_path / ".env").write_text("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB=invalid\n")
    result = export("--output", str(output), cwd=tmp_path, env=env)
    assert result.returncode == 0, result.stderr
    assert output.read_bytes() == CONTRACT.read_bytes()
    assert not (tmp_path / "must-not-create").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == [".env", "schema.json"]


def test_export_disables_dotenv_on_actual_app_discovery_path(tmp_path):
    import shutil

    # Copy only the exporter into an isolated minimal repository. No developer
    # .env is opened or changed; api.main's normal dotenv discovery reaches this
    # synthetic repository-root .env when loading is enabled.
    root = tmp_path / "synthetic_repo"
    script = root / "scripts" / "v1" / "export_contract.py"
    script.parent.mkdir(parents=True)
    shutil.copyfile(EXPORTER, script)
    api = root / "api"
    api.mkdir()
    (api / "__init__.py").write_text("")
    (root / ".env").write_text("CONTRACT_SYNTHETIC_DOTENV_POISON=loaded\n")
    (api / "main.py").write_text(
        "import os\n"
        "from dotenv import load_dotenv\n"
        "from fastapi import FastAPI\n"
        "load_dotenv()\n"
        "assert not os.getenv('CONTRACT_SYNTHETIC_DOTENV_POISON'), 'synthetic dotenv loaded'\n"
        "app = FastAPI(title='Synthetic dotenv isolation test')\n"
    )
    # Positive control: prove the poison really is discoverable from api.main,
    # rather than merely planting a file outside dotenv's search path.
    control = subprocess.run(
        [sys.executable, "-B", "-c", "import api.main"],
        cwd=root,
        env={"PYTHON_DOTENV_DISABLED": "0"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert control.returncode != 0
    assert "synthetic dotenv loaded" in control.stderr
    result = subprocess.run(
        [sys.executable, "-B", str(script)],
        cwd=tmp_path,
        env={"PYTHON_DOTENV_DISABLED": "0"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stderr
    schema = json.loads((root / "contracts/v1/openapi.json").read_text())
    assert schema["info"]["title"] == "Synthetic dotenv isolation test"


def test_check_drift_and_missing_snapshot_never_write(tmp_path):
    output = tmp_path / "schema.json"
    output.write_text("{}\n")
    before = output.stat()
    result = export("--check", "--output", str(output), cwd=tmp_path)
    assert result.returncode == 1
    assert "drift" in result.stderr.lower()
    assert output.read_text() == "{}\n"
    assert output.stat().st_mtime_ns == before.st_mtime_ns
    missing = tmp_path / "absent" / "schema.json"
    result = export("--check", "--output", str(missing), cwd=tmp_path)
    assert result.returncode == 1
    assert not missing.parent.exists()


def test_export_child_guards_network_and_disk(tmp_path):
    code = """
import runpy, socket, pathlib
module = runpy.run_path(EXPORTER)
module['_schema']()
for action in (lambda: socket.create_connection(('127.0.0.1', 1)), lambda: pathlib.Path(TARGET).write_text('unexpected')):
    try:
        action()
    except RuntimeError:
        pass
    else:
        raise AssertionError('export guard allowed side effect')
""".replace("EXPORTER", repr(str(EXPORTER))).replace(
        "TARGET", repr(str(tmp_path / "forbidden"))
    )
    result = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=tmp_path,
        env={"PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stderr
    assert list(tmp_path.iterdir()) == []
