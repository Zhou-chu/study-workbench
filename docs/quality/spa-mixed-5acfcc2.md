# SPA mixed-layer measurement at 5acfcc2

The complete one-worker `node scripts/coverage-workspaces.mjs --only=web` run passed 1421/1421 tests, with original 5000ms UI timeout. All 201 production source files were reported, with no missing/unexpected paths. HEAD and tracked input hashes were unchanged; native test exit was 0.

Mixed coverage: statements 9158/10128 (90.42%), branches 10681/12388 (86.22%), functions 2523/2722 (92.68%), lines 6227/6799 (91.58%). This is not strict-unit coverage. Branch coverage still fails the >90% goal; it is not a complete repository or Sonar gate pass.

The earlier disk-interrupted attempt is not counted. This resumed run retained its own command, before hashes, raw JSON/text reports, post-run consistency and five-second disk samples. The 335-second samples had a minimum 53.255 GiB host free space; the 20 GiB stop floor did not trigger. No real service, database migration or deployment ran.

The prior pagination timeout did not recur in this full run; this single pass does not establish a performance guarantee. Subsequent middleware changes only split existing Python tests, not SPA source.
