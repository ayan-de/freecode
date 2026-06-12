# FreeCode MVP: Scalable Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MVP with architecture that can scale to multiple providers (ChatGPT, Claude, Gemini), multiple parsers, and easy feature additions.

**Architecture:** Interface-based design with clear boundaries — Browser Layer (provider-agnostic), Context Layer (configurable collectors), Parser Layer (strategy pattern), Command Layer (composable).

**Tech Stack:** TypeScript, Playwright, pi-tui, Node.js

---

## Scalable File Structure

```
apps/tui/src/
├── index.ts                      # Entry point (existing)
├── commands/
│   ├── index.ts                  # Command registry (existing)
│   ├── built-in.ts               # Built-in commands (existing)
│   └── freecode/
│       ├── index.ts              # /freecode orchestrator
│       ├── provider-mgr.ts       # Provider selection & management
│       ├── executor.ts           # Execute prompt cycle
│       └── file-applier.ts       # Apply parsed file changes
├── lib/
│   ├── browser/
│   │   ├── types.ts              # Browser interfaces
│   │   ├── controller.ts         # CDP connection manager
│   │   └── providers/
│   │       ├── index.ts          # Provider registry
│   │       ├── chatgpt.ts        # ChatGPT adapter
│   │       └── types.ts          # Provider interface
│   ├── context/
│   │   ├── types.ts              # Context interfaces
│   │   ├── collector.ts          # File tree collector
│   │   └── strategies/
│   │       ├── index.ts          # Strategy registry
│   │       └── file-tree.ts      # File tree strategy
│   ├── parser/
│   │   ├── types.ts              # Parser interfaces
│   │   ├── registry.ts           # Parser registry (strategy pattern)
│   │   ├── extractors/
│   │   │   ├── index.ts          # Extractor registry
│   │   │   ├── markdown.ts       # Markdown file block extractor
│   │   │   ├── json.ts           # JSON extractor
│   │   │   └── structured.ts     # Structured output extractor
│   │   └── index.ts              # Main parser orchestrator
│   └── utils/
│       ├── result.ts             # Result/Either type for error handling
│       └── logger.ts             # Structured logging
└── models.ts                     # Model definitions (existing)
```

---

## Scalability Principles Applied

| Principle                 | Implementation                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **Interface Segregation** | `BrowserProvider`, `ParserStrategy`, `ContextStrategy` — small focused interfaces               |
| **Dependency Inversion**  | High-level modules (executor) depend on abstractions, not concretions                           |
| **Single Responsibility** | Each file does one thing — controller handles CDP, provider handles DOM, parser handles parsing |
| **Strategy Pattern**      | Parser registry lets you chain multiple parsing strategies                                      |
| **Factory Pattern**       | Provider registry creates providers without coupling to concrete classes                        |
| **Result Type**           | No exceptions thrown across module boundaries — explicit `Result<T, E>` types                   |

---

## Task 1: Add Playwright Dependency

**Files:**

- Modify: `apps/tui/package.json`

- [ ] **Step 1: Add Playwright to dependencies**

Modify `apps/tui/package.json`:

```json
"dependencies": {
  "@earendil-works/pi-tui": "^0.74.0",
  "chalk": "^5.5.0",
  "playwright": "^1.42.0"
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd apps/tui && pnpm install`

- [ ] **Step 3: Install Chromium browser**

Run: `cd apps/tui && npx playwright install chromium`

