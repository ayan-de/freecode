use super::{Command, CommandCtx, CommandOutcome};

/// `/session` — open the resume modal. The session list is fetched over IPC by
/// the main loop (`OpenSessionPicker`), which then shows a two-pane modal:
/// session list on the left, a markdown transcript preview on the right.
pub struct SessionCommand;

impl Command for SessionCommand {
    fn name(&self) -> &'static str {
        "session"
    }

    fn description(&self) -> &'static str {
        "Resume a previous session"
    }

    fn run(&self, _args: &str, _ctx: &mut CommandCtx) -> CommandOutcome {
        CommandOutcome::OpenSessionPicker
    }
}
