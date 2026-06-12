// =============================================================================
// Question Tool - Ask user clarifying questions with UI rendering
// =============================================================================

import { randomUUID } from "crypto";
import type { ToolContext } from "./types";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types";
import { buildTool, defaultToolUI } from "./factory";
import { questionToolUI } from "./question/ui";
import { askQuestion } from "../bus";

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

interface QuestionParams {
  questions: Question[];
}

// =============================================================================
// Question Schema
// =============================================================================

const questionSchema: JsonSchema = {
  type: "object",
  properties: {
    questions: {
      description: "Array of questions to ask",
    },
  },
  required: ["questions"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateQuestionInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (!p.questions) {
    return { valid: false, error: "questions is required" };
  }
  return { valid: true };
}

// =============================================================================
// Format questions for display
// =============================================================================

function formatQuestions(params: QuestionParams): string {
  const lines: string[] = ["<questions>"];

  for (const q of params.questions) {
    lines.push("  <question>");
    lines.push(`    <text>${q.question}</text>`);
    if (q.header) {
      lines.push(`    <header>${q.header}</header>`);
    }
    lines.push("    <options>");
    for (const opt of q.options) {
      lines.push(
        `      <option label="${opt.label}">${opt.description}</option>`,
      );
    }
    if (q.multiple) {
      lines.push("      <multiple>true</multiple>");
    }
    if (q.custom !== false) {
      lines.push("      <custom>true</custom>");
    }
    lines.push("    </options>");
    lines.push("  </question>");
  }

  lines.push("</questions>");
  return lines.join("\n");
}

// =============================================================================
// Execute function
// =============================================================================

async function executeQuestion(
  params: QuestionParams,
  _ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  let questions: Question[];
  try {
    questions =
      typeof params.questions === "string"
        ? JSON.parse(params.questions)
        : params.questions;
  } catch {
    return {
      success: false,
      error: "questions must be a valid JSON array",
    };
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      success: false,
      error: "No questions provided",
    };
  }

  const requestId = randomUUID();

  const formatted = formatQuestions({ questions });

  try {
    const answers = await askQuestion(requestId, questions);

    const formattedAnswers = questions
      .map((q, i) => `"${q.question}"="${answers[i] ?? "Unanswered"}"`)
      .join(", ");

    return {
      success: true,
      result: {
        title: `Asked ${questions.length} question${questions.length > 1 ? "s" : ""}`,
        output: `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`,
        metadata: {
          requestId,
          answers,
          questionCount: questions.length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Question was not answered: ${error instanceof Error ? error.message : "Unknown error"}. You can continue without this information or ask again.`,
    };
  }
}

// =============================================================================
// QuestionTool - Built with buildTool() factory
// =============================================================================

export const QuestionTool: Tool<QuestionParams> = buildTool({
  id: "question",
  description: "Ask the user clarifying questions during execution",
  schemas: {
    parameters: questionSchema,
  },
  permissions: {
    operations: [],
    requiresApproval: false,
  },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    interruptBehavior: "await",
    userFacingName: "Ask Question",
  },
  ui: {
    ...defaultToolUI,
    ...questionToolUI,
  },
  execute: executeQuestion,
  validateInput: validateQuestionInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
