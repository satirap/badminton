# LINE bot ตรวจสลิป — ก๊วนอยากตี ต้องได้ตี

สมาชิกโพสต์สลิปในกลุ่ม LINE เหมือนเดิม → bot อ่าน QR บนสลิป → ตรวจกับ API ตรวจสลิป →
บันทึกลง Firestore `slip_payments` → หน้า `payment.html` (admin mode) ติ๊ก "โอน" ให้เอง
หรือขึ้น "🧾 สลิปรอแอดมินตรวจ" ถ้าต้องให้คนตัดสิน

```
สมาชิกส่งรูปสลิปในกลุ่ม
        ↓ webhook
Vercel Function (โฟลเดอร์นี้)
   1. ตรวจลายเซ็นของ LINE
   2. หา QR ในรูป — ไม่มี QR / ไม่ใช่ QR สลิป → เงียบ ไม่ทำอะไร
   3. เคยส่งแล้ว (transRef ซ้ำ) → แจ้งซ้ำ จบ
   4. ส่ง "ข้อความใน QR" ไป API ตรวจสลิป → ได้ชื่อผู้โอน ยอด เวลา ผู้รับ
   5. เพิ่มเอกสารใหม่ slip_payments/{transRef}  (status: new)
        ↓ realtime
payment.html (admin mode)
   - ยอด = 1 คนพอดี + เคยจำผู้โอนคนนี้ + ตรวจผ่าน  → ติ๊กโอนอัตโนมัติ
   - โอนรวมหลายคน / ยอดไม่ลงตัว / ยังไม่รู้จัก / ผิดบัญชี → รอแอดมินเลือกชื่อ
   - ทุกครั้งที่แอดมินยืนยัน ระบบจำ "ผู้โอน → ชื่อที่ลงเล่น" ไว้ใช้รอบหน้า (slip_aliases)
```

## สิ่งที่ bot ทำ / ไม่ทำกับข้อมูล

- เพิ่มเอกสารใหม่ใน `slip_payments` เท่านั้น **ไม่แตะ `payment_sessions`** และไม่ลบอะไร
- รูปในกลุ่มไม่ถูกส่งออกไปที่ไหน ส่งเฉพาะข้อความใน QR ของสลิปไปให้ API ตรวจสลิป
- ข้อความแชททั่วไปไม่ถูกเก็บ ยกเว้นข้อความที่คนเดิมพิมพ์ภายใน 3 นาทีหลังส่งสลิป
  (เช่น "ของจิ๊บกับบอย") จะแนบเป็นหมายเหตุของสลิปใบนั้นให้แอดมินเห็น
- ไม่เก็บเลขบัญชีผู้โอน

## ติดตั้ง (ทำครั้งเดียว)

### 1. LINE Official Account + Messaging API
1. สร้าง LINE OA ที่ https://manager.line.biz แล้วเปิดใช้ **Messaging API**
   (เลือก Provider เดียวกับ LIFF ของแอปนี้)
2. OA Manager → ตั้งค่า → ตั้งค่าบัญชี → เปิด **"อนุญาตให้เข้าร่วมกลุ่ม"**
3. OA Manager → ตั้งค่าการตอบกลับ → ปิดข้อความตอบกลับอัตโนมัติ/ข้อความทักทาย · เปิด **Webhook**
4. https://developers.line.biz → channel นี้ จดไว้ 2 ค่า (ห้ามใส่ในไฟล์ใน repo):
   - Basic settings → **Channel secret**
   - Messaging API → **Channel access token (long-lived)** → Issue

### 2. API ตรวจสลิป (เลือก 1 เจ้า)
- **SlipOK** https://slipok.com — ได้ `BRANCH_ID` กับ `API_KEY`
- **EasySlip** https://easyslip.com — ได้ `API_KEY` (ต้องยืนยันตัวตนก่อนใช้)

ดูโควตาฟรี/ราคาปัจจุบันที่หน้าเว็บของผู้ให้บริการก่อนเลือก

