# Body-size middleware strict-unit split

Baseline: `5acfcc2`. No production implementation, source inventory, threshold,
or runtime configuration changed. The classification manifest is not edited.

## Reviewed boundary

Moved unchanged: TestConfig (4 cases), TestMiddlewareAsgiLevel (7 cases),
test_portable_route_budget_stream_and_header (3 parameterized cases), and
test_portable_override_is_exact_route_only (4 parameterized cases).
These 18 cases call the real config function or MaxBodySizeMiddleware with
synthetic in-memory scope/receive/send and inner application. No real ASGI
framework pipeline, HTTP client, database, network, subprocess, or spool/file
operation participates. Starlette Headers is an internal pure protocol helper.
Environment configuration is synthetic and isolated with monkeypatch.

Original file remains **mixed**: real CORS/auth middleware composition, registered
FastAPI wiring, TestClient requests and multipart spooled-file lifecycle are not
strict unit. Residual portable-limit/route checks were not promoted in this batch.
Shared synthetic fixtures were copied rather than importing the mixed test module.

## Lossless verification

- Original complete file: 40 passed, 2 dependency deprecation warnings, 4.49s.
- Split original + new file: 40 passed, same 2 warnings, 2.80s.
- New pure file alone: 18 passed, 0.11s, no mixed-module preloading requirement.
- Collection: 40 -> 40; normalizing only the moved file name gives identical
  complete parameterized node-ID sets (18 new-file, 22 remaining-file).
- All 26 test definition ASTs, including decorators, parameter values, function
  bodies and assertions, match the original. 13 definitions moved. Verification
  was repeated after Ruff formatting. No test assertion or parameter was removed.
- Ruff check/format and git diff --check passed. No full coverage run or whole-
  project >90% claim is made; this restores already-existing evidence to the
  appropriate strict-unit selection without shrinking the production denominator.

Evidence: `/home/USER/notebook-quality-20261113/python/body-split-` followed by
`before-collection.log`, `after-collection.log`, `before.log`, `after.log`,
`unit-only.log`, and `ast.json`. Runs use the existing offline_pytest.py and
verified prepared tokenizer; no dependency install or real service access.

## Exact bindings and definition mapping

AST hashes are SHA256 of Python ast.dump(function, include_attributes=False).
Every moved decorator/parameter/statement is included. File hashes bind the
formatted final test bytes and unchanged production middleware.

