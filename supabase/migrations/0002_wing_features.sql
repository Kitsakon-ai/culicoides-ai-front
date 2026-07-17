-- 0002_wing_features.sql
-- ตาราง wing_feature: ลักษณะปีกมาตรฐานของ Culicoides (genus-level, ความรู้กีฏวิทยาจริง)
-- ใช้เป็นชุด feature ให้ /api/annotate ชี้ตำแหน่งบนภาพ แทนการให้ LLM คิดชื่อเอง
-- (สคริปต์ scripts/setup-wing-features.mjs รันเทียบเท่าไฟล์นี้ — ถ้ารันสคริปต์แล้วไม่ต้องรันไฟล์นี้ซ้ำ)

create table if not exists wing_feature (
  id          bigint generated always as identity primary key,
  name_en     text not null unique,
  name_th     text not null,
  description text,
  sort        int  not null default 0
);

alter table wing_feature enable row level security;
drop policy if exists "public read wing_feature" on wing_feature;
create policy "public read wing_feature" on wing_feature for select using (true);

insert into wing_feature (name_en, name_th, description, sort) values
  ('Wing pattern',            'ลวดลายปีก (จุดจาง/เข้ม)',     'รูปแบบจุดสีจาง–เข้มบนแผ่นปีก ตัวช่วยหลักในการจำแนกชนิด',           1),
  ('r-m crossvein',           'เส้นขวาง r-m',                'เส้นขวางเชื่อมระหว่างเส้นเรเดียส (R) กับมีเดีย (M)',                2),
  ('Radial cells (r1, r2)',   'เซลล์เรเดียล (r1, r2)',       'เซลล์บริเวณขอบหน้าปีกใกล้ปลาย costa รูปร่าง/ขนาดใช้จำแนก',        3),
  ('Costal margin',           'ขอบปีกด้านหน้า (costa)',       'ขอบปีกด้านหน้าและปลาย costa',                                     4),
  ('Macrotrichia',            'ขนใหญ่บนปีก (macrotrichia)',  'ขนใหญ่ที่กระจายบนแผ่นปีก ความหนาแน่น/การกระจายใช้จำแนก',          5),
  ('Wing apex',               'ปลายปีก',                     'ส่วนปลายสุดของปีก รูปทรงมน/แหลม',                                 6),
  ('Wing base / anal region', 'โคนปีก / บริเวณ anal',        'โคนปีกและเซลล์ anal',                                              7)
on conflict (name_en) do nothing;
