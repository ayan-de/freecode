import test from "node:test";
import assert from "node:assert/strict";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryStore } from "../memory/mem-store.js";
import { MemoryGraphService } from "../memory/graph/index.js";
import {
  addonDir,
  addonInstalled,
  startGraphExplorer,
  stopGraphExplorer,
  currentBinding,
} from "./server.js";

function mkService(): { service: MemoryGraphService; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gex-srv-"));
  const service = new MemoryGraphService(new MemoryStore(dir));
  return {
    service,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// `addonInstalled` is the only check the server runs before binding — the
// whole /graph flow turns on it, so test it as a black box.
test("addonInstalled returns false when the addon directory is missing", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "homeless-"));
  try {
    assert.equal(addonInstalled(fakeHome), false);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("addonInstalled returns true when index.html is present", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "homeyes-"));
  try {
    const dir = addonDir(fakeHome);
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html></html>");
    assert.equal(addonInstalled(fakeHome), true);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("addonDir returns a path under ~/.freecode/addons/graph-ui", () => {
  const fakeHome = "/tmp/some-fake-home";
  const dir = addonDir(fakeHome);
  assert.equal(dir, path.join(fakeHome, ".freecode", "addons", "graph-ui"));
});

test("startGraphExplorer returns not-installed when the addon is missing", async () => {
  const { service, cleanup } = mkService();
  const fakeHome = mkdtempSync(join(tmpdir(), "homeempty-"));
  try {
    const res = await startGraphExplorer(service, {
      homeDir: fakeHome,
      host: "127.0.0.1",
      port: 5097,
      openBrowser: () => {},
    });
    assert.deepEqual(res, { error: "not-installed" });
    assert.equal(currentBinding(), null, "no listener was bound");
  } finally {
    cleanup();
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("startGraphExplorer binds to the requested port when the addon is present", async () => {
  const { service, cleanup } = mkService();
  const fakeHome = mkdtempSync(join(tmpdir(), "homeyes-"));
  try {
    const dir = addonDir(fakeHome);
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html></html>");

    let opened = "";
    const res = await startGraphExplorer(service, {
      homeDir: fakeHome,
      host: "127.0.0.1",
      port: 5098,
      openBrowser: (url) => {
        opened = url;
      },
    });
    assert.ok(res && "url" in res, "returns { url }");
    const url = (res as { url: string }).url;
    assert.equal(url, "http://127.0.0.1:5098/");
    assert.equal(opened, url, "openBrowser was called with the url");
    assert.deepEqual(currentBinding(), { host: "127.0.0.1", port: 5098 });

    // The /api/graph endpoint should be reachable on the bound port.
    const body = await (await fetch(`${url}api/graph`)).json();
    assert.ok(body && Array.isArray(body.nodes), "GET /api/graph responds");
    assert.ok("embedderAvailable" in body, "embedderAvailable flag present");

    await stopGraphExplorer();
  } finally {
    cleanup();
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("startGraphExplorer reuses the listener on a second call (singleton)", async () => {
  const { service, cleanup } = mkService();
  const fakeHome = mkdtempSync(join(tmpdir(), "homesingleton-"));
  try {
    const dir = addonDir(fakeHome);
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html></html>");

    const calls: string[] = [];
    const first = await startGraphExplorer(service, {
      homeDir: fakeHome,
      host: "127.0.0.1",
      port: 5099,
      openBrowser: (url) => calls.push(url),
    });
    assert.ok(first && "url" in first);

    const second = await startGraphExplorer(service, {
      homeDir: fakeHome,
      host: "127.0.0.1",
      port: 5099,
      openBrowser: (url) => calls.push(url),
    });
    assert.ok(second && "url" in second);
    assert.equal(
      (first as { url: string }).url,
      (second as { url: string }).url,
      "second call returns the same URL → singleton reused",
    );
    assert.equal(calls.length, 2, "openBrowser called twice (both invocations)");
    await stopGraphExplorer();
  } finally {
    cleanup();
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("startGraphExplorer falls back to the next port when the requested one is busy", async () => {
  const { service: serviceA, cleanup: cleanupA } = mkService();
  const { service: serviceB, cleanup: cleanupB } = mkService();
  const fakeHome = mkdtempSync(join(tmpdir(), "homefallback-"));
  try {
    const dir = addonDir(fakeHome);
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html></html>");

    // Park a busy listener on the requested port. We don't even need this
    // listener to do anything — we just need it to hold the port.
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(5100, "127.0.0.1", resolve));

    try {
      const res = await startGraphExplorer(serviceA, {
        homeDir: fakeHome,
        host: "127.0.0.1",
        port: 5100,
        openBrowser: () => {},
      });
      assert.ok(res && "url" in res, "still resolves to { url }");
      const url = (res as { url: string }).url;
      assert.notEqual(url, "http://127.0.0.1:5100/", "first port was busy");
      assert.equal(url, "http://127.0.0.1:5101/", "fell back to the next port");
      await stopGraphExplorer();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  } finally {
    cleanupA();
    cleanupB();
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
