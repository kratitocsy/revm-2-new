// supabase/functions/yt-resolve-channel/index.ts
//
// Resolves free-text YouTube channel search ("eduniti") to canonical
// identifiers (channelId, @handle, title, avatar) the same way YouTube's
// own search autocomplete does it — so blocks.html can store a real
// identifier instead of raw text, which is what youtube-guard.js's
// display-name fallback matcher exists to work around in the first place.
//
// This runs server-side (not in blocks.html) purely because youtube.com
// does not send Access-Control-Allow-Origin headers, so a direct fetch()
// from the browser would be blocked by CORS regardless of correctness.
//
// Deploy: supabase functions deploy yt-resolve-channel
// Call:   GET {SUPABASE_URL}/functions/v1/yt-resolve-channel?q=eduniti

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

interface ChannelMatch {
  channelId: string | null;
  handle: string | null;
  title: string;
  thumbnail: string | null;
  subscriberCountText: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Pulls the ytInitialData JSON blob out of a YouTube search results page.
// YouTube embeds the full render tree as `var ytInitialData = {...};` in a
// <script> tag - this is the same data their own frontend renders from, so
// it doesn't require an API key and matches what a user actually sees.
function extractInitialData(html: string): any | null {
  const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s)
    ?? html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Walks the search response's renderer tree for channelRenderer nodes.
// YouTube's page structure is deeply nested and not officially documented,
// so this recurses generically rather than hardcoding a brittle exact path.
function findChannelRenderers(node: unknown, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 20) return out;
  if (Array.isArray(node)) {
    for (const item of node) findChannelRenderers(item, out, depth + 1);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.channelRenderer) out.push(obj.channelRenderer);
  for (const key of Object.keys(obj)) {
    findChannelRenderers(obj[key], out, depth + 1);
  }
  return out;
}

function textFromRuns(field: any): string {
  if (!field) return "";
  if (typeof field.simpleText === "string") return field.simpleText;
  if (Array.isArray(field.runs)) return field.runs.map((r: any) => r.text).join("");
  return "";
}

function parseChannelRenderer(renderer: any): ChannelMatch {
  const channelId: string | null = renderer.channelId ?? null;
  // canonicalBaseUrl looks like "/@eduniti" - strip the slash to get the handle.
  const canonicalUrl: string = renderer.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
    ?? renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
    ?? "";
  const handleMatch = canonicalUrl.match(/@[\w.-]+/);
  const handle = handleMatch ? handleMatch[0] : null;

  const title = textFromRuns(renderer.title) || "Unknown channel";
  const subscriberCountText = textFromRuns(renderer.subscriberCountText) || null;

  const thumbs = renderer.thumbnail?.thumbnails;
  const thumbnail = Array.isArray(thumbs) && thumbs.length
    ? (thumbs[thumbs.length - 1].url as string)
    : null;

  return { channelId, handle, title, thumbnail, subscriberCountText };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q) {
    return jsonResponse({ error: "missing_query", matches: [] }, 400);
  }
  if (q.length > 100) {
    return jsonResponse({ error: "query_too_long", matches: [] }, 400);
  }

  // sp=EgIQAg== restricts YouTube's search filter to the "Channel" result
  // type only, so we don't have to filter out videos/playlists ourselves.
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        // A normal browser UA - YouTube serves a different (harder to
        // parse) page to unrecognized/bot clients.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!resp.ok) {
      return jsonResponse({ error: "youtube_fetch_failed", status: resp.status, matches: [] }, 502);
    }

    const html = await resp.text();
    const data = extractInitialData(html);
    if (!data) {
      return jsonResponse({ error: "parse_failed", matches: [] }, 502);
    }

    const renderers = findChannelRenderers(data);
    const matches = renderers.slice(0, 6).map(parseChannelRenderer);

    return jsonResponse({ query: q, matches });
  } catch (err) {
    return jsonResponse({ error: "internal_error", message: String(err), matches: [] }, 500);
  }
});
