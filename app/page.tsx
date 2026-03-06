'use client';

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────
interface CandidateData {
  [key: string]: string;
}

// ─── Name → ID map (extend as needed) ────────────────────────────
const NAME_TO_ID: { [key: string]: string } = {
  "balen shah": "125",
  "balen": "125",
  "kp oli": "122",
  "kp sharma oli": "122",
  "oli": "122",
};

function resolveId(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (NAME_TO_ID[lower]) return NAME_TO_ID[lower];
  if (/^\d+$/.test(input.trim())) return input.trim();
  // partial match
  for (const [name, id] of Object.entries(NAME_TO_ID)) {
    if (name.includes(lower) || lower.includes(name.split(" ")[0])) return id;
  }
  return null;
}

function getVotes(data: CandidateData): number {
  // ONLY read "Total Votes" — never fall back to other fields
  // to avoid picking up numbers from Birth Date, Age, etc.
  const raw = (data["Total Votes"] || "").replace(/,/g, "").trim();
  if (!raw || raw === "--" || raw === "-") return 0;
  const parsed = parseInt(raw, 10);
  // Must be a realistic vote count (> 100) to avoid garbage values
  return (!isNaN(parsed) && parsed > 100) ? parsed : 0;
}

function getName(data: CandidateData, fallback: string): string {
  return data["Candidate Name"] || data["Name"] || data["Candidate"] || fallback;
}

function getParty(data: CandidateData): string {
  return data["Political Party"]
    || data[Object.keys(data).find(k => k.toLowerCase().includes("party")) ?? ""] 
    || "—";
}

function getStatus(data: CandidateData): string {
  const val = data["Election Result"] || data["Status"] || data["Result"] || "";
  return (val === "--" || val === "-") ? "" : val;
}

function isWon(data: CandidateData): boolean {
  const s = getStatus(data).toLowerCase();
  return s.includes("won") || s.includes("elected") || s.includes("निर्वाचित");
}

function isPending(data: CandidateData): boolean {
  // Pending if: no result declared AND no votes counted yet
  const result = (data["Election Result"] || "").trim();
  const votes = getVotes(data);
  const noResult = result === "" || result === "--" || result === "-";
  const noVotes = votes === 0;
  return noResult && noVotes;
}

function splitFields(data: CandidateData) {
  const electionKeys = ["status", "result", "votes", "constituency", "position", "rank", "party", "symbol"];
  const election: CandidateData = {};
  const personal: CandidateData = {};
  for (const [k, v] of Object.entries(data)) {
    if (electionKeys.some(ek => k.toLowerCase().includes(ek))) {
      election[k] = v;
    } else {
      personal[k] = v;
    }
  }
  return { election, personal };
}

const BALEN_IMG = "https://preview.redd.it/why-i-think-balen-shah-is-nepals-most-visionary-leader-v0-o7jiypk1kc8f1.jpeg?width=640&crop=smart&auto=webp&s=63109a58c287c1843435d50745b8b7543e1f6e7f";
const OLI_IMG = "https://rpcdn.ratopati.com/media/albums/kp_oli_ms3RYqvNlQ_VrljCy3gJJ.jpg";

