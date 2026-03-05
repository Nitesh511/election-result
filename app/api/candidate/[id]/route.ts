import axios from "axios";
import * as cheerio from "cheerio";
import { NextRequest } from "next/server";

// ─── In-memory cache ───────────────────────────────────────────────
const cache = new Map<string, { data: Record<string, string>; cachedAt: number }>();

// Short TTL during active election (5 mins), longer otherwise
const ELECTION_DATE = new Date("2026-03-05");

const isElectionDay = () => {
  const today = new Date();
  return today.toDateString() === ELECTION_DATE.toDateString();
};

const isElectionPeriod = () => {
  const today = new Date();
  const dayAfter = new Date(ELECTION_DATE);
  dayAfter.setDate(dayAfter.getDate() + 2); // short cache 2 days after election
  return today >= ELECTION_DATE && today <= dayAfter;
};

const getCacheTTL = () => {
  if (isElectionDay()) return 2 * 60 * 1000; // 2 mins
  if (isElectionPeriod()) return 10 * 60 * 1000; // 10 mins
  return 60 * 60 * 1000; // 1 hour
};

// ─── Rate limiter ──────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

// ─── Delay helper ─────────────────────────────────────────────────
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ─── Fetch with retry + CDN bust ──────────────────────────────────
async function fetchWithRetry(url: string, retries = 3, delayMs = 1000): Promise<string> {
  const bustUrl = `${url}&_=${Date.now()}`; // timestamp cache-buster

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(bustUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "ne-NP,ne;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Referer": "https://election.ekantipur.com/",
        },
      });
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs * attempt}ms...`);
      await delay(delayMs * attempt);
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

// ─── Route handler ────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const now = Date.now();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  // ─── Rate limiting ───────────────────────────────────────────────
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rateEntry = rateLimitMap.get(ip) ?? { count: 0, windowStart: now };

  if (now - rateEntry.windowStart > RATE_WINDOW_MS) {
    rateEntry.count = 0;
    rateEntry.windowStart = now;
  }
  rateEntry.count++;
  rateLimitMap.set(ip, rateEntry);

  if (rateEntry.count > RATE_LIMIT) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // ─── Cache check ────────────────────────────────────────────────
  const IS_NETLIFY = process.env.NETLIFY === "true";
  const cached = cache.get(id);
  const ttl = getCacheTTL();

  if (!IS_NETLIFY && !forceRefresh && cached && now - cached.cachedAt < ttl) {
    console.log(`Cache HIT for candidate ${id}`);
    return Response.json(cached.data, {
      headers: {
        "X-Cache": "HIT",
        "X-Cache-Age": `${Math.floor((now - cached.cachedAt) / 1000)}s`,
        "X-Cache-TTL": `${Math.floor(ttl / 1000)}s`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  // ─── Fetch fresh data ───────────────────────────────────────────
  try {
    // Force cache-busting to always get latest 2026 data
    const url = `https://election.ekantipur.com/profile/${id}?lng=eng&_=${Date.now()}`;
    console.log(`Cache MISS for candidate ${id} — fetching fresh data`);
    const html = await fetchWithRetry(url);
    const result = scrape(html);

    // Store in in-memory cache
    cache.set(id, { data: result, cachedAt: now });

    return Response.json(result, {
      headers: {
        "X-Cache": "MISS",
        "X-Cache-TTL": `${Math.floor(ttl / 1000)}s`,
        "Cache-Control": "no-store, max-age=0",
        "Surrogate-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(`Failed to fetch candidate ${id}:`, err);

    // Return stale cache if exists
    if (cached) {
      console.warn(`Returning stale cache for candidate ${id}`);
      return Response.json(cached.data, { headers: { "X-Cache": "STALE" } });
    }

    return Response.json(
      { error: "Failed to fetch candidate data. Please try again later." },
      { status: 502 }
    );
  }
}