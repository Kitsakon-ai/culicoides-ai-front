-- 0005_wing_landmarks.sql
-- เพิ่มจุดสังเกตบนปีกที่ละเอียดกว่า 7 จุดเดิมในแคตตาล็อก wing_feature
--
-- 7 จุดเดิม (0002) เป็นโครงสร้างที่ปีก Culicoides ทุกชนิดมี จึงใช้แยกชนิดไม่ได้
-- ลักษณะที่ใช้แยกชนิดจริงอยู่ที่ตำแหน่งเฉพาะกว่านั้น เช่น จุดใสใต้ stigma (guttifer ต่างจาก mahasarakhamense)
-- หรือจุดแยก mediocubital (peregrinus ในไทย)
--
-- ข้อมูลรายชนิดที่อ้างจุดเหล่านี้อยู่ใน data/knowledge/species-wing-features.json
-- รันผ่าน scripts/seed-species-wing-features.mjs แล้วไม่ต้องรันไฟล์นี้ซ้ำ (สคริปต์ทำสิ่งเดียวกัน)

insert into wing_feature (name_en, name_th, description, sort) values
  ('Pale spots below the stigma', 'จุดใสใต้ stigma',      'จุดใสที่อยู่ใต้แนวจุดเข้ม stigma (ใต้ radial cells) ในโคนของ cell r3', 8),
  ('Poststigmatic pale spot',     'จุดใสหลัง stigma',     'จุดใสบนขอบปีกด้านหน้าที่อยู่ถัดจากปลายจุดเข้ม stigma ไปทางปลายปีก',   9),
  ('Mediocubital fork',           'จุดแยก mediocubital',  'จุดที่เส้น M3+4 กับ CuA1 แยกจากกันในครึ่งหลังของปีก',                10)
on conflict (name_en) do update
  set name_th = excluded.name_th, description = excluded.description, sort = excluded.sort;