// ─── Featured matchup card ────────────────────────────────────────
function MatchupCard({ balen, oli }: { balen: CandidateData | null; oli: CandidateData | null }) {
  const balenVotes = balen ? getVotes(balen) : 0;
  const oliVotes = oli ? getVotes(oli) : 0;
  const total = balenVotes + oliVotes || 1;
  const balenPct = Math.round((balenVotes / total) * 100);
  const oliPct = 100 - balenPct;

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden mb-8" style={{ background: "linear-gradient(135deg, #0d1a10 0%, #0a0a18 50%, #1a0d0d 100%)" }}>
      {/* Label */}
      <div className="px-6 pt-5 pb-0">
        <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/25">
          ⚡ Featured Matchup
        </p>
      </div>

      {/* Main matchup row */}
      <div className="flex items-end gap-0 px-4 md:px-8 pt-4 pb-0">

        {/* ── Balen ── */}
        <div className="flex-1 flex flex-col items-center text-center">
          {/* Photo */}
          <div className="relative mb-4">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-emerald-500/40 shadow-lg shadow-emerald-900/40">
              <img
                src={BALEN_IMG}
                alt="Balen Shah"
                className="w-full h-full object-cover object-top"
              />
            </div>
            <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-white text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${balen ? (isPending(balen) ? "bg-yellow-600" : isWon(balen) ? "bg-emerald-600" : "bg-red-700") : "bg-white/20"}`}>
              {balen ? (isPending(balen) ? "⏳ Pending" : isWon(balen) ? "✓ Won" : "✗ Lost") : "…"}
            </span>
          </div>

          <div className="text-base md:text-lg font-bold text-white leading-tight mb-0.5">
            {balen ? getName(balen, "Balen Shah") : "Balen Shah"}
          </div>
          <div className="text-[10px] text-white/35 font-mono mb-3 truncate max-w-full px-2">
            {balen ? getParty(balen) : "—"}
          </div>
          <div className="text-3xl md:text-4xl font-black tabular-nums text-emerald-300 leading-none">
            {balen ? (balenVotes > 0 ? balenVotes.toLocaleString() : "—") : "—"}
          </div>
          <div className="text-[9px] text-white/25 font-mono tracking-widest uppercase mt-1">votes</div>
          <div className="text-xs font-bold text-emerald-400/70 mt-1 font-mono">{balenVotes > 0 ? balenPct + "%" : "—"}</div>
        </div>

        {/* ── VS divider ── */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0 pb-10 px-2 md:px-4">
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          <div className="w-9 h-9 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-white/40 text-xs font-black">
            VS
          </div>
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
        </div>

        {/* ── KP Oli ── */}
        <div className="flex-1 flex flex-col items-center text-center">
          {/* Photo */}
          <div className="relative mb-4">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-red-500/40 shadow-lg shadow-red-900/40">
              <img
                src={OLI_IMG}
                alt="KP Sharma Oli"
                className="w-full h-full object-cover object-top"
              />
            </div>
            <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-white text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${oli ? (isPending(oli) ? "bg-yellow-600" : isWon(oli) ? "bg-emerald-600" : "bg-red-700") : "bg-white/20"}`}>
              {oli ? (isPending(oli) ? "⏳ Pending" : isWon(oli) ? "✓ Won" : "✗ Lost") : "…"}
            </span>
          </div>

          <div className="text-base md:text-lg font-bold text-white leading-tight mb-0.5">
            {oli ? getName(oli, "KP Sharma Oli") : "KP Sharma Oli"}
          </div>
          <div className="text-[10px] text-white/35 font-mono mb-3 truncate max-w-full px-2">
            {oli ? getParty(oli) : "—"}
          </div>
          <div className="text-3xl md:text-4xl font-black tabular-nums text-red-300 leading-none">
            {oli ? (oliVotes > 0 ? oliVotes.toLocaleString() : "—") : "—"}
          </div>
          <div className="text-[9px] text-white/25 font-mono tracking-widest uppercase mt-1">votes</div>
          <div className="text-xs font-bold text-red-400/70 mt-1 font-mono">{oliVotes > 0 ? oliPct + "%" : "—"}</div>
        </div>
      </div>

      {/* Vote bar */}
      <div className="px-6 md:px-8 py-5">
        {balen && oli && (balenVotes > 0 || oliVotes > 0) ? (
          <>
            <div className="flex rounded-full overflow-hidden h-2.5 bg-white/5 mb-2">
              <div
                className="bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-out"
                style={{ width: `${balenPct}%` }}
              />
              <div
                className="bg-gradient-to-r from-red-500 to-red-700 transition-all duration-1000 ease-out"
                style={{ width: `${oliPct}%` }}
              />
            </div>
            <div className="flex justify-center">
              <span className="mono text-[10px] text-white/20 tracking-widest">
                Total votes cast: <span className="text-white/40 font-bold">{(balenVotes + oliVotes) > 0 ? (balenVotes + oliVotes).toLocaleString() : "Not yet counted"}</span>
              </span>
            </div>
          </>
        ) : balen && oli ? (
          <div className="text-center text-yellow-400/40 text-xs font-mono py-2">
            ⏳ Results not yet available — counting in progress
          </div>
        ) : (
          <div className="text-center text-white/20 text-xs font-mono animate-pulse py-2">
            Loading matchup data…
          </div>
        )}
      </div>
    </div>
  );
}

