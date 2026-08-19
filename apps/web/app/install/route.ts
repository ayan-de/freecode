import { serveScript } from "../lib/serve-script";

export const dynamic = "force-dynamic";

// GET /install  →  curl -fsSL https://freecode.website/install | bash
export function GET() {
  return serveScript("install.sh", "text/x-shellscript; charset=utf-8");
}
