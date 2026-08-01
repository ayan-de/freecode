# Multimodal Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable FreeCode to process images (screenshots, design mocks, diagrams) as input, allowing the model to see and reason about visual content. This extends `MessagePart` to support image content, updates the `read` tool to return base64-encoded images, and integrates multimodal content into every provider adapter.

**Architecture:** Extend the shared `MessagePart` type with an image variant containing base64 data and media type. The `read` tool gains an `asImage` flag to return image content instead of text. Provider adapters (Anthropic, OpenAI, Gemini) receive a normalized message format that each maps to their native vision API. The message conversion layer (`convertToCoreMessages`) propagates image parts unchanged and handles tool parts correctly.

**Tech Stack:** TypeScript, Vercel AI SDK (for provider adapters), base64 encoding

## Global Constraints

- Must not break existing text-only message flow — multimodal is additive
- All provider adapters must continue to work for text-only requests
- Image data must be base64-encoded for transport efficiency
- Supported initially: images only (PNG, JPEG, GIF, WebP). Video/audio deferred.
- **SVG is NOT supported as an image** — vision APIs don't accept SVG. SVGs should be read as text (XML) instead.
- Provider support: Anthropic (Claude Vision), OpenAI (GPT-4V), Gemini (Pro Vision). Others skip image parts with a warning.
- **Critical:** Must preserve tool parts in message history — never drop tool calls/results when images are present.

---

## File Structure

```
packages/shared/src/
├── types.ts                          # MODIFY: Add image type to MessagePart

apps/core/src/
├── tools/
│   ├── read.ts                       # MODIFY: Add image-reading capability
│   └── read/ui.ts                   # MODIFY: Render image content in results
├── providers/
│   ├── types.ts                     # MODIFY: Add MultimodalContent type
│   ├── utils.ts                     # MODIFY: Pass through image parts
│   ├── anthropic.ts                 # MODIFY: Use convertToCoreMessages (auto-handles images)
│   ├── openai.ts                    # MODIFY: Use convertToCoreMessages (auto-handles images)
│   └── gemini.ts                    # MODIFY: Use convertToCoreMessages (auto-handles images)
├── agent/
│   └── loop.ts                      # MODIFY: Handle image in initial prompt
```

---

## Tasks

### Task 0: Pre-flight — verify existing types

**Files:**
- Check: `packages/shared/src/types.ts`
- Check: `apps/core/src/providers/utils.ts`

- [ ] **Step 1: Check MessagePart definition**

Run: `grep -n "MessagePart" packages/shared/src/types.ts`

Expected: Lines 12-19 show current union type

- [ ] **Step 2: Check provider message conversion**

Run: `grep -n "convertToCoreMessages" apps/core/src/providers/utils.ts`

Expected: Function exists, handles text/code/tool parts

---

### Task 1: Extend MessagePart type with image support

**Files:**
- Modify: `packages/shared/src/types.ts:12-19`

**Interfaces:**
- Produces: Updated `MessagePart` union type

- [ ] **Step 1: Add image type to MessagePart**

Replace lines 12-19 with:

```typescript
export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | {
      type: "tool";
      tool: { name: string; args: Record<string, unknown> };
      result?: string;
    }
  | {
      type: "image";
      /** Base64-encoded image data (without the data:image/xxx;base64, prefix) */
      data: string;
      /** Media type: image/png, image/jpeg, image/gif, image/webp */
      mediaType: string;
      /** Optional plain-text description for providers without vision support */
      altText?: string;
    };
```

- [ ] **Step 2: Verify file compiles**

Run: `cd packages/shared && npx tsc --noEmit src/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add image type to MessagePart for multimodal input"
```

---

### Task 2: Create multimodal content type for providers

**Files:**
- Modify: `apps/core/src/providers/types.ts`

**Interfaces:**
- Consumes: `MessagePart` from shared types
- Produces: `MultimodalContent` type for provider adapters

- [ ] **Step 1: Add MultimodalContent type to provider types**

Add after line 20 in `apps/core/src/providers/types.ts`:

