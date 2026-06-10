#!/usr/bin/env node
import { ProcessTerminal, TUI, Key, matchesKey, CombinedAutocompleteProvider, SelectList, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui";
import { commandRegistry } from "./commands/index.js";
import { registerBuiltInCommands } from "./commands/built-in.js";
import { Editor } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, MODE_COLORS, MODE_BG_COLORS } from "./themes.js";
import { getRandomElapsedPhrase, getRandomInProgressPhrase } from "./utils/elapsed-phrases.js";
import { getModelContextLimit } from "./utils/model-limits.js";
import { formatTokenCount } from "./utils/format-tokens.js";
import {
  startCli,
  sessionStart,
  sessionSendStreaming,
  sessionList,
  sessionResume,
  listProviders,
  listModels,
  getCurrentModel,
  setCurrentModel,
  setApiKey,
  type SessionInfo,
  type ModelInfo
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
import { VirtualMessageList } from "./components/virtual-message-list.js";
import { createResumePicker } from "./components/resume-picker.js";
import { ResponsiveInfoBox } from "./components/info-box.js";
import { createProviderSelector, createModelSelector } from "./components/model-picker.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;

let currentSession: SessionInfo | null = null;
let currentProvider = "";
let currentModel = "";
let currentAgentMode: "plan" | "build" | "review" | "explore" | "danger" = "build";
let agentModeDisplay: Text;
let agentModeDisplayIdx = -1;

let modelSelector: SelectList | null = null;
let providerSelector: SelectList | null = null;
let resumeSelector: SelectList | null = null;
let apiKeyEditor: Editor | null = null;
let apiKeyPrompt: Text | null = null;

let messageList: VirtualMessageList;
const toolMessageComponents = new Map<string, { progress: ToolProgressMessage; id: number; args: Record<string, unknown> }>();

const terminal = new ProcessTerminal();
tui = new TUI(terminal);

import { Spacer } from "@earendil-works/pi-tui";
import { getModelDisplayString } from "./utils/display.js";

tui.addChild(new ResponsiveInfoBox(() => currentProvider, () => currentModel));
tui.addChild(new Spacer(1));

// tui.addChild(new Text("\nType your messages below. Press Ctrl+C to exit."));

// Create message list and add to tui BEFORE editor
messageList = new VirtualMessageList(200);
messageList.setTui(tui);
tui.addChild(messageList);

const editor = new Editor(tui, defaultEditorTheme);
editor.setText("");

const autocompleteProvider = new CombinedAutocompleteProvider(
	commandRegistry.getSlashCommands(),
	process.cwd(),
	null,
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);
tui.addChild(new Spacer(1));
{
	const bgColor = MODE_BG_COLORS[currentAgentMode];
	const modeText = bgColor(chalk.bold.black(` ${currentAgentMode} `));
	const hintText = chalk.dim(" (shift+tab to cycle)");
	const modelText = `${chalk.bold.whiteBright("Model:")} ${chalk.dim(getModelDisplayString(currentProvider, currentModel))}`;
	agentModeDisplay = new Text(`${modeText}${hintText}  ${modelText}`, 1, 0);
}
agentModeDisplayIdx = tui.children.length;
tui.addChild(agentModeDisplay);

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
	const displayText = getModelDisplayString(currentProvider, currentModel);

	const bgColor = MODE_BG_COLORS[currentAgentMode];
	const modeText = bgColor(chalk.bold.black(` ${currentAgentMode} `));
	const hintText = chalk.dim(" (shift+tab to cycle)");
	const modelText = `${chalk.bold.whiteBright("Model:")} ${chalk.dim(displayText)}`;
	const text = `${modeText}${hintText}  ${modelText}`;

	agentModeDisplay = new Text(text, 1, 0);
	if (agentModeDisplayIdx >= 0 && agentModeDisplayIdx < tui.children.length) {
		tui.children[agentModeDisplayIdx] = agentModeDisplay;
	}
	tui.requestRender();
}

