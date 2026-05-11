# Skill Capsule

Portable, atomic, executable skill runtime for AI coding workflows.

## Problem it solves

Skill Capsule addresses the challenges of inconsistent, unsafe, and fragmented AI skill implementations in coding workflows. Traditional skill systems often lack standardized execution environments, proper dependency management, and built-in safety checks, leading to unreliable automation, security vulnerabilities, and maintenance overhead. This runtime provides a deterministic, atomic approach to skill execution that ensures reliability and safety across diverse AI coding tasks.

## How it is different from skill documents

While skill documents are static descriptions of capabilities and interfaces, Skill Capsule is an executable runtime environment that brings skills to life. Unlike passive documentation, it actively manages skill classification, dependency resolution, hook execution, and artifact persistence. Skill documents define what skills can do; Skill Capsule executes them safely and reliably within controlled boundaries.

## Values and benefits it provides

Skill Capsule delivers several key benefits:
- **Safety and Security**: Built-in permission checks, negative-intent blocking, and isolated execution prevent unauthorized or dangerous operations.
- **Reliability**: Deterministic task classification and atomic artifact management ensure consistent, reproducible outcomes.
- **Efficiency**: Automated dependency resolution, phase-ordered execution, and artifact reuse streamline complex workflows.
- **Maintainability**: Structured logging, artifact retention, and regression testing simplify debugging and evolution.
- **Portability**: Capsule-based design allows skills to run across different environments without external dependencies.

## What is implemented

- Capsule and atom registry loaded from `.skillcapsule/capsules` and `.skillcapsule/atoms`
- Deterministic task classification, atom matching, dependency resolution, and negative-intent blocking
- Hook planning by phase with dependency-aware ordering, registry-only execution, permission checks, timeout enforcement, and output summaries
- Hook command allowlisting, local hook-script path enforcement, and shell-free execution for registered hooks
- Minimized hook process environment with explicit passthrough allowlisting
- Compact `S/O/X` render compilation with activation receipts
- Explicit preflight execution for `before_render` and `before_action` hooks with readiness receipts
- Compose, prepare, and verify runs persisted as JSON artifacts under `.skillcapsule/compiled/`
- Atomic artifact and index writes with rollback on index persistence failure
- Structured runtime error envelopes and JSONL audit logs under `.skillcapsule/logs/`
- Startup config validation plus HTTP `/health` and `/ready` endpoints for deployment checks
- Artifact index and retrieval support for recent compose/prepare/verify receipts
- Artifact queries by kind, run ID, parent artifact ID, atom ID, status, and task type, plus latest/successful/failed lookup, lineage, summary counts, and resume hints
- Configurable artifact retention with automatic and manual pruning
- CLI commands for `init`, `index`, `classify`, `match`, `compose`, `prepare`, `activate`, `verify`, `patch validate`, `patch apply`, and `outcome record`
- MCP wrapper exposing compose/prepare/activate/verify/outcome-record/patch-validate/patch-apply plus artifact list/get
- MCP wrapper exposing compose/prepare/activate/verify/outcome-record/patch-validate/patch-apply plus artifact list/get/latest/lineage/summary
- MCP tool responses return `{ ok: true, data: ... }` on success or a structured `{ ok: false, error: ... }` envelope on failure
- Automated regression tests for compose, verify, validate, and patch-apply flows

## Current boundary

- Hook execution is phase-ordered, dependency-aware within each phase, and deduplicated.
- A full DAG scheduler and real container-backed isolation are not implemented yet.
- `before_action` hooks are not auto-run during `compose`; they run through explicit `prepare`.

## Core commands

```bash
skillcap init --project "My Project"
skillcap index
skillcap classify --task task.json
skillcap match --task task.json
skillcap compose --task task.json --budget 800
skillcap prepare github.upload.safety --task task.json
skillcap activate github.upload.safety --task task.json
skillcap verify code.edit.scope_guard --task task.json
skillcap patch validate .skillcapsule/patches/pending/change.json
skillcap patch apply .skillcapsule/patches/pending/change.json
skillcap outcome record outcome.json
skillcap artifact list --kind verify --limit 5
skillcap artifact list --run-id run-shared-flow
skillcap artifact list --parent-artifact-id verify-abc123
skillcap artifact list --kind prepare --atom-id github.upload.safety --status READY
skillcap artifact list --task-type publish --limit 10
skillcap artifact latest --kind verify --atom-id code.edit.safe --success-only
skillcap artifact latest --run-id run-shared-flow --failed-only
skillcap artifact lineage run-shared-flow
skillcap artifact resume verify-abc123
skillcap artifact summary --kind prepare --atom-id github.upload.safety
skillcap artifact show verify-abc123
skillcap artifact prune
```

## Compose example

```bash
skillcap compose "Upload this project to GitHub but do not push" --budget 800
```

Expected behaviour:

- classify the task as `publish`
- match `github.upload.safe`
- activate `github.upload.safety` and `github.commit.message`
- block `github.push.confirmation` through the `no_push` negative intent
- run `before_render` hooks such as `hook.git.status`
- compile a compact LLM-ready capsule
- assign a run ID and persist a compose artifact that later prepare/verify steps can attach to

Preflight example:

```bash
skillcap prepare github.upload.safety --task task.json
```

Expected behaviour:

- execute `before_render` hooks
- execute `before_action` hooks such as `hook.secrets.scan`
- return `READY` or `BLOCKED` with a preparation receipt
- persist the preparation artifact under `.skillcapsule/compiled/`

## Development

```bash
npm install
npm run build
npm test
npm start
npm run start:stdio
```