```typescript
/** Content part that can be sent to vision-capable providers. */
export type MultimodalContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** Base64-encoded image data. AI SDK handles provider-specific conversion. */
      image: string;
      /** Media type (e.g., image/png, image/jpeg). */
      mediaType?: string;
    };
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/providers/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/providers/types.ts
git commit -m "feat(providers): add MultimodalContent types for vision support"
```

---

### Task 3: Update message conversion to pass through image parts

**Files:**
- Modify: `apps/core/src/providers/utils.ts:71-168`

**Interfaces:**
- Consumes: `Message` with image parts from shared types
- Produces: `ModelMessage[]` with normalized content for AI SDK

**Critical:** This task must handle ALL part types correctly, including `tool` parts. The conversion must NOT drop tool parts when images are present.

- [ ] **Step 1: Update convertToCoreMessages to handle image parts**

Replace the user message handling in `convertToCoreMessages` (around lines 74-87) with:

```typescript
if (msg.role === "user") {
  // Check if any part is an image - if so, use array content format for vision
  const hasImage = msg.parts.some((p) => p.type === "image");

  if (hasImage) {
    // Vision mode: use array content format with image parts
    const contentParts: any[] = [];
    for (const part of msg.parts) {
      if (part.type === "text") {
        contentParts.push({ type: "text", text: part.content });
      } else if (part.type === "code") {
        contentParts.push({
          type: "text",
          text: `\`\`\`${part.language}\n${part.content}\n\`\`\``,
        });
      } else if (part.type === "image") {
        // AI SDK expects { type: "image", image: base64 string or URL, mediaType?: string }
        // The SDK handles provider-specific conversion (Anthropic, OpenAI, Gemini, etc.)
        contentParts.push({
          type: "image",
          image: part.data,
          mediaType: part.mediaType,
        });
      }
      // tool parts are silently dropped for user messages (they shouldn't have tool parts)
    }
    coreMessages.push({
      role: "user",
      content: contentParts,
    });
  } else {
    // Text-only mode: simple string content
    const textParts: string[] = [];
    for (const part of msg.parts) {
      if (part.type === "text") {
        textParts.push(part.content);
      } else if (part.type === "code") {
        textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
      }
    }
    coreMessages.push({
      role: "user",
      content: textParts.join("\n\n"),
    });
  }
}
```

- [ ] **Step 2: Add helper to detect if messages contain images**

Add at the end of `apps/core/src/providers/utils.ts`:

```typescript
/** Returns true if any message contains image parts. */
export function messagesContainImages(messages: Message[]): boolean {
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "image") return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/providers/utils.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/providers/utils.ts
git commit -m "feat(providers): pass through image parts in message conversion"
```

---

### Task 4: Add image reading capability to read tool

**Files:**
- Modify: `apps/core/src/tools/read.ts`

**Interfaces:**
- Consumes: `path` parameter, new `asImage` option
- Produces: Tool result with base64 image data

**IMPORTANT:** 
- SVG is NOT supported — vision APIs don't accept it. Remove `.svg` from extensions.
- Add size guard to reject images over 10MB before sending to provider.

- [ ] **Step 1: Add image parameter schema**

Find the `parameters` definition in `read.ts` and add:

```typescript
asImage: {
  type: "boolean",
  description: "Read the file as an image (base64 encoded). Use for screenshots, diagrams, or design files. Not supported for SVG files.",
},
```

- [ ] **Step 2: Add image reading logic**

Add in the execute function, after the existing file reading logic:

```typescript
// Handle image reading
if (params.asImage === true) {
  const ext = path.extname(filepath).toLowerCase();
  // NOTE: SVG and BMP are NOT supported - vision APIs don't accept these formats
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

  if (!imageExtensions.includes(ext)) {
    return {
      success: false,
      error: `Error: ${ext} is not a supported image format. Supported: ${imageExtensions.join(", ")}. SVG and BMP files are not supported as images.`,
    };
  }

  try {
    const imageBuffer = fs.readFileSync(filepath);
    const fileSizeBytes = imageBuffer.length;
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit

    if (fileSizeBytes > maxSizeBytes) {
      return {
        success: false,
        error: `Error: Image file is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`,
      };
    }

    const base64 = imageBuffer.toString("base64");
    const mediaType =
      ext === ".png"
        ? "image/png"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";

    return {
      success: true,
      result: {
        title: `${path.basename(filepath)} (image)`,
        output: "",
        metadata: {
          image: {
            data: base64,
            mediaType,
            sizeBytes: fileSizeBytes,
          },
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Error reading image: ${error}`,
    };
  }
}
```

- [ ] **Step 3: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/tools/read.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/tools/read.ts
git commit -m "feat(tools): add image reading capability to read tool"
```

---

### Task 5: Update read tool UI renderer for images

**Files:**
- Modify: `apps/core/src/tools/read/ui.ts`

**Interfaces:**
- Consumes: Tool result with `metadata.image` from read tool
- Produces: Rendered image in UI

- [ ] **Step 1: Add image rendering logic**

Note: The actual file path is `apps/core/src/tools/read/ui.ts` (not `read-ui.ts`).

Find where tool results are rendered and add:

```typescript
// Check for image metadata
if (result.metadata?.image) {
  const { data, mediaType } = result.metadata.image;
  return {
    type: "image",
    content: `data:${mediaType};base64,${data}`,
    altText: result.title,
  };
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/tools/read/ui.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/tools/read/ui.ts
git commit -m "feat(tools): add image rendering to read tool UI"
```

---

### Task 6-8: Provider adapters (ANTHROPIC, OPENAI, GEMINI)

**DO NOT create separate vision message builders.** The `convertToCoreMessages` function in Task 3 already handles image parts correctly and produces the correct format for each provider. The AI SDK automatically handles the provider-specific format differences.

**Just verify** that each provider uses `convertToCoreMessages` for message conversion:

- [ ] **Step 1: Verify Anthropic uses convertToCoreMessages**

Run: `grep -n "convertToCoreMessages" apps/core/src/providers/anthropic.ts`

Expected: Found - the provider already uses this function for message conversion

- [ ] **Step 2: Verify OpenAI uses convertToCoreMessages**

Run: `grep -n "convertToCoreMessages" apps/core/src/providers/openai.ts`

Expected: Found

- [ ] **Step 3: Verify Gemini uses convertToCoreMessages**

Run: `grep -n "convertToCoreMessages" apps/core/src/providers/gemini.ts`

Expected: Found

- [ ] **Step 4: Verify MiniMax, DeepSeek, ZAI also use convertToCoreMessages**

Run: `grep -l "convertToCoreMessages" apps/core/src/providers/*.ts`

Expected: All provider files use the same converter

**No code changes needed** — the message conversion from Task 3 automatically works for all providers because they all use `convertToCoreMessages`.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/providers/
git commit -m "refactor(providers): use shared convertToCoreMessages for vision support"
```

---

### Task 9: Handle multimodal input in agent loop

**Files:**
- Modify: `apps/core/src/agent/loop.ts`

**Interfaces:**
- Consumes: User input with potential image attachments
- Produces: Initial message with image parts

- [ ] **Step 1: Update initial message creation**

Find where `initialUserMessage` is created (around line 343) and extend to support image parts:

```typescript
// Support both plain text and multimodal input
const parts: MessagePart[] = [];
if (typeof input.prompt === "string") {
  parts.push({ type: "text", content: input.prompt });
} else if (Array.isArray(input.prompt)) {
  // Input is already multimodal parts
  parts.push(...input.prompt);
}

const initialUserMessage: Message = {
  id: randomUUID(),
  role: "user",
  parts,
  timestamp: Date.now(),
};
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/agent/loop.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/agent/loop.ts
git commit -m "feat(agent): support multimodal input in agent loop"
```

---

### Task 10: Add integration tests for multimodal functionality

**Files:**
- Create: `apps/core/src/providers/multimodal.test.ts`

**Interfaces:**
- Tests: Image part conversion, provider message building

- [ ] **Step 1: Write tests for message conversion**

Use Node.js native test runner (not vitest) to match existing test patterns in the codebase:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { convertToCoreMessages, messagesContainImages } from "./utils.js";
import type { Message } from "../agent/types.js";

test("multimodal message conversion: passes through image parts to provider format", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mediaType: "image/png",
        altText: "A simple red square",
      },
      { type: "text", content: "What is in this image?" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal(Array.isArray(result[0].content), true);
  const content = result[0].content as any[];
  assert.equal(content[0].type, "image");
  assert.equal(content[0].image, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
  assert.equal(content[0].mediaType, "image/png");
  assert.equal(content[1].text, "What is in this image?");
});

test("multimodal message conversion: detects images in messages", () => {
  const withImage: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [{ type: "image", data: "abc", mediaType: "image/png" }],
  };
  const withoutImage: Message = {
    id: "2",
    role: "user",
    timestamp: Date.now(),
    parts: [{ type: "text", content: "hello" }],
  };

  assert.equal(messagesContainImages([withImage]), true);
  assert.equal(messagesContainImages([withoutImage]), false);
});

test("multimodal message conversion: converts text-only messages to simple string format", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "text", content: "Hello" },
      { type: "text", content: "World" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "Hello\n\nWorld");
});

test("multimodal message conversion: handles mixed text and code parts", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "text", content: "Here is the code:" },
      { type: "code", language: "typescript", content: "const x = 1;" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal((result[0].content as string).includes("Here is the code:"), true);
  assert.equal((result[0].content as string).includes("```typescript"), true);
  assert.equal((result[0].content as string).includes("const x = 1;"), true);
});

test("multimodal message conversion: handles multiple images in a single message", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "image", data: "abc123", mediaType: "image/png" },
      { type: "text", content: "Compare these two images" },
      { type: "image", data: "def456", mediaType: "image/jpeg" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  const content = result[0].content as any[];
  assert.equal(content.length, 3);
  assert.equal(content[0].type, "image");
  assert.equal(content[0].image, "abc123");
  assert.equal(content[0].mediaType, "image/png");
  assert.equal(content[1].type, "text");
  assert.equal(content[2].type, "image");
  assert.equal(content[2].image, "def456");
  assert.equal(content[2].mediaType, "image/jpeg");
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/core && npx tsx --test src/providers/multimodal.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/providers/multimodal.test.ts
git commit -m "test(providers): add multimodal message conversion tests"
```

---

## Summary

After completing all tasks:

1. ✅ `MessagePart` supports image type with base64 data and media type
2. ✅ `read` tool accepts `asImage` flag to return image data (no SVG support)
3. ✅ Read tool includes size guard (10MB limit)
4. ✅ Read tool UI renders images in the result display
5. ✅ Message conversion passes image parts to provider format (no tool parts dropped)
6. ✅ All providers use shared `convertToCoreMessages` for vision support
7. ✅ Agent loop handles multimodal input at session start
8. ✅ Integration tests verify the full flow

---

## Plan complete

**Saved to:** `docs/superpowers/plans/2026-08-01-multimodal-input.md`

**Execution approach:** Subagent-driven is recommended. Tasks are cleanly file-scoped:
- Tasks 1-3: Shared types and utilities (foundation)
- Task 4-5: Tool layer (read tool + UI)
- Tasks 6-8: Just verification (no code changes needed)
- Task 9: Agent loop
- Task 10: Tests

**Key fixes applied from review:**
1. ✅ Fixed tool/assistant message dropping — Task 3 handles images per-message, preserving tool parts
2. ✅ Fixed SVG mismatch — removed .svg from supported extensions
3. ✅ Fixed BMP mismatch — removed .bmp from supported extensions (no vision API support)
4. ✅ Fixed ESM require() — use native Node.js test runner
5. ✅ Added size/token guard — 10MB limit in read tool
6. ✅ Fixed naming — consistent use of `asImage` throughout
7. ✅ Simplified provider tasks — no separate builders needed, use shared converter
8. ✅ Fixed AI SDK image format — use `{ type: "image", image, mediaType }` shape
9. ✅ Fixed variable name — verified `filepath` (lowercase) is correct in actual code
10. ✅ Fixed path — verified `apps/core/src/tools/read/ui.ts` exists
