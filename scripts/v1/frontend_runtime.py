"""Owned writable serving copies; authoritative artifacts are never launched here.

Not a hostile same-UID filesystem transaction. The parent must stop registered
process groups and drain its exclusive child custody before remove_after_drain.
Only existing verifier-approved relative node_modules links are preserved.
"""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING or __package__:
    from .artifact_identity import verify_artifact
else:
    from artifact_identity import verify_artifact


def _plain_path(path: Path) -> Path:
    path = path.absolute()
    if ".." in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("Runtime paths must not contain links or traversal")
    return path


def _identity(path: Path) -> tuple[int, int]:
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError("Expected owned runtime directory")
    return info.st_dev, info.st_ino


def _overlap(a: Path, b: Path) -> bool:
    return a == b or a in b.parents or b in a.parents


class FrontendRuntimeCopies:
    def __init__(self, run: Path):
        self.run = _plain_path(run)
        self.run_identity = _identity(self.run)
        if stat.S_IMODE(self.run.stat().st_mode) != 0o700:
            raise ValueError("Runtime parent must be private mode700")
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError("Safe owned tree removal unavailable")
        self.copies: list[tuple[Path, tuple[int, int]]] = []

    def _check_parent(self) -> None:
        _plain_path(self.run)
        if _identity(self.run) != self.run_identity:
            raise RuntimeError("Owned runtime parent was replaced")

    def create(self, source_root: Path, artifact: Path) -> tuple[Path, dict[str, Any]]:
        self._check_parent()
        source_root, artifact = _plain_path(source_root), _plain_path(artifact)
        if (
            _overlap(self.run, artifact)
            or _overlap(self.run, source_root)
            or _overlap(source_root, artifact)
        ):
            raise ValueError("Runtime, source and artifact must not overlap")
        _identity(artifact)
        identity = verify_artifact(source_root, artifact)
        runtime = Path(tempfile.mkdtemp(prefix="frontend-runtime-", dir=self.run))
        self.copies.append((runtime, _identity(runtime)))
        # Keep partial copies registered on every failure, for parent drain-first cleanup.
        self._copy_tree(artifact, runtime, artifact)
        if verify_artifact(source_root, runtime) != identity:
            raise RuntimeError("Runtime copy failed complete artifact verification")
        if verify_artifact(source_root, artifact) != identity:
            raise RuntimeError("Authoritative artifact changed during copying")
        self._check_parent()
        return runtime, identity

    def _copy_tree(self, source: Path, target: Path, artifact: Path) -> None:
        for item in sorted(source.iterdir()):
            destination = target / item.name
            info = item.lstat()
            if info.st_uid != os.getuid():
                raise ValueError("Artifact entries must be owned")
            if stat.S_ISLNK(info.st_mode):
                relative = item.relative_to(artifact)
                link = os.readlink(item)
                if (
                    relative.parts[0] != "node_modules"
                    or os.path.isabs(link)
                    or not item.resolve(strict=True).is_relative_to(
                        artifact / "node_modules"
                    )
                ):
                    raise ValueError("Only internal relative dependency links allowed")
                destination.symlink_to(link)
            elif stat.S_ISDIR(info.st_mode):
                destination.mkdir(mode=0o700)
                self._copy_tree(item, destination, artifact)
            elif stat.S_ISREG(info.st_mode):
                if info.st_nlink != 1:
                    raise ValueError("Hard-linked artifact entries rejected")
                fd = os.open(item, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    opened = os.fstat(fd)
                    if (
                        not stat.S_ISREG(opened.st_mode)
                        or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino)
                        or opened.st_nlink != 1
                    ):
                        raise ValueError("Artifact entry changed before copy")
                    with os.fdopen(fd, "rb", closefd=False) as src:
                        with destination.open("xb") as dst:
                            shutil.copyfileobj(src, dst)
                    destination.chmod(0o600 | (info.st_mode & 0o111))
                finally:
                    os.close(fd)
            else:
                raise ValueError("Special artifact entries rejected")

    def remove_after_drain(self) -> None:
        """Call only after successful owned group stop AND descendant drain.

        No process signalling or speculative deletion occurs in this helper.
        Uncertain cleanup must leave copies registered and preserved.
        """
        self._check_parent()
        for root, identity in self.copies:
            _plain_path(root)
            if root.parent != self.run or _identity(root) != identity:
                raise RuntimeError("Owned runtime copy was replaced")
        while self.copies:
            root, _ = self.copies[0]
            shutil.rmtree(root)
            self.copies.pop(0)
