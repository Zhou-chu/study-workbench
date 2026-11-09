# Third-party notices for the C1 source packaging recipes

These recipes select official nginx 1.30.6-trixie and Node 24.22.2-bookworm-slim by immutable OCI **index** digest. Metadata provenance was read from official repositories on 2026-11-09. Index digests are not platform manifests or image configuration IDs.

- nginx:1.30.6-trixie@sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703
- node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

Immutable provenance:
- https://github.com/docker-library/repo-info/blob/718eaa071df33d5c4593b4c6f607c61a38fa1629/repos/nginx/remote/1.30.6-trixie.md
- https://github.com/nginx/docker-nginx/blob/4b9f658be76820b24e4ef4605413a5c08707a512/stable/debian/Dockerfile
- https://github.com/docker-library/repo-info/blob/2f7c5332eb93703b701c73be9e87e8d8135a1ddf/repos/node/remote/24.22.2-bookworm-slim.md
- https://github.com/nodejs/docker-node/blob/e994dfe115899a82684caa7533380aa7d439aae1/24/bookworm-slim/Dockerfile

Full copied license bytes appear in licenses/nginx.LICENSE, licenses/docker-nginx.LICENSE, licenses/node.LICENSE and licenses/docker-node.LICENSE. Node's LICENSE includes all its bundled third-party notices, not just its leading MIT section. The wrapper projects' separate notices are included explicitly.

Each recipe copies these additional accompanying notices without removing or rewriting inherited component notices. Debian, nginx modules, libraries and tools have their own licenses; the entire image is NOT described as solely BSD or MIT. Upstream packaging source suggests /usr/share/doc/nginx/copyright and /usr/local/LICENSE, but their actual contents in the selected image were NOT inspected. Image filesystem/license inclusion and full binary redistribution compliance remain later verification gates.

No image/binary/dependency was downloaded, installed, pulled, built or run for C1. Official metadata does not prove current registry availability. Local prepared Node 24.19.0 source checks are not execution tests of pinned Node 24.22.2. No vulnerability-free or reproducible-build claim is made. Digest-pinned Debian packages do not receive future fixes automatically.

## Exact public license sources and measured bytes

- nginx: 1319 bytes; SHA-256 08845fe39e06b51dad7685c28140ab49577a86e947523e16b536a46caf89ad5c.
  Source: https://github.com/nginx/nginx/blob/release-1.30.6/LICENSE
  Immutable Git blob: https://api.github.com/repos/nginx/nginx/git/blobs/4366554533723cee5e155e317b0eb014867c1f0a
- docker-nginx: 1280 bytes; SHA-256 5e01e80542c4ee1c1640501bea5bd55e1e2174034343b45e228465c300ce5158.
  Source: https://github.com/nginx/docker-nginx/blob/4b9f658be76820b24e4ef4605413a5c08707a512/LICENSE
  Immutable Git blob: https://api.github.com/repos/nginx/docker-nginx/git/blobs/f5af4aac941d424e0c39ca861e5d909516428a18
- node: 157609 bytes; SHA-256 5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace.
  Source: https://github.com/nodejs/node/blob/v24.22.2/LICENSE
  Immutable Git blob: https://api.github.com/repos/nodejs/node/git/blobs/9cc3315dd388a004c225620b30c5806bba3151d5
- docker-node: 1119 bytes; SHA-256 782e17d54343aa3f6db60430015692b6540089b3ec5b78274981ada2d3c3c423.
  Source: https://github.com/nodejs/docker-node/blob/e994dfe115899a82684caa7533380aa7d439aae1/LICENSE
  Immutable Git blob: https://api.github.com/repos/nodejs/docker-node/git/blobs/6ad4fb741f23ca2e3b39392100804187b76d67b2
