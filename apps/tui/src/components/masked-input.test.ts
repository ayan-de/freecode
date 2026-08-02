import assert from "node:assert/strict";
import test from "node:test";
import { MaskedInput } from "./masked-input.js";

const SECRET = "sk-ant-api03-SECRETVALUE";

function rendered(input: MaskedInput, width = 80): string {
  return input.render(width).join("");
}

test("the value never reaches the rendered line", () => {
  const input = new MaskedInput();
  input.setValue(SECRET);

  const out = rendered(input);
  assert.doesNotMatch(out, /SECRETVALUE/);
  assert.doesNotMatch(out, /sk-ant/);
  assert.match(out, /•/);
});

test("the real value is still what getValue and onSubmit see", () => {
  const input = new MaskedInput();
  input.setValue(SECRET);
  rendered(input);

  // Rendering must not be destructive — the swap has to be put back, or the
  // backend would be handed a string of bullets as the API key.
  assert.equal(input.getValue(), SECRET);
});

test("an empty input renders like a normal one", () => {
  const input = new MaskedInput();
  assert.doesNotMatch(rendered(input), /•/);
});

test("the mask preserves the value's length", () => {
  const input = new MaskedInput();
  input.setValue("abcd");

  const bullets = (rendered(input).match(/•/g) ?? []).length;
  // 4 characters in, 4 mask glyphs out: the base class's cursor and scroll
  // math only stays correct while the substitution is length-preserving.
  assert.equal(bullets, 4);
});

test("repeated renders stay stable", () => {
  const input = new MaskedInput();
  input.setValue(SECRET);

  const first = rendered(input);
  const second = rendered(input);
  assert.equal(first, second);
  assert.equal(input.getValue(), SECRET);
});
