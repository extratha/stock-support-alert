# Stock Support Alert

ระบบแจ้งเตือนราคาหุ้น US แตะ **แนวรับ** ผ่าน LINE OA — คำนวณแนวรับอัตโนมัติจากราคาย้อนหลัง (ไม่ต้องตั้งเอง)
ออกแบบมาสำหรับติดตามพอร์ตส่วนตัว (เช่น AMD, NVDA, PLTR, TSM, AVGO) และรันบน free tier ทั้งหมด

```
GitHub Actions (cron) ──POST──▶ Vercel (Next.js API) ──▶ Twelve Data (ราคา/OHLC)
                                     │  ▲                        
                                     ▼  │                        
                                Postgres (Supabase)     LINE Push API ──▶ มือถือคุณ
                                     ▲
              LINE webhook (follow) ─┘        หน้าเว็บ: จัดการหุ้น / แนวรับ / ประวัติ
```

## สารบัญ
1. [สูตรคำนวณแนวรับ](#สูตรคำนวณแนวรับ)
2. [กติกาการแจ้งเตือน](#กติกาการแจ้งเตือน)
3. [เหตุผลที่เลือก Data Source / Database](#เหตุผลที่เลือก-tech)
4. [Setup ทีละขั้น](#setup)
5. [โครงสร้างโค้ด](#โครงสร้างโค้ด)
6. [Environment variables](#environment-variables)
7. [Push ขึ้น GitHub](#push-ขึ้น-github)

## สูตรคำนวณแนวรับ

ใช้ข้อมูลแท่งเทียนรายวัน (~260 แท่ง ≈ 1 ปี) เฉพาะ **session ที่ปิดแล้ว** (แท่งวันนี้ที่ยังไม่จบถูกตัดทิ้ง)
แล้วรวบรวมแนวรับ 4 วิธีมาตรฐาน กรองเฉพาะระดับที่ **ต่ำกว่าราคาปิดล่าสุด** ก่อนจัดลำดับ

| วิธี | สูตร | บทบาท |
|---|---|---|
| **Classic Pivot Point** | P = (H+L+C)/3 · S1 = 2P−H · S2 = P−(H−L) · S3 = L−2(H−P) จาก H/L/C ของวันก่อนหน้า | แนวรับระยะสั้นที่ "ทุกคนเห็นตรงกัน" (floor-trader pivots) |
| **Moving Average** | SMA 50 และ SMA 200 ของราคาปิด | แนวรับเชิงแนวโน้มระยะกลาง/ยาว — MA200 คือเส้นที่สถาบันดู |
| **Recent Swing Low** | จุด low ที่ต่ำกว่า low ของ 5 แท่งซ้าย-ขวา (fractal) ภายใน 60 แท่งล่าสุด เลือกอันล่าสุดที่ต่ำกว่าราคา | จุดที่ราคาเคยเด้งจริง (มีผู้ซื้อยืนยันแล้ว) |
| **Fibonacci Retracement** | ขาขึ้นล่าสุด: high สูงสุดใน 120 แท่ง และ low ต่ำสุดก่อนหน้า high นั้น → level = High − r·(High−Low), r = 38.2%, 50%, 61.8% | จุดพักตัวมาตรฐานของแนวโน้มขาขึ้น (ข้ามไปถ้า range < 10% หรือไม่มีขาขึ้น) |

### การจัดระดับความสำคัญ

| ระดับ | วิธีที่เข้าเกณฑ์ | กติกาเลือก |
|---|---|---|
| **แนวรับแรก** (Minor) | Pivot S1, MA50, Fib 38.2% | อันที่ **ใกล้ราคาปัจจุบันที่สุด** |
| **แนวรับถัดไป** (Intermediate) | Pivot S2, Swing Low, Fib 50% | อันที่สูงสุดที่ยังต่ำกว่า Minor |
| **แนวรับสำคัญ** (Major) | MA200, Fib 61.8% (สำรอง: Pivot S3) | อันที่สูงสุดที่ยังต่ำกว่า Intermediate |

**ทำไมออกแบบแบบนี้**
- *ผสมหลายวิธี* เพราะแต่ละวิธีมองคนละมุม: Pivot = ระยะสั้น, MA/Fib = โครงสร้างระยะกลาง–ยาว, Swing Low = พฤติกรรมราคาจริง
- *Major ให้น้ำหนัก MA200/Fib 61.8% ก่อน S3* เพราะ Pivot S3 คำนวณจากวันเดียวและเปลี่ยนทุกวัน จึงเป็น "สำคัญ" ได้ไม่เท่าเส้นระยะยาว — ใช้เป็น fallback เท่านั้น
- *ทุกระดับห่างกันอย่างน้อย 0.5%* กันไม่ให้ 3 ระดับซ้อนทับจนแจ้งเตือนซ้ำซ้อน
- *ระดับที่อยู่เหนือราคาถูกตัดออก* (เช่น หุ้นหลุด MA200 แล้ว เส้นนั้นกลายเป็นแนวต้านจึงไม่ถูกใช้)
- ถ้าวิธีหนึ่งไม่มีข้อมูล (หุ้นเพิ่ง IPO ไม่มี MA200) ระบบจะหยิบระดับที่ใกล้สุดจากวิธีอื่นมาแทน

โค้ดอยู่ที่ [`src/lib/support/`](src/lib/support) (pure functions มี unit test ครบ)

> ⚠️ แนวรับเป็นเครื่องมือประกอบการตัดสินใจ ไม่ใช่คำแนะนำการลงทุน

## กติกาการแจ้งเตือน

State machine แยกตาม **(หุ้น, ระดับ)** — ดู [`src/lib/alerts/evaluate.ts`](src/lib/alerts/evaluate.ts)

- **แตะ** = ราคา ≤ แนวรับ × 1.003 (รวมกรณีหลุดลงไปแล้ว)
- แจ้งเตือนแล้ว → ระดับนั้น "หยุดแจ้ง" จนกว่าราคาจะ **เด้งขึ้นเหนือแนวรับ +1%** จึง "พร้อมแจ้งใหม่"
- แตะ **คนละระดับ** → แจ้งได้ทันที (state แยกกัน) · แตะ **ระดับเดิมซ้ำหลังเด้งขึ้นไปแล้ว** → แจ้งได้อีก ไม่จำกัดครั้ง/วัน
- Cooldown ขั้นต่ำ 60 นาทีต่อ (หุ้น, ระดับ) กัน noise
- หลายระดับที่ trigger พร้อมกันในรอบเดียว **รวมเป็นข้อความเดียว** (ประหยัดโควตา push)
- ป้องกัน job ซ้อนกันด้วยการ "claim" แบบ atomic ใน DB (ไม่ยิงซ้ำแม้ cron รันทับกัน) และถ้า push ล้มเหลวจะคืนสถานะให้รอบถัดไปลองใหม่

ตัวอย่างข้อความ:
```
🔔 แจ้งเตือนแนวรับหุ้น US

NVDA แตะ "แนวรับแรก"
• ราคาปัจจุบัน: $178.20
• แนวรับ: $178.50 (MA50)
• ห่างจากแนวรับ: -0.17%
```

### สั่งดูแนวรับผ่านแชท LINE
พิมพ์หา OA ได้เลย (ตอบด้วย reply message ฟรี ไม่กินโควตา push และอ่านจากข้อมูลที่ cache ไว้ ไม่เรียก Stock API):
- `ขอแนวรับ` → แนวรับของ **ทุกตัวที่ track ในหน้าเว็บ**
- `ขอแนวรับ NVDA` หรือ `ขอแนวรับ nvda amd` → เฉพาะตัวที่ระบุ (ตัวที่ไม่ได้ track จะแจ้งว่าไม่พบ)

ถ้าตั้ง `LINE_ALLOWED_USER_IDS` ไว้ เฉพาะ userId ในรายการนั้นที่สั่งได้ — [`src/lib/line/supportCommand.ts`](src/lib/line/supportCommand.ts)

### ตลาดเปิด/ปิด (DST)
GitHub cron เป็น UTC และไม่รู้จัก DST จึงตั้งให้ครอบคลุมทั้งเวลา EDT/EST แล้วให้ endpoint ตัดสินเองด้วย
`America/New_York` ผ่าน `Intl` (ไม่ hardcode offset) รวมวันหยุด NYSE (Good Friday, Juneteenth ฯลฯ) และวัน early close 13:00
— [`src/lib/market/calendar.ts`](src/lib/market/calendar.ts)

## เหตุผลที่เลือก Tech

### Stock API → **Twelve Data (free)**
| ตัวเลือก | ราคา real-time | OHLC ย้อนหลัง | ข้อสรุป |
|---|---|---|---|
| **Twelve Data** | ✅ `/quote` | ✅ `/time_series` 1day ได้ถึง 5,000 แท่ง | **เลือก** — ฟรี 800 credit/วัน, 8/นาที, batch หลาย symbol ในคำขอเดียว, ใช้ API key |
| Finnhub | ✅ ฟรี | ❌ candle ย้อนหลังเป็น premium | ใช้คำนวณแนวรับไม่ได้ |
| Alpha Vantage | ✅ | ⚠️ ฟรีแค่ 25 คำขอ/วัน และ full history เป็น premium | ไม่พอสำหรับ MA200 + เช็คทุก 30 นาที |
| Yahoo (unofficial) | ✅ | ✅ | ไม่มี SLA, มักบล็อก IP ของ Vercel/GitHub, ไม่มี key |

**ออกแบบให้ประหยัด rate limit**
- พอร์ต 5 ตัว = `/quote` 1 คำขอ (5 credits) ต่อรอบ × ~14 รอบ/วัน ≈ 70 credits/วัน จาก 800
- ราคาที่ query แล้ว cache ในตาราง `quotes` (TTL 5 นาที) — รันซ้ำ/กดเรียกมือไม่ยิง API ซ้ำ
- แนวรับ cache ในตาราง `support_levels` และคำนวณใหม่วันละครั้ง (ข้ามถ้าข้อมูลของ session ล่าสุดมีอยู่แล้ว)
- หน้าเว็บอ่านจาก cache ล้วน ๆ ไม่เรียก API
- จำกัดจำนวนหุ้นที่ track = 8 (ปรับด้วย `MAX_TRACKED_SYMBOLS`) ให้อยู่ใน 8 credits/นาที
- เปลี่ยน provider ได้โดย implement interface `StockDataProvider` ([`src/lib/stock/types.ts`](src/lib/stock/types.ts))

> เช็ค limit ล่าสุดของ free plan ที่ https://twelvedata.com/pricing

### Database → **Supabase Postgres (free)**
เป็น Postgres ธรรมดา ใช้ผ่าน `DATABASE_URL` เดียว (ไม่ผูก SDK) ย้ายไป Neon / Vercel Postgres ได้โดยเปลี่ยนแค่ connection string
ตาราง: `symbols`, `support_levels`, `quotes`, `alert_state`, `alert_history`, `line_users` — [`src/lib/db/schema.sql`](src/lib/db/schema.sql)

## Setup

### 0. เตรียมเครื่อง
```bash
git clone https://github.com/extratha/stock-support-alert.git
cd stock-support-alert
npm install
cp .env.example .env.local
```

### 1. Twelve Data API key
สมัครฟรีที่ https://twelvedata.com → Dashboard → API Keys → ใส่ใน `STOCK_API_KEY`

### 2. Database (Supabase)
1. https://supabase.com → New project (free)
2. **Project Settings → Database → Connection string** เลือกแบบ **Transaction pooler** (พอร์ต 6543) → ใส่ใน `DATABASE_URL`
   (ถ้ามี `?sslmode=require` ก็ใส่ต่อท้าย)
3. สร้างตาราง:
   ```bash
   npm run db:migrate   # อ่าน DATABASE_URL จาก environment
   ```
   หรือ `set -a; source .env.local; set +a; npm run db:migrate`

### 3. LINE Official Account
1. https://developers.line.biz/console/ → สร้าง **Provider** → สร้าง channel ชนิด **Messaging API** (จะสร้าง OA ให้อัตโนมัติ)
2. แท็บ **Basic settings** → คัดลอก **Channel secret** → `LINE_CHANNEL_SECRET`
3. แท็บ **Messaging API** → กด Issue **Channel access token (long-lived)** → `LINE_CHANNEL_ACCESS_TOKEN`
4. ในแท็บเดียวกัน **Webhook URL** = `https://<โดเมน-vercel-ของคุณ>/api/line/webhook` → Verify → เปิด **Use webhook**
   (ทำหลัง deploy ข้อ 5)
5. ใน LINE Official Account Manager ปิด **Auto-reply messages** และ **Greeting message** (ให้ระบบเราตอบเอง)
6. สแกน QR ในแท็บ Messaging API เพื่อเพิ่มเพื่อน → ระบบจะเก็บ `userId` ของคุณอัตโนมัติ (event `follow`)

> ⚠️ **โควตา push:** แผน Free ของ LINE OA ส่งได้จำกัด (ประมาณ 200 ข้อความ/เดือน ดูแผนล่าสุดในประเทศคุณ) ระบบจึงรวมหลายแจ้งเตือนในรอบเดียวเป็นข้อความเดียว
> · ใครก็ตามที่แอด OA เป็นเพื่อนจะเป็นผู้รับ — เพื่อกันคนแปลกหน้า ให้ตั้ง `LINE_ALLOWED_USER_IDS` เป็น userId ของคุณ
> (ดู userId ได้จากตาราง `line_users` ใน Supabase)

### 4. Secrets ของระบบ
```bash
openssl rand -hex 32   # ใส่ผลลัพธ์เป็น CRON_SECRET
```
ตั้ง `ADMIN_PASSWORD` เป็นรหัสผ่านที่ยาวพอ — ใช้เข้าหน้าเว็บ (HTTP Basic: username อะไรก็ได้)

### 5. Deploy บน Vercel (free)
1. https://vercel.com/new → Import repo `extratha/stock-support-alert`
2. **Environment Variables**: ใส่ครบทุกตัวใน [ตารางด้านล่าง](#environment-variables)
3. Deploy → จดโดเมน เช่น `https://stock-support-alert.vercel.app`
4. กลับไปตั้ง LINE Webhook URL (ข้อ 3.4)
5. เปิดเว็บ → **จัดการหุ้น** → เพิ่ม `AMD`, `NVDA`, `PLTR`, `TSM`, `AVGO` (ระบบคำนวณแนวรับให้ทันที และใช้ตรวจว่า symbol ถูกต้อง) → กด **ส่งข้อความทดสอบ**

### 6. GitHub Actions cron
ที่ repo → **Settings → Secrets and variables → Actions → New repository secret**
| Secret | ค่า |
|---|---|
| `APP_URL` | `https://stock-support-alert.vercel.app` (ไม่ต้องมี `/` ท้าย) |
| `CRON_SECRET` | ค่าเดียวกับที่ตั้งใน Vercel |

หรือใช้ CLI:
```bash
gh secret set APP_URL --repo extratha/stock-support-alert
gh secret set CRON_SECRET --repo extratha/stock-support-alert
```

| Workflow | เวลา (UTC) | ทำอะไร |
|---|---|---|
| [`check-alerts.yml`](.github/workflows/check-alerts.yml) | ทุก 30 นาที 13:00–21:00 จันทร์–ศุกร์ | เช็คราคา เทียบแนวรับ ส่ง LINE (endpoint ข้ามเองถ้าตลาดปิด) |
| [`recalculate-supports.yml`](.github/workflows/recalculate-supports.yml) | 22:00 จันทร์–ศุกร์ | คำนวณแนวรับใหม่หลังตลาดปิด |

ทดสอบมือ: แท็บ **Actions → เลือก workflow → Run workflow** (ติ๊ก `force` เพื่อข้ามการเช็คเวลาตลาด)

> หมายเหตุ GitHub: cron อาจล่าช้าได้หลายนาทีช่วงคนใช้เยอะ · และ workflow ตามเวลาจะถูกปิดอัตโนมัติถ้า repo ไม่มี activity 60 วัน (เข้าไปกด enable ใหม่ได้)

### พัฒนา local
```bash
npm run dev          # http://localhost:3000 (ไม่มี ADMIN_PASSWORD = ไม่ต้อง login ใน dev)
npm test             # unit tests
npm run typecheck && npm run lint
# เรียก job มือ:
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/recalculate?force=1"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/check?force=1"
```
ทดสอบ webhook ตอน dev ด้วย tunnel เช่น `cloudflared tunnel --url http://localhost:3000`

## โครงสร้างโค้ด

```
src/
  lib/
    support/     คำนวณแนวรับ (pure, มี test)  pivot · movingAverage · swing · fibonacci · calculate (จัดระดับ)
    market/      ปฏิทิน NYSE + timezone/DST
    alerts/      evaluate (state machine) · format (ข้อความ LINE)
    stock/       StockDataProvider interface + Twelve Data adapter
    line/        signature verify · push/reply client
    db/          postgres client · schema.sql · repositories
    jobs/        recalculateSupports · checkAlerts · quotes cache · notify   ← orchestration
    auth.ts      cron bearer / admin basic auth
  app/
    page.tsx, symbols/, history/     หน้าเว็บ
    api/cron/*                       endpoint สำหรับ GitHub Actions
    api/line/webhook                 รับ follow/unfollow
    api/symbols                      เพิ่ม/ลบหุ้น
  proxy.ts                           ครอบหน้าเว็บ+API ด้วย ADMIN_PASSWORD
.github/workflows/                   cron + CI
scripts/migrate.ts                   สร้างตาราง
```
ชั้น `support/`, `market/`, `alerts/` ไม่แตะ DB/network เลย จึงเทสต์ง่ายและเปลี่ยนกติกาได้โดยไม่กระทบส่วนอื่น

## Environment variables

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ | verify signature ของ webhook |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | ส่ง push/reply |
| `STOCK_API_KEY` | ✅ | Twelve Data API key |
| `DATABASE_URL` | ✅ | Postgres connection string |
| `ADMIN_PASSWORD` | ✅ (production) | รหัสผ่านหน้าเว็บ — ถ้าไม่ตั้งใน production เว็บจะตอบ 503 |
| `CRON_SECRET` | ✅ | bearer token ของ `/api/cron/*` — ถ้าไม่ตั้งจะปฏิเสธทุกคำขอ |
| `LINE_ALLOWED_USER_IDS` | – | จำกัดผู้รับ (คั่นด้วย `,`) |
| `MAX_TRACKED_SYMBOLS` | – | ค่าเริ่มต้น 8 |
| `QUOTE_CACHE_TTL_MINUTES` | – | ค่าเริ่มต้น 5 |

## Push ขึ้น GitHub

Repo นี้ตั้ง `origin` = `https://github.com/extratha/stock-support-alert.git` ไว้แล้ว

```bash
# 1) login (ครั้งแรก) — ต้องเป็นบัญชีที่มีสิทธิ์เขียน repo ของ extratha
gh auth login                 # เลือก GitHub.com → HTTPS → Login with a web browser
gh auth status                # ตรวจว่า active account ถูกต้อง

# 2) สร้าง public repo (ข้ามถ้ามีอยู่แล้ว)
gh repo create extratha/stock-support-alert --public --source=. --remote=origin --description "US stock support-level alerts via LINE"

# 3) push
git push -u origin main
```
ถ้า `gh` login เป็นบัญชีอื่น (ไม่ใช่ `extratha`) จะสร้าง/push ไม่ได้ ให้ `gh auth login` ใหม่ด้วยบัญชี `extratha`
หรือเพิ่มบัญชีนั้นเป็น collaborator ของ repo ก่อน
