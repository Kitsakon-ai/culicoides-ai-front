import type { AnnotatedFeature } from "@/app/api/annotate/route";

// Draw at half the source photo's resolution — these are often multi-thousand-px
// microscope scans, so the full-res canvas produces a huge base64 PNG that's slow
// to generate and slow to load in the <img>. Label sizing below is proportional
// to the canvas footprint, so halving this doesn't affect legibility.
const SCALE = 0.5;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Arrow from label box toward the feature point
function drawArrowLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  unit: number,
) {
  const arrowLen = unit * 0.9;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, unit * 0.14);
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = unit * 0.3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowLen * Math.cos(angle - Math.PI / 6),
    y2 - arrowLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - arrowLen * Math.cos(angle + Math.PI / 6),
    y2 - arrowLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function drawFeatureLabel(
  ctx: CanvasRenderingContext2D,
  featX: number,    // feature point (canvas px)
  featY: number,
  labelTh: string,
  labelEn: string,
  color: string,
  canvasW: number,
  canvasH: number,
) {
  // Size everything as a fraction of the image's own footprint, not a flat px
  // constant — apparent on-screen size then only depends on the display width
  // the browser renders the canvas at, not the source photo's resolution.
  // (A fixed upper clamp here breaks that: on a multi-thousand-px microscope
  // photo it caps the font at a size that reads as a few px once the canvas
  // is scaled down to fit the panel — illegible, "mushed" text.)
  const unit    = Math.max(9, Math.min(canvasW, canvasH) * 0.024);
  const thSize  = unit;
  const enSize  = unit * 0.76;
  const pad     = unit * 0.55;
  const lineGap = unit * 0.32;
  const dotR    = unit * 0.42;
  const margin  = unit * 1.3;
  const offset  = unit * 4.2; // horizontal gap between the feature dot and its label box

  // Measure label box
  ctx.font = `600 ${thSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  const thW = ctx.measureText(labelTh).width;
  ctx.font = `${enSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  const enW = ctx.measureText(labelEn).width;
  const boxW = Math.max(thW, enW) + pad * 2;
  const boxH = thSize + enSize + lineGap + pad * 2;

  // Decide label placement: prefer right side, flip if near edge
  let labelX: number;
  let labelY: number;

  if (featX + offset + boxW > canvasW - margin) {
    labelX = featX - offset - boxW;
  } else {
    labelX = featX + offset;
  }

  labelY = featY - boxH / 2;
  labelY = Math.max(margin, Math.min(canvasH - boxH - margin, labelY));

  // Dot at feature point
  ctx.shadowColor = color;
  ctx.shadowBlur = unit * 0.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(featX, featY, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, unit * 0.1);
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Arrow: from edge of label box to near the feature dot
  const arrowStartX = labelX < featX ? labelX + boxW : labelX;
  const arrowStartY = labelY + boxH / 2;
  const arrowEndX   = featX + (labelX < featX ? 1 : -1) * (dotR + unit * 0.2);
  const arrowEndY   = featY;
  drawArrowLine(ctx, arrowStartX, arrowStartY, arrowEndX, arrowEndY, color, unit);

  // Label background
  ctx.fillStyle = hexToRgba("#0a0a1a", 0.88);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, unit * 0.1);
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, boxW, boxH, unit * 0.35);
  ctx.fill();
  ctx.stroke();

  // Thai text
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${thSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(labelTh, labelX + pad, labelY + pad);

  // English text
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.font = `${enSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  ctx.fillText(labelEn, labelX + pad, labelY + pad + thSize + lineGap);
}

export async function drawAnnotatedWing(
  imageSrc: string,
  _heatmapSrc: string | null | undefined,   // kept for compat, not used
  species: string,
  confidence: number,
  features?: AnnotatedFeature[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const W = img.naturalWidth  * SCALE;
      const H = img.naturalHeight * SCALE;

      const canvas = document.createElement("canvas");
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas 2D unavailable")); return; }

      ctx.drawImage(img, 0, 0, W, H);

      if (features && features.length > 0) {
        features.forEach((f) => {
          drawFeatureLabel(
            ctx,
            f.x * W,
            f.y * H,
            f.labelTh,
            f.labelEn,
            f.color,
            W,
            H,
          );
        });
      }

      // Bottom info bar — sized off the image footprint too, same reasoning as labels.
      const barUnit = Math.max(9, Math.min(W, H) * 0.02);
      const barH = barUnit * 2.6;
      ctx.fillStyle = hexToRgba("#0a0a1a", 0.88);
      ctx.fillRect(0, H - barH, W, barH);

      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${barUnit}px 'Segoe UI', Tahoma, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `AI Wing Annotation · Culicoides ${species}  (${(confidence * 100).toFixed(1)}%)`,
        W / 2,
        H - barH / 2,
      );

      // JPEG compresses this photographic content far smaller than PNG, and
      // nothing drawn here needs an alpha channel.
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageSrc;
  });
}