### 3. Deploy บน Vercel (ฟรี · ไม่ต้องลงโปรแกรมในเครื่อง)
1. https://vercel.com → Login ด้วย GitHub → **Add New → Project** → เลือก repo `badminton`
2. **Root Directory = `linebot`** · Framework Preset = Other
3. ใส่ Environment Variables ตามตารางด้านล่าง → Deploy
4. จะได้ URL เช่น `https://badminton-slip-bot.vercel.app` — เปิดดูที่ `/api/webhook` ต้องเห็น `slip bot ok`

| ชื่อ | ค่า | จำเป็น |
|---|---|---|
| `LINE_CHANNEL_SECRET` | Channel secret | ✅ |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token | ✅ |
| `FIREBASE_PROJECT_ID` | `badminton-642a3` | ✅ |
| `FIREBASE_API_KEY` | ค่า `apiKey` เดียวกับใน `payment.html` | ✅ |
| `SLIP_PROVIDER` | `slipok` (ค่าเริ่มต้น) หรือ `easyslip` | |
| `SLIPOK_BRANCH_ID` / `SLIPOK_API_KEY` | จาก SlipOK | ถ้าใช้ SlipOK |
| `EASYSLIP_API_KEY` | จาก EasySlip | ถ้าใช้ EasySlip |
| `RECEIVER_MATCH` | คำที่ต้องพบในผู้รับ คั่นด้วย `,` — ชื่อ (เช่น ชื่อจริงเจ้าของบัญชี) หรือเลขท้ายบัญชี (เช่น `2960`) | แนะนำ |
| `LINE_GROUP_ID` | Group ID ของกลุ่มก๊วน (ได้จากขั้นที่ 5) | แนะนำ |
| `REPLY_MODE` | `all` ตอบทุกสลิป (ค่าเริ่มต้น) · `problems` ตอบเฉพาะที่มีปัญหา · `off` ไม่ตอบ | |

### 4. ผูก Webhook
LINE Developers → Messaging API → Webhook URL = `https://<โปรเจกต์>.vercel.app/api/webhook`
→ กด **Verify** ต้องขึ้น Success → เปิด **Use webhook**

### 5. เชิญ bot เข้ากลุ่ม
เชิญ OA เข้ากลุ่มก๊วน → bot จะตอบ **Group ID** ของกลุ่ม → นำไปใส่ `LINE_GROUP_ID` ใน Vercel
→ Redeploy (หลังจากนี้ bot จะทำงานเฉพาะกลุ่มนี้ และไม่ตอบ Group ID อีก)

### 6. ทดสอบ
1. ส่งสลิปจริง 1 ใบในกลุ่ม → bot ตอบ `✅ รับสลิป … บาท`
2. เปิด `payment.html` → ปลดล็อก admin → แท็บรับเงิน → เห็น "🧾 สลิปรอแอดมินตรวจ"
3. ส่งสลิปเดิมซ้ำ → bot ตอบว่าเคยส่งแล้ว
4. ส่งรูปทั่วไป → bot ต้องเงียบ

ดู log ได้ที่ Vercel → Project → Logs (บรรทัด `[webhook] 200 stored` ฯลฯ)

## ข้อจำกัดที่ควรรู้

- การติ๊กอัตโนมัติเกิดเมื่อมีเครื่องที่เปิด `payment.html` ใน **admin mode** อยู่
  ถ้าไม่มีใครเปิด สลิปจะรอไว้ แล้วจับคู่ทันทีที่แอดมินเปิดหน้า
- รอบแรก ๆ ระบบยังไม่รู้จักใคร แอดมินต้องเลือกชื่อเองก่อน 1 ครั้งต่อผู้โอน
- ถ้า API ตรวจสลิปล่ม/โควตาหมด สลิปยังถูกเก็บ แต่ขึ้นว่า "ยังไม่ได้ตรวจกับธนาคาร" และไม่ติ๊กเอง
- สลิปบางธนาคาร (BBL, SCB บางช่วง) ตรวจได้ช้ากว่าเวลาโอนไม่กี่นาที — จะเข้าเคสข้างบน
- Firestore ของโปรเจกต์นี้ยังเปิดอ่าน/เขียนได้โดยไม่ต้อง login ชื่อผู้โอนในสลิปจึงอ่านได้
  โดยคนที่รู้ project id เช่นเดียวกับข้อมูลรอบเก็บเงินเดิม
