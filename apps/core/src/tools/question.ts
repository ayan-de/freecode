// =============================================================================
// Question Tool - Ask user clarifying questions with UI rendering
// =============================================================================

import { randomUUID } from "crypto";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { questionToolUI } from "./question/ui.js";
import { askQuestion } from "../bus/index.js";

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
      type: "array",
      description:
        "Array of questions to ask. Each question is an object: " +
        "{ question: string, header?: string, options: Array<{ label: string, description: string }>, multiple?: boolean, custom?: boolean }. " +
        "`options` is REQUIRED and MUST be a non-empty array of objects, each with a `label`.",
      items: { type: "object" },
    },
  },
  required: ["questions"],
};

// =============================================================================
// Normalization — coerce unvalidated model output into well-formed questions
// =============================================================================

// The provider does not strictly enforce the nested option shape, so the model
// can emit `options` as a non-array (or options without labels). formatQuestions
// iterates `q.options`, so a non-iterable value crashes the tool. Normalize into
// guaranteed { question, options: [{ label, description }] } shape, or return an
// actionable error the model can recover from.
function normalizeQuestions(
  input: unknown,
): { questions: Question[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "No questions provided" };
  }

  const out: Question[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { error: "Each question must be an object with `question` and `options`" };
    }
    const q = raw as Record<string, unknown>;
    const question = typeof q.question === "string" ? q.question : "";
    if (!question) {
      return { error: "Each question needs a non-empty `question` string" };
    }

    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const options: QuestionOption[] = [];
    for (const o of rawOptions) {
      if (typeof o === "string" && o.length > 0) {
        options.push({ label: o, description: "" });
        continue;
      }
      if (o && typeof o === "object") {
        const oo = o as Record<string, unknown>;
        const label =
          typeof oo.label === "string" && oo.label.length > 0
            ? oo.label
            : typeof oo.description === "string"
              ? oo.description
              : "";
        if (!label) continue;
        options.push({
          label,
          description: typeof oo.description === "string" ? oo.description : "",
        });
      }
    }

    if (options.length === 0) {
      return {
        error: `Question "${question}" has no valid options; provide "options" as a non-empty array of { label, description }`,
      };
    }

    out.push({
      question,
      header: typeof q.header === "string" ? q.header : undefined,
      options,
      multiple: typeof q.multiple === "boolean" ? q.multiple : undefined,
      custom: typeof q.custom === "boolean" ? q.custom : undefined,
    });
  }

  return { questions: out };
}

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
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  let parsed: unknown;
  try {
    parsed =
      typeof params.questions === "string"
        ? JSON.parse(params.questions)
        : params.questions;
  } catch {
    return {
      success: false,
      error: "questions must be a valid JSON array",
    };
  }

  const normalized = normalizeQuestions(parsed);
  if ("error" in normalized) {
    return {
      success: false,
      error: normalized.error,
    };
  }
  const questions = normalized.questions;

  const requestId = randomUUID();

  const formatted = formatQuestions({ questions });

  try {
    const answers = await askQuestion(requestId, questions, ctx.sessionId);

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
