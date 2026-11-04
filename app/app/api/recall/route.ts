import { NextResponse } from "next/server";
import { MemWal } from "@mysten-incubation/memwal";
import { ACCOUNT_ID } from "../../../lib/data";

// Search what Receipts remembers, straight from Walrus Memory on Mainnet.
// MEMWAL_KEY is a delegate key held in server env only, never sent to the browser. Delegate keys can also write:
// use a separate key registered for this site, and revoke it after judging.
const NAMESPACES = ["receipts-trust", "receipts-calls"] as const;
const hits = new Map<string, { n: number; t: number }>();

function limited(ip: string) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 10;
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 200) return NextResponse.json({ error: "Ask a question between 3 and 200 characters." }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return NextResponse.json({ error: "Too many searches. Wait a minute and try again." }, { status: 429 });

  const key = process.env.MEMWAL_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID ?? ACCOUNT_ID;
  if (!key) return NextResponse.json({ error: "Memory search isn't configured on this deployment (MEMWAL_KEY)." }, { status: 503 });

  try {
    const results = await Promise.all(NAMESPACES.map(async (namespace) => {
      const memwal = MemWal.create({ key, accountId, serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz", namespace });
      const r = await memwal.recall({ query: q, limit: 5, namespace });
      return r.results.map((m) => ({ namespace, blobId: m.blob_id, text: m.text, distance: m.distance }));
    }));
    const merged = results.flat().sort((a, b) => a.distance - b.distance).slice(0, 6);
    return NextResponse.json({ query: q, from: "Walrus Memory (Mainnet)", results: merged });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Walrus Memory didn't answer: ${msg.slice(0, 160)}` }, { status: 502 });
  }
}
