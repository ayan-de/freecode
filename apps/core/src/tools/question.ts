// =============================================================================
// question Tool - Ask user clarifying questions
// PRIMARY: Gather requirements, preferences, or decisions from user
// INPUT: { questions: Question[] }
// OUTPUT: User's answers
// NOTE: Uses Bus system for async question/answer flow
// =============================================================================

import { randomUUID } from "crypto"
import type { ToolDef, ToolContext, ToolResult } from "./types"
import { askQuestion, type QuestionAskedEvent } from "../bus"

export interface QuestionOption {
  label: string        // Display text (1-5 words)
  description: string  // Explanation of choice
}

export interface Question {
  question: string      // Complete question
  header?: string      // Short label (max 30 chars)
  options: QuestionOption[]
  multiple?: boolean   // Allow multiple selections
  custom?: boolean     // Allow custom answer (default: true)
}

export interface QuestionParams {
  questions: Question[]
}

// ============================================================================
// Format questions for display
// ============================================================================

function formatQuestions(params: QuestionParams): string {
  const lines: string[] = ["<questions>"]

  for (const q of params.questions) {
    lines.push("  <question>")
    lines.push(`    <text>${q.question}</text>`)
    if (q.header) {
      lines.push(`    <header>${q.header}</header>`)
    }
    lines.push("    <options>")
    for (const opt of q.options) {
      lines.push(`      <option label="${opt.label}">${opt.description}</option>`)
    }
    if (q.multiple) {
      lines.push("      <multiple>true</multiple>")
    }
    if (q.custom !== false) {
      lines.push("      <custom>true</custom>")
    }
    lines.push("    </options>")
    lines.push("  </question>")
  }

  lines.push("</questions>")
  return lines.join("\n")
}

// ============================================================================
// Question Tool
// ============================================================================

export const QuestionTool: ToolDef<QuestionParams> = {
  id: "question",
  description:
    "Ask the user clarifying questions during execution. Use to gather requirements, preferences, or get decisions on implementation choices. Questions are presented to the user with options to choose from.",
  parameters: {
    type: "object",
    properties: {
      questions: {
        description: "Array of questions to ask, each with: question (text), header (short label), options (array of {label, description}), multiple (allow multi-select), custom (allow custom answer)",
        type: "string",  // JSON stringified array for flexibility
      },
    },
    required: ["questions"],
  },
  execute: async (params: QuestionParams, _ctx: ToolContext): Promise<ToolResult> => {
    let questions: Question[]
    try {
      questions = typeof params.questions === "string"
        ? JSON.parse(params.questions)
        : params.questions
    } catch {
      return {
        title: "question",
        output: "Error: questions must be a valid JSON array",
      }
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return {
        title: "question",
        output: "No questions provided",
      }
    }

    const requestId = randomUUID()

    // Format questions for display
    const formatted = formatQuestions({ questions })

    // Ask question via Bus - this waits for user answer
    try {
      const answers = await askQuestion(requestId, questions)

      const formattedAnswers = questions
        .map((q, i) => `"${q.question}"="${answers[i] ?? "Unanswered"}"`)
        .join(", ")

      return {
        title: `Asked ${questions.length} question${questions.length > 1 ? "s" : ""}`,
        output: `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`,
        metadata: {
          requestId,
          answers,
          questionCount: questions.length,
        },
      }
    } catch (error) {
      return {
        title: `Question ${requestId}`,
        output: `Question was not answered: ${error instanceof Error ? error.message : "Unknown error"}. You can continue without this information or ask again.`,
        metadata: {
          requestId,
          answered: false,
        },
      }
    }
  },
}
