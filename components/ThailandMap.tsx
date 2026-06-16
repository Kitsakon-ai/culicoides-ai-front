"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { MapPin } from "lucide-react";

const GEO_URL =
  "https://raw.githubusercontent.com/apisit/thailand.json/master/thailand.json";

// GeoJSON uses English names — map Thai province names to English
const TH_TO_EN: Record<string, string> = {
  "กรุงเทพมหานคร": "Bangkok Metropolis",
  "กระบี่": "Krabi",
  "กาญจนบุรี": "Kanchanaburi",
  "กาฬสินธุ์": "Kalasin",
  "กำแพงเพชร": "Kamphaeng Phet",
  "ขอนแก่น": "Khon Kaen",
  "จันทบุรี": "Chanthaburi",
  "ฉะเชิงเทรา": "Chachoengsao",
  "ชลบุรี": "Chon Buri",
  "ชัยนาท": "Chai Nat",
  "ชัยภูมิ": "Chaiyaphum",
  "ชุมพร": "Chumphon",
  "เชียงราย": "Chiang Rai",
  "เชียงใหม่": "Chiang Mai",
  "ตรัง": "Trang",
  "ตราด": "Trat",
  "ตาก": "Tak",
  "นครนายก": "Nakhon Nayok",
  "นครปฐม": "Nakhon Pathom",
  "นครพนม": "Nakhon Phanom",
  "นครราชสีมา": "Nakhon Ratchasima",
  "นครศรีธรรมราช": "Nakhon Si Thammarat",
  "นครสวรรค์": "Nakhon Sawan",
  "นนทบุรี": "Nonthaburi",
  "นราธิวาส": "Narathiwat",
  "น่าน": "Nan",
  "บึงกาฬ": "Bueng Kan",
  "บุรีรัมย์": "Buri Ram",
  "ปทุมธานี": "Pathum Thani",
  "ประจวบคีรีขันธ์": "Prachuap Khiri Khan",
  "ปราจีนบุรี": "Prachin Buri",
  "ปัตตานี": "Pattani",
  "พระนครศรีอยุธยา": "Phra Nakhon Si Ayutthaya",
  "พะเยา": "Phayao",
  "พังงา": "Phangnga",
  "พัทลุง": "Phatthalung",
  "พิจิตร": "Phichit",
  "พิษณุโลก": "Phitsanulok",
  "เพชรบุรี": "Phetchaburi",
  "เพชรบูรณ์": "Phetchabun",
  "แพร่": "Phrae",
  "ภูเก็ต": "Phuket",
  "มหาสารคาม": "Maha Sarakham",
  "มุกดาหาร": "Mukdahan",
  "แม่ฮ่องสอน": "Mae Hong Son",
  "ยโสธร": "Yasothon",
  "ยะลา": "Yala",
  "ร้อยเอ็ด": "Roi Et",
  "ระนอง": "Ranong",
  "ระยอง": "Rayong",
  "ราชบุรี": "Ratchaburi",
  "ลพบุรี": "Lop Buri",
  "ลำปาง": "Lampang",
  "ลำพูน": "Lamphun",
  "เลย": "Loei",
  "ศรีสะเกษ": "Si Sa Ket",
  "สกลนคร": "Sakon Nakhon",
  "สงขลา": "Songkhla",
  "สตูล": "Satun",
  "สมุทรปราการ": "Samut Prakan",
  "สมุทรสงคราม": "Samut Songkhram",
  "สมุทรสาคร": "Samut Sakhon",
  "สระแก้ว": "Sa Kaeo",
  "สระบุรี": "Saraburi",
  "สิงห์บุรี": "Sing Buri",
  "สุโขทัย": "Sukhothai",
  "สุพรรณบุรี": "Suphan Buri",
  "สุราษฎร์ธานี": "Surat Thani",
  "สุรินทร์": "Surin",
  "หนองคาย": "Nong Khai",
  "หนองบัวลำภู": "Nong Bua Lam Phu",
  "อ่างทอง": "Ang Thong",
  "อำนาจเจริญ": "Amnat Charoen",
  "อุดรธานี": "Udon Thani",
  "อุตรดิตถ์": "Uttaradit",
  "อุทัยธานี": "Uthai Thani",
  "อุบลราชธานี": "Ubon Ratchathani",
};

interface Props {
  highlightedProvinces: string[];
  species: string;
  isLoading?: boolean;
}

// Reverse map: English GeoJSON name → Thai display name
const EN_TO_TH: Record<string, string> = Object.fromEntries(
  Object.entries(TH_TO_EN).map(([th, en]) => [en, th])
);

export function ThailandMap({ highlightedProvinces, species, isLoading }: Props) {
  const [tooltip, setTooltip] = useState<{ name: string; x: number; y: number } | null>(null);
  // Convert Thai names → English to match GeoJSON "name" property
  const highlighted = new Set(
    highlightedProvinces.map((th) => TH_TO_EN[th] ?? th)
  );

  if (isLoading) {
    return (
      <div className="card-surface flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-muted-foreground">กำลังค้นหาข้อมูลการกระจายตัว...</p>
      </div>
    );
  }

  return (
    <div className="card-surface space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            การกระจายตัวของ{" "}
            <span className="italic text-accent">Culicoides {species}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            จังหวัดที่คาดว่าพบ ({highlightedProvinces.length} จังหวัด)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#3b82f6" }} />
            พบ
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#e5e7eb" }} />
            ไม่พบ
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border bg-muted/20">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 2100, center: [101, 13] }}
          width={500}
          height={650}
          style={{ width: "100%", height: "auto" }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const nameEn: string = geo.properties.name ?? "";
                const isHit = highlighted.has(nameEn);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onMouseEnter={(e) => {
                      const svg = (e.target as SVGElement).closest("svg");
                      const svgRect = svg?.getBoundingClientRect();
                      const rect = (e.target as SVGElement).getBoundingClientRect();
                      setTooltip({
                        name: EN_TO_TH[nameEn] ?? nameEn,
                        x: rect.left - (svgRect?.left ?? 0) + rect.width / 2,
                        y: rect.top - (svgRect?.top ?? 0),
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: {
                        fill: isHit ? "#3b82f6" : "#e5e7eb",
                        stroke: "#ffffff",
                        strokeWidth: 0.4,
                        outline: "none",
                      },
                      hover: {
                        fill: isHit ? "#2563eb" : "#d1d5db",
                        stroke: "#ffffff",
                        strokeWidth: 0.4,
                        outline: "none",
                        cursor: "pointer",
                      },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {tooltip && (
          <div
            className="pointer-events-none absolute rounded bg-foreground px-2 py-1 text-xs text-background shadow"
            style={{
              left: tooltip.x,
              top: tooltip.y - 4,
              transform: "translate(-50%, -100%)",
            }}
          >
            {tooltip.name}
          </div>
        )}
      </div>

      {highlightedProvinces.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {highlightedProvinces.map((p) => (
            <span
              key={p}
              className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
            >
              <MapPin className="h-2.5 w-2.5" />
              {p}
            </span>
          ))}
        </div>
      )}

      {highlightedProvinces.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-2">
          ไม่พบข้อมูลการกระจายตัวสำหรับชนิดนี้
        </p>
      )}
    </div>
  );
}
