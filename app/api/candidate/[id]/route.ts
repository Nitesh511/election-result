import axios from "axios";
import * as cheerio from "cheerio";
import { NextRequest } from "next/server";

const cache = new Map<string, { data: Record<string, string>; cachedAt: number }>();

const ELECTION_DATE = new Date("2026-03-05");

const isElectionDay = () => new Date().toDateString() === ELECTION_DATE.toDateString();
const isElectionPeriod = () => {
  const today = new Date();
  const dayAfter = new Date(ELECTION_DATE);
  dayAfter.setDate(dayAfter.getDate() + 2);
  return today >= ELECTION_DATE && today <= dayAfter;
};
const getCacheTTL = () => {
  if (isElectionDay()) return 2 * 60 * 1000;
  if (isElectionPeriod()) return 10 * 60 * 1000;
  return 60 * 60 * 1000;
};

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Surrogate-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Expires": "0",
};

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ne-NP,ne;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Referer: "https://election.ekantipur.com/",
};

async function fetchWithRetry(url: string, retries = 3, delayMs = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 15000, headers: HEADERS });
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      await delay(delayMs * attempt);
    }
  }
  throw new Error("All retry attempts failed");
}

function scrape(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const result: Record<string, string> = {};

  // Try to find the 2082 tab content specifically
  // The tabs likely render all election data in the HTML, hidden via CSS
  // Look for any element with 2082 or 2026 context
  const extract = (selector: string) => {
    $(selector).each((_, el) => {
      const key = $(el).find("td").eq(0).text().trim();
      const value = $(el).find("td").eq(1).text().trim();
      if (key) result[key] = value;
    });
  };

  // First try: look for a 2082-specific section
  let found2082 = false;
  $("[data-year='2082'], [data-election='2082'], #election-2082, .election-2082").each((_, el) => {
    $(el).find("tr").each((_, row) => {
      const key = $(row).find("td").eq(0).text().trim();
      const value = $(row).find("td").eq(1).text().trim();
      if (key) { result[key] = value; found2082 = true; }
    });
  });

  // Second try: look for tab panels — grab the FIRST one (most recent = 2082)
  if (!found2082) {
    const tabPanels = $(".tab-pane, .tab-content > div, [role='tabpanel']");
    if (tabPanels.length > 0) {
      $(tabPanels.get(0)).find("tr").each((_, row) => {
        const key = $(row).find("td").eq(0).text().trim();
        const value = $(row).find("td").eq(1).text().trim();
        if (key) { result[key] = value; found2082 = true; }
      });
    }
  }

  // Fallback: default scrape
  if (!found2082) {
    extract("#candidateResult table tr");
  }
  extract("#candidatePersonalInfo table tr");

  return result;
}

async function fetchCandidate2082(id: string): Promise<Record<string, string>> {
  const bust = Date.now();

  const urlsToTry = [
    `https://election.ekantipur.com/profile/${id}?lng=eng&year=2082&_=${bust}`,
    `https://election.ekantipur.com/profile/${id}?lng=eng&election=2082&_=${bust}`,
    `https://election.ekantipur.com/profile/${id}?lng=eng&electionYear=2082&_=${bust}`,
    `https://election.ekantipur.com/profile/${id}/2082?lng=eng&_=${bust}`,
    `https://election.ekantipur.com/2082/profile/${id}?lng=eng&_=${bust}`,
    `https://election.ekantipur.com/profile/${id}?lng=eng&_=${bust}`,
  ];

  for (const url of urlsToTry) {
    try {
      const html = await fetchWithRetry(url);
      const result = scrape(html);

      const electionDate = result["Election date"] || result["Election Date"] || "";
      if (electionDate.includes("2026") || electionDate.includes("2082") || electionDate.includes("March")) {
        console.log(`✅ Got 2082 data from: ${url}`);
        return result;
      }

      const votes = parseInt((result["Total Votes"] || "").replace(/[^0-9]/g, ""), 10);
      if (!isNaN(votes) && votes < 50000 && votes >= 0) {
        console.log(`✅ Likely fresh data (${votes} votes) from: ${url}`);
        return result;
      }

      console.log(`⚠ Old data at ${url}, trying next...`);
    } catch (err) {
      console.warn(`Failed ${url}:`, err);
    }
  }

  throw new Error("Could not fetch 2082 data");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const now = Date.now();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

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
      { status: 429, headers: { ...NO_CACHE_HEADERS, "Retry-After": "60" } },
    );
  }

  const IS_NETLIFY = process.env.NETLIFY === "true";
  const cached = cache.get(id);
  const ttl = getCacheTTL();

  if (!IS_NETLIFY && !forceRefresh && cached && now - cached.cachedAt < ttl) {
    return Response.json(cached.data, { headers: { ...NO_CACHE_HEADERS, "X-Cache": "HIT" } });
  }

  try {
    const result = await fetchCandidate2082(id);
    cache.set(id, { data: result, cachedAt: now });
    return Response.json(result, { headers: { ...NO_CACHE_HEADERS, "X-Cache": "MISS" } });
  } catch (err) {
    console.error(`Failed to fetch candidate ${id}:`, err);
    if (cached) {
      return Response.json(cached.data, { headers: { ...NO_CACHE_HEADERS, "X-Cache": "STALE" } });
    }
    return Response.json(
      { error: "Failed to fetch candidate data. Please try again later." },
      { status: 502, headers: NO_CACHE_HEADERS },
    );
  }
}