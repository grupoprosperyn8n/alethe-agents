# release-process

- **id**: release-process
- **title**: Release script fixes for the renamed crate
- **status**: draft

## Purpose

Stabilize the release tooling after the crate rename: scripts/release.mjs must recognize the renamed crate in Cargo.lock and the release pipeline must be verifiable via dry-run.

## Requirements

### REQ-REL-1: Cargo.lock crate matching

scripts/release.mjs MUST match the crate entry `name = "so-multi-agente"` in Cargo.lock (previously `name = "alethe"`).

#### Scenario: Renamed crate matched

- GIVEN a Cargo.lock containing `name = "so-multi-agente"`
- WHEN release.mjs parses the lockfile
- THEN the crate entry is found and version bumping proceeds

#### Scenario: Missing crate entry fails clearly

- GIVEN a Cargo.lock without the expected `so-multi-agente` entry
- WHEN release.mjs runs
- THEN it aborts with an explicit error before rewriting any file

### REQ-REL-2: Dry-run verification

Running `release.mjs --dry-run` on a clean tree with the renamed Cargo.lock MUST complete successfully end to end, validating versions across package.json, tauri.conf.json, and Cargo.toml.

#### Scenario: Dry-run passes

- GIVEN a clean working tree and a renamed Cargo.lock
- WHEN the release script is executed with --dry-run
- THEN it reports success and validates the version bump across PKG/TAURI/CARGO

### REQ-REL-3: Dry-run is non-destructive

A dry-run MUST NOT modify release files (package.json, tauri.conf.json, Cargo.toml, Cargo.lock, CHANGELOG).

#### Scenario: No files written

- GIVEN a dry-run invocation
- WHEN the script completes
- THEN the working tree remains clean with no file modifications
