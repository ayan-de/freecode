# FreeCode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that uses Playwright + CDP to automate ChatGPT for coding tasks, parsing responses and applying file changes.

**Architecture:** Interactive CLI → Playwright/CDP browser controller → ChatGPT → Response parser → File applicator. Two-phase context (file tree first, then files). All TypeScript, no Rust yet.

**Tech Stack:** TypeScript, Playwright, CDP, Node.js

---

## File Structure

```
apps/
└── cli/
    ├── src/
    │   ├── index.ts              # Entry point
    │   ├── cli.ts                # REPL loop
    │   ├── browser/
    │   │   ├── controller.ts     # Playwright + CDP management
    │   │   ├── chatgpt-adapter.ts # ChatGPT DOM interaction
    │   │   └── types.ts          # Browser controller types
    │   ├── context/
    │   │   ├── engine.ts         # Context engine (two-phase)
    │   │   └── file-tree.ts      # File tree generator
    │   ├── parser/
    │   │   ├── index.ts          # Parser orchestrator
    │   │   ├── json-parser.ts    # JSON response parser
    │   │   ├── markdown-parser.ts # Markdown response parser
    │   │   └── types.ts          # Parsed change types
    │   ├── applier/
    │   │   ├── index.ts          # Applier orchestrator
    │   │   ├── differ.ts         # Diff generation
    │   │   └── writer.ts         # File write with preview
    │   └── types/
    │       └── index.ts          # Shared types
    └── package.json
packages/
└── shared/
    ├── src/
    │   └── types.ts              # Shared type definitions
    └── package.json
```

---

## Task 1: Project Scaffolding

**Files:**

- Create: `apps/core/package.json`
- Create: `apps/core/tsconfig.json`
- Create: `apps/core/src/index.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/types.ts`
- Modify: `pnpm-workspace.yaml` (add packages)

- [ ] **Step 1: Create shared package**

```json
// packages/shared/package.json
{
  "name": "@freecode/shared",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

```json
// packages/shared/tsconfig.json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

```typescript
// packages/shared/src/types.ts
export interface FileChange {
  path: string;
  action: "create" | "replace" | "delete";
  content?: string;
}

export interface ParsedResponse {
  summary: string;
  changes: FileChange[];
  raw: string;
}

export interface PromptContext {
  prompt: string;
  projectPath: string;
  phase: "tree" | "files";
  files?: string[];
}
```

- [ ] **Step 2: Create CLI package**

```json
// apps/core/package.json
{
  "name": "@freecode/cli",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@freecode/shared": "workspace:*",
    "playwright": "^1.42.0",
    "typescript": "^5.4.0"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "tsx": "^4.7.0"
  }
}
```

```json
// apps/core/tsconfig.json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

```typescript
// apps/core/src/index.ts
import { runCLI } from "./cli";

runCLI();
```

- [ ] **Step 3: Update workspace config**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: Dependencies installed, workspace links created

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scaffold freecode CLI project structure"
```

---

## Task 2: REPL CLI

**Files:**

- Create: `apps/core/src/cli.ts`

- [ ] **Step 1: Write REPL interface**

```typescript
// apps/core/src/cli.ts
import * as readline from "readline";

export interface CLIConfig {
  projectPath: string;
}

export async function runCLI(config: CLIConfig): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () =>
    new Promise<string>((resolve) => {
      rl.question("\n> ", (answer) => {
        resolve(answer);
      });
    });

  console.log("�-FreeCode-initialized");
  console.log(`Project: ${config.projectPath}`);
  console.log('Type your prompt or "exit" to quit\n');

  let running = true;
  while (running) {
    const input = await prompt();
    const trimmed = input.trim();

    if (trimmed === "exit" || trimmed === "quit") {
      running = false;
      console.log("Goodbye!");
    } else if (trimmed) {
      console.log(`[DEBUG] Received prompt: ${trimmed}`);
      // TODO: Wire to browser controller
    }
  }

  rl.close();
}
```

- [ ] **Step 2: Update index.ts to read project path**

```typescript
// apps/core/src/index.ts
import { runCLI } from "./cli";
import * as path from "path";

const projectPath = process.cwd();
runCLI({ projectPath });
```

