// =============================================================================
// Terminal QR rendering for the pairing URL.
//
// Extracted so both `freecode web` (which prints it as part of its banner) and
// `freecode mobile` (which lays out its own instructions around it) render the
// same code the same way.
//
// qrcode-terminal is CJS and awkward to call correctly. Three separate ways to
// get it wrong, all of which fail silently:
//   - the ESM namespace puts the module object on `.default`; there is no
//     top-level `.generate`
//   - the signature is generate(input, opts, cb), not (cb, opts)
//   - generate() reads its error-correction level off `this`, so detaching it
//     into a bare function reference throws "bad rs block"
// =============================================================================

/**
 * Render `url` as terminal QR art, or null when qrcode-terminal isn't
 * available. Never throws — the caller always has the plain URL to fall back
 * on, and a missing QR must not stop the server coming up.
 */
export async function renderPairQr(url: string): Promise<string | null> {
  try {
    const mod = await import("qrcode-terminal");
    const qr = ((mod as { default?: unknown }).default ?? mod) as {
      generate?: (
        input: string,
        opts: { small?: boolean },
        cb: (art: string) => void,
      ) => void;
    };
    const generate = qr.generate;
    if (typeof generate !== "function") return null;
    return await new Promise<string | null>((resolve) => {
      try {
        // Called as a method: generate() reads its error-correction level
        // off `this`, so it must stay bound to the module object.
        qr.generate!(url, { small: true }, (art: string) => resolve(art));
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
