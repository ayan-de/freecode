// =============================================================================
// Unit tests for the bearer-token auth module.
// =============================================================================

import { strict as assert } from "assert";
import { describe, it } from "node:test";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  compareTokens,
  extractToken,
  isAuthRequired,
  isLoopbackHost,
  loadOrCreateToken,
} from "./auth.js";

// Point HOME at an isolated temp dir so we don't trample a real token file.
function withTempHome<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-auth-"));
  const prev = process.env.HOME;
  process.env.HOME = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("web/auth", () => {
  describe("isLoopbackHost", () => {
    it("treats 127.0.0.1, ::1, localhost as loopback", () => {
      assert.equal(isLoopbackHost("127.0.0.1"), true);
      assert.equal(isLoopbackHost("::1"), true);
      assert.equal(isLoopbackHost("[::1]"), true);
      assert.equal(isLoopbackHost("localhost"), true);
    });

    it("treats other hosts as non-loopback", () => {
      assert.equal(isLoopbackHost("0.0.0.0"), false);
      assert.equal(isLoopbackHost("192.168.1.5"), false);
      assert.equal(isLoopbackHost("100.64.0.1"), false); // Tailscale CGNAT
    });
  });

  describe("compareTokens", () => {
    it("returns true for identical tokens", () => {
      const t = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
      assert.equal(compareTokens(t, t), true);
    });

    it("returns false for differing tokens of equal length", () => {
      const a = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
      const b = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFa";
      assert.equal(compareTokens(a, b), false);
    });

    it("returns false for differing lengths without throwing", () => {
      assert.equal(compareTokens("short", "definitely-much-longer-token"), false);
    });

    it("returns false for null without throwing", () => {
      assert.equal(compareTokens(null, "any-token-here"), false);
    });

    it("returns false for empty string", () => {
      assert.equal(compareTokens("", "any-token-here"), false);
    });
  });

  describe("extractToken", () => {
    it("prefers the Authorization: Bearer header", () => {
      const url = new URL("http://localhost/events?token=queryToken");
      const token = extractToken(
        { authorization: "Bearer headerToken" },
        url,
      );
      assert.equal(token, "headerToken");
    });

    it("falls back to ?token= for EventSource compatibility", () => {
      const url = new URL("http://localhost/events?token=queryToken");
      const token = extractToken({}, url);
      assert.equal(token, "queryToken");
    });

    it("returns null when neither is present", () => {
      const url = new URL("http://localhost/events");
      assert.equal(extractToken({}, url), null);
    });

    it("handles case-insensitive Bearer scheme", () => {
      const url = new URL("http://localhost/events");
      assert.equal(
        extractToken({ authorization: "bearer abc" }, url),
        "abc",
      );
    });

    it("trims whitespace around the bearer token", () => {
      const url = new URL("http://localhost/events");
      assert.equal(
        extractToken({ authorization: "Bearer   padded   " }, url),
        "padded",
      );
    });
  });

  describe("isAuthRequired", () => {
    it("requires auth when requireAuth is set, even on loopback", () => {
      assert.equal(isAuthRequired("127.0.0.1", true), true);
    });

    it("skips auth on loopback by default (preserves desktop behavior)", () => {
      assert.equal(isAuthRequired("127.0.0.1", false), false);
      assert.equal(isAuthRequired("localhost", false), false);
      assert.equal(isAuthRequired("::1", false), false);
    });

    it("requires auth on non-loopback hosts", () => {
      assert.equal(isAuthRequired("0.0.0.0", false), true);
      assert.equal(isAuthRequired("192.168.1.5", false), true);
    });
  });

  describe("loadOrCreateToken", () => {
    it("creates a new token in an isolated config dir", () => {
      withTempHome(() => {
        const t = loadOrCreateToken();
        // base64url of 32 bytes is 43 chars
        assert.match(t, /^[A-Za-z0-9_-]{43}$/);
      });
    });

    it("returns the same token on subsequent calls", () => {
      withTempHome(() => {
        const a = loadOrCreateToken();
        const b = loadOrCreateToken();
        assert.equal(a, b);
      });
    });

    it("writes the file with mode 0600", () => {
      withTempHome(() => {
        loadOrCreateToken();
        const file = path.join(os.homedir(), ".freecode", "web-token");
        const stat = fs.statSync(file);
        // Mask only the permission bits; on Windows the mode is unreliable,
        // so just confirm we attempted to write it.
        if (process.platform !== "win32") {
          assert.equal(stat.mode & 0o777, 0o600);
        }
      });
    });
  });
});
