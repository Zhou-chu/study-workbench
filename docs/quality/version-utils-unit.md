# Direct version utility unit coverage

Added 26 independent tests with injected HTTP and package-metadata boundaries. These exercise synchronous/asynchronous response parsing, Poetry/project fallback and precedence, malformed input, explicit failures, version comparison and no retry. Production code is unchanged. A first test expectation incorrectly expected a normal async context exit on a raised HTTP error; corrected to assert RuntimeError, not a production fix.

Focused full-denominator diagnostic: 26 passed; all 180 production Python files retained. The target version_utils module covers 62/62 lines and 12/12 branches. Overall this tiny test selection covers only 193/23902 lines (0.81%) and 17/6996 branches (0.24%), combined 0.68%; the unchanged 90.01 threshold correctly exits 1. This is not whole-project coverage, nor a complete classified unit selection.

Reproduce via the supported offline_pytest wrapper with the prepared tokenizer, tests/test_version_utils_unit.py, --cov and scripts/quality/coverage-python.ini, writing reports/data to an isolated run directory. No external API or real package metadata lookup participates in the tests.

Independent review accepted the direct-unit boundary. The HTTP-error test specifically raises from raise_for_status, not get/connection establishment or cancellation. The two URL rejection cases do not establish comprehensive URL/hostname safety; no production URL-validation change is claimed.
