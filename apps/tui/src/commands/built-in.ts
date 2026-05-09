import { registerCommand, type Command, type CommandContext } from "./index.js";

const helpCommand: Command = {
	name: "help",
	description: "Show available commands",
	execute: (_args, ctx) => {
		ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/exit** - Exit FreeCode`);
	},
};

const clearCommand: Command = {
	name: "clear",
	description: "Clear all messages",
	execute: (_args, ctx) => {
		ctx.showMessage("*Messages cleared*");
	},
};

const exitCommand: Command = {
	name: "exit",
	description: "Exit FreeCode",
	execute: () => {
		process.exit(0);
	},
};

export function registerBuiltInCommands(): void {
	registerCommand(helpCommand);
	registerCommand(clearCommand);
	registerCommand(exitCommand);
}