```json
{
  "base": "5acfcc2",
  "original_sha256": "54a372817f3c4a75d08ba4ceba97fee0fdf4e366074bf3eb4d758232ad130dfa",
  "test_definitions": 26,
  "moved_definitions": 13,
  "mapping": [
    {
      "node": "TestConfig::test_default_is_100mb",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "b28b1821a7891197ee15afc77103b237b948a6e5686b79ca769b5e598a98da5d"
    },
    {
      "node": "TestConfig::test_reads_env_override",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "8f5a0c55098ad51b63059edab97e00857afcc7d2567a73a438e8c7b7b1110bc5"
    },
    {
      "node": "TestConfig::test_malformed_env_falls_back_to_default",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "27499edac0c1bce39a7a260bdcef09fe80499e00ae5978adcbeece59dd8c1ef1"
    },
    {
      "node": "TestConfig::test_non_positive_env_falls_back_to_default",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "ad23a6dd322876c933209849c1adbdf6fa72fc17b971de2354198f25c7fbfc0e"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_content_length_precheck_rejects_before_app_runs",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "bee10ddaac71b3a5206609997f5a29a8e7236429dcc6d7a3545b6e5013b56be9"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_small_body_passes_through",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "8baae32f82e86ed01fa13085bea8cd086159e6f52a5ac11ab7b7e76da5bc29f1"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_streaming_body_without_content_length_is_still_enforced",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "87db4e28cae28802cd5d321aa53d98669e75f2de906e7ff8de03cc0a34ed8233"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_malformed_content_length_falls_back_to_streaming_check",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "8499137e29e63972913620e081cb3aa32dd5d10c8800903f0f2fdfb09630e914"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_non_http_scope_passes_through_untouched",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "8bd55012848e3c8664dfb4b7dad76b632dedea4fd49306ccb89f7fd9a6199e95"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_exactly_at_limit_passes",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "403076d0f8e7a9eb2865f4d43851288a3285d7af5a311a2f708dd83af7e8cb2c"
    },
    {
      "node": "TestMiddlewareAsgiLevel::test_one_byte_over_limit_rejected",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "72ee12fde9b87e979e63cf9b37fbb3d4e9ccedc50d6a234fb4c0d97503e1482a"
    },
    {
      "node": "TestCorsInteraction::test_cors_headers_present_on_413_when_wrapped_by_cors_middleware",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "0f2c672b4c47e5322ce1f6430cfac86e1f1f3ab91cd7eb4cac4964a6f1e04cd4"
    },
    {
      "node": "TestFastApiIntegration::test_small_request_passes",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "5254d052ab6b9cdf6a87c71e48bed0d518503c24782856ecb1f6f5754004ebb2"
    },
    {
      "node": "TestFastApiIntegration::test_oversized_request_rejected_with_413",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "cf10c38b7cc7990412b903d618fe293ff3252c762a916af858d016cade74bd70"
    },
    {
      "node": "TestRealAppWiring::test_real_app_registers_middleware_with_configured_size",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "17268e38f8c2c2df67aae81e5faab4514635d41e27f665809b7bb9ef2a233951"
    },
    {
      "node": "TestRealAppWiring::test_real_app_wraps_it_inside_cors",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "ba796182557f881290d176035bd9c22578ed4609c64b7995983bdfe6cc389cda"
    },
    {
      "node": "test_portable_route_budget_stream_and_header",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "71b74a6c0b936c8a159f4176e8a27ff3991486cba75bf682ecbfe3dd794bfdf9"
    },
    {
      "node": "test_portable_override_is_exact_route_only",
      "destination": "test_max_body_size_middleware_unit.py",
      "ast_sha256": "33324baf25d0eae16bc0916fdd81ee0e6c057320ea3f408bba3619cba52d86fa"
    },
    {
      "node": "test_multipart_stream_limit_returns_413_and_closes_spool",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "aa15f1865f238463f4b3f0ac24755f44f3644bf4d81b42000e6e945a95507bf6"
    },
    {
      "node": "test_real_auth_precedes_body_limit",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "3f76aa9fd763a05eb805eba05fe24a90a94365a3ea656e3ef17cf6f5aab3e65c"
    },
    {
      "node": "test_anonymous_import_never_reads_body",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "1cc312e18e4c0ffd42c4b9ed77d9cf225d9091fa4003f540f6171d174529f367"
    },
    {
      "node": "test_portable_limits_endpoint_requires_auth_and_exposes_safe_contract",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "29f710ee5baf68a25783889bdd76f01869392e92beb4b8dcab1683a82be77087"
    },
    {
      "node": "test_portable_budget_rejects_invalid_or_unsafe_config",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "b82aa42dd98f47da719625d20109cc961f1a8b117503ef9d87e118f659aa4c50"
    },
    {
      "node": "test_portable_parser_rejects_extra_parts_and_closes_spools",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "e3f009679e92742738424a0c8380a12988680b4d94f8517d20763f76e5a9299b"
    },
    {
      "node": "test_portable_single_file_parser_retains_openapi_and_closes_success",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "73afa67eb92e41aa04e842a8f9fa1cc1cb5fbb1b5d968835632880aee28827c5"
    },
    {
      "node": "test_portable_rejects_nonmultipart_without_reading",
      "destination": "test_max_body_size_middleware.py",
      "ast_sha256": "7d674cc8d2081e81c34e7dfa6d75ba10357c81b8015646eebe3ee1c0f74132e7"
    }
  ],
  "collection_before": 40,
  "collection_after": 40,
  "moved_cases": 18,
  "unchanged_parameterized_node_ids": true,
  "post_format_AST_verified": true,
  "file_sha256": {
    "tests/test_max_body_size_middleware.py": "3c4ea4473a43f0f4c84e06d0bd9815e06d521a6b4e6626750014ddcb353de287",
    "tests/test_max_body_size_middleware_unit.py": "e170c5f4b56da02b2d500553beb998a0871459f45139e0221de027cb77f6cb39",
    "api/middleware.py": "6001cb0c1864be247387daf2b7a2518266bc1741802c429e9c0dfa4eec3af7b0"
  }
}
```
