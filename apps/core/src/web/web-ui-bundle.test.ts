// =============================================================================
// Regression guard: the server must actually serve the SPA.
//
// v0.19.0 shipped a binary whose `/` returned 404. `bun build --compile`
// bundles JS but not static assets, and nothing copied apps/web-app/dist
// beside the executable, so the web UI simply wasn't in the release.
//
// It was invisible from the desktop — the TUI never loads the SPA and /api
// answered normally, so pairing a phone even reported success — and fatal on
// mobile, whose client has no UI of its own and renders this bundle in a
// WebView. The symptom was a blank screen with no error on either side.
//
// These tests assert the two halves that failed: the resolver finds a bundle
// wherever the layout puts it, and a running server returns HTML for `/`.
// =============================================================================

import { strict as assert } from "assert";
import { describe, it, before, after } from "node:test";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { startWebServer } from "../web-server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoWebUi = path.resolve(here, "..", "..", "..", "web-app", "dist");

function get(port: number, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body }),
        );
      })
      .on("error", reject);
  });
}

describe("web UI bundle", () => {
  // The bundle is a build artifact, so skip rather than fail when the repo
  // hasn't been built — CI builds web-app before packaging (release.yml).
  const built = fs.existsSync(path.join(repoWebUi, "index.html"));

  let server: http.Server | undefined;
  let port = 0;

  before(async () => {
    if (!built) return;
    server = startWebServer(0, "127.0.0.1", { _token: "t", quiet: true });
    await new Promise<void>((r) => server!.once("listening", () => r()));
    port = (server!.address() as { port: number }).port;
  });

  after(() => {
    server?.close();
  });

  it("ships an index.html in the repo layout", () => {
    if (!built) return;
    assert.ok(
      fs.existsSync(path.join(repoWebUi, "index.html")),
      "apps/web-app/dist/index.html missing — run `pnpm --filter web-app build`",
    );
  });

  it("serves HTML at / rather than 404", async () => {
    if (!built) return;
    const res = await get(port, "/");
    assert.equal(res.status, 200, `GET / returned ${res.status}, not 200`);
    assert.match(res.body, /<div id="root">/, "response is not the SPA shell");
  });

  it("serves the hashed JS bundle the shell references", async () => {
    if (!built) return;
    const shell = await get(port, "/");
    const m = /src="(\/assets\/[^"]+\.js)"/.exec(shell.body);
    assert.ok(m, "index.html references no /assets/*.js bundle");
    const asset = await get(port, m[1]);
    assert.equal(asset.status, 200, `${m[1]} returned ${asset.status}`);
  });

  it("falls back to the SPA shell for client-side routes", async () => {
    if (!built) return;
    const res = await get(port, "/some/deep/route");
    assert.equal(res.status, 200);
    assert.match(res.body, /<div id="root">/);
  });
});
