// =============================================================================
// edit Tool - In-place file editing
// PRIMARY: Replace text in files with multiple matching strategies
// INPUT: { filePath, oldString, newString, replaceAll? }
// OUTPUT: Edit result with diff and diagnostics
// NOTE: Ported from opencode with 9 replacer strategies
// Source: https://github.com/cline/cline/blob/main/evals/diff...
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import type { ToolDef, ToolContext, ToolResult } from "./types"

export interface EditParams {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

type ReplacerCandidate = {
  match: string
  startIndex: number
  endIndex: number
}

// Similarity thresholds
const SINGLE_CANDIDATE_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_THRESHOLD = 0.3

function levenshtein(a: string, b: string): number {
  if (!a || !b) return Math.max(a?.length ?? 0, b?.length ?? 0)
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i - 1][j - 1] + cost, matrix[i][j - 1] + 1)
    }
  }
  return matrix[a.length][b.length]
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

// =============================================================================
// Replacer Strategies (9 total) - all return candidate arrays
// =============================================================================

function simpleReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  let start = 0
  while (true) {
    const idx = content.indexOf(find, start)
    if (idx === -1) break
    results.push({ match: find, startIndex: idx, endIndex: idx + find.length })
    start = idx + 1
  }
  return results
}

function lineTrimmedReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const origLines = content.split("\n")
  const searchLines = find.split("\n")
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  for (let i = 0; i <= origLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if (origLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false
        break
      }
    }
    if (matches) {
      let start = 0
      for (let k = 0; k < i; k++) start += origLines[k].length + 1
      let end = start
      for (let k = 0; k < searchLines.length; k++) {
        end += origLines[i + k].length
        if (k < searchLines.length - 1) end += 1
      }
      results.push({ match: content.substring(start, end), startIndex: start, endIndex: end })
    }
  }
  return results
}

function blockAnchorReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const origLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) return results
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  const firstLine = searchLines[0].trim()
  const lastLine = searchLines[searchLines.length - 1].trim()

  const candidates: { startLine: number; endLine: number }[] = []
  for (let i = 0; i < origLines.length; i++) {
    if (origLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < origLines.length; j++) {
      if (origLines[j].trim() === lastLine) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }

  if (candidates.length === 0) return results

  // Single candidate
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    let similarity = 0
    const linesToCheck = Math.min(searchLines.length - 2, endLine - startLine - 2)
    if (linesToCheck > 0) {
      for (let j = 1; j < searchLines.length - 1 && j < endLine - startLine - 1; j++) {
        const origLine = origLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(origLine.length, searchLine.length)
        if (maxLen > 0) similarity += (1 - levenshtein(origLine, searchLine) / maxLen) / linesToCheck
      }
    } else {
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_THRESHOLD) {
      let start = 0
      for (let k = 0; k < startLine; k++) start += origLines[k].length + 1
      let end = start
      for (let k = startLine; k <= endLine; k++) {
        end += origLines[k].length
        if (k < endLine) end += 1
      }
      results.push({ match: content.substring(start, end), startIndex: start, endIndex: end })
    }
    return results
  }

  // Multiple candidates
  let best: { startLine: number; endLine: number } | null = null
  let maxSim = -1

  for (const { startLine, endLine } of candidates) {
    let sim = 0
    const linesToCheck = Math.min(searchLines.length - 2, endLine - startLine - 2)
    if (linesToCheck > 0) {
      for (let j = 1; j < searchLines.length - 1 && j < endLine - startLine - 1; j++) {
        const orig = origLines[startLine + j].trim()
        const srch = searchLines[j].trim()
        const len = Math.max(orig.length, srch.length)
        if (len > 0) sim += 1 - levenshtein(orig, srch) / len
      }
      sim /= linesToCheck
    } else {
      sim = 1.0
    }
    if (sim > maxSim) {
      maxSim = sim
      best = { startLine, endLine }
    }
  }

  if (maxSim >= MULTIPLE_CANDIDATES_THRESHOLD && best) {
    const { startLine, endLine } = best
    let start = 0
    for (let k = 0; k < startLine; k++) start += origLines[k].length + 1
    let end = start
    for (let k = startLine; k <= endLine; k++) {
      end += origLines[k].length
      if (k < endLine) end += 1
    }
    results.push({ match: content.substring(start, end), startIndex: start, endIndex: end })
  }

  return results
}

function whitespaceNormalizedReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const normalize = (t: string) => t.replace(/\s+/g, " ").trim()
  const normalizedFind = normalize(find)

  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i]) === normalizedFind) {
      let start = 0
      for (let k = 0; k < i; k++) start += lines[k].length + 1
      const end = start + lines[i].length
      results.push({ match: lines[i], startIndex: start, endIndex: end })
    }
  }

  // Multi-line
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length).join("\n")
      if (normalize(block) === normalizedFind) {
        let start = 0
        for (let k = 0; k < i; k++) start += lines[k].length + 1
        let end = start
        for (let k = 0; k < findLines.length; k++) {
          end += lines[i + k].length
          if (k < findLines.length - 1) end += 1
        }
        results.push({ match: block, startIndex: start, endIndex: end })
      }
    }
  }

  return results
}

function indentationFlexibleReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const removeIndent = (t: string) => {
    const lines = t.split("\n")
    const nonEmpty = lines.filter((l) => l.trim().length > 0)
    if (nonEmpty.length === 0) return t
    const minIndent = Math.min(
      ...nonEmpty.map((l) => {
        const m = l.match(/^(\s*)/)
        return m ? m[1].length : 0
      }),
    )
    return lines.map((l) => (l.trim().length === 0 ? l : l.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndent(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndent(block) === normalizedFind) {
      let start = 0
      for (let k = 0; k < i; k++) start += contentLines[k].length + 1
      let end = start
      for (let k = 0; k < findLines.length; k++) {
        end += contentLines[i + k].length
        if (k < findLines.length - 1) end += 1
      }
      results.push({ match: block, startIndex: start, endIndex: end })
    }
  }

  return results
}

function escapedNormalizedReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const unescape = (str: string) =>
    str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (m, c) => {
      switch (c) {
        case "n": return "\n"
        case "t": return "\t"
        case "r": return "\r"
        case "'": return "'"
        case '"': return '"'
        case "`": return "`"
        case "\\": return "\\"
        case "\n": return "\n"
        case "$": return "$"
        default: return m
      }
    })

  const unescapedFind = unescape(find)
  if (content.includes(unescapedFind)) {
    const idx = content.indexOf(unescapedFind)
    results.push({ match: unescapedFind, startIndex: idx, endIndex: idx + unescapedFind.length })
  }

  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (unescape(block) === unescapedFind) {
      let start = 0
      for (let k = 0; k < i; k++) start += lines[k].length + 1
      let end = start
      for (let k = 0; k < findLines.length; k++) {
        end += lines[i + k].length
        if (k < findLines.length - 1) end += 1
      }
      results.push({ match: block, startIndex: start, endIndex: end })
    }
  }

  return results
}

function multiOccurrenceReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  let start = 0
  while (true) {
    const idx = content.indexOf(find, start)
    if (idx === -1) break
    results.push({ match: find, startIndex: idx, endIndex: idx + find.length })
    start = idx + find.length
  }
  return results
}

function trimmedBoundaryReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const trimmed = find.trim()
  if (trimmed === find) return results

  if (content.includes(trimmed)) {
    const idx = content.indexOf(trimmed)
    results.push({ match: trimmed, startIndex: idx, endIndex: idx + trimmed.length })
  }

  const lines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (block.trim() === trimmed) {
      let start = 0
      for (let k = 0; k < i; k++) start += lines[k].length + 1
      let end = start
      for (let k = 0; k < findLines.length; k++) {
        end += lines[i + k].length
        if (k < findLines.length - 1) end += 1
      }
      results.push({ match: block, startIndex: start, endIndex: end })
    }
  }

  return results
}

