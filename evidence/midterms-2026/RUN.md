# Receipts: log midterm calls to Walrus Memory (Nov 1–2)

Polls start closing **Nov 3, 23:00 UTC**. After that the script refuses to write, because a call logged then is no longer a pre-event receipt.

## 1. Set up (VPS, 2 minutes)

```bash
mkdir -p ~/receipts-midterms && cd ~/receipts-midterms
cp /mnt/c/Users/VPS/Downloads/receipts-midterms/* .
python3 -m venv .venv && . .venv/bin/activate && pip install -q memwal
```

Credentials are read from `~/.memwal/credentials.json` (Session 7 account `0xedc0…ad59`). The private key is never printed.

## 2. Fill `calls.json`

Copy `calls.example.json` to `calls.json` and replace the two examples with **real** calls only, about 12–15 of them:

- `source`: the voice's handle. `source_url`: the post or article where they made the call.
- `market_slug`: pick it from `candidate_markets.json`. These are live markets priced 15–85%, where a call can be wrong.
- `outcome`: `"Yes"` or `"No"` on that market. `p`: their stated probability, or `null` if they gave none.
- `said_at`: the date of the post.

Prefer markets that settle on election night: the Senate and House control markets, and the Kansas, Iowa, Maine, Texas, Michigan and Ohio Senate races. Avoid races that may not be called before judging, such as the Alaska Senate race (ranked-choice counting can take weeks).

## 3. Run

```bash
python3 log_calls.py calls.json          # dry run: shows every memory, writes nothing
python3 log_calls.py calls.json --mock   # tests the write path in memory
python3 log_calls.py calls.json --write  # Walrus Memory Mainnet, namespace receipts-calls
```

Each market also gets an `odds` snapshot memory, so 12 calls on 6 markets give 18 memories (the gate is 10 or more).

`ledger.jsonl` keeps every write: text, sha256, blob_id, logged_at. **Commit it to the repo.** It is the evidence the receipts were logged before the vote.
