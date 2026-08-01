#!/usr/bin/env node
import {
  ProcessTerminal,
  TUI,
  Key,
  matchesKey,
  CombinedAutocompleteProvider,
  SelectList,
  type SelectItem,
  type SelectListTheme,
  type OverlayHandle,
} from "@earendil-works/pi-tui";
import { TodoPanel, parseTodoResult } from "./components/todo-panel.js";
import { NoticeModal } from "./components/notice-modal.js";
import { CompactionModal } from "./components/compaction-modal.js";
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
import { formatTokenCount } from "./utils/format-tokens.js";
import { formatDuration } from "./utils/format-duration.js";
import { resolveFdPath } from "./utils/fd-path.js";
import { SelectionStore, normalize } from "./state/selection-store.js";
import { plainText } from "./utils/ansi-select.js";
import { copyToClipboard, readImageFromClipboard } from "./utils/clipboard.js";
import {
  startCli,
  sessionStart,
  sessionSendStreaming,
  sessionStop,
  sessionCompact,
  sessionList,
  sessionResume,
  listProviders,
  listModels,
  listCommands,
  resolveCommand,
  getCurrentModel,
  setCurrentModel,
  setApiKey,
  answerQuestion,
  rejectQuestion,
  answerPermission,
  rejectPermission,
  type SessionInfo,
  type ModelInfo,
} from "./ipc/client.js";
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createInProgressMessage,
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
import {
  setLiveOutputTokens,
  resetLiveOutputTokens,
  ThinkingMessage,
} from "./components/message-row.js";
import { getMessages } from "./state/message-store.js";
import { VirtualMessageList } from "./components/virtual-message-list.js";
import { PromptEditor } from "./components/prompt-editor.js";
import { createResumePicker } from "./components/resume-picker.js";
import { InterruptController } from "./interrupt-controller.js";
import { ENTER_ALT_SCREEN, restoreScreen } from "./terminal-screen.js";
import { ResponsiveInfoBox } from "./components/info-box.js";
import { StatusHeader } from "./components/status-header.js";
import { ModeLine } from "./components/mode-line.js";
import {
  createProviderSelector,
  createModelSelector,
} from "./components/model-picker.js";
import { SearchableSelectList } from "./components/searchable-select-list.js";
import { createQuestionPicker } from "./components/question-picker.js";
import { createPermissionPicker } from "./components/permission-picker.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;

let currentSession: SessionInfo | null = null;
// Session id of the turn currently streaming, or null when idle. Drives whether
// Ctrl+C cancels the turn (busy) or moves toward exit (idle).
let activeTurnSessionId: string | null = null;
let currentProvider = "";
let currentModel = "";
let currentAgentMode: "plan" | "build" | "review" | "explore" | "danger" =
  "build";
// Images pasted with Ctrl+V, attached to the next prompt and then cleared.
let pendingImages: Array<{
  data: string;
  mediaType: string;
  altText?: string;
}> = [];
// Guards against overlapping clipboard reads from a Ctrl+V key burst.
let isReadingClipboard = false;
// Fixed top status header: hidden until the first prompt is sent, then shows
// mode/model on the left and live context-window usage on the right.
let hasFirstMessage = false;
let contextTokens = 0;
let contextLimitTokens = 0;
// Running length of streamed assistant text for the active turn, converted to a
// live output-token estimate (~4 chars/token) for the in-progress line.
let streamedChars = 0;
let modeLine: ModeLine;

let modelSelector: SearchableSelectList | null = null;
let providerSelector: SearchableSelectList | null = null;
let resumeSelector: SelectList | null = null;
let apiKeyEditor: Input | null = null;
let apiKeyPrompt: Text | null = null;

let editor: PromptEditor;
let messageList: VirtualMessageList;
const toolMessageComponents = new Map<
  string,
  { progress: ToolProgressMessage; id: number; args: Record<string, unknown> }
>();

const terminal = new ProcessTerminal();
tui = new TUI(terminal);

import { Spacer } from "@earendil-works/pi-tui";

