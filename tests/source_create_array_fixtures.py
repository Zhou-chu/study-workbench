"""Pure source-array fixtures shared between schema and HTTP tests."""


def make_ids(n, prefix):
    return [f"{prefix}:{i}" for i in range(n)]
