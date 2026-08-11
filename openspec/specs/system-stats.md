# system-stats

- **id**: system-stats
- **title**: System stats include the app's own process
- **status**: draft

## Purpose

Fix process self-identification in stats collection: after the binary rename, app_bytes must include the current process's memory usage.

## Requirements

### REQ-STATS-1: Own-process identification by binary name

stats.rs MUST identify the app's own process by the current binary name `so-multi-agente` (previously `alethe`).

#### Scenario: Own process matches

- GIVEN the app running as binary `so-multi-agente`
- WHEN process stats are collected
- THEN the current process matches the name filter and is selected for accounting

#### Scenario: Legacy name does not match

- GIVEN a stale process whose name contains `alethe`
- WHEN process stats are collected
- THEN that process is not counted as the app's own process

### REQ-STATS-2: app_bytes includes the current process

The reported app_bytes MUST include the memory of the current process and MUST be greater than zero while the app runs.

#### Scenario: app_bytes non-zero and inclusive

- GIVEN the app is running with a measurable memory footprint
- WHEN system stats are computed
- THEN app_bytes includes the current process's memory and is greater than zero

#### Scenario: Enumeration failure handled

- GIVEN process enumeration fails (OS error or insufficient permissions)
- WHEN system stats are computed
- THEN the command returns an error without panicking or corrupting other stats
