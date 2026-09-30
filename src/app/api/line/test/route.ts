import { NextResponse } from "next/server";
import { notify } from "@/lib/jobs/notify";

export const dynamic = "force-dynamic";

/** Sends a test push so you can confirm LINE is wired up. Behind ADMIN_PASSWORD via proxy.ts. */
export async function POST() {
  try {
    const { sent } = await notify("✅ ทดสอบระบบแจ้งเตือนแนวรับหุ้น: เชื่อมต่อ LINE สำเร็จ");
    if (sent === 0) {
      return NextResponse.json({ error: "ยังไม่มีผู้รับ — เพิ่ม LINE OA เป็นเพื่อนก่อน" }, { status: 409 });
    }
    return NextResponse.json({ sent });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 502 });
  }
}