const infoBox = new ResponsiveInfoBox(
  () => currentProvider,
  () => currentModel,
);

// Fixed header pinned to the top row. Added as the TUI's first child so it
// renders above the scrollable history and never scrolls away. Hidden (0 rows)
// until the first prompt is sent — see hasFirstMessage.
const statusHeader = new StatusHeader(
  () => hasFirstMessage,
  () => currentAgentMode,
  () => currentProvider,
  () => currentModel,
  () => contextTokens,
  () => contextLimitTokens,
);
tui.addChild(statusHeader);

// tui.addChild(new Text("\nType your messages below. Press Ctrl+C to exit."));

// Text selection: click-drag over the message history highlights and, on
// release, copies the dragged text via OSC 52 (see the mouse handling below).
const selectionStore = new SelectionStore();

// Create message list and add to tui BEFORE editor. infoBox renders as the
// list's first entry (see VirtualMessageList) so it scrolls away with the
// rest of the history instead of sitting fixed above the viewport.
// The viewport callback tells the list how many rows it may use in scrolled
// mode: terminal height minus the chrome below it (editor, spacers, mode line)
// and the fixed status header, so the scrolled window and the input stay on
// screen together.
const getMessageListOffset = () => {
  const idx = tui.children.indexOf(messageList);
  if (idx <= 0) return 0;
  return tui.children.slice(0, idx).reduce((sum, child) => {
    if (child === statusHeader) return sum + statusHeader.height();
    return sum + child.render(terminal.columns).length;
  }, 0);
};

