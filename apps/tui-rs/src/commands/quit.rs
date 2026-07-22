use super::{Command, CommandCtx, CommandOutcome};

/// `/exit` — leave FreeCode. The main loop restores the terminal on `Quit`.
pub struct Quit;

impl Command for Quit {
    fn name(&self) -> &'static str {
        "exit"
    }

    fn description(&self) -> &'static str {
        "Exit FreeCode"
    }

    fn run(&self, _args: &str, _ctx: &mut CommandCtx) -> CommandOutcome {
        CommandOutcome::Quit
    }
}
