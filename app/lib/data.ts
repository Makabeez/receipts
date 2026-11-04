import calls from "../data/calls.json";
import prices from "../data/prices.json";
import resolutions from "../data/resolutions.json";
import scores from "../data/scores.json";
import sui from "../data/sui_receipts.json";
import tatumProof from "../data/tatum_proof.json";

export const ACCOUNT_ID = "0xedc0baac5f3ac60e536615d94766e1888c9ff1523d7af8e0693bfe7e937aad59";
export const OWNER = "0xf46b1a404ccdba84f5edf87cfdd1d3e582abd0f28f9edd9d996af5c418da9024";
// Earliest US poll closings on Nov 3 2026 (parts of Indiana and Kentucky), in UTC.
export const POLLS_CLOSE = "2026-11-03T23:00:00Z";

type Call = { id: string; source: string; source_url: string; market_slug: string; outcome: string; p: number | null; said_at: string; quote?: string };
type SuiRow = { kind: string; id: string; blob_id: string; time?: string; tx?: string; object_id?: string; end_epoch?: number; certified_epoch?: number };
type Scored = { call_id: string; edge: number; won: number; brier_voice: number; brier_market: number };
type VoiceStats = { n: number; mean_edge: number; lo90: number | null; hi90: number | null; verdict: string; beat_market: number; trust_blob?: string | null };

export type Receipt = {
  id: string;
  voice: string;
  sourceUrl: string;
  quote?: string;
  saidAt: string;
  pick: string;
  p: number;
  market: number;
  blobId?: string;
  tx?: string;
  objectId?: string;
  certifiedAt?: string;
  endEpoch?: number;
  edge?: number;
  won?: boolean;
  tatumCheckpoint?: string;
  tatumAt?: string;
};

export type Race = {
  slug: string;
  question: string;
  marketAtLog: number;
  marketAt: string;
  outcome: "Yes" | "No" | null;
  oddsBlob?: string;
  oddsTx?: string;
  receipts: Receipt[];
};

export type Voice = { name: string; n: number; meanEdge: number; lo: number | null; hi: number | null; verdict: string; beat: number; trustBlob?: string | null };

const tatumById = new Map(((tatumProof as { receipts?: { id: string; tatum?: { checked?: boolean; checkpoint?: string; timestamp?: string } }[] }).receipts ?? [])
  .filter((r) => r.tatum?.checked)
  .map((r) => [r.id, r.tatum as { checkpoint?: string; timestamp?: string }]));
const suiById = new Map((sui as SuiRow[]).map((r) => [r.id, r]));
const scoredById = new Map(((scores as { calls: Scored[] }).calls ?? []).map((c) => [c.call_id, c]));
const res = (resolutions as { markets: Record<string, { question: string; uma: string; prices: Record<string, number> }> }).markets;
const px = prices as { fetched_at: string; markets: Record<string, { question: string; prices: Record<string, number> }> };

function outcomeOf(slug: string): "Yes" | "No" | null {
  const r = res[slug];
  if (!r || r.uma !== "resolved") return null;
  const y = r.prices.Yes;
  return y >= 0.99 ? "Yes" : y <= 0.01 ? "No" : null;
}

export function races(): Race[] {
  const slugs = [...new Set((calls as Call[]).map((c) => c.market_slug))];
  return slugs.map((slug) => {
    const odds = suiById.get(slug);
    const receipts: Receipt[] = (calls as Call[])
      .filter((c) => c.market_slug === slug && c.p !== null)
      .map((c) => {
        const s = suiById.get(c.id);
        const sc = scoredById.get(c.id);
        return {
          id: c.id, voice: c.source, sourceUrl: c.source_url, quote: c.quote, saidAt: c.said_at, pick: c.outcome,
          p: c.p as number, market: px.markets[slug].prices[c.outcome],
          blobId: s?.blob_id, tx: s?.tx, objectId: s?.object_id, certifiedAt: s?.time, endEpoch: s?.end_epoch,
          edge: sc?.edge, won: sc ? sc.won === 1 : undefined,
          tatumCheckpoint: tatumById.get(c.id)?.checkpoint, tatumAt: tatumById.get(c.id)?.timestamp,
        };
      });
    return {
      slug, question: px.markets[slug].question, marketAtLog: px.markets[slug].prices.Yes, marketAt: px.fetched_at,
      outcome: outcomeOf(slug), oddsBlob: odds?.blob_id, oddsTx: odds?.tx, receipts,
    };
  });
}

export function voices(): Voice[] {
  const v = (scores as { voices: Record<string, VoiceStats> }).voices ?? {};
  return Object.entries(v)
    .map(([name, s]) => ({ name, n: s.n, meanEdge: s.mean_edge, lo: s.lo90, hi: s.hi90, verdict: s.verdict, beat: s.beat_market, trustBlob: s.trust_blob }))
    .sort((a, b) => b.meanEdge - a.meanEdge);
}

function saidRange() {
  const ds = [...new Set((calls as Call[]).map((c) => c.said_at))].sort();
  const f = (d: string) => utc(`${d}T12:00:00Z`).split(",")[0];
  return ds.length === 1 ? `on ${f(ds[0])}` : `between ${f(ds[0])} and ${f(ds[ds.length - 1])}`;
}

export function summary() {
  const all = (sui as SuiRow[]).filter((r) => r.time);
  const times = all.map((r) => Date.parse(r.time as string)).sort((a, b) => a - b);
  const last = times[times.length - 1];
  const hoursBefore = Math.floor((Date.parse(POLLS_CLOSE) - last) / 3_600_000);
  const s = scores as { model?: { note?: string; k?: number | null }; pending?: string[]; resolutions_seen?: string; generated_at?: string };
  return {
    memories: (sui as SuiRow[]).length,
    callsLogged: (calls as Call[]).length,
    firstCertified: new Date(times[0]).toISOString(),
    lastCertified: new Date(last).toISOString(),
    hoursBefore,
    pending: s.pending ?? [],
    modelNote: s.model?.note ?? "",
    k: s.model?.k ?? null,
    resolutionsSeen: s.resolutions_seen,
    snapshots: (sui as SuiRow[]).filter((r) => r.kind === "odds").length,
    marketAt: px.fetched_at,
    saidRange: saidRange(),
    lagDays: Math.max(...(calls as Call[]).map((c) => Math.ceil((Date.parse(px.fetched_at) - Date.parse(`${c.said_at}T23:59:59Z`)) / 86_400_000))),
  };
}

export const links = {
  tx: (d: string) => `https://suiscan.xyz/mainnet/tx/${d}`,
  object: (id: string) => `https://suiscan.xyz/mainnet/object/${id}`,
  account: (id: string) => `https://suiscan.xyz/mainnet/object/${id}`,
  blob: (b: string) => `https://walruscan.com/mainnet/blob/${b}`,
};

export function short(s: string, head = 6, tail = 4) {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function utc(iso: string) {
  const d = new Date(iso);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`;
}
