/*! SPDX-License-Identifier: GPL-3.0-only
 * Browser-decoded WebRTC VideoFrames -> Canvas. Receive buffering and video
 * decoding belong to the browser; this module only draws and owns frame lifetimes. */
import { Samples, letterbox } from './link.js';
import { createFpsWindow } from './fps-window.js';

/** Keep the last submitted picture for resize and release every replaced frame. */
export function createFramePresenter(canvas, { now = () => performance.timeOrigin + performance.now(),
  onPresent, onFirstPresent } = {}) {
  const drawMs = new Samples(), fpsWindow = createFpsWindow();
  let renderer = createRenderer(canvas), lastFrame = null, lastConfig = null;
  let drawnFrames = 0, renderDroppedFrames = 0, provenId = null, provenEpoch = null;
  const draw = frame => renderer.draw(frame, letterbox(canvas.width, canvas.height,
    lastConfig?.width || frame.displayWidth, lastConfig?.height || frame.displayHeight));
  const lost = event => event.preventDefault();
  const restored = () => { renderer.dispose?.(); renderer = createRenderer(canvas); if (lastFrame) draw(lastFrame); };
  if (renderer.kind !== '2d') {
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
  }
  function present(frame, config, timing = null) {
    if (lastConfig?.epoch !== config?.epoch) { fpsWindow.reset(); drawnFrames = renderDroppedFrames = 0; }
    lastConfig = config;
    const started = performance.now();
    let drawn;
    try { drawn = draw(frame) !== false; }
    catch (cause) { renderDroppedFrames++; frame.close(); throw cause; }
    if (!drawn) { renderDroppedFrames++; frame.close(); return; }
    const at = now();
    drawMs.add(performance.now() - started); drawnFrames++;
    fpsWindow.frame(performance.now(), 1, Number.isFinite(timing) ? at - timing : null);
    lastFrame?.close(); lastFrame = frame;
    onPresent?.({ at, timing, audioAt: null });
    // Only a successful Canvas submission proves the current source usable.
    if (config && (provenId !== config.streamId || provenEpoch !== config.epoch)) {
      provenId = config.streamId; provenEpoch = config.epoch; onFirstPresent?.(config);
    }
  }
  function close() {
    fpsWindow.reset(); lastFrame?.close(); lastFrame = lastConfig = null;
    provenId = provenEpoch = null; drawnFrames = renderDroppedFrames = 0;
  }
  return {
    present,
    resize(width, height) {
      if (width < 1 || height < 1 || (canvas.width === width && canvas.height === height)) return;
      canvas.width = width; canvas.height = height; if (lastFrame) draw(lastFrame);
    },
    close,
    dispose() {
      close(); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      renderer.dispose?.();
    },
    stats: () => ({ drawnFrames, renderDroppedFrames, renderer: renderer.kind, canvas: `${canvas.width}x${canvas.height}`,
      drawMsP95: drawMs.percentile(95), ...fpsWindow.stats() }),
  };
}

export function createRenderer(canvas) {
  const options = { alpha: false, antialias: false, depth: false, desynchronized: true, powerPreference: 'high-performance' };
  const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (gl) return glRenderer(gl);
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  return {
    kind: '2d',
    draw(frame, box) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame, box.x, box.y, box.width, box.height);
    },
  };
}

function glRenderer(gl) {
  const vertex = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x+1.,1.-p.y)*.5;gl_Position=vec4(p,0.,1.);}';
  const fragment = 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv);}';
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.clearColor(0, 0, 0, 1);
  return {
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
    kind: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
    draw(frame, box) {
      if (gl.isContextLost()) return false;
      const { height } = gl.canvas;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.viewport(box.x, height - box.y - box.height, box.width, box.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Submit without waiting for GPU completion. WebRTC owns playout timing.
      gl.flush();
    },
  };
}
