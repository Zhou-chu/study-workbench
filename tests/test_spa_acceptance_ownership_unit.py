"""Direct verifier environment projection without starting tooling."""

import json

from spa_acceptance_contract_fixtures import helper


def test_minimal_environment_ignores_poison(monkeypatch):
    m = helper()
    for name in [
        "OPENAI_API_KEY",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "HTTP_PROXY",
        "GIT_CONFIG",
        "HOME",
    ]:
        monkeypatch.setenv(name, "PRIVATE_SENTINEL")
    env = m.verifier_environment()
    assert "PRIVATE_SENTINEL" not in json.dumps(env)
    assert env["PYTHON_DOTENV_DISABLED"] == "1"
    assert env["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert env["HOME"] == "/nonexistent"
