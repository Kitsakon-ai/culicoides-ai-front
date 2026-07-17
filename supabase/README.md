# Knowledge base (Supabase + pgvector)

ทำให้ AI ตอบแบบ **grounded** — ยึดข้อมูลจากฐานข้อมูลก่อน แทนที่จะเดา/มโน
(โดยเฉพาะ **จังหวัดการกระจายตัว** และ **เอกสารอ้างอิง** สำหรับ thesis)

สถาปัตยกรรมแบบ **hybrid**:

- **Structured facts** — ตาราง `species`, `species_province`, `morphology_feature`, `species_reference`
  → query ตรง ๆ แม่นยำ อ้างอิงได้ (ใช้ที่ `/api/provinces` + ยัดเข้า prompt ของ `/api/chat`)
- **RAG** — ตาราง `documents` + `pgvector` (embedding 1536 มิติ, OpenAI `text-embedding-3-small`)
  → ค้นย่อหน้างานวิจัยแบบ semantic แล้วเสริมเข้า prompt

> ทุกอย่างต่อผ่าน **Prisma + `DATABASE_URL`/`DIRECT_URL`** ที่มีอยู่แล้ว — ไม่ต้องลง dependency เพิ่ม
> ถ้ายังไม่ได้รัน migration แชต/แผนที่จะ fallback ไปพฤติกรรมเดิม (ไม่พัง)

## ขั้นตอน

### 1) รัน migration (สร้างตาราง + pgvector + RLS)

เลือกอย่างใดอย่างหนึ่ง:

- **Supabase Dashboard → SQL Editor** → วางไฟล์ `supabase/migrations/0001_knowledge_base.sql` → **Run** (ง่ายสุด)
- หรือ CLI (ใช้ `DIRECT_URL` เพราะ DDL/extension ทำผ่าน pooled ไม่ได้):
  ```bash
  npx prisma db execute --file supabase/migrations/0001_knowledge_base.sql --url "$DIRECT_URL"
  ```

### 2) นำเข้าเปเปอร์ PDF เป็น RAG documents (จากโฟลเดอร์ `AiDataSet`)

```bash
pip install pypdf
python scripts/extract_pdfs.py                    # สกัด ../AiDataSet/*.pdf -> data/knowledge/documents.json
node --env-file=.env scripts/import-documents.mjs # embed แบบ batch + insert (species_id = null = ความรู้ทั่วไป)
```

> ปัจจุบันสกัดได้ **698 chunks จาก 10 เปเปอร์ (2021–2026)** — AI จะตอบโดยอ้างอิงเปเปอร์จริงพร้อมชื่อไฟล์/ปี

### 3) structured facts รายชนิด — จังหวัด + อ้างอิง (สกัดจากเปเปอร์ด้วย LLM แล้ว review)

```bash
node --env-file=.env scripts/extract_provinces.mjs   # LLM สกัด (ชนิด, จังหวัดไทย) -> data/knowledge/species-provinces.json
node --env-file=.env scripts/extract_citations.mjs   # LLM สกัด citation ต่อเปเปอร์ -> เติม references เข้าไฟล์เดิม
#  >>> ตรวจ data/knowledge/species-provinces.json เทียบเปเปอร์ก่อน (มี source/evidence ให้ตรวจ) <<<
node --env-file=.env scripts/import-knowledge.mjs data/knowledge/species-provinces.json
```

ทำให้ `/api/provinces` ดึงจังหวัดจริงจาก DB (แม่น/เร็ว/ไม่มโน/ไม่โดน refuse) + แชตมี citation จริง
รูปแบบไฟล์ดูที่ `data/knowledge/example.json` (ใส่ `features`/`documents` เพิ่มเองได้)

> ⚠️ ข้อมูลสกัดด้วย LLM (`gpt-4o-mini`) — ควร eyeball เทียบเปเปอร์ก่อนใช้จริงในเล่ม
> Node 20.6+ รองรับ `--env-file`; เวอร์ชันเก่ากว่าให้ set `DATABASE_URL` + `OPENAI_API_KEY` เอง

## หลังนำเข้าแล้วเกิดอะไรขึ้น

- `/api/provinces` → `SELECT` จาก `species_province` ก่อน (เร็วเป็นมิลลิวินาที, แม่น, ไม่โดน LLM refuse)
  ถ้าชนิดนั้นยังไม่มีในฐานข้อมูล → fallback ไปถาม LLM เหมือนเดิม
- `/api/chat` → ก่อนเรียก LLM จะดึง facts (by species) + ค้น `documents` (semantic) แล้วยัดเป็น context
  พร้อมสั่งให้ **ตอบจากข้อมูลที่ให้ก่อน ถ้าไม่มีค่อยเสริมด้วยงานวิจัยย้อนหลังไม่เกิน 5 ปี** และห้ามกุจังหวัด

## หมายเหตุ Prisma

ตาราง knowledge ไม่ได้อยู่ใน `prisma/schema.prisma` (เข้าถึงผ่าน `$queryRaw`) เพื่อเลี่ยงความยุ่งยากของ
`vector` type ใน Prisma หากภายหลังอยากให้ Prisma รู้จักตารางเหล่านี้ ใช้ `npx prisma db pull` ได้
