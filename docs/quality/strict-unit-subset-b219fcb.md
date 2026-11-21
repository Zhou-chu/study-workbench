# Reviewed Python unit diagnostic at b219fcb

Explicitly selected 69 fully reviewed Python unit files from the versioned classification manifest after verifying every selected file hash. This remains a diagnostic subset: 22 unclassified files and other mixed suites block the formal full selection, and the final gate is not declared passing.

1231 tests passed, no skips/failures, one third-party surreal_commands Pydantic deprecation warning, 23.49 seconds. Native pytest/coverage exit 1 reflects the unchanged 90.01% fail-under.

Complete tracked production denominator: 180/180 Python files, including tooling; exact paths matched, no missing/unexpected files. Lines 8488/23902 = 35.51%; branches 1385/6996 = 19.80%; combined 9873/30898 = 31.95%. The existing 56 native exclusions were not changed. Source HEAD and all tracked input hashes remained stable and the tree stayed clean.

The older 24f5fe7 subset selected 59 files and passed1041 tests (line33.98/branch17.90). This run includes additional reviewed units and new genuine assertions but also a larger denominator (new Python coverage adapter). These are distinct frozen measurements, not a claim that unknown tests or all production behavior are covered.

Reproduction uses the supported offline_pytest entrypoint, the manifest's explicit reviewed-unit Python file list, and the unchanged full-source coverage configuration with only its data_file redirected to an isolated evidence directory. Raw command, hashes, coverage JSON, log, exit and source-path audit are retained privately.
