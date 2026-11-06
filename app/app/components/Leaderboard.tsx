"use client";

import { useState } from "react";
import type { Voice } from "../../lib/data";

const SPAN = 0.22; // edge axis runs from -SPAN to +SPAN
const W = 640, LEFT = 210, RIGHT = 24, ROW = 56, TOP = 36;

function x(v: number) {
  const c = Math.max(-SPAN, Math.min(SPAN, v));
  return LEFT + ((c + SPAN) / (2 * SPAN)) * (W - LEFT - RIGHT);
}

function pct(v: number) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}`;
}

export default function Leaderboard({ voices, scoredCalls, resolved, afterLabel }: { voices: Voice[]; scoredCalls: number; resolved: number; afterLabel: string }) {
  const [after, setAfter] = useState(true);
  const H = TOP + voices.length * ROW + 30;
  return (
    <div className="board">
      <div className="toggle" role="tablist" aria-label="Show the ranking">
        <button role="tab" aria-selected={!after} className={!after ? "on" : ""} onClick={() => setAfter(false)}>
          Nov 1, before the vote
        </button>
        <button role="tab" aria-selected={after} className={after ? "on" : ""} onClick={() => setAfter(true)}>
          {afterLabel}, after {resolved} results
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="edgechart" role="img"
        aria-label={after ? "Each voice's edge over the market, with a 90% interval" : "No voice has a record yet"}>
        <line x1={x(0)} x2={x(0)} y1={TOP - 14} y2={H - 22} className="axis-zero" />
        <text x={x(0)} y={TOP - 20} textAnchor="middle" className="axis-label">the market</text>
        <text x={x(-SPAN)} y={H - 6} className="axis-note">market was closer</text>
        <text x={x(SPAN)} y={H - 6} textAnchor="end" className="axis-note">beat the market</text>
        {voices.map((v, i) => {
          const cy = TOP + i * ROW + ROW / 2;
          const lo = v.lo ?? v.meanEdge, hi = v.hi ?? v.meanEdge;
          return (
            <g key={v.name} className="vrow">
              <text x={0} y={cy - 4} className="vname">{v.name}</text>
              <text x={0} y={cy + 14} className="vmeta">
                {after ? `${v.n} scored call${v.n === 1 ? "" : "s"}, beat the market ${v.beat}/${v.n}` : "no scored calls yet"}
              </text>
              <line x1={after ? x(lo) : x(0)} x2={after ? x(hi) : x(0)} y1={cy} y2={cy} className="whisker" />
              <circle cx={after ? x(v.meanEdge) : x(0)} cy={cy} r={8} className={after ? `dot ${v.meanEdge > 1e-9 ? "pos" : v.meanEdge < -1e-9 ? "neg" : ""}` : "dot empty"} />
              {after && (
                <text x={x(v.meanEdge)} y={cy - 13} textAnchor="middle" className="dotlabel">{pct(v.meanEdge)}</text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="board-note">
        {after
          ? `Edge is the market's Brier score minus the voice's, ×100, averaged over ${scoredCalls} scored calls. The bar is a 90% interval. ${
              voices.every((v) => (v.lo ?? 0) <= 0 && (v.hi ?? 0) >= 0)
                ? `Every interval still crosses the market line, so Receipts keeps weighting all ${voices.length} voices like the market until one of them clears it.`
                : "A voice whose whole interval sits on one side of the market line gets weighted up or down in the consensus."
            }`
          : "Before any race resolves, every voice starts level with the market. Receipts only moves a voice once it has been scored."}
      </p>
    </div>
  );
}
