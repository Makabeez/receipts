"use client";

import { useState } from "react";

type Hit = { namespace: string; blobId: string; text: string; distance: number };
const SUGGESTED = ["Why isn't Decision Desk HQ trusted more?", "What did the market say about Kansas?", "Which calls beat the market?"];

export default function AskMemory() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(query: string) {
    const text = query.trim();
    if (text.length < 3) return;
    setQ(text);
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/recall?q=${encodeURIComponent(text)}`);
      const body = await r.json();
      if (!r.ok) { setErr(body.error); setHits(null); } else setHits(body.results);
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <form onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <label htmlFor="ask-input" className="ask-label">Search what Receipts remembers</label>
        <div className="ask-row">
          <input id="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a voice, a race or a result" maxLength={200} />
          <button type="submit" disabled={busy}>{busy ? "Searching…" : "Search memory"}</button>
        </div>
      </form>
      <div className="ask-suggest">
        {SUGGESTED.map((s) => <button key={s} type="button" onClick={() => search(s)}>{s}</button>)}
      </div>
      {err && <p className="live live-err" role="status">{err}</p>}
      {hits && (
        <ol className="hits">
          {hits.length === 0 && <li>Nothing in memory matches that yet.</li>}
          {hits.map((h) => (
            <li key={h.blobId + h.namespace}>
              <p>{h.text}</p>
              <span className="hit-meta">
                {h.namespace}, <a href={`https://walruscan.com/mainnet/blob/${h.blobId}`} target="_blank" rel="noreferrer">blob {h.blobId.slice(0, 6)}…{h.blobId.slice(-4)}</a>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
