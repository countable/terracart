# CLAUDE.md

## Parallelism rules

- **Don't use `git stash` or `git worktree`** for parallel work.
- If two pieces of work would touch the same file, **do not parallelize them**.
  Either run them serially in one agent, or split the work along file
  boundaries so each agent owns disjoint files.
- Before spawning multiple agents, list the files each one would write and
  confirm the sets don't overlap. If they overlap, restructure or serialize.

## Subagent rules

- **Subagents must NOT run any `git` commands.** No `git add`, `git commit`,
  `git push`, `git stash`, `git checkout`. The parent agent handles every
  git operation. Give the subagent the commit SHA / branch state it needs
  in its prompt instead of asking it to look git up.
- **Subagents must NOT modify `index.html`.** The script-tag list and
  cache-bust `?v=NN` is the parent's responsibility. The subagent reports
  *what* should be added; the parent edits index.html in one place at the end.
- For multi-file refactors that delete from a shared file (e.g. extracting
  modules from `app.js`), tell each subagent to **CREATE its new module
  only** and **report exact line ranges to delete from the shared file**.
  The parent does the deletions in one coordinated pass after all subagents
  return — this avoids merge-conflict-style line-number drift between
  parallel agents touching `app.js`.

## Commits

- **Do not commit on the user's behalf without asking.** Always draft the
  commit message first, show the user, and wait for explicit approval
  (`commit`, `yes`, `go ahead`) before running `git commit`.
- Pushing requires a separate explicit ask.
