export interface AlertRules {
  /** Price counts as "touching" a level when price <= level * (1 + touchTolerance). */
  touchTolerance: number;
  /** After an alert, price must rise above level * (1 + rearmBuffer) before it can fire again. */
  rearmBuffer: number;
  /** Minimum minutes between two alerts for the same symbol + tier. */
  cooldownMinutes: number;
}

export const DEFAULT_RULES: AlertRules = {
  touchTolerance: 0.003,
  rearmBuffer: 0.01,
  cooldownMinutes: 60,
};

export interface TierState {
  armed: boolean;
  lastAlertAt: Date | null;
}

export type Decision = "alert" | "rearm" | "none";

/**
 * Per (symbol, tier) state machine:
 *
 *   armed --price touches level--> ALERT --> disarmed
 *   disarmed --price bounces above level + buffer--> rearmed (no message)
 *
 * Each tier has its own state, so touching a different tier fires independently,
 * and touching the same tier again only fires after a real bounce.
 * A missing state row means "armed".
 */
export function evaluateTier(
  input: { price: number; level: number; state: TierState | undefined; now: Date },
  rules: AlertRules = DEFAULT_RULES,
): Decision {
  const { price, level, now } = input;
  const state = input.state ?? { armed: true, lastAlertAt: null };

  if (!state.armed) {
    return price > level * (1 + rules.rearmBuffer) ? "rearm" : "none";
  }

  const touched = price <= level * (1 + rules.touchTolerance);
  if (!touched) return "none";

  if (state.lastAlertAt) {
    const elapsedMin = (now.getTime() - state.lastAlertAt.getTime()) / 60_000;
    if (elapsedMin < rules.cooldownMinutes) return "none";
  }
  return "alert";
}