messageList = new VirtualMessageList(
  200,
  () => {
    const otherHeight = tui.children
      .filter((child) => child !== messageList)
      .reduce((sum, child) => {
        if (child === statusHeader) {
          return sum + statusHeader.height();
        }
        return sum + child.render(terminal.columns).length;
      }, 0);
    return Math.max(6, terminal.rows - otherHeight);
  },
  infoBox,
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

// `@` file mentions need an fd binary; without one pi-tui returns no
// suggestions for `@` and slash-command completion still works as before.
const fdPath = resolveFdPath();
const autocompleteProvider = new CombinedAutocompleteProvider(
  commandRegistry.getSlashCommands(),
  process.cwd(),
  fdPath,
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);
tui.addChild(new Spacer(1));
// Mode/model line below the input. Hidden after the first prompt — the fixed
// top StatusHeader carries the same info from then on.
modeLine = new ModeLine(
  () => hasFirstMessage,
  () => currentAgentMode,
  () => currentProvider,
  () => currentModel,
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
  // ModeLine and StatusHeader read mode/model through live getters, so a
  // re-render is all that's needed to reflect a mode cycle or model change.
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
        void answerPermission(event.requestId, decision);
        showNextPermission();
      },
      onCancel: () => {
        removeSelector(picker);
        void rejectPermission(event.requestId);
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
  tui.requestRender();
}

function hideResumeSelector(): void {
  removeSelector(resumeSelector);
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

async function showProviderSelector(): Promise<void> {
  hideModelSelector();
  removeApiKeyEditor();

  try {
    const providers = await listProviders();

    providerSelector = createProviderSelector(
      providers,
      {
        onSelect: async (providerId: string) => {
          await showModelSelector(providerId);
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

async function showModelSelector(providerId: string): Promise<void> {
  hideModelSelector();

  try {
    const [models, providers] = await Promise.all([
      listModels(providerId),
      listProviders(),
    ]);

    if (models.length === 0) {
      showMessage(`**No models available** for provider: ${providerId}`);
      return;
    }

    const providerInfo = (providers as any[]).find(
      (p: any) => p.id === providerId,
    );
    const hasApiKey = Boolean(providerInfo?.hasApiKey);

    modelSelector = createModelSelector(
      models,
      {
        onSelect: async (modelId: string) => {
          currentProvider = providerId;
          currentModel = modelId;

          hideModelSelector();
          if (!hasApiKey) {
            await showApiKeyInput(providerId, modelId);
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
        ...(hasApiKey && {
          onUpdateApiKey: async () => {
            hideModelSelector();
            await showApiKeyInput(providerId);
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

async function showApiKeyInput(
  providerId: string,
  modelId?: string,
): Promise<void> {
  removeApiKeyEditor();
  hideModelSelector();

  apiKeyPrompt = new Text(
    chalk.bold(`Paste your API key for ${providerId} `) +
      chalk.dim("(Enter to save, Esc to cancel)"),
    1,
    0,
  );
  apiKeyEditor = new Input();

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
    const apiKey = value.trim();
    if (!apiKey) {
      showMessage("**API key cannot be empty**");
      return;
    }

    await setApiKey(providerId, apiKey, modelId);

    if (modelId) {
      await setCurrentModel(providerId, modelId);
      currentProvider = providerId;
      currentModel = modelId;
      updateModelDisplay();
      showMessage(
        `**API key saved and model set to:** ${providerId}/${modelId}`,
      );
    } else {
      showMessage(`**API key updated for:** ${providerId}`);
    }

    removeApiKeyEditor();
    tui.setFocus(editor);
    tui.requestRender();
  };
}

async function showResumePicker(): Promise<void> {
  hideResumeSelector();
  hideModelSelector();

  try {
    const sessions = await sessionList({});

    if (sessions.length === 0) {
      showMessage("**No sessions found.**");
      return;
    }

    // Sort by lastTurnAt descending (most recent first)
    sessions.sort((a, b) => b.lastTurnAt - a.lastTurnAt);

    const { component: picker } = createResumePicker(
      sessions,
      {
        onSelect: async (sessionId: string) => {
          hideResumeSelector();
          showMessage(`**Resuming session...**`);
          try {
            const result = await sessionResume(sessionId);
            currentSession = { sessionId: result.sessionId };
            hideTodoPanel(); // clear any prior session's pinned todos
            // Load messages from the resumed session into the UI
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
      },
      defaultSelectListTheme,
    );

    resumeSelector = picker;

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, resumeSelector);
    tui.setFocus(resumeSelector);
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
  } catch {
    // CLI might not be running yet, ignore
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
    case "question_asked": {
      // Render each question as a SelectList in sequence, collecting answers
      // indexed by question, then reply once the last one is answered.
      const answers: string[] = [];
      const askAt = (i: number) => {
        const picker = createQuestionPicker(
          event.questions[i],
          {
            onSelect: (label) => {
              answers[i] = label;
              removeSelector(picker);
              if (i + 1 < event.questions.length) {
                askAt(i + 1);
              } else {
                void answerQuestion(event.requestId, answers);
                tui.setFocus(editor);
              }
              tui.requestRender();
            },
            onCancel: () => {
              removeSelector(picker);
              void rejectQuestion(event.requestId);
              tui.setFocus(editor);
              tui.requestRender();
            },
          },
          defaultSelectListTheme,
        );
        const editorIdx = tui.children.indexOf(editor);
        tui.children.splice(editorIdx + 1, 0, picker);
        tui.setFocus(picker);
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
  }
}

// Send a prompt to the agent through the streaming session. `displayText`, when
// given, is shown as the "You:" message instead of the raw prompt — used by
// prompt commands (e.g. /init) that expand into a long instruction.
async function submitPrompt(
  promptText: string,
  displayText?: string,
): Promise<void> {
  messageCount++;
  // First prompt reveals the fixed top status header.
  hasFirstMessage = true;
  // Reset the live streamed-token estimate for this turn.
  streamedChars = 0;
  resetLiveOutputTokens();

  // A fresh prompt starts a fresh view: clear the pinned todo panel so a prior
  // task's plan doesn't linger. It reappears if the agent calls todowrite again.
  hideTodoPanel();

  // A new prompt always returns the view to the live bottom of the history.
  messageList.scrollToBottom();

  // Create messages through the store - VirtualMessageList handles rendering
  createUserMessage(`**${chalk.red("You")}:** ${displayText ?? promptText}`);
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
    // Hand off and clear: an image is attached to exactly one turn, and
    // leaving it queued would silently re-send it on the next prompt.
    const images = pendingImages.length > 0 ? pendingImages : undefined;
    pendingImages = [];
    // Clear the editor's pending images display
    editor.pendingImages = [];
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
    );

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
      // Feed the fixed top header's context-usage progress bar.
      contextTokens = contextTokensUsed;
      contextLimitTokens = contextLimit;
      let tokenInfo = `↓${formatTokenCount(inTokens)} ↑${formatTokenCount(outTokens)}`;
      if (cachedTokens > 0) {
        tokenInfo += ` cached: ${formatTokenCount(cachedTokens)}`;
      }
      if (contextLimit > 0) {
        tokenInfo += ` [${formatTokenCount(contextTokens)}/${formatTokenCount(contextLimit)}]`;
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

editor.onSubmit = async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (commandName) {
      if (commandName === "freecode" && !commandRegistry.get("freecode")) {
        const mod = await import("./commands/freecode/index.js");
        mod.registerFreecodeCommand();
        stopSoundFn = mod.stopSound;
      }
      if (commandName === "mcp" && !commandRegistry.get("mcp")) {
        const mod = await import("./commands/freecode/mcp.js");
        mod.registerMcpCommand();
      }
      const command = commandRegistry.get(commandName);
      if (command) {
        editor.setText("");
        command.execute(args, {
          showMessage,
          showModelSelector: showProviderSelector,
          showResumePicker: showResumePicker,
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

  await submitPrompt(trimmed);
};

// Prompt commands (e.g. /init) are defined once in core. Fetch them at startup
// so every frontend shows the same list; executing one resolves its template
// and submits it through the normal agent send path.
void (async () => {
  try {
    startCli();
    const coreCommands = await listCommands(process.cwd());
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
      new CombinedAutocompleteProvider(
        commandRegistry.getSlashCommands(),
        process.cwd(),
        fdPath,
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

// Jump-to-bottom pill: same notice styling, but persistent and padded on all
// sides — it shows for as long as the history is scrolled away from the
// bottom, and clicking it returns to follow mode.
const jumpModal = new NoticeModal("↓", 1);
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
      messageList.scrollBy((cb & 0x01) === 1 ? WHEEL_STEP : -WHEEL_STEP);
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
          createSystemMessage(
            "No image on the clipboard. (Needs `wl-paste`, `xclip`, or `pngpaste` installed.)",
          );
        } else if (pendingImages.some((p) => p.data === image.data)) {
          // Clipboard unchanged since the last paste — re-attaching the same
          // bytes is never what the user wants.
          createSystemMessage("That image is already attached.");
        } else {
          pendingImages.push({
            ...image,
            altText: `pasted image (${image.mediaType})`,
          });
          // Update the editor to show the image container
          editor.pendingImages = pendingImages;
          const kb = ((image.data.length * 3) / 4 / 1024).toFixed(0);
          createSystemMessage(
            `Attached pasted image (${image.mediaType}, ~${kb}KB). It will be sent with your next message.`,
          );
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
        tui.requestRender();
        break;
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

loadCurrentModel();

// Check for interrupted sessions on startup
async function checkForInterruptedSession(): Promise<void> {
  try {
    const sessions = await sessionList({ status: "interrupted" });
    if (sessions.length > 0) {
      showMessage(
        "**Interrupted session detected. Type /resume to continue or start a new session.**",
      );
    }
  } catch {
    // Ignore - session might not be available yet
  }
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

// stopSound only matters once the freecode module has been lazy-loaded
// (sound can only be playing if it was); see the /freecode dispatch above.
let stopSoundFn: (() => void) | null = null;
process.on("exit", () => stopSoundFn?.());
// Safety net for crash / uncaught-exception exits that skip the explicit
// shutdown() path above — restoreScreen() is idempotent, so this is a no-op
// when the alt screen was already exited cleanly.
process.on("exit", restoreScreen);

process.stdout.write(ENTER_ALT_SCREEN);
tui.start();
