"use client";

import { useState } from "react";
import type { Race, Receipt } from "../../lib/data";
import Stamp, { stampKind } from "./Stamp";

type Live = { owner: string; ownerIsAccountOwner: boolean; blobMatches: boolean; certifiedEpoch: number; endEpoch: number; checkedAt: string; via: string } | { error: string };

const sui = (d: string) => `https://suiscan.xyz/mainnet/tx/${d}`;
const obj = (id: string) => `https://suiscan.xyz/mainnet/object/${id}`;
const blob = (b: string) => `https://walruscan.com/mainnet/blob/${b}`;
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const p100 = (v: number) => `${(v * 100).toFixed(1)}%`;

function when(iso: string) {
  const d = new Date(iso);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`;
}

function Proof({ r }: { r: Receipt }) {
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!r.objectId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proof?object=${r.objectId}`);
      setLive(await res.json());
    } catch {
      setLive({ error: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="proof">
      <dl>
        <dt>Said</dt>
        <dd>{r.saidAt}{r.quote ? `, “${r.quote}”` : ""} (<a href={r.sourceUrl} target="_blank" rel="noreferrer">source</a>)</dd>
        <dt>Remembered</dt>
        <dd>{r.blobId ? <a href={blob(r.blobId)} target="_blank" rel="noreferrer">Walrus blob {short(r.blobId)}</a> : "not found"}</dd>
        <dt>Certified on Sui</dt>
        <dd>{r.certifiedAt && r.tx ? <>{when(r.certifiedAt)}, <a href={sui(r.tx)} target="_blank" rel="noreferrer">tx {short(r.tx)}</a></> : "not found"}</dd>
        {r.tatumCheckpoint && r.tatumAt && (<><dt>Via Tatum</dt><dd>confirmed through Tatum&apos;s Sui gateway: checkpoint {r.tatumCheckpoint}, {when(r.tatumAt)}</dd></>)}
        {r.edge !== undefined && (<><dt>Score</dt><dd>edge {Math.abs(r.edge) < 0.0005 ? "±0.0" : `${r.edge > 0 ? "+" : "−"}${Math.abs(r.edge * 100).toFixed(1)}`} vs the market</dd></>)}
      </dl>
      {r.objectId && (
        <button className="check" onClick={check} disabled={busy}>
          {busy ? "Checking Sui…" : "Check this receipt on Sui now"}
        </button>
      )}
      {live && ("error" in live ? (
        <p className="live live-err" role="status">{live.error}</p>
      ) : (
        <p className="live" role="status">
          Live from {live.via}: <a href={obj(r.objectId as string)} target="_blank" rel="noreferrer">Blob object {short(r.objectId as string)}</a> exists,{" "}
          {live.blobMatches ? "holds this exact blob" : "holds a different blob"}, is{" "}
          {live.ownerIsAccountOwner ? "owned by the Receipts wallet" : `owned by ${short(live.owner)}`}, certified in Walrus epoch {live.certifiedEpoch} and stored until epoch {live.endEpoch}.
        </p>
      ))}
    </div>
  );
}

export default function RaceSlips({ races }: { races: Race[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="slips">
      {races.map((race, i) => (
        <article key={race.slug} className="slip" style={{ ["--tilt" as string]: `${[-0.6, 0.4, -0.3, 0.7, -0.5][i % 5]}deg` }}>
          <header>
            <h3>{race.question.replace(/\?$/, "")}?</h3>
            <p className="slip-meta">
              Market at logging: {p100(race.marketAtLog)} yes
              <br />
              {race.outcome ? `Resolved: ${race.outcome}` : "Not final yet"}
            </p>
          </header>
          <ul>
            {race.receipts.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id} className={isOpen ? "open" : ""}>
                  <button className="line" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                    <span className="who">{r.voice}</span>
                    <span className="num">{p100(r.p)}</span>
                    <Stamp kind={race.outcome ? stampKind(r.edge) : "pending"} tilt={[-6, -3, -8][r.id.length % 3]} />
                  </button>
                  {isOpen && <Proof r={r} />}
                </li>
              );
            })}
          </ul>
          <footer>
            {race.oddsBlob && race.oddsTx ? (
              <>Market snapshot <a href={blob(race.oddsBlob)} target="_blank" rel="noreferrer">{short(race.oddsBlob)}</a>, <a href={sui(race.oddsTx)} target="_blank" rel="noreferrer">on Sui</a></>
            ) : "Market snapshot not found"}
          </footer>
        </article>
      ))}
    </div>
  );
}