function cycleAgentMode(): void {
	const modes: Array<"plan" | "build" | "review" | "explore" | "danger"> = ["plan", "build", "review", "explore", "danger"];
	const idx = modes.indexOf(currentAgentMode);
	currentAgentMode = modes[(idx + 1) % modes.length];
	editor.borderColor = MODE_COLORS[currentAgentMode];
	updateAgentModeDisplay();
}

function showMessage(content: string): void {
	createSystemMessage(content);
}

function removeSelector(selector: SelectList | null): void {
	if (selector) {
		const idx = tui.children.indexOf(selector);
		if (idx !== -1) {
			tui.children.splice(idx, 1);
		}
		selector = null;
	}
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
			defaultSelectListTheme
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
		const models = await listModels(providerId);

		if (models.length === 0) {
			showMessage(`**No models available** for provider: ${providerId}`);
			return;
		}

		modelSelector = createModelSelector(
			models,
			{
				onSelect: async (modelId: string) => {
					currentProvider = providerId;
					currentModel = modelId;

					const providers = await listProviders();
					const providerInfo = (providers as any[]).find((p: any) => p.id === providerId);

					if (providerInfo && !providerInfo.hasApiKey) {
						await showApiKeyInput(providerId, modelId);
					} else {
						await setCurrentModel(providerId, modelId);
						updateModelDisplay();
						showMessage(`**Model changed to:** ${providerId}/${modelId}`);
					}
					hideModelSelector();
				},
				onCancel: () => {
					hideModelSelector();
					tui.setFocus(editor);
					tui.requestRender();
				},
			},
			defaultSelectListTheme
		);

		const editorIdx = tui.children.indexOf(editor);
		tui.children.splice(editorIdx + 1, 0, modelSelector);
		tui.setFocus(modelSelector);
		tui.requestRender();
	} catch (err) {
		showMessage(`**Error:** Failed to load models: ${err}`);
	}
}

