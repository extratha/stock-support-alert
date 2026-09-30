import { TIER_LABEL_TH, type Tier } from "@/lib/support/types";

const STYLE: Record<Tier, string> = {
  minor: "bg-warning/12 text-warning ring-warning/30",
  intermediate: "bg-caution/12 text-caution ring-caution/30",
  major: "bg-danger/12 text-danger ring-danger/30",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STYLE[tier]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {TIER_LABEL_TH[tier]}
    </span>
  );
}
