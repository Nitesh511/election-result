import axios from "axios";
import * as cheerio from "cheerio";
import { NextRequest } from "next/server";

// ─── In-memory cache ───────────────────────────────────────────────
const cache = new Map<string, { data: Record<string, string>; cachedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Rate limiter ──────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 10;           // max requests
const RATE_WINDOW_MS = 60 * 1000; // per 1 minute per IP

// ─── Retry/fetch with delay ────────────────────────────────────────
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(
  url: string,
  retries = 3,
  delayMs = 1000
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, {
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
        },
      });
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
      await delay(delayMs * attempt); // exponential back-off
    }
  }
  throw new Error("All retry attempts failed");
}

// ─── Scraper ───────────────────────────────────────────────────────
function scrape(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const result: Record<string, string> = {};

  const extract = (selector: string) => {
    $(selector).each((_, el) => {
      const key = $(el).find("td").eq(0).text().trim();
      const value = $(el).find("td").eq(1).text().trim();
      if (key) result[key] = value;
    });
  };

  extract("#candidateResult table tr");
  extract("#candidatePersonalInfo table tr");

  return result;
}

// ─── Route handler ─────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // 1. Rate limiting — keyed by IP
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const now = Date.now();
  const rateEntry = rateLimitMap.get(ip) ?? { count: 0, windowStart: now };

  if (now - rateEntry.windowStart > RATE_WINDOW_MS) {
    // Reset window
    rateEntry.count = 0;
    rateEntry.windowStart = now;
  }

  rateEntry.count++;
  rateLimitMap.set(ip, rateEntry);

  if (rateEntry.count > RATE_LIMIT) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(RATE_LIMIT),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // 2. Cache check
  const cached = cache.get(id);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    console.log(`Cache hit for candidate ${id}`);
    return Response.json(cached.data, {
      headers: {
        "X-Cache": "HIT",
        "X-Cache-Age": String(Math.floor((now - cached.cachedAt) / 1000)) + "s",
      },
    });
  }

  // 3. Fetch with retry
  try {
    const url = `https://election.ekantipur.com/profile/${id}?lng=eng`;
    const html = await fetchWithRetry(url);
    const result = scrape(html);

    // 4. Store in cache
    cache.set(id, { data: result, cachedAt: now });

    return Response.json(result, {
      headers: {
        "X-Cache": "MISS",
        "X-RateLimit-Limit": String(RATE_LIMIT),
        "X-RateLimit-Remaining": String(RATE_LIMIT - rateEntry.count),
      },
    });
  } catch (err) {
    console.error(`Failed to fetch candidate ${id}:`, err);
    return Response.json(
      { error: "Failed to fetch candidate data. Please try again later." },
      { status: 502 }
    );
  }
}