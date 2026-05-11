# Portable Agent Skills Directory

> A zero-friction, hierarchical skills directory for AI agents (Claude Code, Gemini, Cursor, etc.) with visual management and safety-first GitHub uploading.

## Features

- **Visual Dashboard:** Zero-friction `dashboard.html` to visualize skill hierarchy and triggers.
- **Hierarchical Routing:** Domain and Cascade skills for token-efficient loading (based on CLAIR).
- **GitHub Safety Skill:** Built-in protocol for scrubbing secrets and local data before publishing.
- **Portable:** Works with any MCP-compatible AI coding assistant.

## One-Line Install

Initialize Skill Capsule and generate agent recognition files in any project:

```bash
npx skillcap init --project "My Project Name"
```

This command will:
1.  **Initialize Structure:** Create the `.skillcapsule/` directory and all subfolders.
2.  **Generate Config:** Create a default `skillcapsule.config.json` with risk-sensitive budgeting.
3.  **Enable Agent Recognition:** Automatically generate `CLAUDE.md`, `.cursorrules`, and `GEMINI.md` to ensure your AI assistant recognizes the skill registry immediately.

## Agent Recognition

Skill Capsule is recognized by all major AI coding assistants:
- **Claude Code:** via `CLAUDE.md`
- **Cursor:** via `.cursorrules`
- **Gemini:** via `GEMINI.md`
- **Codex / Kilo Code:** via atomic atom triggers in `.skillcapsule/atoms/`

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
