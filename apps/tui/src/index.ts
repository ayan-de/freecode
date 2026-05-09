#!/usr/bin/env node
import { ProcessTerminal, TUI, Key, matchesKey } from "@earendil-works/pi-tui";
import { Editor } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, defaultMarkdownTheme } from "./themes.js";
import { logoLines, logoTagline } from "./assets/logo.js";

let tui: TUI;

const terminal = new ProcessTerminal();
tui = new TUI(terminal);

const welcomeText = `${chalk.cyanBright(logoLines.join('\n'))}

${chalk.dim(logoTagline)}

Type your messages below. Press Ctrl+C to exit.`;

tui.addChild(new Text(welcomeText));

const editor = new Editor(tui, defaultEditorTheme);
tui.addChild(editor);
tui.setFocus(editor);

let messageCount = 0;

editor.onSubmit = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return;

	messageCount++;
	const userMessage = new Markdown(`**You:** ${trimmed}`, 1, 1, defaultMarkdownTheme);
	const children = tui.children;
	children.splice(children.length - 1, 0, userMessage);

	tui.requestRender();

	setTimeout(() => {
		const botMessage = new Markdown(`**FreeCode:** Message ${messageCount} received!`, 1, 1, defaultMarkdownTheme);
		children.splice(children.length - 1, 0, botMessage);
		tui.requestRender();
	}, 500);
};

// Handle SIGINT for clean exit (e.g., from kill command)
process.on("SIGINT", () => {
	if (tui) {
		tui.stop();
	}
	process.exit(0);
});

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