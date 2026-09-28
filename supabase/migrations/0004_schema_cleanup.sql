-- 0004_schema_cleanup.sql
-- จัดระเบียบโครงสร้างตาราง — แก้ 3 ปัญหาที่ทำให้ ER diagram อ่านยาก
--
--   1. documents.species_id เป็นคอลัมน์ตาย ไม่มี query ไหนใช้เลย
--      ความสัมพันธ์จริงคือ many-to-many ผ่าน document_species
--      (งานวิจัย 1 ชิ้นพูดถึงหลายชนิด และ 1 ชนิดถูกพูดถึงในหลายงาน)
--      เก็บไว้สองทางทำให้ไม่รู้ว่าอันไหนจริง
--
--   2. wing_feature กับ morphology_feature เก็บเรื่องเดียวกันแต่ไม่รู้จักกัน
--      wing_feature       = แคตตาล็อกลักษณะปีกระดับสกุล (7 แถว ใช้งานจริง)
--      morphology_feature = คำบรรยายรายชนิด (0 แถว) แต่พิมพ์ชื่อลักษณะซ้ำเป็น text
--      ผลคือ wing_feature กลายเป็นตารางลอยไม่เชื่อมกับใคร และถ้ากรอกข้อมูล
--      รายชนิดเข้าไป ชื่อลักษณะจะสะกดไม่ตรงกันจนจับคู่ไม่ได้
--      -> เปลี่ยนเป็น species_wing_feature ที่อ้าง wing_feature ตรง ๆ
--
--   3. predictions เก็บได้ผลเดียวต่อภาพ แต่ระบบตรวจได้หลายปีกต่อภาพแล้ว
--      ข้อมูลปีกตัวที่ 2, 3 หายไปทั้งหมด
--      -> เพิ่ม prediction_wing เก็บรายปีก
--
-- ยังไม่รัน — รันเมื่อยืนยันแล้วเท่านั้น
-- ต้องแก้โค้ดตามด้วย: lib/knowledge.ts (getSpeciesFacts, getWingFeatures)
--                     scripts/import-knowledge.mjs

begin;

-- ══════════════════════════════════════════════════════════════════
-- 1. ลบคอลัมน์ที่ไม่มีใครใช้
-- ══════════════════════════════════════════════════════════════════
alter table documents drop column if exists species_id;

-- ══════════════════════════════════════════════════════════════════
-- 2. ลักษณะปีกรายชนิด — ผูกกับแคตตาล็อกแทนการพิมพ์ชื่อซ้ำ
-- ══════════════════════════════════════════════════════════════════
create table if not exists species_wing_feature (
  species_id      bigint not null references species(id)      on delete cascade,
  wing_feature_id bigint not null references wing_feature(id) on delete cascade,
  -- คำบรรยายลักษณะนี้ "ของชนิดนี้" เช่น จุดจางบน r-m crossvein ของ guttifer ต่างจาก oxystoma อย่างไร
  description     text   not null,
  -- อ้างอิงที่มาของคำบรรยาย (ชื่อคีย์จำแนก/งานวิจัย) เพื่อให้ตรวจย้อนกลับได้
  source          text,
  primary key (species_id, wing_feature_id)
);

create index if not exists idx_species_wing_feature_species
  on species_wing_feature(species_id);

alter table species_wing_feature enable row level security;
drop policy if exists "public read species_wing_feature" on species_wing_feature;
create policy "public read species_wing_feature" on species_wing_feature
  for select using (true);

-- ย้ายข้อมูลเดิมถ้ามี (ตอนเขียนไฟล์นี้ morphology_feature มี 0 แถว
-- แต่เขียนไว้ให้ปลอดภัยเผื่อมีการ import ก่อนรัน migration)
insert into species_wing_feature (species_id, wing_feature_id, description)
select mf.species_id, wf.id, mf.description
from morphology_feature mf
join wing_feature wf on lower(wf.name_en) = lower(mf.name_en)
where mf.description is not null and mf.species_id is not null
on conflict do nothing;

drop table if exists morphology_feature;

-- ══════════════════════════════════════════════════════════════════
-- 3. ประวัติรายปีก — ระบบตรวจได้หลายปีกต่อภาพแล้ว
-- ══════════════════════════════════════════════════════════════════
create table if not exists prediction_wing (
  id            bigint generated always as identity primary key,
  prediction_id integer not null references predictions(id) on delete cascade,
  wing_index    int     not null,           -- ลำดับปีกในภาพ เรียงซ้ายไปขวา (1, 2, 3...)
  species       varchar,                    -- null = ด่าน kNN ปฏิเสธ ไม่ระบุชนิด
  confidence    double precision,
  accepted      boolean not null default false,
  knn_distance  double precision,
  knn_radius    double precision,           -- รัศมีของสถาปัตยกรรมนั้น ต่างกันแต่ละตัว
  box_x0        int,
  box_y0        int,
  box_x1        int,
  box_y1        int,
  unique (prediction_id, wing_index)
);

create index if not exists idx_prediction_wing_prediction
  on prediction_wing(prediction_id);

alter table prediction_wing enable row level security;
drop policy if exists "public read prediction_wing" on prediction_wing;
create policy "public read prediction_wing" on prediction_wing
  for select using (true);

commit;
