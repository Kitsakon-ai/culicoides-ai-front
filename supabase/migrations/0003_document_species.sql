-- 0003_document_species.sql
-- join table many-to-many: document chunk ↔ species
-- เติมด้วย scripts/link-documents.mjs (จับคู่ชื่อ epithet แบบ whole-word — deterministic ไม่ใช้ LLM)
-- ใช้ให้ RAG ดึงเฉพาะงานวิจัยที่ "พูดถึงชนิดนั้นจริง" + กรอบ 5 ปีย้อนหลัง (ดู lib/knowledge.searchDocumentsForSpecies)

create table if not exists document_species (
  document_id bigint not null references documents(id) on delete cascade,
  species_id  bigint not null references species(id)  on delete cascade,
  primary key (document_id, species_id)
);

create index if not exists idx_document_species_species on document_species(species_id);

alter table document_species enable row level security;
drop policy if exists "public read document_species" on document_species;
create policy "public read document_species" on document_species for select using (true);
