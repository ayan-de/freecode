# Anthropic OAuth (Claude Pro/Max subscription) as an auth mode for the `anthropic` provider

**Status:** Phases 0–2 built (2026-09-05). Phase 0 — `providers/anthropic-oauth.ts`,
`providers/auth-store.ts`, OAuth branches in `generic-provider.ts` /
`config.ts` / `pricing.ts`, tests in `anthropic-oauth.test.ts`. Phase 1 —
`providers/anthropic-oauth-login.ts` (PKCE, authorize URL, code parsing,
exchange, localhost callback server) + `cli/commands/auth.ts`
(`freecode auth login|status|logout`), tests in
`anthropic-oauth-login.test.ts`. Phase 2 — Cloudflare diagnosis on both token
paths, the org-forbidden 403 latch + API-key fallback, and cost stamped on the
call rather than read from live config (see §5). **Tool-name mapping is
deliberately NOT built** — §9 Q1 is still open, and Phase 2 conditions that
work on Q1 resolving against us. Every phase's §6 exit criterion is still
unverified — no real turn and no real login have been run, so treat the
endpoint details as jcode-derived, not observed.
**Date:** 2026-09-05
**Prior art:** jcode (`~/Projects/githubProjects/agents/jcode`), read in full for this spec
on 2026-09-05 — `crates/jcode-base/src/auth/oauth.rs` (PKCE login, exchange, refresh,
single-flight coordinator), `crates/jcode-base/src/sidecar.rs` (identity block rules,
API-key/OAuth split), `crates/jcode-provider-core/src/anthropic.rs` (beta headers),
`crates/jcode-provider-anthropic/src/lib.rs` (OAuth tool-name mapping + curated
schemas), `crates/jcode-app-core/src/external_auth.rs` (importing the official Claude
Code login). OpenCode implements the same surface.
**Extends:** `2026-09-02-dynamic-provider-catalogue-design.md` — this is an *auth mode*
on the existing `anthropic` catalogue entry, not a new provider file. The
one-generic-driver rule stands.
**Related specs:** `2026-05-28-multi-provider-api-design.md`,
`2026-08-29-gemini-web-provider.md` (the other "use my subscription, not an API key"
provider — read its §0 for how we framed the same risk there),
`2026-08-10-agent-observability.md` (cost accounting constraint, §Cost).

---

## 0. Read this first (plain language)

FreeCode talks to Anthropic with an API key, billed per token. The user already pays
for a Claude Pro/Max subscription, which includes a large inference allowance — but
that allowance is only reachable through Anthropic's OAuth surface, and that surface
only answers requests that look like Claude Code.

Every third-party agent that offers "log in with your Claude subscription" (jcode,
OpenCode, others) does it the same way: use Claude Code's own OAuth client id, send
Claude Code's `User-Agent` and `anthropic-beta` headers, and put the string
*"You are Claude Code, Anthropic's official CLI for Claude."* as the first system
block. jcode's own source calls this a **spoof**, and that is the right word.

### 0.1 The risk, stated plainly

- Anthropic's terms reserve Pro/Max subscription inference for official surfaces.
  Using it from freecode is a ToS gray-to-red zone, however common it is in the
  open-source agent ecosystem.
- Anthropic has actively interfered with tools doing this. jcode carries a dedicated
  error message for being blocked by a Cloudflare challenge at the token endpoint,
  and a scope-validation path for tokens that refresh successfully but are refused
  at inference time. Both are scars from enforcement, not theory.
- The blast radius is the **user's own Claude account**. Not freecode's keys, not
  freecode's infra.

Consequences for the design:

1. **Opt-in, never default.** API key stays the default auth mode. OAuth activates
   only when the user explicitly configures it or explicitly runs the login command.
2. **The identity block is quarantined to the OAuth path.** A request authenticated
   with a real API key must never carry the Claude Code identity string. jcode
   enforces this split in code (`build_claude_api_key_system_param` vs the OAuth
   builder) and we adopt it as an invariant with a test.
3. **First-run disclosure.** `freecode auth login anthropic` prints one paragraph:
   what this does, that it impersonates Claude Code, that Anthropic may block or
   action the account. No repeated nagging afterward.