- [ ] **Step 4: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add playwright dependency"
```

---

## Task 2: Utility Types (Result, Logger)

**Files:**

- Create: `apps/tui/src/lib/utils/result.ts`
- Create: `apps/tui/src/lib/utils/logger.ts`

- [ ] **Step 1: Create Result type**

```typescript
// apps/tui/src/lib/utils/result.ts
export type Result<T, E = string> =
  | { success: true; value: T }
  | { success: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { success: true; value: T } {
  return result.success === true;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return result.success === false;
}

export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result as Result<never, E>;
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value);
  }
  return result as Result<never, E>;
}
```

- [ ] **Step 2: Create Logger utility**

```typescript
// apps/tui/src/lib/utils/logger.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  private prefix: string;

  constructor(prefix = "") {
    this.prefix = prefix ? `[${prefix}] ` : "";
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${this.prefix}${level.toUpperCase()}: ${message}${metaStr}`);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}

export const logger = new ConsoleLogger("freecode");
```

- [ ] **Step 3: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add Result type and Logger utility"
```

---

## Task 3: Browser Layer (Scalable Provider System)

**Files:**

- Create: `apps/tui/src/lib/browser/types.ts`
- Create: `apps/tui/src/lib/browser/providers/types.ts`
- Create: `apps/tui/src/lib/browser/providers/chatgpt.ts`
- Create: `apps/tui/src/lib/browser/providers/index.ts`
- Create: `apps/tui/src/lib/browser/controller.ts`

- [ ] **Step 1: Create browser types (interfaces)**

```typescript
// apps/tui/src/lib/browser/types.ts
import type { Page, Browser } from "playwright";

export interface BrowserController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getPage(): Page | null;
}

export interface BrowserConfig {
  cdpUrl?: string;
  headless?: boolean;
}
```

- [ ] **Step 2: Create provider interface**

```typescript
// apps/tui/src/lib/browser/providers/types.ts
export interface PageAdapter {
  name: string;
  getInputLocator(page: Page): any;
  getSubmitButton(page: Page): any;
  getResponseLocator(page: Page): any;
  isStreaming(page: Page): Promise<boolean>;
  waitForLoadState(page: Page): Promise<void>;
}

export interface ProviderConfig {
  url: string;
  waitForNetworkIdle?: boolean;
}
```

- [ ] **Step 3: Create ChatGPT provider adapter**

```typescript
// apps/tui/src/lib/browser/providers/chatgpt.ts
import type { Page, Locator } from "playwright";
import type { PageAdapter } from "./types.js";

export class ChatGPTAdapter implements PageAdapter {
  name = "chatgpt";

  getInputLocator(page: Page): Locator {
    return page.locator("textarea");
  }

  getSubmitButton(page: Page): Locator {
    return page.locator('button[data-testid="send-button"]');
  }

  getResponseLocator(page: Page): Locator {
    return page.locator('[data-testid="turn"]').last();
  }

  async isStreaming(page: Page): Promise<boolean> {
    const stopButton = page.locator('button[aria-label="Stop generating"]');
    return stopButton.isVisible().catch(() => false);
  }

  async waitForLoadState(page: Page): Promise<void> {
    await page.waitForLoadState("networkidle");
  }
}
```

- [ ] **Step 4: Create provider registry**

```typescript
// apps/tui/src/lib/browser/providers/index.ts
import type { PageAdapter } from "./types.js";
import { ChatGPTAdapter } from "./chatgpt.js";

export interface ProviderDefinition {
  id: string;
  name: string;
  adapter: PageAdapter;
  config: {
    url: string;
  };
}

const providers: Map<string, ProviderDefinition> = new Map();

export function registerProvider(definition: ProviderDefinition): void {
  providers.set(definition.id, definition);
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return providers.get(id);
}

export function listProviders(): ProviderDefinition[] {
  return Array.from(providers.values());
}

export function createDefaultProviders(): void {
  registerProvider({
    id: "chatgpt",
    name: "ChatGPT",
    adapter: new ChatGPTAdapter(),
    config: {
      url: "https://chatgpt.com",
    },
  });
}
```

- [ ] **Step 5: Create browser controller**

```typescript
// apps/tui/src/lib/browser/controller.ts
import { chromium, type Browser, type Page } from "playwright";
import type { BrowserController, BrowserConfig } from "./types.js";
import type { PageAdapter } from "./providers/types.js";
import { logger } from "../utils/logger.js";

