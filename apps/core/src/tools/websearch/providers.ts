// =============================================================================
// WebSearch providers — plain HTTP, no SDKs.
//  - DuckDuckGo: keyless HTML endpoint (scraped)
//  - Brave: official Search API (requires BRAVE_API_KEY)
// =============================================================================

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; freecode/0.2; +https://github.com/ayan-de/freecode)";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// DuckDuckGo wraps result links in a redirect: /l/?uddg=<encoded-url>
function unwrapDuckDuckGoUrl(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  return href.startsWith("//") ? `https:${href}` : href;
}

export async function searchDuckDuckGo(
  query: string,
  count: number,
  abort?: AbortSignal,
): Promise<SearchResult[]> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, {
    signal: abort,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();

  const results: SearchResult[] = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));

  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) !== null && results.length < count) {
    const url = unwrapDuckDuckGoUrl(lm[1]);
    const title = stripTags(lm[2]);
    if (!title || !url) {
      i++;
      continue;
    }
    results.push({ title, url, snippet: snippets[i] });
    i++;
  }
  return results;
}

interface BraveResponse {
  web?: { results?: { title: string; url: string; description?: string }[] };
}

export async function searchBrave(
  query: string,
  count: number,
  abort?: AbortSignal,
): Promise<SearchResult[]> {
  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const response = await fetch(endpoint, {
    signal: abort,
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "",
    },
  });
  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as BraveResponse;
  return (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ? stripTags(r.description) : undefined,
  }));
}
