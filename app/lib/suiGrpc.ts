import "server-only";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { SUI_LEDGER_DESC_B64 } from "./sui-ledger-desc";

// Sui gRPC (sui.rpc.v2.LedgerService) through Tatum's gateway. Tatum no longer serves Sui JSON-RPC.
const HOST = process.env.TATUM_SUI_GRPC ?? "sui-mainnet-grpc.gateway.tatum.io:443";

type Fields = Record<string, ProtoValue> | { key: string; value: ProtoValue }[];
type ProtoValue = {
  kind?: string; null_value?: unknown; number_value?: number; string_value?: string; bool_value?: boolean;
  struct_value?: { fields?: Fields }; list_value?: { values?: ProtoValue[] };
};

// google.protobuf.Value as decoded by proto-loader from a descriptor set -> plain JS.
// Map fields arrive either as an object or as a list of {key, value} entries; handle both.
export function protoValueToJs(v: ProtoValue | undefined): unknown {
  if (!v) return null;
  if (v.struct_value) {
    const f = v.struct_value.fields ?? {};
    const entries = Array.isArray(f) ? f.map((e) => [e.key, e.value] as const) : Object.entries(f);
    return Object.fromEntries(entries.map(([k, x]) => [k, protoValueToJs(x)]));
  }
  if (v.list_value) return (v.list_value.values ?? []).map(protoValueToJs);
  if (v.string_value !== undefined) return v.string_value;
  if (v.number_value !== undefined) return v.number_value;
  if (v.bool_value !== undefined) return v.bool_value;
  return null;
}

type LedgerClient = grpc.Client & {
  GetObject: (req: object, md: grpc.Metadata, opts: grpc.CallOptions, cb: (err: grpc.ServiceError | null, res: SuiObjectResponse) => void) => void;
};
export type SuiObjectResponse = {
  object?: { object_id?: string; version?: string; object_type?: string; owner?: { kind?: string; address?: string }; json?: ProtoValue };
};

let client: LedgerClient | null = null;
function ledger(): LedgerClient {
  if (client) return client;
  const def = protoLoader.loadFileDescriptorSetFromBuffer(Buffer.from(SUI_LEDGER_DESC_B64, "base64"), {
    keepCase: true, longs: String, enums: String, defaults: false, oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as { sui: { rpc: { v2: { LedgerService: new (h: string, c: grpc.ChannelCredentials) => LedgerClient } } } };
  client = new pkg.sui.rpc.v2.LedgerService(HOST, grpc.credentials.createSsl());
  return client;
}

export function getObject(objectId: string, apiKey: string): Promise<SuiObjectResponse> {
  const md = new grpc.Metadata();
  md.set("x-api-key", apiKey);
  return new Promise((resolve, reject) => {
    ledger().GetObject(
      { object_id: objectId, read_mask: { paths: ["object_id", "version", "owner", "object_type", "json"] } },
      md,
      { deadline: Date.now() + 15_000 },
      (err, res) => (err ? reject(err) : resolve(res)),
    );
  });
}