async function showApiKeyInput(providerId: string, modelId: string): Promise<void> {
	removeApiKeyEditor();
	hideModelSelector();

	showMessage(`**Paste your API key for ${providerId} below and press Enter:**`);

	editor.setText("");
	tui.setFocus(editor);
	tui.requestRender();

	const originalOnSubmit = editor.onSubmit;
	editor.onSubmit = async (value: string) => {
		const apiKey = value.trim();
		if (!apiKey) {
			showMessage("**API key cannot be empty**");
			return;
		}

		await setApiKey(providerId, apiKey, modelId);
		await setCurrentModel(providerId, modelId);

		currentProvider = providerId;
		currentModel = modelId;
		updateModelDisplay();
		showMessage(`**API key saved and model set to:** ${providerId}/${modelId}`);

		editor.onSubmit = originalOnSubmit;
		tui.setFocus(editor);
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
						// Load messages from the resumed session into the UI
						if (result.messages && result.messages.length > 0) {
							loadSessionMessages(result.messages);
						}
						showMessage(`**Session resumed with ${result.messages?.length || 0} messages.**`);
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
			defaultSelectListTheme
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

	await new Promise(resolve => setTimeout(resolve, 800));

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

function handleToolEvent(event: StreamEvent): void {
	switch (event.type) {
		case "tool_start": {
			const toolMsg = createToolProgressMessage(event.toolCallId, event.toolName, event.args);
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
				entry.progress.updateOutput(event.content.split('\n').slice(-5));
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
				event.duration_ms
			);
			break;
		}
		case "thinking": {
			// Create or update thinking message - dimmed cyan stream
			const thinkingComponent = createThinkingMessage(event.content);
			tui.requestRender();
			break;
		}
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
			const command = commandRegistry.get(commandName);
			if (command) {
				editor.setText("");
				command.execute(args, {
					showMessage,
					showModelSelector: showProviderSelector,
					showResumePicker: showResumePicker,
					createUserMessage: (content: string) => createUserMessage(content),
					createAssistantMessage: (content: string) => createAssistantMessage(content),
					createSystemMessage: (content: string) => createSystemMessage(content),
					createInProgressMessage: (phrase: string, inputTokens = 0, outputTokens = 0, contextLimit = 0) => createInProgressMessage(phrase, inputTokens, outputTokens, contextLimit),
					updateInProgressMessage: (id: number, phrase: string, inputTokens: number, outputTokens: number, contextLimit: number, startTime: number, turns: number) => updateInProgressMessage(id, phrase, inputTokens, outputTokens, contextLimit, startTime, turns),
					insertBeforeEditor: () => { /* no-op - messages go through store now */ },
					removeMessageById: (id: number) => removeMessageById(id),
					handleToolEvent,
				});
				return;
			} else {
				showMessage(`**Error:** Unknown command: /${commandName}. Type /help for available commands.`);
				return;
			}
		}
	}

	messageCount++;

	// Create messages through the store - VirtualMessageList handles rendering
	createUserMessage(`**${chalk.red("You")}:** ${trimmed}`);
	const inProgressMsg = createInProgressMessage(getRandomInProgressPhrase());


	startCli();

	await new Promise(resolve => setTimeout(resolve, 500));

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

			currentSession = await sessionStart({
				projectPath: process.cwd(),
				provider: currentProvider || "minimax",
				agentMode: currentAgentMode,
			}) as SessionInfo;
		} catch (error) {
			removeMessageById(inProgressMsg.id);
			showMessage(`**Error:** Failed to start session: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
	}

	try {
		const result = await sessionSendStreaming(
			currentSession.sessionId,
			trimmed,
			undefined,
			currentAgentMode,
			(event: StreamEvent) => {
				handleToolEvent(event);
			}
		);

		// Update in-progress message with token counts from result
		const contextLimit = getModelContextLimit(`${currentProvider}/${currentModel}`);
		updateInProgressMessage(
			inProgressMsg.id,
			getRandomInProgressPhrase(),
			result.usage?.inputTokens ?? 0,
			result.usage?.outputTokens ?? 0,
			contextLimit,
			inProgressMsg.timestamp,
			result.turnCount || 1
		);

		// Brief pause so user can see final token state before it disappears
		await new Promise(resolve => setTimeout(resolve, 500));

		// Remove in-progress message now that response has arrived
		removeMessageById(inProgressMsg.id);


		const elapsed = Date.now() - inProgressMsg.timestamp;
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		const timeStr = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;

		if (result.success) {
			const response = result.content || result.message;
			createAssistantMessage(`**FreeCode:** ${response || "Done!"}`);
			const inTokens = result.usage?.inputTokens ?? 0;
			const outTokens = result.usage?.outputTokens ?? 0;
			const contextLimit = getModelContextLimit(`${currentProvider}/${currentModel}`);
			let tokenInfo = `↓${formatTokenCount(inTokens)} ↑${formatTokenCount(outTokens)}`;
			if (contextLimit > 0) {
				tokenInfo += ` [${formatTokenCount(inTokens)}/${formatTokenCount(contextLimit)}]`;
			}
			createSystemMessage(`${getRandomElapsedPhrase()} for ${timeStr} ${tokenInfo} (x${result.turnCount || 1})`);
		} else {
			createSystemMessage(`**Error:** ${result.message || "Unknown error"}`);
			createSystemMessage(`${getRandomElapsedPhrase()} for ${timeStr}`);
		}
	} catch (error) {
		removeMessageById(inProgressMsg.id);
		showMessage(`**Error:** ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		editor.setText("");
	}
};

tui.addInputListener((data) => {
	if (matchesKey(data, Key.ctrl("c"))) {
		if (tui) {
			tui.stop();
		}
		process.exit(0);
	}
	if (matchesKey(data, Key.shift("tab"))) {
		cycleAgentMode();
		return undefined;
	}
	return undefined;
});

loadCurrentModel();

// Check for interrupted sessions on startup
async function checkForInterruptedSession(): Promise<void> {
	try {
		const sessions = await sessionList({ status: 'interrupted' });
		if (sessions.length > 0) {
			showMessage("**Interrupted session detected. Type /resume to continue or start a new session.**");
		}
	} catch {
		// Ignore - session might not be available yet
	}
}

checkForInterruptedSession();

// Wire stderr to system messages via store
startCli((stderrMsg) => {
	createSystemMessage(stderrMsg);
});

const freecodeModule = await import("./commands/freecode/index.js");
process.on("exit", () => freecodeModule.stopSound?.());

tui.start();
