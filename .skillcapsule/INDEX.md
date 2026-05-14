# Skill Capsule Index
<!-- generated: true -->
<!-- source: atoms/*.json capsules/*.json -->
<!-- do-not-edit: true -->
<!-- generated-at: 2026-05-14T01:28:34.412Z -->

## Capsules

### code.local.guard (v0.1.0)
Enforces local development standards and safety before committing changes.
Atoms: code.guard.local

### code.safe.edit (v0.1.0)
Enforces safety boundaries and verification loops during code edits.
Atoms: code.edit.scope_guard, code.refactor.boundary_check, code.test.related_tests, code.verify.typecheck, code.review.diff_risk
Budget: 800

### github.upload.safe (v0.1.0)
Safe GitHub upload workflow with preflight checks and intent awareness.
Atoms: github.upload.safety, github.commit.message, github.push.confirmation
Budget: 600

### meta.capsule.architect (v0.1.0)
Streamlines the creation, indexing, and health validation of the Skill Capsule registry.
Atoms: capsule.architect.manage

### meta.evolution (v0.1.0)
Monitors skill usage patterns and evolves the registry through patch proposals.
Atoms: meta.monitor.usage, meta.propose.composite
Budget: 400

### meta.postmortem.learning (v0.1.0)
Learns from production bugs to create self-healing code patterns. Analyzes fixed issues and generates reusable atoms for automatic bug prevention.
Atoms: bug.pattern.extractor, fix.strategy.generator, learning.atom.creator, meta.registry.validator
Budget: 600

### stage.dev.velocity (v1.0.0)
Environment for rapid iteration. Prioritizes developer velocity and knowledge capture over strict enforcement.
Atoms: code.edit.safe, meta.monitor.usage, code.guard.local, learning.atom.creator

### stage.prod.hardened (v1.0.0)
Environment for production safety. Strict enforcement of scope, security scanning, and manual push confirmation.
Atoms: code.edit.scope_guard, code.review.diff_risk, github.upload.safety, github.push.confirmation

### stage.qa.integrity (v1.0.0)
Environment for verification. Ensures technical correctness, type safety, and test coverage before merging.
Atoms: code.verify.typecheck, code.test.related_tests, code.refactor.boundary_check, github.commit.message

## Atoms

### bug.pattern.extractor (v0.1.0)
Extracting bug pattern from fixed code.
Triggers: bug fixed, postmortem, learn from error, race condition, useEffect
Task types: bug_analysis, learning
Risk: low | Mode: activate
Capsule: meta.postmortem.learning

### capsule.architect.manage (v1.0.0)
Lifecycle management for Skill Capsules: indexing, validation, and health checks.
Triggers: architect, create capsule, new atom, index, registry, doctor
Task types: meta_analysis, system_optimization
Risk: medium | Mode: activate
Capsule: meta.capsule.architect

### code.edit.safe (v1.0.0)
Safe Edit: Enforce scope and types.
Triggers: edit, fix, update
Task types: coding
Risk: low | Mode: activate
Capsule: stage.dev.velocity

### code.edit.scope_guard (v0.1.0)
Scope Guard: Enforcing allowed edit paths.
Triggers: edit, change, modify, update, fix
Task types: coding, bugfix, feature
Risk: medium | Mode: inspect
Capsule: code.safe.edit, stage.prod.hardened

### code.guard.local (v1.0.0)
Safety checks for local development: git status, secrets scan, and related tests.
Triggers: guard, safe, check, verify, pre-commit
Task types: coding, bugfix, feature
Risk: low | Mode: activate
Capsule: code.local.guard, stage.dev.velocity

### code.refactor.boundary_check (v0.1.0)
Boundary Check: Refactoring must not break public APIs.
Triggers: refactor, restructure, move, rename, clean up
Task types: refactor
Risk: high | Mode: inspect
Capsule: code.safe.edit, stage.qa.integrity

### code.review.diff_risk (v0.1.0)
Diff Risk: Analyzing patch for complexity and unrelated edits.
Triggers: patch, diff, review, risk
Task types: coding, refactor
Risk: medium | Mode: inspect
Capsule: code.safe.edit, stage.prod.hardened

### code.test.related_tests (v0.1.0)
Related Tests: Verifying patch with relevant tests.
Triggers: test, verify, check, fix, regression
Task types: coding, bugfix
Risk: medium | Mode: activate
Capsule: code.safe.edit, stage.qa.integrity

### code.verify.typecheck (v0.1.0)
Typecheck: Patch will be verified for type safety.
Triggers: typescript, rust, go, java, type, compilation
Task types: coding, bugfix
Risk: medium | Mode: inspect
Capsule: code.safe.edit, stage.qa.integrity

### fix.strategy.generator (v0.1.0)
Generating correction strategy for identified bug pattern.
Triggers: generate fix, correction strategy, healing code
Task types: fix_generation, learning
Risk: medium | Mode: activate
Capsule: meta.postmortem.learning

### github.commit.message (v0.1.0)
Commit Message: Use a clear, scoped summary of the change.
Triggers: commit, message, github, push, upload
Task types: publish
Risk: medium | Mode: activate
Capsule: github.upload.safe, stage.qa.integrity

### github.push.confirmation (v0.1.0)
Push to GitHub: Requires final confirmation.
Triggers: push, publish, upload
Risk: high | Mode: approval
Capsule: github.upload.safe, stage.prod.hardened

### github.upload.safety (v1.0.0)
Before GitHub upload: check secrets and git status.
Triggers: github, push, upload
Task types: publish
Risk: low | Mode: inspect
Capsule: github.upload.safe, stage.prod.hardened

### learning.atom.creator (v0.1.0)
Creating new self-healing atom from learned pattern.
Triggers: create atom, self-healing, generate capsule
Task types: atom_creation, learning
Risk: high | Mode: inspect
Capsule: meta.postmortem.learning, stage.dev.velocity

### meta.monitor.usage (v0.1.0)
Meta-Monitor: Usage tracked.
Triggers: skill, hook, usage, pattern, evolve, optimize
Task types: meta_analysis, system_optimization
Risk: low | Mode: activate
Capsule: meta.evolution, stage.dev.velocity

### meta.propose.composite (v0.1.0)
Evolution: Proposing a composite hook based on gated evidence.
Triggers: propose hook, new capsule, composite skill
Task types: meta_analysis
Risk: medium | Mode: inspect
Capsule: meta.evolution

### meta.registry.validator (v1.0.0)
Validates the Skill Capsule registry integrity and schema compliance.
Triggers: validate, doctor, index, verify-registry
Task types: meta_analysis, system_optimization
Risk: medium | Mode: inspect
Capsule: meta.postmortem.learning

## Hooks

### hook.meta.log_activation
Command: `node .skillcapsule/hooks/scripts/meta-logger.js`
Permission: read_write | Kind: summarise

### hook.meta.analyze_patterns
Command: `node .skillcapsule/hooks/scripts/meta-analyzer.js`
Permission: read_write | Kind: observe

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

### hook.skillcap.index
Command: `node bin/skillcap.js index`
Permission: read_write | Kind: summarise

### hook.skillcap.doctor
Command: `node bin/skillcap.js doctor`
Permission: read_only | Kind: verify

### hook.bug.ast_analyzer
Command: `node .skillcapsule/hooks/scripts/bug-ast-analyzer.js`
Permission: read_only | Kind: analyze

### hook.fix.strategy_builder
Command: `node .skillcapsule/hooks/scripts/fix-strategy-builder.js`
Permission: read_write | Kind: generate

### hook.atom.json_generator
Command: `node .skillcapsule/hooks/scripts/atom-json-generator.js`
Permission: read_write | Kind: create

### hook.registry.integrator
Command: `node bin/skillcap.js index --integrate`
Permission: read_write | Kind: integrate


## Governance Metrics
<!-- computed from artifact and outcome history -->

| Atom | Samples | Token Efficiency | Hook Pass Rate | Activation Accept Rate |
|---|---|---|---|---|
| bug.pattern.extractor | 0 | n/a | n/a | n/a |
| capsule.architect.manage | 0 | n/a | n/a | n/a |
| code.edit.safe | 0 | n/a | n/a | n/a |
| code.edit.scope_guard | 0 | n/a | n/a | n/a |
| code.guard.local | 0 | n/a | n/a | n/a |
| code.refactor.boundary_check | 0 | n/a | n/a | n/a |
| code.review.diff_risk | 0 | n/a | n/a | n/a |
| code.test.related_tests | 0 | n/a | n/a | n/a |
| code.verify.typecheck | 0 | n/a | n/a | n/a |
| fix.strategy.generator | 0 | n/a | n/a | n/a |
| github.commit.message | 0 | n/a | n/a | n/a |
| github.push.confirmation | 0 | n/a | n/a | n/a |
| github.upload.safety | 0 | n/a | n/a | n/a |
| learning.atom.creator | 0 | n/a | n/a | n/a |
| meta.monitor.usage | 0 | n/a | n/a | n/a |
| meta.propose.composite | 0 | n/a | n/a | n/a |
| meta.registry.validator | 0 | n/a | n/a | n/a |
