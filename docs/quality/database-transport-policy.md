# Database transport policy (isolated candidate)

Not deployed or runtime-accepted. No database was opened for these checks.

## Policy and compatibility
Explicit SURREAL_URL retains precedence over legacy SURREAL_ADDRESS/SURREAL_PORT.
All paths reach the same validator before SDK construction or signin.
Remote network endpoints require wss/https. Plaintext ws/http defaults are allowed
only for exact localhost, IPv4 literal loopback, and IPv6 ::1. No DNS resolution
or implicit RFC1918/Docker-network trust occurs.

SURREAL_INSECURE_ALLOW_URL accepts one exact endpoint string, not a boolean,
wildcard, hostname or prefix. Empty is the default. It cannot bypass syntax
validation. This explicit opt-out **does not encrypt traffic**: credentials,
documents and queries may be observed/changed on that link. Residual risk must
not be reported as resolved merely because a scanner stops flagging it.

Userinfo, controls/whitespace, backslashes, query/fragment, missing host, invalid
ports and ambiguous numeric/encoded hosts are rejected. Errors never include the
URL or parser exception; credentials remain in separate supported variables.
TLS verification is not disabled. Loopback is a local trust assumption, not TLS.

## Embedded boundary
Pinned installed SDK AsyncSurreal dispatches mem, memory, file and surrealkv.
tests/test_text_search_parent.py already directly uses mem://. No production
repository embedded deployment was found. Preserve mem:// and memory:// and
nonempty file:// or surrealkv:// paths without opening them. Bare memory is NOT
accepted by the installed Url parser (despite its error-message suggestion).
Other schemes remain rejected. The SDK passes the original URL directly to AsyncEmbeddedDB. We do not claim
that file://host is a network URL protected by TLS or that its path semantics
are enforced here. These schemes invoke the SDK embedded-storage capability.
Embedded paths are operator configuration, not a
user-controlled file API; this is not an assertion of runtime DB compatibility.

## Docker candidate
deploy/v1/compose.yaml now requires explicit SURREAL_URL; its unsafe exception is
empty unless independently set. entrypoint uses the same validator and converts
configuration failures to sanitized CLI errors before exec.
The bundled db command has NO TLS. ws://db:8000/rpc therefore fails closed by
default, intentionally. Operators must provision a real TLS endpoint, or explicitly
set both SURREAL_URL and SURREAL_INSECURE_ALLOW_URL to that identical plaintext
endpoint after accepting its risk. No checked-in default does this. Merely changing
the scheme to wss is not a TLS setup. Existing plaintext multi-container examples
need this explicit decision; single-machine loopback examples remain compatible.
The candidate still waits for bundled db health, and is not a turnkey external-DB
deployment. A complete TLS topology and runtime gate remain separate work.

## Verification
Offline tests cover precedence/fallback, IPv6/ports, remote rejection, TLS
preservation, exact opt-out, malformed URLs with opt-out, embedded preservation,
rejection before SDK construction, and standalone sanitized CLI failures.
No real env, service, Docker runtime, database, credentials or v2 envelope changed.
