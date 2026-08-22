// =============================================================================
// Bash tool description.
//
// Kept out of bash.ts because it is prose, not logic: it gets iterated on
// independently of the executor, and it is the only lever we have over *which*
// tool the model reaches for. The routing section below is the point — a
// `cat`/`grep`/`find` run through the shell costs far more context than the
// dedicated tool (no line numbers, no per-tool caps, no read dedup), and the
// model will default to the shell unless told not to.
// =============================================================================

export const BASH_DESCRIPTION = `Run a shell command.

This tool is for terminal operations — git, package managers (npm/pnpm/yarn/bun), build and test runners, docker, language toolchains, and one-off scripts.

## Do not use bash for file operations

Each of these has a dedicated tool that costs less context and gives you more:

- Read a file: \`read\` (NOT cat/head/tail/sed -n). It numbers the lines, caps its own output, takes offset/limit for one region, and won't re-send a file you already have.
- Find files by name: \`glob\` (NOT find), or \`ls\` for one directory.
- Search file contents: \`grep\` (NOT grep/rg/ag).
- Create or overwrite a file: \`write\` (NOT echo >, > redirect, or a cat heredoc).
- Change part of a file: \`edit\` (NOT sed -i/awk/perl -i).

Shell equivalents burn context and drop the line numbers the edit tools need. Use bash for file work only where no dedicated tool covers it — \`mv\`, \`chmod\`, \`mkdir -p\`, piping between programs.

## Running commands

- Non-interactive only: stdin is closed, so anything that waits on a prompt fails rather than hanging. Pass \`-y\`, \`--yes\`, \`--no-input\`.
- Use the \`workdir\` parameter instead of \`cd\` — a \`cd\` does not carry over to the next call.
- Quote paths containing spaces: \`ls "/tmp/my dir"\`.
- \`timeout\` is in milliseconds (default 60000). Raise it for long builds and test suites.
- Chain dependent steps with \`&&\` in one call; send independent commands as parallel tool calls in a single message.
- Output is capped. A truncation marker names the \`output\` tool call that pages through the rest — use it instead of re-running the command.

## Git

- Before committing, check \`git status\`, \`git diff\` and \`git log --oneline -10\` to match the repo's message style, and stage files by name — \`git add -A\` sweeps in secrets, build artifacts, and other agents' work. Use \`gh\` for PRs, issues, and checks.
- Never skip hooks (\`--no-verify\`) or change git config. A hook rejection means the commit did not happen, so make a NEW commit rather than \`--amend\`, which would rewrite the previous unrelated one. \`push --force\`, \`reset --hard\`, \`checkout .\`, \`clean -f\` and \`branch -D\` only on an explicit request.`;
