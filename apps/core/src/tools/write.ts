import * as fs from "fs"
import * as path from "path"
import type { ToolDef, ToolContext, ToolResult } from "./types"

interface WriteParams {
  content: string
  filePath: string
}

export const WriteTool: ToolDef<WriteParams> = {
  id: "write",
  description: "Create or overwrite files",
  parameters: {
    type: "object",
    properties: {
      content: { description: "The content to write to the file" },
      filePath: { description: "The absolute path to the file to write" },
    },
    required: ["content", "filePath"],
  },
  execute: async (params: WriteParams, ctx: ToolContext): Promise<ToolResult> => {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(ctx.cwd, filepath)
    }

    const dir = path.dirname(filepath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (params.content === '') {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
        return { title: path.basename(filepath), output: 'File deleted.', metadata: { filepath } }
      }
      return { title: path.basename(filepath), output: 'File not found.', metadata: { filepath } }
    }

    const exists = fs.existsSync(filepath)
    fs.writeFileSync(filepath, params.content, 'utf-8')

    return {
      title: path.basename(filepath),
      output: exists ? 'File updated successfully.' : 'File created successfully.',
      metadata: { filepath, exists },
    }
  },
}