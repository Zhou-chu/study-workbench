# Utility pure-unit split

Baseline f86e7f4. No production code, source denominator, threshold or runtime
configuration changed. Test-layer manifest is left to coordinator review.

Moved unchanged: TestTextUtilities (12), TestTokenUtilities (2 injected tiktoken
get_encoding failures), and TestVersionUtilities (4 comparison functions plus
one invalid-URL preflight function). 19 cases call real production logic.
The two invalid URL values raise before requests.get; they perform no network.
Token fallback tests patch get_encoding before any actual tokenizer loading.
Text and packaging version parsing are pure computations. No fixture or assertion
was replaced with mocks to manufacture a new classification.

Original file remains mixed: installed distribution metadata lookup and real
Source/context/tokenizer paths remain, including their exact original assertions.
This batch does not approve the remainder as strict unit or broaden its scope.

Verification:
- Original file: 42 passed, 1 dependency warning, 0.96s.
- Split pair: 42 passed, same warning, 1.08s.
- New unit alone: 19 passed, 0.43s.
- Collection 42 -> 42 (19 new unit, 23 remaining mixed); normalized parameterized
  node IDs identical. All 37 test definition ASTs match, including decorators,
  parameter values and every assertion. 19 definitions move unchanged.
- Initial Ruff found one residual multiline import-format issue, corrected by
  import sorting; no tests ran in that failed lint command. Final Ruff check,
  format and git diff --check pass. Post-format AST equality was verified.

Evidence prefix: <external-evidence>/python/utils-split-
with before-collection.log, after-collection.log, before.log, after.log,
unit-only.log, ast.json. No full-project coverage percentage is inferred.

Reproduction from this tree:
```
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-tokenizer-cache> -- tests/test_utils.py tests/test_utils_unit.py -q
```
For isolated unit execution omit tests/test_utils.py; for collection add
--collect-only. No dependency installation or real service startup is needed.

## Final byte bindings and lossless test AST mapping

AST digest is SHA256 of ast.dump(function, include_attributes=False).

