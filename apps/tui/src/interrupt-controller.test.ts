import assert from "node:assert/strict";
import test from "node:test";
import { InterruptController, type InterruptDeps } from "./interrupt-controller.js";

function makeDeps(overrides: Partial<InterruptDeps> = {}): InterruptDeps {
  return {
    isTurnActive: () => false,
    cancelTurn: () => {},
    notify: () => {},
    getSessionId: () => "sess-42",
    shutdown: () => {},
    ...overrides,
  };
}

// process.exit(0) would kill the test runner, so every test stubs it out and
// restores it afterwards.
function withStubbedExit(run: (calls: number[]) => void): void {
  const original = process.exit;
  const calls: number[] = [];
  // @ts-expect-error -- test stub, narrower signature than the real process.exit
  process.exit = (code?: number) => {
    calls.push(code ?? 0);
  };
  try {
    run(calls);
  } finally {
    process.exit = original;
  }
}

test("forceExit shuts down and prints the resume hint without a double press", () => {
  withStubbedExit((exitCalls) => {
    let shutdownCalled = false;
    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };
    // printResumeHint() only writes when stdout is a TTY.
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;

    try {
      const controller = new InterruptController(
        makeDeps({
          shutdown: () => {
            shutdownCalled = true;
          },
        }),
      );

      controller.forceExit();

      assert.equal(shutdownCalled, true);
      assert.ok(written.some((chunk) => chunk.includes("freecode --resume sess-42")));
      assert.deepEqual(exitCalls, [0]);
    } finally {
      process.stdout.write = originalWrite;
      process.stdout.isTTY = originalIsTTY;
    }
  });
});

test("forceExit does not require isTurnActive() to be false first", () => {
  withStubbedExit((exitCalls) => {
    const controller = new InterruptController(
      makeDeps({
        isTurnActive: () => true,
      }),
    );

    controller.forceExit();

    assert.deepEqual(exitCalls, [0]);
  });
});

test("a normal Ctrl+C during an active turn cancels it instead of exiting", () => {
  let cancelled = false;
  const controller = new InterruptController(
    makeDeps({
      isTurnActive: () => true,
      cancelTurn: () => {
        cancelled = true;
      },
    }),
  );

  controller.handle();

  assert.equal(cancelled, true);
});
