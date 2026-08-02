// =============================================================================
// masked-input — single-line input that never paints its value.
//
// API keys were typed into a plain pi-tui Input, so the secret sat in clear
// text on screen for as long as the prompt was open. The alt screen keeps it
// out of shell scrollback, but it is still captured by screenshots, screen
// recordings, screen sharing and `tmux capture-pane`.
//
// pi-tui's Input has no mask option and keeps `value` private, so rather than
// reimplement its cursor math, horizontal scrolling and padding (and inherit
// the bugs), this swaps a same-length mask in for the duration of the render
// and puts the real value straight back. Input.setValue clamps the cursor
// (`Math.min(cursor, value.length)`) instead of resetting it, and the mask is
// the same length, so the cursor survives the round trip untouched.
// =============================================================================

import { Input } from "@earendil-works/pi-tui";

/**
 * U+2022. Width 1, so every column the base class computes stays correct.
 * Input indexes its cursor in UTF-16 code units, which is also what
 * `String.length` counts — matching that is what keeps the swap transparent.
 */
const MASK_CHAR = "•";

export class MaskedInput extends Input {
  override render(width: number): string[] {
    const real = this.getValue();
    if (real.length === 0) return super.render(width);

    this.setValue(MASK_CHAR.repeat(real.length));
    try {
      return super.render(width);
    } finally {
      // finally, not a plain call after: a throw from the base renderer must
      // not leave the component holding a mask where the secret should be —
      // the next onSubmit would hand the masked string to the backend.
      this.setValue(real);
    }
  }
}
