// =============================================================================
// Write Tool - Create or overwrite files with UI rendering
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { writeToolUI } from "./write/ui.js";
import { generateDiffString } from "./diff-format.js";

interface WriteParams {
  content: string;
  filePath: string;
}

// =============================================================================
// Write Schema
// =============================================================================

const writeSchema: JsonSchema = {
  type: "object",
  properties: {
    content: { description: "The content to write to the file" },
    filePath: { description: "The absolute path to the file to write" },
  },
  required: ["content", "filePath"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateWriteInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.content !== "string") {
    return { valid: false, error: "content is required and must be a string" };
  }
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required and must be a string" };
  }
  return { valid: true };
}

// =============================================================================
// Execute function
// =============================================================================

async function executeWrite(
  params: WriteParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    let filepath = params.filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(ctx.cwd, filepath);
    }

    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (params.content === "") {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        return {
          success: true,
          result: {
            title: path.basename(filepath),
            output: "File deleted.",
            metadata: { filepath },
          },
        };
      }
      return {
        success: true,
        result: {
          title: path.basename(filepath),
          output: "File not found.",
          metadata: { filepath },
        },
      };
    }

    const exists = fs.existsSync(filepath);
    // Capture prior content before overwriting so an update can show a diff.
    // New files skip the diff — echoing the whole file back adds no signal.
    const oldContent = exists ? fs.readFileSync(filepath, "utf-8") : "";
    fs.writeFileSync(filepath, params.content, "utf-8");

    const diff = exists
      ? generateDiffString(oldContent, params.content)
      : "";

    return {
      success: true,
      result: {
        title: path.basename(filepath),
        output:
          diff || (exists ? "File updated successfully." : "File created successfully."),
        metadata: { filepath, exists },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// WriteTool - Built with buildTool() factory
// =============================================================================

export const WriteTool: Tool<WriteParams> = buildTool({
  id: "write",
  description: "Create or overwrite files",
  schemas: {
    parameters: writeSchema,
  },
  permissions: {
    operations: ["file.write"],
  },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: true,
    userFacingName: "Write File",
  },
  ui: {
    ...defaultToolUI,
    ...writeToolUI,
  },
  execute: executeWrite,
  validateInput: validateWriteInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
  getPath: (params) => params.filePath,
});
