import { serveScript } from "../lib/serve-script";

export const dynamic = "force-dynamic";

// GET /uninstall  →  curl -fsSL https://freecode.ayande.xyz/uninstall | bash -s -- --yes
export function GET() {
  return serveScript("uninstall.sh", "text/x-shellscript; charset=utf-8");
}
