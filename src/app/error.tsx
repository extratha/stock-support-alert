"use client";

import { useEffect } from "react";

/**
 * Shown when a page's data could not be loaded in time (or failed). Instead of an endless
 * skeleton the user gets a clear message and a retry button.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="surface mx-auto mt-10 max-w-md space-y-4 p-8 text-center">
      <h1 className="text-lg font-semibold">โหลดข้อมูลไม่สำเร็จ</h1>
      <p className="text-sm text-muted">
        ระบบใช้เวลานานเกินไปหรือเกิดข้อผิดพลาดชั่วคราว ลองใหม่อีกครั้ง ถ้ายังไม่หายให้รอสักครู่
      </p>
      {error.digest && <p className="font-mono text-xs text-muted">รหัสอ้างอิง: {error.digest}</p>}
      <button
        onClick={reset}
        className="min-h-11 cursor-pointer rounded-lg bg-primary px-5 font-medium text-on-primary transition-[filter] duration-150 hover:brightness-110"
      >
        ลองใหม่
      </button>
    </div>
  );
}