- [ ] **Step 3: Test it runs**

Run: `cd apps/core && pnpm dev`
Expected: REPL starts, accepts input, exits on "exit"

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(cli): add REPL interface"
```

---

## Task 3: Browser Controller (Playwright + CDP)

**Files:**

- Create: `apps/core/src/browser/types.ts`
- Create: `apps/core/src/browser/controller.ts`
- Create: `apps/core/src/browser/chatgpt-adapter.ts`

- [ ] **Step 1: Define browser controller types**

```typescript
// apps/core/src/browser/types.ts
export interface BrowserController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  gotoChatGPT(): Promise<void>;
  sendPrompt(prompt: string): Promise<void>;
  waitForResponse(): Promise<string>;
  isStreaming(): Promise<boolean>;
}

export interface ProviderAdapter {
  name: string;
  getInputLocator(page: any): any;
  getSubmitButton(page: any): any;
  getResponseLocator(page: any): any;
  isStreaming(page: any): Promise<boolean>;
}
```

- [ ] **Step 2: Write ChatGPT adapter**

```typescript
// apps/core/src/browser/chatgpt-adapter.ts
import type { ProviderAdapter } from "./types";

export const chatgptAdapter: ProviderAdapter = {
  name: "chatgpt",

  getInputLocator(page: any) {
    return page.locator("textarea");
  },

  getSubmitButton(page: any) {
    return page.locator('button[data-testid="send-button"]');
  },

  getResponseLocator(page: any) {
    return page.locator('[data-testid="turn"]').last();
  },

  async isStreaming(page: any): Promise<boolean> {
    const stopButton = page.locator('button[aria-label="Stop generating"]');
    return await stopButton.isVisible().catch(() => false);
  },
};
```

- [ ] **Step 3: Write browser controller**

```typescript
// apps/core/src/browser/controller.ts
import { chromium, Browser, Page } from "playwright";
import type { BrowserController, ProviderAdapter } from "./types";
import { chatgptAdapter } from "./chatgpt-adapter";

export class PlaywrightBrowserController implements BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private adapter: ProviderAdapter = chatgptAdapter;

  async connect(): Promise<void> {
    // Connect to existing Chrome via CDP
    const cdpUrl = process.env.CDP_URL || "http://localhost:9222";
    this.browser = await chromium.connectOverCDP(cdpUrl);
    const context = this.browser.contexts()[0];
    this.page = context.pages()[0] || (await context.newPage());
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async gotoChatGPT(): Promise<void> {
    if (!this.page) throw new Error("Not connected");
    await this.page.goto("https://chatgpt.com");
    await this.page.waitForLoadState("networkidle");
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.page) throw new Error("Not connected");

    const input = this.adapter.getInputLocator(this.page);
    await input.fill(prompt);

    const submitButton = this.adapter.getSubmitButton(this.page);
    await submitButton.click();
  }

  async isStreaming(): Promise<boolean> {
    if (!this.page) return false;
    return this.adapter.isStreaming(this.page);
  }

  async waitForResponse(): Promise<string> {
    if (!this.page) throw new Error("Not connected");

    // Poll until streaming stops
    while (await this.isStreaming()) {
      await this.page.waitForTimeout(500);
    }

    // Safety buffer
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

- [ ] **Step 4: Test CDP connection**

Run: `CDP_URL=http://localhost:9222 node -e "const {PlaywrightBrowserController} = require('./dist/browser/controller'); const c = new PlaywrightBrowserController(); c.connect().then(() => { console.log('Connected'); c.disconnect(); });"`
Expected: Connects to Chrome or errors gracefully if Chrome not available

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(browser): add Playwright CDP controller with ChatGPT adapter"
```

---

## Task 4: Context Engine (Two-Phase)

**Files:**

- Create: `apps/core/src/context/file-tree.ts`
- Create: `apps/core/src/context/engine.ts`

- [ ] **Step 1: Write file tree generator**

```typescript
// apps/core/src/context/file-tree.ts
import * as fs from "fs";
import * as path from "path";

const IGNORE_PATTERNS = [
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
];

function shouldIgnore(filePath: string): boolean {
  const relative = path.basename(filePath);
  return IGNORE_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) {
      return relative.endsWith(pattern.slice(1));
    }
    return relative === pattern;
  });
}

