#!/usr/bin/env python3
"""Receipts — score logged calls once their markets resolve, and remember the result.

For every market whose Polymarket resolution is final, this script writes to
Walrus Memory (namespace `receipts-trust`):

  result     one per market: the outcome and where it came from
  score      one per call: the voice's probability vs the market price at log time
  trust      one per voice: n, mean edge, a 90% interval and a verdict; a new
             version supersedes the previous one (append-only, never edited)
  model      one per run: the shrinkage estimate across all voices

Edge per call (Brier, higher is better for the voice):
    edge = (market - outcome)^2 - (p - outcome)^2

A voice only gets the "beats the market" verdict when the lower end of its 90%
interval is above zero. Until then Receipts weights it like the market.

Default is a dry run. --write writes to Mainnet, --mock tests the write path.
State in scored.json makes reruns idempotent: only new results and changed
trust profiles are written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics as st
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NAMESPACE = "receipts-trust"
EVENT_TAG = "midterms-2026"
GAMMA = "https://gamma-api.polymarket.com/markets"
Z90 = 1.645


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def jload(p: Path, default=None):
    return json.loads(p.read_text()) if p.exists() else default


def read_ledger(p: Path) -> dict[str, str]:
    """call_id -> receipt blob_id, from log_calls.py's mainnet ledger."""
    out = {}
    for line in p.read_text().splitlines():
        r = json.loads(line)
        if r.get("kind") == "call" and r.get("status") == "done" and r.get("mode", "mainnet") == "mainnet":
            out[r["call_id"]] = r["blob_id"]
    return out


