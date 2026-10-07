import { RecipientsManager } from "@/components/RecipientsManager";
import { config } from "@/lib/config";
import { listUsers } from "@/lib/db/lineUsers";
import { formatDateTime } from "@/lib/format/datetime";
import { toRecipientRows } from "@/lib/recipients";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "ผู้รับแจ้งเตือน", description: "ผู้รับแจ้งเตือนผ่าน LINE Official Account (ข้อมูลส่วนตัวถูกซ่อน)" };

export default async function RecipientsPage() {
  const [users, owner] = await Promise.all([withTimeout(listUsers(), PAGE_DATA_TIMEOUT_MS, "load LINE friends"), isOwner()]);
  // Plain, pre-formatted data only (no Dates). For visitors, personal data is removed here, before it is sent.
  const rows = toRecipientRows(
    users.map((u) => ({ ...u, followedAtLabel: formatDateTime(u.followedAt) })),
    owner,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ผู้รับแจ้งเตือน</h1>
        <p className="mt-1 text-sm text-muted">
          {owner ? (
            <>
              เพื่อนของ LINE OA ทั้งหมด — เปิดรับแจ้งเตือนอัตโนมัติ (push) ได้จำกัดจำนวนเพื่อไม่ให้เกินโควตา ส่วนคนอื่นยังพิมพ์ &quot;ขอแนวรับ&quot; ถามได้ตามปกติ
            </>
          ) : (
            "เพื่อนของ LINE Official Account ที่รับแจ้งเตือน — ระบบดึงชื่อและรูปโปรไฟล์จาก LINE อัตโนมัติ แต่ซ่อนข้อมูลส่วนตัวไว้ในหน้าสาธารณะ"
          )}
        </p>
      </div>
      <RecipientsManager users={rows} max={config.maxPushRecipients()} readOnly={!owner} />
    </div>
  );
}
