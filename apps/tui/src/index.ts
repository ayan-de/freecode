#!/usr/bin/env node
import {
  ProcessTerminal,
  TUI,
  Key,
  matchesKey,
  SelectList,
  type SelectItem,
  type SelectListTheme,
  type OverlayHandle,
} from "@earendil-works/pi-tui";
import { TodoPanel, parseTodoResult } from "./components/todo-panel.js";
import { NoticeModal } from "./components/notice-modal.js";
import { CompactionModal } from "./components/compaction-modal.js";
import { ScrollableModal } from "./components/scrollable-modal.js";
import { renderContextReport } from "./utils/context-report.js";
import { renderCostReportLines } from "./utils/cost-report.js";
import { commandRegistry, registerCommand } from "./commands/index.js";
import { registerBuiltInCommands } from "./commands/built-in.js";
import { Input } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, MODE_COLORS } from "./themes.js";
import {
  getRandomElapsedPhrase,
  getRandomInProgressPhrase,
} from "./utils/elapsed-phrases.js";
import { getModelContextLimit } from "./utils/model-limits.js";
import {
  formatTokenCount,
  cacheHitRate,
  type UsageTotals,
} from "./utils/format-tokens.js";
import { idleNudgeMessage, getCacheTtlMs } from "./utils/idle-nudge.js";
import { formatDuration } from "./utils/format-duration.js";
import { createAutocompleteProvider } from "./utils/at-mention-provider.js";
import { SelectionStore, normalize } from "./state/selection-store.js";
import { plainText } from "./utils/ansi-select.js";
import {
  copyToClipboard,
  noClipboardImageMessage,
  readImageFromClipboard,
} from "./utils/clipboard.js";
import {
  startCli,
  stopCli,
  setCliRestartHandler,
  sessionStart,
  sessionSendStreaming,
  sessionStop,
  sessionDequeue,
  sessionCompact,
  getContextStats,
  sessionList,
  sessionResume,
  sessionClaudeList,
  sessionClaudeTranscript,
  listProviders,
  listModels,
  listCommands,
  resolveCommand,
  listTools,
  mcpStatus,
  getCurrentModel,
  setCurrentModel,
  getLastAgentMode,
  setLastAgentMode,
  getPromptHistory,
  appendPromptHistory,
  setApiKey,
  setWebCredential,
  answerQuestion,
  rejectQuestion,
  answerPermission,
  rejectPermission,
  getUsage,
  type SessionInfo,
  type ModelInfo,
  type DailyUsage,
} from "./ipc/client.js";
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createInProgressMessage,
  createQueuedUserMessage,
  removeMessageById,
  updateInProgressMessage,
  subscribeToMessages,
  onMessagesChange,
  createToolProgressMessage,
  createToolResultMessage,
  createThinkingMessage,
  ToolProgressMessage,
  type MessageInstance,
  loadSessionMessages,
} from "./components/index.js";
import { getMessageByQueueId } from "./state/message-store.js";
import {
  setLiveOutputTokens,
  resetLiveOutputTokens,
  bumpLiveInputTokens,
  resetLiveInputTokens,
  setLiveUsageTotals,
  resetLiveUsageTotals,
  ThinkingMessage,
} from "./components/message-row.js";
import { getMessages, clearMessages } from "./state/message-store.js";
import { VirtualMessageList } from "./components/virtual-message-list.js";
import {
  PromptEditor,
  stripImageTokens,
} from "./components/prompt-editor.js";
import { ResumePicker } from "./components/resume-picker.js";
import { MaskedInput } from "./components/masked-input.js";
import { InterruptController } from "./interrupt-controller.js";
import { SafeTUI } from "./render-guard.js";
import { ENTER_ALT_SCREEN, restoreScreen } from "./terminal-screen.js";
import { installCrashHandlers } from "./crash-handler.js";
// import { ResponsiveInfoBox } from "./components/info-box.js"; // commented out: header disabled
// import { StatusHeader } from "./components/status-header.js"; // commented out: context moved to ContextBox overlay
import { LogoHeader } from "./components/logo-header.js";
import { ContextBox } from "./components/context-box.js";
import { ModeLine } from "./components/mode-line.js";
import {
  createProviderSelector,
  createModelSelector,
} from "./components/model-picker.js";
import { createMcpSelector } from "./components/mcp-picker.js";
import { SearchableSelectList } from "./components/searchable-select-list.js";
import { QuestionModal } from "./components/question-modal.js";
import { createPermissionPicker } from "./components/permission-picker.js";
import { EffortPicker } from "./components/effort-picker.js";
import type {
  ClaudeSessionMeta,
  ContextBreakdown,
  ProviderInfo,
  SerializedMessage,
  StreamEvent,
  EffortLevel,
} from "@thisisayande/freecode-shared";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;

let currentSession: SessionInfo | null = null;
// Session id of the turn currently streaming, or null when idle. Drives whether
// Ctrl+C cancels the turn (busy) or moves toward exit (idle).
let activeTurnSessionId: string | null = null;
let currentProvider = "";
let currentModel = "";
let currentEffort: EffortLevel = "low";
let currentAgentMode: "plan" | "build" | "review" | "explore" | "danger" =
  "build";
// True once the saved mode (or lack thereof) has been fetched from config —
// ModeLine stays hidden until then so it never flashes the "build" default.
let modeLoaded = false;
// Guards against overlapping clipboard reads from a Ctrl+V key burst.
let isReadingClipboard = false;
// Context-window usage widget (top-right overlay): hidden until the first
// prompt is sent, then shows live tokens/limit + a progress bar + percent.
let hasFirstMessage = false;
let contextTokens = 0;
let contextLimitTokens = 0;
// Cached once at TUI startup so the pinned logo header can show tool/MCP
// counts without each render making an async IPC call. `-1` until the loader
// resolves; the header renders `…` while the values are still pending.
let headerToolCount = -1;
let headerMcpCount = -1;
// Cache totals across every prompt in this session. A single run can look fine
// while the session average is poor — the first prompt after a compaction pays
// full price for the whole rebuilt prefix, and that only shows up in the sum.
// Reset by resetSessionCacheTotals() whenever the active session changes.
let sessionUsage: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
let sessionRuns = 0;
// Idle-return nudge (spec 2026-08-09, D1). `lastTurnCompletedAt` is the clock
// the cache TTL is measured against; `idleNudgeShownAt` keeps the hint to once
// per idle period rather than once per keystroke-to-send.
let lastTurnCompletedAt: number | null = null;
let idleNudgeShownAt: number | null = null;

/**
 * Drop the conversation and start over (the /clear command).
 *
 * The core session is what matters: every request re-sends the whole history,
 * so clearing only the rendered transcript would leave the cost exactly where
 * it was while making it look like it had gone. Mirrors the resume reset path.
 */
