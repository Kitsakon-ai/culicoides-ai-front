-- Knowledge base สำหรับให้ AI ตอบแบบ grounded (structured facts + RAG ด้วย pgvector)
--
-- วิธีรัน (เลือกอย่างใดอย่างหนึ่ง):
--   1) Supabase Dashboard → SQL Editor → วางทั้งไฟล์นี้ → Run   (แนะนำ ง่ายสุด)
--   2) npx prisma db execute --file supabase/migrations/0001_knowledge_base.sql --url "$DIRECT_URL"
--      (ใช้ DIRECT_URL ไม่ใช่ DATABASE_URL เพราะ DDL/extension ทำผ่าน pgbouncer ไม่ได้)
--
-- รันซ้ำได้ (idempotent)

create extension if not exists vector;

-- ── ชนิด (facts หลัก) ─────────────────────────────────────────
create table if not exists species (
  id              bigint generated always as identity primary key,
  scientific_name text        not null unique,   -- เช่น "Culicoides guttifer"
  genus           text        not null,
  common_name_th  text,
  summary_th      text,                           -- คำอธิบายสั้นให้ AI ใช้
  vector_role     text,                           -- บทบาทพาหะโรค
  created_at      timestamptz not null default now()
);

-- ── การกระจายตัวรายจังหวัด (แทนการให้ LLM เดา) ────────────────
create table if not exists species_province (
  species_id bigint not null references species (id) on delete cascade,
  province   text   not null,                     -- ชื่อจังหวัดภาษาไทย
  source     text,
  primary key (species_id, province)
);
create index if not exists species_province_province_idx on species_province (province);

-- ── ลักษณะปีก ─────────────────────────────────────────────────
create table if not exists morphology_feature (
  id          bigint generated always as identity primary key,
  species_id  bigint not null references species (id) on delete cascade,
  name_en     text,
  name_th     text,
  description text
);
create index if not exists morphology_feature_species_id_idx on morphology_feature (species_id);

-- ── งานอ้างอิง ────────────────────────────────────────────────
create table if not exists species_reference (
  id          bigint generated always as identity primary key,
  species_id  bigint references species (id) on delete cascade,
  citation    text not null,
  doi_or_url  text,
  year        int
);
create index if not exists species_reference_species_id_idx on species_reference (species_id);

-- ── ข้อความยาวสำหรับ RAG (semantic search) ────────────────────
create table if not exists documents (
  id         bigint generated always as identity primary key,
  species_id bigint references species (id) on delete set null,
  content    text not null,
  source     text,
  year       int,
  embedding  vector(1536)                          -- OpenAI text-embedding-3-small
);
create index if not exists documents_species_id_idx on documents (species_id);
-- HNSW index: ไม่ต้อง train, ดีกับข้อมูลที่ค่อย ๆ เพิ่ม
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- ── ฟังก์ชันค้น documents ด้วย cosine similarity (เผื่อเรียกผ่าน supabase-js RPC) ──
create or replace function match_documents(
  query_embedding   vector(1536),
  match_count       int    default 5,
  filter_species_id bigint default null
)
returns table (id bigint, species_id bigint, content text, source text, year int, similarity float)
language sql stable
as $$
  select d.id, d.species_id, d.content, d.source, d.year,
         1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.embedding is not null
    and (filter_species_id is null or d.species_id = filter_species_id)
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- ── RLS ───────────────────────────────────────────────────────
-- การเข้าถึงจริงมาจากฝั่งเซิร์ฟเวอร์ผ่าน Prisma (role postgres → bypass RLS อยู่แล้ว)
-- เปิดไว้เป็น defense-in-depth เผื่อภายหลังต่อ supabase-js ฝั่ง client
alter table species            enable row level security;
alter table species_province   enable row level security;
alter table morphology_feature enable row level security;
alter table species_reference  enable row level security;
alter table documents          enable row level security;

drop policy if exists "public read species" on species;
create policy "public read species" on species for select using (true);

drop policy if exists "public read species_province" on species_province;
create policy "public read species_province" on species_province for select using (true);

drop policy if exists "public read morphology_feature" on morphology_feature;
create policy "public read morphology_feature" on morphology_feature for select using (true);

drop policy if exists "public read species_reference" on species_reference;
create policy "public read species_reference" on species_reference for select using (true);

drop policy if exists "public read documents" on documents;
create policy "public read documents" on documents for select using (true);
