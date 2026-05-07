## Session Handoff (save-my-session)

You have save-my-session installed. It converts Gemini CLI sessions into Claude Code / Codex native format so the next agent can pick up right where you left off — no re-briefing needed.

### When to hand off

When the user says they want to switch agents (e.g. "transfer to Claude", "switch to Codex"), follow the handoff flow below.
You cannot detect quota limits or count conversation turns — those signals are invisible to you. The user decides when to switch.

### Why you must write a handoff summary first

save-my-session **only transfers user / assistant text messages**. Tool calls, tool outputs, and internal reasoning are not included. This means the next agent cannot see what files you read, what commands you ran, or what outputs you saw — only the words exchanged between you and the user.

The user runs the transfer command **outside the conversation** — you will not know when they press Enter. So **do not wait until the moment of handoff to add context**. As soon as you sense this session may be transferred (e.g. you've mentioned a quota concern, or the user has expressed a desire to switch), **write the handoff summary in that same reply** so it stays in the conversation history. It doesn't matter when the transfer actually happens.

### What to include in the handoff summary

In the **same reply** where you propose the transfer, include a standalone markdown block:

```
## Handoff summary

**What we're doing**: (1-2 sentences describing the main task of this session)

**Completed**:
- (bullet list, specific to file paths / function names / commit hashes)

**Files changed**:
- `path/to/file.ts:line` — what was changed and why
- (include uncommitted changes too)

**Key decisions and rationale**:
- (why option X was chosen over Y, referencing files / docs / user preferences)

**Not done yet / next steps**:
- (the first thing the next agent should do)

**Gotchas to watch out for**:
- (e.g. "logic on line N looks suspicious but left alone", "this test is flaky")
```

When writing the summary, **translate key findings from tool outputs into plain language** (e.g. "I read `foo.ts` and found it uses pattern X"). Do not write vague sentences like "did a refactor" — they carry no information for the next agent.

### Handoff flow

Tell the user to run one of the following from the **project root**:

- Transfer to Claude Code:
  ```
  save-my-session transfer --from gemini --to claude
  ```
- Transfer to Codex:
  ```
  save-my-session transfer --from gemini --to codex
  ```

After the command completes, tell the user to:
1. Open the target CLI (`claude` or `codex`)
2. Use `/resume` (or the agent's session history picker) to select the transferred session
3. The full conversation history will be there

(The default flow is **transfer → open CLI → `/resume` to pick session**. The session is not loaded automatically just by opening the CLI.)

### Useful commands (for the user's reference)

- List transferable sessions for this project: `save-my-session list --from gemini`
- Transfer a specific session: `save-my-session transfer --from gemini --to claude --session <hash>`
- Append new progress from another agent back into this session: `save-my-session append --from claude --to gemini --target <this-session-hash>`

### Notes
- Commands use `cwd` as the project identifier, so **always run from the project root** or the session won't be found.
- If not in the root, add `--cwd <project-root>`.
