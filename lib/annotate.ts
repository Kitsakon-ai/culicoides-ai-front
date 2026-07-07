import type { AnnotatedFeature } from "@/app/api/annotate/route";

const SCALE = 2;

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
) {
  const arrowLen = 14 * SCALE;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * SCALE;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 4;
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
  const thSize  = 18 * SCALE;
  const enSize  = 14 * SCALE;
  const pad     = 10 * SCALE;
  const lineGap = 6  * SCALE;
  const dotR    = 8  * SCALE;

  // Measure label box
  ctx.font = `bold ${thSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  const thW = ctx.measureText(labelTh).width;
  ctx.font = `${enSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
  const enW = ctx.measureText(labelEn).width;
  const boxW = Math.max(thW, enW) + pad * 2;
  const boxH = thSize + enSize + lineGap + pad * 2;

  // Decide label placement: prefer right side, flip if near edge
  const margin = 20 * SCALE;
  let labelX: number;
  let labelY: number;

  if (featX + 80 * SCALE + boxW > canvasW - margin) {
    labelX = featX - 80 * SCALE - boxW;
  } else {
    labelX = featX + 80 * SCALE;
  }

  labelY = featY - boxH / 2;
  labelY = Math.max(margin, Math.min(canvasH - boxH - margin, labelY));

  // Dot at feature point
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(featX, featY, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * SCALE;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Arrow: from edge of label box to near the feature dot
  const arrowStartX = labelX < featX ? labelX + boxW : labelX;
  const arrowStartY = labelY + boxH / 2;
  const arrowEndX   = featX + (labelX < featX ? 1 : -1) * (dotR + 4 * SCALE);
  const arrowEndY   = featY;
  drawArrowLine(ctx, arrowStartX, arrowStartY, arrowEndX, arrowEndY, color);

  // Label background
  ctx.fillStyle = hexToRgba("#0a0a1a", 0.88);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * SCALE;
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, boxW, boxH, 7 * SCALE);
  ctx.fill();
  ctx.stroke();

  // Thai text
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${thSize}px 'Segoe UI', Tahoma, Arial, sans-serif`;
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

      // Bottom info bar
      const barH = 40 * SCALE;
      ctx.fillStyle = hexToRgba("#0a0a1a", 0.88);
      ctx.fillRect(0, H - barH, W, barH);

      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${14 * SCALE}px 'Segoe UI', Tahoma, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `AI Wing Annotation · Culicoides ${species}  (${(confidence * 100).toFixed(1)}%)`,
        W / 2,
        H - barH / 2,
      );

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageSrc;
  });
}
