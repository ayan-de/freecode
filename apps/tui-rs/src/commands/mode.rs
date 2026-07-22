use super::{Command, CommandCtx, CommandOutcome};
use crate::app::Mode;

/// `/mode` — set the agent mode shown in the status badge. With no argument it
/// reports the current mode and the valid values.
pub struct ModeCommand;

impl Command for ModeCommand {
    fn name(&self) -> &'static str {
        "mode"
    }

    fn description(&self) -> &'static str {
        "Switch agent mode"
    }

    fn arg_hint(&self) -> Option<&'static str> {
        Some("[plan|build|review|explore|danger]")
    }

    fn run(&self, args: &str, ctx: &mut CommandCtx) -> CommandOutcome {
        let arg = args.trim().to_ascii_lowercase();
        if arg.is_empty() {
            ctx.app.push_system(format!(
                "Current mode: {}. Usage: /mode <plan|build|review|explore|danger>",
                ctx.app.mode.label(),
            ));
            return CommandOutcome::Done;
        }
        match Mode::from_keyword(&arg) {
            Some(mode) => {
                ctx.app.mode = mode;
                ctx.app.push_system(format!("Mode set to {}", mode.label()));
            }
            None => ctx.app.push_system(format!(
                "Unknown mode '{arg}'. Try: plan, build, review, explore, danger."
            )),
        }
        CommandOutcome::Done
    }
}
