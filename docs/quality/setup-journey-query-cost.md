# Setup journey integration-test query cost

The formal SPA run reported three setup-journey 5000ms timeouts. A single-file rerun passed, so cross-file leakage is not proven. Instrumented coverage runs found approximately 1.4 seconds per case in full-document button role queries alone; the Settings query took 411–476ms.

The candidate scopes existing semantic queries to the Sources region, Tools container and leave-draft dialog. It does not remove assertions, replace real flows with mocks, or increase the 5000ms timeout. Single-file coverage passed 3/3; adjacent flows passed 52/52. These are component integration tests, not pure unit coverage. Full-suite resolution still requires a fresh formal run.
