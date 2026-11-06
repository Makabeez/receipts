// Turns a question about Receipts into a one-sentence answer, and memory records into readable lines.
// The answer is built from the same scores and trust profiles that score.py wrote to Walrus Memory
// (data/scores.json is that run's report), and it cites the trust profile's blob.
import prices from "../data/prices.json";
import resolutions from "../data/resolutions.json";
import scores from "../data/scores.json";
import sui from "../data/sui_receipts.json";

type VoiceStats = { n: number; mean_edge: number; lo90: number | null; hi90: number | null; beat_market: number; verdict: string; trust_blob?: string | null; trust_version?: number };
type Scored = { call_id: string; voice: string; slug: string; question: string; pick: string; p: number; market: number; won: number; edge: number };
type Res = { question: string; uma: string | null; prices: Record<string, number> };

export type Answer = { text: string; detail: string[]; basis?: { label: string; blob: string } };
export type Readable = { kind: string; title: string; line: string };

const S = scores as { voices: Record<string, VoiceStats>; calls: Scored[]; model?: { calls?: number } };
const RES = (resolutions as { markets: Record<string, Res> }).markets;
const PX = (prices as { markets: Record<string, { question: string; prices: Record<string, number> }> }).markets;
const SUI = sui as { id: string; blob_id: string }[];

const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const shortVoice = (v: string) => v.replace(/\s*\(.*\)$/, "");

/** "Will the Republicans win the Kansas Senate race in 2026?" -> "Kansas Senate"; control markets -> "Senate control". */
export function raceLabel(question: string) {
  const win = question.match(/win the (.+?) (Senate|House) race/i);
  if (win) return `${win[1]} ${win[2]}`;
  const ctl = question.match(/control the (Senate|House)/i);
  if (ctl) return `${ctl[1]} control`;
  return question.replace(/\?$/, "");
}

const VOICE_PATTERNS: [RegExp, string][] = [
  [/decision desk|ddhq/i, "Decision Desk HQ"],
  [/silver|\bnate\b/i, "Silver Bulletin (Nate Silver)"],
  [/vote ?hub/i, "VoteHub"],
];
const RACE_PATTERNS: [RegExp, string][] = Object.keys(PX).flatMap((slug) => {
  const label = raceLabel(PX[slug].question);
  const state = label.replace(/ (Senate|House|control)$/, "");
  if (/control$/.test(label)) return [[new RegExp(`\\b${state}\\b(?!.*\\brace\\b)`, "i"), slug] as [RegExp, string]];
  return [[new RegExp(state === "South Carolina" ? "south carolina|\\bsc\\b" : `\\b${state}\\b`, "i"), slug] as [RegExp, string]];
});

function outcomeOf(slug: string): "Yes" | "No" | null {
  const r = RES[slug];
  if (!r || r.uma !== "resolved") return null;
  return r.prices.Yes >= 0.99 ? "Yes" : r.prices.Yes <= 0.01 ? "No" : null;
}

function interval(v: VoiceStats) {
  return v.lo90 === null || v.hi90 === null ? "not computable yet" : `${pts(v.lo90)} to ${pts(v.hi90)} points`;
}

function voiceAnswer(name: string): Answer | null {
  const v = S.voices[name];
  if (!v) return null;
  const who = shortVoice(name), m = v.mean_edge;
  const calls = `${v.beat_market} of ${v.n} call${v.n === 1 ? "" : "s"}`;
  let text: string, why: string;
  if (v.verdict === "beats the market") {
    text = `${who} beat the market on ${calls} and leads it by ${pts(m).slice(1)} points on average, so Receipts trusts it over the market.`;
    why = `The whole 90% interval is above zero: ${interval(v)}.`;
  } else if (v.verdict === "worse than the market") {
    text = `${who} beat the market on ${calls} and trails it by ${pts(m).slice(1)} points on average, so Receipts trusts the market over it.`;
    why = `The whole 90% interval is below zero: ${interval(v)}.`;
  } else if (m < 0) {
    text = `${who} beat the market on ${calls} and trails it by ${pts(m).slice(1)} points on average, so Receipts trusts the market over it.`;
    why = `With ${v.n} call${v.n === 1 ? "" : "s"}, that gap can't yet be told apart from luck: the 90% interval runs from ${interval(v)}.`;
  } else {
    text = `${who} beat the market on ${calls}, ${pts(m)} points on average, but that's too few calls to trust it over the market yet.`;
    why = `The 90% interval still includes zero: ${interval(v)}.`;
  }
  const detail = [why];
  if ((v.trust_version ?? 1) > 1) detail.push(`This is trust profile v${v.trust_version}; it supersedes v${(v.trust_version ?? 2) - 1}, which stays in memory.`);
  return { text, detail, basis: v.trust_blob ? { label: `Trust profile v${v.trust_version ?? 1} in Walrus Memory`, blob: v.trust_blob } : undefined };
}

