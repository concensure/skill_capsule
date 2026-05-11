# Skill Capsule Architecture

The system is a deterministic runtime that classifies tasks, matches atoms, executes hooks, and compiles a compact capsule.

## 1. Core Runtime Flow (Hardened)
1. **Input Task:** Detect task type, risk, intents, and **Edit Scope**.
2. **Atom Matching:** Match atoms against formal **Contracts**; resolve dependencies.
3. **Hook Planning (DAG):** Construct a dependency graph for hooks to handle complex ordering without races.
4. **Sandboxed Pre-Render:** Execute `observe` hooks in restricted environments.
5. **Compilation:** Enforce **Risk-Sensitive Token Budget**; generate **Activation Receipt**.
6. **Patch Execution:** LLM proposes edits.
7. **Sandboxed Verification:** Execute `verify` hooks in isolated containers.
8. **Patch Receipt:** Final audit summary of the executed changes.

## 2. Evolution & A/B Testing Layer
- **Metrics Dashboard:** Real-time tracking of atom performance.
- **A/B Gating:** New skills are served to 10% of tasks initially.
- **Semantic Diffing:** Validates that evolution patches maintain architectural invariants.
- **Replay Suite:** Scalable, automated validation using a library of historical task scenarios.

## 3. Sandboxing & Safety Model
- **Micro-VM/Container Integration:** High-risk hooks (Kind: `external`, `mutate`) are executed in ephemeral, non-networked (unless specified) environments.
- **Policy-as-Code (PaC):** Automates approvals for low-risk changes, removing human bottlenecks for `level_1` and `level_2` autonomy.
- **Hard Timeouts & Resource Quotas:** Prevents hook-based resource exhaustion.


