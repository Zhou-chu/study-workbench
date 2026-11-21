"""Explicit hosted-CI preparation, never called by the offline test runners.

Only fixed HTTPS artifacts are fetched. Git is built from checked source under
an exclusive OS-account-home prefix; the resulting digest is a build receipt,
not a vendor binary signature. No sudo, system package install, or PATH Git trust.
"""

import hashlib
import io
import os
import posixpath
import pwd
import stat
import subprocess
import tarfile
import urllib.request
import uuid
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
GIT_VERSION = "2.56.1"
GIT_URL = "https://www.kernel.org/pub/software/scm/git/git-2.56.1.tar.xz"
GIT_SHA256 = "f0b0bf89264b9bd2e1c640363e7529643989da76281600473c50745cd34a607f"
TOKEN_URL = "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken"
TOKEN_NAME = "fb374d419588a4632f3f557e76b4b70aebbca790"
TOKEN_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
MAX_DOWNLOAD = 32 * 1024 * 1024


def verify_bytes(contents: bytes, expected: str, limit: int) -> bytes:
    if len(contents) > limit or hashlib.sha256(contents).hexdigest() != expected:
        raise ValueError("Downloaded artifact size or SHA256 mismatch")
    return contents


def download(url: str, expected: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("HTTPS required")
    with urllib.request.urlopen(url, timeout=60) as response:
        if not response.geturl().startswith("https://"):
            raise ValueError("HTTPS redirect required")
        data = response.read(MAX_DOWNLOAD + 1)
    return verify_bytes(data, expected, MAX_DOWNLOAD)


def check_custody(path: Path) -> None:
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("Canonical absolute account path required")
    for item in (path, *path.parents):
        info = item.lstat()
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid not in (0, os.getuid())
            or info.st_mode & 0o022
        ):
            raise ValueError("Untrusted account path custody")


def create_owned(path: Path) -> None:
    path.mkdir(mode=0o700)  # Exclusive; do not reuse or repair existing contents.


def extract_source(data: bytes, destination: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
        members = archive.getmembers()
        seen = set()
        total = 0
        if len(members) > 50000:
            raise ValueError("Oversized source member set")
        for member in members:
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not path.parts
                or path.parts[0] != "git-" + GIT_VERSION
                or not (member.isfile() or member.isdir() or member.issym())
                or member.name in seen
            ):
                raise ValueError("Unsafe source archive member")
            if member.issym():
                target = PurePosixPath(member.linkname)
                combined = PurePosixPath(posixpath.normpath(str(path.parent / target)))
                if (
                    target.is_absolute()
                    or not combined.parts
                    or combined.parts[0] != "git-" + GIT_VERSION
                ):
                    raise ValueError("Unsafe source archive link")
            seen.add(member.name)
            total += member.size
        if total > 200 * 1024 * 1024:
            raise ValueError("Oversized expanded source")
        archive.extractall(destination, filter="data")


def prepare(home: Path, node: Path) -> tuple[Path, Path]:
    check_custody(home)
    work = home / (".notebook-ci-tools-" + uuid.uuid4().hex)
    create_owned(work)
    token = work / "tokenizer"
    create_owned(token)
    (token / TOKEN_NAME).write_bytes(download(TOKEN_URL, TOKEN_SHA256))
    extract_source(download(GIT_URL, GIT_SHA256), work)
    install = work / "git"
    create_owned(install)
    flags = [
        "prefix=" + str(install),
        "NO_CURL=YesPlease",
        "NO_EXPAT=YesPlease",
        "NO_GETTEXT=YesPlease",
        "NO_PERL=YesPlease",
        "NO_TCLTK=YesPlease",
        "NO_OPENSSL=YesPlease",
        "NO_RUST=YesPlease",
    ]
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home), "LANG": "C.UTF-8"}
    source = work / ("git-" + GIT_VERSION)
    for target in ([], ["install"]):
        subprocess.run(
            ["/usr/bin/make", "-j2", *flags, *target], cwd=source, env=env, check=True
        )
    binary = install / "bin/git"
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    subprocess.run(
        [
            str(node),
            str(ROOT / "scripts/coverage-git-provision.mjs"),
            str(binary),
            str(install),
            digest,
        ],
        cwd=ROOT,
        check=True,
    )
    # Do not call an ambient Git to validate or anchor the installation.
    subprocess.run(
        [str(binary), "--no-lazy-fetch", "rev-parse", "HEAD"],
        cwd=ROOT,
        env=env,
        check=True,
    )
    (work / "build-receipt.txt").write_text(
        f"source_url={GIT_URL}\nsource_sha256={GIT_SHA256}\nbinary_sha256={digest}\n"
    )
    return binary.parent, token


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", type=Path, required=True)
    options = parser.parse_args()
    if not options.node.is_absolute() or not options.node.is_file():
        parser.error("Explicit absolute setup-node executable required")
    if os.environ.get("GITHUB_ACTIONS") != "true":
        parser.error("Preparation is only for an explicit hosted GitHub job")
    # Ignore HOME overrides; matches the coverage registration trust anchor.
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    git_bin, token = prepare(home, options.node)
    for variable, line in [
        ("GITHUB_PATH", str(git_bin)),
        ("GITHUB_ENV", "NOTEBOOK_TOKEN_CACHE=" + str(token)),
    ]:
        if "\n" in line or "\r" in line:
            raise ValueError("Invalid generated environment path")
        with Path(os.environ[variable]).open("a") as output:
            output.write(line + "\n")


if __name__ == "__main__":
    main()
