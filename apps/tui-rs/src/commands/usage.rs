use super::{Command, CommandCtx, CommandOutcome};

/// `/usage` — the token-usage dashboard. The IPC call (`usage.get`) runs in the
/// main loop, which then opens the modal; rendering lives in `ui::usage`.
pub struct UsageCommand;

impl Command for UsageCommand {
    fn name(&self) -> &'static str {
        "usage"
    }

    fn description(&self) -> &'static str {
        "Show daily token usage"
    }

    fn run(&self, _args: &str, _ctx: &mut CommandCtx) -> CommandOutcome {
        CommandOutcome::ShowUsage
    }
}
