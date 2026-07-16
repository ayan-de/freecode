import { serveScript } from "../lib/serve-script";

export const dynamic = "force-dynamic";

// GET /install.ps1  →  irm https://freecode.ayande.xyz/install.ps1 | iex
export function GET() {
  return serveScript("install.ps1", "text/plain; charset=utf-8");
}
