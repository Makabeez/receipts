# Receipts

**Every pundit says they called it. Receipts keeps the receipts.**

Receipts logs a forecast before the event, scores it against the market price after, and remembers the result in Walrus Memory. Each new result changes who it listens to. A voice earns trust only by beating the market price at the moment of the call. Picking the favourite that wins earns nothing.

Built for **Total Recall** (Tatum × Walrus Memory), Track 01: Markets & Sports Prediction.

- **Live app:** https://receipts-recall.vercel.app
- **Blog post:** [Every pundit says they called it. I kept the receipts.](https://dev.to/makabeez/every-pundit-says-they-called-it-i-kept-the-receipts-40f7)
- **Demo video:** [youtu.be/1GuTUcIaS2E](https://youtu.be/1GuTUcIaS2E)
- **Companion built with Tatum AI Builder:** [Receipts Verifier](https://receipts-verifier.vercel.app) ([code](https://github.com/Makabeez/receipts-verifier)), which checks every receipt on Sui through Tatum gRPC
- **Memory account (Walrus Memory, Mainnet):** [`0xedc0baac…7aad59`](https://suiscan.xyz/mainnet/object/0xedc0baac5f3ac60e536615d94766e1888c9ff1523d7af8e0693bfe7e937aad59)
- **Owner wallet of every receipt blob:** [`0xf46b1a40…da9024`](https://suiscan.xyz/mainnet/account/0xf46b1a404ccdba84f5edf87cfdd1d3e582abd0f28f9edd9d996af5c418da9024)

## The test case: the 2026 US midterms

On **Nov 1, 2026**, before any polls closed, Receipts wrote 13 published forecasts (Silver Bulletin, Decision Desk HQ, VoteHub, as reported by [Newsweek on Oct 31](https://www.newsweek.com/who-win-midterms-polls-3-days-12641376)) and 9 Polymarket price snapshots to Walrus Memory on Mainnet.

| Evidence | Where |
|---|---|
| 22 memories written, namespace `receipts-calls` | [`evidence/midterms-2026/ledger.jsonl`](evidence/midterms-2026/ledger.jsonl): text, sha256 and blob ID of each |
| Each blob certified on Sui, **Nov 1 20:36:29 to 20:37:10 UTC**, 50 hours before the first polls closed | [`evidence/sui-proof/sui_receipts.json`](evidence/sui-proof/sui_receipts.json): tx digest, Blob object, epochs |
| The same 22 transactions confirmed through **Tatum's Sui gateway** (gRPC `LedgerService/GetTransaction`), each before polls closed | [`evidence/sui-proof/tatum_proof.json`](evidence/sui-proof/tatum_proof.json) |
| Repo pushed before polls closed | first commit of this repo, Nov 3 ~22:30 UTC |
| Results, scorecards and trust profiles written back, namespace `receipts-trust` | [`evidence/midterms-2026/trust_ledger.jsonl`](evidence/midterms-2026/trust_ledger.jsonl) |

## How the learning loop works

1. **Log before the event.** The call, the voice, its probability and the live market price go to Walrus Memory ([`log_calls.py`](evidence/midterms-2026/log_calls.py)). It refuses to write after polls start closing.
2. **Certify on Sui.** Walrus certifies each blob in a Sui transaction. That timestamp proves the call existed before the result. The app re-reads each Blob object live through **Tatum's Sui gRPC** (`LedgerService/GetObject`): it checks that the object exists, holds the exact blob and is owned by the Receipts wallet. Tatum no longer serves Sui JSON-RPC, so both reads use gRPC.
3. **Resolve.** When a Polymarket market's UMA resolution is final, a `result` memory is written.
4. **Score against the market.** Each call gets `edge = (market − outcome)² − (p − outcome)²`, the market's Brier score minus the voice's. A `score` memory links back to the receipt blob and its Sui transaction.
5. **Remember the trust.** Each voice gets a `trust` memory with n, mean edge, a 90% interval and a verdict. A new version **supersedes** the previous one by blob ID, append-only and never edited ([`score.py`](evidence/midterms-2026/score.py)).

The app ranks voices from that memory and lets anyone search it (`/api/recall` → Walrus Memory recall).

## What the data says, honestly

After election night, 10 calls had final results:

| Voice | Scored calls | Mean edge vs market | Verdict |
|---|---|---|---|
| Silver Bulletin | 1 | +3.1 | not yet distinguishable |
| Decision Desk HQ | 8 | −3.9 | not yet distinguishable |
| VoteHub | 1 | −5.6 | not yet distinguishable |

The shrinkage constant k is **measured, not chosen**: k = σ²(within voice) / τ²(between voices), estimated from the scored calls. Right now τ² ≤ 0, because the spread between voices is smaller than the noise, so k is infinite. **Receipts therefore weights every voice like the market until one of them clears it.** It says so instead of inventing a ranking. One bias to know: the forecasts were published Oct 29–30, but the market price was read on Nov 1 when Receipts logged them, so the market had up to 3 more days of news. That tilts every score against the voices. Intervals are Student-t on the pooled within-voice variance. The House market was still awaiting final UMA resolution at scoring time. Re-running `score.py` adds it and writes a v2 trust profile for each voice that supersedes v1.

## Real or simulated

| Part | Status |
|---|---|
| Forecasts | Real, published before the vote |
| Market prices at logging | Real Polymarket prices, from a snapshot taken at logging time ([`prices.json`](evidence/midterms-2026/prices.json)) |
| Walrus Memory writes | Real, Mainnet, managed relayer |
| Sui certification | Real, Mainnet, 22 transactions |
| Results | Real Polymarket UMA resolutions ([`resolutions.json`](evidence/midterms-2026/resolutions.json)) |
| Trust ranking | Real computation, statistically inconclusive at n=10, stated as such |

## Reproduce it

The scoring needs no wallet, no RPC key and no token. It recomputes every edge, interval and verdict from the committed evidence in under a second:

```bash
cd evidence/midterms-2026 && python3 score.py --resolutions resolutions.json
```

To check that the receipts were certified on Sui before the vote, run this (public Sui GraphQL, no key, about 10 seconds):

```bash
cd evidence/sui-proof && python3 find_receipts.py ../midterms-2026/ledger.jsonl
```

## Run the app

```bash
cd app && npm install && npm run sync-data && npm run dev
```

Optional server env for the live features: `TATUM_API_KEY` (live Sui checks), plus `MEMWAL_KEY` and `MEMWAL_ACCOUNT_ID` (memory search). Without them the site still renders everything from the evidence files, and the live buttons explain what's missing.

## Layout

```
app/                     Next.js site (deployed on Vercel, root directory = app)
evidence/midterms-2026/  log_calls.py, score.py, inputs, ledgers, scores.json
evidence/sui-proof/      find_receipts.py (Sui GraphQL), tatum_proof.py (Tatum Sui RPC), outputs
```

## Stack

Walrus Memory (Mainnet, `memwal` Python SDK and `@mysten-incubation/memwal`), Tatum Sui gRPC gateway, Sui GraphQL, Polymarket Gamma API, Next.js 15 on Vercel.
