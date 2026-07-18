import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bus, askPermission, answerPermission, rejectPermission } from "../bus/index.js";
import { promptForPermission } from "./prompt.js";
import { PermissionSettingsManager } from "./settings.js";

function makeTempProject(): { projectRoot: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-prompt-"));
  const projectRoot = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  return {
    projectRoot,
    cleanup: () => {
      process.env.HOME = prevHome;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Auto-answer the next permission.asked event */
function autoAnswer(
  decision: "allow-once" | "allow-session" | "allow-project" | "allow-always" | "deny",
  editedRule?: string,
): () => void {
  return bus.subscribe("permission.asked", (event) => {
    answerPermission(event.requestId, { decision, editedRule });
  });
}

test("askPermission rejects immediately when no frontend is subscribed", async () => {
  await assert.rejects(
    askPermission("req-headless", {
      toolName: "bash",
      args: { command: "ls" },
      description: "ls",
    }),
    /No frontend connected/,
  );
});

test("askPermission round-trips an answer through the bus", async () => {
  const unsub = autoAnswer("allow-once");
  try {
    const answer = await askPermission("req-rt", {
      toolName: "bash",
      args: { command: "ls" },
      description: "ls",
    });
    assert.equal(answer.decision, "allow-once");
  } finally {
    unsub();
  }
});

test("askPermission rejects when the user dismisses", async () => {
  const unsub = bus.subscribe("permission.asked", (event) => {
    rejectPermission(event.requestId);
  });
  try {
    await assert.rejects(
      askPermission("req-dismiss", { toolName: "write", args: {}, description: "x" }),
      /rejected by user/,
    );
  } finally {
    unsub();
  }
});

test("askPermission times out to rejection (deny), never allow", async () => {
  const unsub = bus.subscribe("permission.asked", () => {
    /* subscribed but never answers */
  });
  // The ask timeout is unref'd; hold the event loop open so it can fire
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(
      askPermission("req-timeout", { toolName: "write", args: {}, description: "x" }, 30),
      /timed out/,
    );
  } finally {
    clearTimeout(keepAlive);
    unsub();
  }
});

test("promptForPermission: deny answer blocks with continue-without hint", async () => {
  const { projectRoot, cleanup } = makeTempProject();
  const unsub = autoAnswer("deny");
  try {
    const settings = new PermissionSettingsManager(projectRoot);
    const outcome = await promptForPermission({
      toolName: "bash",
      args: { command: "git push origin main" },
      projectRoot,
      settings,
    });
    assert.equal(outcome.allowed, false);
    assert.match(outcome.reason ?? "", /continue without/);
  } finally {
    unsub();
    cleanup();
  }
});

test("promptForPermission: allow-session installs a session grant", async () => {
  const { projectRoot, cleanup } = makeTempProject();
  const unsub = autoAnswer("allow-session");
  try {
    const settings = new PermissionSettingsManager(projectRoot);
    const outcome = await promptForPermission({
      toolName: "bash",
      args: { command: "npm run test -- --watch" },
      projectRoot,
      settings,
    });
    assert.equal(outcome.allowed, true);
    assert.deepEqual(
      settings.getSessionGrants().map((r) => r.raw),
      ["Bash(npm run:*)"],
    );
    // Nothing persisted to disk
    assert.ok(!fs.existsSync(path.join(projectRoot, ".freecode", "settings.json")));
  } finally {
    unsub();
    cleanup();
  }
});

test("promptForPermission: allow-project persists the (possibly edited) rule", async () => {
  const { projectRoot, cleanup } = makeTempProject();
  const unsub = autoAnswer("allow-project", "Bash(npm run test:*)");
  try {
    const settings = new PermissionSettingsManager(projectRoot);
    const outcome = await promptForPermission({
      toolName: "bash",
      args: { command: "npm run test" },
      projectRoot,
      settings,
    });
    assert.equal(outcome.allowed, true);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".freecode", "settings.json"), "utf-8"),
    );
    assert.deepEqual(onDisk.permissions.allow, ["Bash(npm run test:*)"]);
  } finally {
    unsub();
    cleanup();
  }
});