async function clearSession(): Promise<void> {
  try {
    const fresh = (await sessionStart({
      projectPath: process.cwd(),
      provider: currentProvider || undefined,
      model: currentModel || undefined,
      agentMode: currentAgentMode,
    })) as SessionInfo;
    currentSession = fresh;
  } catch (error) {
    // Keep the old session rather than leaving the UI pointing at nothing.
    showMessage(
      `**Error starting a new session:** ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  clearMessages();
  hideTodoPanel();
  resetSessionCacheTotals();
  resetLiveUsageTotals();
  contextTokens = 0;
  hasFirstMessage = false;
  messageCount = 0;
  idleNudgeShownAt = null;

  showMessage("*Context cleared — new session started.*");
  tui.requestRender();
}

function resetSessionCacheTotals(): void {
  sessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  sessionRuns = 0;
}
// Running length of streamed assistant text for the active turn, converted to a
// live output-token estimate (~4 chars/token) for the in-progress line.
let streamedChars = 0;
let modeLine: ModeLine;

let modelSelector: SearchableSelectList | null = null;
let providerSelector: SearchableSelectList | null = null;
let effortPicker: EffortPicker | null = null;
let resumeSelector: ResumePicker | null = null;
let mcpSelector: SearchableSelectList | null = null;
let apiKeyEditor: Input | null = null;
let apiKeyPrompt: Text | null = null;

let editor: PromptEditor;
let messageList: VirtualMessageList;
const toolMessageComponents = new Map<
  string,
  { progress: ToolProgressMessage; id: number; args: Record<string, unknown> }
>();

const terminal = new ProcessTerminal();
// SafeTUI, not TUI: it clamps every rendered line to a single terminal row, so
// a stray newline or an over-wide line can't desync the differential renderer.
tui = new SafeTUI(terminal);

import { Spacer } from "@earendil-works/pi-tui";

// const infoBox = new ResponsiveInfoBox(
//   () => currentProvider,
//   () => currentModel,
// ); // commented out: header disabled

// Logo header (logo + version + tools/MCP + directory) is rendered as the
// scrollable header of the message list — it scrolls away with the history
// rather than staying pinned at the top of the viewport. See the
// `VirtualMessageList` constructor below where `logoHeader` is passed in.
const logoHeader = new LogoHeader(
  () => headerToolCount,
  () => headerMcpCount,
);

// Floating top-right overlay showing the context-window usage widget (replaces
// the right half of the old StatusHeader). Non-capturing so it never steals
// focus from the editor; hidden on narrow terminals so it can't crowd the chat.
const contextBox = new ContextBox(
  () => hasFirstMessage,
  () => contextTokens,
  () => contextLimitTokens,
);
const contextBoxOverlay = tui.showOverlay(contextBox, {
  anchor: "top-right",
  width: contextBox.width(),
  offsetX: 0,
  offsetY: 0,
  nonCapturing: true,
  visible: (termWidth) => termWidth >= 60,
});

// tui.addChild(new Text("\nType your messages below. Press Ctrl+C to exit."));

// Text selection: click-drag over the message history highlights and, on
// release, copies the dragged text via OSC 52 (see the mouse handling below).
const selectionStore = new SelectionStore();

// Create message list and add to tui BEFORE editor. The list's optional
// header slot (was infoBox, currently disabled) would scroll away with the
// rest of the history instead of sitting fixed above the viewport.
// The viewport callback tells the list how many rows it may use in scrolled
// mode: terminal height minus the chrome below it (editor, spacers, mode line),
// so the scrolled window and the input stay on screen together. The context
// widget is now a top-right overlay and doesn't reserve viewport rows.
const getMessageListOffset = () => {
  const idx = tui.children.indexOf(messageList);
  if (idx <= 0) return 0;
  return tui.children.slice(0, idx).reduce((sum, child) => {
    return sum + child.render(terminal.columns).length;
  }, 0);
};

messageList = new VirtualMessageList(
  200,
  () => {
    const otherHeight = tui.children
      .filter((child) => child !== messageList)
      .reduce((sum, child) => {
        return sum + child.render(terminal.columns).length;
      }, 0);
    return Math.max(6, terminal.rows - otherHeight);
  },
  logoHeader, // scrolls with the messages instead of being pinned at top
  () => selectionStore.get(),
  getMessageListOffset,
);
messageList.setTui(tui);
tui.addChild(messageList);

// A terminal resize invalidates the rendered-line indices a selection is
// keyed against, so it's cheaper (and safer) to clear than to try to
// re-resolve them against the new layout.
process.stdout.on("resize", () => {
  if (selectionStore.get()) {
    selectionStore.clear();
    tui.requestRender();
  }
});

editor = new PromptEditor(tui, defaultEditorTheme);
editor.setText("");

// `@` file mentions run on fd when it is installed and on a JS tree walk when
// it is not, so completion works the same on a machine without fd (Windows,
// usually). Slash-command completion is unaffected either way.
const autocompleteProvider = createAutocompleteProvider(
  commandRegistry.getSlashCommands(),
  process.cwd(),
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);
tui.addChild(new Spacer(1));
// Mode/model line below the input. Always visible now — the top StatusHeader
// has been retired (its context widget moved into a top-right overlay), so
// this line is the only place mode and model are displayed.
modeLine = new ModeLine(
  () => !modeLoaded,
  () => currentAgentMode,
  () => currentProvider,
  () => currentModel,
  () => currentEffort,
);
tui.addChild(modeLine);

tui.setFocus(editor);

const defaultSelectListTheme: SelectListTheme = {
  selectedPrefix: (text) => `> ${text}`,
  selectedText: (text) => chalk.cyanBright(text),
  description: (text) => chalk.dim(text),
  scrollInfo: (text) => chalk.dim(text),
  noMatch: (text) => chalk.red(text),
};

function updateModelDisplay(): void {
  // Model display is now combined with agent mode display - rebuild combined display
  updateAgentModeDisplay();
}

function updateAgentModeDisplay(): void {
  // ModeLine reads mode/model through live getters, so a re-render is all
  // that's needed to reflect a mode cycle or model change.
  tui.requestRender();
}

function cycleAgentMode(): void {
  const modes: Array<"plan" | "build" | "review" | "explore" | "danger"> = [
    "plan",
    "build",
    "review",
    "explore",
    "danger",
  ];
  const idx = modes.indexOf(currentAgentMode);
  currentAgentMode = modes[(idx + 1) % modes.length];
  editor.borderColor = MODE_COLORS[currentAgentMode];
  updateAgentModeDisplay();
  setLastAgentMode(currentAgentMode).catch(() => {});
}

function showMessage(content: string): void {
  createSystemMessage(content);
}

// Permission asks can arrive in bursts — a batch of concurrency-safe tools
// (two greps, two reads) each raises its own ask nearly simultaneously. The
// TUI shows one picker at a time; extra asks queue here and surface in order as
// each is answered, so none is left orphaned and unfocused (which read as a hang).
type PermissionAsk = Extract<StreamEvent, { type: "permission_asked" }>;
const permissionQueue: PermissionAsk[] = [];
let activePermissionPicker: SelectList | null = null;

function removeSelector(
  selector: SelectList | SearchableSelectList | null,
): void {
  if (selector) {
    const idx = tui.children.indexOf(selector);
    if (idx !== -1) {
      tui.children.splice(idx, 1);
    }
    selector = null;
  }
}

// Pop the next queued permission ask and render its picker. After the user
// answers or cancels, it recurses to drain the queue, or returns focus to the
// editor when empty. Only ever one picker on screen at a time.
function showNextPermission(): void {
  const event = permissionQueue.shift();
  if (!event) {
    activePermissionPicker = null;
    tui.setFocus(editor);
    tui.requestRender();
    return;
  }

  const picker = createPermissionPicker(
    {
      toolName: event.toolName,
      description: event.description,
      suggestedRule: event.suggestedRule,
      reason: event.reason,
    },
    {
      onSelect: (decision) => {
        removeSelector(picker);
        // Same benign race as questions: the server-side timeout may have
        // already closed this request — don't let that become an unhandled
        // rejection.
        void answerPermission(event.requestId, decision).catch(() => {});
        showNextPermission();
      },
      onCancel: () => {
        removeSelector(picker);
        void rejectPermission(event.requestId).catch(() => {});
        showNextPermission();
      },
    },
    defaultSelectListTheme,
  );
  activePermissionPicker = picker;
  const editorIdx = tui.children.indexOf(editor);
  tui.children.splice(editorIdx + 1, 0, picker);
  tui.setFocus(picker);
  tui.requestRender();
}

function hideModelSelector(): void {
  removeSelector(modelSelector);
  removeSelector(providerSelector);
  modelSelector = null;
  providerSelector = null;
  // Focus goes back to the editor HERE, not at each call site. The selector was
  // just spliced out of tui.children, so whatever held focus is no longer in
  // the tree and every keystroke lands on a detached component — the input
  // looks dead until restart. The cancel paths each remembered to restore it;
  // picking a model did not, which is the path everyone actually takes.
  // Callers that want focus elsewhere (the provider list, the model list, the
  // credential prompt) set it immediately after this returns.
  tui.setFocus(editor);
  tui.requestRender();
}

function hideMcpSelector(): void {
  removeSelector(mcpSelector);
  mcpSelector = null;
  tui.setFocus(editor);
  tui.requestRender();
}

function hideResumeSelector(): void {
  if (resumeSelector) {
    const idx = tui.children.indexOf(resumeSelector);
    if (idx !== -1) {
      tui.children.splice(idx, 1);
    }
  }
  resumeSelector = null;
  tui.requestRender();
}

function removeApiKeyEditor(): void {
  if (apiKeyEditor) {
    const idx = tui.children.indexOf(apiKeyEditor);
    if (idx !== -1) {
      tui.children.splice(idx, 1);
    }
    apiKeyEditor = null;
  }
  if (apiKeyPrompt) {
    const idx = tui.children.indexOf(apiKeyPrompt);
    if (idx !== -1) {
      tui.children.splice(idx, 1);
    }
    apiKeyPrompt = null;
  }
}

/**
 * The provider picker, for both /model (metered APIs) and /web (browser
 * sessions). One flow, two lists: they differ only in which providers core
 * returns and which credential the picker offers to store.
 */
async function showProviderSelector(kind: "api" | "web" = "api"): Promise<void> {
  hideModelSelector();
  hideMcpSelector();
  removeApiKeyEditor();

  try {
    const providers = await listProviders(kind);

    if (providers.length === 0) {
      showMessage(
        kind === "web"
          ? "**No web session providers available.**"
          : "**No API providers available.**",
      );
      return;
    }

    providerSelector = createProviderSelector(
      providers,
      {
        onSelect: async (providerId: string) => {
          const provider = providers.find((p) => p.id === providerId);
          if (provider) await showModelSelector(provider);
        },
        onCancel: () => {
          hideModelSelector();
          tui.setFocus(editor);
          tui.requestRender();
        },
      },
      defaultSelectListTheme,
    );

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, providerSelector);
    tui.setFocus(providerSelector);
    tui.requestRender();
  } catch (err) {
    showMessage(`**Error:** Failed to load providers: ${err}`);
  }
}

/** Interactive MCP server list with live connection status (the /mcp command). */
async function showMcpPicker(): Promise<void> {
  hideMcpSelector();
  hideModelSelector();
  hideResumeSelector();

  try {
    const servers = await mcpStatus();

    if (servers.length === 0) {
      showMessage(
        "**No MCP servers configured.**\n\n" +
          'Add one: `freecode mcp add <name> local "<command>"`',
      );
      return;
    }

    mcpSelector = createMcpSelector(
      servers,
      {
        onSelect: (name: string) => {
          const server = servers.find((s) => s.name === name);
          hideMcpSelector();
          if (!server) return;
          const lines = [`**${server.name}** (${server.type})`, ""];
          lines.push(
            server.status === "connected"
              ? `Connected · ${server.toolCount} tools`
              : "Not connected — connects when `freecode serve` starts, or via `freecode mcp start`",
          );
          if (server.tools.length > 0) {
            lines.push(
              "",
              ...server.tools.map(
                (t) => `- ${t.replace(`mcp__${server.name}__`, "")}`,
              ),
            );
          }
          showMessage(lines.join("\n"));
        },
        onCancel: () => hideMcpSelector(),
      },
      defaultSelectListTheme,
    );

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, mcpSelector);
    tui.setFocus(mcpSelector);
    tui.requestRender();
  } catch (err) {
    showMessage(`**Error:** Failed to load MCP servers: ${err}`);
  }
}

async function showModelSelector(provider: ProviderInfo): Promise<void> {
  hideModelSelector();

  const providerId = provider.id;

  try {
    const models = await listModels(providerId);

    if (models.length === 0) {
      showMessage(`**No models available** for provider: ${providerId}`);
      return;
    }

    // Only a hard blocker forces the credential prompt. A web session that
    // works anonymously ("ready") must go straight through to the model —
    // demanding a cookie there asks for something the provider does not need.
    const needsCredential = provider.status === "needs-setup";
    // Nothing on file yet, so the extra entry offers rather than replaces.
    const credentialMissing =
      provider.status === "ready" || provider.status === "needs-setup";
    const credentialLabel =
      provider.kind === "web" ? provider.credential?.label : "API key";

    modelSelector = createModelSelector(
      models,
      {
        onSelect: async (modelId: string) => {
          currentProvider = providerId;
          currentModel = modelId;

          hideModelSelector();
          if (needsCredential) {
            await showCredentialInput(provider, modelId);
          } else {
            await setCurrentModel(providerId, modelId);
            updateModelDisplay();
            showMessage(`**Model changed to:** ${providerId}/${modelId}`);
          }
        },
        onCancel: () => {
          hideModelSelector();
          tui.setFocus(editor);
          tui.requestRender();
        },
        // Offered whenever the provider takes a credential at all, including
        // the optional cookie that upgrades an already-working web session.
        ...(!needsCredential &&
          credentialLabel && {
            credentialLabel,
            credentialMissing,
            onUpdateCredential: async () => {
              hideModelSelector();
              await showCredentialInput(provider);
            },
          }),
      },
      defaultSelectListTheme,
    );

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, modelSelector);
    tui.setFocus(modelSelector);
    tui.requestRender();
  } catch (err) {
    showMessage(`**Error:** Failed to load models: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Effort modal (/effort) — same ScrollableModal shell as /context and /cost.
// ---------------------------------------------------------------------------
let effortOverlay: OverlayHandle | null = null;

function hideEffortPicker(): void {
  if (!effortOverlay) return;
  effortOverlay.hide();
  effortOverlay = null;
  effortPicker = null;
  tui.setFocus(editor);
  tui.requestRender();
}

function showEffortPicker(): void {
  hideEffortPicker();

  effortPicker = new EffortPicker(currentEffort);
  effortPicker.onSelect = (level) => {
    currentEffort = level;
    hideEffortPicker();
    showMessage(`**Effort set to:** ${level}`);
  };
  effortPicker.onCancel = () => {
    hideEffortPicker();
  };

  const modal = new ScrollableModal(
    "Reasoning Effort",
    (innerWidth) => effortPicker!.render(innerWidth),
    () => hideEffortPicker(),
  );
  modal.handleInput = (data: string) => effortPicker!.handleInput(data);

  effortOverlay = tui.showOverlay(modal, {
    anchor: "center",
    // Wide enough for 5 labels ("medium"/"xhigh" are the longest) plus the
    // "Faster"/"Smarter" header without the modal's row-clipping truncating
    // the right edge.
    width: Math.min(64, Math.max(56, terminal.columns - 4)),
  });
  tui.requestRender();
}

/**
 * Prompt for a provider's credential — an API key for /model, whatever the web
 * provider declared (a cookie, a session token) for /web. The wording and the
 * destination block both come from core: the shell renders, it does not carry a
 * table of which provider wants what.
 */
async function showCredentialInput(
  provider: ProviderInfo,
  modelId?: string,
): Promise<void> {
  removeApiKeyEditor();
  hideModelSelector();

  const providerId = provider.id;
  const isWeb = provider.kind === "web";
  const noun = isWeb ? (provider.credential?.label ?? "credential") : "API key";
  const hint = isWeb ? provider.credential?.hint : undefined;

  apiKeyPrompt = new Text(
    chalk.bold(`Paste your ${noun} for ${providerId} `) +
      chalk.dim("(Enter to save, Esc to cancel)") +
      (hint ? "\n" + chalk.dim(hint) : ""),
    1,
    0,
  );
  // MaskedInput, not Input: a key or a session cookie is a secret either way
  // and must not be painted in clear text.
  apiKeyEditor = new MaskedInput();

  const editorIdx = tui.children.indexOf(editor);
  tui.children.splice(editorIdx + 1, 0, apiKeyPrompt, apiKeyEditor);
  tui.setFocus(apiKeyEditor);
  tui.requestRender();

  apiKeyEditor.onEscape = () => {
    removeApiKeyEditor();
    tui.setFocus(editor);
    tui.requestRender();
  };

  apiKeyEditor.onSubmit = async (value: string) => {
    const secret = value.trim();
    if (!secret) {
      showMessage(`**${noun} cannot be empty**`);
      return;
    }

    if (isWeb) {
      const field = provider.credential?.field ?? "apiKey";
      await setWebCredential(providerId, { [field]: secret });
    } else {
      await setApiKey(providerId, secret, modelId);
    }

    if (modelId) {
      await setCurrentModel(providerId, modelId);
      currentProvider = providerId;
      currentModel = modelId;
      updateModelDisplay();
      showMessage(
        `**${noun} saved and model set to:** ${providerId}/${modelId}`,
      );
    } else {
      showMessage(`**${noun} updated for:** ${providerId}`);
    }

    removeApiKeyEditor();
    tui.setFocus(editor);
    tui.requestRender();
  };
}

// Inline text input replaced by the QuestionModal overlay (see
// components/question-modal.ts). The old inline picker/Input path is gone.

async function showResumePicker(): Promise<void> {
  hideResumeSelector();
  hideModelSelector();
  hideMcpSelector();

  try {
    // Fetch both lists in parallel; the Claude Code list is best-effort.
    // A failure (no ~/.claude on this machine) is silently swallowed and
    // the Claude Code tab renders empty — the Freecode tab stays primary.
    const [sessions, claudeSessionsRaw] = await Promise.all([
      sessionList({}),
      sessionClaudeList({}).catch((err): ClaudeSessionMeta[] => {
        console.warn("Failed to list Claude Code sessions:", err);
        return [];
      }),
    ]);

    if (sessions.length === 0) {
      showMessage("**No previous sessions to resume.**");
      return;
    }

    // Sort by lastTurnAt descending (most recent first)
    sessions.sort((a, b) => b.lastTurnAt - a.lastTurnAt);
    const claudeSessions = claudeSessionsRaw;

    // Lazily fetched previews keyed by session id (shared between tabs).
    // We also track which id is currently in-flight so a slow request for
    // one session doesn't overwrite a freshly fetched preview for another.
    const previewCache = new Map<string, SerializedMessage[]>();
    let inflightId: string | null = null;

    async function ensurePreview(
      sessionId: string,
      tab: "freecode" | "claude-code",
    ): Promise<void> {
      if (previewCache.has(sessionId)) return;
      if (inflightId === sessionId) return;
      inflightId = sessionId;
      try {
        const messages =
          tab === "freecode"
            ? (await sessionResume(sessionId)).messages ?? []
            : (await sessionClaudeTranscript(sessionId)).messages ?? [];
        previewCache.set(sessionId, messages);
        if (
          resumeSelector &&
          resumeSelector.selectedId() === sessionId &&
          resumeSelector.activeTabName() === tab
        ) {
          resumeSelector.setPreview(sessionId, messages);
          tui.requestRender();
        }
      } catch {
        // Best-effort: the picker keeps showing the loading state. The user can
        // still navigate and pick another session. We intentionally swallow the
        // error here; the resume-on-Enter path surfaces it.
      } finally {
        if (inflightId === sessionId) inflightId = null;
      }
    }

    const picker = new ResumePicker(sessions, claudeSessions, {
      onSelectionChange: (sessionId: string, tab) => {
        ensurePreview(sessionId, tab);
      },
      onSelect: async (sessionId: string, tab) => {
        if (tab === "claude-code") {
          // Tab is read-only for this iteration — surface a stub message and
          // leave the modal open so the user can keep browsing. The actual
          // import-and-resume flow is a follow-up PR.
          showMessage(
            "**Importing Claude Code sessions is coming soon.** Press Esc to close the picker.",
          );
          tui.requestRender();
          return;
        }
        hideResumeSelector();
        showMessage(`**Resuming session...**`);
        try {
          const result = await sessionResume(sessionId);
          currentSession = { sessionId: result.sessionId };
          resetSessionCacheTotals();
          hideTodoPanel(); // clear any prior session's pinned todos
          if (result.messages && result.messages.length > 0) {
            loadSessionMessages(result.messages);
          }
          showMessage(
            `**Session resumed with ${result.messages?.length || 0} messages.**`,
          );
        } catch (err) {
          showMessage(`**Error resuming session:** ${err}`);
        }
        tui.setFocus(editor);
        tui.requestRender();
      },
      onCancel: () => {
        hideResumeSelector();
        tui.setFocus(editor);
        tui.requestRender();
      },
    });

    resumeSelector = picker;

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, resumeSelector);
    tui.setFocus(resumeSelector);

    // Kick off the first preview fetch for the highlighted row (cursor = 0).
    const firstId = picker.selectedId();
    if (firstId) ensurePreview(firstId, "freecode");

    tui.requestRender();
  } catch (err) {
    showMessage(`**Error loading sessions:** ${err}`);
  }
}

async function loadCurrentModel(): Promise<void> {
  startCli();

  // No fixed delay: the JSON-RPC request sits in the stdin pipe until the
  // core server boots and replies — the promise below resolves on the reply.
  try {
    const current = await getCurrentModel();
    if (current && current.provider && current.model) {
      currentProvider = current.provider;
      currentModel = current.model;
      updateModelDisplay();
    }

    const savedMode = await getLastAgentMode();
    if (
      savedMode &&
      ["plan", "build", "review", "explore", "danger"].includes(savedMode)
    ) {
      currentAgentMode = savedMode as typeof currentAgentMode;
      editor.borderColor = MODE_COLORS[currentAgentMode];
    }
  } catch {
    // CLI might not be running yet, ignore
  } finally {
    modeLoaded = true;
    updateAgentModeDisplay();
  }
}

let globalThinkingStartTime: number | null = null;

function handleToolEvent(event: StreamEvent) {
  const isThinking =
    event.type === "thinking" || event.type === "thinking_delta";

  if (isThinking) {
    if (globalThinkingStartTime === null) {
      globalThinkingStartTime = Date.now();
    }
  } else {
    // First non-thinking event ends the current reasoning block: freeze its
    // elapsed timer so the header collapses to "Thought (Ns)".
    const messages = getMessages();
    const last = messages[messages.length - 1];
    if (last?.component instanceof ThinkingMessage && !last.component.done) {
      last.component.setDone();
      globalThinkingStartTime = null;
      tui.requestRender();
    }
  }

  switch (event.type) {
    case "tool_start": {
      const toolMsg = createToolProgressMessage(
        event.toolCallId,
        event.toolName,
        event.args,
      );
      const progressComponent = toolMsg.component as ToolProgressMessage;
      progressComponent.setTui(tui);
      toolMessageComponents.set(event.toolCallId, {
        progress: progressComponent,
        id: toolMsg.id,
        args: event.args,
      });
      break;
    }
    case "tool_output": {
      const entry = toolMessageComponents.get(event.toolCallId);
      if (entry) {
        entry.progress.updateOutput(event.content.split("\n").slice(-5));
      }
      tui.requestRender();
      break;
    }
    case "tool_complete": {
      const entry = toolMessageComponents.get(event.toolCallId);
      if (entry) {
        entry.progress.invalidate();
        removeMessageById(entry.id);
        toolMessageComponents.delete(event.toolCallId);
      }
      createToolResultMessage(
        event.toolCallId,
        event.toolName,
        entry?.args ?? {},
        event.result,
        event.success,
        event.duration_ms,
      );
      // The tool result gets fed back into context for the next internal
      // turn, so grow the live ↓ estimate along with it (~4 chars/token).
      bumpLiveInputTokens(Math.round(event.result.length / 4));
      // Mirror the todo list into the pinned right-middle panel (in addition
      // to the inline chat rendering above).
      if (event.toolName === "todowrite") {
        updateTodoPanel(parseTodoResult(event.result));
      }
      break;
    }
    case "thinking": {
      // Create or update thinking message - dimmed cyan stream
      const thinkingComponent = createThinkingMessage(
        event.content,
        globalThinkingStartTime || Date.now(),
      );
      tui.requestRender();
      break;
    }
    case "text_delta":
    case "thinking_delta": {
      // Drive the in-progress line's live output-token estimate from the
      // actual streamed text (~4 chars/token). The 1s in-progress tick picks
      // this up on its next render, so the number tracks real generation
      // instead of the old time-based guess.
      streamedChars += event.delta.length;
      setLiveOutputTokens(Math.round(streamedChars / 4));
      break;
    }
    case "memory_saved": {
      // Something was recorded about the user without them asking. Arrives
      // after the turn's `done` (extraction is fire-and-forget), so it lands
      // as its own notice rather than inside the turn's output.
      const names = event.memories.map((m) => `${m.type}/${m.name}`).join(", ");
      const count = event.memories.length;
      createSystemMessage(
        `*Remembered ${count} thing${count === 1 ? "" : "s"} for next time: ${names} — \`/graph\` to view, \`memory.autoExtract: false\` to stop.*`,
      );
      break;
    }
    case "memory_injected": {
      // Automatic retrieval (not the memory tool) surfaced saved memories
      // into this turn's prompt. Silent otherwise, so surface it once here.
      const names = event.memories.map((m) => `${m.type}/${m.name}`).join(", ");
      const count = event.memories.length;
      createSystemMessage(
        `*Recalled ${count} thing${count === 1 ? "" : "s"} from memory: ${names}*`,
      );
      break;
    }
    case "question_asked": {
      // Render each question as a centered modal card, collecting answers
      // indexed by question, then reply once every question has one. A
      // synthetic "Other" row inside each modal lets the user type their own
      // answer via an inline editor instead of picking a preset. ←/→ moves
      // between questions, so answers are kept sparse until they're all in
      // rather than assumed to arrive in order.
      const total = event.questions.length;
      const answers: string[] = new Array(total);
      let overlay: OverlayHandle | null = null;

      const closeOverlay = () => {
        overlay?.hide();
        overlay = null;
        tui.setFocus(editor);
        tui.requestRender();
      };
      // Next question still missing an answer, searching forward and wrapping.
      // Null once every question is answered.
      const nextUnanswered = (from: number): number | null => {
        for (let n = 1; n <= total; n++) {
          const i = (from + n) % total;
          if (answers[i] === undefined) return i;
        }
        return null;
      };

      const askAt = (i: number) => {
        overlay?.hide();
        const spec = event.questions[i];
        const modal = new QuestionModal(
          spec.header ?? "Question",
          spec.question,
          spec.options,
          { index: i, total, previousAnswer: answers[i] },
        );
        // Cap the overlay width to the terminal so the centered card doesn't
        // overflow on narrow displays.
        overlay = tui.showOverlay(modal, {
          anchor: "center",
          width: Math.min(modal.width(), Math.max(24, terminal.columns - 4)),
        });
        modal.onSelect = (label) => {
          answers[i] = label;
          const next = nextUnanswered(i);
          if (next !== null) {
            askAt(next);
            return;
          }
          closeOverlay();
          void answerQuestion(event.requestId, answers).catch(() => {
            createSystemMessage(
              "*This question timed out before you answered — your reply wasn't sent.*",
            );
          });
        };
        modal.onCancel = () => {
          closeOverlay();
          // The request may already be closed (30-min server-side timeout
          // fired while this modal was still open) — that's a benign race,
          // not a crash: swallow it rather than let it become an unhandled
          // rejection.
          void rejectQuestion(event.requestId).catch(() => {});
        };
        modal.onNavigate = (delta) => askAt((i + delta + total) % total);
        tui.requestRender();
      };
      askAt(0);
      break;
    }
    case "permission_asked": {
      // Enqueue; show immediately only if no picker is already up. Answering
      // one drains the next (showNextPermission), so bursts don't stack pickers.
      permissionQueue.push(event);
      if (!activePermissionPicker) showNextPermission();
      break;
    }
    // Auto-compaction only — manual /compact drives the same modal from its own
    // RPC result (the stream listener isn't guaranteed active between turns).
    case "compaction_start": {
      if (event.trigger === "auto") showCompactionModal();
      break;
    }
    case "compaction_complete": {
      if (event.trigger !== "auto") break;
      if (event.compacted) {
        finishCompactionModal(event.tokensBefore, event.tokensAfter);
      } else {
        dismissCompactionModal("Nothing older than the last 2 turns.");
      }
      break;
    }
    case "notice": {
      showMessage(
        event.level === "warn" ? `⚠ *${event.content}*` : `*${event.content}*`,
      );
      break;
    }
    // Prompt-cache awareness (jcode #9). Warn on a cold-cache send; on warm
    // turns show read/write tokens only when there's cache activity worth noting.
    case "cache_status": {
      if (event.state === "cold" && event.message) {
        showMessage(`⚠ *${event.message}*`);
      } else if (event.state === "miss" && event.message) {
        // Louder than "cold": a cold cache is the clock running out, this is
        // the harness having broken its own prefix (spec 2026-08-09 D2).
        showMessage(`⚠ **${event.message}**`);
      } else if (event.state === "warm" && (event.cacheReadTokens ?? 0) > 0) {
        showMessage(
          `*Prompt cache hit: ${event.cacheReadTokens!.toLocaleString()} tokens read${
            event.cacheWriteTokens
              ? `, ${event.cacheWriteTokens.toLocaleString()} written`
              : ""
          }*`,
        );
      }
      break;
    }
    // Provider-reported run totals, once per completed internal turn (D7).
    // Until these arrive the ↓/↑ counters are a ~4 chars/token guess, because
    // the authoritative `result.usage` only lands when the whole run ends — so
    // a long multi-turn run showed estimates the entire time it mattered.
    //
    // setLiveUsageTotals clears its own run-cumulative estimates (leaving them
    // would add every turn so far on top of a figure that already counts it);
    // streamedChars is ours, and feeds setLiveOutputTokens, so it resets here.
    case "usage_totals": {
      setLiveUsageTotals({
        inputTokens: event.totalInputTokens,
        outputTokens: event.totalOutputTokens,
        cacheReadTokens: event.totalCacheReadTokens,
      });
      streamedChars = 0;
      tui.requestRender();
      break;
    }
    // Spec 2026-08-05: a session.send landed while a turn was in progress.
    // The server parked the prompt in the follow-up queue; render it as a
    // user message with a dim "queued" badge so the user can see it's in
    // line, and Ctrl+Backspace lets them pull it back out.
    case "message_queued": {
      createQueuedUserMessage(event.content, event.id);
      tui.requestRender();
      break;
    }
    // Pulled out of the queue (Ctrl+Backspace, or fall-through cleanup).
    // If the row is still in the transcript with the queued badge, drop it;
    // if it's already been promoted to an in-flight user message, leave it
    // alone — the dequeue raced with the FIFO drain and the user keeps what
    // they sent.
    case "message_dequeued": {
      const row = getMessageByQueueId(event.id);
      if (row && row.type === "queued_user") {
        removeMessageById(row.id);
        tui.requestRender();
      }
      break;
    }
  }
}

// Send a prompt to the agent through the streaming session. `displayText`, when
// given, is shown as the "You:" message instead of the raw prompt — used by
// prompt commands (e.g. /init) that expand into a long instruction.
async function submitPrompt(
  promptText: string,
  displayText?: string,
  images?: Array<{ data: string; mediaType: string; altText?: string }>,
): Promise<void> {
  // Before anything is sent: if the cache has expired and the context is large,
  // this request pays full price for the whole conversation. Only the user
  // knows whether they still need it, so say what it costs and carry on.
  const nudge = idleNudgeMessage({
    contextTokens,
    idleMs: lastTurnCompletedAt ? Date.now() - lastTurnCompletedAt : undefined,
    ttlMs: getCacheTtlMs(),
    alreadyShown: idleNudgeShownAt !== null,
  });
  if (nudge) {
    idleNudgeShownAt = Date.now();
    showMessage(nudge);
  }

  messageCount++;
  // First prompt reveals the top-right context-usage overlay.
  hasFirstMessage = true;
  // Reset the live streamed-token estimate for this turn.
  streamedChars = 0;
  resetLiveOutputTokens();
  resetLiveInputTokens();
  resetLiveUsageTotals();

  // A fresh prompt starts a fresh view: clear the pinned todo panel so a prior
  // task's plan doesn't linger. It reappears if the agent calls todowrite again.
  hideTodoPanel();

  // A new prompt always returns the view to the live bottom of the history.
  messageList.scrollToBottom();

  // Optimistic local echo of the user message — instant visual feedback.
  // If the server parks the prompt in the follow-up queue, we'll swap this
  // for a queued_user row at the same position (see the result handling
  // below) so the user sees one row, not two.
  const userMsg = createUserMessage(
    `**${chalk.red("You")}:** ${displayText ?? promptText}`,
  );
  // Seed ↓ with a live input estimate so it isn't 0 while streaming: prior
  // accumulated context plus this prompt (~4 chars/token). Input is fixed at
  // send time (the provider only reports the exact value at turn end), so this
  // is a stable estimate that the real usage corrects on completion.
  const turnContextLimit = await getModelContextLimit(
    `${currentProvider}/${currentModel}`,
  );
  const estimatedInput = contextTokens + Math.round(promptText.length / 4);
  const inProgressMsg = createInProgressMessage(
    getRandomInProgressPhrase(),
    estimatedInput,
    0,
    turnContextLimit,
    1,
    // Same estimate drives the context meter: what this turn's request carries.
    estimatedInput,
  );

  startCli();

  if (!currentSession) {
    try {
      if (!currentProvider) {
        try {
          const current = await getCurrentModel();
          if (current) {
            currentProvider = current.provider;
            currentModel = current.model;
          }
        } catch {
          // Use defaults
        }
      }

      // No hardcoded provider: send only what config.json actually resolved to
      // and let core reject an unconfigured setup, rather than quietly starting
      // the session on a provider the user never picked.
      currentSession = (await sessionStart({
        projectPath: process.cwd(),
        provider: currentProvider || undefined,
        model: currentModel || undefined,
        agentMode: currentAgentMode,
      })) as SessionInfo;
    } catch (error) {
      removeMessageById(inProgressMsg.id);
      showMessage(
        `**Error:** Failed to start session: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }

  try {
    activeTurnSessionId = currentSession.sessionId;
    const result = await sessionSendStreaming(
      currentSession.sessionId,
      promptText,
      // Send the model the status bar is displaying. Passing undefined let the
      // request resolve to a different model than the one shown — the context
      // meter read config.json while the wire carried the provider default.
      currentModel || undefined,
      currentAgentMode,
      images,
      (event: StreamEvent) => {
        handleToolEvent(event);
      },
      currentEffort,
    );

    // Spec 2026-08-05: server parked the prompt in the follow-up queue
    // because a turn was already running. The session.send result resolves
    // immediately with `{ queued, id }` — no turn actually started, so
    // there is no in-progress message to update and no token usage to
    // report. The server's `message_queued` stream event arrived during
    // the await above and already created the canonical queued_user row.
    // Collapse our optimistic local echo + the in-progress placeholder
    // into that one row: drop our user message (the queued one shows the
    // same content), drop the in-progress (no turn is running), and the
    // queued_user the event handler added stays as the single visible
    // transcript entry — keyed by `result.id` so Ctrl+Backspace targets
    // it via session.dequeue.
    if ("queued" in result) {
      removeMessageById(inProgressMsg.id);
      removeMessageById(userMsg.id);
      tui.requestRender();
      return;
    }

    // Update in-progress message with token counts from result
    const contextLimit = await getModelContextLimit(
      `${currentProvider}/${currentModel}`,
    );
    updateInProgressMessage(
      inProgressMsg.id,
      getRandomInProgressPhrase(),
      result.usage?.inputTokens ?? 0,
      result.usage?.outputTokens ?? 0,
      contextLimit,
      inProgressMsg.timestamp,
      result.turnCount || 1,
      result.usage?.cacheReadInputTokens ?? 0,
      // ↓/↑ are run totals; the meter needs the last turn's context instead.
      result.usage?.contextTokens ??
        (result.usage?.inputTokens ?? 0) +
          (result.usage?.cacheReadInputTokens ?? 0),
    );

    // Brief pause so user can see final token state before it disappears
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Remove in-progress message now that response has arrived
    removeMessageById(inProgressMsg.id);

    const elapsed = Date.now() - inProgressMsg.timestamp;
    const timeStr = formatDuration(elapsed);

    if (result.success) {
      const response = result.content || result.message;
      createAssistantMessage(`**FreeCode:** ${response || "Done!"}`);
      const inTokens = result.usage?.inputTokens ?? 0;
      const outTokens = result.usage?.outputTokens ?? 0;
      const contextLimit = await getModelContextLimit(
        `${currentProvider}/${currentModel}`,
      );
      const cachedTokens = result.usage?.cacheReadInputTokens ?? 0;
      const contextTokensUsed =
        result.usage?.contextTokens ?? inTokens + cachedTokens;
      // Feed the top-right context-usage overlay's progress bar.
      contextTokens = contextTokensUsed;
      contextLimitTokens = contextLimit;
      let tokenInfo = `↓${formatTokenCount(inTokens)} ↑${formatTokenCount(outTokens)}`;
      // The rate, not the raw count: "cached: 89.2k" is only meaningful next to
      // the input it was measured against, which meant doing the division by
      // eye every turn. claude-code and opencode both stop at the raw number.
      const hitRate = cacheHitRate(inTokens, cachedTokens);
      if (cachedTokens > 0 && hitRate !== undefined) {
        const writeTokens = result.usage?.cacheCreationInputTokens ?? 0;
        tokenInfo += ` cache ${hitRate}% (${formatTokenCount(cachedTokens)} read`;
        // Writes bill at ~1.25x, so a high read rate bought by constant
        // rewriting is not the win it looks like. Only shown when non-zero.
        tokenInfo += writeTokens > 0 ? `, ${formatTokenCount(writeTokens)} write)` : ")";
      }
      if (contextLimit > 0) {
        tokenInfo += ` [${formatTokenCount(contextTokens)}/${formatTokenCount(contextLimit)}]`;
      }

      // Restart the idle clock, and re-arm the nudge for the next quiet gap.
      lastTurnCompletedAt = Date.now();
      idleNudgeShownAt = null;

      sessionUsage.inputTokens += inTokens;
      sessionUsage.outputTokens += outTokens;
      sessionUsage.cacheReadTokens += cachedTokens;
      sessionUsage.cacheWriteTokens +=
        result.usage?.cacheCreationInputTokens ?? 0;
      sessionRuns += 1;
      const sessionRate = cacheHitRate(
        sessionUsage.inputTokens,
        sessionUsage.cacheReadTokens,
      );
      // Only from the second prompt on: before that it is the same number as
      // the run figure directly to its left.
      if (sessionRuns > 1 && sessionRate !== undefined) {
        tokenInfo += ` · session ${sessionRate}%`;
      }

      createSystemMessage(
        `${getRandomElapsedPhrase()} for ${timeStr} ${tokenInfo} (x${result.turnCount || 1})`,
      );
    } else {
      createSystemMessage(`**Error:** ${result.message || "Unknown error"}`);
      createSystemMessage(`${getRandomElapsedPhrase()} for ${timeStr}`);
    }
  } catch (error) {
    removeMessageById(inProgressMsg.id);
    showMessage(
      `**Error:** ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    activeTurnSessionId = null;
    editor.setText("");
  }
}

// A slash command name is a single bare word (`/model`, `/cost`, `/mcp:list`).
// Absolute paths start with "/" too, so a leading slash alone can't decide:
// "/home/me/repo check this" must go to the model as a prompt, not report
// "Unknown command: /home/me/repo".
const SLASH_COMMAND_NAME = /^[a-z0-9][a-z0-9_:.-]*$/i;

editor.onSubmit = async (value: string) => {
  // Resolve the chips the user left in place, in document order — anything
  // they deleted is simply not in `value` and never gets uploaded. The
  // `[Image #N]` placeholders are then stripped so the model sees a clean text
  // body; the bytes travel in the separate `images` payload.
  const images = editor.takeImagesFor(value);
  const promptText = stripImageTokens(value).trim();
  // An image on its own is a valid prompt ("what is this?" is implied).
  if (!promptText && images.length === 0) return;

  // Record the submission in the editor's in-memory ring and the on-disk
  // history.jsonl. The IPC call is best-effort: a transient core hiccup
  // shouldn't block the prompt from going out.
  editor.addToHistory(promptText);
  void appendPromptHistory(promptText);

  if (promptText.startsWith("/")) {
    const parts = promptText.slice(1).split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (commandName && SLASH_COMMAND_NAME.test(commandName)) {
      if (commandName === "freecode" && !commandRegistry.get("freecode")) {
        const mod = await import("./commands/freecode/index.js");
        mod.registerFreecodeCommand();
      }
      const command = commandRegistry.get(commandName);
      if (command) {
        editor.setText("");
        command.execute(args, {
          showMessage,
          showModelSelector: () => showProviderSelector("api"),
          showWebSelector: () => showProviderSelector("web"),
          showMcpPicker: () => showMcpPicker(),
          showEffortPicker,
          showResumePicker: showResumePicker,
          // Undefined until a run completes, so /cost omits the Session row
          // rather than printing a 0% that looks like a cache failure.
          getSessionUsage: () => (sessionRuns > 0 ? sessionUsage : undefined),
          clearSession: clearSession,
          compactSession: async () => {
            if (!currentSession) {
              showMessage("*No active session to compact.*");
              return;
            }
            showCompactionModal();
            try {
              const r = await sessionCompact(currentSession.sessionId);
              if (r.compacted) {
                finishCompactionModal(r.tokensBefore, r.tokensAfter);
              } else {
                // The server's reason ("nothing to compact") duplicates the
                // heading, so say what would actually change the outcome.
                dismissCompactionModal(
                  "Nothing older than the last 2 turns yet.",
                );
              }
            } catch (err) {
              dismissCompactionModal(
                err instanceof Error ? err.message : String(err),
              );
            }
          },
          showContextReport: async () => {
            if (!currentSession) {
              showMessage("*No active session — start a turn first.*");
              return;
            }
            try {
              showContextModal(await getContextStats(currentSession.sessionId));
            } catch (err) {
              showMessage(
                `*Error reading context usage: ${err instanceof Error ? err.message : String(err)}*`,
              );
            }
          },
          showCostReport: async () => {
            try {
              const data = await getUsage();
              showCostModal(
                data,
                sessionRuns > 0 ? sessionUsage : undefined,
              );
            } catch (err) {
              showMessage(
                `*Error fetching usage: ${err instanceof Error ? err.message : String(err)}*`,
              );
            }
          },
          createUserMessage: (content: string) => createUserMessage(content),
          createAssistantMessage: (content: string) =>
            createAssistantMessage(content),
          createSystemMessage: (content: string) =>
            createSystemMessage(content),
          createInProgressMessage: (
            phrase: string,
            inputTokens = 0,
            outputTokens = 0,
            contextLimit = 0,
          ) =>
            createInProgressMessage(
              phrase,
              inputTokens,
              outputTokens,
              contextLimit,
            ),
          updateInProgressMessage: (
            id: number,
            phrase: string,
            inputTokens: number,
            outputTokens: number,
            contextLimit: number,
            startTime: number,
            turns: number,
            cachedTokens?: number,
            contextTokens?: number,
          ) =>
            updateInProgressMessage(
              id,
              phrase,
              inputTokens,
              outputTokens,
              contextLimit,
              startTime,
              turns,
              cachedTokens,
              contextTokens,
            ),
          insertBeforeEditor: () => {
            /* no-op - messages go through store now */
          },
          removeMessageById: (id: number) => removeMessageById(id),
          handleToolEvent,
          runFullscreen: async (fn: () => Promise<void>) => {
            // Detach pi-tui so it stops rendering and releases stdin (and the
            // Kitty keyboard protocol) while the fullscreen UI owns the
            // terminal. Always re-attach, even if fn throws.
            tui.stop();
            try {
              await fn();
            } finally {
              // The heatmap runs in its own alternate screen; its exit
              // (\x1b[?1049l) drops back to the PRIMARY (shell) buffer, not
              // freecode's alt screen. Re-enter our alt screen and force a
              // full repaint so the chat is restored instead of painting over
              // the shell scrollback.
              process.stdout.write(ENTER_ALT_SCREEN);
              tui.start();
              tui.requestRender(true);
            }
          },
        });
        return;
      } else {
        showMessage(
          `**Error:** Unknown command: /${commandName}. Type /help for available commands.`,
        );
        return;
      }
    }
  }

  // With images, echo the text the user actually typed (chips included) so the
  // transcript shows where each one sat.
  await submitPrompt(
    promptText,
    images.length > 0 ? value.trim() : undefined,
    images,
  );
};

// Prompt commands (e.g. /init) are defined once in core. Fetch them at startup
// so every frontend shows the same list; executing one resolves its template
// and submits it through the normal agent send path.
void (async () => {
  try {
    startCli();
    const coreCommands = await listCommands(process.cwd());

    // Seed the editor's in-memory up-arrow ring with the persisted history so
    // recall works across sessions. `addToHistory` is at the same call site
    // that submit uses, so the editor's dedup and 100-item cap are applied
    // identically.
    try {
      const history = await getPromptHistory();
      // addToHistory prepends, so iterate oldest-first to keep disk order.
      for (let i = history.length - 1; i >= 0; i--) {
        editor.addToHistory(history[i] ?? "");
      }
    } catch {
      // Backend not up yet (or no history) — start with an empty ring.
    }
    for (const info of coreCommands) {
      registerCommand({
        name: info.name,
        description: info.description,
        argHint: info.argHint,
        execute: async (args: string[]) => {
          try {
            const prompt = await resolveCommand(info.name, args, process.cwd());
            const display = `/${info.name}${args.length ? ` ${args.join(" ")}` : ""}`;
            await submitPrompt(prompt, display);
          } catch (error) {
            showMessage(
              `**Error:** ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
    }
    // Rebuild autocomplete so the freshly registered commands appear.
    editor.setAutocompleteProvider(
      createAutocompleteProvider(
        commandRegistry.getSlashCommands(),
        process.cwd(),
      ),
    );
    tui.requestRender();
  } catch {
    // Core commands are optional; ignore if the backend is unavailable.
  }
})();

const interruptController = new InterruptController({
  isTurnActive: () => activeTurnSessionId !== null,
  cancelTurn: () => {
    const id = activeTurnSessionId;
    activeTurnSessionId = null;
    if (id) void sessionStop(id);
  },
  notify: (text) => showMessage(text),
  getSessionId: () => currentSession?.sessionId ?? null,
  shutdown: () => {
    tui?.stop();
    // Must happen before printResumeHint() so the hint lands on the
    // restored shell scrollback, not the alt screen we're about to leave.
    restoreScreen();
  },
});

// SGR mouse event: CSI < Cb ; Cx ; Cy M|m. Bit 0x40 marks a wheel event;
// bit 0x20 marks button-event motion (drag); release always ends in a
// lowercase 'm' (vs uppercase 'M' for press/drag). Non-wheel mouse events
// (clicks/drags) are matched too so they're swallowed here instead of
// leaking into the editor as garbage text.
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/;
const WHEEL_STEP = 3;

// Pinned todo panel (right-middle overlay). Mirrors the agent's live todo list
// in addition to the inline chat rendering. Non-capturing so it never steals
// focus from the editor; hidden on narrow terminals so it can't crowd the chat.
let todoPanel: TodoPanel | null = null;
let todoOverlay: OverlayHandle | null = null;

function updateTodoPanel(items: ReturnType<typeof parseTodoResult>): void {
  if (items.length === 0) {
    hideTodoPanel();
    return;
  }
  if (!todoPanel) todoPanel = new TodoPanel();
  todoPanel.setItems(items);
  if (!todoOverlay) {
    todoOverlay = tui.showOverlay(todoPanel, {
      anchor: "right-center",
      width: 38,
      maxHeight: "70%",
      margin: 1,
      nonCapturing: true,
      visible: (termWidth) => termWidth >= 100,
    });
  } else {
    todoOverlay.setHidden(false);
  }
  tui.requestRender();
}

function hideTodoPanel(): void {
  todoOverlay?.setHidden(true);
  todoPanel?.setItems([]);
  tui.requestRender();
}

// Transient notice (e.g. "Copied N chars"). Non-capturing so it never steals
// focus from the editor; re-copying replaces the current one instead of
// stacking boxes.
let noticeOverlay: OverlayHandle | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Context modal (/context)
// A scrollable card: the report is 17-27 rows depending on how many categories
// are loaded, which does not fit an 80x24 terminal. Capturing, because the
// arrow keys have to reach the card rather than the editor or the scrollback.
// ---------------------------------------------------------------------------
let contextOverlay: OverlayHandle | null = null;

/** Wide enough for the grid and its legend side by side, capped so it doesn't sprawl. */
const CONTEXT_MODAL_MAX_WIDTH = 90;

function showContextModal(stats: ContextBreakdown): void {
  // Re-entrant: a second /context while one is open replaces it rather than
  // stacking a card the first overlay handle can no longer reach.
  hideContextModal();

  const width = Math.min(
    CONTEXT_MODAL_MAX_WIDTH,
    Math.max(40, terminal.columns - 4),
  );
  const modal = new ScrollableModal(
    "Context Usage",
    (innerWidth) => renderContextReport(stats, innerWidth),
    () => hideContextModal(),
  );
  // A function, not a number: re-read each frame so resizing the terminal
  // while the card is open re-fits it instead of clipping the tail.
  modal.setMaxRows(() => Math.max(10, terminal.rows - 4));

  contextOverlay = tui.showOverlay(modal, {
    anchor: "center",
    width,
    // Backstop only, and a percentage so pi-tui re-resolves it per frame — the
    // card already fits itself, but a clip here would be silent.
    maxHeight: "95%",
  });
  tui.requestRender();
}

function hideContextModal(): void {
  if (!contextOverlay) return;
  contextOverlay.hide();
  contextOverlay = null;
  tui.setFocus(editor);
  tui.requestRender();
}

// ---------------------------------------------------------------------------
// Cost modal (/cost) — same ScrollableModal shell as /context.
// ---------------------------------------------------------------------------
let costOverlay: OverlayHandle | null = null;

function showCostModal(data: DailyUsage[], session: UsageTotals | undefined): void {
  hideCostModal();

  const width = Math.min(
    CONTEXT_MODAL_MAX_WIDTH,
    Math.max(40, terminal.columns - 4),
  );
  const modal = new ScrollableModal(
    "Token Usage",
    (innerWidth) => renderCostReportLines(data, session, innerWidth),
    () => hideCostModal(),
  );
  modal.setMaxRows(() => Math.max(10, terminal.rows - 4));

  costOverlay = tui.showOverlay(modal, {
    anchor: "center",
    width,
    maxHeight: "95%",
  });
  tui.requestRender();
}

function hideCostModal(): void {
  if (!costOverlay) return;
  costOverlay.hide();
  costOverlay = null;
  tui.setFocus(editor);
  tui.requestRender();
}

// ---------------------------------------------------------------------------
// Compaction modal
// Centered while a conversation is summarized, then held briefly on the result
// so the token reduction is readable before it disappears. Auto-compaction
// drives it from stream events; /compact drives it from its RPC result.
// ---------------------------------------------------------------------------
let compactionOverlay: OverlayHandle | null = null;
let compactionModal: CompactionModal | null = null;
let compactionAnimation: ReturnType<typeof setInterval> | null = null;
let compactionDismissTimer: ReturnType<typeof setTimeout> | null = null;

/** Frame interval for the indeterminate sweep. */
const COMPACTION_FRAME_MS = 80;
/** How long the finished state stays up before auto-dismissing. */
const COMPACTION_LINGER_MS = 1600;

function clearCompactionTimers(): void {
  if (compactionAnimation) clearInterval(compactionAnimation);
  if (compactionDismissTimer) clearTimeout(compactionDismissTimer);
  compactionAnimation = null;
  compactionDismissTimer = null;
}

function showCompactionModal(): void {
  // Re-entrant by design: a manual /compact during an auto pass would
  // otherwise leave the first overlay orphaned on screen forever.
  hideCompactionModal();

  compactionModal = new CompactionModal();
  compactionOverlay = tui.showOverlay(compactionModal, {
    anchor: "center",
    width: Math.min(
      compactionModal.width(),
      Math.max(24, terminal.columns - 4),
    ),
    // Non-capturing: compaction is not something the user answers, and stealing
    // focus mid-turn would swallow a Ctrl+C they meant for the running turn.
    nonCapturing: true,
  });

  compactionAnimation = setInterval(() => {
    compactionModal?.tick();
    tui.requestRender();
  }, COMPACTION_FRAME_MS);

  tui.requestRender();
}

function hideCompactionModal(): void {
  clearCompactionTimers();
  compactionOverlay?.hide();
  compactionOverlay = null;
  compactionModal = null;
}

/** Stop the sweep, show the reduction, then dismiss. */
function finishCompactionModal(
  tokensBefore: number,
  tokensAfter: number,
): void {
  if (!compactionModal) return;
  if (compactionAnimation) clearInterval(compactionAnimation);
  compactionAnimation = null;

  compactionModal.complete(tokensBefore, tokensAfter);
  tui.requestRender();

  // Also land it in the transcript: the modal is transient, but the reduction
  // is worth being able to scroll back to.
  showMessage(
    `*Compacted context: ~${tokensBefore.toLocaleString()} → ~${tokensAfter.toLocaleString()} tokens*`,
  );

  compactionDismissTimer = setTimeout(() => {
    hideCompactionModal();
    tui.requestRender();
  }, COMPACTION_LINGER_MS);
}

/** Terminal state for "ran, but there was nothing to do" (or an error). */
function dismissCompactionModal(reason: string): void {
  if (!compactionModal) return;
  if (compactionAnimation) clearInterval(compactionAnimation);
  compactionAnimation = null;

  compactionModal.fail(reason);
  tui.requestRender();

  compactionDismissTimer = setTimeout(() => {
    hideCompactionModal();
    tui.requestRender();
  }, COMPACTION_LINGER_MS);
}

// Rows occupied by the input and everything under it (spacer, mode line).
// Used to lift the bottom-anchored notice so it sits right on top of the input.
function inputChromeHeight(): number {
  const start = tui.children.indexOf(editor);
  if (start < 0) return 0;
  return tui.children
    .slice(start)
    .reduce((sum, child) => sum + child.render(terminal.columns).length, 0);
}

// Hug the text so a notice stays a single line, capped by what the terminal
// can actually show.
function noticeWidth(modal: NoticeModal): number {
  return Math.min(modal.width(), Math.max(20, terminal.columns - 4));
}

function showCopiedIndicator(charCount: number, truncated: boolean): void {
  const label = truncated
    ? `Copied first ${charCount} chars (selection truncated)`
    : `Copied ${charCount} chars`;

  if (noticeTimer) clearTimeout(noticeTimer);
  noticeOverlay?.hide();

  const modal = new NoticeModal(label);
  noticeOverlay = tui.showOverlay(modal, {
    // Pinned directly above the input instead of floating over the chat. The
    // jump-to-bottom pill hugs the right edge, so the two don't collide.
    anchor: "bottom-center",
    offsetY: -inputChromeHeight(),
    width: noticeWidth(modal),
    nonCapturing: true,
  });

  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    noticeOverlay?.hide();
    noticeOverlay = null;
    tui.requestRender();
  }, 1500);
  noticeTimer.unref?.();
}

// Jump-to-bottom pill: persistent affordance shown while the history is
// scrolled away from the bottom. Bordered (and not filled) so it reads as an
// actionable control rather than the transient toast style the NoticeModal
// defaults to. padX=0 and padY=0 hug the ▼ flush against the border on all
// sides — the pill is just "▼ inside a box".
const jumpModal = new NoticeModal("▼", 0, {
  border: true,
  borderColor: chalk.yellowBright,
  padX: 0,
});
const jumpOptions = {
  // Flush against the right edge, bottom row level with the top of the input.
  anchor: "bottom-right" as const,
  offsetY: 0,
  width: noticeWidth(jumpModal),
  nonCapturing: true,
  // pi-tui evaluates `visible` immediately before laying the overlay out on
  // every render, so it doubles as the hook that keeps the pill pinned to the
  // input as the prompt grows or the terminal resizes.
  visible: (): boolean => {
    jumpOptions.offsetY = -inputChromeHeight();
    jumpOptions.width = noticeWidth(jumpModal);
    return messageList.isScrolled;
  },
};
tui.showOverlay(jumpModal, jumpOptions);

/** Whether a click at (cx, cy) — 1-based — landed on the jump-to-bottom pill. */
function jumpButtonHit(cx: number, cy: number): boolean {
  if (!messageList.isScrolled) return false;
  const width = noticeWidth(jumpModal);
  const height = jumpModal.render(width).length;
  const bottom = terminal.rows - inputChromeHeight();
  const left = terminal.columns - width + 1; // 1-based, flush right
  return (
    cy <= bottom && cy > bottom - height && cx >= left && cx < left + width
  );
}

function extractSelectionText(): string {
  const sel = selectionStore.get();
  if (!sel) return "";
  const { startLine, startCol, endLine, endCol } = normalize(sel);
  const rows: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const raw = messageList.getLineAt(i);
    if (raw === null) continue;
    const text = plainText(raw);
    const from = i === startLine ? startCol : 0;
    const to = i === endLine ? endCol : text.length;
    rows.push(text.slice(from, to));
  }
  return rows.join("\n");
}

tui.addInputListener((data) => {
  const mouseEvent = SGR_MOUSE_RE.exec(data);
  if (mouseEvent) {
    const cb = Number(mouseEvent[1]);
    const cx = Number(mouseEvent[2]);
    const cy = Number(mouseEvent[3]);
    const isRelease = data.endsWith("m");

    if ((cb & 0x40) !== 0) {
      const down = (cb & 0x01) === 1;
      // The resume modal covers the chat, so while it is open the wheel drives
      // whichever of its panes the pointer is over, not the history behind it.
      if (resumeSelector) {
        resumeSelector.handleMouseWheel(down ? 1 : -1, cx - 1);
        tui.requestRender();
        return { consume: true };
      }
      messageList.scrollBy(down ? WHEEL_STEP : -WHEEL_STEP);
      return { consume: true };
    }

    if (isRelease) {
      if (selectionStore.get()) {
        const text = extractSelectionText();
        if (text.length > 0) {
          const { truncated, copied } = copyToClipboard(text);
          showCopiedIndicator(copied.length, truncated);
        }
      }
      tui.requestRender();
      return { consume: true };
    }

    const isDrag = (cb & 0x20) !== 0;
    const button = cb & 0x03;

    // Checked before the selection handling below, since the pill sits on top
    // of the history and a press there must not start a drag-select.
    if (button === 0 && !isDrag && jumpButtonHit(cx, cy)) {
      messageList.scrollToBottom();
      tui.requestRender();
      return { consume: true };
    }

    // Check if the click toggles an expandable message (e.g. thoughts or tool results)
    if (button === 0 && !isDrag && messageList.handleClick(cx, cy)) {
      return { consume: true };
    }

    const pos = messageList.resolveLogicalPosition(cx, cy);

    if (pos && button === 0 && !isDrag) {
      // Fresh press: click-to-clear if inside the existing selection,
      // otherwise start a new selection anchor.
      const prior = selectionStore.get();
      if (prior) {
        const { startLine, startCol, endLine, endCol } = normalize(prior);
        const insidePrior =
          pos.lineIndex > startLine ||
          (pos.lineIndex === startLine && pos.column >= startCol);
        const beforeEnd =
          pos.lineIndex < endLine ||
          (pos.lineIndex === endLine && pos.column <= endCol);
        if (insidePrior && beforeEnd) {
          selectionStore.clear();
          tui.requestRender();
          return { consume: true };
        }
      }
      selectionStore.begin(pos);
      tui.requestRender();
      return { consume: true };
    }
    if (pos && isDrag) {
      selectionStore.update(pos);
      tui.requestRender();
      return { consume: true };
    }
    if (cb === 0 && data.endsWith("M")) {
      messageList.handleClick(cx, cy);
    }
    return { consume: true };
  }
  if (matchesKey(data, "escape") && selectionStore.get()) {
    selectionStore.clear();
    tui.requestRender();
    return { consume: true };
  }
  if (matchesKey(data, Key.ctrl("c"))) {
    // An open selector swallows Ctrl+C as a cancel, matching Escape.
    if (resumeSelector) {
      hideResumeSelector();
      tui.setFocus(editor);
      tui.requestRender();
      return { consume: true };
    }
    if (modelSelector || providerSelector) {
      hideModelSelector();
      tui.setFocus(editor);
      tui.requestRender();
      return { consume: true };
    }
    if (mcpSelector) {
      hideMcpSelector();
      return { consume: true };
    }
    interruptController.handle();
    return { consume: true };
  }
  if (matchesKey(data, Key.shift("tab"))) {
    cycleAgentMode();
    return undefined;
  }
  if (matchesKey(data, Key.ctrl("v"))) {
    // Terminals can deliver a Ctrl+V burst (key repeat, or the emulator
    // echoing the chord) and the clipboard read is slow enough to overlap.
    // Without this guard the same paste attaches twice — doubling the upload
    // and the token cost.
    if (isReadingClipboard) return { consume: true };
    isReadingClipboard = true;
    // Fire-and-forget: the key handler is sync, and shelling out to the
    // clipboard tool takes long enough to stall input if awaited.
    void (async () => {
      try {
        const image = await readImageFromClipboard();
        if (!image) {
          createSystemMessage(noClipboardImageMessage());
        } else if (editor.hasImage(image.data)) {
          // Clipboard unchanged since the last paste — re-attaching the same
          // bytes is never what the user wants.
          createSystemMessage("That image is already attached.");
        } else {
          // The chip lands at the cursor and is its own confirmation, so no
          // system message here.
          editor.insertImageAtCursor({
            data: image.data,
            mediaType: image.mediaType,
          });
        }
      } finally {
        isReadingClipboard = false;
        tui.requestRender();
      }
    })();
    return { consume: true };
  }
  if (matchesKey(data, Key.ctrl("t"))) {
    const messages = getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.component instanceof ThinkingMessage) {
        msg.component.toggle();
        // Collapsing/expanding changes the message's height, so its cached
        // lines in the list have to go.
        messageList.invalidateMessage(msg.id);
        break;
      }
    }
    return { consume: true };
  }
  // Spec 2026-08-05: Ctrl+Backspace on the most recently queued message
  // pulls it out of the follow-up queue. Plain removal just drops it; the
  // default UX here also restores the content to the editor so the user can
  // revise — pi's "restore queued message to editor" affordance. To drop
  // without restoring, the user can select-all + delete from the editor
  // (the same way they handle any other unwanted queued text).
  if (matchesKey(data, Key.ctrl("h"))) {
    const messages = getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === "queued_user" && msg.queueId) {
        if (!currentSession) return { consume: true };
        const restored = msg.content;
        const queueId = msg.queueId;
        // Strip the "**You:** " label the row was rendered with so the
        // restored text matches what the user originally typed.
        const labelMatch = /^\*\*.+?:\*\*\s*/.exec(restored);
        const restoredText = labelMatch
          ? restored.slice(labelMatch[0].length)
          : restored;
        void (async () => {
          try {
            const { removed } = await sessionDequeue(
              currentSession.sessionId,
              queueId,
            );
            // Only restore if the server actually pulled it (it may have
            // already started sending — in that case the message_dequeued
            // event leaves the row in place and we shouldn't overwrite the
            // editor with stale content).
            if (removed) {
              editor.setText(restoredText);
              tui.setFocus(editor);
            }
            tui.requestRender();
          } catch (err) {
            showMessage(
              `**Error:** ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
        return { consume: true };
      }
    }
    return { consume: true };
  }
  // Message history scrolling — consumed here so the editor never sees them.
  if (matchesKey(data, "pageUp")) {
    messageList.scrollPageUp();
    return { consume: true };
  }
  if (matchesKey(data, "pageDown")) {
    messageList.scrollPageDown();
    return { consume: true };
  }
  return undefined;
});

// Wire stderr to system messages via store — must be the first startCli()
// call so the handler is attached when the process spawns.
startCli((stderrMsg) => {
  createSystemMessage(stderrMsg);
});

// Core keeps its session map in memory, so a respawned backend has never heard
// of the session still on screen and the next turn would fail with "Session not
// found". Re-resume it server-side; the transcript is already rendered here, so
// deliberately no loadSessionMessages() — that would duplicate the history.
setCliRestartHandler(() => {
  if (!currentSession) return;
  const sessionId = currentSession.sessionId;
  void sessionResume(sessionId).then(
    () => createSystemMessage("**Session recovered.** You can keep going."),
    (err) =>
      createSystemMessage(
        `**Could not recover the session:** ${err instanceof Error ? err.message : String(err)}. ` +
          `Try \`/resume\`.`,
      ),
  );
});

loadCurrentModel();

// Cache the tool + MCP counts once at startup so the logo header can render
// them synchronously. Errors are swallowed (daemon may not be ready yet) and
// leave the values at `-1`; the header falls back to `…`.
async function loadHeaderCounts(): Promise<void> {
  try {
    const [tools, servers] = await Promise.all([listTools(), mcpStatus()]);
    headerToolCount = tools.length;
    headerMcpCount = servers.length;
  } catch {
    // daemon may not be ready; leave the counts at -1.
  }
}
void loadHeaderCounts();

// Check for interrupted sessions on startup
async function checkForInterruptedSession(): Promise<void> {
  // Disabled: no longer surface the interrupted-session banner on startup.
}

// Parse `freecode --resume [id]` (alias `-r`). A bare `--resume` (no id) opens
// the interactive picker; an id resumes that session directly at startup.
function parseResumeArg(argv: string[]): { present: boolean; id?: string } {
  const i = argv.findIndex((a) => a === "--resume" || a === "-r");
  if (i === -1) return { present: false };
  const next = argv[i + 1];
  return {
    present: true,
    id: next && !next.startsWith("-") ? next : undefined,
  };
}

async function resumeFromArgs(id: string): Promise<void> {
  startCli();
  showMessage("**Resuming session...**");
  try {
    const result = await sessionResume(id);
    currentSession = { sessionId: result.sessionId };
    resetSessionCacheTotals();
    hideTodoPanel(); // clear any prior session's pinned todos
    if (result.messages && result.messages.length > 0) {
      loadSessionMessages(result.messages);
    }
    showMessage(
      `**Session resumed with ${result.messages?.length || 0} messages.**`,
    );
  } catch (err) {
    showMessage(`**Error resuming session:** ${err}`);
  }
  tui.setFocus(editor);
  tui.requestRender();
}

const resumeArg = parseResumeArg(process.argv);
if (resumeArg.present && resumeArg.id) {
  resumeFromArgs(resumeArg.id);
} else if (resumeArg.present) {
  showResumePicker();
} else {
  checkForInterruptedSession();
}

// Safety net for crash / uncaught-exception exits that skip the explicit
// shutdown() path above — restoreScreen() is idempotent, so this is a no-op
// when the alt screen was already exited cleanly.
process.on("exit", restoreScreen);

// A supervising process (agent-board driving this TUI headlessly over a PTY)
// has no way to send the double Ctrl+C that normally arms+confirms exit, so
// it falls back to SIGTERM. Without this handler that's a silent kill with
// no resume hint printed. forceExit() runs the same shutdown + hint sequence
// the interactive double-press does.
process.on("SIGTERM", () => {
  interruptController.forceExit();
});

// Faults that escape every try/catch: restore the terminal, take the backend
// down, and print a legible report instead of vanishing mid-session.
installCrashHandlers({
  stopCli,
  getSessionId: () => currentSession?.sessionId,
});

process.stdout.write(ENTER_ALT_SCREEN);
tui.start();
