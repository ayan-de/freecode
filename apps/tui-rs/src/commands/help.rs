use super::{Command, CommandCtx, CommandOutcome};

/// `/help` — lists every registered command, derived from the registry so it
/// never drifts out of sync with what's actually available.
pub struct Help;

impl Command for Help {
    fn name(&self) -> &'static str {
        "help"
    }

    fn description(&self) -> &'static str {
        "List available commands"
    }

    fn run(&self, _args: &str, ctx: &mut CommandCtx) -> CommandOutcome {
        // System messages render as plain dim text (no markdown), so lay the
        // list out with padding rather than bullets/bold.
        let name_w = ctx
            .registry
            .all()
            .map(|c| c.name().len() + c.arg_hint().map(|h| h.len() + 1).unwrap_or(0))
            .max()
            .unwrap_or(0);

        let mut body = String::from("Available commands:\n");
        for command in ctx.registry.all() {
            let invocation = match command.arg_hint() {
                Some(hint) => format!("{} {hint}", command.name()),
                None => command.name().to_string(),
            };
            body.push_str(&format!(
                "\n  /{invocation:name_w$}  {}",
                command.description(),
                name_w = name_w,
            ));
        }
        ctx.app.push_system(body);
        CommandOutcome::Done
    }
}