def fetch_resolution(slug: str) -> dict:
    for extra in ({}, {"closed": "true"}):
        url = f"{GAMMA}?{urllib.parse.urlencode({'slug': slug, **extra})}"
        req = urllib.request.Request(url, headers={"User-Agent": "receipts-total-recall/0.1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.load(r)
        if rows:
            m = rows[0]
            outcomes = json.loads(m["outcomes"]) if isinstance(m["outcomes"], str) else m["outcomes"]
            prices = json.loads(m["outcomePrices"]) if isinstance(m["outcomePrices"], str) else m["outcomePrices"]
            return {"question": m.get("question", slug), "uma": m.get("umaResolutionStatus"),
                    "closed": bool(m.get("closed")), "prices": {o: float(p) for o, p in zip(outcomes, prices)}}
    raise ValueError(f"no Polymarket market '{slug}'")


def final_outcome(r: dict) -> int | None:
    """1/0 for the 'Yes' side once UMA has resolved it, else None."""
    if r.get("uma") != "resolved":
        return None
    y = r["prices"].get("Yes")
    if y is None:
        return None
    return 1 if y >= 0.99 else 0 if y <= 0.01 else None


def t90(df: int) -> float:
    """Two-sided 90% Student-t quantile; the pooled variance has few degrees of freedom."""
    table = {1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833,
             10: 1.812, 12: 1.782, 15: 1.753, 20: 1.725, 30: 1.697}
    if df >= 30:
        return Z90 if df > 120 else 1.697
    return table.get(df) or table[max(k for k in table if k <= df)]


def voice_stats(edges: dict[str, list[float]]) -> tuple[dict, dict]:
    """Per-voice edge vs the market (0 = the market), pooled noise, and shrinkage toward the market."""
    multi = [e for e in edges.values() if len(e) > 1]
    df = sum(len(e) - 1 for e in multi)
    sigma2 = (sum((len(e) - 1) * st.variance(e) for e in multi) / df) if multi else None
    model = {"voices": len(edges), "calls": sum(map(len, edges.values())), "sigma2_within": sigma2, "df": df,
             "tau2": None, "k": None, "note": ""}
    if sigma2 is not None:
        means = [st.mean(e) for e in edges.values()]
        # Spread of true edges around the market (0), not around the voices' grand mean: shrinkage pulls toward 0.
        tau2 = st.mean([m * m for m in means]) - st.mean([sigma2 / len(e) for e in edges.values()])
        model["tau2"] = tau2
        model["k"] = sigma2 / tau2 if tau2 > 0 else math.inf
    tq = t90(df) if df else None
    out = {}
    for v, e in edges.items():
        n, mean = len(e), st.mean(e)
        se = math.sqrt(sigma2 / n) if sigma2 else None
        lo, hi = (mean - tq * se, mean + tq * se) if se else (None, None)
        k = model["k"]
        shrunk = 0.0 if k in (None, math.inf) else sum(e) / (n + k)
        verdict = ("beats the market" if lo is not None and lo > 0 else
                   "worse than the market" if hi is not None and hi < 0 else "not yet distinguishable")
        out[v] = {"n": n, "mean_edge": mean, "lo90": lo, "hi90": hi, "trust": shrunk,
                  "beat_market": sum(x > 0 for x in e), "verdict": verdict}
    if out and all(s["verdict"] == "not yet distinguishable" for s in out.values()):
        model["note"] = "no voice is yet distinguishable from the market; trusted consensus defers to the market"
    elif model["k"] in (None, math.inf):
        model["note"] = "voices differ from the market but not from each other yet; weights stay equal"
    return out, model


def fmt(x, nd=3, signed=True):
    if x is None:
        return "n/a"
    if isinstance(x, float) and math.isinf(x):
        return "inf"
    return f"{x:+.{nd}f}" if signed else f"{x:.{nd}f}"


def load_credentials():
    import os
    key, acct = os.environ.get("MEMWAL_PRIVATE_KEY"), os.environ.get("MEMWAL_ACCOUNT_ID")
    url = os.environ.get("MEMWAL_SERVER_URL", "https://relayer.memory.walrus.xyz")
    if key and acct:
        return key, acct, url
    d = json.loads((Path.home() / ".memwal" / "credentials.json").read_text())
    return d["delegatePrivateKey"], d["accountId"], d.get("relayerUrl", url)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--calls", type=Path, default=Path("calls.json"))
    ap.add_argument("--prices", type=Path, default=Path("prices.json"), help="market prices at log time")
    ap.add_argument("--ledger", type=Path, default=Path("ledger.jsonl"))
    ap.add_argument("--sui", type=Path, default=Path("../sui-proof/sui_receipts.json"))
    ap.add_argument("--resolutions", type=Path, help="use a resolutions snapshot instead of fetching Polymarket")
    ap.add_argument("--snapshot-resolutions", type=Path, help="fetch resolutions, save them here, and stop")
    ap.add_argument("--state", type=Path, default=Path("scored.json"))
    ap.add_argument("--out", type=Path, default=Path("scores.json"))
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--write", action="store_true")
    g.add_argument("--mock", action="store_true")
    a = ap.parse_args()

    calls = json.loads(a.calls.read_text())
    logged_px = json.loads(a.prices.read_text())
    receipts = read_ledger(a.ledger) if a.ledger.exists() else {}
    sui = {r["id"]: r for r in (jload(a.sui, []) or [])}
    slugs = list(dict.fromkeys(c["market_slug"] for c in calls))
    seen = now_iso()

    if a.resolutions:
        snap = json.loads(a.resolutions.read_text())
        res, seen = dict(snap["markets"]), snap["fetched_at"]
    else:
        res, net_errors = {}, 0
        for s in slugs:
            try:
                res[s] = fetch_resolution(s)
            except OSError as e:
                net_errors += 1
                print(f"warning: could not fetch {s}: {e}")
            except (ValueError, KeyError, json.JSONDecodeError) as e:
                print(f"warning: {e}; treating {s} as pending")
        if net_errors == len(slugs):
            sys.exit("cannot reach Polymarket. Use a snapshot taken elsewhere: --resolutions resolutions.json")
    for s in slugs:  # a market missing from the source counts as pending, never as a crash
        res.setdefault(s, {"question": logged_px["markets"][s]["question"], "uma": None, "closed": False, "prices": {}})
    if a.snapshot_resolutions:
        a.snapshot_resolutions.write_text(json.dumps({"fetched_at": seen, "source": GAMMA, "markets": res}, indent=1))
        print(f"saved resolutions for {len(res)} markets to {a.snapshot_resolutions} ({seen})")
        return

    state = jload(a.state, {"written": {}, "trust_heads": {}})
    items, edges, scored_calls = [], {}, []

    for s in slugs:
        r = res[s]
        o = final_outcome(r)
        if o is None:
            print(f"pending  {r['question'][:70]} (uma={r.get('uma')})")
            continue
        key = f"result:{s}"
        if key not in state["written"]:
            items.append({"key": key, "kind": "result", "text":
                          f"result {EVENT_TAG} · {r['question']} · outcome={'Yes' if o else 'No'} · "
                          f"source=polymarket uma={r['uma']} · seen={seen} · slug={s}"})

    for c in calls:
        s = c["market_slug"]
        o = final_outcome(res[s])
        if o is None or c.get("p") is None:
            continue
        m = logged_px["markets"][s]["prices"][c["outcome"]]
        yes = 1 if c["outcome"] == "Yes" else 0
        win = int(o == yes)
        p = float(c["p"])
        bv, bm = (p - win) ** 2, (m - win) ** 2
        edge = bm - bv
        edges.setdefault(c["source"], []).append(edge)
        tx = sui.get(c["id"], {}).get("tx")
        row = {"call_id": c["id"], "voice": c["source"], "slug": s, "question": res[s]["question"],
               "pick": c["outcome"], "p": p, "market": m, "won": win, "brier_voice": bv, "brier_market": bm,
               "edge": edge, "receipt_blob": receipts.get(c["id"]), "sui_tx": tx, "said_at": c["said_at"]}
        scored_calls.append(row)
        key = f"score:{c['id']}"
        if key not in state["written"]:
            items.append({"key": key, "kind": "score", "text":
                          f"score {EVENT_TAG} {c['id']} · {c['source']} · {res[s]['question']} · pick={c['outcome']} · "
                          f"p={p:.3f} · market={m:.3f} · result={'right' if win else 'wrong'} · "
                          f"brier_voice={bv:.4f} · brier_market={bm:.4f} · edge={edge:+.4f} · "
                          f"receipt_blob={receipts.get(c['id'], 'n/a')} · sui_tx={tx or 'n/a'}"})

    stats, model = voice_stats(edges)
    for v, sv in sorted(stats.items()):
        profile = f"{sv['n']}|{sv['mean_edge']:.6f}|{fmt(sv['lo90'], 6)}|{fmt(sv['hi90'], 6)}|{sv['verdict']}"
        phash = hashlib.sha256(profile.encode()).hexdigest()[:16]
        head = state["trust_heads"].get(v)
        if head and (head.get("hash") == phash if "hash" in head else head.get("n") == sv["n"]):
            continue
        ver = (head["version"] + 1) if head else 1
        sup = f"supersedes=v{head['version']} ({head.get('blob_id') or 'n/a'})" if head else "supersedes=none"
        items.append({"key": f"trust:{v}:v{ver}", "kind": "trust", "voice": v, "version": ver, "n": sv["n"], "hash": phash, "text":
                      f"trust {v} · domain=politics · v{ver} · {sup} · n={sv['n']} · "
                      f"mean_edge={fmt(sv['mean_edge'], 4)} · interval90=[{fmt(sv['lo90'], 4)}, {fmt(sv['hi90'], 4)}] · "
                      f"beat_market={sv['beat_market']}/{sv['n']} · verdict={sv['verdict']} · weight={fmt(sv['trust'], 4)}"})
    if items:
        items.append({"key": f"model:{seen}", "kind": "model", "text":
                      f"model receipts-trust · voices={model['voices']} · calls={model['calls']} · "
                      f"sigma2_within={fmt(model['sigma2_within'], 5, False)} · df={model['df']} · tau2={fmt(model['tau2'], 6)} · "
                      f"k={fmt(model['k'], 2, False)} · {model['note'] or 'shrinkage active'} · at={seen}"})
    for it in items:
        it["sha256"] = hashlib.sha256(it["text"].encode()).hexdigest()

    print(f"\nscored {len(scored_calls)} calls from {len(stats)} voices; resolutions as of {seen}\n")
    for v, sv in sorted(stats.items(), key=lambda kv: -kv[1]["mean_edge"]):
        print(f"  {v:<32} n={sv['n']:>2}  edge {fmt(sv['mean_edge'])}  90% [{fmt(sv['lo90'])}, {fmt(sv['hi90'])}]  {sv['verdict']}")
    print(f"  model: k={fmt(model['k'], 2, False)}  {model['note']}\n")
    print(f"{len(items)} new memories:")
    for it in items:
        print(f"  [{it['kind']}] {it['text']}")

    report = {"generated_at": now_iso(), "resolutions_seen": seen,
              "market_logged_at": logged_px.get("fetched_at"),
              "model": {**model, "k": None if model["k"] in (None, math.inf) else model["k"]},
              "voices": stats, "calls": scored_calls,
              "pending": [s for s in slugs if final_outcome(res[s]) is None]}

    def save_report() -> None:
        for v in report["voices"]:
            h = state["trust_heads"].get(v)
            report["voices"][v]["trust_blob"] = h["blob_id"] if h else None
            report["voices"][v]["trust_version"] = h["version"] if h else None
        report["memories"] = dict(state["written"])
        a.out.write_text(json.dumps(report, indent=1))

    if not (a.write or a.mock):
        save_report()
        print(f"\ndry run: nothing written to Walrus. {a.out} updated for the app.")
        return
    if not items:
        save_report()
        print("\nnothing new to write")
        return

    from memwal import RememberBulkItem
    if a.mock:
        from memwal import MemWalMockSync
        client, mode, acct = MemWalMockSync.create(namespace=NAMESPACE), "mock", "mock"
    else:
        from memwal import MemWalSync
        key, acct, url = load_credentials()
        client, mode = MemWalSync.create(key=key, account_id=acct, server_url=url, namespace=NAMESPACE), "mainnet"
        client.health()
    ledger = Path("trust_ledger.jsonl" if mode == "mainnet" else "trust_ledger.mock.jsonl")
    results = []
    try:
        for i in range(0, len(items), 20):
            chunk = items[i:i + 20]
            res_b = client.remember_bulk_and_wait([RememberBulkItem(text=it["text"], namespace=NAMESPACE) for it in chunk])
            done = [{**it, "status": r.status, "blob_id": r.blob_id or None, "error": r.error}
                    for it, r in zip(chunk, res_b.results)]
            results += done
            # persist after every chunk, so a later failure never loses what already landed
            with ledger.open("a") as f:
                for r in done:
                    f.write(json.dumps({**r, "mode": mode, "account": acct, "namespace": NAMESPACE, "logged_at": now_iso()}) + "\n")
            if mode == "mainnet":
                for r in done:
                    if r["status"] != "done":
                        continue
                    state["written"][r["key"]] = r["blob_id"]
                    if r["kind"] == "trust":
                        state["trust_heads"][r["voice"]] = {"version": r["version"], "n": r["n"], "hash": r["hash"], "blob_id": r["blob_id"]}
                a.state.write_text(json.dumps(state, indent=1))
    finally:
        client.close()

    save_report()
    ok = [r for r in results if r["status"] == "done"]
    print(f"\n{len(ok)}/{len(results)} written ({mode}) -> {ledger}")
    for r in results:
        print(f"  {'ok ' if r['status'] == 'done' else 'ERR'} {r['kind']:<6} {r['key'][:44]:<44} {r['blob_id'] or r['error']}")
    if len(ok) != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
