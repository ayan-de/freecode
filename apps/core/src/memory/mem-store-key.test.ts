import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// mem-store resolves ~/.freecode from os.homedir() per call, but point HOME at
// a scratch dir before importing anyway, matching the sibling tests.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-memkey-"));
process.env.HOME = home;

const { MemoryStore } = await import("./mem-store.js");

const projectsDir = () => path.join(os.homedir(), ".freecode", "projects");

function seedLegacy(basename: string, memName: string): string {
  const dir = path.join(projectsDir(), basename, "memory", "user");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${memName}.md`);
  fs.writeFileSync(
    file,
    `---\nname: ${memName}\ndescription: d\nmetadata:\n  type: user\n---\n\nbody\n`,
  );
  return path.join(projectsDir(), basename, "memory");
}

describe("memory store project key", () => {
  test("two projects sharing a basename get distinct stores", () => {
    const a = new MemoryStore("/work/api");
    const b = new MemoryStore("/side/api");
    assert.notEqual(a.getMemoryDir(), b.getMemoryDir());
    a.save({
      name: "only-in-a",
      description: "d",
      type: "user",
      content: "c",
    });
    assert.ok(a.load("only-in-a", "user"));
    assert.equal(b.load("only-in-a", "user"), undefined);
  });

  test("a legacy basename-keyed store is renamed to the full-path key", () => {
    const legacyDir = seedLegacy("webapp", "old-fact");
    const store = new MemoryStore("/home/dev/webapp");
    assert.equal(store.load("old-fact", "user")?.name, "old-fact");
    assert.equal(fs.existsSync(legacyDir), false);
    // The empty legacy shell is cleaned up too.
    assert.equal(fs.existsSync(path.join(projectsDir(), "webapp")), false);
  });

  test("an existing new-key store is never clobbered by a leftover legacy dir", () => {
    const store = new MemoryStore("/home/dev/tool");
    store.save({ name: "fresh", description: "d", type: "user", content: "c" });
    const legacyDir = seedLegacy("tool", "stale");
    // A second store for the same project must keep the new-key contents.
    const again = new MemoryStore("/home/dev/tool");
    assert.ok(again.load("fresh", "user"));
    assert.equal(again.load("stale", "user"), undefined);
    assert.equal(fs.existsSync(legacyDir), true);
  });
});