```json
{
  "base": "f86e7f4",
  "original_sha256": "a062118e1f7b776468a18a3bab17b387f20dfbba3ade8c2822c4db02fda1d6ff",
  "test_definitions": 37,
  "moved_definitions": 19,
  "mapping": [
    {
      "node": "TestTextUtilities::test_remove_non_ascii",
      "destination": "test_utils_unit.py",
      "ast_sha256": "13bb2be3f844e1059677de61582a64569cbe363e4191f24cc92ecd662d931803"
    },
    {
      "node": "TestTextUtilities::test_remove_non_ascii_pure_ascii",
      "destination": "test_utils_unit.py",
      "ast_sha256": "cf852e65235ce6223b512ebe4db7240c547694b35076701d7ff6f14dc108ef87"
    },
    {
      "node": "TestTextUtilities::test_remove_non_printable",
      "destination": "test_utils_unit.py",
      "ast_sha256": "298a58e6d9003f3073046de2383b285caa7d9dd0153ed1719e543cab8abeede3"
    },
    {
      "node": "TestTextUtilities::test_remove_non_printable_preserves_newlines",
      "destination": "test_utils_unit.py",
      "ast_sha256": "c0855292c8323da7b9ae963d2773362e3ba6bce0c5dccf3fb2ccaf4c6b57b4a2"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_basic",
      "destination": "test_utils_unit.py",
      "ast_sha256": "09cf3915f869556b0a75024d9c914ce5535eaa10e7ed16037cfc93d3adfc7f51"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_multiple_tags",
      "destination": "test_utils_unit.py",
      "ast_sha256": "6bddfdcdc0096887d8f1c8142b58377c2b18ecdd158da61bfabdfc468f42ebe2"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_no_tags",
      "destination": "test_utils_unit.py",
      "ast_sha256": "5a2b44aa6db52bd15394ccfc6f5ce1078b76b962224d0724f5c0a7988906f66e"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_malformed_no_open_tag",
      "destination": "test_utils_unit.py",
      "ast_sha256": "66ea2c1582efecca730f07bb4f9486a15e98a4d5c8050fefccb3273009ca9653"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_truncated_no_close_tag",
      "destination": "test_utils_unit.py",
      "ast_sha256": "ae58f613f333c08d0621f45bc1ac21508c64d225131b7910c8ec7ee26256b14f"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_invalid_input",
      "destination": "test_utils_unit.py",
      "ast_sha256": "17f054249d507a24c824381b06b631fcd53ea9a12ca02988263a00f1f6128007"
    },
    {
      "node": "TestTextUtilities::test_parse_thinking_content_large_content",
      "destination": "test_utils_unit.py",
      "ast_sha256": "17df7e8823f44012a44189cd4af73bd2dd5c80cfd309b1250c6c32204b4c69b6"
    },
    {
      "node": "TestTextUtilities::test_clean_thinking_content",
      "destination": "test_utils_unit.py",
      "ast_sha256": "72a2bc1c61811aca772b46e8ad9ab15f272625b5b7cc7cd1aa014b7212b77bc6"
    },
    {
      "node": "TestTokenUtilities::test_token_count_fallback",
      "destination": "test_utils_unit.py",
      "ast_sha256": "7efa2a52f458bb93c825e31f6e3c13962c5aa78b58f8ec26d8cdfb3c1713dcf2"
    },
    {
      "node": "TestTokenUtilities::test_token_count_network_error_fallback",
      "destination": "test_utils_unit.py",
      "ast_sha256": "ba64227c5ab8de889896cf8d197cee9929ed7664a997e999bdd1dfbf0505e38e"
    },
    {
      "node": "TestVersionUtilities::test_compare_versions_equal",
      "destination": "test_utils_unit.py",
      "ast_sha256": "e8176b43fb5d269c065d249422b1aa1268e4b789f10543bb0bb91311fefe9e85"
    },
    {
      "node": "TestVersionUtilities::test_compare_versions_less_than",
      "destination": "test_utils_unit.py",
      "ast_sha256": "fb6ef9f3eebaa12e21ed27f66ab35d4b0f3ca0be3cf2ac9692cddb3990beb2b9"
    },
    {
      "node": "TestVersionUtilities::test_compare_versions_greater_than",
      "destination": "test_utils_unit.py",
      "ast_sha256": "3c8e0ff2f9c7223c37b61e30d78b58cf3d5d447d428e5df0737651b8e6dec4a3"
    },
    {
      "node": "TestVersionUtilities::test_compare_versions_prerelease",
      "destination": "test_utils_unit.py",
      "ast_sha256": "f53e00f187dee056e30d344402b741328769311cbe990fcd3d24fbc4384002eb"
    },
    {
      "node": "TestVersionUtilities::test_get_installed_version_success",
      "destination": "test_utils.py",
      "ast_sha256": "e6d5d81433ba08f2caced46ee4e3a8486cc7ff206b5fa17b6441d47f0d0273ca"
    },
    {
      "node": "TestVersionUtilities::test_get_installed_version_not_found",
      "destination": "test_utils.py",
      "ast_sha256": "701dabdf39075726dc99e7c35113f58c77419b76c7ece07ebc20d979c2d3ceda"
    },
    {
      "node": "TestVersionUtilities::test_get_version_from_github_invalid_url",
      "destination": "test_utils_unit.py",
      "ast_sha256": "abaf26affda72ef65edd4b281a5dc7218132acb456f78f71a2a513964aea49c0"
    },
    {
      "node": "TestBuildSourceContext::test_source_and_insights_shape",
      "destination": "test_utils.py",
      "ast_sha256": "cf18d1912dccffa867beae49b9b375364a465b9b44b3124f73a0e8d13ceeb6b8"
    },
    {
      "node": "TestBuildSourceContext::test_preserves_insights_that_fit_token_budget",
      "destination": "test_utils.py",
      "ast_sha256": "6426032d30140014eedfb72e80fbe6647ac5760f06fb604683a5029bd4f42f63"
    },
    {
      "node": "TestBuildSourceContext::test_real_source_full_text_reaches_formatted_prompt",
      "destination": "test_utils.py",
      "ast_sha256": "2481c95e648cd2cf71150bea89b9f7a7d93e038a612ce01500b7c1420c278cb4"
    },
    {
      "node": "TestBuildSourceContext::test_large_source_is_deterministically_and_explicitly_truncated",
      "destination": "test_utils.py",
      "ast_sha256": "f422af959654dac1eac0fae5a6e526dfba604fcfbd907349da42c963b94fc04e"
    },
    {
      "node": "TestBuildSourceContext::test_source_content_availability_rules",
      "destination": "test_utils.py",
      "ast_sha256": "864c05c32ca1ed9b1433f3a0e91ee9f3d306b8063efa3a7b997feb0bdafa129e"
    },
    {
      "node": "TestBuildSourceContext::test_large_source_reserves_budget_for_insights",
      "destination": "test_utils.py",
      "ast_sha256": "826e33a2d3741e7fc8916aafb171fb4c3999b20a37ba4c682a7037d74a7ebdc9"
    },
    {
      "node": "TestBuildSourceContext::test_tiny_budget_omits_source_with_explicit_status",
      "destination": "test_utils.py",
      "ast_sha256": "be10784063c92fc20ad39ed2da756a2ea06817e0acf6542edfea8d6e7b3ccbd4"
    },
    {
      "node": "TestBuildSourceContext::test_notice_only_budget_omits_source",
      "destination": "test_utils.py",
      "ast_sha256": "f5963605907b4f1c3968af0dffc34688a5f073fddb8ffe08d71e4397529c4e07"
    },
    {
      "node": "TestBuildSourceContext::test_truncation_handles_non_monotonic_bpe_counts",
      "destination": "test_utils.py",
      "ast_sha256": "1af611a89050bb47dc332d3d0c9c9b9aec40f31d8f04c06edb02d38b328668de"
    },
    {
      "node": "TestBuildSourceContext::test_token_prefix_search_has_bounded_candidate_checks",
      "destination": "test_utils.py",
      "ast_sha256": "303d8f5dad6d21545ef13d7bc2e19448705e491bb7fa68d6fcc721dc2d6fd5fc"
    },
    {
      "node": "TestBuildSourceContext::test_large_source_reuses_initial_tokenization",
      "destination": "test_utils.py",
      "ast_sha256": "10efe12827f31f34f2b9c00414060630ce4dfdf57ec3596583b325144a24a195"
    },
    {
      "node": "TestBuildSourceContext::test_incomplete_utf8_prefix_is_not_reported_as_source_text",
      "destination": "test_utils.py",
      "ast_sha256": "e98e5ad572a571bb98de43db16680d9a7e22df2d1d76a2527a56af52c78ada8b"
    },
    {
      "node": "TestBuildSourceContext::test_word_fallback_search_has_logarithmic_candidate_checks",
      "destination": "test_utils.py",
      "ast_sha256": "86bfc886d9319f9ea12cca23c509c864b9274f60eda281fece51c26f4f224cd0"
    },
    {
      "node": "TestBuildSourceContext::test_formatter_does_not_apply_a_second_character_limit",
      "destination": "test_utils.py",
      "ast_sha256": "b77947ef2d2e1cd28b03952965edfed365e0be9ebbb90dc39a038e24c0e36dc5"
    },
    {
      "node": "TestBuildSourceContext::test_missing_source_text_is_reported_honestly",
      "destination": "test_utils.py",
      "ast_sha256": "66adcac2fbadeccb3486c3657b4767aa1ab2a00804f69cf84a86ffb6cf7f630c"
    },
    {
      "node": "TestBuildSourceContext::test_missing_source_yields_empty_context",
      "destination": "test_utils.py",
      "ast_sha256": "abcb8fa0249285d2442b945620fd0f46491565c3f5b9f7d93d87ae164d33e7fc"
    }
  ],
  "collection_before": 42,
  "collection_after": 42,
  "moved_cases": 19,
  "post_format_AST_verified": true,
  "unchanged_parameterized_node_ids": true,
  "file_sha256": {
    "tests/test_utils.py": "e9af527db5f5efa19bb2d96357f6d74bd5c99ae86d69bea235ba56e967c822ad",
    "tests/test_utils_unit.py": "49ebb22d82371ad94b3e7b0320f60c159f97a1985d37ef3e707927cc0e90e261",
    "open_notebook/utils/text_utils.py": "d79dab560c9575cd8e98797cf24b9a7742892fd337892a87e4a0cd3fe629ec59",
    "open_notebook/utils/token_utils.py": "d9f4d1f6865a1dad0953c9024ff29164e25e1b36a48318cd99e109330744be5b",
    "open_notebook/utils/version_utils.py": "fd839c84ad15362946ef0f3103569d496c424a7e1aa133c809d3f7c50ed1f8e1"
  }
}
```
