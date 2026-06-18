# 🏸 Shuttle — Phase 1 Setup Guide

## สิ่งที่ต้องเตรียม

### 1. Google Account (สำหรับ Google Sheets + Apps Script)
- ใช้ Google Account ธรรมดาได้
- ฟรีทั้งหมด

### 2. LINE Developers Account (สำหรับ LINE Login)
- ไปที่ https://developers.line.biz
- สร้าง Provider → สร้าง LINE Login Channel
- ตั้งค่า:
  - **Channel type:** LINE Login
  - **App type:** Web app
  - **Callback URL:** `https://YOUR_DOMAIN/` (ใส่ domain จริงหลัง deploy)
  - **Scope:** `profile openid`
- จดไว้:
  - **Channel ID** → ใส่ในโค้ด frontend ตรง `LINE_CHANNEL_ID`
  - **Channel Secret** → ไม่ต้องใช้ฝั่ง frontend (PKCE flow)

### 3. Deploy Frontend
- ใช้ Vercel, Netlify, GitHub Pages หรือ hosting อะไรก็ได้ที่มี HTTPS
- อัปโหลดไฟล์ `shuttle-app.html` เป็น `index.html`
- เอา URL ที่ได้ไปใส่ใน LINE Login Channel → Callback URL

---

## ขั้นตอน Setup

### Step 1: สร้าง Google Sheet

1. สร้าง Google Sheet ใหม่
2. สร้าง 2 sheets (tabs):
   - **players** — คอลัมน์: `id | name | lineUserId | pictureUrl | createdAt`
   - **matches** — คอลัมน์: `id | player1 | player2 | player3 | player4 | winner1 | winner2 | loser1 | loser2 | reportedBy | createdAt`
3. ใส่หัวคอลัมน์ใน row 1

### Step 2: Deploy Google Apps Script

1. ใน Google Sheet → Extensions → Apps Script
2. ลบโค้ดเดิม → วาง code จากไฟล์ `google-apps-script.gs`
3. กด Deploy → New Deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy URL ที่ได้ → ใส่ในโค้ด frontend ตรง `API_BASE`

### Step 3: ตั้งค่า Frontend

1. เปิดไฟล์ `shuttle-app.html`
2. แก้ 2 ค่า:
   ```javascript
   const LINE_CHANNEL_ID = 'ใส่ Channel ID ที่ได้จาก LINE Developers';
   const API_BASE = 'ใส่ URL ที่ได้จาก Google Apps Script Deploy';
   ```
3. Deploy ขึ้น hosting

### Step 4: สร้าง QR Code

- เอา URL ของเว็บที่ deploy แล้วไปทำ QR Code
- พิมพ์ติดที่สนามแบดมินตัน
- ใครสแกนก็เปิดหน้าเว็บ → Login LINE → บันทึกผลได้เลย

---

## Flow ทั้งหมด

```
คนเล่นสแกน QR ที่สนาม
        ↓
   เปิดหน้าเว็บ
        ↓
  ยังไม่ login? → กด "เข้าสู่ระบบด้วย LINE"
        ↓
  LINE Login (ได้ชื่อ + รูป อัตโนมัติ)
        ↓
  ระบบเช็ค → มีชื่อใน DB แล้ว? → เข้าหน้าหลักเลย
              ↓ ยังไม่มี?
        สมัครอัตโนมัติ (ใช้ชื่อจาก LINE)
        ↓
    หน้าหลัก: ดูอันดับ / บันทึกผล / ดูประวัติ
        ↓
  กดบันทึกผล → เลือกคู่แข่ง → กดชนะ/แพ้ → จบ
```