## 1. Motivation

1. The user pays for Claude Max. Freecode dev loops (evals excepted — see §8) burn
   API-key dollars that the subscription would cover.
2. jcode's implementation is local, complete, battle-tested, and readable — the cost
   of porting the *protocol* knowledge is already paid. What remains is wiring it
   into freecode's seams, which are unusually good for this (per-request `fetch`
   wrapper already exists for timeouts).
3. Every serious freecode competitor ships this. Its absence is a daily paper cut.

## 2. Goals / non-goals

**Goals.** `freecode auth login anthropic` completes a PKCE browser flow (with a
paste fallback) and stores tokens; the `anthropic` provider transparently uses them
when in OAuth mode; tokens refresh automatically and safely (single-flight, rotation-
aware); the API-key path is byte-identical to today. Phase 0 is even smaller: reuse
the official Claude Code login already on this machine.

**Non-goals.** Multi-account support (jcode has it; we don't need it — YAGNI).
Bedrock/Vertex. OpenAI/Codex OAuth (same file in jcode, different spec if ever).
Making OAuth the default. Hiding what this is.

## 3. The protocol (as implemented by jcode, verified against its tests)

### 3.1 Constants

| Thing | Value |
| --- | --- |
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code's) |
| Authorize URL | `https://claude.com/cai/oauth/authorize` |
| Token URL | `https://platform.claude.com/v1/oauth/token` |
| Manual redirect URI | `https://platform.claude.com/oauth/code/callback` |
| Profile URL | `https://api.anthropic.com/api/oauth/profile` |
| Login scopes | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| Refresh scopes | same minus `org:create_api_key` |

**Trap (jcode learned this the hard way):** the *console* authorize endpoint
(`platform.claude.com/oauth/authorize`) mints tokens that **refresh successfully but
are rejected by the inference API**. Only the claude.ai surface
(`claude.com/cai/oauth/authorize`) yields `user:inference` tokens. Validate the
scope on every exchange and refresh; fail loudly if `user:inference` is absent
rather than storing a token that will 403 later.

### 3.2 Login (PKCE)

1. Verifier: 64 chars from `[A-Za-z0-9]`. Challenge: `base64url(sha256(verifier))`,
   no padding. **State = the verifier** (jcode's convention; the token endpoint
   expects `state` and this binds it to the PKCE secret).
2. Authorize URL query: `code=true&client_id=…&response_type=code&redirect_uri=…&scope=…&code_challenge=…&code_challenge_method=S256&state=…`.
3. Callback: bind `127.0.0.1:<ephemeral>`, redirect URI
   `http://localhost:<port>/callback`, wait ≤120 s. On timeout/bind-failure, fall
   back to the manual redirect URI and let the user paste the full callback URL or
   the code (accept plain code, URL with `code=`, or OpenCode-style `code#state`).
4. Exchange: **JSON** POST (not form-encoded — Anthropic's endpoint wants JSON) to
   the token URL: `{grant_type:"authorization_code", code, redirect_uri, client_id,
   code_verifier, state}`. If the callback carried a non-empty `state` that differs
   from the verifier, abort (stale/CSRF).
5. Response: `{access_token, refresh_token, expires_in, scope?}`. Store
   `expires_at = now_ms + expires_in*1000`, parsed scopes.

### 3.3 Refresh

- JSON POST `{grant_type:"refresh_token", refresh_token, client_id, scope:<refresh
  scopes>}`. On an `invalid_scope` error, retry once **without** `scope` (legacy
  tokens). Response may omit `refresh_token`; keep the old one then.
- **Anthropic rotates refresh tokens.** Two concurrent refreshes can persist a dead
  token and permanently break the login. Refresh must be single-flighted, and before
  refreshing, re-read the store: if the stored refresh token differs from the one
  the caller observed and the stored expiry is fresh, someone already refreshed —
  use the stored tokens and skip the network call.
- A refresh the endpoint permanently rejected must be marked terminal (don't retry
  it on every request forever; surface "run `freecode auth login anthropic`").

### 3.4 Request shaping at `/v1/messages`

| Header | OAuth value |
| --- | --- |
| `Authorization` | `Bearer <access_token>` — and **no `x-api-key`** |
| `anthropic-beta` | `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,…` (jcode's current full list is in `jcode-provider-core/src/anthropic.rs`; start with `claude-code-20250219,oauth-2025-04-20` plus whatever betas we already send, and extend only on observed rejection) |
| `User-Agent` | `claude-cli/2.1.257 (external, sdk-cli)` (version drifts; copy jcode's current) |

Body requirements:

- **System param:** two prepended blocks, in the official CLI's order, then our
  real system prompt:
  1. `x-anthropic-billing-header: cc_version=2.1.257; cc_entrypoint=sdk-cli; cch=33f85;`
     — Claude Code's **billing attribution**, which jcode observed in the real
     CLI's system blocks (`OAUTH_BILLING_HEADER`). Despite the name it is a
     system block, not an HTTP header. `cc_version` must stay in lockstep with
     the spoofed `User-Agent`; `cch` is an opaque build hash. Added 2026-09-05
     after re-reading jcode — Phases 0–2 shipped without it.
  2. `You are Claude Code, Anthropic's official CLI for Claude.`

  Cache breakpoints unchanged, and neither prepended block carries a cache
  marker: Anthropic caches everything up to a marked block, so a marker here
  would cut the caller's cached prefix short.
- **Tools:** jcode maps its local names to Claude Code's for a builtin subset
  (`bash`→`Bash`, `read`→`Read`, `subagent`→`Agent`, …) and ships curated
  schemas for them. **It is not an access or billing requirement**: the mapping
  falls through as `_ => name`, and jcode explicitly forwards every other
  registered tool (websearch, webfetch, memory, …) under its own name — which
  it could not do if the endpoint demanded Claude Code's names. What the
  mapping buys is tool-use *quality*, since the model has strong priors on
  those names and schemas. What it costs is on the record too: jcode's
  `oauth_tool_schema_tests.rs` exists because hand-curated schemas drifted from
  the real handlers and silently broke every `ScheduleWakeup` call (their
  #706). **We ship without the mapping** and port it only if a real turn shows
  rejection or visible degradation — see §9 Q1.

### 3.5 Credential storage

`~/.freecode/auth.json`, mode `0600`:

```json
{
  "anthropic": {
    "type": "oauth",
    "access_token": "…",
    "refresh_token": "…",
    "expires_at": 1757000000000,
    "scopes": ["user:profile", "user:inference", "…"]
  }
}
```

Separate file from `config.json` on purpose: config is user-edited and sometimes
committed to dotfiles; tokens are machine-written secrets. **Checked 2026-09-05:**
the tokens are `sk-ant-oat01-…`/`sk-ant-ort01-…`, already covered by
`secret-filter.ts`'s `\bsk-ant-` pattern, so a memory quoting one is never
embedded. Pinned by a test there rather than left as an assertion — note the
generic `token[:=]value` pattern does NOT match JSON-quoted keys
(`"access_token": "…"`), so the `sk-ant-` prefix is doing the work.

## 4. Where it wires into freecode

The constraint: Anthropic goes through the generic driver + `@ai-sdk/anthropic`, and
the API key is read inside `getSdk()` (`generic-provider.ts`). The seam is **a
composed `fetch`, not the SDK's `apiKey`** — we already wrap fetch for timeouts
(`fetch-timeout.ts`), header rewriting is a two-line composition, and per-request is
exactly where token refresh has to live anyway.

| Piece | File | Change |
| --- | --- | --- |
| OAuth core | `providers/anthropic-oauth.ts` (new) | Constants, PKCE, exchange, refresh (single-flight + rotation-aware), token store, `getAccessToken()` (refreshes when < 5 min to expiry), `importClaudeCodeCredentials()` (Phase 0) |
| CLI | `cli/` (new subcommand) | `freecode auth login anthropic`, `freecode auth status`, `freecode auth logout anthropic`. Login prints the §0.1 disclosure once |
| Fetch wrapper | `providers/generic-provider.ts` | In OAuth mode, compose `createTimeoutFetch()` with a wrapper that awaits `getAccessToken()`, deletes `x-api-key`, sets `authorization` + `anthropic-beta` + `user-agent`. Pass a dummy `apiKey` to `createAnthropic` so construction doesn't throw |
| Key resolution | `providers/config.ts` | `getApiKey`/`hasApiKey` grow an OAuth-aware branch so provider listing shows anthropic as configured without a key |
| System param | `providers/utils.ts` (`buildAnthropicSystemParam`) | OAuth mode prepends the identity block. API-key path untouched — **invariant, tested** |
| Mode selection | `providers/config.ts` + catalogue | `providers.anthropic.authMode: "oauth" \| "api-key"` (`"apiKey"` accepted too), plus the `FREECODE_ANTHROPIC_AUTH` env pin, default api-key. Unset + no API key + stored OAuth creds in `~/.freecode/auth.json` ⇒ OAuth (mirrors jcode's resolution, keeps zero-config working after a login; an importable Claude Code login alone does NOT flip the mode — import runs only once OAuth mode is active) |
| Cost | `providers/pricing.ts` | See §5 |

No new provider id. `supportsTools` stays true. Streaming, thinking, and caching go
through the same normalized path — the OAuth endpoint speaks the same Messages SSE.

## 5. Cost accounting

Subscription inference has no per-token dollar price. Per the existing pricing
invariant ("an unknown model prices as `undefined`, never 0 or a near-miss"), an
OAuth-authenticated span's cost is **`undefined`, not $0** — a $0 would poison
`freecode trace` cost rollups and any future cost-efficiency eval with fake savings.
Token counts still flow (usage accounting is orthogonal to auth). The trace verdict
line says "subscription" where it would say a dollar figure.

**The auth mode is a property of the CALL, not of the reader** (corrected in
Phase 2). Phase 0 had `priceUsd` consult `anthropicAuthMode()` directly, which
meant a single login repriced every historical API-key session as
"subscription", and the price of a span depended on which machine folded the
log — it also made `otlp.test.ts` fail on any developer machine holding an
OAuth login. `model.response` now carries `authMode: "oauth"`, stamped by
`agent/loop.ts` when the call is made; `ModelSpan` carries it through the fold,
and `priceUsd(provider, model, usage, authMode?)` takes it as an argument.
`pricing.ts` no longer imports `config.ts` at all. A mixed session totals the
metered calls and marks the total partial, with the `*` explained as
subscription rather than as an unpriced model.

## 6. Phases

**Phase 0 — borrow the official login (smallest useful thing).**
`importClaudeCodeCredentials()` reads `~/.claude/.credentials.json` (the machine
already runs Claude Code), plus refresh, the fetch wrapper, and the identity block.
No login flow, no callback server. Proves the endpoint end-to-end: one real turn with
tools through the subscription. Exit criterion: a normal freecode session (read →
edit → bash) completes on OAuth with cost shown as subscription.

**Phase 1 — own login flow (built 2026-09-05).** PKCE + localhost callback +
paste fallback + `auth login/status/logout`. Exit criterion: login on a machine
without Claude Code installed — **not yet run.**

Notes from the build:
- `state` is the PKCE verifier (jcode's convention), so the exchange needs the
  verifier the authorize URL was built with. That makes login inherently
  single-process: there is no `--code` flag, because a fresh process has a fresh
  verifier and its exchange would always fail.
- The callback listener binds an ephemeral 127.0.0.1 port. A bind failure is not
  an error — it degrades to the manual redirect URI and a paste prompt, which is
  also what `--no-browser` selects.
- A successful login **pins** `providers.anthropic.authMode: "oauth"` in
  config; `auth logout` deletes the stored tokens and un-pins it. §0.1 counts an
  explicit login as an explicit opt-in, and pinning is what makes the login
  stick on a machine that also has `ANTHROPIC_API_KEY` set (the unpinned
  fallback prefers the key).

**Phase 2 — hardening (built 2026-09-05).** Terminal refresh-rejection state
(Phase 0's in-process latch, messages now pointing at `freecode auth login`);
`looksLikeCloudflareChallenge` + one shared message, applied to **both** the
refresh and the exchange — and deliberately **not** marked terminal, since the
same token works from another network; automatic API-key fallback on the
"OAuth not allowed for this organization" 403.

Tool-name mapping is **not** built: §9 Q1 is unresolved, and this phase makes
it conditional on Q1 resolving against us. The smoke test decides.

How the fallback works, and why it is shaped this way:
- **Detection is at the fetch**, not at the error. `generateText` throws a 403
  while `streamText` surfaces it as an error chunk; the OAuth fetch wrapper
  sees the same raw body on both paths, so it latches there
  (`markAnthropicOAuthForbidden`) and both callers just ask whether the latch
  moved.
- **The latch takes the whole OAuth path out of service** for the process, so
  `usesAnthropicOAuth()` answers false for SDK construction *and* for the
  system param. That is load-bearing for §0.1: a fallback request goes out on
  a real API key and must therefore carry no Claude Code identity block. Tested.
- **Streaming retries only on the first chunk.** Once anything has been yielded
  the turn is committed, and a retry would duplicate output.
- No key configured ⇒ no fallback, and the original error stands.

## 7. Testing

- **Unit, mock token server** (jcode's `oauth_tests/` is the template): exchange
  happy path; exchange with state mismatch aborts; refresh rotates and persists;
  refresh single-flight (two concurrent callers, one network call); `invalid_scope`
  fallback; missing `user:inference` fails loudly.
- **`generic-provider.test.ts` additions:** OAuth mode's fetch rewrites headers
  (bearer present, `x-api-key` absent, betas present); API-key mode's request
  carries **no identity block and no OAuth headers** — the §0.1 invariant as a test.
- **Live smoke, manual only:** one real turn per phase exit criterion. Never in CI —
  same reasoning as the eval harness's `workflow_dispatch`-only rule, plus this one
  spends the user's subscription allowance and login state.

## 8. Interaction with the eval harness

Tempting: run `pnpm eval` on the subscription. **Don't, for judged/gated runs.** The
eval gate compares against a baseline on the same resolved model; the OAuth endpoint
may route to differently-tuned serving (and its beta set differs), so an OAuth run is
not the same instrument as an API-key run. Casual `eval ab` exploration on the
subscription is fine — that's a report, not a gate.

**Built 2026-09-05.** `SuiteReport.authMode` is recorded the way `judge` is, and
`baselineFor(suite, model, authMode)` refuses to compare across a mode switch,
in both directions. An absent mode on either side normalises to `api-key`:
every baseline written before this landed has no mode, and treating that as a
mismatch would discard all of them.

## 9. Open questions

1. **Tool acceptance.** Does the OAuth endpoint accept our tool names/schemas as
   custom tools, or does it require Claude Code's curated names? jcode's code
   says custom names are accepted (see §3.4), so the open part is only whether
   tool-use *quality* degrades under our names. The smoke test answers it
   before we write any mapping code — and the mapping's own regression history
   in jcode is a reason not to write it speculatively.
2. **Version drift.** The spoofed `User-Agent`, the billing block's
   `cc_version`/`cch`, and the beta list rot as Claude Code ships. jcode centralizes them as constants and bumps them; we do the
   same and accept the maintenance. A stale version string is also a plausible
   future enforcement lever — if OAuth requests start failing, check here first.
3. **`~/.claude/.credentials.json` format stability.** Phase 0 parses a file owned
   by another program. Guard with a schema check and a clear "re-run Phase 1 login"
   error, not a crash.
4. **Rate-limit UX.** Subscription tiers throttle differently from API keys
   (5-hour windows). Do we surface Anthropic's rate-limit headers in the TUI, or let
   429s speak for themselves? Deferred until it hurts.

5. **Identity string divergence.** jcode now sends
   `"You are a Claude agent, built on Anthropic's Claude Agent SDK."`, pairing
   with its `cc_entrypoint=sdk-cli` billing value, while this spec (and our
   code) sends the older `"You are Claude Code, Anthropic's official CLI for
   Claude."`. Our `User-Agent` already says `sdk-cli`, so we are currently
   mixing vintages. Unresolved deliberately: changing the identity string is
   exactly the kind of thing that should be decided by an observed turn, not by
   guessing. Check this first if requests start being refused.
