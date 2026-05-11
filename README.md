# Portable Agent Skills Directory

> A zero-friction, hierarchical skills directory for AI agents (Claude Code, Gemini, Cursor, etc.) with visual management and safety-first GitHub uploading.

## Features

- **Visual Dashboard:** Zero-friction `dashboard.html` to visualize skill hierarchy and triggers.
- **Hierarchical Routing:** Domain and Cascade skills for token-efficient loading (based on CLAIR).
- **GitHub Safety Skill:** Built-in protocol for scrubbing secrets and local data before publishing.
- **Portable:** Works with any MCP-compatible AI coding assistant.

## Core Commands

### 1. Initialize
Set up the Skill Capsule structure and agent-specific pointer files:
```bash
skillcap init --project "My Project"
```

### 2. Compose Context
Classify a task and compile a compact, hook-verified skill capsule for the LLM:
```bash
skillcap compose "Upload this project to GitHub but do not push"
```
- **Features:** Negative intent detection (e.g., `no_push`), risk-sensitive budgeting, and automatic `before_render` hooks.

### 3. Verify Patch
Run mandatory `after_action` verification loops (typecheck, tests, scope check):
```bash
skillcap verify code.edit.scope_guard
```
- **Outcome:** Generates a **Patch Receipt** building trust through explicit validation.

## Architecture

- **Atoms:** Addressable skill fragments with formal **Contracts**.
- **DAG Hooks:** Deterministic, race-free hook execution in isolated environments.
- **Verification Loops:** Mandatory post-edit checks for type safety and edit scope.
- **Meta-Evolution:** Gated promotion (Candidate -> Experimental -> Active) based on usage evidence.

## Dashboard

The `dashboard.html` provides a modern interface to:
- Browse all Domain and Cascade skills.
- Reference triggering keywords at a glance.
- One-click copy for triggers.
- Direct links to edit skill definitions (via `vscode://` protocol).

## GitHub Upload Protocol

The `github` skill enforces a critical safety protocol:
- **Project Isolation:** Removes data from other projects.
- **Secret Scrubbing:** Checks for API keys and passwords.
- **Local Cleaning:** Removes `localhost` and machine-specific paths.

## Skill Tree Structure

```
skills/
├── domains/          ← Top-level task categories
│   ├── github.md     (Safety-first publishing)
│   ├── documents.md
│   ├── coding.md
│   ├── data.md
│   └── research.md
└── cascades/         ← Specialized sub-skills
    ├── documents/
    │   ├── docx.md
    │   ├── pdf.md
    │   └── pptx.md
    └── coding/
        ├── python.md
        ├── typescript.md
        └── testing.md
```

## Credits

Based on the **CLAIR (Cascaded Lazy AI Routing)** architecture.
