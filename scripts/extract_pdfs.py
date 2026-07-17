#!/usr/bin/env python
# สกัดข้อความจาก PDF ในโฟลเดอร์ AiDataSet -> แบ่งเป็น chunk -> เขียน data/knowledge/documents.json
# สำหรับนำเข้าเป็น documents (RAG) ต่อด้วย scripts/import-documents.mjs
#
# รัน (จากโฟลเดอร์ culicoides-ai-front):
#   pip install pypdf
#   python scripts/extract_pdfs.py                 # ใช้ ../AiDataSet เป็น default
#   python scripts/extract_pdfs.py <โฟลเดอร์ PDF>  # ระบุเอง

import json
import os
import re
import sys
import glob

from pypdf import PdfReader

CHUNK_SIZE = 1100
CHUNK_OVERLAP = 150
MIN_CHUNK = 200


def year_from_name(name: str):
    m = re.search(r"(19|20)\d{2}", name)
    return int(m.group(0)) if m else None


# ตัด section References/Bibliography ท้ายเปเปอร์ทิ้ง (เป็นรายการอ้างอิง ไม่ใช่เนื้อหาสำหรับ RAG)
# หา heading ตัวสุดท้ายที่อยู่ในครึ่งหลังของข้อความ (รองรับ spacing เพี้ยนจากการสกัด เช่น "REFERE NCES")
_REF_HEADING = re.compile(
    r"(?i)\b(r\s*e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s*s|bibliography|literature\s+cited)\b"
)


def strip_references(text: str) -> str:
    matches = list(_REF_HEADING.finditer(text))
    if not matches:
        return text
    last = matches[-1]
    if last.start() > len(text) * 0.55:  # อยู่ครึ่งหลัง = น่าจะเป็น section References จริง
        return text[: last.start()]
    return text


def chunk_text(text: str):
    text = text.replace("\x00", " ")  # กัน NUL byte ที่ Postgres text เก็บไม่ได้
    text = re.sub(r"\s+", " ", text).strip()
    out = []
    i = 0
    step = CHUNK_SIZE - CHUNK_OVERLAP
    while i < len(text):
        piece = text[i : i + CHUNK_SIZE].strip()
        if len(piece) >= MIN_CHUNK:
            out.append(piece)
        i += step
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # กัน UnicodeEncodeError บน Windows console
    except Exception:
        pass
    here = os.path.dirname(os.path.abspath(__file__))          # .../culicoides-ai-front/scripts
    project = os.path.dirname(here)                             # .../culicoides-ai-front
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(project, "..", "AiDataSet")
    folder = os.path.abspath(folder)

    pdfs = sorted(glob.glob(os.path.join(folder, "*.pdf")))
    if not pdfs:
        print(f"ไม่พบ PDF ใน {folder}")
        sys.exit(1)

    print(f"โฟลเดอร์: {folder}  ({len(pdfs)} ไฟล์)")
    docs = []
    for f in pdfs:
        base = os.path.splitext(os.path.basename(f))[0]
        year = year_from_name(base)
        try:
            reader = PdfReader(f)
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as e:
            print(f"  ! ข้าม {base}: {e}")
            continue

        chunks = chunk_text(strip_references(text))
        for c in chunks:
            docs.append({"content": c, "source": base, "year": year})
        flag = "" if chunks else "  ⚠️ ไม่มีข้อความ (อาจเป็น PDF สแกน ต้อง OCR)"
        print(f"  {len(reader.pages):3d} หน้า | {len(text):7d} chars | {len(chunks):3d} chunks | {base}{flag}")

    out_dir = os.path.join(project, "data", "knowledge")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "documents.json")
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(docs, fp, ensure_ascii=False, indent=1)

    print(f"\nรวม {len(docs)} chunks -> {out_path}")


if __name__ == "__main__":
    main()
