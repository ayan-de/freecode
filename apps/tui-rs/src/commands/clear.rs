use super::{Command, CommandCtx, CommandOutcome};

/// `/clear` — drop the transcript and start fresh. Local only: the core session
/// keeps its history, so the next prompt still has full context.
pub struct Clear;

impl Command for Clear {
    fn name(&self) -> &'static str {
        "clear"
    }

    fn description(&self) -> &'static str {
        "Clear the transcript"
    }

    fn run(&self, _args: &str, ctx: &mut CommandCtx) -> CommandOutcome {
        ctx.app.clear_messages();
        CommandOutcome::Done
    }
}
