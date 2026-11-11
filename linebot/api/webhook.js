/**
 * Vercel Function — LINE webhook ของ bot ตรวจสลิป
 * URL หลัง deploy: https://<project>.vercel.app/api/webhook
 * ค่าลับทั้งหมดอยู่ใน Environment Variables ของ Vercel (ห้ามใส่ในไฟล์ — repo นี้เป็น public)
 */
import jpeg from 'jpeg-js';
import jsQRModule from 'jsqr';
import { handleWebhook } from '../lib/core.js';

const jsQR = jsQRModule.default || jsQRModule;

export const config = { maxDuration: 30 };

/** รูป JPEG → ข้อความใน QR (ไม่มี QR / ไม่ใช่ JPEG → null) */
function decodeQr(bytes){
  if(!(bytes[0] === 0xFF && bytes[1] === 0xD8)) return null;
  try{
    const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512, maxResolutionInMP: 40 });
    const found = jsQR(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength),
                       img.width, img.height);
    return found ? found.data : null;
  }catch(e){
    console.error('[decodeQr] failed', e);
    return null;
  }
}

export default {
  async fetch(request){
    if(request.method !== 'POST') return new Response('slip bot ok', { status: 200 });
    const rawBody = await request.text();
    const out = await handleWebhook(
      { rawBody, signature: request.headers.get('x-line-signature') || '' },
      process.env,
      { fetchFn: fetch, decodeQr });
    console.log('[webhook]', out.status, out.results.join(','));
    return new Response(JSON.stringify({ ok: out.status === 200 }), {
      status: out.status, headers: { 'content-type': 'application/json' },
    });
  },
};
