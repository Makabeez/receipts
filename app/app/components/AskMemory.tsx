"use client";

import { useState } from "react";

type Hit = { namespace: string; blobId: string; text: string; distance: number; kind: string; title: string; line: string };
type Answer = { text: string; detail: string[]; basis?: { label: string; blob: string } };
const SUGGESTED = ["Why isn't Decision Desk HQ trusted more?", "Who should I trust?", "Which calls beat the market?", "What did the market say about Kansas?"];
const blobUrl = (b: string) => `https://walruscan.com/mainnet/blob/${b}`;
const shortBlob = (b: string) => `${b.slice(0, 6)}…${b.slice(-4)}`;

export default function AskMemory() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [ans, setAns] = useState<Answer | null>(null);
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
      if (!r.ok) { setErr(body.error); setHits(null); setAns(null); }
      else { setHits(body.results); setAns(body.answer ?? null); }
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <form onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <label htmlFor="ask-input" className="ask-label">Ask what Receipts remembers</label>
        <div className="ask-row">
          <input id="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a voice, a race or a result" maxLength={200} />
          <button type="submit" disabled={busy}>{busy ? "Searching…" : "Ask"}</button>
        </div>
      </form>
      <div className="ask-suggest">
        {SUGGESTED.map((s) => <button key={s} type="button" onClick={() => search(s)}>{s}</button>)}
      </div>
      {err && <p className="live live-err" role="status">{err}</p>}
      {hits && (
        <div className="answer-wrap" aria-live="polite">
          {ans ? (
            <div className="answer">
              <p className="answer-text">{ans.text}</p>
              {ans.detail.length > 0 && <ul className="answer-detail">{ans.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
              {ans.basis && <p className="answer-basis">Source: <a href={blobUrl(ans.basis.blob)} target="_blank" rel="noreferrer">{ans.basis.label}, blob {shortBlob(ans.basis.blob)}</a></p>}
            </div>
          ) : (
            <p className="answer answer-none">Receipts has no direct answer to that, but here are the closest records in its memory.</p>
          )}
          <h3 className="hits-title">{hits.length ? `${hits.length} records from Walrus Memory` : "Nothing in memory matches that yet."}</h3>
          <ol className="hits">
            {hits.map((h) => (
              <li key={h.blobId + h.namespace}>
                <p className="hit-title"><span className={`hit-kind k-${h.kind}`}>{h.kind}</span>{h.title}</p>
                <p className="hit-line">{h.line}</p>
                <details>
                  <summary>Raw record</summary>
                  <p className="hit-raw">{h.text}</p>
                </details>
                <span className="hit-meta">
                  {h.namespace} · <a href={blobUrl(h.blobId)} target="_blank" rel="noreferrer">blob {shortBlob(h.blobId)}</a>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
