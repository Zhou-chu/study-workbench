# Verified JavaScript dependency tuple — 2026-10-22

This is package-level compatibility research, **not native build acceptance**.
All direct versions in package.json were verified using official registry metadata
(`npm view <name>@<version> version peerDependencies engines --json`). The committed
npm v3 lockfile freezes transitive package versions and integrity hashes.
Acquisition used a workspace-scoped package.json, a writable `/tmp` cache,
`--ignore-scripts --no-audit --no-fund`; no global tools/platform scaffolds were installed.
The local `.npmrc` retains disabled lifecycle scripts for subsequent installs.

## Why these versions

- React Native **0.87.1**, React/react-test-renderer **19.2.3**: both the
  [official 0.87 template](https://raw.githubusercontent.com/react-native-community/template/0.87-stable/template/package.json)
  and the [immutable RN v0.87.1 package](https://raw.githubusercontent.com/facebook/react-native/v0.87.1/packages/react-native/package.json)
  confirm this tuple. RN's actual Node constraint is `^22.13.0 || ^24.3.0 || >=26.0.0`,
  stricter than the template; this workspace used Node24.19.0/npm11.9.0.
  These pins were reverified, not inherited from the earlier tentative plan.
- Navigation native **7.5.1**, native-stack **7.20.0**, elements **2.9.45**:
  [stable vendor manifest](https://raw.githubusercontent.com/react-navigation/react-navigation/7.x/packages/native-stack/package.json)
  plus exact registry versions confirm matching native7 peers and screens/safe-area>=4.
  We do not use the v8 alpha on vendor main. Elements is a direct dependency because
  the editor imports its header-height hook for keyboard avoidance.
- Screens **4.26.2**, safe-area **5.9.1**:
  [screens compatibility table](https://raw.githubusercontent.com/software-mansion/react-native-screens/4.26.0/README.md)
  identifies Fabric RN0.84+ support; Paper is not supported for this tuple.
  [Safe-area manifest](https://raw.githubusercontent.com/AppAndFlow/react-native-safe-area-context/v5.9.1/package.json)
  provides React/RN peers and its official Jest mock.
- RNTL **13.3.3**: [tagged manifest](https://raw.githubusercontent.com/callstack/react-native-testing-library/v13.3.3/package.json)
  supports Jest>=29, React/test-renderer>=18.2 and RN>=0.71.
  Renderer19.2.3 exactly matches React. RN Babel/Jest presets are0.87.1;
  Jest/babel-jest29.7.0 match the preset's dependencies. Babel core7.28.3,
  TypeScript6.0.3, React types19.2.4, renderer types19.1.0 and Jest types29.5.14
  are separately pinned and registry-verified. No fake native ambient types exist.

## Strict type evidence and limitations

Application source and TSX tests pass `strict`, `exactOptionalPropertyTypes`, and
`noUncheckedIndexedAccess`, using installed official RN declarations.
UI `skipLibCheck:true` follows the
[official RN0.87 config](https://raw.githubusercontent.com/facebook/react-native/v0.87.1/packages/typescript-config/tsconfig.json)
and [Strict API migration guidance](https://reactnative.dev/docs/strict-typescript-api#keep-skiplibcheck-enabled).
The initial `skipLibCheck:false` trial **FAILED** on vendor declarations: removed
Animated.LegacyRef/deep CodegenTypes imports, generated component-instance types,
optional-property constraints and missing screens tab declarations. It was not a
passing full dependency declaration audit. Exact [initial diagnostics](verification/vendor-declarations-initial.txt) and [final diagnostics](verification/vendor-declarations-final.txt) are retained; the latter was rerun after all direct type dependencies were installed and exited2. No library files were patched and no
app errors were suppressed. Domain-only typechecking remains unchanged and does
not skip declarations. Native compilation remains NOT RUN.

Install emitted upstream deprecation warnings for transitive inflight1.0.6 and
glob7.2.3 in the Jest29 toolchain. No npm audit or security-clean claim is made.
A newer unrelated test stack was not silently substituted for the vendor tuple.

## Test boundary

[RN testing guidance](https://reactnative.dev/docs/testing-overview) distinguishes
JavaScript component tests from real native acceptance. Our RNTL suite uses the
real React Navigation JS router and domain/session implementation, the official RN
Jest preset, official safe-area mock, and mocked screens native host components.
It cannot validate rendered geometry, native headers/gestures, Android system back,
iPad keyboard/focus, safe-area pixels or TalkBack/VoiceOver. Those gates stay open.
