"""Third-party template compatibility and an actual temporary Jinja fixture."""

from pathlib import Path

import pytest

PROMPTS_DIR = Path(__file__).parent.parent / "prompts" / "podcast"


class TestNoDriftFromBundledTemplates:
    """The app's copies shadow podcast-creator's, so library prompt work is
    invisible here. The language block was lost exactly this way. Fail when a
    variable the bundled template uses is missing from the app's copy."""

    # Operators and literals a condition can open with: `{% if not language %}`
    # names no variable called "not".
    JINJA_KEYWORDS = frozenset(
        {"not", "and", "or", "is", "in", "if", "else", "true", "false", "none"}
    )

    @classmethod
    def _variables(cls, path: Path) -> set:
        # Jinja's own parser finds every variable the template reads, including
        # `for` iterables and filter arguments; loop locals and `set` targets
        # are declared, so they are excluded.
        from jinja2 import Environment, meta

        ast = Environment().parse(path.read_text())
        return set(meta.find_undeclared_variables(ast)) - cls.JINJA_KEYWORDS

    def test_jinja_keywords_are_not_treated_as_variables(self):
        """`{% if not language %}` names no variable called "not" - counting it
        would fail the drift check the moment one template negates a test the
        other doesn't."""
        assert "not" not in self._variables(PROMPTS_DIR / "transcript.jinja")

    @pytest.mark.parametrize("template", ["transcript", "outline"])
    def test_app_template_uses_every_bundled_variable(self, template):
        import podcast_creator

        bundled = (
            Path(podcast_creator.__file__).parent
            / "resources"
            / "prompts"
            / "podcast"
            / f"{template}.jinja"
        )
        missing = self._variables(bundled) - self._variables(
            PROMPTS_DIR / f"{template}.jinja"
        )
        assert not missing, (
            f"prompts/podcast/{template}.jinja shadows podcast-creator's copy "
            f"but ignores {sorted(missing)}. Either use them or delete the "
            "app template so the library's is used."
        )


def test_drift_check_sees_for_iterables(tmp_path):
    """A variable used only as a `for` iterable still counts (cubic, #1334)."""
    template = tmp_path / "t.jinja"
    template.write_text("{% for item in new_input %}{{ item }}{% endfor %}")
    assert TestNoDriftFromBundledTemplates._variables(template) == {"new_input"}
