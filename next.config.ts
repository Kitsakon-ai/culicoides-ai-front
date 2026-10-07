import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // sharp ใช้ native binary — กัน bundling serverless พังบน Vercel
  // pdfkit อ่านไฟล์ข้อมูลฟอนต์ (.afm) ของตัวเองจาก node_modules ตอนรัน — ถ้าโดน bundle จะหาไฟล์ไม่เจอ
  serverExternalPackages: ["sharp", "pdfkit"],
  // ฟอนต์ไทยสำหรับ PDF ตารางเปรียบเทียบ (lib/comparison-docs.ts) อ่านด้วย fs ตอนรัน
  // ต้องบอกให้แนบไปกับฟังก์ชันบน Vercel ด้วย ไม่งั้น PDF จะพังเฉพาะตอน deploy
  outputFileTracingIncludes: {
    "/api/chat": ["./data/fonts/**"],
  },
};

export default nextConfig;
