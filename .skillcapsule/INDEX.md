# Skill Capsule Index
<!-- generated: true -->
<!-- source: atoms/*.json capsules/*.json -->
<!-- do-not-edit: true -->
<!-- generated-at: 2026-05-12T22:55:53.120Z -->

## Capsules

### code.safe.edit (v0.1.0)
Enforces safety boundaries and verification loops during code edits.
Atoms: code.edit.scope_guard, code.refactor.boundary_check, code.test.related_tests, code.verify.typecheck, code.review.diff_risk
Budget: 800

### github.upload.safe (v0.1.0)
Safe GitHub upload workflow with preflight checks and intent awareness.
Atoms: github.upload.safety, github.commit.message, github.push.confirmation
Budget: 600

### meta.evolution (v0.1.0)
Monitors skill usage patterns and evolves the registry through patch proposals.
Atoms: meta.monitor.usage, meta.propose.composite
Budget: 400

## Atoms

### code.edit.safe (v1.0.0)
Safe Edit: Enforce scope and types.
Triggers: edit, fix, update
Task types: coding
Risk: low | Mode: activate

### code.edit.scope_guard (v0.1.0)
Scope Guard: Enforcing allowed edit paths.
Triggers: edit, change, modify, update, fix
Task types: coding, bugfix, feature
Risk: medium | Mode: inspect
Capsule: code.safe.edit

### code.refactor.boundary_check (v0.1.0)
Boundary Check: Refactoring must not break public APIs.
Triggers: refactor, restructure, move, rename, clean up
Task types: refactor
Risk: high | Mode: inspect
Capsule: code.safe.edit

### code.review.diff_risk (v0.1.0)
Diff Risk: Analyzing patch for complexity and unrelated edits.
Triggers: patch, diff, review, risk
Task types: coding, refactor
Risk: medium | Mode: inspect
Capsule: code.safe.edit

### code.test.related_tests (v0.1.0)
Related Tests: Verifying patch with relevant tests.
Triggers: test, verify, check, fix, regression
Task types: coding, bugfix
Risk: medium | Mode: activate
Capsule: code.safe.edit

### code.verify.typecheck (v0.1.0)
Typecheck: Patch will be verified for type safety.
Triggers: typescript, rust, go, java, type, compilation
Task types: coding, bugfix
Risk: medium | Mode: inspect
Capsule: code.safe.edit

### github.commit.message (v0.1.0)
Commit Message: Use a clear, scoped summary of the change.
Triggers: commit, message, github, push, upload
Task types: publish
Risk: medium | Mode: activate
Capsule: github.upload.safe

### github.push.confirmation (v0.1.0)
Push to GitHub: Requires final confirmation.
Triggers: push, publish, upload
Risk: high | Mode: approval
Capsule: github.upload.safe

### github.upload.safety (v1.0.0)
Before GitHub upload: check secrets and git status.
Triggers: github, push, upload
Task types: publish
Risk: low | Mode: inspect
Capsule: github.upload.safe

### meta.monitor.usage (v0.1.0)
Meta-Monitor: Usage tracked.
Triggers: skill, hook, usage, pattern, evolve, optimize
Task types: meta_analysis, system_optimization
Risk: low | Mode: activate
Capsule: meta.evolution

### meta.propose.composite (v0.1.0)
Evolution: Proposing a composite hook based on gated evidence.
Triggers: propose hook, new capsule, composite skill
Task types: meta_analysis
Risk: medium | Mode: inspect
Capsule: meta.evolution

## Hooks

### hook.meta.log_activation
Command: `node .skillcapsule/hooks/scripts/meta-logger.js`
Permission: read_write | Kind: summarise

### hook.meta.analyze_patterns
Command: `node .skillcapsule/hooks/scripts/meta-analyzer.js`
Permission: read_only | Kind: observe

### hook.git.status
Command: `git status --porcelain`
Permission: read_only | Kind: observe

### hook.secrets.scan
Command: `node .skillcapsule/hooks/scripts/secrets-scan.js`
Permission: read_only | Kind: verify

### hook.github.push
Command: `git push {{REMOTE}} {{BRANCH}}`
Permission: restricted_exec | Kind: external

### hook.diff.scope_check
Command: `node .skillcapsule/hooks/scripts/diff-analyzer.js --check-scope`
Permission: read_only | Kind: verify

### hook.verify.typecheck
Command: `npm run typecheck`
Permission: read_only | Kind: verify

### hook.test.related
Command: `npm test -- --findRelatedTests {{CHANGED_FILES}}`
Permission: read_only | Kind: verify

### hook.review.diff_analysis
Command: `node .skillcapsule/hooks/scripts/diff-analyzer.js --analyze-risk`
Permission: read_only | Kind: summarise

### hook.diff.public_api_change_detector
Command: `node .skillcapsule/hooks/scripts/diff-analyzer.js --check-public-api`
Permission: read_only | Kind: verify


## Governance Metrics
<!-- computed from artifact and outcome history -->

| Atom | Samples | Token Efficiency | Hook Pass Rate | Activation Accept Rate |
|---|---|---|---|---|
| code.edit.safe | 0 | n/a | n/a | n/a |
| code.edit.scope_guard | 0 | n/a | n/a | n/a |
| code.refactor.boundary_check | 0 | n/a | n/a | n/a |
| code.review.diff_risk | 0 | n/a | n/a | n/a |
| code.test.related_tests | 0 | n/a | n/a | n/a |
| code.verify.typecheck | 0 | n/a | n/a | n/a |
| github.commit.message | 0 | n/a | n/a | n/a |
| github.push.confirmation | 0 | n/a | n/a | n/a |
| github.upload.safety | 0 | n/a | n/a | n/a |
| meta.monitor.usage | 0 | n/a | n/a | n/a |
| meta.propose.composite | 0 | n/a | n/a | n/a |

## Governance Metrics
<!-- computed from artifact and outcome history -->

| Atom | Samples | Token Efficiency | Hook Pass Rate | Activation Accept Rate |
|---|---|---|---|---|
| capsule.architect.manage | 0 | n/a | n/a | n/a |
| code.edit.safe | 0 | n/a | n/a | n/a |
| code.edit.scope_guard | 0 | n/a | n/a | n/a |
| code.guard.local | 0 | n/a | n/a | n/a |
| code.refactor.boundary_check | 0 | n/a | n/a | n/a |
| code.review.diff_risk | 0 | n/a | n/a | n/a |
| code.test.related_tests | 0 | n/a | n/a | n/a |
| code.verify.typecheck | 0 | n/a | n/a | n/a |
| github.commit.message | 0 | n/a | n/a | n/a |
| github.push.confirmation | 0 | n/a | n/a | n/a |
| github.upload.safety | 0 | n/a | n/a | n/a |
| meta.monitor.usage | 0 | n/a | n/a | n/a |
| meta.propose.composite | 0 | n/a | n/a | n/a |
