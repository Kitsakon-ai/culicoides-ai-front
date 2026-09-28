import { NextResponse } from "next/server";
import { del } from "@vercel/blob";

export const runtime = "nodejs";

// ── ลบไฟล์บน Vercel Blob ทันทีที่ใช้เสร็จ ────────────────────────────
// Blob ถูกใช้แค่เพื่อให้ OpenAI/Claude มี URL สาธารณะไปดึงภาพระหว่างตอบ
// พอตอบเสร็จแล้วไฟล์นั้นไม่มีประโยชน์อีกเลย ถ้าไม่ลบจะสะสมจนเต็มโควตา 1 GB
// (Vercel Blob ไม่มี TTL ในตัว ต่างจาก S3/R2 ที่ตั้ง lifecycle rule ได้)
//
// ลบทันทีแบบนี้ทำให้พื้นที่ที่ใช้เท่ากับจำนวน request ที่วิ่งพร้อมกันเท่านั้น
// ไม่ต้องรอ cron และไม่ติดลิมิต "วันละครั้ง" ของ Hobby plan

const BLOB_HOST = ".public.blob.vercel-storage.com";

export async function POST(req: Request) {
  try {
    const { urls } = (await req.json()) as { urls?: unknown };

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    // รับเฉพาะ URL ของ Blob เราเอง — กัน request ที่ส่ง URL มั่วมาให้ลบ
    const safe = urls.filter(
      (u): u is string => typeof u === "string" && u.includes(BLOB_HOST)
    );

    if (safe.length === 0) return NextResponse.json({ deleted: 0 });

    await del(safe);
    return NextResponse.json({ deleted: safe.length });
  } catch (error) {
    // ลบไม่สำเร็จไม่ควรทำให้ผู้ใช้เห็น error — ผลลัพธ์ที่เขาต้องการได้ไปแล้ว
    // อย่างแย่ที่สุดคือมีไฟล์ค้าง ซึ่งไม่กระทบการใช้งาน
    console.error("POST /api/blob-delete error:", error);
    return NextResponse.json({ deleted: 0 }, { status: 200 });
  }
}
