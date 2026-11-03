#!/usr/bin/env python3
"""Receipts — log pre-election calls to Walrus Memory (Mainnet) before polls close.

For each call in calls.json this script:
  1. fetches the live Polymarket price of the called outcome (Gamma API),
  2. builds one `call` memory and one `odds` snapshot memory per market,
  3. writes them to Walrus Memory in namespace `receipts-calls` (bulk, <=20/request),
  4. appends every write to ledger.jsonl (text, sha256, blob_id, logged_at).

Default is a dry run: nothing is written. Use --write for Mainnet, --mock to test
the write path in memory.

Credentials come from ~/.memwal/credentials.json (written by the MemWal plugin
login) or from MEMWAL_PRIVATE_KEY / MEMWAL_ACCOUNT_ID. The private key is never
printed or logged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GAMMA = "https://gamma-api.polymarket.com/markets"
NAMESPACE = "receipts-calls"
EVENT_TAG = "midterms-2026"
# Earliest US poll closings on Nov 3 (parts of IN/KY, 6pm local) = 23:00 UTC.
POLLS_CLOSE_UTC = datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc)
BULK_MAX = 20
REQUIRED = ("id", "source", "source_url", "market_slug", "outcome", "said_at")


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def load_calls(path: Path) -> list[dict]:
    calls = json.loads(path.read_text())
    if not isinstance(calls, list) or not calls:
        sys.exit(f"{path}: expected a non-empty JSON list")
    seen = set()
    for i, c in enumerate(calls):
        missing = [k for k in REQUIRED if not str(c.get(k, "")).strip()]
        if missing:
            sys.exit(f"{path}: call #{i} is missing {missing}")
        if c["id"] in seen:
            sys.exit(f"{path}: duplicate id {c['id']}")
        seen.add(c["id"])
        p = c.get("p")
        if p is not None and not (0 < float(p) < 1):
            sys.exit(f"{path}: call {c['id']} has p={p}; use a probability in (0,1) or null")
        if not str(c["source_url"]).startswith("https://"):
            sys.exit(f"{path}: call {c['id']} needs an https source_url (the receipt for the quote)")
    return calls


def fetch_market(slug: str) -> dict:
    url = f"{GAMMA}?{urllib.parse.urlencode({'slug': slug})}"
    req = urllib.request.Request(url, headers={"User-Agent": "receipts-total-recall/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        rows = json.load(r)
    if not rows:
        raise ValueError(f"no Polymarket market with slug '{slug}'")
    m = rows[0]
    if m.get("closed"):
        raise ValueError(f"market '{slug}' is already closed")
    outcomes = json.loads(m["outcomes"]) if isinstance(m.get("outcomes"), str) else m.get("outcomes")
    prices = json.loads(m["outcomePrices"]) if isinstance(m.get("outcomePrices"), str) else m.get("outcomePrices")
    if not outcomes or not prices:
        raise ValueError(f"market '{slug}' has no prices yet")
    return {
        "slug": slug,
        "question": m.get("question", slug),
        "prices": {o: float(p) for o, p in zip(outcomes, prices)},
        "end_date": m.get("endDate"),
    }


def call_text(c: dict, mkt: dict, logged: str) -> str:
    price = mkt["prices"].get(c["outcome"])
    if price is None:
        raise ValueError(f"call {c['id']}: outcome '{c['outcome']}' not in {list(mkt['prices'])}")
    p = "n/a" if c.get("p") is None else f"{float(c['p']):.3f}"
    parts = [
        f"call {EVENT_TAG} {c['id']}",
        mkt["question"],
        c["source"],
        f"pick={c['outcome']}",
        f"p={p}",
        f"market={price:.3f}",
        f"market_at={mkt['fetched_at']}",
        f"domain={c.get('domain', 'politics')}",
        f"said={c['said_at']}",
        f"logged={logged}",
        f"src={c['source_url']}",
        f"slug={mkt['slug']}",
    ]
    if c.get("quote"):
        parts.append(f'quote="{c["quote"]}"')
    return " · ".join(parts)


def odds_text(mkt: dict, logged: str) -> str:
    px = " ".join(f"{o}={p:.3f}" for o, p in mkt["prices"].items())
    return (f"odds {EVENT_TAG} · polymarket · {mkt['question']} · {px} · "
            f"market_at={mkt['fetched_at']} · logged={logged} · slug={mkt['slug']}")


def load_snapshot(path: Path, slugs: list[str], logged_dt: datetime, force: bool) -> dict[str, dict]:
    """Prices captured elsewhere with --snapshot (for networks that block Polymarket)."""
    snap = json.loads(path.read_text())
    taken = datetime.strptime(snap["fetched_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    age_h = (logged_dt - taken).total_seconds() / 3600
    if age_h > 12 and not force:
        sys.exit(f"{path}: snapshot is {age_h:.1f}h old; take a fresh one (or --force)")
    missing = [s for s in slugs if s not in snap["markets"]]
    if missing:
        sys.exit(f"{path}: no prices for {missing}")
    print(f"prices from snapshot {path} taken {snap['fetched_at']} ({age_h:.1f}h ago)")
    return {s: {**snap["markets"][s], "fetched_at": snap["fetched_at"]} for s in slugs}


def load_credentials() -> tuple[str, str, str]:
    key = os.environ.get("MEMWAL_PRIVATE_KEY")
    acct = os.environ.get("MEMWAL_ACCOUNT_ID")
    url = os.environ.get("MEMWAL_SERVER_URL", "https://relayer.memory.walrus.xyz")
    if key and acct:
        return key, acct, url
    p = Path.home() / ".memwal" / "credentials.json"
    if not p.exists():
        sys.exit("no credentials: set MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID or log in with the MemWal plugin")
    d = json.loads(p.read_text())
    try:
        return d["delegatePrivateKey"], d["accountId"], d.get("relayerUrl", url)
    except KeyError as e:
        sys.exit(f"{p} has no field {e}; expected delegatePrivateKey + accountId")


def make_client(mode: str):
    if mode == "mock":
        from memwal import MemWalMockSync
        return MemWalMockSync.create(namespace=NAMESPACE, owner="mock-owner"), "mock"
    from memwal import MemWalSync, delegate_key_to_public_key
    key, acct, url = load_credentials()
    client = MemWalSync.create(key=key, account_id=acct, server_url=url, namespace=NAMESPACE)
    pub = delegate_key_to_public_key(key).hex()
    print(f"account   {acct}\ndelegate  {pub[:8]}…{pub[-4:]}\nrelayer   {url}\nnamespace {NAMESPACE}")
    client.health()
    return client, acct


def write(client, items: list[dict]) -> list[dict]:
    from memwal import RememberBulkItem
    out = []
    for i in range(0, len(items), BULK_MAX):
        chunk = items[i:i + BULK_MAX]
        res = client.remember_bulk_and_wait([RememberBulkItem(text=it["text"], namespace=NAMESPACE) for it in chunk])
        for it, r in zip(chunk, res.results):
            out.append({**it, "status": r.status, "blob_id": r.blob_id or None, "error": r.error})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("calls", type=Path, nargs="?", default=Path("calls.json"))
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--write", action="store_true", help="write to Walrus Memory Mainnet")
    g.add_argument("--mock", action="store_true", help="write to the in-memory MemWal mock")
    ap.add_argument("--ledger", type=Path, default=Path("ledger.jsonl"))
    ap.add_argument("--force", action="store_true", help="allow writes after polls start closing (not a pre-event call any more)")
    ap.add_argument("--prices", type=Path, help="use a price snapshot file instead of fetching Polymarket")
    ap.add_argument("--snapshot", type=Path, help="only fetch prices for the calls' markets and save them to this file")
    a = ap.parse_args()

    logged_dt = now_utc()
    if a.write and logged_dt >= POLLS_CLOSE_UTC and not a.force:
        sys.exit(f"refusing: it is {iso(logged_dt)}, polls began closing at {iso(POLLS_CLOSE_UTC)}. "
                 "A call logged now is not a pre-event receipt.")
    logged = iso(logged_dt)

    calls = load_calls(a.calls)
    slugs = list(dict.fromkeys(c["market_slug"] for c in calls))
    if a.prices:
        markets = load_snapshot(a.prices, slugs, logged_dt, a.force)
    else:
        try:
            markets = {s: {**fetch_market(s), "fetched_at": logged} for s in slugs}
        except OSError as e:
            sys.exit(f"cannot reach Polymarket ({e}). Use a snapshot taken elsewhere: --prices prices.json")
    if a.snapshot:
        a.snapshot.write_text(json.dumps({"fetched_at": logged, "source": GAMMA,
                                          "markets": {s: {k: v for k, v in m.items() if k != "fetched_at"}
                                                      for s, m in markets.items()}}, indent=1))
        print(f"saved prices for {len(markets)} markets to {a.snapshot} ({logged})")
        return

    items = [{"kind": "odds", "slug": s, "text": odds_text(m, logged)} for s, m in markets.items()]
    items += [{"kind": "call", "call_id": c["id"], "slug": c["market_slug"],
               "text": call_text(c, markets[c["market_slug"]], logged)} for c in calls]
    for it in items:
        it["sha256"] = hashlib.sha256(it["text"].encode()).hexdigest()
        it["logged_at"] = logged

    print(f"\n{len(calls)} calls on {len(markets)} markets -> {len(items)} memories (gate: >=10)\n")
    for it in items:
        print(f"  [{it['kind']}] {it['text']}")
    if len(items) < 10:
        print("\nwarning: fewer than 10 memories; the hackathon needs >=10 on Mainnet")

    if not (a.write or a.mock):
        print("\ndry run: nothing written. Re-run with --mock to test the write path, --write for Mainnet.")
        return

    client, acct = make_client("mock" if a.mock else "live")
    try:
        results = write(client, items)
    finally:
        client.close()

    ok = [r for r in results if r["status"] == "done"]
    mode = "mock" if a.mock else "mainnet"
    ledger = a.ledger if a.write else a.ledger.with_name(a.ledger.stem + ".mock.jsonl")
    with ledger.open("a") as f:
        for r in results:
            f.write(json.dumps({**r, "mode": mode, "account": acct, "namespace": NAMESPACE}) + "\n")

    print(f"\n{len(ok)}/{len(results)} written ({mode}) -> {ledger}")
    for r in results:
        flag = "ok " if r["status"] == "done" else "ERR"
        print(f"  {flag} {r['kind']:<4} {r.get('call_id', r['slug'])[:40]:<40} {r['blob_id'] or r['error']}")
    if len(ok) != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
