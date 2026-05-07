import * as d3 from 'd3';

export const VIEW_TRANSITION_MS = 220;

export function fadeInSvg(svgNode: SVGSVGElement, duration = VIEW_TRANSITION_MS): void {
  const svg = d3.select(svgNode);
  svg.interrupt('view-fade');
  svg
    .selectAll<SVGElement, unknown>(':scope > *')
    .interrupt('view-fade')
    .style('opacity', 0)
    .transition('view-fade')
    .duration(duration)
    .ease(d3.easeCubicOut)
    .style('opacity', 1);
}

export function snapshotCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (canvas.width === 0 || canvas.height === 0) {
    return null;
  }
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const ctx = snapshot.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.drawImage(canvas, 0, 0);
  return snapshot;
}

export function fadeCanvasFromSnapshot(
  canvas: HTMLCanvasElement,
  snapshot: HTMLCanvasElement | null,
  drawCurrentFrame: () => void,
  duration = VIEW_TRANSITION_MS
): number {
  if (!snapshot) {
    return 0;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return 0;
  }

  const startedAt = performance.now();
  let frameId = 0;

  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    drawCurrentFrame();
    ctx.save();
    ctx.globalAlpha = 1 - eased;
    ctx.drawImage(snapshot, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (progress < 1) {
      frameId = window.requestAnimationFrame(step);
    } else {
      frameId = 0;
      drawCurrentFrame();
    }
  };

  frameId = window.requestAnimationFrame(step);
  return frameId;
}
