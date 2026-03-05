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
  dayAfter.setDate(dayAfter.getDate() + 2); // cache shorter for 2 days after election
  return today >= ELECTION_DATE && today <= dayAfter;
};
// 2 mins on election day, 10 mins during count period, 60 mins otherwise
const getCacheTTL = () => {
  if (isElectionDay()) return 2 * 60 * 1000;
  if (isElectionPeriod()) return 10 * 60 * 1000;
  return 60 * 60 * 1000;
};

// ─── Rate limiter ──────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

// ─── Retry with exponential back-off ──────────────────────────────
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(url: string, retries = 3, delayMs = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, {
        timeout: 8000,
        headers: {
          // Prevent getting a cached response from the upstream server
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
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

// ─── Route handler ─────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const now = Date.now();

  // Allow manual cache bust via ?refresh=true
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  // 1. Rate limiting
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
      {
        status: 429,
        headers: { "Retry-After": "60" },
      }
    );
  }

  // 2. Cache check (skip if force refresh)
  const cached = cache.get(id);
  const ttl = getCacheTTL();

  if (!forceRefresh && cached && now - cached.cachedAt < ttl) {
    console.log(`Cache HIT for candidate ${id} (age: ${Math.floor((now - cached.cachedAt) / 1000)}s)`);
    return Response.json(cached.data, {
      headers: {
        "X-Cache": "HIT",
        "X-Cache-Age": `${Math.floor((now - cached.cachedAt) / 1000)}s`,
        "X-Cache-TTL": `${Math.floor(ttl / 1000)}s`,
      },
    });
  }

  // 3. Fetch fresh data
  try {
    const url = `https://election.ekantipur.com/profile/${id}?lng=eng`;
    console.log(`Cache MISS for candidate ${id} — fetching fresh data`);
    const html = await fetchWithRetry(url);
    const result = scrape(html);

    // 4. Store in cache
    cache.set(id, { data: result, cachedAt: now });

    return Response.json(result, {
      headers: {
        "X-Cache": "MISS",
        "X-Cache-TTL": `${Math.floor(ttl / 1000)}s`,
      },
    });
  } catch (err) {
    console.error(`Failed to fetch candidate ${id}:`, err);

    // Return stale cache if available rather than an error
    if (cached) {
      console.warn(`Returning stale cache for candidate ${id}`);
      return Response.json(cached.data, {
        headers: { "X-Cache": "STALE" },
      });
    }

    return Response.json(
      { error: "Failed to fetch candidate data. Please try again later." },
      { status: 502 }
    );
  }
}