const CANDIDATE_PHOTOS: { [id: string]: string } = {
  "125": BALEN_IMG,
  "122": OLI_IMG,
};

// ─── Candidate result card ────────────────────────────────────────
function CandidateCard({ data, id }: { data: CandidateData; id: string }) {
  const won = isWon(data);
  const name = getName(data, `Candidate #${id}`);
  const { election, personal } = splitFields(data);
  const [showRaw, setShowRaw] = useState(false);
  const photo = CANDIDATE_PHOTOS[id];

  return (
    <div className={`rounded-2xl border p-6 transition-all duration-500 ${
      isPending(data) ? "border-yellow-500/15 bg-yellow-950/10" :
      won ? "border-emerald-500/20 bg-emerald-950/20"
          : "border-red-500/20 bg-red-950/20"
    }`}>
      {/* Hero */}
      <div className="flex items-center gap-5 mb-6">
        {photo && (
          <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden flex-shrink-0 border-2 ${isPending(data) ? "border-yellow-500/40" : won ? "border-emerald-500/40" : "border-red-500/40"} shadow-lg`}>
            <img src={photo} alt={name} className="w-full h-full object-cover object-top" />
          </div>
        )}
        <div>
          <div className={`text-[10px] font-mono tracking-[0.25em] uppercase mb-1.5 ${won ? "text-emerald-400/60" : "text-red-400/60"}`}>
            Candidate #{id}
          </div>
          <h2 className={`text-2xl md:text-3xl font-bold mb-2 ${won ? "text-emerald-300" : "text-red-300"}`}>
            {name}
          </h2>
          <span className={`inline-block text-[10px] font-mono tracking-[0.15em] uppercase px-3 py-1 rounded ${
            isPending(data) ? "bg-yellow-700/80 text-white" : won ? "bg-emerald-600 text-white" : "bg-red-700 text-white"
          }`}>
            {isPending(data) ? "⏳ Result Pending" : getStatus(data)}
          </span>
        </div>
      </div>

      {/* Election data */}
      {Object.keys(election).length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/25 mb-3 pb-2 border-b border-white/5">
            Election Results
          </p>
          {Object.entries(election)
            .filter(([k]) => !["Name", "Candidate Name", "Status", "Result"].includes(k))
            .map(([key, value]) => (
              <div key={key} className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0 gap-4">
                <span className="text-[11px] font-mono uppercase tracking-wider text-white/30 flex-shrink-0">{key}</span>
                <span className="text-sm text-white/80 text-right">{value || "—"}</span>
              </div>
            ))}
        </div>
      )}

      {/* Personal data */}
      {Object.keys(personal).length > 0 && (
        <div>
          <p className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/25 mb-3 pb-2 border-b border-white/5">
            Personal Info
          </p>
          {Object.entries(personal)
            .filter(([k]) => !["Name", "Candidate Name"].includes(k))
            .map(([key, value]) => (
              <div key={key} className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0 gap-4">
                <span className="text-[11px] font-mono uppercase tracking-wider text-white/30 flex-shrink-0">{key}</span>
                <span className="text-sm text-white/80 text-right">{value || "—"}</span>
              </div>
            ))}
        </div>
      )}

      {/* Raw JSON */}
      <button
        onClick={() => setShowRaw(!showRaw)}
        className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/20 hover:text-white/40 transition-colors"
      >
        {showRaw ? "Hide" : "View"} raw JSON
      </button>
      {showRaw && (
        <pre className="mt-3 p-4 bg-white/3 border border-white/5 rounded-lg text-[11px] font-mono text-white/40 overflow-auto leading-relaxed max-h-64">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function ElectionDashboard() {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ data: CandidateData; id: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Featured matchup data
  const [balenData, setBalenData] = useState<CandidateData | null>(null);
  const [oliData, setOliData] = useState<CandidateData | null>(null);

  // Load featured matchup on mount
  useEffect(() => {
    async function loadFeatured() {
      try {
        const [b, o] = await Promise.all([
          fetch("/api/candidate/125").then(r => r.json()),
          fetch("/api/candidate/122").then(r => r.json()),
        ]);
        setBalenData(b);
        setOliData(o);
      } catch (e) {
        console.error("Failed to load featured matchup", e);
      }
    }
    loadFeatured();
  }, []);

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    const id = resolveId(trimmed);
    if (!id) {
      setSearchError(`Could not find a candidate named "${trimmed}". Try "Balen Shah", "KP Oli", or a numeric ID.`);
      setSearchResult(null);
      return;
    }

    setSearching(true);
    setSearchError(null);
    setSearchResult(null);

    try {
      const res = await fetch(`/api/candidate/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CandidateData = await res.json();
      if (Object.keys(json).length === 0) throw new Error("No data found for this candidate.");
      setSearchResult({ data: json, id });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#07070f] text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        body { font-family: 'Syne', sans-serif; }
        .mono { font-family: 'DM Mono', monospace; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.4s ease forwards; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { animation: spin 0.7s linear infinite; }
      `}</style>

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-indigo-600/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-[400px] h-[400px] bg-emerald-600/3 rounded-full blur-3xl" />
      </div>

      {/* ── HEADER ── */}
      <header className="relative border-b border-white/5 bg-white/[0.02] backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center gap-4 md:gap-0 md:justify-between">
          {/* Brand */}
          <div>
            <div className="mono text-[9px] tracking-[0.3em] uppercase text-white/25 mb-0.5">
              Nepal
            </div>
            <div className="text-lg font-extrabold tracking-tight text-white leading-none">
              Election <span className="text-indigo-400">Database</span>
            </div>
          </div>

          {/* Search bar — right side of header */}
          <div className="flex items-stretch gap-0 w-full md:w-auto">
            <input
              className="mono bg-white/5 border border-white/10 text-white text-sm px-4 py-2.5 rounded-l-lg outline-none placeholder-white/20 focus:border-white/25 focus:bg-white/8 transition-all w-full md:w-72"
              placeholder="Search by name or ID…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !searching && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="bg-white text-black mono text-xs font-bold tracking-widest uppercase px-5 py-2.5 rounded-r-lg hover:bg-white/90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              {searching ? (
                <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full spinner" />
              ) : "Go"}
            </button>
          </div>
        </div>

        {/* Hint */}
        <div className="max-w-6xl mx-auto px-4 md:px-8 pb-3">
          <p className="mono text-[10px] text-white/18 tracking-widest">
            Try: "Balen Shah", "KP Oli", or a numeric ID like 125
          </p>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="max-w-6xl mx-auto px-4 md:px-8 py-10">

        {/* Page title */}
        <div className="mb-10">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-none text-white mb-2">
            Election<br />
            <span className="text-white/30 font-light italic" style={{ fontFamily: "'Syne', sans-serif" }}>
              Results
            </span>
          </h1>
          <p className="mono text-xs text-white/25 tracking-wider mt-3">
            Powered by Ekantipur Election Data
          </p>
        </div>

        {/* ── Featured Matchup ── */}
        <MatchupCard balen={balenData} oli={oliData} />

        {/* ── Search error ── */}
        {searchError && (
          <div className="fade-up mb-6 rounded-xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-red-300 text-sm">
            ⚠ {searchError}
          </div>
        )}

        {/* ── Search result ── */}
        {searchResult && !searching && (
          <div className="fade-up">
            <p className="mono text-[10px] uppercase tracking-[0.25em] text-white/25 mb-4">
              Search Result
            </p>
            <CandidateCard data={searchResult.data} id={searchResult.id} />
          </div>
        )}

        {/* ── Empty prompt ── */}
        {!searchResult && !searchError && !searching && (
          <div className="text-center py-16 text-white/10 italic text-lg">
            Search for any candidate above to see their profile
          </div>
        )}

        {/* ── Loading ── */}
        {searching && (
          <div className="flex flex-col items-center py-20 gap-4">
            <div className="w-8 h-8 border-2 border-white/10 border-t-white/60 rounded-full spinner" />
            <p className="mono text-[11px] uppercase tracking-widest text-white/25 animate-pulse">
              Fetching profile…
            </p>
          </div>
        )}
      </main>
    </div>
  );
}