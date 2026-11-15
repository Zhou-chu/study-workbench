"""Filesystem and CLI integration contracts; no actual cutover."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from spa_cutover_plan_fixtures import (
    OUTPUT_KEYS,
    canon,
    preparation_inputs,
    staged_inputs,
)

from scripts.v1 import spa_cutover_plan as planner


def cli(tmp_path, inputs, extra=()):
    paths = []
    for name in ("candidate", "current", "acceptance"):
        path = tmp_path / (name + ".json")
        path.write_bytes(canon(inputs[name]))
        paths.extend(["--" + name, str(path)])
    return subprocess.run(
        [
            sys.executable,
            "-B",
            str(Path(__file__).resolve().parents[1] / "scripts/v1/spa_cutover_plan.py"),
            *paths,
            *extra,
        ],
        cwd=tmp_path,
        env={"PATH": os.defpath, "PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_reader_returns_json_without_following_record_locators(tmp_path):
    path = tmp_path / "input.json"
    path.write_text('{"record":{"id":"not-a-path","sha256":"' + "a" * 64 + '"}}')
    assert planner.load_input(path) == {
        "record": {"id": "not-a-path", "sha256": "a" * 64}
    }


@pytest.mark.parametrize(
    "payload",
    [
        b'{"outer":{"same":1,"same":2}}',
        b'{"value":NaN}',
        b'{"value":Infinity}',
        b"\xef\xbb\xbf{}",
        b'{"value":"\xff"}',
        b'{"value":' + b"[" * 17 + b"0" + b"]" * 17 + b"}",
        b" " * (1024 * 1024) + b"{}",
        b'{"value":"' + b"x" * 513 + b'"}',
    ],
)
def test_reader_rejects_malformed_or_unbounded_bytes(tmp_path, payload):
    path = tmp_path / "input.json"
    path.write_bytes(payload)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_accepts_exact_raw_byte_limit(tmp_path):
    path = tmp_path / "input.json"
    path.write_bytes(b"{}" + b" " * (1024 * 1024 - 2))
    assert planner.load_input(path) == {}


def test_reader_rejects_symlink_file_and_ancestor(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    target = real / "input.json"
    target.write_text("{}")
    file_link = tmp_path / "file-link"
    file_link.symlink_to(target)
    directory_link = tmp_path / "directory-link"
    directory_link.symlink_to(real, target_is_directory=True)
    for path in (file_link, directory_link / "input.json"):
        with pytest.raises(ValueError, match="Invalid input"):
            planner.load_input(path)


def test_reader_rejects_fifo_without_blocking(tmp_path):
    path = tmp_path / "pipe"
    os.mkfifo(path)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_rejects_directory_and_missing_path(tmp_path):
    for path in (tmp_path, tmp_path / "missing-private-name"):
        with pytest.raises(ValueError) as error:
            planner.load_input(path)
        assert str(error.value) == "Invalid input"


def test_reader_rejects_traversal_without_resolving_it(tmp_path):
    target = tmp_path / "input.json"
    target.write_text("{}")
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(str(tmp_path) + "/../" + tmp_path.name + "/input.json")


def test_reader_checks_depth_inside_json_not_quoted_punctuation(tmp_path):
    path = tmp_path / "input.json"
    value = {"text": "[" * 30 + '"' + "}" * 30}
    path.write_text(json.dumps(value))
    assert planner.load_input(path) == value


def test_reader_reads_one_regular_descriptor_once(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    reads = []
    original_read = os.read

    def counted(fd, size):
        reads.append((fd, size))
        return original_read(fd, size)

    monkeypatch.setattr(planner.s.os, "read", counted)
    assert planner.load_input(path) == {}
    assert len({fd for fd, _ in reads}) == 1
    assert sum(size for _, size in reads) <= 1024 * 1024 + 1


def test_reader_does_not_open_an_input_for_write(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    original_open = os.open
    calls = []

    def checked(path, flags, *args, **kwargs):
        calls.append(flags)
        assert flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC) == 0
        return original_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(planner.s.os, "open", checked)
    assert planner.load_input(path) == {}
    assert calls


def test_reader_requires_safe_nofollow_support(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    monkeypatch.delattr(planner.s.os, "O_NOFOLLOW")
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_direct_cli_is_cwd_independent_and_returns_structural_zero_only(tmp_path):
    result = cli(tmp_path, staged_inputs())
    assert result.returncode == 0
    assert result.stderr == ""
    output = json.loads(result.stdout)
    assert set(output) == OUTPUT_KEYS
    assert output["candidate"]["evidence_basis"] == "unit-fixture"


def test_cli_distinguishes_schema_blockers_from_malformed_input(tmp_path):
    result = cli(tmp_path, preparation_inputs())
    assert result.returncode == 1 and result.stderr == ""
    result = cli(tmp_path, {"candidate": {}, "current": {}, "acceptance": {}})
    assert result.returncode == 1
    assert json.loads(result.stdout)["blockers"] == ["INPUT_SCHEMA_INVALID"]


@pytest.mark.parametrize(
    "extra",
    [("--force",), ("--execute",), ("--cand", "x"), ("--unknown-private-path",)],
)
def test_cli_never_accepts_force_execution_or_abbreviated_flags(tmp_path, extra):
    result = cli(tmp_path, preparation_inputs(), extra)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "unknown-private-path" not in result.stderr
    assert str(tmp_path) not in result.stderr


def test_reader_detects_an_input_changed_during_its_single_read(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    original = os.read

    def changing(fd, count):
        content = original(fd, count)
        path.write_text('{"changed":true}')
        return content

    monkeypatch.setattr(planner.s.os, "read", changing)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_allows_sixteen_container_levels_but_not_seventeen(tmp_path):
    path = tmp_path / "nested.json"
    path.write_text("[" * 16 + "0" + "]" * 16)
    assert planner.load_input(path)
    path.write_text("[" * 17 + "0" + "]" * 17)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_fresh_import_is_inert(tmp_path):
    root = str(Path(__file__).resolve().parents[1])
    program = (
        "import sys, argparse, hashlib, json, os, re, stat, datetime, typing, socket, time, builtins\n"
        + "sys.path.insert(0, "
        + repr(root)
        + ")\n"
        + "def deny(*a, **k): raise AssertionError('Forbidden import side effect')\n"
        + "os.open = os.getenv = socket.socket = time.time = builtins.open = deny\n"
        + "from scripts.v1 import spa_cutover_plan\n"
        + "assert callable(spa_cutover_plan.make_cutover_plan)\nprint('import-safe')\n"
    )
    result = subprocess.run(
        [sys.executable, "-B", "-c", program],
        cwd=tmp_path,
        env={"PATH": os.defpath, "PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "import-safe\n"
    assert list(tmp_path.iterdir()) == []


def test_cli_help_is_not_a_plan_or_execution(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(Path(__file__).resolve().parents[1] / "scripts/v1/spa_cutover_plan.py"),
            "--help",
        ],
        cwd=tmp_path,
        env={"PATH": os.defpath},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0 and "Structural dry-run only" in result.stdout
    assert result.stderr == ""
