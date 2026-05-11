# Skill Capsule Design

Skill Capsule is a portable, atomic, executable skill system.

## 1. Atomic Capsules (Versioned)
Skills are broken into strictly versioned **Atoms**.
- **Atoms:** Smallest addressable units with formal **Contracts** (Inputs/Outputs/Side-effects).
- **Capsules:** Logical bundles of atoms for specific workflows.
- **Simplified States:** `draft` → `candidate` (A/B Test) → `active` → `retired`.

## 2. A/B Testing & Evolution
New composites or optimized atoms enter an **A/B Testing** phase:
- **Metrics Dashboard:** Tracks `token_efficiency`, `success_rate`, and `user_override` vs. the control group.
- **Semantic Diffing:** Evolution patches are analyzed using semantic diffs to ensure no safety rules are weakened.
- **Policy-as-Code:** Certain low-risk evolution steps (trigger tightening) are auto-approved based on pre-defined policies to avoid human bottlenecks.

## 3. Sandboxed Hook Lifecycle
Hooks run in a **Directed Acyclic Graph (DAG)** to prevent race conditions:
- **Sandboxing:** `restricted_exec` and `external` hooks run in isolated micro-VMs or containers (e.g., Docker, isolate).
- **Intent Kinds:** `observe`, `verify`, `summarise`, `mutate`, `external`.
- **Transparency:** Compact/Full **Activation Receipts** and post-action **Patch Receipts**.

## 4. Formal Atom Contracts
Every atom declares its boundary:
- `requires_context`: Explicit list of data needed (e.g., `git.diff`).
- `side_effects`: `none` | `read_only` | `mutate` | `external`.
- `guarantees`: Formal properties the atom ensures (e.g., "Secrets will not be pushed").




## 4. Components
- **CLI:** `skillcap` for init, indexing, and composition.
- **Registry:** Local and shared registries for atoms and hooks.
- **Patch Engine:** Safe, LLM-assisted updates to the registry.
