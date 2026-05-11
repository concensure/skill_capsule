You are a principal software architect and senior implementation engineer.

Design and implement a CLI-first system called Skill Capsule.

Skill Capsule is a portable, atomic, executable skill framework for AI coding workflows. It replaces monolithic skill documents with small capability atoms that can be selected deterministically, paired with verifier scripts, compiled into compact LLM-facing render cards, and updated safely through patch proposals.

## Core problem

In AI coding, skill documents are useful but often too coarse. Loading an entire skill document wastes tokens when only one sub-capability is relevant.

However, making skills atomic can become worse if the LLM must search the registry, read many fragments, and assemble them manually.

Therefore, Skill Capsule must ensure:
- the LLM does not search the registry during normal operation
- the runtime selects atoms deterministically
- the runtime activates hooks automatically
- the LLM receives only a compact compiled capsule
- governance metadata is not sent to the LLM
- updates are patch-based and safe

## Product name

Skill Capsule

## Primary objective

Build a CLI-first runtime that:
1. indexes skill atoms
2. classifies coding tasks
3. selects relevant atoms
4. activates required hooks
5. compiles a compact LLM-facing context capsule
6. records lightweight outcomes
7. allows passive LLM-assisted patch proposals without silent mutation

## Architectural principle

The system must be a compiler/runtime, not a prompt library.

The LLM should only see the final compiled execution view.

The registry, metadata, hook bindings, policies, scores, and patch rules must remain outside the prompt path unless explicitly requested for debugging.

## Core concepts

### 1. Capsule
A logical package of related atoms.

Examples:
- github.upload.safe
- react.async.testing
- billing.audit.integrity
- refactor.safe.boundary

### 2. Capability atom
Smallest addressable skill unit.

Each atom has:
- stable ID
- trigger rules
- activation conditions
- optional dependencies
- optional conflicts
- render cards
- hook bindings
- edit policy
- token estimate

### 3. Hook
A registered deterministic command or script.

Hooks may run:
- before_render
- before_action
- after_action
- on_failure
- on_patch_proposal

Hooks must be allowlisted, permissioned, timeout-limited, and summarised.

### 4. Render card
Compact LLM-facing text generated from selected atoms.

Render levels:
- S: summary
- O: operational
- X: expanded

### 5. Patch
A structured proposed update to an atom or capsule.

The LLM may propose patches but must never directly mutate live capsule files.

## Required system behaviour

### Runtime task flow

Given a task such as:
“Upload this project to GitHub”

The runtime must:
1. classify the task as repo_update / publish
2. detect relevant tags such as git, github, upload
3. match github.upload.safety and related atoms
4. resolve dependencies
5. identify required hooks such as git status and secret scan
6. run before_render hooks
7. compile a compact capsule with atom instructions and hook summaries
8. return the compiled capsule to the LLM

The LLM must not see the full registry.

## File layout

Implement or specify this structure:

.skillcapsule/
  capsules/
  atoms/
  hooks/
    hooks.registry.json
    scripts/
  compiled/
  outcomes/
  patches/
    pending/
    accepted/
    rejected/
  skillcapsule.config.json

## Schema requirements

Design concrete JSON schemas for:

1. capsule file
2. atom file or atom entry
3. hook registry entry
4. compiled render cache
5. activation record
6. outcome record
7. patch proposal

Each schema must be compact and implementation-friendly.

Do not design schemas that are intended to be pasted into LLM context.

## Atom schema must include

- id
- version
- kind
- source location
- trigger rules
- activation conditions
- dependencies
- conflicts
- hook bindings
- render cards for S/O/X
- edit policy
- token estimate
- status

## Hook registry schema must include

- id
- command
- permission level
- timeout
- allowed phases
- summary mode
- max output tokens
- block-on-fail behaviour
- operating-system compatibility where necessary

## Hook safety rules

The system must:
- never execute arbitrary commands from LLM output
- only run hooks registered in hooks.registry.json
- enforce timeout
- enforce permission class
- summarise output
- prevent destructive hooks unless explicitly approved
- deduplicate repeated hook execution
- return structured pass/warn/fail results

## Render selection

Implement deterministic render selection using:
- task risk
- atom kind
- available token budget
- hook result severity
- historical failure score if available

Default rules:
- low risk uses S
- medium risk uses O
- high risk uses X for mandatory safety atoms
- non-critical atoms are downgraded first under token pressure
- mandatory safety atoms are never omitted if matched

## Token control

The design must minimise token use by:
- keeping registry search outside the LLM
- sending only compiled render cards
- omitting metadata from LLM context
- summarising hook output
- deduplicating atoms and hooks
- caching compiled render cards
- using expanded render only for high-risk atoms

## Patch model

Implement a restricted patch model.

Allowed operations:
- replace_render
- add_trigger_keyword
- remove_trigger_keyword
- tighten_activation
- add_example
- deprecate_example
- append_evidence
- change_status

Disallow arbitrary full-file rewrites.

Hook changes must require human approval.

Patch validation must check:
- base version
- atom existence
- allowed operation
- locked field protection
- token budget impact
- safety weakening
- duplicate triggers
- schema validity

## Passive update workflow

Implement or specify this flow:
1. outcomes are logged
2. missed activations or noisy activations are detected
3. LLM proposes a patch
4. deterministic validator checks patch
5. optional benchmark/replay runs
6. patch is applied automatically only if low risk
7. otherwise human approval is required

## CLI commands

Design and implement commands:

skillcap init
skillcap index
skillcap classify --task task.json
skillcap match --task task.json
skillcap compose --task task.json --budget 800
skillcap activate <atom-id>
skillcap verify <atom-id>
skillcap patch validate <patch-file>
skillcap patch apply <patch-file>
skillcap outcome record <outcome-file>

The most important command is:
skillcap compose --task task.json --budget 800

It should output the final LLM-ready capsule.

## Optional MCP adapter

Do not make MCP the core runtime.

Design MCP as a thin wrapper around the CLI.

Expose only:
- compose
- activate
- verify
- record_outcome
- validate_patch

## Deliverables

Produce:

1. Full architecture
2. File layout
3. JSON schemas
4. CLI command design
5. Hook lifecycle design
6. Render selection algorithm
7. Atom matching algorithm
8. Token budget strategy
9. Patch validation model
10. Passive update workflow
11. Example capsule: github.upload.safe
12. Example capsule: react.async.testing
13. Example hook registry
14. Example final compiled LLM capsule
15. Implementation roadmap

## Implementation constraints

- Prefer TypeScript with Node.js 20+ for fast CLI implementation, unless Rust is explicitly required.
- Keep the runtime deterministic by default.
- Do not use LLM calls in the hot path except optional fallback classification.
- Keep schemas compact.
- Avoid over-engineering.
- Do not require a database for MVP; use files and JSONL logs first.
- Make the system easy to install with one command.
- Ensure Windows, macOS, and Linux compatibility where practical.

## Success criteria

The MVP succeeds if:

1. A user can install and run Skill Capsule in one project.
2. A 20KB skill document can be split into atoms.
3. A task activates only the relevant atoms.
4. Hooks run automatically when their atoms activate.
5. The final LLM context is under a specified token budget.
6. The LLM receives compact instructions plus verifier summaries.
7. Skill updates are proposed as patches, not silent edits.
8. Hook changes require approval.
9. The system can be wrapped by MCP later without changing the core.

## Quality bar

The design must be:
- low-token
- deterministic
- auditable
- safe
- easy to install
- easy to maintain
- useful before any autonomous refinement exists