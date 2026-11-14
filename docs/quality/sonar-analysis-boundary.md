# Sonar analysis and publication boundary (2026-11-13)

## Verified repository

GitHub connector metadata and an anonymous webpage both identify `Zhou-chu/study-workbench` as **public**, default branch `main`, MIT license. The About text still says Private; that description is not the access-control setting.

The published main README describes a filtered V1 archive originating at `e3dba32314e2d9606136d4125d40e8c343502ef3`, with sensitive/runtime paths omitted. It does not represent the complete unpublished local React SPA and quality candidate (`6d502ec` at this check). Making the repository public does not authorize publishing every local file, worktree history, data directory, report or credential. No local candidate was pushed or uploaded by this check.

References:
- https://github.com/Zhou-chu/study-workbench
- https://raw.githubusercontent.com/Zhou-chu/study-workbench/main/LICENSE

## Existing cloud organization and unchanged plan

The existing organization is `zhou-chu`; its Xiumi project is on the Free plan. An anonymous public component query filtered to `study-workbench` returned total 0. This establishes that no matching public project was found by that query, not that no inaccessible private project exists. No Notebook cloud project was created, account authorized, credential generated or subscription changed.

Official current plan documentation says Free includes unlimited public projects; the 50k LoC limit applies to private projects. Free supports the main branch and PRs targeting main, but not custom quality profiles/gates. OSS is a separate free plan with different capabilities; do not switch plans implicitly. Therefore the already-public snapshot is eligible in principle without a paid plan, but cloud onboarding and the exact publication scope still require authorization. A built-in new-code gate alone cannot certify the user's overall-code acceptance target.

https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans

## Authorized local route

The user explicitly approved official SonarQube Community Build and PostgreSQL containers on the desktop, only local access, isolated volumes, no source upload and no changes to the Notebook database. This permits evaluating the unpublished candidate without publishing it. Setup and fixed-candidate analysis are now complete; localhost UP was independently verified. The gate is ERROR and one Python file has an analyzer NPE. See `sonar-local-baseline.md` for exact results and restrictions.

Use a pinned official image, private database network/no published PostgreSQL port, and Sonar bound only to 127.0.0.1. Do not weaken bootstrap checks, change host security settings, expose a public port or connect to the Notebook database. Store least-privilege local analysis credentials outside Git and never log them. Report any additional system-setting requirement before changing it.

Community Build can analyze Python and JS/TS and use custom gates, but lacks commercial advanced SAST/SCA and PR/multi-branch capabilities. Passing its security rules is not a complete security certification. Import Python XML and all declared JS/TS LCOV partitions; explicitly audit unsupported files and unmeasured entries. CI retains the strict full-source >90% checks independently of Sonar's aggregated coverage.

https://docs.sonarsource.com/sonarqube-community-build/feature-comparison-table
