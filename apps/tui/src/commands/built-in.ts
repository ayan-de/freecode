import { registerCommand, type Command, type CommandContext } from "./index.js";
import { AVAILABLE_MODELS } from "../models.js";
import { registerFreecodeCommand } from "./freecode/index.js";

const helpCommand: Command = {
	name: "help",
	description: "Show available commands",
	execute: (_args, ctx) => {
		ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/model** - Select AI model
- **/exit** - Exit FreeCode
- **/freecode** - Send prompt to ChatGPT and apply file changes`);
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

const modelCommand: Command = {
	name: "model",
	description: "Select AI model",
	execute: (_args, ctx) => {
		ctx.showMessage(`**Select AI Model:**\n\nUse the selector below to choose a model.`);
		ctx.showModelSelector?.();
	},
};

export function registerBuiltInCommands(): void {
	registerCommand(helpCommand);
	registerCommand(clearCommand);
	registerCommand(exitCommand);
	registerCommand(modelCommand);
	registerFreecodeCommand();
}