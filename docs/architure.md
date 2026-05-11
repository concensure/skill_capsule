# Skill Capsule Architecture

## Current runtime flow

1. Input task
2. Classification
3. Atom and capsule selection
4. Dependency and conflict resolution
5. Hook planning by phase with dependency-aware ordering
6. `before_render` execution
7. Optional `before_action` preparation execution with readiness receipt
8. Render selection under budget
9. Compiled capsule emission
10. Artifact persistence for compose, prepare, and verify outputs
11. Artifact index update for retrieval by kind, run ID, parent artifact ID, atom, status, task type, ID, recency, and latest success/failure helpers
12. Artifact lineage reconstruction by shared run ID across compose, prepare, and verify
13. Parent-child artifact links for retries and branch-aware follow-up flows
14. Artifact summarization for operational counts by kind, status, and task type
15. Retention pruning for bounded compiled storage
16. Resume-plan derivation from existing artifacts for lifecycle continuation
17. Optional `verify` or `patch apply` follow-up paths

## Runtime modules

- `src/runtime.ts`
  The core registry loader, matcher, hook runner, renderer, and patch engine.
- `src/mcp.ts`
  Thin MCP wrapper over the runtime.
- `bin/skillcap.js`
  CLI entrypoint.

## Safety model implemented now

- only registered hooks can execute
- hook phases must match the registry declaration
- hook commands must match the configured allowlist for their permission level
- node-based hooks must execute from `.skillcapsule/hooks/scripts/`
- hook processes execute without a shell
- hook processes inherit only a minimal host environment plus explicit allowlisted passthrough variables
- optional enforced container mode rewrites hook execution into container invocations with workspace mounts and resource limits
- deployment packaging includes a concrete hook-runner Dockerfile and an optional real-Docker integration test path
- artifact and index writes use temp-file rename semantics, with rollback if index persistence fails
- runtime actions emit JSONL audit events, and public adapters normalize failures into stable error envelopes
- deployment entrypoints validate config before startup and expose `/ready` metadata for HTTP mode
- startup validation also rejects broken hook registries, missing local hook scripts, and unavailable host executables
- HTTP mode can start in a degraded diagnostics-only state, with `/doctor` available and MCP returning a structured startup error
- hook dependencies must resolve inside the active phase or the runtime fails fast
- template substitution is allowlisted and shell-sensitive characters are rejected
- timeouts are enforced through Node child-process execution
- external hooks that require explicit approval are surfaced as `SKIP`
- patch validation blocks hook mutations and unsupported operations

## Remaining architecture work

- hook DAG dependencies instead of pure phase ordering
- stronger sandbox isolation for non-read-only hooks
- optional replay suite expansion and richer outcome analytics
