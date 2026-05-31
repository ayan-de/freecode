import type { Component } from "@earendil-works/pi-tui";
import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";

export interface MessageCreators {
	createUserMessage(content: string): { component: Component; id: number };
	createAssistantMessage(content: string): { component: Component; id: number };
	createSystemMessage(content: string): { component: Component; id: number };
	createInProgressMessage(phrase: string): { component: Component; id: number };
	insertBeforeEditor(component: Component): void;
	removeMessageById(id: number): void;
}

export interface CommandContext extends MessageCreators {
	showMessage(content: string): void;
	showModelSelector?(): void;
}

export interface Command {
	name: string;
	description: string;
	execute(args: string[], context: CommandContext): void | Promise<void>;
}

class CommandRegistry {
	private commands = new Map<string, Command>();
	private autocompleteItems: AutocompleteItem[] = [];

	register(command: Command): void {
		this.commands.set(command.name, command);
		this.autocompleteItems.push({
			label: command.name,
			value: command.name,
			description: command.description,
		});
	}

	get(name: string): Command | undefined {
		return this.commands.get(name);
	}

	getAll(): Command[] {
		return Array.from(this.commands.values());
	}

	getAutocompleteItems(): AutocompleteItem[] {
		return this.autocompleteItems;
	}

	getSlashCommands(): SlashCommand[] {
		return this.getAll().map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));
	}
}

export const commandRegistry = new CommandRegistry();

export function registerCommand(command: Command): void {
	commandRegistry.register(command);
}

export function getCommand(name: string): Command | undefined {
	return commandRegistry.get(name);
}