function raceAnswer(slug: string): Answer {
  const q = PX[slug].question, label = raceLabel(q), yes = PX[slug].prices.Yes, out = outcomeOf(slug);
  const claim = q.replace(/^Will (the )?/i, "").replace(/\?$/, "");
  const lead = `Polymarket priced "${claim}" at ${pct(yes)} when Receipts logged it`;
  const text = out ? `${lead}, and it ${out === "Yes" ? "happened" : "didn't happen"}.` : `${lead}; the result isn't final yet.`;
  const detail = S.calls.filter((c) => c.slug === slug).map((c) =>
    `${shortVoice(c.voice)} said ${pct(c.p)} ${c.pick}: ${c.edge >= 0 ? "beat the market by" : "lost to the market by"} ${pts(c.edge).slice(1)} points.`);
  const snap = SUI.find((r) => r.id === slug);
  return { text, detail: detail.length ? detail : [`No voice made a call on ${label}.`], basis: snap ? { label: "Market snapshot in Walrus Memory", blob: snap.blob_id } : undefined };
}

function beatAnswer(): Answer {
  const beat = S.calls.filter((c) => c.edge > 0).sort((a, b) => b.edge - a.edge);
  return {
    text: `${beat.length} of ${S.calls.length} scored calls beat the market price at the moment they were made.`,
    detail: beat.map((c) => `${shortVoice(c.voice)} on ${raceLabel(c.question)}: said ${pct(c.p)} ${c.pick} vs ${pct(c.market)}, ${pts(c.edge)} points.`),
  };
}

function trustAnswer(): Answer {
  const ranked = Object.entries(S.voices).sort((a, b) => b[1].mean_edge - a[1].mean_edge);
  const beats = ranked.filter(([, v]) => v.verdict === "beats the market");
  if (beats.length) {
    const [name, v] = beats[0];
    return { text: `Trust ${shortVoice(name)}: it beats the market by ${pts(v.mean_edge).slice(1)} points on average over ${v.n} calls.`, detail: [] };
  }
  const [top, tv] = ranked[0];
  return {
    text: `Nobody has beaten the market clearly enough to trust over it yet, so Receipts trusts the market.`,
    detail: [
      `${shortVoice(top)} leads at ${pts(tv.mean_edge)} points over ${tv.n} call${tv.n === 1 ? "" : "s"}, but across ${S.calls.length} scored calls the gap between voices is smaller than the noise.`,
      ...ranked.map(([n, v]) => `${shortVoice(n)}: ${pts(v.mean_edge)} points, beat the market on ${v.beat_market} of ${v.n}.`),
    ],
  };
}

/** One-sentence answer for the question, or null when the question isn't one Receipts can answer from its records. */
export function answer(question: string): Answer | null {
  const q = question.toLowerCase();
  const voice = VOICE_PATTERNS.find(([re]) => re.test(q))?.[1];
  if (voice) return voiceAnswer(voice);
  const race = RACE_PATTERNS.find(([re]) => re.test(q))?.[1];
  if (race) return raceAnswer(race);
  if (/\bbeat|\bbest call|\bwinning call|\bright\b/.test(q)) return beatAnswer();
  if (/trust|listen|rank|best|who.*(right|good)|leader/.test(q)) return trustAnswer();
  return null;
}

/** Memory record text -> a title and one readable line. Records are "kind ... · key=value · ..." strings. */
export function readable(text: string): Readable {
  const parts = text.split(" · ");
  const head = parts[0], kind = head.split(" ")[0];
  const kv: Record<string, string> = {};
  for (const p of parts) { const m = p.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
  const question = parts.find((p) => p.trim().endsWith("?")) ?? "";
  const race = question ? raceLabel(question) : "";
  const num = (k: string) => Number((kv[k] ?? "").split(" ")[0]);
  switch (kind) {
    case "trust": {
      const name = head.replace(/^trust /, "");
      const ver = parts.find((p) => /^v\d+$/.test(p)) ?? "v1";
      return { kind, title: `Trust profile ${ver} · ${shortVoice(name)}`, line: `Beat the market on ${(kv.beat_market ?? "?").replace("/", " of ")} calls, ${pts(num("mean_edge"))} points on average: ${kv.verdict ?? ""}${kv.supersedes && kv.supersedes !== "none" ? `. Supersedes ${kv.supersedes.split(" ")[0]}` : ""}.` };
    }
    case "score": {
      const voice = parts[1] ?? "";
      return { kind, title: `Score · ${shortVoice(voice)} · ${race}`, line: `Said ${pct(num("p"))} ${kv.pick}, market ${pct(num("market"))}; it ${kv.result === "right" ? "happened" : "didn't happen"}. Edge ${pts(num("edge"))} points.` };
    }
    case "result":
      return { kind, title: `Result · ${race}`, line: `Resolved ${kv.outcome} on Polymarket (UMA final).` };
    case "model":
      return { kind, title: "Model", line: `${kv.calls} calls from ${kv.voices} voices: ${parts.find((p) => p.startsWith("no voice") || p.startsWith("some voice")) ?? "shrinkage estimate"}.` };
    case "call": {
      const voice = parts[2] ?? "";
      return { kind, title: `Receipt · ${shortVoice(voice)} · ${race}`, line: `Said ${pct(num("p"))} ${kv.pick} on ${kv.said}, with the market at ${pct(num("market"))}. Logged before the vote.` };
    }
    case "odds":
      return { kind, title: `Market snapshot · ${race}`, line: `Polymarket: ${pct(num("Yes"))} Yes at ${(kv.market_at ?? "").replace("T", " ").replace(":00Z", " UTC").replace("Z", " UTC")}.` };
    default:
      return { kind, title: kind, line: text.slice(0, 160) };
  }
}
