import { RecipientsManager, type RecipientRow } from "@/components/RecipientsManager";
import { config } from "@/lib/config";
import { listUsers } from "@/lib/db/lineUsers";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function RecipientsPage() {
  const users = await listUsers();
  // Plain, pre-formatted data only (no Dates) crosses into the client component.
  const rows: RecipientRow[] = users.map((u) => ({
    userId: u.userId,
    displayName: u.displayName,
    pictureUrl: u.pictureUrl,
    label: u.label,
    active: u.active,
    notify: u.notify,
    followedAtLabel: formatDateTime(u.followedAt),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ผู้รับแจ้งเตือน</h1>
        <p className="mt-1 text-sm text-muted">
          เพื่อนของ LINE OA ทั้งหมด — เปิดรับแจ้งเตือนอัตโนมัติ (push) ได้จำกัดจำนวนเพื่อไม่ให้เกินโควตา ส่วนคนอื่นยังพิมพ์ &quot;ขอแนวรับ&quot; ถามได้ตามปกติ
        </p>
      </div>
      <RecipientsManager users={rows} max={config.maxPushRecipients()} />
    </div>
  );
}
