"use client";

// ── Client-side profiler สำหรับเก็บเวลาแต่ละขั้นตอนไปทำเล่มวิจัย ─────────
// วัดจากฝั่งเบราว์เซอร์ (F12 → Console) เพราะเป็นเวลาที่ผู้ใช้เจอจริง
// และเทียบ local กับ Vercel ได้ตรง ๆ ด้วยโค้ดชุดเดียวกัน
//
// ใช้ใน console:
//   __culiPerf          → ข้อมูลดิบทุกรอบ (array)
//   __culiPerfTable()   → ตารางสรุปทุกรอบ
//   __culiPerfCsv()     → CSV ก๊อปไปวาง Excel/SPSS ได้เลย (copy(__culiPerfCsv()))
//   __culiPerfClear()   → ล้างข้อมูล

export type PerfStep = {
  run: number;
  step: string;
  ms: number;
  reqKB: number | null;
  resKB: number | null;
  note: string;
  server: string | null; // Server-Timing header (เวลาที่วัดจากฝั่ง server)
  ok: boolean;
};

export type PerfRun = {
  id: number;
  label: string;
  startedAt: string;
  host: string;
  meta: Record<string, unknown>;
  steps: PerfStep[];
  totalMs: number | null;
};

const runs: PerfRun[] = [];
let current: PerfRun | null = null;
let currentT0 = 0;
let seq = 0;

const isBrowser = typeof window !== "undefined";

const fmt = (ms: number) => Math.round(ms).toLocaleString("en-US");
const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

// ── ขนาด payload (ใช้ดูว่าใกล้ลิมิต 4.5 MB ของ Vercel หรือยัง) ────────────
export function bodyBytes(body: BodyInit | null | undefined): number | null {
  if (!body) return null;
  if (typeof body === "string") return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) {
    let total = 0;
    body.forEach((value, key) => {
      total += key.length;
      total += value instanceof File ? value.size : String(value).length;
    });
    return total;
  }
  return null;
}

export function perfBeginRun(label: string, meta: Record<string, unknown> = {}) {
  if (!isBrowser) return;
  if (current) perfEndRun();

  current = {
    id: ++seq,
    label,
    startedAt: new Date().toISOString(),
    host: window.location.host,
    meta,
    steps: [],
    totalMs: null,
  };
  currentT0 = performance.now();
  runs.push(current);

  const env = window.location.hostname === "localhost" ? "LOCAL" : "DEPLOYED";
  console.log(
    `%c▶ RUN #${current.id} · ${label} · ${env} (${current.host})%c\n  ${JSON.stringify(meta)}`,
    "color:#0ea5e9;font-weight:bold",
    "color:#64748b"
  );
}

// เริ่ม run ใหม่เฉพาะเมื่อยังไม่มี run ค้างอยู่ (กรณี regenerate คำอธิบายเดี่ยว ๆ)
export function perfEnsureRun(label: string, meta: Record<string, unknown> = {}) {
  if (!isBrowser || current) return;
  perfBeginRun(label, meta);
}

export function perfMeta(extra: Record<string, unknown>) {
  if (current) Object.assign(current.meta, extra);
}

export function perfEndRun() {
  if (!isBrowser || !current) return;
  const run = current;
  run.totalMs = performance.now() - currentT0;
  current = null;

  const sum = run.steps.reduce((a, s) => a + s.ms, 0);
  console.log(
    `%c■ RUN #${run.id} จบใน ${fmt(run.totalMs)} ms  (รวมเวลาในแต่ละขั้น ${fmt(sum)} ms — ต่างกันคือส่วนที่ทำขนานกัน)`,
    "color:#0ea5e9;font-weight:bold"
  );
  console.table(
    run.steps.map((s) => ({
      step: s.step,
      ms: Math.round(s.ms),
      "req KB": s.reqKB,
      "res KB": s.resKB,
      "server-timing": s.server,
      note: s.note,
      ok: s.ok,
    }))
  );
}

export type PerfCtx = {
  note: (s: string) => void;
  req: (bytes: number | null) => void;
  res: (bytes: number | null) => void;
  server: (header: string | null) => void;
  lap: (label: string) => void; // จับเวลาย่อยระหว่างทาง เช่น ttfb / first-token
};

