use super::{Command, CommandCtx, CommandOutcome};

/// `/model` — open the model picker. The actual list is fetched over IPC by the
/// main loop (`OpenModelPicker`), which then shows a modal like the question
/// prompt; selecting a model persists it via `config.setCurrentModel`.
pub struct ModelCommand;

impl Command for ModelCommand {
    fn name(&self) -> &'static str {
        "model"
    }

    fn description(&self) -> &'static str {
        "Switch the active model"
    }

    fn run(&self, _args: &str, _ctx: &mut CommandCtx) -> CommandOutcome {
        CommandOutcome::OpenModelPicker
    }
}
