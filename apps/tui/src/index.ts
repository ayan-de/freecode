#!/usr/bin/env node
import { ProcessTerminal, TUI, Key, matchesKey, CombinedAutocompleteProvider, SelectList, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui";
import { commandRegistry } from "./commands/index.js";
import { registerBuiltInCommands } from "./commands/built-in.js";
import { AVAILABLE_MODELS } from "./models.js";
import { Editor } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, defaultMarkdownTheme } from "./themes.js";
import { logoLines, logoTagline } from "./assets/logo.js";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;
let currentModel = "claude-sonnet-4-6";
let modelSelector: SelectList | null = null;

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
tui.setFocus(editor);

const defaultSelectListTheme: SelectListTheme = {
	selectedPrefix: (text) => `❯ ${text}`,
	selectedText: (text) => chalk.cyanBright(text),
	description: (text) => chalk.dim(text),
	scrollInfo: (text) => chalk.dim(text),
	noMatch: (text) => chalk.red(text),
};

function showMessage(content: string): void {
	const msg = new Markdown(content, 1, 1, defaultMarkdownTheme);
	const children = tui.children;
	children.splice(children.length - 1, 0, msg);
	tui.requestRender();
}

function hideModelSelector(): void {
	if (modelSelector) {
		const idx = tui.children.indexOf(modelSelector);
		if (idx !== -1) {
			tui.children.splice(idx, 1);
		}
		modelSelector = null;
		tui.setFocus(editor);
		tui.requestRender();
	}
}

function showModelSelector(): void {
	hideModelSelector();

	const modelItems: SelectItem[] = AVAILABLE_MODELS.map((m) => ({
		label: m.name,
		value: m.id,
		description: m.description,
	}));

	const maxVisible = Math.min(modelItems.length, 5);
	modelSelector = new SelectList(modelItems, maxVisible, defaultSelectListTheme);

	modelSelector.onSelect = (item: SelectItem) => {
		currentModel = item.value;
		const model = AVAILABLE_MODELS.find((m) => m.id === item.value);
		showMessage(`**Model changed to:** ${model?.name ?? item.value}`);
		hideModelSelector();
	};

	modelSelector.onCancel = () => {
		hideModelSelector();
	};

	const editorIdx = tui.children.indexOf(editor);
	tui.children.splice(editorIdx + 1, 0, modelSelector);
	tui.setFocus(modelSelector);
	tui.requestRender();
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
				command.execute(args, { showMessage, showModelSelector });
				return;
			} else {
				showMessage(`**Error:** Unknown command: /${commandName}. Type /help for available commands.`);
				return;
			}
		}
	}

	messageCount++;
	showMessage(`**You:** ${trimmed}`);

	setTimeout(() => {
		showMessage(`**FreeCode:** Message ${messageCount} received!`);
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

tui.start();