// ครอบการเรียก API 1 ครั้ง → ได้ 1 แถวใน console (log ทันทีที่จบ ไม่ต้องรอทั้ง run)
export async function perfCall<T>(step: string, fn: (ctx: PerfCtx) => Promise<T>): Promise<T> {
  if (!isBrowser) return fn(noopCtx);

  const t0 = performance.now();
  const laps: string[] = [];
  let note = "";
  let reqBytes: number | null = null;
  let resBytes: number | null = null;
  let serverTiming: string | null = null;

  const ctx: PerfCtx = {
    note: (s) => { note = note ? `${note} · ${s}` : s; },
    req: (b) => { reqBytes = b; },
    res: (b) => { resBytes = b; },
    server: (h) => { serverTiming = h; },
    lap: (label) => { laps.push(`${label}=${fmt(performance.now() - t0)}ms`); },
  };

  let ok = true;
  try {
    return await fn(ctx);
  } catch (err) {
    ok = false;
    ctx.note(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    const ms = performance.now() - t0;
    const fullNote = [...laps, note].filter(Boolean).join(" · ");
    const row: PerfStep = {
      run: current?.id ?? 0,
      step,
      ms,
      reqKB: reqBytes === null ? null : kb(reqBytes),
      resKB: resBytes === null ? null : kb(resBytes),
      note: fullNote,
      server: serverTiming,
      ok,
    };
    current?.steps.push(row);

    const sizes = [
      row.reqKB === null ? "" : `↑${row.reqKB}KB`,
      row.resKB === null ? "" : `↓${row.resKB}KB`,
    ].filter(Boolean).join(" ");
    console.log(
      `%c⏱ ${pad(step, 24)} ${fmt(ms).padStart(8)} ms  ${pad(sizes, 18)}${fullNote}${row.server ? `  [server: ${row.server}]` : ""}`,
      ok ? "color:#22c55e" : "color:#ef4444"
    );
  }
}

const noopCtx: PerfCtx = {
  note: () => {}, req: () => {}, res: () => {}, server: () => {}, lap: () => {},
};

// อ่าน response เป็น text ก่อน parse — จะได้ขนาด byte จริงของ payload ไปด้วย
export async function perfJson<T>(res: Response, ctx: PerfCtx): Promise<T> {
  const text = await res.text();
  ctx.res(new Blob([text]).size);
  ctx.server(res.headers.get("server-timing"));
  return JSON.parse(text) as T;
}

// ── helper สำหรับ console ─────────────────────────────────────────────
function allSteps(): PerfStep[] {
  return runs.flatMap((r) => r.steps);
}

function toCsv(): string {
  const head = "run,label,host,startedAt,step,ms,reqKB,resKB,serverTiming,note,ok";
  const lines = runs.flatMap((r) =>
    r.steps.map((s) =>
      [
        r.id, r.label, r.host, r.startedAt, s.step, Math.round(s.ms),
        s.reqKB ?? "", s.resKB ?? "", s.server ?? "",
        `"${s.note.replace(/"/g, "'")}"`, s.ok,
      ].join(",")
    )
  );
  const totals = runs.map((r) =>
    [r.id, r.label, r.host, r.startedAt, "TOTAL", Math.round(r.totalMs ?? 0), "", "", "", "", true].join(",")
  );
  return [head, ...lines, ...totals].join("\n");
}

if (isBrowser) {
  const w = window as unknown as Record<string, unknown>;
  w.__culiPerf = runs;
  w.__culiPerfTable = () => console.table(allSteps());
  w.__culiPerfCsv = toCsv;
  w.__culiPerfClear = () => { runs.length = 0; seq = 0; current = null; };
  console.log(
    "%c[perf] เก็บเวลาทุกขั้นตอนไว้แล้ว — ใช้ __culiPerfTable() ดูตาราง, copy(__culiPerfCsv()) เพื่อก๊อป CSV ไปทำเล่ม",
    "color:#a855f7"
  );
}
