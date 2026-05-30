#!/usr/bin/env node
import { ProcessTerminal, TUI, Key, matchesKey, CombinedAutocompleteProvider, SelectList, Box, type Component, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui";
import { commandRegistry } from "./commands/index.js";
import { registerBuiltInCommands } from "./commands/built-in.js";
import { Editor } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, defaultMarkdownTheme } from "./themes.js";
import { logoLines, logoTagline } from "./assets/logo.js";
import { startCli, listProviders, listModels, getCurrentModel, setCurrentModel, setApiKey, type ModelInfo } from "./ipc/client.js";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;
let currentProvider = "";
let currentModel = "";
let modelDisplay: Text;
let modelSelector: SelectList | null = null;
let providerSelector: SelectList | null = null;
let apiKeyEditor: Editor | null = null;
let apiKeyPrompt: Text | null = null;
let modelDisplayIdx = -1; // Track index of model display in children

const terminal = new ProcessTerminal();
tui = new TUI(terminal);

const welcomeText = `${chalk.cyanBright(logoLines.join('\n'))}

${chalk.dim(logoTagline)}

Type your messages below. Press Ctrl+C to exit.`;

tui.addChild(new Text(welcomeText));

const editor = new Editor(tui, defaultEditorTheme);

const autocompleteProvider = new CombinedAutocompleteProvider(
	commandRegistry.getSlashCommands(),
	process.cwd(),
	null,
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);

modelDisplay = new Text(chalk.dim(`Model: not selected`));
modelDisplayIdx = tui.children.length;
tui.addChild(modelDisplay);

tui.setFocus(editor);

const defaultSelectListTheme: SelectListTheme = {
	selectedPrefix: (text) => `❯ ${text}`,
	selectedText: (text) => chalk.cyanBright(text),
	description: (text) => chalk.dim(text),
	scrollInfo: (text) => chalk.dim(text),
	noMatch: (text) => chalk.red(text),
};

function updateModelDisplay(): void {
	// Always update the display text
	const displayText = currentProvider && currentModel
		? `${currentProvider}/${currentModel}`
		: "not selected";

	modelDisplay = new Text(chalk.dim(`Model: ${displayText}`));

	// Use stored index to update model display
	if (modelDisplayIdx >= 0 && modelDisplayIdx < tui.children.length) {
		tui.children[modelDisplayIdx] = modelDisplay;
	}

	tui.requestRender();
}

