# FreeCode — Browser-AI Coding Agent

**Date:** 2026-05-08
**Status:** Draft

## Overview

FreeCode is a CLI tool that uses the user's existing ChatGPT browser session as the AI runtime for coding tasks. Instead of paying for API access, it automates a logged-in ChatGPT tab via Playwright + CDP, sends project context, parses structured responses, and applies file changes locally.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Prompt                           │
│                   (interactive TS CLI)                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Playwright + CDP                           │
│            (connects to existing Chrome tab)                 │
│              User already logged into ChatGPT                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       ChatGPT                                │
│              (user's paid subscription)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Response Parser                           │
│         (handles JSON / markdown / tool format)              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   File Applicator                            │
│                  (applies changes to disk)                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. CLI (TypeScript)

Interactive REPL-style interface. Accepts natural language prompts from the user.

Responsibilities:
- Read user prompts
- Display streamed output and file operation feedback
- Handle errors visibly
- Manage conversation context across turns

### 2. Browser Controller (TypeScript + Playwright)

Uses Chrome DevTools Protocol (CDP) to connect to an existing Chrome instance where the user is already logged into ChatGPT.

Responsibilities:
- Launch/attach to Chrome via CDP
- Navigate to ChatGPT
- Inject structured prompts into the chat input
- Detect streaming completion
- Scrape the response

Key technical approach:
- `playwright.connectOverCDP()` to existing Chrome
- `MutationObserver` or button state detection to know when streaming is done
- DOM injection via `page.locator().fill()` + keyboard submit

### 3. Context Engine (TypeScript)

Handles project context collection and intelligent file selection.

**Two-phase flow:**

**Phase 1 — File tree request:**
- Send project file tree + user prompt to ChatGPT
- ChatGPT responds with which files it needs
- Context engine retrieves those files

**Phase 2 — Full request:**
- Send the requested files + prompt to ChatGPT
- Receive structured response

Responsibilities:
- File tree generation
- File reading
- Context compaction (future: graphify/contextcarry integration)

### 4. Response Parser (TypeScript)

Format-agnostic parser that handles multiple response styles.

Handles:
- **JSON:** `{ "changes": [{ "file": "path", "action": "replace", "content": "..." }] }`
- **Markdown:** `FILE: path/to/file.ts` followed by code block
- **Tool format:** Structured tool calls (future-proofing)

Fallback logic: try JSON first, then markdown patterns, then tool format.

### 5. File Applicator (TypeScript)

Applies parsed changes to the local filesystem.

Responsibilities:
- Create/update/delete files based on parsed instructions
- Show diff preview before applying (safety gate)
- Handle errors gracefully

## Data Flow

1. User types prompt in CLI
2. CLI sends prompt to browser controller
3. Browser controller injects prompt into ChatGPT (Phase 1)
4. ChatGPT returns list of needed files
5. Context engine reads those files
6. Browser controller sends files + prompt to ChatGPT (Phase 2)
7. ChatGPT returns structured response
8. Response parser extracts file changes
9. File applicator shows diff preview
10. User approves, files are written

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MVP scope | ChatGPT only | Simplest DOM, fastest validation |
| Browser connection | CDP to existing Chrome | User stays logged in, no extra browser |
| Context strategy | Two-phase | Token-efficient, plays to graphify/contextcarry strengths |
| Response parsing | Format-agnostic | Robust against LLM output variation |
| File safety | Diff preview before apply | User trust, prevents blind overwrites |
| TUI | TypeScript CLI first | Validate core before investing in Rust |
| Rust TUI | Deferred | Wiring mechanism complexity unjustified until core works |

## File Structure

```
freecode/
├── apps/
│   └── cli/                 # Main CLI application
│       ├── src/
│       │   ├── index.ts     # Entry point
│       │   ├── cli.ts       # REPL interface
│       │   ├── commands/    # Command handlers
│       │   ├── lib/
│       │   │   ├── browser/  # Playwright + CDP controller
│       │   │   ├── context/  # Context engine (graphify-ready)
│       │   │   ├── parser/   # Response parser
│       │   │   └── applier/  # File applicator
│       │   └── types/       # Shared types
│       └── package.json
├── packages/
│   └── shared/              # Shared types and utilities
│       ├── src/
│       └── package.json
├── docs/
│   └── specs/              # Design documents
└── package.json
```

## Deferred Items

These are intentionally deferred until core flow is validated:

- **Rust TUI** — Split CLI rendering into Rust for richer terminal UI
- **Provider adapters** — Claude, Gemini support
- **Context intelligence** — graphify/contextcarry integration for smart file ranking
- **VS Code extension** — Full IDE integration
- **Autonomous multi-step agents** — Self-directed file editing across multiple turns
- **Vector DB / semantic search** — For large codebase context selection

## Risks

| Risk | Mitigation |
|------|------------|
| ChatGPT DOM changes break selectors | Maintain per-site adapters, fallback selectors, monitoring |
| LLM generates invalid JSON | Format-agnostic parser with markdown/tool fallbacks |
| Response too large for context | Two-phase approach limits token usage |
| ToS concern (automation of web UI) | Personal use / side project; user controls browser session |
| File overwrites corrupt code | Always show diff preview before applying |

## Success Criteria (MVP)

- [ ] CLI launches and accepts user prompts
- [ ] Playwright connects to existing Chrome via CDP
- [ ] Prompt successfully injected into ChatGPT
- [ ] Streaming response detected and scraped
- [ ] Response parsed (JSON or markdown)
- [ ] File changes applied to workspace
- [ ] User sees diff before changes are applied
- [ ] Error states handled gracefully with visible feedback
