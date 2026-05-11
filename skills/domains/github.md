# GitHub Upload Skill

## GitHub Upload Safety <!-- @id: github-upload-safety -->
Objective: Safely upload project data to GitHub repositories.

Triggering Keywords:
- `upload to github`
- `publish to github`
- `push to github`
- `github upload`
- `git publish`

Safety Protocol (CRITICAL):
1.  **Project Isolation:** Remove all data belonging to other projects from the current workspace.
2.  **Secret Scrubbing:** Ensure NO sensitive information (API Keys, Passwords, etc.) is present.
3.  **Local Environment Cleaning:** Remove all local URLs (e.g., `localhost`, `127.0.0.1`).
4.  **Security Audit:** Verify `.env` is in `.gitignore`.

## GitHub Push Confirmation <!-- @id: github-push-confirmation -->
Requires explicit user approval before executing `git push`.
Targets specific branch and remote.
