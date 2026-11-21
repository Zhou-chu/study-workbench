"""Check analyzable source shape for the pinned KDF salt declaration."""

from open_notebook.utils import encryption as enc


def test_salt_declaration_remains_analyzable():
    """Sonar Python 5.32 S2053 requires an ordinary assignment location."""
    import ast
    from pathlib import Path

    tree = ast.parse(Path(enc.__file__).read_text(), type_comments=True)
    assignments = [
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "PBKDF2_SALT"
            for target in node.targets
        )
    ]
    assert len(assignments) == 1
    assert ast.literal_eval(assignments[0].value) == b"open-notebook-credential-v1"