function contextAwareReplacer(content: string, find: string): ReplacerCandidate[] {
  const results: ReplacerCandidate[] = []
  const findLines = find.split("\n")
  if (findLines.length < 3) return results
  if (findLines[findLines.length - 1] === "") findLines.pop()

  const contentLines = content.split("\n")
  const first = findLines[0].trim()
  const last = findLines[findLines.length - 1].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== first) continue
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === last) {
        const blockLines = contentLines.slice(i, j + 1)
        if (blockLines.length === findLines.length) {
          let matching = 0
          let total = 0
          for (let k = 1; k < blockLines.length - 1; k++) {
            const bl = blockLines[k].trim()
            const sl = findLines[k].trim()
            if (bl.length > 0 || sl.length > 0) {
              total++
              if (bl === sl) matching++
            }
          }
          if (total === 0 || matching / total >= 0.5) {
            let start = 0
            for (let k = 0; k < i; k++) start += contentLines[k].length + 1
            let end = start
            for (let k = i; k <= j; k++) {
              end += contentLines[k].length
              if (k < j) end += 1
            }
            results.push({ match: blockLines.join("\n"), startIndex: start, endIndex: end })
            return results
          }
        }
        break
      }
    }
  }

  return results
}

// =============================================================================
// applyEdit - tries all replacers, returns modified content
// =============================================================================

function applyEdit(content: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  const replacers = [
    simpleReplacer,
    lineTrimmedReplacer,
    blockAnchorReplacer,
    whitespaceNormalizedReplacer,
    indentationFlexibleReplacer,
    escapedNormalizedReplacer,
    trimmedBoundaryReplacer,
    contextAwareReplacer,
    multiOccurrenceReplacer,
  ]

  for (const replacer of replacers) {
    const candidates = replacer(content, oldString)
    for (const { match, startIndex, endIndex } of candidates) {
      if (replaceAll) {
        let result = content
        let pos = 0
        while (true) {
          const idx = result.indexOf(match, pos)
          if (idx === -1) break
          result = result.substring(0, idx) + newString + result.substring(idx + match.length)
          pos = idx + newString.length
        }
        return result
      }
      const lastIndex = content.lastIndexOf(match)
      if (startIndex !== lastIndex) continue
      return content.substring(0, startIndex) + newString + content.substring(endIndex)
    }
  }

  throw new Error(
    "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
  )
}

// =============================================================================
// EditTool Definition
// =============================================================================

export const EditTool: ToolDef<EditParams> = {
  id: "edit",
  description: "Edit files in-place using old_string/new_string replacement",
  parameters: {
    type: "object",
    properties: {
      filePath: { description: "Absolute path to the file to edit" },
      oldString: { description: "The exact text to replace" },
      newString: { description: "The replacement text" },
      replaceAll: { description: "Replace all occurrences (default: false)" },
    },
    required: ["filePath", "oldString", "newString"],
  },
  execute: async (params: EditParams, ctx: ToolContext): Promise<ToolResult> => {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(ctx.cwd, filepath)
    }

    if (params.oldString === params.newString) {
      return {
        title: path.basename(filepath),
        output: "Error: oldString and newString are identical - no changes to apply",
      }
    }

    if (!fs.existsSync(filepath)) {
      return { title: path.basename(filepath), output: `Error: File not found: ${filepath}` }
    }

    const stat = fs.statSync(filepath)
    if (stat.isDirectory()) {
      return { title: path.basename(filepath), output: `Error: Path is a directory: ${filepath}` }
    }

    const content = fs.readFileSync(filepath, "utf-8")
    const ending = detectLineEnding(content)
    const oldNormalized = params.oldString.replace(/\r\n/g, "\n").replace(/\n/g, ending === "\r\n" ? "\r\n" : "\n")

    let newContent: string
    try {
      newContent = applyEdit(content, oldNormalized, params.newString, params.replaceAll ?? false)
    } catch (err) {
      return {
        title: path.basename(filepath),
        output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    fs.writeFileSync(filepath, newContent, "utf-8")

    return {
      title: path.basename(filepath),
      output: "Edit applied successfully.",
      metadata: { filepath },
    }
  },
}
