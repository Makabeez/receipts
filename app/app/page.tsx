import { ACCOUNT_ID, races, summary, utc, voices } from "../lib/data";
import scores from "../data/scores.json";
import AskMemory from "./components/AskMemory";
import Leaderboard from "./components/Leaderboard";
import RaceSlips from "./components/RaceSlips";
import Stamp, { stampKind } from "./components/Stamp";

const REPO = "https://github.com/Makabeez/receipts";

export default function Home() {
  const allRaces = races();
  const allVoices = voices();
  const s = summary();
  const resolved = allRaces.filter((r) => r.outcome).length;
  const scoredCalls = (scores as { calls?: unknown[] }).calls?.length ?? 0;
  const hero = ["silver-senate", "ddhq-oh", "ddhq-sc"]
    .map((id) => allRaces.flatMap((r) => r.receipts.map((c) => ({ c, r }))).find((x) => x.c.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="wordmark">Receipts</p>
          <h1>Every pundit says they called it. These are the receipts.</h1>
          <p className="lede">
            Before the US midterms, Receipts wrote {s.callsLogged} published forecasts to Walrus Memory, each beside the market price at that moment.
            Sui certified every record by {utc(s.lastCertified)}, {s.hoursBefore} hours before the first polls closed. Now the results are in,
            and Receipts remembers who beat the market.
          </p>
          <p className="hero-links">
            <a href="#voices">See who to trust</a>
            <a href="#races">Open the receipts</a>
          </p>
        </div>
        <div className="hero-stack" aria-hidden="true">
          {hero.map(({ c, r }, i) => (
            <div key={c.id} className={`mini mini-${i}`}>
              <p className="mini-q">{r.question}</p>
              <p className="mini-line"><span>{c.voice}</span><span>{(c.p * 100).toFixed(1)}%</span></p>
              <p className="mini-line"><span>Market</span><span>{(c.market * 100).toFixed(1)}%</span></p>
              <p className="mini-time">Certified {c.certifiedAt ? utc(c.certifiedAt) : "n/a"}</p>
              <Stamp kind={r.outcome ? stampKind(c.edge) : "pending"} size="lg" tilt={[-9, 6, -4][i]} />
            </div>
          ))}
        </div>
      </section>

      <section id="voices" className="section">
        <h2>Who to listen to</h2>
        <p className="section-lede">
          A voice earns trust only by beating the market price at the time Receipts logged the call. Picking the favourite that wins earns nothing.
        </p>
        <Leaderboard voices={allVoices} scoredCalls={scoredCalls} resolved={resolved} afterLabel={s.resolutionsSeen ? utc(s.resolutionsSeen).split(",")[0] : "Now"} />
      </section>

      <section id="races" className="section">
        <h2>The receipts</h2>
        <p className="section-lede">
          One slip per race. Open a line to see where the call was published, the Walrus blob that remembers it, and the Sui transaction that certified it before the vote.
          {s.pending.length > 0 && ` ${s.pending.length} race${s.pending.length === 1 ? " is" : "s are"} still waiting for a final resolution and will be scored when it lands.`}
        </p>
        <RaceSlips races={allRaces} />
      </section>

      <section id="ask" className="section">
        <h2>Ask the memory</h2>
        <p className="section-lede">
          Scores, results and trust profiles are written back to Walrus Memory, and every new profile supersedes the last one instead of overwriting it. Search it directly.
        </p>
        <AskMemory />
      </section>

      <section id="how" className="section how">
        <h2>How a receipt works</h2>
        <ol className="steps">
          <li><strong>Log before the event.</strong> The call, the voice, its probability and the live market price go to Walrus Memory on Mainnet.</li>
          <li><strong>Certify on Sui.</strong> Walrus certifies the blob in a Sui transaction. Its timestamp proves the call existed before the result. Tatum&apos;s Sui gateway confirmed all of them, and the app re-reads each blob object live through Tatum&apos;s Sui gRPC.</li>
          <li><strong>Resolve.</strong> When the market resolves, Receipts writes the result to memory.</li>
          <li><strong>Score against the market.</strong> Each call gets edge = market Brier − voice Brier. Being right about a 95% favourite earns almost nothing.</li>
          <li><strong>Remember the trust.</strong> Each voice gets a new trust profile that supersedes the last. The ranking above is read from that memory.</li>
        </ol>

        <h3>What is real here</h3>
        <table className="truth">
          <thead><tr><th>Part</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>{s.callsLogged} forecasts and {s.snapshots} market snapshots on Walrus Memory Mainnet</td><td>Real, certified {utc(s.firstCertified)} to {utc(s.lastCertified)}</td></tr>
            <tr><td>Forecasts themselves</td><td>Real, published by {allVoices.map((v) => v.name).join(", ")}, as reported by Newsweek on Oct 31</td></tr>
            <tr><td>Market prices at logging</td><td>Real Polymarket prices from {s.marketAt ? utc(s.marketAt) : "logging time"}, stored beside each call</td></tr>
            <tr><td>Results</td><td>Polymarket resolutions as of {s.resolutionsSeen ? utc(s.resolutionsSeen) : "the last scoring run"}</td></tr>
            <tr><td>Who to trust</td><td>{allVoices.every((v) => v.verdict === "not yet distinguishable") ? "Measured, and honestly inconclusive: no voice is yet distinguishable from the market" : "Measured from the scored calls above, with 90% intervals"}</td></tr>
          </tbody>
        </table>
        <p className="limits">
          Limits: {scoredCalls} scored calls from {allVoices.length} voices is a small sample. The shrinkage constant k is estimated from the data rather than chosen, and right now the estimate is
          {s.k === null ? " infinite, because the spread between voices is smaller than the noise." : ` ${s.k.toFixed(2)}.`} Receipts says so instead of inventing a ranking. The forecasts were published {s.saidRange} but the market price was read when Receipts logged them, so the market had up to {s.lagDays} more days of news. That tilts every score against the voices.
        </p>
      </section>

      <footer className="foot">
        <p>
          Built for Total Recall (Tatum × Walrus). Memory account <a href={`https://suiscan.xyz/mainnet/object/${ACCOUNT_ID}`} target="_blank" rel="noreferrer">{ACCOUNT_ID.slice(0, 10)}…{ACCOUNT_ID.slice(-6)}</a>.
          Code, evidence and every blob ID: <a href={REPO} target="_blank" rel="noreferrer">github.com/Makabeez/receipts</a>.
        </p>
      </footer>
    </main>
  );
}
