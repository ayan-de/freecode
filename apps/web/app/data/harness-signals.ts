// Written by `pnpm bench:signals` (bench/harness-signals/run.ts) into
// app/data/harness/signals.json — a fold of every recorded session's rollout
// log. Numbers only: no item text, no session ids. The shape mirrors
// bench/harness-signals/fold.ts `SignalsReport`; keep the two in step.

export interface ItemTrajectory {
  assigned: number;
  completed: number;
  spike: boolean;
  gated: boolean;
}

export interface SignalsReport {
  generatedAt: string;
  sessionsScanned: number;
  sessionsWithTodos: number;
  window: { from: string | null; to: string | null };
  confidence: {
    n: number;
    trajectories: ItemTrajectory[];
    assignedMean: number | null;
    completedMean: number | null;
    spikes: { n: number; gated: number };
    rated: number;
  };
  hillClimb: {
    n: number;
    sessions: number;
    histogram: Record<string, number>;
    mean: number | null;
    median: number | null;
    belowGate: number;
    belowGateRate: number | null;
    range: [number, number] | null;
    threshold: number;
    flagged: { n: number; gated: number };
  };
  autoPoke: {
    sessionsWithTodos: number;
    sessionsEndedOpen: number;
    endedOpenRate: number | null;
    stopsConsidered: number;
    pokes: number;
    productive: number;
    productiveRate: number | null;
    itemsCompletedAfterPoke: number;
    skipped: Record<string, number>;
    gatedSessions: number;
    endedOpenByGate: { on: { n: number; open: number }; off: { n: number; open: number } };
  };
}

export const EMPTY_SIGNALS: SignalsReport = {
  generatedAt: "",
  sessionsScanned: 0,
  sessionsWithTodos: 0,
  window: { from: null, to: null },
  confidence: {
    n: 0,
    trajectories: [],
    assignedMean: null,
    completedMean: null,
    spikes: { n: 0, gated: 0 },
    rated: 0,
  },
  hillClimb: {
    n: 0,
    sessions: 0,
    histogram: {},
    mean: null,
    median: null,
    belowGate: 0,
    belowGateRate: null,
    range: null,
    threshold: 90,
    flagged: { n: 0, gated: 0 },
  },
  autoPoke: {
    sessionsWithTodos: 0,
    sessionsEndedOpen: 0,
    endedOpenRate: null,
    stopsConsidered: 0,
    pokes: 0,
    productive: 0,
    productiveRate: null,
    itemsCompletedAfterPoke: 0,
    skipped: {},
    gatedSessions: 0,
    endedOpenByGate: { on: { n: 0, open: 0 }, off: { n: 0, open: 0 } },
  },
};