export class PlaywrightBrowserController implements BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private adapter: PageAdapter | null = null;
  private config: Required<BrowserConfig>;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      cdpUrl: config.cdpUrl || process.env.CDP_URL || "http://localhost:9222",
      headless: config.headless ?? false,
    };
  }

  setAdapter(adapter: PageAdapter): void {
    this.adapter = adapter;
  }

  async connect(): Promise<void> {
    try {
      logger.info("Connecting to Chrome via CDP", { url: this.config.cdpUrl });
      this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
      const context = this.browser.contexts()[0];
      this.page = context.pages()[0] || (await context.newPage());
      logger.info("Browser connected successfully");
    } catch (error) {
      logger.error("Failed to connect to Chrome", { error: String(error) });
      throw new Error(
        `Failed to connect to Chrome at ${this.config.cdpUrl}. ` +
          "Ensure Chrome is running with: chrome --remote-debugging-port=9222",
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      logger.info("Disconnecting browser");
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.page !== null;
  }

  getPage(): Page | null {
    return this.page;
  }

  async navigate(provider: PageAdapter): Promise<void> {
    if (!this.page) throw new Error("Not connected");
    await this.page.goto(provider.config.url);
    await provider.waitForLoadState(this.page);
    this.adapter = provider;
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.page || !this.adapter) {
      throw new Error("Not connected or adapter not set");
    }
    const input = this.adapter.getInputLocator(this.page);
    await input.fill(prompt);
    const submitButton = this.adapter.getSubmitButton(this.page);
    await submitButton.click();
  }

  async waitForResponse(): Promise<string> {
    if (!this.page || !this.adapter) {
      throw new Error("Not connected or adapter not set");
    }

    logger.debug("Waiting for streaming to complete");
    while (await this.adapter.isStreaming(this.page)) {
      await this.page.waitForTimeout(500);
    }

    await this.page.waitForTimeout(1000);

    const responseLocator = this.adapter.getResponseLocator(this.page);
    return responseLocator.innerText();
  }

  async executePrompt(prompt: string): Promise<string> {
    await this.sendPrompt(prompt);
    return this.waitForResponse();
  }
}
```

- [ ] **Step 6: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add scalable browser layer with provider system"
```

---

## Task 4: Context Layer (Strategy Pattern)

**Files:**

- Create: `apps/tui/src/lib/context/types.ts`
- Create: `apps/tui/src/lib/context/collector.ts`
- Create: `apps/tui/src/lib/context/strategies/file-tree.ts`
- Create: `apps/tui/src/lib/context/strategies/index.ts`

- [ ] **Step 1: Create context types**

```typescript
// apps/tui/src/lib/context/types.ts
export interface ProjectContext {
  projectPath: string;
  name: string;
  tree: string;
  files: Record<string, string>;
  metadata: ContextMetadata;
}

export interface ContextMetadata {
  collectedAt: number;
  fileCount: number;
  totalSize: number;
}

export interface ContextStrategy {
  name: string;
  collect(
    projectPath: string,
    options?: ContextOptions,
  ): Promise<ProjectContext>;
}

export interface ContextOptions {
  maxDepth?: number;
  ignorePatterns?: string[];
  includePatterns?: string[];
}
```

- [ ] **Step 2: Create base collector with file tree strategy**