function showMessage(content: string): void {
	// Check if this is a user message (contains **You with chalk styling)
	// Content looks like: **[31mYou[0m:** message
	const isUserMessage = content.includes("**") && content.includes("You") && content.includes(":");

	let msg: Component;
	let displayContent = content;
	if (isUserMessage) {
		// Remove the **You:** prefix for display but keep background
		displayContent = content.replace(/\*\*[^\:]+:\*\*\s*/, "");
		const box = new Box(0, 0, (text: string) => {
			return text.split('\n').map(line => chalk.bgRgb(80, 80, 80)(line)).join('\n');
		});
		msg = new Markdown(displayContent, 1, 1, defaultMarkdownTheme);
		box.addChild(msg);
		msg = box;
	} else if (content.includes("**") && content.includes("FreeCode") && content.includes(":")) {
		// Remove the **FreeCode:** prefix for assistant messages too
		displayContent = content.replace(/\*\*[^\:]+:\*\*\s*/, "");
		msg = new Markdown(displayContent, 1, 1, defaultMarkdownTheme);
	} else {
		msg = new Markdown(content, 1, 1, defaultMarkdownTheme);
	}

	const children = tui.children;
	// Insert after welcome (index 0), before editor and model display
	const editorIdx = children.indexOf(editor);
	children.splice(editorIdx, 0, msg);
	tui.requestRender();
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
		const hasApiKeyMap: Record<string, boolean> = {};
		for (const p of providers as any[]) {
			hasApiKeyMap[p.id] = p.hasApiKey;
		}

		const providerItems: SelectItem[] = providers.map((p: any) => ({
			label: p.name,
			value: p.id,
			description: hasApiKeyMap[p.id] ? "(configured)" : "(not configured)",
		}));

		const maxVisible = Math.min(providerItems.length, 5);
		providerSelector = new SelectList(providerItems, maxVisible, defaultSelectListTheme);

		providerSelector.onSelect = async (item: SelectItem) => {
			await showModelSelector(item.value);
		};

		providerSelector.onCancel = () => {
			hideModelSelector();
			tui.setFocus(editor);
			tui.requestRender();
		};

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

		const modelItems: SelectItem[] = models.map((m: ModelInfo) => ({
			label: m.name || m.id,
			value: m.id,
			description: m.description || m.id,
		}));

		if (modelItems.length === 0) {
			showMessage(`**No models available** for provider: ${providerId}`);
			return;
		}

		const maxVisible = Math.min(modelItems.length, 5);
		modelSelector = new SelectList(modelItems, maxVisible, defaultSelectListTheme);

		modelSelector.onSelect = async (item: SelectItem) => {
			currentProvider = providerId;
			currentModel = item.value;

			// Check if provider has API key
			const providers = await listProviders();
			const providerInfo = (providers as any[]).find((p: any) => p.id === providerId);

			if (providerInfo && !providerInfo.hasApiKey) {
				// Show API key input
				await showApiKeyInput(providerId, item.value);
			} else {
				// Already has API key, just save current model
				await setCurrentModel(providerId, item.value);
				updateModelDisplay();
				showMessage(`**Model changed to:** ${providerId}/${item.value}`);
			}
			hideModelSelector();
		};

		modelSelector.onCancel = () => {
			hideModelSelector();
			tui.setFocus(editor);
			tui.requestRender();
		};

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

	// Clear the main editor and set placeholder
	editor.setText("");

	tui.setFocus(editor);
	tui.requestRender();

	// Override editor's onSubmit temporarily to capture API key
	const originalOnSubmit = editor.onSubmit;
	editor.onSubmit = async (value: string) => {
		const apiKey = value.trim();
		if (!apiKey) {
			showMessage("**API key cannot be empty**");
			return;
		}

		// Save API key and current model to config
		await setApiKey(providerId, apiKey, modelId);
		await setCurrentModel(providerId, modelId);

		currentProvider = providerId;
		currentModel = modelId;
		updateModelDisplay();
		showMessage(`**API key saved and model set to:** ${providerId}/${modelId}`);

		// Restore original onSubmit
		editor.onSubmit = originalOnSubmit;
		tui.setFocus(editor);
	};
}

async function loadCurrentModel(): Promise<void> {
	startCli();

	// Wait for CLI to initialize
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

editor.onSubmit = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return;

	if (trimmed.startsWith("/")) {
		const parts = trimmed.slice(1).split(/\s+/);
		const commandName = parts[0]?.toLowerCase();
		const args = parts.slice(1);

		if (commandName) {
			const command = commandRegistry.get(commandName);
			if (command) {
				command.execute(args, { showMessage, showModelSelector: showProviderSelector });
				return;
			} else {
				showMessage(`**Error:** Unknown command: /${commandName}. Type /help for available commands.`);
				return;
			}
		}
	}

	messageCount++;
	showMessage(`**${chalk.red("You")}:** ${trimmed}`);

	setTimeout(() => {
		showMessage(`**${chalk.cyan("FreeCode")}:** Message ${messageCount} received!`);
	}, 500);
};

// Handle Ctrl+C for clean exit from keyboard
tui.addInputListener((data) => {
	if (matchesKey(data, Key.ctrl("c"))) {
		if (tui) {
			tui.stop();
		}
		process.exit(0);
	}
	return undefined;
});

// Load current model from config on startup
loadCurrentModel();

tui.start();