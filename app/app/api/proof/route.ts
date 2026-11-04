import { NextResponse } from "next/server";
import sui from "../../../data/sui_receipts.json";
import { OWNER } from "../../../lib/data";
import { getObject, protoValueToJs } from "../../../lib/suiGrpc";

// Live check of one receipt's Walrus Blob object on Sui Mainnet, through Tatum's Sui gRPC gateway
// (sui.rpc.v2.LedgerService/GetObject). Only objects listed in data/sui_receipts.json can be queried.
export const runtime = "nodejs";

const known = new Map((sui as { object_id?: string; blob_id_u256: string; id: string }[])
  .filter((r) => r.object_id)
  .map((r) => [r.object_id as string, r]));
const cache = new Map<string, { at: number; body: object }>();

type BlobJson = { blob_id?: string; registered_epoch?: number; certified_epoch?: number | null; storage?: { end_epoch?: number } };

export async function GET(req: Request) {
  const object = new URL(req.url).searchParams.get("object") ?? "";
  const row = known.get(object);
  if (!row) return NextResponse.json({ error: "That object is not one of the Receipts blobs." }, { status: 404 });
  const key = process.env.TATUM_API_KEY;
  if (!key) return NextResponse.json({ error: "Live Sui checks aren't configured on this deployment (TATUM_API_KEY)." }, { status: 503 });

  const hit = cache.get(object);
  if (hit && Date.now() - hit.at < 60_000) return NextResponse.json(hit.body);

  let res;
  try {
    res = await getObject(object, key);
  } catch (e) {
    const code = (e as { code?: number }).code;
    const msg = code === 8 || /429/.test(String(e)) ? "Tatum's free tier is rate-limited. Try again in a few seconds."
      : code === 16 ? "Tatum rejected the API key on this deployment."
      : "Tatum's Sui gateway didn't answer. Try again in a minute.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const o = res.object;
  const f = protoValueToJs(o?.json as never) as BlobJson | null;
  if (!o || !f?.blob_id) return NextResponse.json({ error: "Sui returned an object that isn't a Walrus blob." }, { status: 502 });

  const owner = o.owner?.address ?? null;
  const body = {
    via: "Tatum Sui gRPC (LedgerService/GetObject)",
    checkedAt: new Date().toISOString(),
    receipt: row.id,
    objectId: o.object_id,
    type: o.object_type,
    owner,
    ownerIsAccountOwner: owner?.toLowerCase() === OWNER,
    blobMatches: String(f.blob_id) === row.blob_id_u256,
    registeredEpoch: f.registered_epoch,
    certifiedEpoch: f.certified_epoch,
    endEpoch: f.storage?.end_epoch ?? null,
    version: o.version,
  };
  cache.set(object, { at: Date.now(), body });
  return NextResponse.json(body);
}
