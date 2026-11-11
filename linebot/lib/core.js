/**
 * LINE slip bot — core logic (ไม่ผูกกับ platform: ใช้ได้ทั้ง Node 20+ และ browser สำหรับทดสอบ)
 *
 * หน้าที่: รับ webhook จาก LINE → หา QR ในรูปสลิป → ตรวจกับ API ตรวจสลิป
 *          → เพิ่มเอกสารใหม่ใน Firestore `slip_payments/{transRef}`
 *
 * กติกาความปลอดภัยของข้อมูล:
 *   - bot "เพิ่มเอกสารใหม่" ใน slip_payments เท่านั้น ไม่แตะ payment_sessions เลย
 *     (การติ๊ก "โอนแล้ว" ทำที่ payment.html ผ่านทางบันทึกเดิมของแอป)
 *   - ไม่ลบข้อมูล · แก้ได้ field เดียวคือ `note` ของสลิปที่ยังรอจับคู่
 *   - รูปไม่ถูกส่งออกไปไหน: ส่งเฉพาะข้อความใน QR ไปให้ API ตรวจสลิป
 *   - ไม่เก็บเลขบัญชีผู้โอน
 */

export const SLIP_COLLECTION = 'slip_payments';
const NOTE_WINDOW_MS = 3 * 60 * 1000;   // ข้อความภายใน 3 นาทีหลังส่งสลิป = หมายเหตุของสลิปนั้น
const NOTE_MAX = 200;

/* ───────────────────────── LINE signature ───────────────────────── */

