## Task

Summarize where we are: what we've accomplished, the current state, and next steps. Write the summary to the branch-scoped progress file.

### Steps

1. **Get current branch:** Run `git branch --show-current`.
2. **Resolve progress path:**
   - Slug = part after last `/` in branch (or full branch if no slash).
   - Target: `.claude/progress/{slug}/progress.md`
   - If that folder does not exist, check for any folder under `.claude/progress/` whose name is contained in the branch name; use the longest match.
   - If still none, create `.claude/progress/{slug}/`.
3. **Write summary** to the resolved `progress.md`:
   - **Active Branch** — current branch (and parent if applicable)
   - **Session Work** — what was done (problem, solution, files changed)
   - **Pending / Next Steps** — QA, PRs, follow-ups
4. **Prompt User** Ask user if they would like to run the /clear command and if they confirm then run it.

Match the structure used in existing progress files (e.g. `.claude/progress/apt-condo/progress.md`).
