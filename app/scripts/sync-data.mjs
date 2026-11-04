// Copy the evidence files the site renders into ./data.
// Run from the app folder after score.py / tatum_proof.py: npm run sync-data
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ev = process.env.EVIDENCE_DIR ?? "../evidence";
const files = [
  ["midterms-2026/scores.json", "scores.json", true],
  ["midterms-2026/calls.json", "calls.json", true],
  ["midterms-2026/prices.json", "prices.json", true],
  ["midterms-2026/resolutions.json", "resolutions.json", true],
  ["sui-proof/sui_receipts.json", "sui_receipts.json", true],
  ["sui-proof/tatum_proof.json", "tatum_proof.json", false],
];
mkdirSync("data", { recursive: true });
let missing = 0;
for (const [src, dst, required] of files) {
  const from = join(ev, src);
  if (!existsSync(from)) {
    console[required ? "error" : "warn"](`${required ? "missing" : "optional, skipped"}: ${from}`);
    if (!required && !existsSync(join("data", dst))) writeFileSync(join("data", dst), JSON.stringify({ receipts: [] }));
    missing += required;
    continue;
  }
  copyFileSync(from, join("data", dst));
  console.log(`copied ${from} -> data/${dst}`);
}
process.exit(missing ? 1 : 0);
