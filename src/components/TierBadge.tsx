import { TIER_LABEL_TH, type Tier } from "@/lib/support/types";

const STYLE: Record<Tier, string> = {
  minor: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  intermediate: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  major: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[tier]}`}>{TIER_LABEL_TH[tier]}</span>;
}
