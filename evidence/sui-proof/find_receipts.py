import json, base64, sys
from datetime import datetime
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from gql import q
PKG = "0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77"
def ts(s): return datetime.fromisoformat(s.replace("Z", "+00:00"))
def cp_time(n):
    d = q("query($n: UInt53!){ checkpoint(sequenceNumber: $n) { timestamp } }", {"n": n})
    return ts(d["checkpoint"]["timestamp"]) if d["checkpoint"] else None
def seq_at(target):
    hi = q("{ checkpoint { sequenceNumber } }")["checkpoint"]["sequenceNumber"]
    lo = hi - 2_000_000
    while cp_time(lo) is None or cp_time(lo) > target: lo -= 1_000_000
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cp_time(mid) <= target: lo = mid
        else: hi = mid
    return lo
start = seq_at(ts("2026-11-01T20:35:40Z")); end = seq_at(ts("2026-11-01T20:45:00Z"))
print("checkpoints", start, end, file=sys.stderr)
ledger = [r for r in (json.loads(l) for l in open(sys.argv[1]) if l.strip())
          if r.get("blob_id") and r.get("status", "done") == "done" and r.get("mode", "mainnet") == "mainnet"]
want = {}
for r in ledger:
    b = base64.urlsafe_b64decode(r["blob_id"] + "=" * (-len(r["blob_id"]) % 4))
    want[str(int.from_bytes(b, "little"))] = r
found, cursor, pages = {}, None, 0
qq = """query($f: EventFilter!, $c: String){ events(first: 50, after: $c, filter: $f) {
  pageInfo { hasNextPage endCursor }
  nodes { timestamp contents { json } transaction { digest effects { checkpoint { sequenceNumber } } } } } }"""
while True:
    d = q(qq, {"f": {"type": f"{PKG}::events::BlobCertified", "afterCheckpoint": start, "beforeCheckpoint": end}, "c": cursor})
    ev = d["events"]; pages += 1
    for n in ev["nodes"]:
        j = n["contents"]["json"]
        if j["blob_id"] in want:
            found[j["blob_id"]] = {"time": n["timestamp"], "tx": n["transaction"]["digest"], "object_id": j["object_id"],
                                   "certified_epoch": j["epoch"], "end_epoch": j["end_epoch"],
                                   "checkpoint": n["transaction"]["effects"]["checkpoint"]["sequenceNumber"]}
    if not ev["pageInfo"]["hasNextPage"] or len(found) == len(want): break
    cursor = ev["pageInfo"]["endCursor"]
print(f"pages={pages} matched {len(found)}/{len(want)}", file=sys.stderr)
out = []
for k, r in want.items():
    f = found.get(k)
    out.append({"kind": r["kind"], "id": r.get("call_id") or r["slug"], "blob_id": r["blob_id"], "blob_id_u256": k, **(f or {})})
json.dump(out, open("sui_receipts.json", "w"), indent=1)
for o in out: print(o.get("time", "NOT FOUND"), o.get("tx", ""), o.get("end_epoch", ""), o["id"][:40])