export function generateFileTree(
  dirPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0,
): string {
  if (currentDepth > maxDepth) return "";

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let tree = "";

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (shouldIgnore(fullPath)) continue;

    const prefix = currentDepth === 0 ? "" : "  ";
    const line = `${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}\n`;

    if (currentDepth > 0) {
      tree +=
        "  ".repeat(currentDepth) +
        (entry.isDirectory() ? "📁 " : "📄 ") +
        line;
    } else {
      tree += (entry.isDirectory() ? "📁 " : "📄 ") + line;
    }

    if (entry.isDirectory()) {
      tree += generateFileTree(fullPath, maxDepth, currentDepth + 1);
    }
  }

  return tree;
}

export function readFileContent(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function readFiles(filePaths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const filePath of filePaths) {
    try {
      result[filePath] = readFileContent(filePath);
    } catch {
      result[filePath] = `// Error reading file: ${filePath}`;
    }
  }
  return result;
}
```

- [ ] **Step 2: Write context engine**

```typescript
// apps/core/src/context/engine.ts
import * as path from "path";
import { generateFileTree, readFiles } from "./file-tree";
import type { PromptContext } from "@freecode/shared";

export class ContextEngine {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  generateTreePrompt(prompt: string): string {
    const tree = generateFileTree(this.projectPath);
    return `Project file tree:
${tree}

Task: ${prompt}

Based on the file tree above, respond with the list of files you need to see in JSON format:
{
  "files": ["path/to/file1", "path/to/file2"]
}`;
  }

  generateFilesPrompt(
    prompt: string,
    requestedFiles: string[],
  ): { prompt: string; files: Record<string, string> } {
    const absolutePaths = requestedFiles.map((f) =>
      path.isAbsolute(f) ? f : path.join(this.projectPath, f),
    );

    const fileContents = readFiles(absolutePaths);
    const filesSection = Object.entries(fileContents)
      .map(([filePath, content]) => `=== ${filePath} ===\n${content}\n`)
      .join("\n");

    const fullPrompt = `Project files:
${filesSection}

Task: ${prompt}

Respond ONLY with the file changes in this exact JSON format:
{
  "summary": "brief description of changes",
  "changes": [
    {
      "file": "path/to/file",
      "action": "replace|create|delete",
      "content": "full file content for replace/create, omit for delete"
    }
  ]
}`;

    return { prompt: fullPrompt, files: fileContents };
  }

