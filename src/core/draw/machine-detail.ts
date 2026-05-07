import { METRIC_META, METRIC_ORDER } from '../constants';
import type { AppData, AppState, GridData, MachineRecord } from '../types';
import { formatTime, gridValue } from '../utils';

export function renderMachineDetail(
  container: HTMLElement,
  data: AppData,
  grid: GridData,
  state: AppState,
  machine: MachineRecord
): void {
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  container.appendChild(canvas);

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = rect.width;
  const cssHeight = rect.height;

  if (cssWidth <= 0 || cssHeight <= 0) {
    return;
  }

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.scale(dpr, dpr);
  drawHorizonChart(ctx, cssWidth, cssHeight, data, grid, state, machine);
}

function drawHorizonChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: AppData,
  grid: GridData,
  state: AppState,
  machine: MachineRecord
): void {
  const topPad = 8;
  const bottomPad = 28;
  const leftPad = 32;
  const rightPad = 8;
  const betweenGap = 4;
  const bands = 3;

  const plotWidth = width - leftPad - rightPad;
  const plotHeight = height - topPad - bottomPad;

  if (plotWidth <= 0 || plotHeight <= 0) {
    return;
  }

  const bandTotal = (plotHeight - betweenGap * (METRIC_ORDER.length - 1)) / METRIC_ORDER.length;
  const subH = bandTotal / bands;

  const binCount = data.manifest.binCount;
  const binSeconds = data.manifest.binSeconds;
  const [windowStart, windowEnd] = state.timeWindow;

  // Draw each metric
  METRIC_ORDER.forEach((metricId, mi) => {
    const bandBase = topPad + mi * (bandTotal + betweenGap);
    const accent = METRIC_META[metricId].accent;

    // Read values (0–100 or null)
    const values: (number | null)[] = Array.from(
      { length: binCount },
      (_, index) => gridValue(grid, metricId, index, machine.index)
    );

    // Draw 3 bands
    for (let b = 0; b < bands; b++) {
      const low = b / bands;
      const high = (b + 1) / bands;
      const alpha = [0.22, 0.45, 0.78][b];

      // Find continuous segments of defined values exceeding this band
      let segmentStart = -1;

      for (let i = 0; i <= binCount; i++) {
        const v = i < binCount ? values[i] : null;
        const inBand = v !== null && v > low * 100;

        if (inBand && segmentStart === -1) {
          segmentStart = i;
        }

        if ((!inBand || i === binCount) && segmentStart !== -1) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = alpha;
          ctx.beginPath();

          let started = false;
          for (let j = segmentStart; j < i; j++) {
            const vj = values[j]!; // non-null and > low*100
            const normalized = vj / 100;
            const clipV = Math.min(normalized, high);
            const frac = (clipV - low) / (1 / bands);
            const px = leftPad + (j / (binCount - 1)) * plotWidth;
            const py = bandBase + subH * (bands - 1 - b) + subH * (1 - frac);

            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }

          // Close path along the bottom of this band
          if (started) {
            const bottomY = bandBase + subH * (bands - b);
            const lastPx = leftPad + ((i - 1) / (binCount - 1)) * plotWidth;
            const firstPx = leftPad + (segmentStart / (binCount - 1)) * plotWidth;

            ctx.lineTo(lastPx, bottomY);
            ctx.lineTo(firstPx, bottomY);
            ctx.closePath();
            ctx.fill();
          }

          segmentStart = -1;
        }
      }
    }

    ctx.globalAlpha = 1;

    // Metric label
    ctx.fillStyle = accent;
    ctx.font = 'bold 10px "Source Sans 3", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(METRIC_META[metricId].short, 4, bandBase + 10);

    // Separator line between metrics
    if (mi < METRIC_ORDER.length - 1) {
      ctx.strokeStyle = '#d8dfe7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftPad, bandBase + bandTotal);
      ctx.lineTo(width - rightPad, bandBase + bandTotal);
      ctx.stroke();
    }
  });

  // Shared X axis
  ctx.fillStyle = '#5f6b7b';
  ctx.font = '10px "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const tickValues = [0, 192, 384, 576, 767];
  tickValues.forEach((tick) => {
    const px = leftPad + (tick / (binCount - 1)) * plotWidth;
    const label = formatTime(tick * binSeconds);
    ctx.fillText(label, px, height - bottomPad + 6);

    ctx.strokeStyle = 'rgba(95, 107, 123, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, height - bottomPad);
    ctx.lineTo(px, height - bottomPad + 4);
    ctx.stroke();
  });

  // X axis baseline
  ctx.strokeStyle = 'rgba(95, 107, 123, 0.42)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftPad, height - bottomPad);
  ctx.lineTo(width - rightPad, height - bottomPad);
  ctx.stroke();

  // Brush highlight
  if (
    windowStart !== undefined &&
    windowEnd !== undefined &&
    binCount > 1
  ) {
    const x1 = leftPad + (windowStart / (binCount - 1)) * plotWidth;
    const x2 = leftPad + ((windowEnd + 1) / (binCount - 1)) * plotWidth;

    ctx.fillStyle = 'rgba(31, 75, 143, 0.06)';
    ctx.fillRect(x1, topPad, x2 - x1, plotHeight);

    ctx.strokeStyle = 'rgba(31, 75, 143, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, topPad, x2 - x1, plotHeight);
  }
}
