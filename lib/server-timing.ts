// จับเวลาแต่ละขั้นในฝั่ง server แล้วส่งกลับเป็น header `Server-Timing`
// → เบราว์เซอร์อ่านได้ (F12 → Network → Timing) และ lib/perf.ts เก็บลงตารางให้ด้วย
// ทำให้แยกออกว่าเวลาที่หายไปคือ "เน็ตเวิร์ก" หรือ "งานในฟังก์ชัน" — สำคัญตอนเทียบ local กับ Vercel
//
// รูปแบบมาตรฐาน: `name;dur=123, name2;dur=456` (ชื่อห้ามมีช่องว่าง)

export type ServerTimer = {
  mark: (name: string) => void;
  header: () => string;
  log: (route: string) => void;
};

export function createTimer(): ServerTimer {
  const t0 = Date.now();
  const marks: string[] = [];
  let last = t0;

  return {
    mark(name) {
      const now = Date.now();
      marks.push(`${name.replace(/\s+/g, "-")};dur=${now - last}`);
      last = now;
    },
    header() {
      return [...marks, `total;dur=${Date.now() - t0}`].join(", ");
    },
    // log ลง Vercel Runtime Logs ด้วย — เผื่อเทียบกับที่เห็นบนเบราว์เซอร์
    log(route) {
      console.log(`[perf] ${route} ${[...marks, `total;dur=${Date.now() - t0}`].join(" ")}`);
    },
  };
}