function bytesToBase64(bytes){
  let s = '';
  for(const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** ตรวจ X-Line-Signature = base64(HMAC-SHA256(channelSecret, rawBody)) */
export async function verifyLineSignature(rawBody, signature, channelSecret){
  if(!signature || !channelSecret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(channelSecret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const expected = bytesToBase64(mac);
  if(expected.length !== signature.length) return false;
  let diff = 0;                                   // เทียบแบบเวลาคงที่
  for(let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/* ───────────────────────── Slip QR (mini-QR) ───────────────────────── */

/** แยก TLV: tag 2 หลัก + ความยาว 2 หลัก + ค่า · คืน null ถ้ารูปแบบไม่ถูก */
export function parseTlv(s){
  const out = {};
  let i = 0;
  if(typeof s !== 'string' || !s) return null;
  while(i < s.length){
    if(i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if(!/^\d{2}$/.test(tag) || !Number.isInteger(len)) return null;
    const val = s.slice(i + 4, i + 4 + len);
    if(val.length !== len) return null;
    out[tag] = val;
    i += 4 + len;
  }
  return out;
}

/** QR บนสลิปธนาคารไทย → { sendingBank, transRef } · ไม่ใช่ QR สลิป → null */
export function parseSlipQr(payload){
  const top = parseTlv((payload || '').trim());
  if(!top || !top['00']) return null;
  const sub = parseTlv(top['00']);
  if(!sub || sub['00'] !== '000001') return null;       // API ID ของ slip verification
  const transRef = sub['02'] || '';
  if(!/^[A-Za-z0-9]{10,40}$/.test(transRef)) return null;
  return { sendingBank: sub['01'] || '', transRef };
}

/* ───────────────────────── Slip verification providers ───────────────────────── */

function toNumber(v){
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** SlipOK: วันที่ yyyyMMdd + เวลา HH:mm:ss (เวลาไทย) → ISO */
function slipokTime(d){
  if(d.transTimestamp) return d.transTimestamp;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d.transDate || '');
  if(!m || !/^\d{2}:\d{2}:\d{2}$/.test(d.transTime || '')) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${d.transTime}+07:00`;
}

async function verifyWithSlipOk(payload, env, fetchFn){
  const res = await fetchFn(`https://api.slipok.com/api/line/apikey/${env.SLIPOK_BRANCH_ID}`, {
    method: 'POST',
    headers: { 'x-authorization': env.SLIPOK_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ data: payload, log: false }),
  });
  const j = await res.json().catch(() => ({}));
  if(res.ok && j.success && j.data){
    const d = j.data;
    return { ok: true, slip: {
      transRef:        d.transRef || '',
      amount:          toNumber(d.amount),
      senderName:      (d.sender && (d.sender.displayName || d.sender.name)) || '',
      sendingBank:     d.sendingBank || '',
      receiverName:    (d.receiver && (d.receiver.displayName || d.receiver.name)) || '',
      receiverAccount: (d.receiver && ((d.receiver.account && d.receiver.account.value) ||
                                       (d.receiver.proxy && d.receiver.proxy.value))) || '',
      transAt:         slipokTime(d),
    }};
  }
  const code = String(j.code || res.status);
  // 1007/1008/1011 = ไม่ใช่สลิปจริง/QR หมดอายุ · ที่เหลือ = ระบบ/โควตา/ตั้งค่า (ให้แอดมินตรวจเอง)
  const fake = ['1007', '1008', '1011'].includes(code);
  return { ok: false, fake, code, message: j.message || '' };
}

async function verifyWithEasySlip(payload, env, fetchFn){
  const res = await fetchFn(`https://api.easyslip.com/v1/verify?payload=${encodeURIComponent(payload)}`, {
    headers: { authorization: `Bearer ${env.EASYSLIP_API_KEY}` },
  });
  const j = await res.json().catch(() => ({}));
  const d = j.data;
  if((res.ok || j.message === 'duplicate_slip') && d){
    const acct = p => (p && p.account) || {};
    const name = p => (acct(p).name && (acct(p).name.th || acct(p).name.en)) || '';
    const num  = p => (acct(p).bank && acct(p).bank.account) || (acct(p).proxy && acct(p).proxy.account) || '';
    return { ok: true, slip: {
      transRef:        d.transRef || '',
      amount:          toNumber(d.amount && d.amount.amount),
      senderName:      name(d.sender),
      sendingBank:     (d.sender && d.sender.bank && d.sender.bank.id) || '',
      receiverName:    name(d.receiver),
      receiverAccount: num(d.receiver),
      transAt:         d.date || null,
    }};
  }
  const code = String(j.message || res.status);
  return { ok: false, fake: code === 'slip_not_found', code, message: code };
}

export async function verifySlip(payload, env, fetchFn){
  try{
    const provider = (env.SLIP_PROVIDER || 'slipok').toLowerCase();
    if(provider === 'easyslip') return await verifyWithEasySlip(payload, env, fetchFn);
    if(provider === 'slipok')   return await verifyWithSlipOk(payload, env, fetchFn);
    return { ok: false, fake: false, code: 'no_provider', message: `unknown SLIP_PROVIDER ${provider}` };
  }catch(e){
    return { ok: false, fake: false, code: 'network', message: String(e && e.message || e) };
  }
}

/** ผู้รับในสลิปตรงกับบัญชีก๊วนไหม · RECEIVER_MATCH = คำที่ต้องพบ คั่นด้วย , (ชื่อ หรือเลขท้ายบัญชี)
 *  คืน true/false · ไม่ได้ตั้งค่า → null (ไม่ตรวจ) */
export function receiverMatches(slip, receiverMatch){
  const keys = (receiverMatch || '').split(',').map(s => s.trim()).filter(Boolean);
  if(!keys.length) return null;
  const squash = s => (s || '').replace(/\s+/g, '').toLowerCase();
  const name = squash(slip.receiverName);
  const digits = (slip.receiverAccount || '').replace(/\D/g, '');
  return keys.some(k => {
    const kd = k.replace(/\D/g, '');
    if(kd && kd.length === k.replace(/[\s-]/g, '').length) return digits.endsWith(kd);   // เป็นตัวเลขล้วน
    return name.includes(squash(k));
  });
}

/* ───────────────────────── Firestore REST ───────────────────────── */

function fsBase(env){
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function fsValue(v){
  if(v === null || v === undefined) return { nullValue: null };
  if(v instanceof Date) return { timestampValue: v.toISOString() };
  if(typeof v === 'boolean') return { booleanValue: v };
  if(typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

function fsFields(obj){
  const f = {};
  for(const [k, v] of Object.entries(obj)) f[k] = fsValue(v);
  return f;
}

async function fsExists(env, fetchFn, path){
  const res = await fetchFn(`${fsBase(env)}/${path}?key=${env.FIREBASE_API_KEY}&mask.fieldPaths=status`);
  if(res.status === 404) return false;
  if(res.ok) return true;
  throw new Error(`firestore get ${res.status}`);
}

/** สร้างเอกสารใหม่เท่านั้น — มีอยู่แล้วคืน 'exists' (ไม่เขียนทับ) */
async function fsCreate(env, fetchFn, collection, id, data){
  const res = await fetchFn(
    `${fsBase(env)}/${collection}?documentId=${encodeURIComponent(id)}&key=${env.FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: fsFields(data) }),
    });
  if(res.status === 409) return 'exists';
  if(!res.ok) throw new Error(`firestore create ${res.status}`);
  return 'created';
}

/** สลิปที่ยังรอจับคู่ของ user คนนี้ (ล่าสุด ภายในช่วงเวลา note) */
async function fsFindRecentNewSlip(env, fetchFn, lineUserId, now){
  const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } });
  const res = await fetchFn(`${fsBase(env)}:runQuery?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: SLIP_COLLECTION }],
      where: { compositeFilter: { op: 'AND', filters: [eq('lineUserId', lineUserId), eq('status', 'new')] } },
      limit: 20,
    }}),
  });
  if(!res.ok) throw new Error(`firestore query ${res.status}`);
  const rows = await res.json();
  let best = null;
  for(const r of rows){
    const doc = r.document;
    if(!doc) continue;
    const t = Date.parse(doc.fields && doc.fields.receivedAt && doc.fields.receivedAt.timestampValue || '');
    if(!Number.isFinite(t) || now - t > NOTE_WINDOW_MS || now < t) continue;
    if(!best || t > best.t) best = { t, name: doc.name, note: (doc.fields.note && doc.fields.note.stringValue) || '' };
  }
  return best;
}

async function fsSetNote(env, fetchFn, docName, note){
  const res = await fetchFn(
    `https://firestore.googleapis.com/v1/${docName}?key=${env.FIREBASE_API_KEY}` +
    `&updateMask.fieldPaths=note&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: fsFields({ note }) }),
    });
  if(!res.ok) throw new Error(`firestore note ${res.status}`);
}

/* ───────────────────────── LINE API ───────────────────────── */

async function lineGetImage(env, fetchFn, messageId){
  const res = await fetchFn(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if(!res.ok) throw new Error(`line content ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function lineDisplayName(env, fetchFn, source){
  try{
    if(!source.userId) return '';
    const url = source.groupId
      ? `https://api.line.me/v2/bot/group/${source.groupId}/member/${source.userId}`
      : `https://api.line.me/v2/bot/profile/${source.userId}`;
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
    if(!res.ok) return '';
    return (await res.json()).displayName || '';
  }catch(e){ return ''; }
}

async function lineReply(env, fetchFn, replyToken, text){
  if(!replyToken || !text) return;
  try{
    await fetchFn('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  }catch(e){ console.error('[reply] failed', e); }
}

/* ───────────────────────── Event handling ───────────────────────── */

function fmtAmount(n){
  return n === null ? '?' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** REPLY_MODE: all (ค่าเริ่มต้น) = ตอบทุกสลิป · problems = ตอบเฉพาะที่มีปัญหา · off = ไม่ตอบเลย */
function shouldReply(env, isProblem){
  const mode = (env.REPLY_MODE || 'all').toLowerCase();
  return mode === 'all' || (mode === 'problems' && isProblem);
}

function inAllowedGroup(env, source){
  if(!source || source.type !== 'group') return false;
  return !env.LINE_GROUP_ID || source.groupId === env.LINE_GROUP_ID;
}

async function handleImage(event, env, deps){
  const { fetchFn, decodeQr, now } = deps;
  const msg = event.message;
  if(msg.contentProvider && msg.contentProvider.type !== 'line') return 'skip:external';

  const bytes = await lineGetImage(env, fetchFn, msg.id);
  const payload = decodeQr(bytes);
  if(!payload) return 'skip:no-qr';                       // รูปทั่วไป → เงียบ ไม่ส่งออกไปไหน
  const qr = parseSlipQr(payload);
  if(!qr) return 'skip:not-slip-qr';

  const path = `${SLIP_COLLECTION}/${qr.transRef}`;
  if(await fsExists(env, fetchFn, path)){
    if(shouldReply(env, true)) await lineReply(env, fetchFn, event.replyToken, '⚠️ สลิปนี้เคยส่งมาแล้ว (ไม่นับซ้ำ)');
    return 'duplicate';
  }

  const v = await verifySlip(payload, env, fetchFn);
  if(!v.ok && v.fake){
    if(shouldReply(env, true)) await lineReply(env, fetchFn, event.replyToken,
      '❌ ตรวจสลิปนี้กับธนาคารไม่ผ่าน กรุณาส่งสลิปใหม่ หรือแจ้งแอดมิน');
    return `rejected:${v.code}`;
  }

  const slip = v.ok ? v.slip : null;
  const receiverOk = slip ? receiverMatches(slip, env.RECEIVER_MATCH) : null;
  const lineName = await lineDisplayName(env, fetchFn, event.source);
  const transAt = slip && slip.transAt && Number.isFinite(Date.parse(slip.transAt)) ? new Date(slip.transAt) : null;

  const created = await fsCreate(env, fetchFn, SLIP_COLLECTION, qr.transRef, {
    transRef:    qr.transRef,
    sendingBank: (slip && slip.sendingBank) || qr.sendingBank,
    amount:      slip ? slip.amount : null,
    senderName:  slip ? slip.senderName : '',
    verified:    !!slip,
    verifyError: slip ? '' : v.code,
    receiverOk,
    transAt,
    lineUserId:  event.source.userId || '',
    lineName,
    groupId:     event.source.groupId || '',
    messageId:   msg.id,
    receivedAt:  new Date(now),
    status:      'new',
    note:        '',
  });
  if(created === 'exists'){
    if(shouldReply(env, true)) await lineReply(env, fetchFn, event.replyToken, '⚠️ สลิปนี้เคยส่งมาแล้ว (ไม่นับซ้ำ)');
    return 'duplicate';
  }

  if(!slip){
    if(shouldReply(env, true)) await lineReply(env, fetchFn, event.replyToken,
      '🧾 รับสลิปแล้ว แต่ยังตรวจยอดอัตโนมัติไม่ได้ แอดมินจะตรวจให้');
    return `stored-unverified:${v.code}`;
  }
  if(receiverOk === false){
    if(shouldReply(env, true)) await lineReply(env, fetchFn, event.replyToken,
      `⚠️ สลิป ${fmtAmount(slip.amount)} บาท ไม่ได้โอนเข้าบัญชีก๊วน รอแอดมินตรวจ`);
    return 'stored-wrong-receiver';
  }
  if(shouldReply(env, false)) await lineReply(env, fetchFn, event.replyToken,
    `✅ รับสลิป ${fmtAmount(slip.amount)} บาท${slip.senderName ? `\nจาก ${slip.senderName}` : ''}`);
  return 'stored';
}

/** ข้อความที่พิมพ์ตามหลังสลิป (เช่น "ของจิ๊บกับบอย") → เก็บเป็นหมายเหตุให้แอดมินเห็น */
async function handleText(event, env, deps){
  const { fetchFn, now } = deps;
  const text = (event.message.text || '').trim();
  if(!text || !event.source.userId) return 'skip:empty';
  const recent = await fsFindRecentNewSlip(env, fetchFn, event.source.userId, now);
  if(!recent) return 'skip:no-recent-slip';               // ข้อความคุยทั่วไป → ไม่เก็บ
  const note = (recent.note ? recent.note + ' / ' : '') + text;
  await fsSetNote(env, fetchFn, recent.name, note.slice(0, NOTE_MAX));
  return 'note';
}

async function handleEvent(event, env, deps){
  if(event.type === 'join' && event.source && event.source.type === 'group'){
    // ช่วยตอนตั้งค่า: บอก Group ID ครั้งแรกที่เชิญ bot เข้ากลุ่ม (เฉพาะตอนยังไม่ได้ล็อกกลุ่ม)
    if(!env.LINE_GROUP_ID){
      await lineReply(env, deps.fetchFn, event.replyToken,
        `🏸 bot ตรวจสลิปพร้อมใช้งาน\nGroup ID ของกลุ่มนี้:\n${event.source.groupId}\n(นำไปใส่ค่า LINE_GROUP_ID เพื่อล็อกให้ทำงานเฉพาะกลุ่มนี้)`);
    }
    return 'join';
  }
  if(event.type !== 'message' || !inAllowedGroup(env, event.source)) return 'skip';
  if(event.message.type === 'image') return handleImage(event, env, deps);
  if(event.message.type === 'text')  return handleText(event, env, deps);
  return 'skip';
}

/**
 * จุดเข้าเดียวของ webhook
 * @param {{rawBody:string, signature:string}} req
 * @param {object} env   ค่าตั้ง (ดู README)
 * @param {{fetchFn:Function, decodeQr:(bytes:Uint8Array)=>string|null, now?:number}} deps
 * @returns {{status:number, results:string[]}}
 */
export async function handleWebhook(req, env, deps){
  if(!(await verifyLineSignature(req.rawBody, req.signature, env.LINE_CHANNEL_SECRET))){
    return { status: 401, results: ['bad-signature'] };
  }
  let body;
  try{ body = JSON.parse(req.rawBody); }catch(e){ return { status: 400, results: ['bad-json'] }; }
  const d = { ...deps, now: deps.now || Date.now() };
  const results = [];
  for(const event of (body.events || [])){
    try{ results.push(await handleEvent(event, env, d)); }
    catch(e){ console.error('[event] failed', e); results.push('error:' + (e && e.message || e)); }
  }
  // ตอบ 200 เสมอเมื่อลายเซ็นถูก — LINE ไม่ต้องส่งซ้ำ (กันสลิปเดิมถูกประมวลผลวน)
  return { status: 200, results };
}
