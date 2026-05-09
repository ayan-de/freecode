#!/usr/bin/env node
import { ProcessTerminal, TUI, Key, matchesKey, CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { commandRegistry } from "./commands/index.js";
import { registerBuiltInCommands } from "./commands/built-in.js";
import { Editor } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultEditorTheme, defaultMarkdownTheme } from "./themes.js";
import { logoLines, logoTagline } from "./assets/logo.js";

registerBuiltInCommands();

let tui: TUI;
let messageCount = 0;

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

function showMessage(content: string): void {
	const msg = new Markdown(content, 1, 1, defaultMarkdownTheme);
	const children = tui.children;
	children.splice(children.length - 1, 0, msg);
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
				command.execute(args, { showMessage });
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

// process.on("SIGINT", () => {
// 	if (tui) {
// 		tui.stop();
// 	}
// 	process.exit(0);
// });

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