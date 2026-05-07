export function generateDagThumbnailSvg(
  _machine: any,
  _hoverBin: number,
  _timeWindow: [number, number]
): string {
  const size = 80;

  const nodes = [
    { id: '1', x: 15, y: 10, resourceScore: 0.8, type: 'cpu' },
    { id: '2', x: 50, y: 10, resourceScore: 0.5, type: 'memory' },
    { id: '3', x: 15, y: 55, resourceScore: 0.6, type: 'cpu' },
    { id: '4', x: 50, y: 55, resourceScore: 0.3, type: 'disk' },
    { id: '5', x: 32, y: 32, resourceScore: 0.9, type: 'network' },
  ];

  const edges = [
    { source: '1', target: '5' },
    { source: '3', target: '5' },
    { source: '5', target: '2' },
    { source: '5', target: '4' },
  ];

  const colors: Record<string, string> = {
    cpu: '#ef4444',
    memory: '#3b82f6',
    network: '#8b5cf6',
    disk: '#10b981',
  };

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:6px auto 0;background:rgba(255,255,255,0.06);border-radius:4px;">`;

  for (const e of edges) {
    const s = nodes.find(n => n.id === e.source);
    const t = nodes.find(n => n.id === e.target);
    if (s && t) {
      svg += `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>`;
    }
  }

  for (const n of nodes) {
    const r = Math.max(3, n.resourceScore * 10);
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${colors[n.type] || '#f59e0b'}" opacity="0.85"/>`;
  }

  svg += '</svg>';
  return svg;
}