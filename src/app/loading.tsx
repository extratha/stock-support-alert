/**
 * Route-level fallback: Next shows this immediately when switching tabs while the
 * destination page (server-rendered, reads the DB) is still loading, so the UI never
 * looks frozen. Shapes mirror the real pages to avoid layout shift when content arrives.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-elevated motion-reduce:animate-none ${className}`} />;
}

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
      <span className="sr-only">กำลังโหลดข้อมูล…</span>
      <div className="space-y-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="surface space-y-4 p-5">
            <div className="flex items-center justify-between">
              <Bar className="h-6 w-20" />
              <Bar className="h-7 w-28" />
            </div>
            <Bar className="h-9 w-full" />
            <Bar className="h-9 w-full" />
            <Bar className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
