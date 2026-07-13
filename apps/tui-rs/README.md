# freecode-tui (Rust)

A ratatui-based TUI client, coexisting with `apps/tui` (the pi-tui client)
while it's being designed. Both speak the same JSON-RPC + newline-delimited
stream-event protocol to the `apps/core` daemon — this crate does not touch
the agent loop, browser automation, or parsing. It only renders.

## Layout

- `src/ipc/protocol.rs` — wire types mirroring `packages/shared/src/ipc/protocol.ts` and `types.ts`. Keep in sync by hand when the TS protocol changes.
- `src/ipc/client.rs` — spawns `apps/core/dist/server.js` (or falls back to `npx tsx apps/core/src/server.ts`), same as `apps/tui/src/ipc/client.ts`. Correlates JSON-RPC requests/responses by id, forwards bare `StreamEvent` lines over a channel.
- `src/app.rs` — state only: messages, session id, status. No rendering, no IPC.
- `src/ui/mod.rs` — all layout/styling/widgets. This is the file to gut for the redesign.
- `src/main.rs` — terminal setup, event loop (crossterm input + IPC stream events merged via `tokio::select!`).

## Run

```sh
# from the repo root, with apps/core built (pnpm --filter @thisisayande/freecode-core build)
cd apps/tui-rs
cargo run
```

`Esc` or `Ctrl+C` quits. `Enter` sends the current input line to the active session.

## What's intentionally missing

This is a blank canvas, not a feature-complete client — no session resume/list,
no model/provider picker, no tool-arg rendering, no scrollback beyond a raw
line counter. Build these against `IpcClient` in `ipc/client.rs` (the RPC
surface already covers `session.start/send/stop` and `providers.list`; add
methods there as needed) and design the actual look in `ui/mod.rs`.
