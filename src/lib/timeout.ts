export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${ms / 1000}s`);
    this.name = "TimeoutError";
  }
}

/** The 15 second page budget: data that takes longer becomes an error page with "retry", never an endless spinner. */
export const PAGE_DATA_TIMEOUT_MS = 12_000;

/** Reject if `work` takes longer than `ms`. The timer is always cleared. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
