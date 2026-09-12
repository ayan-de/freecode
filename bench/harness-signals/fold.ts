// =============================================================================
// Harness-signals fold: rollout events → what the model said about its own
// work, and what the loop did about it. Pure; `run.ts` feeds it files.
//
// Three questions, each answered from events the loop already writes:
//
//   Confidence stepping  per todo item: the confidence at assignment (first
//                        time the item carried a number) and at completion
//                        (the number on the call that marked it completed).
//                        `todo.signal(confidence_spike)` says which of those
//                        the loop flagged, and whether the gate nudged.
//
//   Hill-climbable goals every `hillClimbability` rating submitted, counted
//                        per submission like jcode's aggregate (a re-rating
//                        of the same goal is a new data point).
//
//   Auto-poke            how often a run stopped with todos open, how often
//                        the loop poked, and whether a poke led anywhere: a
//                        tool call after it, and items completed after it.
//                        `sessionsEndedOpen` comes from the LAST todowrite in
//                        a session, so it is measurable on logs written before
//                        the gate existed — that is the baseline the gate is
//                        judged against.
//
// No item text, no session ids leave this fold. Numbers only.
// =============================================================================

export interface RawEvent {
  type: string;
  timestamp: number;
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
  kind?: string;
  itemId?: string;
  from?: number;
  to?: number;
  gated?: boolean;
  remaining?: number;
  pokeIndex?: number;
}

interface TodoArg {
  id?: string;
  status?: string;
  confidence?: unknown;
  hillClimbability?: unknown;
}

export interface ItemTrajectory {
  assigned: number;
  completed: number;
  /** Whether the loop flagged this completion as a spike, and nudged. */
  spike: boolean;
  gated: boolean;
}

export interface SessionSignals {
  todoCalls: number;
  itemsSeen: number;
  itemsCompleted: number;
  /** Items that ever carried a confidence number. */
  itemsRated: number;
  /** Final list state, from the last todowrite call. */
  finalOpen: number;
  finalTotal: number;
  trajectories: ItemTrajectory[];
  hillClimb: number[];
  hillClimbLow: { n: number; gated: number };
  spikes: { n: number; gated: number };
  pokes: {
    triggered: number;
    skipped: Record<string, number>;
    /** Pokes followed by at least one tool call before the run ended. */
    productive: number;
    /** Items that flipped to completed on a todowrite after a poke. */
    itemsCompletedAfterPoke: number;
  };
  firstAt: number;
  lastAt: number;
}

const score = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
};

