export {
  loadSignalSettings,
  resolveSignalSettings,
  envFlag,
  DEFAULT_SIGNAL_SETTINGS,
  type SignalSettings,
} from "./settings.js";
export {
  diffTodoSignals,
  confidenceSpikeReminder,
  hillClimbReminder,
  type TodoSignal,
} from "./todo-signals.js";
export {
  decidePoke,
  notePoke,
  initialPokeState,
  pokeReminder,
  todoFingerprint,
  type PokeState,
  type PokeDecision,
} from "./auto-poke.js";
