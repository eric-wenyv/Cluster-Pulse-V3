import type { TaskDag } from '../types';

const THUMB_SIZE = 80;
const PADDING = 6;
const MIN_NODE_RADIUS = 2.5;
const MAX_NODE_RADIUS = 7;

function getMetricColor(type: string): string {
  // Map task types to metric-like colors; fallback to muted orange
  const map: Record<string, string> = {
    '1': '#d66d2e', // cpu-ish
    '2': '#178f8f', // memory-ish
    '3': '#4673df', // network-ish
    '4': '#8c62e0', // disk-ish
  };
  return map[type] ?? '#b07d48';
}

export type DagThumbnailResult = {
  svgHtml: string;
  activeNodeCount: number;
  adjacentTaskCount: number;
};

/**
 * Generate an 80×80 DAG thumbnail SVG.
 * Layout coordinates are precomputed in build_data.py (0–1 range).
 * Frontend only filters by time window and renders fixed coordinates.
 * Target render latency: < 1 ms for the SVG string construction.
 */
export function generateDagThumbnailSvg(
  dag: TaskDag | null,
  hoverBin: number,
  timeWindow: [number, number]
): DagThumbnailResult | null {
  if (!dag || !dag.nodes.length) {
    return null;
  }

  const [winStart, winEnd] = timeWindow;
  const hoverWindowStart = Math.max(winStart, hoverBin - 2);
  const hoverWindowEnd = Math.min(winEnd, hoverBin + 2);

  // Filter nodes active in the hover time window
  const activeNodes = dag.nodes.filter(
    (n) => n.startBin <= hoverWindowEnd && n.endBin >= hoverWindowStart
  );

  if (activeNodes.length === 0) {
    return null;
  }

  const activeIds = new Set(activeNodes.map((n) => n.id));

  // Compute per-window resource scores among active nodes
  const scores = activeNodes.map((n) => n.resourceScore);
  const maxScore = Math.max(...scores, 0.0001);

  // Build SVG parts using array join for speed
  const parts: string[] = [];
  parts.push(
    `<svg width="${THUMB_SIZE}" height="${THUMB_SIZE}" viewBox="0 0 ${THUMB_SIZE} ${THUMB_SIZE}" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:6px auto 0;">`
  );
  // Background rect for the thumbnail area (dark to match tooltip)
  parts.push(
    `<rect x="0" y="0" width="${THUMB_SIZE}" height="${THUMB_SIZE}" rx="4" fill="rgba(15,23,42,0.5)" stroke="rgba(95,107,123,0.4)" stroke-width="1"/>`
  );

  // Draw edges first (so they appear behind nodes)
  for (const edge of dag.edges) {
    if (!activeIds.has(edge.source) || !activeIds.has(edge.target)) {
      continue;
    }
    const src = activeNodes.find((n) => n.id === edge.source);
    const tgt = activeNodes.find((n) => n.id === edge.target);
    if (!src || !tgt) continue;
    const x1 = PADDING + src.x * (THUMB_SIZE - PADDING * 2);
    const y1 = PADDING + src.y * (THUMB_SIZE - PADDING * 2);
    const x2 = PADDING + tgt.x * (THUMB_SIZE - PADDING * 2);
    const y2 = PADDING + tgt.y * (THUMB_SIZE - PADDING * 2);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(95,107,123,0.35)" stroke-width="0.8"/>`
    );
  }

  // Draw nodes
  for (const node of activeNodes) {
    const cx = PADDING + node.x * (THUMB_SIZE - PADDING * 2);
    const cy = PADDING + node.y * (THUMB_SIZE - PADDING * 2);
    const radius = MIN_NODE_RADIUS + (node.resourceScore / maxScore) * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
    const color = getMetricColor(node.type);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="0.9"/>`
    );
  }

  parts.push('</svg>');

  // Count "adjacent tasks": active nodes that have at least one edge to another active node
  const activeIdsSet = activeIds;
  const nodesWithEdges = new Set<string>();
  for (const edge of dag.edges) {
    if (activeIdsSet.has(edge.source) && activeIdsSet.has(edge.target)) {
      nodesWithEdges.add(edge.source);
      nodesWithEdges.add(edge.target);
    }
  }
  const adjacentTaskCount = nodesWithEdges.size || activeNodes.length;

  return {
    svgHtml: parts.join(''),
    activeNodeCount: activeNodes.length,
    adjacentTaskCount,
  };
}
