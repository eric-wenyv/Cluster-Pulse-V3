export type WebGLVersion = 'webgl2' | 'webgl1' | 'none';

export type WebGLCapability = {
  available: boolean;
  version: WebGLVersion;
  maxTextureSize: number;
  renderer: string | null;
};

export type RenderPrimitive = 'scatter' | 'gantt-swimlane';

export type RendererPlan = 'd3-svg' | 'regl-webgl' | 'deck-gl';

export type WebGLAssessment = {
  primitive: RenderPrimitive;
  recommendedRenderer: RendererPlan;
  preferredWebGLLibrary: 'regl' | 'deck.gl';
  shouldUseWebGL: boolean;
  renderedPrimitiveCount: number;
  candidatePrimitiveCount: number;
  riskLevel: 'low' | 'medium' | 'high';
  thresholds: {
    d3SafePrimitiveCount: number;
    webglRequiredPrimitiveCount: number;
  };
  reasons: string[];
};

type PrimitiveThresholds = WebGLAssessment['thresholds'];

type DebugRendererInfo = {
  UNMASKED_RENDERER_WEBGL: number;
};

const FALLBACK_WEBGL_CAPABILITY: WebGLCapability = {
  available: false,
  version: 'none',
  maxTextureSize: 0,
  renderer: null
};

const SCATTER_THRESHOLDS: PrimitiveThresholds = {
  d3SafePrimitiveCount: 3_000,
  webglRequiredPrimitiveCount: 15_000
};

const GANTT_SWIMLANE_THRESHOLDS: PrimitiveThresholds = {
  d3SafePrimitiveCount: 2_500,
  webglRequiredPrimitiveCount: 12_000
};

export function detectWebGLCapability(): WebGLCapability {
  if (typeof document === 'undefined') {
    return FALLBACK_WEBGL_CAPABILITY;
  }

  const canvas = document.createElement('canvas');
  const contextOptions = { failIfMajorPerformanceCaveat: true };
  const webgl2 = canvas.getContext('webgl2', contextOptions) as WebGL2RenderingContext | null;
  const webgl1 = webgl2 ? null : (canvas.getContext('webgl', contextOptions) as WebGLRenderingContext | null);
  const gl = webgl2 ?? webgl1;

  if (!gl) {
    return FALLBACK_WEBGL_CAPABILITY;
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as DebugRendererInfo | null;
  const renderer = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) : null;

  return {
    available: true,
    version: webgl2 ? 'webgl2' : 'webgl1',
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    renderer
  };
}

export function evaluateScatterWebGL(params: {
  renderedPointCount: number;
  candidatePointCount?: number;
  webgl: WebGLCapability;
}): WebGLAssessment {
  return evaluatePrimitive({
    primitive: 'scatter',
    renderedPrimitiveCount: params.renderedPointCount,
    candidatePrimitiveCount: params.candidatePointCount,
    thresholds: SCATTER_THRESHOLDS,
    preferredWebGLLibrary: 'regl',
    webgl: params.webgl,
    webglReason: 'Scatter is a custom Cartesian plot; regl keeps the fallback small and avoids deck.gl layer overhead.'
  });
}

export function evaluateGanttSwimlaneWebGL(params: {
  renderedRectCount: number;
  candidateRectCount?: number;
  laneCount?: number;
  webgl: WebGLCapability;
}): WebGLAssessment {
  const lanePressure = params.laneCount !== undefined && params.laneCount > 250;
  const assessment = evaluatePrimitive({
    primitive: 'gantt-swimlane',
    renderedPrimitiveCount: params.renderedRectCount,
    candidatePrimitiveCount: params.candidateRectCount,
    thresholds: GANTT_SWIMLANE_THRESHOLDS,
    preferredWebGLLibrary: 'regl',
    webgl: params.webgl,
    webglReason:
      'Gantt swimlanes are instanced rectangles with custom axes; regl is lighter unless future picking/layer composition needs deck.gl.'
  });

  if (!lanePressure) {
    return assessment;
  }

  return {
    ...assessment,
    riskLevel: assessment.riskLevel === 'low' ? 'medium' : assessment.riskLevel,
    reasons: [...assessment.reasons, 'Lane count is high enough that DOM labels and row layout need virtualization even before WebGL.']
  };
}

function evaluatePrimitive(params: {
  primitive: RenderPrimitive;
  renderedPrimitiveCount: number;
  candidatePrimitiveCount?: number;
  thresholds: PrimitiveThresholds;
  preferredWebGLLibrary: 'regl' | 'deck.gl';
  webgl: WebGLCapability;
  webglReason: string;
}): WebGLAssessment {
  const renderedPrimitiveCount = Math.max(0, Math.floor(params.renderedPrimitiveCount));
  const candidatePrimitiveCount = Math.max(
    renderedPrimitiveCount,
    Math.floor(params.candidatePrimitiveCount ?? renderedPrimitiveCount)
  );
  const reasons: string[] = [];
  let riskLevel: WebGLAssessment['riskLevel'] = 'low';
  let shouldUseWebGL = false;

  if (renderedPrimitiveCount >= params.thresholds.webglRequiredPrimitiveCount) {
    shouldUseWebGL = true;
    riskLevel = 'high';
    reasons.push('Rendered primitive count exceeds the WebGL handoff threshold.');
  } else if (renderedPrimitiveCount >= params.thresholds.d3SafePrimitiveCount) {
    riskLevel = 'medium';
    reasons.push('Rendered primitive count is above the conservative D3/SVG comfort range.');
  } else {
    reasons.push('Rendered primitive count is inside the D3/SVG comfort range.');
  }

  if (candidatePrimitiveCount >= params.thresholds.webglRequiredPrimitiveCount && !shouldUseWebGL) {
    riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
    reasons.push('Full candidate set would need a WebGL path if the current view stops capping visible primitives.');
  }

  if (shouldUseWebGL && !params.webgl.available) {
    reasons.push('WebGL is not available, so the view must downsample or keep a capped D3/SVG fallback.');
  } else if (shouldUseWebGL) {
    reasons.push(params.webglReason);
  }

  return {
    primitive: params.primitive,
    recommendedRenderer: shouldUseWebGL && params.webgl.available ? 'regl-webgl' : 'd3-svg',
    preferredWebGLLibrary: params.preferredWebGLLibrary,
    shouldUseWebGL,
    renderedPrimitiveCount,
    candidatePrimitiveCount,
    riskLevel,
    thresholds: params.thresholds,
    reasons
  };
}