export function foldSession(events: RawEvent[]): SessionSignals | undefined {
  const s: SessionSignals = {
    todoCalls: 0,
    itemsSeen: 0,
    itemsCompleted: 0,
    itemsRated: 0,
    finalOpen: 0,
    finalTotal: 0,
    trajectories: [],
    hillClimb: [],
    hillClimbLow: { n: 0, gated: 0 },
    spikes: { n: 0, gated: 0 },
    pokes: { triggered: 0, skipped: {}, productive: 0, itemsCompletedAfterPoke: 0 },
    firstAt: events[0]?.timestamp ?? 0,
    lastAt: events[events.length - 1]?.timestamp ?? 0,
  };
  // Per item: first confidence seen, and whether it has been completed.
  const assigned = new Map<string, number>();
  const done = new Set<string>();
  const flagged = new Map<string, { gated: boolean }>();
  let pokeOpen = false; // a poke fired and no tool call has followed yet
  let pokedEver = false;

  for (const e of events) {
    if (e.type === "todo.signal") {
      if (e.kind === "confidence_spike") {
        s.spikes.n++;
        if (e.gated) s.spikes.gated++;
        if (e.itemId) flagged.set(e.itemId, { gated: !!e.gated });
      } else if (e.kind === "hill_climb_low") {
        s.hillClimbLow.n++;
        if (e.gated) s.hillClimbLow.gated++;
      }
      continue;
    }
    if (e.type === "poke.triggered") {
      s.pokes.triggered++;
      pokeOpen = true;
      pokedEver = true;
      continue;
    }
    if (e.type === "poke.skipped") {
      const r = e.reason ?? "unknown";
      s.pokes.skipped[r] = (s.pokes.skipped[r] ?? 0) + 1;
      continue;
    }
    if (e.type !== "function.call") continue;
    if (pokeOpen) {
      s.pokes.productive++;
      pokeOpen = false;
    }
    if (e.tool !== "todowrite") continue;
    const raw = e.args?.todos;
    const list = (typeof raw === "string" ? safeParse(raw) : raw) as TodoArg[] | undefined;
    if (!Array.isArray(list)) continue;
    s.todoCalls++;
    let open = 0;
    list.forEach((t, i) => {
      const id = typeof t.id === "string" && t.id ? t.id : String(i + 1);
      const conf = score(t.confidence);
      const hc = score(t.hillClimbability);
      if (hc !== undefined) s.hillClimb.push(hc);
      // The assignment number is the one from an EARLIER call: an item first
      // rated on the call that completes it was never assessed before the
      // work, and a (100 → 100) line would say stepping happened when it
      // could not have.
      const a = assigned.get(id);
      if (t.status !== "completed") open++;
      if (t.status === "completed" && !done.has(id)) {
        done.add(id);
        if (pokedEver) s.pokes.itemsCompletedAfterPoke++;
        if (a !== undefined && conf !== undefined) {
          const f = flagged.get(id);
          s.trajectories.push({ assigned: a, completed: conf, spike: !!f, gated: f?.gated ?? false });
        }
      }
      if (a === undefined && conf !== undefined) assigned.set(id, conf);
    });
    s.finalOpen = open;
    s.finalTotal = list.length;
  }
  s.itemsSeen = new Set([...assigned.keys(), ...done]).size;
  s.itemsCompleted = done.size;
  s.itemsRated = assigned.size;
  return s.todoCalls > 0 || s.pokes.triggered > 0 ? s : undefined;
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export interface SignalsReport {
  generatedAt: string;
  /** Sessions in the log directory, and how many carried a todo list. */
  sessionsScanned: number;
  sessionsWithTodos: number;
  window: { from: string | null; to: string | null };
  confidence: {
    n: number;
    /** Newest last; capped so the page stays small. */
    trajectories: ItemTrajectory[];
    assignedMean: number | null;
    completedMean: number | null;
    /** Trajectories that rose by 40+ points in one step (the spike rule). */
    spikes: { n: number; gated: number };
    /** Items assigned with a confidence number, whether or not completed. */
    rated: number;
  };
  hillClimb: {
    n: number;
    sessions: number;
    /** score → count, only scores that received a submission. */
    histogram: Record<string, number>;
    mean: number | null;
    median: number | null;
    belowGate: number;
    belowGateRate: number | null;
    range: [number, number] | null;
    threshold: number;
    /** Low ratings the loop flagged, and how many were nudged. */
    flagged: { n: number; gated: number };
  };
  autoPoke: {
    sessionsWithTodos: number;
    /** Sessions whose last todowrite still had open items. */
    sessionsEndedOpen: number;
    endedOpenRate: number | null;
    /** Stops the loop looked at with a list present (any poke.* event). */
    stopsConsidered: number;
    pokes: number;
    productive: number;
    productiveRate: number | null;
    itemsCompletedAfterPoke: number;
    skipped: Record<string, number>;
    /** Sessions where the gate was on (a poke fired, or a skip reason other than disabled). */
    gatedSessions: number;
    /** Ended-open rate split by whether the gate was on — the before/after. */
    endedOpenByGate: { on: { n: number; open: number }; off: { n: number; open: number } };
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const HILL_CLIMB_THRESHOLD = 90;
export const CONFIDENCE_SPIKE = 40;
const MAX_TRAJECTORIES = 600;

export function aggregate(
  sessions: SessionSignals[],
  scanned: number,
  now = new Date(),
): SignalsReport {
  const trajectories = sessions.flatMap((s) => s.trajectories);
  const hill = sessions.flatMap((s) => s.hillClimb);
  const histogram: Record<string, number> = {};
  for (const h of hill) histogram[String(h)] = (histogram[String(h)] ?? 0) + 1;
  const below = hill.filter((h) => h < HILL_CLIMB_THRESHOLD).length;

  const withTodos = sessions.filter((s) => s.todoCalls > 0);
  const gated = (s: SessionSignals) =>
    s.pokes.triggered > 0 || Object.keys(s.pokes.skipped).some((r) => r !== "disabled");
  const on = withTodos.filter(gated);
  const off = withTodos.filter((s) => !gated(s));
  const pokes = sessions.reduce((n, s) => n + s.pokes.triggered, 0);
  const productive = sessions.reduce((n, s) => n + s.pokes.productive, 0);
  const skipped: Record<string, number> = {};
  for (const s of sessions) {
    for (const [r, n] of Object.entries(s.pokes.skipped)) skipped[r] = (skipped[r] ?? 0) + n;
  }
  const stamps = sessions.map((s) => s.firstAt).filter((t) => t > 0);

  return {
    generatedAt: now.toISOString(),
    sessionsScanned: scanned,
    sessionsWithTodos: withTodos.length,
    window: {
      from: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
      to: stamps.length ? new Date(Math.max(...sessions.map((s) => s.lastAt))).toISOString() : null,
    },
    confidence: {
      n: trajectories.length,
      trajectories: trajectories.slice(-MAX_TRAJECTORIES),
      assignedMean: mean(trajectories.map((t) => t.assigned)),
      completedMean: mean(trajectories.map((t) => t.completed)),
      spikes: {
        n: trajectories.filter((t) => t.completed - t.assigned >= CONFIDENCE_SPIKE).length,
        gated: trajectories.filter((t) => t.gated).length,
      },
      rated: sessions.reduce((n, s) => n + s.itemsRated, 0),
    },
    hillClimb: {
      n: hill.length,
      sessions: sessions.filter((s) => s.hillClimb.length > 0).length,
      histogram,
      mean: mean(hill),
      median: median(hill),
      belowGate: below,
      belowGateRate: hill.length ? below / hill.length : null,
      range: hill.length ? [Math.min(...hill), Math.max(...hill)] : null,
      threshold: HILL_CLIMB_THRESHOLD,
      flagged: {
        n: sessions.reduce((n, s) => n + s.hillClimbLow.n, 0),
        gated: sessions.reduce((n, s) => n + s.hillClimbLow.gated, 0),
      },
    },
    autoPoke: {
      sessionsWithTodos: withTodos.length,
      sessionsEndedOpen: withTodos.filter((s) => s.finalOpen > 0).length,
      endedOpenRate: withTodos.length
        ? withTodos.filter((s) => s.finalOpen > 0).length / withTodos.length
        : null,
      stopsConsidered:
        pokes + Object.values(skipped).reduce((a, b) => a + b, 0),
      pokes,
      productive,
      productiveRate: pokes ? productive / pokes : null,
      itemsCompletedAfterPoke: sessions.reduce((n, s) => n + s.pokes.itemsCompletedAfterPoke, 0),
      skipped,
      gatedSessions: on.length,
      endedOpenByGate: {
        on: { n: on.length, open: on.filter((s) => s.finalOpen > 0).length },
        off: { n: off.length, open: off.filter((s) => s.finalOpen > 0).length },
      },
    },
  };
}