  parseFileListFromResponse(response: string): string[] {
    try {
      const match = response.match(/\{[\s\S]*?"files"[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return parsed.files || [];
      }
    } catch {
      // Try to extract file paths manually
      const filePaths = response
        .split("\n")
        .filter((line) => line.match(/\.\w+$/) || line.match(/^["']/))
        .map((line) => line.replace(/["',]/g, "").trim());
      return filePaths;
    }
    return [];
  }
}
```

- [ ] **Step 3: Test file tree generation**

Run: `cd apps/core && node -e "const {generateFileTree} = require('./dist/context/file-tree'); console.log(generateFileTree(process.cwd()));`
Expected: Prints file tree of current directory

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(context): add two-phase context engine"
```

---

## Task 5: Response Parser (Format-Agnostic)

**Files:**

- Create: `apps/core/src/parser/types.ts`
- Create: `apps/core/src/parser/json-parser.ts`
- Create: `apps/core/src/parser/markdown-parser.ts`
- Create: `apps/core/src/parser/index.ts`

- [ ] **Step 1: Define parser types**

```typescript
// apps/core/src/parser/types.ts
import type { FileChange, ParsedResponse } from "@freecode/shared";

export interface ParserResult {
  success: boolean;
  response?: ParsedResponse;
  error?: string;
}
```

- [ ] **Step 2: Write JSON parser**

```typescript
// apps/core/src/parser/json-parser.ts
import type { FileChange, ParsedResponse } from "@freecode/shared";
import type { ParserResult } from "./types";

export function parseJSONResponse(raw: string): ParserResult {
  try {
    // Try to find JSON object in response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { success: false, error: "No JSON found in response" };
    }

    const parsed = JSON.parse(match[0]);

    const changes: FileChange[] = (parsed.changes || []).map((c: any) => ({
      path: c.file || c.path,
      action: c.action || "replace",
      content: c.content || c.code,
    }));

    return {
      success: true,
      response: {
        summary: parsed.summary || parsed.description || "",
        changes,
        raw,
      },
    };
  } catch (e) {
    return { success: false, error: `JSON parse error: ${e}` };
  }
}
```

- [ ] **Step 3: Write markdown parser**

````typescript
// apps/core/src/parser/markdown-parser.ts
import type { FileChange, ParsedResponse } from "@freecode/shared";
import type { ParserResult } from "./types";

export function parseMarkdownResponse(raw: string): ParserResult {
  const changes: FileChange[] = [];

  // Match patterns like: FILE: path/to/file.ts
  // or: path/to/file.ts
  // followed by a code block
  const fileBlockRegex = /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;

  let match;
  while ((match = fileBlockRegex.exec(raw)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    changes.push({
      path: filePath,
      action: "replace",
      content,
    });
  }

  // Fallback: try to extract file paths with code blocks
  if (changes.length === 0) {
    const simpleBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
    const lines = raw.split("\n");
    let currentFile = "";

    for (const line of lines) {
      const fileMatch =
        line.match(/^FILE:\s*(.+)/i) || line.match(/^(.+?\.\w+):?$/);
      if (fileMatch) {
        currentFile = fileMatch[1].trim();
      } else if (currentFile && line.startsWith("```")) {
        // Skip code block start
      } else if (currentFile && !line.startsWith("```") && line.trim()) {
        // This is content
      }
    }
  }

  // Extract summary (first non-code paragraph)
  const summaryMatch = raw.match(/^(?!```)(.+)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  if (changes.length === 0) {
    return { success: false, error: "No file blocks found in markdown" };
  }

  return {
    success: true,
    response: {
      summary,
      changes,
      raw,
    },
  };
}
````

- [ ] **Step 4: Write parser orchestrator**

````typescript
// apps/core/src/parser/index.ts
import type { ParsedResponse } from "@freecode/shared";
import type { ParserResult } from "./types";
import { parseJSONResponse } from "./json-parser";
import { parseMarkdownResponse } from "./markdown-parser";

export function parseResponse(raw: string): ParserResult {
  // Try JSON first
  let result = parseJSONResponse(raw);
  if (result.success) return result;

  // Fall back to markdown
  result = parseMarkdownResponse(raw);
  if (result.success) return result;

  // Last resort: return error
  return {
    success: false,
    error: "Failed to parse response in any known format",
  };
}

export function extractSummary(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim() && !l.startsWith("```"));
  return lines[0] || "No summary available";
}
````

- [ ] **Step 5: Test parser**

Run: `cd apps/core && node -e "const {parseResponse} = require('./dist/parser'); const r = parseResponse('FILE: test.ts\n\\\`\\\`\\\`\nhello world\n\\\`\\\`\\\`'); console.log(JSON.stringify(r, null, 2));`
Expected: Parses markdown FILE block correctly

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(parser): add format-agnostic response parser"
```

---

## Task 6: File Applicator (With Diff Preview)

**Files:**

- Create: `apps/core/src/applier/differ.ts`
- Create: `apps/core/src/applier/writer.ts`
- Create: `apps/core/src/applier/index.ts`

- [ ] **Step 1: Write diff generator**

```typescript
// apps/core/src/applier/differ.ts
import * as fs from "fs";
import type { FileChange } from "@freecode/shared";

export interface Diff {
  file: string;
  action: "create" | "replace" | "delete";
  oldContent?: string;
  newContent?: string;
  hasDiff: boolean;
}

export function generateDiff(filePath: string, change: FileChange): Diff {
  const result: Diff = {
    file: filePath,
    action: change.action,
    hasDiff: false,
  };

  if (change.action === "delete") {
    try {
      result.oldContent = fs.readFileSync(filePath, "utf-8");
      result.hasDiff = true;
    } catch {
      result.oldContent = "(file not found)";
    }
  } else if (change.action === "create" || change.action === "replace") {
    result.newContent = change.content;
    try {
      result.oldContent = fs.readFileSync(filePath, "utf-8");
      result.hasDiff = result.oldContent !== change.content;
    } catch {
      result.oldContent = "(file not found)";
      result.hasDiff = true;
    }
  }

  return result;
}

export function formatDiff(diff: Diff): string {
  const lines: string[] = [];
  lines.push(`\n📄 ${diff.file} (${diff.action})`);

  if (!diff.hasDiff) {
    lines.push("   (no changes)");
    return lines.join("\n");
  }

  if (diff.oldContent) {
    lines.push("--- Original:");
    const oldLines = diff.oldContent.split("\n").slice(0, 10);
    oldLines.forEach((l) => lines.push(`- ${l}`));
    if (diff.oldContent.split("\n").length > 10) {
      lines.push(
        `- ... (${diff.oldContent.split("\n").length - 10} more lines)`,
      );
    }
  }

  if (diff.newContent) {
    lines.push("+++ New:");
    const newLines = diff.newContent.split("\n").slice(0, 10);
    newLines.forEach((l) => lines.push(`+ ${l}`));
    if (diff.newContent.split("\n").length > 10) {
      lines.push(
        `+ ... (${diff.newContent.split("\n").length - 10} more lines)`,
      );
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Write file writer**

```typescript
// apps/core/src/applier/writer.ts
import * as fs from "fs";
import * as path from "path";
import type { FileChange } from "@freecode/shared";

export interface WriteResult {
  file: string;
  success: boolean;
  error?: string;
}

export async function applyChange(
  change: FileChange,
  basePath: string,
): Promise<WriteResult> {
  const filePath = path.join(basePath, change.path);

  try {
    if (change.action === "delete") {
      fs.unlinkSync(filePath);
      return { file: change.path, success: true };
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (change.action === "create" || change.action === "replace") {
      fs.writeFileSync(filePath, change.content || "", "utf-8");
      return { file: change.path, success: true };
    }

    return { file: change.path, success: false, error: "Unknown action" };
  } catch (e) {
    return { file: change.path, success: false, error: String(e) };
  }
}

export async function applyChanges(
  changes: FileChange[],
  basePath: string,
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  for (const change of changes) {
    const result = await applyChange(change, basePath);
    results.push(result);
  }
  return results;
}
```

- [ ] **Step 3: Write applier orchestrator**

```typescript
// apps/core/src/applier/index.ts
import * as readline from "readline";
import type { FileChange } from "@freecode/shared";
import { generateDiff, formatDiff, type Diff } from "./differ";
import { applyChanges } from "./writer";

export class FileApplier {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async previewChanges(changes: FileChange[]): Promise<Diff[]> {
    return changes.map((change) => generateDiff(change.path, change));
  }

  async displayPreview(changes: FileChange[]): Promise<void> {
    const diffs = await this.previewChanges(changes);

    console.log("\n📋 Proposed changes:");
    for (const diff of diffs) {
      console.log(formatDiff(diff));
    }
  }

  async applyWithConfirmation(changes: FileChange[]): Promise<boolean> {
    await this.displayPreview(changes);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirm = () =>
      new Promise<boolean>((resolve) => {
        rl.question("\n❓ Apply these changes? (y/n): ", (answer) => {
          resolve(answer.toLowerCase() === "y");
        });
      });

    const shouldApply = await confirm();
    rl.close();

    if (!shouldApply) {
      console.log("Changes discarded.");
      return false;
    }

    const results = await applyChanges(changes, this.basePath);
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`\n✅ Applied ${succeeded.length} files`);
    if (failed.length > 0) {
      console.log(`❌ Failed ${failed.length} files:`);
      failed.forEach((f) => console.log(`   ${f.file}: ${f.error}`));
    }

    return true;
  }
}
```

- [ ] **Step 4: Test diff generation**

Run: `cd apps/core && node -e "const {generateDiff} = require('./dist/applier/differ'); const d = generateDiff('test.txt', {path:'test.txt',action:'replace',content:'hello'}); console.log(require('util').inspect(d, {depth:5}));`
Expected: Generates diff object

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(applier): add file applicator with diff preview"
```

---

## Task 7: Wire Everything Together

**Files:**

- Modify: `apps/core/src/cli.ts`
- Modify: `apps/core/src/index.ts`

- [ ] **Step 1: Update CLI to orchestrate all components**

```typescript
// apps/core/src/cli.ts
import * as readline from "readline";
import { PlaywrightBrowserController } from "./browser/controller";
import { ContextEngine } from "./context/engine";
import { parseResponse } from "./parser";
import { FileApplier } from "./applier";

export interface CLIConfig {
  projectPath: string;
}

export async function runCLI(config: CLIConfig): Promise<void> {
  const browser = new PlaywrightBrowserController();
  const contextEngine = new ContextEngine(config.projectPath);
  const applier = new FileApplier(config.projectPath);

  console.log("�-FreeCode-initialized");
  console.log(`Project: ${config.projectPath}`);
  console.log("Connecting to browser...\n");

  try {
    await browser.connect();
    console.log("✅ Browser connected");
    await browser.gotoChatGPT();
    console.log("✅ ChatGPT loaded");
  } catch (e) {
    console.error("❌ Failed to connect to browser:", e);
    console.log("Make sure Chrome is running with CDP enabled:");
    console.log("  chrome --remote-debugging-port=9222");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () =>
    new Promise<string>((resolve) => {
      rl.question("\n> ", (answer) => {
        resolve(answer);
      });
    });

  console.log('\nType your prompt or "exit" to quit\n');

  let running = true;
  while (running) {
    const input = await prompt();
    const trimmed = input.trim();

    if (trimmed === "exit" || trimmed === "quit") {
      running = false;
    } else if (trimmed) {
      await runPromptCycle(trimmed, browser, contextEngine, applier);
    }
  }

  await browser.disconnect();
  console.log("Goodbye!");
  rl.close();
}

async function runPromptCycle(
  userPrompt: string,
  browser: PlaywrightBrowserController,
  contextEngine: ContextEngine,
  applier: FileApplier,
): Promise<void> {
  console.log("\n📤 Sending to ChatGPT (Phase 1: file tree)...");

  // Phase 1: Get file list
  const treePrompt = contextEngine.generateTreePrompt(userPrompt);
  const treeResponse = await browser.executePrompt(treePrompt);

  const neededFiles = contextEngine.parseFileListFromResponse(treeResponse);
  console.log(`📋 ChatGPT requested ${neededFiles.length} files`);

  if (neededFiles.length === 0) {
    console.log("⚠️  No files requested, may need to check response");
    return;
  }

  // Phase 2: Send files with prompt
  console.log("\n📤 Sending to ChatGPT (Phase 2: files)...");
  const { prompt: filesPrompt } = contextEngine.generateFilesPrompt(
    userPrompt,
    neededFiles,
  );
  const fullResponse = await browser.executePrompt(filesPrompt);

  // Parse response
  const parseResult = parseResponse(fullResponse);

  if (!parseResult.success) {
    console.error("❌ Failed to parse response:", parseResult.error);
    console.log("Raw response:\n", fullResponse.slice(0, 500));
    return;
  }

  console.log("\n📝 Summary:", parseResult.response?.summary);

  // Apply with confirmation
  if (parseResult.response?.changes.length) {
    await applier.applyWithConfirmation(parseResult.response.changes);
  }
}
```

- [ ] **Step 2: Test full flow (with mock CDP if needed)**

Run: `cd apps/core && pnpm dev`
Expected: CLI starts, prompts for Chrome connection

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: wire all components together in CLI"
```

---

## Verification

After all tasks:

1. Run `pnpm build` — should compile without errors
2. Run `pnpm check-types` — should pass type checking
3. Run `pnpm lint` — should pass linting

If any fail, fix before declaring completion.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-freecode-implementation.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
