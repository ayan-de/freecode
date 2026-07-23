use super::{Command, CommandCtx, CommandOutcome};

/// `/compact` — summarize older turns now so the next turn sends fewer tokens.
/// The actual IPC call (`session.compact`) runs in the main loop.
pub struct CompactCommand;

impl Command for CompactCommand {
    fn name(&self) -> &'static str {
        "compact"
    }

    fn description(&self) -> &'static str {
        "Summarize older turns to free up context"
    }

    fn run(&self, _args: &str, ctx: &mut CommandCtx) -> CommandOutcome {
        if ctx.app.session_id.is_none() {
            ctx.app.push_system("No active session to compact.".into());
            return CommandOutcome::Done;
        }
        CommandOutcome::CompactSession
    }
}
