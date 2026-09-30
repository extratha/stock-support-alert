"use client";

import { useState } from "react";

/**
 * A company logo from our own database (/api/logo), or the first letter of the ticker when there is none
 * (or the image fails to load). Logos sit on a light tile because many are dark or transparent and would
 * vanish on the dark theme. Fixed size, so nothing shifts while images load.
 */
export function StockLogo({ symbol, version, className = "size-9" }: { symbol: string; version: number | null; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (version === null || failed) {
    return (
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-lg bg-elevated font-mono text-sm font-semibold text-muted ring-1 ring-border ${className}`}
      >
        {symbol.charAt(0)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already small
    <img
      src={`/api/logo/${encodeURIComponent(symbol)}?v=${Math.round(version)}`}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg bg-white object-contain p-1 ring-1 ring-border ${className}`}
    />
  );
}
