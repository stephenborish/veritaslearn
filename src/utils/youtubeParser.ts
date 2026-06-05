/**
 * YouTube URL parser for VERITAS Learn.
 *
 * Supports:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://youtube.com/shorts/VIDEO_ID
 *   URLs with extra params such as t=90 or start=90
 *
 * Does NOT accept arbitrary iframe HTML — only YouTube URLs.
 *
 * Returns either a YouTubeParseResult or a YouTubeParseError.
 */

export interface YouTubeParseResult {
  provider: "youtube";
  videoId: string;
  canonicalUrl: string;
  embedUrl: string;
  startSeconds?: number;
  thumbnailUrl: string;
}

export interface YouTubeParseError {
  error: string;
}

export type YouTubeParseOutcome = YouTubeParseResult | YouTubeParseError;

export function isYouTubeParseError(r: YouTubeParseOutcome): r is YouTubeParseError {
  return "error" in r;
}

const YT_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0].split("?")[0];
      return YT_VIDEO_ID_RE.test(id) ? id : null;
    }

    if (host === "youtube.com") {
      // /watch?v=
      const v = url.searchParams.get("v");
      if (v && YT_VIDEO_ID_RE.test(v)) return v;

      // /embed/VIDEO_ID
      const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];

      // /shorts/VIDEO_ID
      const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];

      // /v/VIDEO_ID
      const vPathMatch = url.pathname.match(/^\/v\/([a-zA-Z0-9_-]{11})/);
      if (vPathMatch) return vPathMatch[1];
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

function extractStartSeconds(input: string): number | undefined {
  try {
    const url = new URL(input.trim());
    // ?t=90 or ?start=90
    const t = url.searchParams.get("t") || url.searchParams.get("start");
    if (!t) return undefined;
    // t can be "90" (seconds) or "1m30s" format
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const hmsMatch = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (hmsMatch) {
      const h = parseInt(hmsMatch[1] || "0", 10);
      const m = parseInt(hmsMatch[2] || "0", 10);
      const s = parseInt(hmsMatch[3] || "0", 10);
      const total = h * 3600 + m * 60 + s;
      return total > 0 ? total : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Returns true if the input string looks like a YouTube URL (loose check, before full parse). */
export function looksLikeYouTubeUrl(input: string): boolean {
  return /youtube\.com|youtu\.be/i.test(input);
}

/**
 * Parse a YouTube URL into its components.
 * Returns a YouTubeParseResult on success, or a YouTubeParseError on failure.
 */
export function parseYouTubeUrl(input: string): YouTubeParseOutcome {
  if (!input || !input.trim()) {
    return { error: "No URL provided." };
  }

  const trimmed = input.trim();

  if (!looksLikeYouTubeUrl(trimmed)) {
    return { error: "This does not look like a YouTube URL." };
  }

  const videoId = extractVideoId(trimmed);
  if (!videoId) {
    return { error: "Could not find a valid YouTube video ID in this URL." };
  }

  const startSeconds = extractStartSeconds(trimmed);

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Use youtube-nocookie.com for privacy-enhanced embed
  const embedParams = new URLSearchParams();
  embedParams.set("enablejsapi", "1");
  if (startSeconds && startSeconds > 0) {
    embedParams.set("start", String(startSeconds));
  }
  embedParams.set("rel", "0");
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?${embedParams.toString()}`;

  // Use standard thumbnail URL (hqdefault is reliably available)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return {
    provider: "youtube",
    videoId,
    canonicalUrl,
    embedUrl,
    startSeconds,
    thumbnailUrl,
  };
}

/**
 * Resolve a legacy videoUrl to a YouTube parse result if it looks like YouTube.
 * Used for backward-compat migration of old blocks that stored a YouTube URL in videoUrl.
 */
export function resolveYouTubeLegacy(videoUrl: string | undefined): YouTubeParseResult | null {
  if (!videoUrl || !looksLikeYouTubeUrl(videoUrl)) return null;
  const result = parseYouTubeUrl(videoUrl);
  if (isYouTubeParseError(result)) return null;
  return result;
}
