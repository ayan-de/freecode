// Serve install/uninstall scripts from the repo's raw GitHub source so the
// download endpoint always tracks the committed script (single source of truth).
const RAW_BASE =
  "https://raw.githubusercontent.com/ayan-de/freecode/main/scripts";

export async function serveScript(
  file: string,
  contentType: string,
): Promise<Response> {
  const url = `${RAW_BASE}/${file}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // Fall back to a redirect if the proxy fetch fails for any reason.
    return Response.redirect(url, 302);
  }
  return new Response(await res.text(), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    },
  });
}
