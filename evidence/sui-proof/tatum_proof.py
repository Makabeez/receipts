#!/usr/bin/env python3
"""Receipts: prove each midterm receipt on Sui Mainnet through Tatum's Sui gRPC gateway.

Tatum no longer serves Sui JSON-RPC (Sui deprecated it), so this reads each receipt's
transaction with sui.rpc.v2.LedgerService/GetTransaction over gRPC.

Input:  sui_receipts.json (blob_id, tx digest, Blob object id, certified time from Sui GraphQL).
Output: tatum_proof.json, Tatum's own answer per transaction: checkpoint, timestamp and the
        Walrus BlobCertified event, checked against the expected blob, object and poll close.

The gRPC schema is read by server reflection from the public Sui node (no data comes from it);
every transaction is fetched from Tatum with your key. Needs: pip install grpcio grpcio-reflection protobuf
and TATUM_API_KEY in the environment. The key is never printed or written.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import grpc
from google.protobuf import json_format, message_factory
from google.protobuf.descriptor_pool import DescriptorPool
from grpc_reflection.v1alpha.proto_reflection_descriptor_database import ProtoReflectionDescriptorDatabase

TATUM = os.environ.get("TATUM_SUI_GRPC", "sui-mainnet-grpc.gateway.tatum.io:443")
SCHEMA = os.environ.get("SUI_SCHEMA_GRPC", "fullnode.mainnet.sui.io:443")
METHOD = "/sui.rpc.v2.LedgerService/GetTransaction"
WALRUS_EVENT = "::events::BlobCertified"
POLLS_CLOSE = datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc)
PACE_S = float(os.environ.get("TATUM_PACE_S", "1.1"))  # free plans allow about 1 request a second


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> None:
    key = os.environ.get("TATUM_API_KEY")
    if not key:
        sys.exit("set TATUM_API_KEY (Tatum dashboard -> API keys, mainnet key)")
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "sui_receipts.json")
    receipts = json.loads(src.read_text())

    schema = grpc.secure_channel(SCHEMA, grpc.ssl_channel_credentials())
    pool = DescriptorPool(ProtoReflectionDescriptorDatabase(schema))
    m = pool.FindServiceByName("sui.rpc.v2.LedgerService").methods_by_name["GetTransaction"]
    Req, Resp = message_factory.GetMessageClass(m.input_type), message_factory.GetMessageClass(m.output_type)

    tatum = grpc.secure_channel(TATUM, grpc.ssl_channel_credentials())
    call = tatum.unary_unary(METHOD, request_serializer=Req.SerializeToString, response_deserializer=Resp.FromString)

    out, bad = [], 0
    for r in receipts:
        req = Req(digest=r["tx"])
        req.read_mask.paths.extend(["digest", "timestamp", "checkpoint", "events"])
        for attempt in range(8):
            time.sleep(PACE_S)
            try:
                resp = call(req, metadata=[("x-api-key", key)], timeout=30)
                break
            except grpc.RpcError as e:
                code = e.code().name if e.code() else "UNKNOWN"
                rate_limited = "429" in (e.details() or "") or code in ("RESOURCE_EXHAUSTED", "UNAVAILABLE")
                if rate_limited and attempt < 7:
                    wait = 2 ** attempt
                    print(f"    rate limited, retrying in {wait}s")
                    time.sleep(wait)
                    continue
                sys.exit(f"Tatum gRPC {code} on {r['tx']}: {e.details()} "
                         f"({'pruned: the transaction is older than the gateway keeps' if code == 'NOT_FOUND' else 'check the key and plan'})")
        t = json_format.MessageToDict(resp)["transaction"]
        ev = [e for e in t.get("events", {}).get("events", [])
              if e.get("eventType", "").endswith(WALRUS_EVENT) and str(e.get("json", {}).get("blob_id")) == r["blob_id_u256"]]
        when = ts(t["timestamp"])
        ok = bool(ev) and ev[0]["json"]["object_id"] == r["object_id"] and t["digest"] == r["tx"] and when < POLLS_CLOSE
        bad += not ok
        out.append({**r, "tatum": {
            "checked": ok, "checkpoint": t.get("checkpoint"), "timestamp": t["timestamp"],
            "event_type": ev[0]["eventType"] if ev else None,
            "end_epoch": int(ev[0]["json"]["end_epoch"]) if ev else None,
        }})
        print(f"{'ok ' if ok else 'BAD'} {t['timestamp']} cp={t.get('checkpoint')} {r['tx'][:12]}… {r['id'][:36]}")

    payload = {"source": TATUM, "method": METHOD.strip("/"), "transport": "gRPC",
               "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "receipts": out}
    Path("tatum_proof.json").write_text(json.dumps(payload, indent=1))
    print(f"\n{len(out) - bad}/{len(out)} receipts confirmed through Tatum before polls closed -> tatum_proof.json")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
