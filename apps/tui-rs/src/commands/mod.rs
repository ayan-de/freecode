//! Slash-command system for the composer. Mirrors the TS TUI's registry
//! (`apps/tui/src/commands`): a `Command` trait, a registry that owns the
//! built-ins, and a single dispatch entry point. Adding a command is one file
//! plus one `register` line in `with_builtins` — nothing else changes.

mod clear;
mod compact;
mod help;
mod mode;
mod model;
mod quit;

use crate::app::App;

/// Side effects the main loop must own. Commands mutate `App` directly for
/// everything else (messages, mode, scroll), so this enum stays deliberately
/// small — most commands just return `Done`.
pub enum CommandOutcome {
    /// The command finished; it already updated `App` as needed.
    Done,
    /// Tear down the TUI and exit.
    Quit,
    /// Fetch the model list over IPC and open the model picker modal. Handled
    /// by the main loop because it needs async IPC before showing the modal.
    OpenModelPicker,
    /// Manually compact the session (`session.compact`). Handled by the main
    /// loop because it needs an async IPC call.
    CompactSession,
}

/// Everything a command may touch. Grouping capabilities behind a context means
/// a new one (an IPC handle, config, a model picker) can be added here without
/// changing any command's signature.
pub struct CommandCtx<'a> {
    pub app: &'a mut App,
    pub registry: &'a CommandRegistry,
}

/// A slash command. Implementors are stateless unit structs registered once at
/// startup, so the registry can hold them as trait objects.
pub trait Command: Send + Sync {
    /// Invocation name without the leading slash (e.g. `"help"`).
    fn name(&self) -> &'static str;
    /// One-line summary shown in `/help` and the completion menu.
    fn description(&self) -> &'static str;
    /// Optional argument hint shown after the name, e.g. `"[mode]"`.
    fn arg_hint(&self) -> Option<&'static str> {
        None
    }
    /// Run the command. `args` is the trimmed remainder after the name.
    fn run(&self, args: &str, ctx: &mut CommandCtx) -> CommandOutcome;
}

/// Owns the built-in commands and answers lookups/completions. Constructed once
/// in `main` and borrowed by both the key handler and the renderer.
pub struct CommandRegistry {
    commands: Vec<Box<dyn Command>>,
}

impl CommandRegistry {
    /// The registry every session starts with. Register new built-ins here.
    pub fn with_builtins() -> Self {
        let mut registry = Self { commands: Vec::new() };
        registry.register(Box::new(help::Help));
        registry.register(Box::new(clear::Clear));
        registry.register(Box::new(model::ModelCommand));
        registry.register(Box::new(mode::ModeCommand));
        registry.register(Box::new(compact::CompactCommand));
        registry.register(Box::new(quit::Quit));
        registry
    }

    pub fn register(&mut self, command: Box<dyn Command>) {
        self.commands.push(command);
    }

    pub fn all(&self) -> impl Iterator<Item = &dyn Command> {
        self.commands.iter().map(AsRef::as_ref)
    }

    fn get(&self, name: &str) -> Option<&dyn Command> {
        self.all().find(|c| c.name() == name)
    }
}

/// Whether `input` should be dispatched as a command rather than sent as a
/// prompt: true for anything starting with `/`.
pub fn is_command(input: &str) -> bool {
    input.trim_start().starts_with('/')
}

/// Parse and run `input` (which must start with `/`). Unknown commands push a
/// system message pointing at `/help` rather than failing silently.
pub fn dispatch(registry: &CommandRegistry, input: &str, app: &mut App) -> CommandOutcome {
    let body = input.trim_start().trim_start_matches('/');
    let (name, args) = match body.split_once(char::is_whitespace) {
        Some((name, rest)) => (name, rest.trim()),
        None => (body, ""),
    };
    match registry.get(name) {
        Some(command) => {
            let mut ctx = CommandCtx { app, registry };
            command.run(args, &mut ctx)
        }
        None => {
            app.push_system(format!("Unknown command: /{name} — type /help for the list."));
            CommandOutcome::Done
        }
    }
}

/// Command completions for the current composer text. Non-empty only while the
/// user is typing the command *name* (a leading `/`, no space yet), so the menu
/// disappears once they start typing arguments.
pub fn completions<'a>(registry: &'a CommandRegistry, input: &str) -> Vec<&'a dyn Command> {
    let trimmed = input.trim_start();
    let Some(rest) = trimmed.strip_prefix('/') else {
        return Vec::new();
    };
    if rest.contains(char::is_whitespace) {
        return Vec::new();
    }
    registry.all().filter(|c| c.name().starts_with(rest)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_runs_known_and_reports_unknown() {
        let registry = CommandRegistry::with_builtins();
        let mut app = App::new();

        // Unknown command leaves a breadcrumb rather than failing silently.
        assert!(matches!(
            dispatch(&registry, "/nope", &mut app),
            CommandOutcome::Done
        ));
        assert!(app.messages.last().unwrap().content.contains("/help"));

        // A known command with an argument runs and mutates state.
        dispatch(&registry, "/mode build", &mut app);
        assert_eq!(app.mode, crate::app::Mode::Build);

        // `/exit` asks the loop to quit.
        assert!(matches!(dispatch(&registry, "/exit", &mut app), CommandOutcome::Quit));
    }

    #[test]
    fn completions_match_name_prefix_only() {
        let registry = CommandRegistry::with_builtins();
        assert!(completions(&registry, "hello").is_empty(), "not a command");
        assert!(completions(&registry, "/mode build").is_empty(), "past the name");

        let names: Vec<_> = completions(&registry, "/")
            .iter()
            .map(|c| c.name())
            .collect();
        assert!(names.contains(&"help") && names.contains(&"mode"));

        let c = completions(&registry, "/cl");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].name(), "clear");
    }
}
