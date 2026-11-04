type Kind = "beat" | "closer" | "tied" | "pending";

const LABEL: Record<Kind, string> = {
  beat: "Beat the market",
  closer: "Market was closer",
  tied: "Tied with the market",
  pending: "Awaiting result",
};

export function stampKind(edge: number | undefined): Kind {
  if (edge === undefined) return "pending";
  return edge > 1e-9 ? "beat" : edge < -1e-9 ? "closer" : "tied";
}

export default function Stamp({ kind, size = "sm", tilt = -5 }: { kind: Kind; size?: "sm" | "lg"; tilt?: number }) {
  return (
    <span className={`stamp stamp-${kind} stamp-${size}`} style={{ ["--tilt" as string]: `${tilt}deg` }}>
      {LABEL[kind]}
    </span>
  );
}
