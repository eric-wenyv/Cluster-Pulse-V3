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

  const binSeconds = data.manifest.binSeconds;
  const [windowStart, windowEnd] = state.timeWindow;
  const visibleBinCount = windowEnd - windowStart + 1;

  if (visibleBinCount <= 0) {
    return;
  }

  // Helper to map a bin index to x pixel within the visible window
  const binToPx = (bin: number) => {
    if (visibleBinCount <= 1) {
      return leftPad + plotWidth / 2;
    }
    return leftPad + ((bin - windowStart) / (visibleBinCount - 1)) * plotWidth;
  };

  // Draw each metric
  METRIC_ORDER.forEach((metricId, mi) => {
    const bandBase = topPad + mi * (bandTotal + betweenGap);
    const accent = METRIC_META[metricId].accent;

    // Read only values within the visible window
    const values: (number | null)[] = Array.from(
      { length: visibleBinCount },
      (_, index) => gridValue(grid, metricId, windowStart + index, machine.index)
    );

    // Draw 3 bands
    for (let b = 0; b < bands; b++) {
      const low = b / bands;
      const high = (b + 1) / bands;
      const alpha = [0.22, 0.45, 0.78][b];

      // Find continuous segments of defined values exceeding this band
      let segmentStart = -1;

      for (let i = 0; i <= visibleBinCount; i++) {
        const v = i < visibleBinCount ? values[i] : null;
        const inBand = v !== null && v > low * 100;

        if (inBand && segmentStart === -1) {
          segmentStart = i;
        }

        if ((!inBand || i === visibleBinCount) && segmentStart !== -1) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = alpha;
          ctx.beginPath();

          let started = false;
          for (let j = segmentStart; j < i; j++) {
            const vj = values[j]!; // non-null and > low*100
            const normalized = vj / 100;
            const clipV = Math.min(normalized, high);
            const frac = (clipV - low) / (1 / bands);
            const px = binToPx(windowStart + j);
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
            const lastPx = binToPx(windowStart + i - 1);
            const firstPx = binToPx(windowStart + segmentStart);

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

  // Shared X axis (dynamic ticks based on visible window)
  ctx.fillStyle = '#5f6b7b';
  ctx.font = '10px "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Generate ticks aligned to days within the visible window
  const tickValues: number[] = [];
  const dayBins = 96; // 15 min bins per day
  const firstDayStart = Math.ceil(windowStart / dayBins) * dayBins;
  for (let tick = firstDayStart; tick <= windowEnd; tick += dayBins) {
    tickValues.push(tick);
  }
  // Always include window start if no other ticks
  if (tickValues.length === 0 || tickValues[0] > windowStart + dayBins * 0.5) {
    tickValues.unshift(windowStart);
  }

  tickValues.forEach((tick) => {
    const px = binToPx(tick);
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
}