```typescript
// apps/tui/src/lib/context/strategies/file-tree.ts
import * as fs from "fs";
import * as path from "path";
import type {
  ContextStrategy,
  ContextOptions,
  ProjectContext,
} from "../types.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vscode",
  ".idea",
  "*.lock",
  "*.log",
  ".cache",
  ".temp",
];

export class FileTreeStrategy implements ContextStrategy {
  name = "file-tree";

  async collect(
    projectPath: string,
    options: ContextOptions = {},
  ): Promise<ProjectContext> {
    const { maxDepth = 3, ignorePatterns = DEFAULT_IGNORE } = options;

    logger.info("Collecting project context", { projectPath, maxDepth });

    const tree = this.generateTree(projectPath, ignorePatterns, maxDepth);
    const files = this.collectFiles(projectPath, ignorePatterns, maxDepth);

    const metadata: ContextMetadata = {
      collectedAt: Date.now(),
      fileCount: Object.keys(files).length,
      totalSize: Object.values(files).reduce(
        (acc, content) => acc + content.length,
        0,
      ),
    };

    logger.info("Context collected", { fileCount: metadata.fileCount });

    return {
      projectPath,
      name: path.basename(projectPath),
      tree,
      files,
      metadata,
    };
  }

  private generateTree(
    dirPath: string,
    patterns: string[],
    maxDepth: number,
    currentDepth = 0,
  ): string {
    if (currentDepth > maxDepth) return "";

    let tree = "";
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (this.shouldIgnore(fullPath, patterns)) continue;

        const indent = currentDepth > 0 ? "  ".repeat(currentDepth) : "";
        const icon = entry.isDirectory() ? "📁 " : "📄 ";
        tree += `${indent}${icon}${entry.name}${entry.isDirectory() ? "/" : ""}\n`;

        if (entry.isDirectory()) {
          tree += this.generateTree(
            fullPath,
            patterns,
            maxDepth,
            currentDepth + 1,
          );
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return tree;
  }

  private shouldIgnore(filePath: string, patterns: string[]): boolean {
    const basename = path.basename(filePath);
    return patterns.some((pattern) => {
      if (pattern.startsWith("*")) return basename.endsWith(pattern.slice(1));
      return basename === pattern;
    });
  }

  private collectFiles(
    dirPath: string,
    patterns: string[],
    maxDepth: number,
    currentDepth = 0,
  ): Record<string, string> {
    const files: Record<string, string> = {};

    if (currentDepth > maxDepth) return files;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (this.shouldIgnore(fullPath, patterns)) continue;

        if (entry.isFile()) {
          const relativePath = path.relative(process.cwd(), fullPath);
          files[relativePath] = this.readFile(fullPath);
        } else if (entry.isDirectory()) {
          const childFiles = this.collectFiles(
            fullPath,
            patterns,
            maxDepth,
            currentDepth + 1,
          );
          Object.assign(files, childFiles);
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return files;
  }

  private readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return `// Error reading: ${filePath}`;
    }
  }
}
```

- [ ] **Step 3: Create strategy registry and main collector**

```typescript
// apps/tui/src/lib/context/strategies/index.ts
export * from "./file-tree.js";

import type { ContextStrategy } from "../types.js";
import { FileTreeStrategy } from "./file-tree.js";

const strategies: Map<string, ContextStrategy> = new Map();

export function registerStrategy(strategy: ContextStrategy): void {
  strategies.set(strategy.name, strategy);
}

export function getStrategy(name: string): ContextStrategy | undefined {
  return strategies.get(name);
}

export function createDefaultStrategies(): void {
  registerStrategy(new FileTreeStrategy());
}
```

```typescript
// apps/tui/src/lib/context/collector.ts
import type { ProjectContext, ContextOptions } from "./types.js";
import { getStrategy } from "./strategies/index.js";
import { logger } from "../utils/logger.js";
import { ok, err, type Result } from "../utils/result.js";

export async function collectContext(
  projectPath: string,
  strategyName = "file-tree",
  options?: ContextOptions,
): Promise<Result<ProjectContext, string>> {
  try {
    const strategy = getStrategy(strategyName);
    if (!strategy) {
      return err(`Unknown context strategy: ${strategyName}`);
    }

    const context = await strategy.collect(projectPath, options);
    return ok(context);
  } catch (error) {
    logger.error("Context collection failed", { error: String(error) });
    return err(
      `Failed to collect context: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add context layer with strategy pattern"
```

---

## Task 5: Parser Layer (Strategy Chain)

**Files:**

- Create: `apps/tui/src/lib/parser/types.ts`
- Create: `apps/tui/src/lib/parser/extractors/markdown.ts`
- Create: `apps/tui/src/lib/parser/extractors/json.ts`
- Create: `apps/tui/src/lib/parser/extractors/structured.ts`
- Create: `apps/tui/src/lib/parser/extractors/index.ts`
- Create: `apps/tui/src/lib/parser/registry.ts`
- Create: `apps/tui/src/lib/parser/index.ts`

- [ ] **Step 1: Create parser types**

```typescript
// apps/tui/src/lib/parser/types.ts
export type FileAction = "create" | "write" | "delete";

export interface FileChange {
  path: string;
  action: FileAction;
  content?: string;
}

export interface ParsedResponse {
  summary: string;
  changes: FileChange[];
  raw: string;
  parserUsed: string;
}

export interface ParserStrategy {
  name: string;
  parse(raw: string): ParserResult;
}

export interface ParserResult {
  success: boolean;
  response?: ParsedResponse;
  error?: string;
}
```

- [ ] **Step 2: Create markdown extractor**

````typescript
// apps/tui/src/lib/parser/extractors/markdown.ts
import type {
  ParserStrategy,
  ParserResult,
  ParsedResponse,
  FileChange,
} from "../types.js";

export class MarkdownExtractor implements ParserStrategy {
  name = "markdown";

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];
    const fileBlockRegex = /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;

    let match;
    while ((match = fileBlockRegex.exec(raw)) !== null) {
      changes.push({
        path: match[1].trim(),
        action: "create",
        content: match[2].trim(),
      });
    }

    if (changes.length === 0) {
      return { success: false, error: "No file blocks found" };
    }

    const summary = this.extractSummary(raw);

    return {
      success: true,
      response: {
        summary,
        changes,
        raw,
        parserUsed: this.name,
      },
    };
  }

  private extractSummary(raw: string): string {
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("```") &&
        !trimmed.startsWith("FILE:")
      ) {
        const cleaned = trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, "");
        if (cleaned.length > 10) {
          return cleaned.slice(0, 200);
        }
      }
    }
    return "Generated file structure";
  }
}
````

