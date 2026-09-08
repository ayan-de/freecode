import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, MAX_AGENTS_PER_ROOT } from "./registry.js";
import { BusEvents } from "../../bus/index.js";

function spawn(reg: AgentRegistry, id: string, parentId: string) {
  return reg.register({ id, parentId, task: `task ${id}`, agentType: "agent" });
}

test("an agent spawned by a root session sits at depth 1 under that root", () => {
  const reg = new AgentRegistry();
  const summary = spawn(reg, "a1", "root");
  assert.equal(summary.depth, 1);
  assert.equal(summary.rootId, "root");
  assert.equal(reg.rootOf("a1"), "root");
  // A session that is not an agent is its own root, which is what lets
  // agents.list take the root session id and resolve the whole tree.
  assert.equal(reg.rootOf("root"), "root");
  assert.equal(reg.depthOf("root"), 0);
  reg.disposeAll();
});

test("a subagent may not spawn a subagent", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");
  assert.throws(
    () => spawn(reg, "a2", "a1"),
    /may not spawn subagents/,
    "depth 2 must be refused — nothing else bounds the spawn tree",
  );
  reg.disposeAll();
});

test("concurrent subagents under one root are capped", () => {
  const reg = new AgentRegistry();
  for (let i = 0; i < MAX_AGENTS_PER_ROOT; i++) spawn(reg, `a${i}`, "root");
  assert.throws(() => spawn(reg, "overflow", "root"), /Too many subagents/);

  // A settled one frees its slot: the cap is on RUNNING agents, so a session
  // that delegates twenty short tasks in sequence is not blocked at eight.
  reg.settle("a0", "completed");
  assert.doesNotThrow(() => spawn(reg, "after", "root"));
  reg.disposeAll();
});

test("the cap is per root, so two sessions do not starve each other", () => {
  const reg = new AgentRegistry();
  for (let i = 0; i < MAX_AGENTS_PER_ROOT; i++) spawn(reg, `a${i}`, "root-a");
  assert.doesNotThrow(() => spawn(reg, "b0", "root-b"));
  assert.equal(reg.listForRoot("root-b").length, 1);
  reg.disposeAll();
});

test("stream events for a registered agent are folded into its activity log", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");

  BusEvents.stream("a1", {
    type: "tool_start",
    toolCallId: "t1",
    toolName: "grep",
    args: { pattern: "createToolOrchestrator" },
  });
  BusEvents.stream("a1", { type: "text_delta", delta: "found it" });
  // Another session's events must not bleed into this agent's log.
  BusEvents.stream("root", { type: "text_delta", delta: "MAIN" });

  const read = reg.readFrom("a1", 0);
  assert.equal(read.found, true);
  assert.match(read.text, /grep\(createToolOrchestrator\)/);
  assert.match(read.text, /found it/);
  assert.ok(!read.text.includes("MAIN"));
  reg.disposeAll();
});

test("readFrom is positional: a second read returns only what is new", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");
  BusEvents.stream("a1", { type: "text_delta", delta: "one" });

  const first = reg.readFrom("a1", 0);
  BusEvents.stream("a1", { type: "text_delta", delta: "two" });
  const second = reg.readFrom("a1", first.nextCursor);

  assert.equal(second.text, "two");
  reg.disposeAll();
});

test("a settled agent stops recording activity", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");
  reg.settle("a1", "completed");
  BusEvents.stream("a1", { type: "text_delta", delta: "late" });
  assert.equal(reg.readFrom("a1", 0).text, "");
  reg.disposeAll();
});

test("stop interrupts the loop and settles the row without waiting for it", () => {
  const reg = new AgentRegistry();
  let interrupted = false;
  const exits: string[] = [];
  reg.register({
    id: "a1",
    parentId: "root",
    task: "t",
    agentType: "agent",
    interrupt: () => {
      interrupted = true;
    },
    onExit: (_id, status) => exits.push(status),
  });

  assert.equal(reg.stop("a1"), true);
  assert.equal(interrupted, true);
  assert.equal(reg.get("a1")?.status, "killed");
  assert.deepEqual(exits, ["killed"]);

  // The loop unwinding later must not fire a second exit notification, or the
  // frontend's running counter goes stale.
  reg.settle("a1", "failed");
  assert.deepEqual(exits, ["killed"]);
  assert.equal(reg.stop("a1"), false);
  reg.disposeAll();
});

test("remove refuses a running agent and accepts a settled one", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");
  assert.equal(
    reg.remove("a1"),
    false,
    "dropping the record would strand the loop",
  );
  reg.settle("a1", "completed");
  assert.equal(reg.remove("a1"), true);
  assert.equal(reg.listForRoot("root").length, 0);
  reg.disposeAll();
});

test("disposeRoot stops and forgets only that root's tree", () => {
  const reg = new AgentRegistry();
  let stopped = 0;
  reg.register({
    id: "a1",
    parentId: "root-a",
    task: "t",
    agentType: "agent",
    interrupt: () => {
      stopped++;
    },
  });
  spawn(reg, "b1", "root-b");

  reg.disposeRoot("root-a");
  assert.equal(stopped, 1);
  assert.equal(reg.listForRoot("root-a").length, 0);
  assert.equal(reg.listForRoot("root-b").length, 1);
  reg.disposeAll();
});

test("the bus subscription is released once the registry empties", () => {
  const reg = new AgentRegistry();
  spawn(reg, "a1", "root");
  reg.disposeAll();
  // Nothing is registered, so a stray event must be a no-op rather than
  // resurrecting a record — and the handler itself should be gone.
  BusEvents.stream("a1", { type: "text_delta", delta: "late" });
  assert.equal(reg.readFrom("a1", 0).found, false);
});