- [ ] **Step 3: Create JSON extractor**

```typescript
// apps/tui/src/lib/parser/extractors/json.ts
import type {
  ParserStrategy,
  ParserResult,
  ParsedResponse,
  FileChange,
} from "../types.js";

export class JsonExtractor implements ParserStrategy {
  name = "json";

  parse(raw: string): ParserResult {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        return { success: false, error: "No JSON found" };
      }

      const parsed = JSON.parse(match[0]);
      const changes: FileChange[] = (parsed.changes || []).map((c: any) => ({
        path: c.file || c.path,
        action: (c.action || "create") as FileChange["action"],
        content: c.content || c.code,
      }));

      if (changes.length === 0) {
        return { success: false, error: "No changes in JSON" };
      }

      return {
        success: true,
        response: {
          summary:
            parsed.summary || parsed.description || "Generated structure",
          changes,
          raw,
          parserUsed: this.name,
        },
      };
    } catch (error) {
      return { success: false, error: `JSON parse error: ${error}` };
    }
  }
}
```

- [ ] **Step 4: Create structured output extractor**

````typescript
// apps/tui/src/lib/parser/extractors/structured.ts
import type { ParserStrategy, ParserResult, FileChange } from "../types.js";

export class StructuredExtractor implements ParserStrategy {
  name = "structured";

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];

    const patterns = [
      /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g,
      /<file\s+path="(.+?)"[^>]*>([\s\S]*?)<\/file>/gi,
      /^(.+?\.ts)\n```[\w]*\n([\s\S]*?)```/gm,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(raw)) !== null) {
        const path = match[1].trim();
        const content = match[2].trim();

        if (path && content && !changes.some((c) => c.path === path)) {
          changes.push({ path, action: "create", content });
        }
      }
    }

    if (changes.length === 0) {
      return { success: false, error: "No structured file blocks found" };
    }

    return {
      success: true,
      response: {
        summary: this.extractSummary(raw),
        changes,
        raw,
        parserUsed: this.name,
      },
    };
  }

  private extractSummary(raw: string): string {
    const match = raw.match(/^(?!```|FILE:|>|\s)(.+)/m);
    return match ? match[1].trim().slice(0, 200) : "Generated file structure";
  }
}
````

- [ ] **Step 5: Create extractor registry**

```typescript
// apps/tui/src/lib/parser/extractors/index.ts
export { MarkdownExtractor } from "./markdown.js";
export { JsonExtractor } from "./json.js";
export { StructuredExtractor } from "./structured.js";

import type { ParserStrategy } from "../types.js";
import {
  MarkdownExtractor,
  JsonExtractor,
  StructuredExtractor,
} from "./index.js";

const extractors: Map<string, ParserStrategy> = new Map();

export function registerExtractor(extractor: ParserStrategy): void {
  extractors.set(extractor.name, extractor);
}

export function getExtractor(name: string): ParserStrategy | undefined {
  return extractors.get(name);
}

export function createDefaultExtractors(): void {
  registerExtractor(new MarkdownExtractor());
  registerExtractor(new JsonExtractor());
  registerExtractor(new StructuredExtractor());
}
```

- [ ] **Step 6: Create parser registry (chains extractors)**

```typescript
// apps/tui/src/lib/parser/registry.ts
import type { ParserResult, ParsedResponse } from "./types.js";
import { getExtractor, createDefaultExtractors } from "./extractors/index.js";
import { logger } from "../utils/logger.js";

createDefaultExtractors();

export interface ParserRegistryOptions {
  maxAttempts?: number;
}

export function parseWithStrategy(
  raw: string,
  strategyName: string,
): ParserResult {
  const extractor = getExtractor(strategyName);
  if (!extractor) {
    return { success: false, error: `Unknown strategy: ${strategyName}` };
  }

  const result = extractor.parse(raw);
  if (result.success) {
    logger.debug("Parsing succeeded", { strategy: strategyName });
  }
  return result;
}

export function parseWithChain(
  raw: string,
  strategies: string[],
): ParserResult {
  for (const strategy of strategies) {
    const result = parseWithStrategy(raw, strategy);
    if (result.success) {
      return result;
    }
  }

  return {
    success: false,
    error: "No parser succeeded",
  };
}

export const DEFAULT_PARSER_CHAIN = ["structured", "markdown", "json"];

export function parse(raw: string, chain = DEFAULT_PARSER_CHAIN): ParserResult {
  logger.debug("Parsing response", { chain });
  return parseWithChain(raw, chain);
}
```

- [ ] **Step 7: Create parser index**

```typescript
// apps/tui/src/lib/parser/index.ts
export * from "./types.js";
export { parse, parseWithStrategy, parseWithChain } from "./registry.js";
```

- [ ] **Step 8: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add parser layer with strategy chain"
```

---

## Task 6: File Applicator

**Files:**

- Create: `apps/tui/src/commands/freecode/file-applier.ts`

- [ ] **Step 1: Create file applicator**

```typescript
// apps/tui/src/commands/freecode/file-applier.ts
import * as fs from "fs";
import * as path from "path";
import type { FileChange } from "../../lib/parser/types.js";
import { logger } from "../../lib/utils/logger.js";
import { ok, err, type Result } from "../../lib/utils/result.js";

export interface ApplyResult {
  path: string;
  success: boolean;
  error?: string;
}

export async function applyFileChange(
  change: FileChange,
  basePath: string,
): Promise<Result<ApplyResult, string>> {
  const fullPath = path.join(basePath, change.path);

  try {
    if (change.action === "delete") {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info("Deleted file", { path: change.path });
      }
      return ok({ path: change.path, success: true });
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (change.content !== undefined) {
      fs.writeFileSync(fullPath, change.content, "utf-8");
      logger.info("Wrote file", {
        path: change.path,
        size: change.content.length,
      });
      return ok({ path: change.path, success: true });
    }

    return err("No content provided for write/create");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to apply change", {
      path: change.path,
      error: errorMessage,
    });
    return err(`Failed to ${change.action} ${change.path}: ${errorMessage}`);
  }
}

export async function applyChanges(
  changes: FileChange[],
  basePath: string,
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const change of changes) {
    const result = await applyFileChange(change, basePath);
    results.push(
      result.success
        ? result.value
        : { path: change.path, success: false, error: result.error },
    );
  }

  return results;
}
```

- [ ] **Step 2: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add file applicator"
```

---

## Task 7: Freecode Command (Composable Orchestration)

**Files:**

- Create: `apps/tui/src/commands/freecode/provider-mgr.ts`
- Create: `apps/tui/src/commands/freecode/executor.ts`
- Create: `apps/tui/src/commands/freecode/index.ts`

- [ ] **Step 1: Create provider manager**

```typescript
// apps/tui/src/commands/freecode/provider-mgr.ts
import {
  listProviders,
  type ProviderDefinition,
} from "../../lib/browser/providers/index.js";
import { logger } from "../../lib/utils/logger.js";

export interface SelectedProvider {
  id: string;
  name: string;
  definition: ProviderDefinition;
}

export function selectProvider(providerId?: string): SelectedProvider | null {
  const providers = listProviders();

  if (providers.length === 0) {
    logger.error("No providers registered");
    return null;
  }

  if (providerId) {
    const found = providers.find((p) => p.id === providerId);
    if (found) {
      return { id: found.id, name: found.name, definition: found };
    }
    logger.warn(`Provider ${providerId} not found, using default`);
  }

  const defaultProvider = providers[0];
  return {
    id: defaultProvider.id,
    name: defaultProvider.name,
    definition: defaultProvider,
  };
}

export function formatProviderList(): string {
  const providers = listProviders();
  return providers.map((p) => `- **${p.id}** - ${p.name}`).join("\n");
}
```

- [ ] **Step 2: Create executor (the main orchestration logic)**

````typescript
// apps/tui/src/commands/freecode/executor.ts
import { PlaywrightBrowserController } from "../../lib/browser/controller.js";
import { collectContext } from "../../lib/context/collector.js";
import { parse } from "../../lib/parser/index.js";
import { applyChanges } from "./file-applier.js";
import { type SelectedProvider } from "./provider-mgr.js";
import { logger } from "../../lib/utils/logger.js";

export interface ExecutorOptions {
  prompt: string;
  provider: SelectedProvider;
  projectPath: string;
  contextOptions?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  };
}

export interface ExecutorResult {
  success: boolean;
  summary?: string;
  filesCreated: number;
  errors: string[];
}

export async function executePromptCycle(
  options: ExecutorOptions,
  onStatus: (message: string) => void,
): Promise<ExecutorResult> {
  const { prompt, provider, projectPath, contextOptions } = options;
  const errors: string[] = [];

  const controller = new PlaywrightBrowserController();

  try {
    onStatus("🔄 **Connecting to browser...**");
    await controller.connect();
    onStatus("✅ **Browser connected**");

    onStatus("✅ **Loading ChatGPT...**");
    await controller.navigate(provider.definition.adapter);
    onStatus(`✅ **${provider.name} loaded**`);

    onStatus("📁 **Collecting project context...**");
    const contextResult = await collectContext(
      projectPath,
      "file-tree",
      contextOptions,
    );

    if (!contextResult.success) {
      errors.push(`Context collection failed: ${contextResult.error}`);
      return { success: false, filesCreated: 0, errors };
    }

    const context = contextResult.value;

    const fullPrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}

Task: ${prompt}

IMPORTANT: Respond with file operations in this EXACT format:
FILE: <relative-path>
\`\`\`
<file-content>
\`\`\`

Create or modify files as needed to complete the task.`;

    onStatus("📤 **Sending to ChatGPT...**");
    await controller.sendPrompt(fullPrompt);
    onStatus("⏳ **Waiting for response...**");

    const response = await controller.waitForResponse();
    onStatus("✅ **Response received**");

    const parseResult = parse(response);

    if (!parseResult.success) {
      errors.push(`Parse failed: ${parseResult.error}`);
      onStatus("⚠️ **Could not parse response**");
      onStatus("```\n" + response.slice(0, 500) + "...\n```");
      return { success: false, filesCreated: 0, errors };
    }

    const parsedResponse = parseResult.response!;
    onStatus(`📝 **Summary:** ${parsedResponse.summary}`);

    const fileChanges = parsedResponse.changes;
    onStatus(`📋 **Applying ${fileChanges.length} file(s)...**`);

    const applyResults = await applyChanges(fileChanges, projectPath);
    const succeeded = applyResults.filter((r) => r.success).length;
    const failed = applyResults.filter((r) => !r.success);

    if (failed.length > 0) {
      failed.forEach((f) => {
        if (f.error) errors.push(f.error);
      });
    }

    onStatus(`✨ **Done!** Created ${succeeded}/${fileChanges.length} files`);

    return {
      success: errors.length === 0,
      summary: parsedResponse.summary,
      filesCreated: succeeded,
      errors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Executor failed", { error: errorMessage });
    errors.push(errorMessage);
    return { success: false, filesCreated: 0, errors };
  } finally {
    await controller.disconnect();
  }
}
````

- [ ] **Step 3: Create /freecode command**

```typescript
// apps/tui/src/commands/freecode/index.ts
import {
  registerCommand,
  type Command,
  type CommandContext,
} from "../index.js";
import { selectProvider, formatProviderList } from "./provider-mgr.js";
import { executePromptCycle } from "./executor.js";
import { createDefaultProviders } from "../../lib/browser/providers/index.js";

createDefaultProviders();

const freecodeCommand: Command = {
  name: "freecode",
  description: "Send prompt to ChatGPT and apply file changes",
  execute: async (args, ctx) => {
    const userPrompt = args.join(" ");

    if (!userPrompt.trim()) {
      ctx.showMessage(`**Usage:** /freecode <your prompt>

**Example:** /freecode summarize this project and write at project.md

**Available providers:**
${formatProviderList()}`);
      return;
    }

    const provider = selectProvider();
    if (!provider) {
      ctx.showMessage("❌ **No provider available**");
      return;
    }

    const projectPath = process.cwd();

    const result = await executePromptCycle(
      { prompt: userPrompt, provider, projectPath },
      (status) => ctx.showMessage(status),
    );

    if (!result.success && result.errors.length > 0) {
      ctx.showMessage(
        `❌ **Errors:**\n${result.errors.map((e) => `- ${e}`).join("\n")}`,
      );
    }
  },
};

export function registerFreecodeCommand(): void {
  registerCommand(freecodeCommand);
}
```

- [ ] **Step 4: Wire into built-in commands**

Modify `apps/tui/src/commands/built-in.ts`:

```typescript
import { registerCommand, type Command, type CommandContext } from "./index.js";
import { AVAILABLE_MODELS } from "../models.js";
import { registerFreecodeCommand } from "./freecode/index.js";

export function registerBuiltInCommands(): void {
  registerCommand(helpCommand);
  registerCommand(clearCommand);
  registerCommand(exitCommand);
  registerCommand(modelCommand);
  registerFreecodeCommand();
}
```

Also update the help text to include `/freecode`:

```typescript
const helpCommand: Command = {
  name: "help",
  description: "Show available commands",
  execute: (_args, ctx) => {
    ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/model** - Select AI model
- **/exit** - Exit FreeCode
- **/freecode** <prompt> - Send prompt to ChatGPT and apply file changes`);
  },
};
```

- [ ] **Step 5: Build and verify**

Run: `cd apps/tui && pnpm build`
Expected: Compiles without errors

- [ ] **Step 6: Commit**

```bash
cd apps/tui && git add -A && git commit -m "feat: add scalable /freecode command with provider system"
```

---

## Task 8: Test MVP Flow

**Prerequisites:**

- Chrome running with: `chrome --remote-debugging-port=9222`
- User logged into chatgpt.com

- [ ] **Step 1: Start TUI**

Run: `cd apps/tui && pnpm dev`

- [ ] **Step 2: Test /freecode**

Type: `/freecode summarize this project and write at project.md`

Expected flow:

1. Connecting to browser... ✅
2. Browser connected ✅
3. Loading ChatGPT... ✅
4. Collecting project context... (shows file count)
5. Sending to ChatGPT... ✅
6. Waiting for response... ✅
7. Response received ✅
8. Applying files... ✅
9. Done! Created N files ✅

- [ ] **Step 3: Verify project.md exists**

Run: `cat project.md`

---

## Scalability Verification

| Scalability Concern               | How Addressed                                          |
| --------------------------------- | ------------------------------------------------------ |
| Add new provider (Claude, Gemini) | Implement `PageAdapter`, call `registerProvider()`     |
| Add new parser                    | Implement `ParserStrategy`, call `registerExtractor()` |
| Add new context strategy          | Implement `ContextStrategy`, call `registerStrategy()` |
| Change file operations            | Modify only `file-applier.ts`                          |
| Test components                   | Each module has single responsibility, easy to mock    |

---

## Self-Review Checklist

1. **Spec coverage:** MVP works — browser connection, context, prompt, parsing, file apply
2. **Placeholder scan:** No TBD/TODO, all steps have complete code
3. **Type consistency:** `FileChange`, `ParserResult`, `Result<T,E>` used consistently
4. **Interface boundaries:** Each layer has clear interface, no cross-layer dependencies
5. **Error handling:** `Result<T, E>` used throughout, no exceptions across module boundaries

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-freecode-mvp.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
