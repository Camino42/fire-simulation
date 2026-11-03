
const compositeCanvas = document.getElementById('composite-canvas');
const compCtx = compositeCanvas.getContext('2d');

const glCanvas = document.createElement('canvas');
const gl = glCanvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
        || glCanvas.getContext('experimental-webgl');

if (gl) {
  gl.getExtension('OES_standard_derivatives');
}

const bloomCanvas = document.createElement('canvas');
const bloomCtx = bloomCanvas.getContext('2d');

// 专用于“仅画布区域”录制与截图的离屏裁剪画布
const recordCropCanvas = document.createElement('canvas');
const recordCropCtx = recordCropCanvas.getContext('2d');

const state = {
  spreadSpeed: 1.00,
  flameHeight: 2.6,
  flickerFreq: 14.0,
  charWidth: 0.055,
  emberWidth: 0.028,
  curlStrength: 0.55,
  smokeAmount: 0.32,
  bloomStrength: 0.38,
  postStrength: 0.25,
  bgMode: 0,
  aspectRatio: 1.0,
  zoom: 1.00,
  stageOffsetX: 0.0,
  stageOffsetY: 0.0,
  topPanX: 0.0,
  topPanY: 0.0,
  topZoom: 1.00,
  underPanX: 0.0,
  underPanY: 0.0,
  underZoom: 1.00,
  exportFormat: 'mp4',
  exportArea: 'paper',
  interactMode: 'ignite',
  spacePressed: false,
  currentImgWidth: 800,
  currentImgHeight: 800,
  // 自由调节参数：明火生命周期、余烬动静态与微粒动力学
  flameLifetime: 4.4,     // 2.6-4.4s为快速熄灭，8.8s为旧版长明火
  flameResidue: 0.00,     // 0.00为自然熄灭，0.32为旧版保底常驻微火
  emberDynamic: true,     // true为动态收缩熄灭，false为旧版静态常驻
  particleLife: 0.50,     // 粒子寿命 (0.35s ~ 2.0s)
  particleFreq: 0.18,     // 粒子发射率 (0.18 ~ 0.35)
  particleWindow: 4.5,    // 粒子发射窗口 (4.5s ~ 8.5s)
  startTime: performance.now() * 0.001,
  accumulatedPausedDuration: 0,
  pauseStartTime: 0,
  isPaused: false,
  firstIgniteTime: null,
  pointerDown: false,
  isDraggingPan: false,
  downClientX: 0,
  downClientY: 0,
  lastClientX: 0,
  lastClientY: 0,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  webglValid: false
};

const MAX_IGNITES = 16;
const ignitePoints = [];

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.max(1, a);
}

function updateDimensionHUD() {
  const w = Math.max(1, Math.round(state.currentImgWidth));
  const h = Math.max(1, Math.round(state.currentImgHeight));
  const cmW = (w * 2.54 / 96).toFixed(1);
  const cmH = (h * 2.54 / 96).toFixed(1);
  const ratioVal = (w / h).toFixed(2);
  const g = gcd(w, h);
  let rw = Math.round(w / g);
  let rh = Math.round(h / g);
  if (rw > 32 || rh > 32) {
    rw = Math.round(state.aspectRatio * 10);
    rh = 10;
    const g2 = gcd(rw, rh);
    rw /= g2;
    rh /= g2;
  }
  document.getElementById('hud-size').textContent = `${w} × ${h} px`;
  document.getElementById('hud-cm').textContent = `${cmW} × ${cmH} cm`;
  document.getElementById('hud-ratio').textContent = `${ratioVal} (${rw}:${rh})`;
}

function resetPaper() {
  ignitePoints.length = 0;
  state.firstIgniteTime = null;
  state.startTime = performance.now() * 0.001;
  state.accumulatedPausedDuration = 0;
  particles.forEach(p => p.active = false);
}

function addIgnitePoint(uvX, uvY) {
  const now = (performance.now() * 0.001 - state.startTime) - state.accumulatedPausedDuration;
  if (state.firstIgniteTime === null) state.firstIgniteTime = now;
  for (let i = 0; i < ignitePoints.length; i++) {
    const dx = ignitePoints[i].x - uvX;
    const dy = ignitePoints[i].y - uvY;
    if (dx * dx + dy * dy < 0.0012) return;
  }
  if (ignitePoints.length >= MAX_IGNITES) ignitePoints.shift();
  ignitePoints.push({ x: uvX, y: uvY, t0: now });
  spawnIgniteThermalGlow(uvX, uvY);
}

let rawUserTopImage = null;
let rawUserUnderImage = null;

// 保证初始默认图片无论在任何打包或离线环境中都能 100% 稳定渲染的 2D 绘制逻辑
function drawDefaultTopByAspect(ctx, W, H, aspect) {
  ctx.save();
  ctx.fillStyle = '#F5EFE6';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(150, 134, 115, 0.16)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 400; i++) {
    const x = (i * 37) % W;
    const y = (i * 73) % H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 25, y + 12);
    ctx.stroke();
  }

  const pad = Math.round(Math.min(W, H) * 0.07);
  ctx.strokeStyle = 'rgba(72, 60, 48, 0.32)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  ctx.translate(W * 0.5, H * 0.5);
  ctx.fillStyle = '#3B3228';
  ctx.textAlign = 'center';
  ctx.font = '600 22px sans-serif';
  ctx.fillText('FIRE FLAME SIMULATION', 0, -25);
  ctx.font = '400 16px sans-serif';
  ctx.fillStyle = '#665F57';
  ctx.fillText('请点击边缘引燃，或导入自定义图片', 0, 20);
  ctx.restore();
}

function drawDefaultUnderByAspect(ctx, W, H, aspect) {
  ctx.save();
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  grad.addColorStop(0, '#261F19');
  grad.addColorStop(1, '#14110E');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const pad = Math.round(Math.min(W, H) * 0.085);
  ctx.strokeStyle = 'rgba(218, 178, 115, 0.45)';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  ctx.translate(W * 0.5, H * 0.5);
  ctx.fillStyle = '#F5DFB8';
  ctx.textAlign = 'center';
  ctx.font = '600 24px serif';
  ctx.fillText('— HIDDEN MESSAGE —', 0, -10);
  ctx.font = '400 18px sans-serif';
  ctx.fillStyle = '#D9AF6B';
  ctx.fillText('万事皆如所愿', 0, 35);
  ctx.restore();
}

const topPaperCanvas = document.createElement('canvas');
topPaperCanvas.width = 1024; topPaperCanvas.height = 1024;
const underCardCanvas = document.createElement('canvas');
underCardCanvas.width = 1024; underCardCanvas.height = 1024;

function renderSourceToTextureCanvas(sourceImg, targetCanvas, glTex, texUnit, isTopLayer) {
  const ctx = targetCanvas.getContext('2d');
  const W = targetCanvas.width;
  const H = targetCanvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = isTopLayer ? '#E8DEC8' : '#181411';
  ctx.fillRect(0, 0, W, H);

  const layerPanX = isTopLayer ? state.topPanX : state.underPanX;
  const layerPanY = isTopLayer ? state.topPanY : state.underPanY;
  const layerZoom = isTopLayer ? state.topZoom : state.underZoom;

  ctx.save();
  ctx.translate(W * (0.5 + layerPanX), H * (0.5 + layerPanY));
  ctx.scale(layerZoom, layerZoom);

  if (!sourceImg) {
    ctx.translate(-W * 0.5, -H * 0.5);
    if (isTopLayer) {
      drawDefaultTopByAspect(ctx, W, H, state.aspectRatio);
    } else {
      drawDefaultUnderByAspect(ctx, W, H, state.aspectRatio);
    }
  } else {
    const imgRatio = sourceImg.width / sourceImg.height;
    const paperRatio = state.aspectRatio;
    let dw = W, dh = H;

    if (isTopLayer) {
      if (Math.abs(imgRatio - paperRatio) < 0.01) {
        dw = W; dh = H;
      } else if (imgRatio > paperRatio) {
        dw = W; dh = H * (paperRatio / imgRatio);
      } else {
        dh = H; dw = W * (imgRatio / paperRatio);
      }
    } else {
      if (imgRatio > paperRatio) {
        dh = H; dw = W * (imgRatio / paperRatio);
      } else {
        dw = W; dh = H * (paperRatio / imgRatio);
      }
    }

    ctx.drawImage(sourceImg, -dw * 0.5, -dh * 0.5, dw, dh);
  }
  ctx.restore();

  if (gl && glTex) {
    gl.activeTexture(gl.TEXTURE0 + texUnit);
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetCanvas);
  }
}

function rebuildTopTexture() {
  renderSourceToTextureCanvas(rawUserTopImage, topPaperCanvas, topTex, 0, true);
}

function rebuildUnderTexture() {
  renderSourceToTextureCanvas(rawUserUnderImage, underCardCanvas, underTex, 1, false);
}

function rebuildAllTextures() {
  rebuildTopTexture();
  rebuildUnderTexture();
}

function syncTransformUI() {
  document.getElementById('param-zoom').value = state.zoom;
  document.getElementById('val-zoom').textContent = state.zoom.toFixed(2) + 'x';
  document.getElementById('param-top-zoom').value = state.topZoom;
  document.getElementById('val-top-zoom').textContent = state.topZoom.toFixed(2) + 'x';
  document.getElementById('param-under-zoom').value = state.underZoom;
  document.getElementById('val-under-zoom').textContent = state.underZoom.toFixed(2) + 'x';
}

function restoreDefaultImages() {
  rawUserTopImage = null;
  rawUserUnderImage = null;
  state.zoom = 1.0;
  state.stageOffsetX = 0.0;
  state.stageOffsetY = 0.0;
  state.topPanX = 0.0;
  state.topPanY = 0.0;
  state.topZoom = 1.0;
  state.underPanX = 0.0;
  state.underPanY = 0.0;
  state.underZoom = 1.0;
  syncTransformUI();

  state.aspectRatio = 1.0;
  state.currentImgWidth = 800;
  state.currentImgHeight = 800;
  updateDimensionHUD();

  document.querySelectorAll('[data-aspect]').forEach(b => {
    b.classList.toggle('active', b.dataset.aspect === '1-1');
  });

  document.getElementById('top-file-name').textContent = '默认: 纯净雪梨纸';
  document.getElementById('under-file-name').textContent = '默认: 烫金空底卡';

  rebuildAllTextures();
  updateGeometryAndViewport();
  resetPaper();
}

function handleCustomImage(img, isTopLayer) {
  if (isTopLayer) {
    rawUserTopImage = img;
    state.topPanX = 0.0;
    state.topPanY = 0.0;
    state.topZoom = 1.0;
    syncTransformUI();

    state.aspectRatio = img.width / img.height;
    state.currentImgWidth = img.width;
    state.currentImgHeight = img.height;
    updateDimensionHUD();

    document.querySelectorAll('[data-aspect]').forEach(b => {
      const [aw, ah] = b.dataset.aspect.split('-').map(Number);
      b.classList.toggle('active', Math.abs(state.aspectRatio - (aw / ah)) < 0.02);
    });
  } else {
    rawUserUnderImage = img;
    state.underPanX = 0.0;
    state.underPanY = 0.0;
    state.underZoom = 1.0;
    syncTransformUI();

    if (!rawUserTopImage) {
      state.aspectRatio = img.width / img.height;
      state.currentImgWidth = img.width;
      state.currentImgHeight = img.height;
      updateDimensionHUD();
    }
  }

  rebuildAllTextures();
  updateGeometryAndViewport();
  resetPaper();
}

const VERTEX_SHADER_SRC = `
  precision highp float;
  attribute vec2 aPos;
  attribute vec2 aUv;

  uniform float uTime;
  uniform float uSpreadSpeed;
  uniform float uCurlStrength;
  uniform float uAspectRatio;
  uniform vec3 uIgnites[${MAX_IGNITES}];

  varying vec2 vUv;

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbmLow(vec2 p) {
    return 0.65 * noise(p) + 0.35 * noise(p * 2.02 + vec2(4.2, 1.7));
  }

  void main() {
    vUv = aUv;
    float borderDist = min(min(aUv.x, 1.0 - aUv.x), min(aUv.y, 1.0 - aUv.y));
    float edgeBoost = 1.0 + 0.55 * exp(-borderDist * 9.0);
    float n = fbmLow(aUv * 4.0);

    float minEdge = 10.0;
    vec2 bestDir = vec2(0.0, 1.0);

    for (int i = 0; i < ${MAX_IGNITES}; i++) {
      vec3 ig = uIgnites[i];
      float activeFlag = step(-999.0, ig.z);
      float dt = max(0.0, uTime - ig.z) * activeFlag;
      float prog = (dt < 0.2) ? (dt * 0.12) : (0.024 + (dt - 0.2) * 0.21 * uSpreadSpeed);
      vec2 diff = aUv - ig.xy;
      diff.x *= uAspectRatio;
      float dist = length(diff);
      float burn = dist * 0.52 + n * 0.22;
      float threshold = prog * 1.45 * edgeBoost * activeFlag;
      float e = mix(10.0, burn - threshold, activeFlag);
      if (e < minEdge) {
        minEdge = e;
        bestDir = normalize(diff + vec2(1e-4));
      }
    }

    float curlZone = 1.0 - smoothstep(-0.01, 0.15, minEdge);
    float bendAngle = curlZone * curlZone * 1.35 * uCurlStrength;
    float safeAngle = max(bendAngle, 0.001);
    float arcShrink = (1.0 - sin(safeAngle) / safeAngle) * 0.042 * uCurlStrength * step(0.001, bendAngle);

    vec2 displacedPos = aPos - bestDir * arcShrink * curlZone;
    float liftZ = (1.0 - cos(bendAngle)) * 0.055 * uCurlStrength;
    displacedPos.y += liftZ * 0.72;
    displacedPos.x += aPos.x * liftZ * 0.18;

    gl_Position = vec4(displacedPos, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  #extension GL_OES_standard_derivatives : enable
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uTopTex;
  uniform sampler2D uUnderTex;
  uniform float uTime;
  uniform float uSpreadSpeed;
  uniform float uFlameHeight;
  uniform float uFlickerFreq;
  uniform float uCharWidth;
  uniform float uEmberWidth;
  uniform float uPixelAA;
  uniform float uAspectRatio;
  uniform int uBgMode;
  uniform float uFlameLifetime;
  uniform float uFlameResidue;
  uniform float uEmberDynamic;
  uniform vec3 uIgnites[${MAX_IGNITES}];

  // 纯多项式无三角哈希，手机高分屏 0 锯齿噪点
  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbmWorm(vec2 p) {
    return 0.58 * noise(p) + 0.28 * noise(p * 2.07 + vec2(1.2, 3.4)) + 0.14 * noise(p * 4.15 + vec2(5.1, 2.2));
  }
  float fbmSmooth2(vec2 p) { return 0.66 * noise(p) + 0.34 * noise(p * 2.03 + vec2(3.1, 5.7)); }
  float fbmFlame(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.05 + vec2(2.3, -1.9); a *= 0.5; }
    return v;
  }

  vec3 acesFilm(vec3 x) {
    float luma = dot(x, vec3(0.2126, 0.7152, 0.0722));
    vec3 karisChecked = x / (1.0 + max(0.0, luma - 1.35) * 0.45);
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((karisChecked * (a * karisChecked + b)) / (karisChecked * (c * karisChecked + d) + e), 0.0, 1.0);
  }

  float evalBurnEdge(vec2 uv, out float flameLifeFactor) {
    float borderDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeBoost = 1.0 + 0.55 * exp(-borderDist * 9.0);
    float worm = fbmWorm(uv * 9.5) * 0.045;
    float n = fbmWorm(uv * 3.8) + worm;

    float minEdge = 10.0;
    float bestDt = 0.0;
    float anyActive = 0.0;

    for (int i = 0; i < ${MAX_IGNITES}; i++) {
      vec3 ig = uIgnites[i];
      float activeFlag = step(-999.0, ig.z);
      anyActive = max(anyActive, activeFlag);
      float dt = max(0.0, uTime - ig.z) * activeFlag;
      float prog = (dt < 0.2) ? (dt * 0.12) : (0.024 + (dt - 0.2) * 0.21 * uSpreadSpeed);

      vec2 diff = uv - ig.xy;
      diff.x *= uAspectRatio;
      float distField = length(diff);

      float burn = distField * 0.52 + n * 0.21;
      float threshold = prog * 1.45 * edgeBoost * activeFlag;
      float e = mix(10.0, burn - threshold, activeFlag);

      if (e < minEdge) { minEdge = e; bestDt = dt; }
    }

    float rampIn = smoothstep(0.02, 0.32, bestDt);
    float rampOut = 1.0 - smoothstep(max(0.5, uFlameLifetime * 0.6), uFlameLifetime, bestDt);
    flameLifeFactor = rampIn * mix(uFlameResidue, 1.0, rampOut) * anyActive;
    return minEdge;
  }

  void main() {
    float flameLife;
    float edge = evalBurnEdge(vUv, flameLife);

    vec3 underCol = texture2D(uUnderTex, vUv).rgb;
    if (uBgMode == 1) underCol = vec3(0.055, 0.048, 0.044);
    else if (uBgMode == 2) underCol = vec3(0.0, 0.88, 0.22);

    // 针对纸张在屏幕上的真实 UV 像素跨度，拓宽软边抗锯齿过渡带，彻底消除手机端毛边锯齿
    float fw = max(uPixelAA * 2.2, 0.0028);
    float paperMask = smoothstep(-fw * 1.6, fw * 1.6, edge);

    float scorchWidth = uCharWidth * 2.15;
    float scorch = 1.0 - smoothstep(uCharWidth * 0.45, scorchWidth, edge);
    float ch = 1.0 - smoothstep(0.0, uCharWidth, edge);

    float activeEmberScale = mix(1.0, (0.35 + 0.65 * flameLife), uEmberDynamic);
    float effectiveEmberW = uEmberWidth * activeEmberScale;
    float ember = 1.0 - smoothstep(0.0, max(0.003, effectiveEmberW), edge);
    ember *= smoothstep(-fw * 0.5, fw * 2.5, edge);

    float lowFreqWave = fbmSmooth2(vUv * 5.0 + vec2(uTime * 0.22, -uTime * 0.18));
    float slowBreath = 0.88 + 0.12 * sin(uTime * 10.5 + lowFreqWave * 5.0);
    float emberLifeScale = mix(1.0, (0.2 + 0.8 * flameLife), uEmberDynamic);
    float emberBand = clamp(pow(ember, 1.45) * mix(0.76, 1.08, lowFreqWave) * slowBreath * emberLifeScale, 0.0, 1.0);

    float emberCurve = pow(emberBand, 2.35);
    vec3 colDeepRed   = vec3(0.545, 0.145, 0.000);
    vec3 colOrangeRed = vec3(1.000, 0.416, 0.165);
    vec3 colAmber     = vec3(1.000, 0.702, 0.278);
    vec3 colWarmWhite = vec3(1.000, 0.953, 0.769);

    vec3 emberColor = mix(colDeepRed, colOrangeRed, emberCurve);
    emberColor = mix(emberColor, colAmber, pow(emberBand, 3.6) * 0.75);
    emberColor = mix(emberColor, colWarmWhite, pow(emberBand, 6.5) * 0.42);
    vec3 emberEmission = emberColor * (emberCurve * 0.82 + emberBand * 0.14);

    vec3 rawPaper = texture2D(uTopTex, vUv).rgb;
    vec3 yellowedPaper = mix(rawPaper, rawPaper * vec3(0.95, 0.77, 0.50), scorch * 0.78);
    float charTex = fbmSmooth2(vUv * 16.0);
    vec3 charColor = mix(vec3(0.09, 0.075, 0.068), vec3(0.045, 0.038, 0.035), charTex);
    vec3 surfaceCol = mix(yellowedPaper, charColor, ch);

    float ashRim = (1.0 - smoothstep(0.0, fw * 3.5, edge)) * paperMask;
    surfaceCol = mix(surfaceCol, vec3(0.52, 0.50, 0.47), ashRim * 0.35);

    float warmLightZone = exp(-max(0.0, edge) * 14.0) * (1.0 - ch * 0.7);
    float lightFlicker = 0.90 + 0.10 * sin(uTime * uFlickerFreq * 3.14159);
    surfaceCol += vec3(1.0, 0.56, 0.22) * warmLightZone * 0.22 * lightFlicker * flameLife;
    surfaceCol += emberEmission;

    float reachH = 0.022 * uFlameHeight * flameLife;
    float lowSway = sin(uTime * 11.0 + vUv.x * 9.0) * 0.008;
    float highJitter = sin(uTime * uFlickerFreq * 6.283 + vUv.x * 26.0) * 0.0032;

    float fbmShape = fbmFlame(vec2(vUv.x * 10.0 + lowSway * 15.0, vUv.y * 8.0 - uTime * 3.6));
    float fbmTemp  = fbmFlame(vec2(vUv.x * 14.0 - uTime * 1.4, vUv.y * 11.0 - uTime * 4.8) + vec2(5.2, 1.3));

    float bestFlame = 0.0;
    float bestHeightRatio = 0.0;

    for (int k = 1; k <= 5; k++) {
      float frac = float(k) / 5.0;
      vec2 sampleUv = vUv + vec2(lowSway * frac + highJitter + (fbmShape - 0.5) * 0.018 * frac, -frac * reachH);
      float dummyLife;
      float eBelow = evalBurnEdge(sampleUv, dummyLife);
      float rootMatch = smoothstep(-0.008, 0.005, eBelow) * (1.0 - smoothstep(0.005, uEmberWidth * 1.2, eBelow));
      float verticalDecay = pow(1.0 - frac, 1.25);
      float tipSplit = smoothstep(0.26 * frac, 0.78, fbmTemp);
      float contrib = rootMatch * verticalDecay * tipSplit;
      if (contrib > bestFlame) { bestFlame = contrib; bestHeightRatio = frac; }
    }

    float localRootFlame = smoothstep(-0.005, 0.003, edge) * (1.0 - smoothstep(0.003, uEmberWidth * 0.6, edge));
    float flameIntensity = max(bestFlame * 1.15, localRootFlame * 0.85) * flameLife;

    vec3 flameBlueWhite = vec3(0.561, 0.847, 1.000);
    vec3 flameCoreWhite = vec3(1.000, 0.953, 0.769);
    vec3 flameMidAmber  = vec3(1.000, 0.702, 0.278);
    vec3 flameTipOrange = vec3(1.000, 0.416, 0.165);

    vec3 flameCol = mix(flameTipOrange, flameMidAmber, smoothstep(0.15, 0.55, flameIntensity));
    flameCol = mix(flameCol, flameCoreWhite, smoothstep(0.55, 0.88, flameIntensity));
    float blueRootFactor = localRootFlame * (1.0 - bestHeightRatio) * 0.58;
    flameCol = mix(flameCol, flameBlueWhite, blueRootFactor);

    float borderDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float paperBorderShadow = smoothstep(0.0, 0.015, borderDist);
    surfaceCol *= mix(0.86, 1.0, paperBorderShadow);

    float dropShadow = smoothstep(-0.048, 0.0, edge) * (1.0 - paperMask);
    vec3 finalUnder = underCol * (1.0 - dropShadow * 0.62);
    finalUnder += vec3(1.0, 0.52, 0.20) * exp(-abs(edge) * 18.0) * 0.16 * flameLife;

    vec3 combinedHDR = mix(finalUnder, surfaceCol, paperMask);
    float flameAlpha = clamp(flameIntensity * 1.12, 0.0, 0.94);
    combinedHDR = mix(combinedHDR, flameCol * 1.65, flameAlpha * 0.88);

    float outerAA = smoothstep(0.0, fw * 1.5, borderDist);
    gl_FragColor = vec4(acesFilm(combinedHDR), outerAA);
  }
`;

let program = null, uLocs = {}, topTex = null, underTex = null, indicesLength = 0;

function getPaperNDCBounds() {
  const w = Math.max(1, compositeCanvas.width);
  const h = Math.max(1, compositeCanvas.height);
  const viewportAspect = w / h;
  const isMobile = window.innerWidth <= 860;

  let baseCenterX = -0.14;
  let baseCenterY = 0.0;
  let maxNdcW = 0.64;
  let maxNdcH = 0.76;

  if (isMobile) {
    const winH = Math.max(1, window.innerHeight);
    const dimHud = document.getElementById('dimension-hud');
    const bottomBar = document.getElementById('bottom-bar');

    const safeTopPx = dimHud ? (dimHud.getBoundingClientRect().bottom + 10) : 72;
    const safeBottomPx = bottomBar ? (bottomBar.getBoundingClientRect().top - 10) : (winH * 0.56);

    const safeCenterPx = (safeTopPx + safeBottomPx) * 0.5;
    const safeHeightPx = Math.max(120, safeBottomPx - safeTopPx);

    baseCenterX = 0.0;
    baseCenterY = 1.0 - (safeCenterPx / winH) * 2.0;
    maxNdcW = 0.88;
    maxNdcH = Math.min(0.82, (safeHeightPx / winH) * 0.92);
  }

  const ndcRatio = state.aspectRatio / viewportAspect;

  let halfH = maxNdcH;
  let halfW = halfH * ndcRatio;

  if (halfW > maxNdcW) {
    halfW = maxNdcW;
    halfH = halfW / ndcRatio;
  }

  halfW *= state.zoom;
  halfH *= state.zoom;

  const centerX = baseCenterX + state.stageOffsetX;
  const centerY = baseCenterY + state.stageOffsetY;

  return {
    left: centerX - halfW,
    right: centerX + halfW,
    bottom: centerY - halfH,
    top: centerY + halfH,
    halfW,
    halfH,
    centerX,
    centerY
  };
}

function updateGeometryAndViewport() {
  const container = document.getElementById('stage-container');
  // WebGL 像素预算：DPR 上限 1.5，总像素约 200 万以内（超预算按比例降档，保底 1）
  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const cssPixels = Math.max(1, container.clientWidth) * Math.max(1, container.clientHeight);
  if (cssPixels * dpr * dpr > 2000000) {
    dpr = Math.max(1, Math.sqrt(2000000 / cssPixels));
  }
  const w = Math.max(300, Math.floor(container.clientWidth * dpr));
  const h = Math.max(200, Math.floor(container.clientHeight * dpr));

  compositeCanvas.width = w; compositeCanvas.height = h;
  glCanvas.width = w; glCanvas.height = h;
  bloomCanvas.width = Math.max(128, Math.floor(w * 0.25));
  bloomCanvas.height = Math.max(96, Math.floor(h * 0.25));
  if (gl) gl.viewport(0, 0, w, h);

  const bounds = getPaperNDCBounds();
  const PAPER_LEFT = bounds.left, PAPER_RIGHT = bounds.right;
  const PAPER_BOTTOM = bounds.bottom, PAPER_TOP = bounds.top;

  const GRID_X = 180, GRID_Y = 135;
  const positions = [], uvs = [], indices = [];

  for (let y = 0; y <= GRID_Y; y++) {
    const v = y / GRID_Y;
    const py = PAPER_BOTTOM + v * (PAPER_TOP - PAPER_BOTTOM);
    for (let x = 0; x <= GRID_X; x++) {
      const u = x / GRID_X;
      const px = PAPER_LEFT + u * (PAPER_RIGHT - PAPER_LEFT);
      positions.push(px, py);
      uvs.push(u, 1.0 - v);
    }
  }

  for (let y = 0; y < GRID_Y; y++) {
    for (let x = 0; x < GRID_X; x++) {
      const i0 = y * (GRID_X + 1) + x;
      const i1 = i0 + 1, i2 = i0 + (GRID_X + 1), i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  indicesLength = indices.length;

  if (!gl) return;
  if (!updateGeometryAndViewport.posBuf) {
    updateGeometryAndViewport.posBuf = gl.createBuffer();
    updateGeometryAndViewport.uvBuf = gl.createBuffer();
    updateGeometryAndViewport.idxBuf = gl.createBuffer();
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, updateGeometryAndViewport.posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  const aPosLoc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPosLoc); gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, updateGeometryAndViewport.uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  const aUvLoc = gl.getAttribLocation(program, 'aUv');
  gl.enableVertexAttribArray(aUvLoc); gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, updateGeometryAndViewport.idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
}

function initWebGL() {
  if (!gl) return false;
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader compile failed:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
  if (!vs || !fs) return false;
  program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('program link failed:', gl.getProgramInfoLog(program));
    return false;
  }
  gl.useProgram(program);

  function createTex(canvas, unit) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return tex;
  }

  topTex = createTex(topPaperCanvas, 0);
  underTex = createTex(underCardCanvas, 1);

  gl.uniform1i(gl.getUniformLocation(program, 'uTopTex'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uUnderTex'), 1);

  uLocs = {
    uTime: gl.getUniformLocation(program, 'uTime'),
    uSpreadSpeed: gl.getUniformLocation(program, 'uSpreadSpeed'),
    uFlameHeight: gl.getUniformLocation(program, 'uFlameHeight'),
    uFlickerFreq: gl.getUniformLocation(program, 'uFlickerFreq'),
    uCharWidth: gl.getUniformLocation(program, 'uCharWidth'),
    uEmberWidth: gl.getUniformLocation(program, 'uEmberWidth'),
    uCurlStrength: gl.getUniformLocation(program, 'uCurlStrength'),
    uPixelAA: gl.getUniformLocation(program, 'uPixelAA'),
    uAspectRatio: gl.getUniformLocation(program, 'uAspectRatio'),
    uBgMode: gl.getUniformLocation(program, 'uBgMode'),
    uFlameLifetime: gl.getUniformLocation(program, 'uFlameLifetime'),
    uFlameResidue: gl.getUniformLocation(program, 'uFlameResidue'),
    uEmberDynamic: gl.getUniformLocation(program, 'uEmberDynamic'),
    uIgnites: gl.getUniformLocation(program, 'uIgnites[0]')
  };
  return true;
}

const POOL_SIZE = 75;
const particles = Array.from({ length: POOL_SIZE }, () => ({
  active: false, type: 'smoke', x: 0, y: 0, vx: 0, vy: 0, radius: 10, age: 0, life: 1, phase: 0, rot: 0, vRot: 0
}));

state.webglValid = initWebGL();
rebuildAllTextures();
updateDimensionHUD();
updateGeometryAndViewport();
window.addEventListener('resize', () => {
  setTimeout(updateGeometryAndViewport, 30);
});

function spawnParticle(type, canvasX, canvasY) {
  const p = particles.find(item => !item.active);
  if (!p) return;
  p.active = true; p.type = type;
  p.x = canvasX + (Math.random() - 0.5) * 14;
  p.y = canvasY + (Math.random() - 0.5) * 10;
  p.age = 0; p.phase = Math.random() * Math.PI * 2;

  if (type === 'emberGlow') {
    p.radius = 15 + Math.random() * 16;
    p.vx = (Math.random() - 0.5) * 10;
    p.vy = -12 - Math.random() * 18;
    p.life = Math.max(0.1, state.particleLife * (0.7 + Math.random() * 0.6));
  } else if (type === 'smoke') {
    p.radius = 22 + Math.random() * 28; p.vx = (Math.random() - 0.5) * 10; p.vy = -18 - Math.random() * 18; p.life = 1.6 + Math.random() * 1.1;
  } else if (type === 'ash') {
    p.radius = 3.5 + Math.random() * 4.5; p.vx = (Math.random() - 0.35) * 14; p.vy = 10 + Math.random() * 16; p.life = 1.1 + Math.random() * 0.8;
    p.rot = Math.random() * Math.PI * 2; p.vRot = (Math.random() - 0.5) * 2.5;
  }
}

function spawnIgniteThermalGlow(uvX, uvY) {
  const pos = uvToCanvas(uvX, uvY);
  for (let i = 0; i < 2; i++) spawnParticle('emberGlow', pos.x, pos.y);
}

function uvToCanvas(u, v) {
  const bounds = getPaperNDCBounds();
  const ndcX = bounds.left + u * (bounds.right - bounds.left);
  const ndcY = bounds.bottom + (1.0 - v) * (bounds.top - bounds.bottom);
  return {
    x: (ndcX * 0.5 + 0.5) * compositeCanvas.width,
    y: (1.0 - (ndcY * 0.5 + 0.5)) * compositeCanvas.height
  };
}

function canvasToUv(clientX, clientY) {
  const rect = compositeCanvas.getBoundingClientRect();
  const normX = (clientX - rect.left) / rect.width;
  const normY = (clientY - rect.top) / rect.height;
  const bounds = getPaperNDCBounds();
  const ndcX = normX * 2.0 - 1.0;
  const ndcY = (1.0 - normY) * 2.0 - 1.0;
  const u = (ndcX - bounds.left) / (bounds.right - bounds.left);
  const v = 1.0 - (ndcY - bounds.bottom) / (bounds.top - bounds.bottom);
  return { u, v };
}

function getPaperPixelCropRect() {
  const W = compositeCanvas.width;
  const H = compositeCanvas.height;
  const bounds = getPaperNDCBounds();

  const leftPx = (bounds.left * 0.5 + 0.5) * W;
  const rightPx = (bounds.right * 0.5 + 0.5) * W;
  const topPx = (1.0 - (bounds.top * 0.5 + 0.5)) * H;
  const bottomPx = (1.0 - (bounds.bottom * 0.5 + 0.5)) * H;

  const sx = Math.max(0, Math.floor(Math.min(leftPx, rightPx)));
  const sy = Math.max(0, Math.floor(Math.min(topPx, bottomPx)));
  const ex = Math.min(W, Math.ceil(Math.max(leftPx, rightPx)));
  const ey = Math.min(H, Math.ceil(Math.max(topPx, bottomPx)));

  const sw = Math.max(64, (ex - sx) & ~1);
  const sh = Math.max(64, (ey - sy) & ~1);

  return { sx, sy, sw, sh };
}

let audioCtx = null, audioGain = null, audioDest = null, audioEnabled = false;
function initOrToggleAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    audioDest = audioCtx.createMediaStreamDestination();
    const bufferSize = audioCtx.sampleRate * 3;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.03 * white) / 1.03; lastOut = output[i];
      if (Math.random() < 0.0005) output[i] += (Math.random() - 0.5) * 0.45;
    }
    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer; whiteNoise.loop = true;
    const filter = audioCtx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = 0.7;
    audioGain = audioCtx.createGain(); audioGain.gain.value = 0.0;
    whiteNoise.connect(filter); filter.connect(audioGain); audioGain.connect(audioCtx.destination); audioGain.connect(audioDest);
    whiteNoise.start(0);
  }
  audioEnabled = !audioEnabled;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const btn = document.getElementById('btn-audio');
  btn.textContent = audioEnabled ? '音效: 开' : '音效: 关';
  btn.classList.toggle('active', audioEnabled);
}

let lastFrameTime = performance.now() * 0.001;

function renderLoop(nowMs) {
  requestAnimationFrame(renderLoop);
  const now = nowMs * 0.001;
  const dt = Math.min(0.05, now - lastFrameTime);
  lastFrameTime = now;

  if (state.isPaused) return;

  const simTime = now - state.startTime - state.accumulatedPausedDuration;

  const hudStage = document.getElementById('hud-stage');
  if (state.firstIgniteTime === null) {
    hudStage.textContent = '就绪 · 点击纸边引燃';
  } else {
    const elapsed = Math.max(0, simTime - state.firstIgniteTime);
    if (elapsed < 0.2) hudStage.textContent = '0–0.2s 预热 (' + elapsed.toFixed(1) + 's)';
    else if (elapsed < 0.8) hudStage.textContent = '0.2–0.8s 燃焰 (' + elapsed.toFixed(1) + 's)';
    else if (elapsed < 3.0) hudStage.textContent = '0.8–3.0s 蔓延 (' + elapsed.toFixed(1) + 's)';
    else if (elapsed < 6.0) hudStage.textContent = '3.0–6.0s 主燃 (' + elapsed.toFixed(1) + 's)';
    else hudStage.textContent = '6.0s+ 余烬消散';
  }

  if (audioGain && audioCtx) {
    const targetGain = (audioEnabled && ignitePoints.length > 0) ? 0.18 : 0.0;
    audioGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.12);
  }

  const W = compositeCanvas.width, H = compositeCanvas.height;
  compCtx.save();
  if (state.bgMode === 2) {
    compCtx.fillStyle = '#00E038'; compCtx.fillRect(0, 0, W, H);
  } else {
    const bgGrad = compCtx.createRadialGradient(W * 0.45, H * 0.42, W * 0.05, W * 0.45, H * 0.42, W * 0.78);
    bgGrad.addColorStop(0, '#1B1612'); bgGrad.addColorStop(0.45, '#13100E'); bgGrad.addColorStop(1, '#0B0B0C');
    compCtx.fillStyle = bgGrad; compCtx.fillRect(0, 0, W, H);
  }

  if (state.webglValid && gl) {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);

    const bounds = getPaperNDCBounds();
    const paperScreenPx = Math.max(120.0, Math.min((bounds.right - bounds.left) * 0.5 * W, (bounds.top - bounds.bottom) * 0.5 * H));

    gl.uniform1f(uLocs.uTime, simTime);
    gl.uniform1f(uLocs.uSpreadSpeed, state.spreadSpeed);
    gl.uniform1f(uLocs.uFlameHeight, state.flameHeight);
    gl.uniform1f(uLocs.uFlickerFreq, state.reducedMotion ? 4.0 : state.flickerFreq);
    gl.uniform1f(uLocs.uCharWidth, state.charWidth);
    gl.uniform1f(uLocs.uEmberWidth, state.emberWidth);
    gl.uniform1f(uLocs.uCurlStrength, state.curlStrength);
    gl.uniform1f(uLocs.uPixelAA, 1.5 / paperScreenPx);
    gl.uniform1f(uLocs.uAspectRatio, state.aspectRatio);
    gl.uniform1i(uLocs.uBgMode, state.bgMode);
    gl.uniform1f(uLocs.uFlameLifetime, state.flameLifetime);
    gl.uniform1f(uLocs.uFlameResidue, state.flameResidue);
    gl.uniform1f(uLocs.uEmberDynamic, state.emberDynamic ? 1.0 : 0.0);

    const flatIgnites = new Float32Array(MAX_IGNITES * 3);
    for (let i = 0; i < MAX_IGNITES; i++) {
      if (i < ignitePoints.length) {
        flatIgnites[i * 3 + 0] = ignitePoints[i].x;
        flatIgnites[i * 3 + 1] = ignitePoints[i].y;
        flatIgnites[i * 3 + 2] = ignitePoints[i].t0;
      } else {
        flatIgnites[i * 3 + 0] = 0.0; flatIgnites[i * 3 + 1] = 0.0; flatIgnites[i * 3 + 2] = -10000.0;
      }
    }
    gl.uniform3fv(uLocs.uIgnites, flatIgnites);
    gl.drawElements(gl.TRIANGLES, indicesLength, gl.UNSIGNED_SHORT, 0);
    compCtx.drawImage(glCanvas, 0, 0, W, H);

    if (state.bloomStrength > 0.01) {
      bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
      bloomCtx.filter = 'blur(8px) brightness(0.92) contrast(1.35)';
      bloomCtx.drawImage(glCanvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
      bloomCtx.filter = 'none';

      compCtx.save();
      compCtx.globalCompositeOperation = 'screen';
      compCtx.globalAlpha = state.bloomStrength * 0.52;
      compCtx.drawImage(bloomCanvas, 0, 0, W, H);
      compCtx.restore();
    }
  }

  if (ignitePoints.length > 0 && !state.reducedMotion) {
    const latest = ignitePoints[ignitePoints.length - 1];
    const age = simTime - latest.t0;
    if (age > 0.08 && age < state.particleWindow) {
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.min(0.45, age * 0.095 * state.spreadSpeed);
      const emitU = Math.min(0.98, Math.max(0.02, latest.x + Math.cos(angle) * rad));
      const emitV = Math.min(0.98, Math.max(0.02, latest.y + Math.sin(angle) * rad));
      const cPos = uvToCanvas(emitU, emitV);

      if (Math.random() < state.particleFreq) spawnParticle('emberGlow', cPos.x, cPos.y);
      if (Math.random() < state.smokeAmount * 0.25) spawnParticle('smoke', cPos.x, cPos.y - 10);
      if (Math.random() < 0.07) spawnParticle('ash', cPos.x, cPos.y + 6);
    }
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const p = particles[i];
    if (!p.active) continue;
    p.age += dt;
    if (p.age >= p.life) { p.active = false; continue; }
    const t = p.age / p.life;
    const sway = Math.sin(simTime * 2.2 + p.phase) * 10 * dt;
    p.x += p.vx * dt + sway; p.y += p.vy * dt;

    if (p.type === 'emberGlow') {
      const slowPulse = 0.90 + 0.10 * Math.sin(simTime * 11.0 + p.phase);
      const alpha = Math.sin(t * Math.PI) * Math.pow(1.0 - t, 1.8) * 0.18 * slowPulse;
      compCtx.save();
      compCtx.globalCompositeOperation = 'lighter';
      const gRad = compCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      gRad.addColorStop(0, `rgba(255, 179, 71, ${alpha})`);
      gRad.addColorStop(0.55, `rgba(255, 106, 42, ${alpha * 0.45})`);
      gRad.addColorStop(1, 'rgba(139, 37, 0, 0)');
      compCtx.fillStyle = gRad; compCtx.beginPath(); compCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); compCtx.fill();
      compCtx.restore();
    } else if (p.type === 'smoke') {
      const smokeAlpha = Math.sin(t * Math.PI) * 0.065 * state.smokeAmount;
      const curRad = p.radius * (1.0 + t * 1.35);
      const sGrad = compCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, curRad);
      sGrad.addColorStop(0, `rgba(212, 206, 198, ${smokeAlpha})`); sGrad.addColorStop(1, 'rgba(212, 206, 198, 0)');
      compCtx.fillStyle = sGrad; compCtx.beginPath(); compCtx.arc(p.x, p.y, curRad, 0, Math.PI * 2); compCtx.fill();
    } else if (p.type === 'ash') {
      p.rot += p.vRot * dt;
      const ashAlpha = (1.0 - t) * 0.55;
      compCtx.save(); compCtx.translate(p.x, p.y); compCtx.rotate(p.rot);
      compCtx.fillStyle = `rgba(68, 62, 58, ${ashAlpha})`;
      compCtx.fillRect(-p.radius * 0.6, -p.radius * 0.25, p.radius * 1.2, p.radius * 0.5);
      compCtx.restore();
    }
  }

  if (state.postStrength > 0.01 && state.bgMode !== 2) {
    const vig = compCtx.createRadialGradient(W * 0.45, H * 0.45, W * 0.28, W * 0.5, H * 0.5, W * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(6, 5, 4, ${state.postStrength * 0.65})`);
    compCtx.fillStyle = vig; compCtx.fillRect(0, 0, W, H);
  }
  compCtx.restore();

  if (mediaRecorder && mediaRecorder.state === 'recording' && state.exportArea === 'paper') {
    const crop = getPaperPixelCropRect();
    if (recordCropCanvas.width !== crop.sw || recordCropCanvas.height !== crop.sh) {
      recordCropCanvas.width = crop.sw;
      recordCropCanvas.height = crop.sh;
    }
    recordCropCtx.clearRect(0, 0, crop.sw, crop.sh);
    recordCropCtx.drawImage(
      compositeCanvas,
      crop.sx, crop.sy, crop.sw, crop.sh,
      0, 0, crop.sw, crop.sh
    );
  }
}

requestAnimationFrame(renderLoop);

// ===== 容器能力封装（window.xhs 由小红书容器注入，缺失时安全降级） =====
function getMiniTool() {
  return window.xhs && window.xhs.miniTool;
}

function readBuildVersion(launchOptions) {
  const miniToolEnv = launchOptions && launchOptions.miniToolEnv;
  return Number(miniToolEnv && miniToolEnv.buildVersion) || 0;
}

function getBuildVersion() {
  const xhs = window.xhs;
  const syncBuildVersion = readBuildVersion(xhs && xhs.launchOptions);
  if (syncBuildVersion) return Promise.resolve(syncBuildVersion);

  const miniTool = xhs && xhs.miniTool;
  if (!miniTool || typeof miniTool.getLaunchOptions !== 'function') return Promise.resolve(0);

  return miniTool.getLaunchOptions().then(readBuildVersion, () => 0);
}

const STORAGE_MIN_CLIENT_VERSION = 9460;

function isClientVersionAtLeast(buildVersion, minimumClientVersion) {
  return Math.floor((Number(buildVersion) || 0) / 1000) >= minimumClientVersion;
}

// 小工具本地缓存：9.46+ 优先 setStorage，低版本回退浏览器存储；失败返回 false 由调用方提示
function setLocalData(key, data) {
  let serializedData;
  try {
    serializedData = JSON.stringify(data);
  } catch (error) {
    return Promise.resolve(false);
  }
  if (typeof serializedData !== 'string') return Promise.resolve(false);

  return getBuildVersion().then(buildVersion => {
    const miniTool = getMiniTool();
    if (
      isClientVersionAtLeast(buildVersion, STORAGE_MIN_CLIENT_VERSION) &&
      miniTool &&
      typeof miniTool.setStorage === 'function'
    ) {
      return miniTool.setStorage({ key: key, data: serializedData }).then(() => true, () => false);
    }
    try {
      localStorage.setItem(key, serializedData);
      return true;
    } catch (error) {
      return false;
    }
  });
}

function getLocalData(key) {
  return getBuildVersion().then(buildVersion => {
    const miniTool = getMiniTool();
    if (
      isClientVersionAtLeast(buildVersion, STORAGE_MIN_CLIENT_VERSION) &&
      miniTool &&
      typeof miniTool.getStorage === 'function'
    ) {
      return miniTool.getStorage({ key: key }).then(res => {
        return res && res.data != null ? res.data : null;
      }, () => null);
    }
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  });
}

// 截图保存到系统相册：saveImageToPhotosAlbum（9.42+），大图先经 writeTempFile 换成 filePath 再保存
function saveImageToAlbum(dataURL) {
  const miniTool = getMiniTool();
  if (!miniTool || typeof miniTool.saveImageToPhotosAlbum !== 'function') {
    showToast('当前环境不支持保存到相册');
    return Promise.resolve(false);
  }
  const doSave = filePath => miniTool.saveImageToPhotosAlbum({ filePath: filePath });
  if (typeof miniTool.writeTempFile === 'function') {
    return miniTool.writeTempFile({ data: dataURL }).then(res => {
      return doSave(res && res.filePath ? res.filePath : dataURL);
    }, () => doSave(dataURL));
  }
  return doSave(dataURL);
}

function takeScreenshot() {
  let dataURL;
  if (state.exportArea === 'paper') {
    const crop = getPaperPixelCropRect();
    recordCropCanvas.width = crop.sw;
    recordCropCanvas.height = crop.sh;
    recordCropCtx.clearRect(0, 0, crop.sw, crop.sh);
    recordCropCtx.drawImage(
      compositeCanvas,
      crop.sx, crop.sy, crop.sw, crop.sh,
      0, 0, crop.sw, crop.sh
    );
    dataURL = recordCropCanvas.toDataURL('image/png');
  } else {
    dataURL = compositeCanvas.toDataURL('image/png');
  }
  showToast('正在保存截图…');
  saveImageToAlbum(dataURL).then(ok => {
    if (ok) showToast(state.exportArea === 'paper' ? '已保存截图到相册（仅画布区域）' : '已保存截图到相册（全屏舞台）');
  }, err => {
    showToast('保存失败：' + ((err && err.errMsg) || '请重试'));
  });
}

const btnModeIgnite = document.getElementById('mode-ignite');
const btnModePan = document.getElementById('mode-pan');
const btnModeCropTop = document.getElementById('mode-crop-top');
const btnModeCropUnder = document.getElementById('mode-crop-under');

function setInteractMode(mode) {
  state.interactMode = mode;
  btnModeIgnite.classList.toggle('active', mode === 'ignite');
  btnModePan.classList.toggle('active', mode === 'pan');
  btnModeCropTop.classList.toggle('active', mode === 'cropTop');
  btnModeCropUnder.classList.toggle('active', mode === 'cropUnder');
  compositeCanvas.style.cursor = (mode === 'ignite') ? 'crosshair' : 'grab';
}

btnModeIgnite.addEventListener('click', () => setInteractMode('ignite'));
btnModePan.addEventListener('click', () => setInteractMode('pan'));
btnModeCropTop.addEventListener('click', () => setInteractMode('cropTop'));
btnModeCropUnder.addEventListener('click', () => setInteractMode('cropUnder'));

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
    state.spacePressed = true;
    compositeCanvas.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    state.spacePressed = false;
    compositeCanvas.style.cursor = (state.interactMode === 'ignite') ? 'crosshair' : 'grab';
  }
});

compositeCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

compositeCanvas.addEventListener('pointerdown', (e) => {
  state.pointerDown = true;
  state.downClientX = e.clientX;
  state.downClientY = e.clientY;
  state.lastClientX = e.clientX;
  state.lastClientY = e.clientY;

  const forceCanvasMove = state.spacePressed || (e.button === 2) || (e.button === 1);
  if (forceCanvasMove || state.interactMode === 'pan') {
    state.isDraggingPan = 'canvas';
  } else if (state.interactMode === 'cropTop') {
    state.isDraggingPan = 'cropTop';
  } else if (state.interactMode === 'cropUnder') {
    state.isDraggingPan = 'cropUnder';
  } else {
    state.isDraggingPan = false;
  }

  if (!state.isDraggingPan && e.button === 0 && !state.isPaused) {
    const { u, v } = canvasToUv(e.clientX, e.clientY);
    if (u >= -0.02 && u <= 1.02 && v >= -0.02 && v <= 1.02) {
      addIgnitePoint(Math.min(0.99, Math.max(0.01, u)), Math.min(0.99, Math.max(0.01, v)));
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (!state.pointerDown) return;

  const dxClient = e.clientX - state.lastClientX;
  const dyClient = e.clientY - state.lastClientY;
  state.lastClientX = e.clientX;
  state.lastClientY = e.clientY;

  const rect = compositeCanvas.getBoundingClientRect();

  if (state.isDraggingPan === 'canvas') {
    const dprX = compositeCanvas.width / Math.max(1, rect.width);
    const dprY = compositeCanvas.height / Math.max(1, rect.height);
    const ndcDx = (dxClient / Math.max(1, rect.width)) * 2.0;
    const ndcDy = -(dyClient / Math.max(1, rect.height)) * 2.0;

    state.stageOffsetX += ndcDx;
    state.stageOffsetY += ndcDy;

    for (let i = 0; i < POOL_SIZE; i++) {
      if (particles[i].active) {
        particles[i].x += dxClient * dprX;
        particles[i].y += dyClient * dprY;
      }
    }
    updateGeometryAndViewport();
  } else if (state.isDraggingPan === 'cropTop') {
    const bounds = getPaperNDCBounds();
    const paperPixelW = (bounds.right - bounds.left) * 0.5 * rect.width;
    const paperPixelH = (bounds.top - bounds.bottom) * 0.5 * rect.height;

    state.topPanX += dxClient / Math.max(80, paperPixelW);
    state.topPanY += dyClient / Math.max(80, paperPixelH);
    rebuildTopTexture();
  } else if (state.isDraggingPan === 'cropUnder') {
    const bounds = getPaperNDCBounds();
    const paperPixelW = (bounds.right - bounds.left) * 0.5 * rect.width;
    const paperPixelH = (bounds.top - bounds.bottom) * 0.5 * rect.height;

    state.underPanX += dxClient / Math.max(80, paperPixelW);
    state.underPanY += dyClient / Math.max(80, paperPixelH);
    rebuildUnderTexture();
  } else if (state.interactMode === 'ignite' && !state.isPaused) {
    const { u, v } = canvasToUv(e.clientX, e.clientY);
    if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
      addIgnitePoint(u, v);
    }
  }
});

window.addEventListener('pointerup', () => {
  state.pointerDown = false;
  state.isDraggingPan = false;
});

compositeCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomDelta = e.deltaY < 0 ? 0.06 : -0.06;

  if (state.interactMode === 'cropTop') {
    state.topZoom = Math.min(3.5, Math.max(0.2, state.topZoom + zoomDelta));
    syncTransformUI();
    rebuildTopTexture();
  } else if (state.interactMode === 'cropUnder') {
    state.underZoom = Math.min(3.5, Math.max(0.2, state.underZoom + zoomDelta));
    syncTransformUI();
    rebuildUnderTexture();
  } else {
    state.zoom = Math.min(2.8, Math.max(0.3, state.zoom + zoomDelta));
    syncTransformUI();
    updateGeometryAndViewport();
  }
}, { passive: false });

document.getElementById('btn-reset-top-transform').addEventListener('click', () => {
  state.topPanX = 0.0; state.topPanY = 0.0; state.topZoom = 1.0;
  syncTransformUI(); rebuildTopTexture();
});

document.getElementById('btn-reset-under-transform').addEventListener('click', () => {
  state.underPanX = 0.0; state.underPanY = 0.0; state.underZoom = 1.0;
  syncTransformUI(); rebuildUnderTexture();
});

document.getElementById('btn-center-crop').addEventListener('click', () => {
  state.zoom = 1.0; state.stageOffsetX = 0.0; state.stageOffsetY = 0.0;
  state.topPanX = 0.0; state.topPanY = 0.0; state.topZoom = 1.0;
  state.underPanX = 0.0; state.underPanY = 0.0; state.underZoom = 1.0;
  syncTransformUI(); rebuildAllTextures(); updateGeometryAndViewport();
});

document.getElementById('btn-ignite-edge').addEventListener('click', () => { if(!state.isPaused) addIgnitePoint(0.92, 0.78); });
document.getElementById('btn-ignite-corner').addEventListener('click', () => { 
  if(!state.isPaused) { addIgnitePoint(0.06, 0.88); addIgnitePoint(0.94, 0.82); }
});
document.getElementById('btn-reset').addEventListener('click', resetPaper);
document.getElementById('btn-audio').addEventListener('click', initOrToggleAudio);

const btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', () => {
  state.isPaused = !state.isPaused;
  if (state.isPaused) {
    state.pauseStartTime = performance.now() * 0.001;
    btnPause.textContent = '恢复播放'; btnPause.classList.add('active');
  } else {
    state.accumulatedPausedDuration += (performance.now() * 0.001 - state.pauseStartTime);
    btnPause.textContent = '暂停'; btnPause.classList.remove('active');
  }
});

document.getElementById('btn-screenshot').addEventListener('click', takeScreenshot);
document.getElementById('btn-restore-default').addEventListener('click', restoreDefaultImages);

document.getElementById('param-zoom').addEventListener('input', (e) => {
  state.zoom = parseFloat(e.target.value);
  document.getElementById('val-zoom').textContent = state.zoom.toFixed(2) + 'x';
  updateGeometryAndViewport();
});

document.getElementById('param-top-zoom').addEventListener('input', (e) => {
  state.topZoom = parseFloat(e.target.value);
  document.getElementById('val-top-zoom').textContent = state.topZoom.toFixed(2) + 'x';
  rebuildTopTexture();
});

document.getElementById('param-under-zoom').addEventListener('input', (e) => {
  state.underZoom = parseFloat(e.target.value);
  document.getElementById('val-under-zoom').textContent = state.underZoom.toFixed(2) + 'x';
  rebuildUnderTexture();
});

document.querySelectorAll('[data-aspect]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-aspect]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.aspect;
    if (mode === '1-1') state.aspectRatio = 1.0;
    else if (mode === '16-9') state.aspectRatio = 16 / 9;
    else if (mode === '9-16') state.aspectRatio = 9 / 16;
    else if (mode === '4-3') state.aspectRatio = 4 / 3;
    else if (mode === '1-4') state.aspectRatio = 1 / 4;
    else if (mode === '21-9') state.aspectRatio = 21 / 9;

    state.currentImgWidth = Math.round(800 * Math.sqrt(state.aspectRatio));
    state.currentImgHeight = Math.round(800 / Math.sqrt(state.aspectRatio));
    updateDimensionHUD();

    rebuildAllTextures();
    updateGeometryAndViewport();
    resetPaper();
  });
});

const PRESETS = {
  tissue: { speed: 1.15, height: 2.6, flicker: 15, char: 0.048, ember: 0.026, curl: 0.52, smoke: 0.25, bloom: 0.36, post: 0.25 },
  card:   { speed: 0.62, height: 2.1, flicker: 12, char: 0.088, ember: 0.042, curl: 0.85, smoke: 0.52, bloom: 0.40, post: 0.30 },
  ember:  { speed: 0.48, height: 1.1, flicker: 9,  char: 0.095, ember: 0.068, curl: 0.65, smoke: 0.35, bloom: 0.46, post: 0.28 }
};

document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cfg = PRESETS[btn.dataset.preset];
    if (!cfg) return;
    setSlider('param-speed', 'val-speed', cfg.speed, v => { state.spreadSpeed = v; return v.toFixed(2) + 'x'; });
    setSlider('param-height', 'val-height', cfg.height, v => { state.flameHeight = v; return v.toFixed(1) + ' cm'; });
    setSlider('param-flicker', 'val-flicker', cfg.flicker, v => { state.flickerFreq = v; return v + ' Hz'; });
    setSlider('param-char', 'val-char', cfg.char, v => { state.charWidth = v; return v.toFixed(3); });
    setSlider('param-ember', 'val-ember', cfg.ember, v => { state.emberWidth = v; return v.toFixed(3); });
    setSlider('param-curl', 'val-curl', cfg.curl, v => { state.curlStrength = v; return v.toFixed(2); });
    setSlider('param-smoke', 'val-smoke', cfg.smoke, v => { state.smokeAmount = v; return v.toFixed(2); });
    setSlider('param-bloom', 'val-bloom', cfg.bloom, v => { state.bloomStrength = v; return v.toFixed(2); });
    setSlider('param-post', 'val-post', cfg.post, v => { state.postStrength = v; return v.toFixed(2); });
  });
});

function bindSlider(inputId, valId, applyFn) {
  const el = document.getElementById(inputId), valEl = document.getElementById(valId);
  el.addEventListener('input', () => { valEl.textContent = applyFn(parseFloat(el.value)); });
}
function setSlider(inputId, valId, val, applyFn) {
  const el = document.getElementById(inputId), valEl = document.getElementById(valId);
  el.value = val; valEl.textContent = applyFn(val);
}

bindSlider('param-speed', 'val-speed', v => { state.spreadSpeed = v; return v.toFixed(2) + 'x'; });
bindSlider('param-height', 'val-height', v => { state.flameHeight = v; return v.toFixed(1) + ' cm'; });
bindSlider('param-flicker', 'val-flicker', v => { state.flickerFreq = v; return v + ' Hz'; });
bindSlider('param-char', 'val-char', v => { state.charWidth = v; return v.toFixed(3); });
bindSlider('param-ember', 'val-ember', cfg => { state.emberWidth = cfg; return cfg.toFixed(3); });
bindSlider('param-curl', 'val-curl', v => { state.curlStrength = v; return v.toFixed(2); });
bindSlider('param-smoke', 'val-smoke', v => { state.smokeAmount = v; return v.toFixed(2); });
bindSlider('param-bloom', 'val-bloom', v => { state.bloomStrength = v; return v.toFixed(2); });
bindSlider('param-post', 'val-post', v => { state.postStrength = v; return v.toFixed(2); });

// 绑定新增的自由调节参数滑块
bindSlider('param-flame-life', 'val-flame-life', v => { state.flameLifetime = v; return v.toFixed(1) + ' s'; });
bindSlider('param-flame-residue', 'val-flame-residue', v => { state.flameResidue = v; return v.toFixed(2); });
bindSlider('param-particle-life', 'val-particle-life', v => { state.particleLife = v; return v.toFixed(2) + ' s'; });
bindSlider('param-particle-freq', 'val-particle-freq', v => { state.particleFreq = v / 100.0; return Math.round(v) + ' %'; });
bindSlider('param-particle-window', 'val-particle-window', v => { state.particleWindow = v; return v.toFixed(1) + ' s'; });

const btnEmberDyn = document.getElementById('btn-ember-mode-dyn');
const btnEmberStatic = document.getElementById('btn-ember-mode-static');
function syncEmberModeButtons() {
  btnEmberDyn.classList.toggle('active', state.emberDynamic);
  btnEmberStatic.classList.toggle('active', !state.emberDynamic);
}
btnEmberDyn.addEventListener('click', () => {
  state.emberDynamic = true;
  syncEmberModeButtons();
  showToast('余烬模式：动态收缩变暗 (更利落)');
});
btnEmberStatic.addEventListener('click', () => {
  state.emberDynamic = false;
  syncEmberModeButtons();
  showToast('余烬模式：静态常驻呼吸 (旧版效果)');
});
syncEmberModeButtons();

const bgBtns = ['bg-mode-card', 'bg-mode-dark', 'bg-mode-green'];
bgBtns.forEach((id, idx) => {
  document.getElementById(id).addEventListener('click', () => {
    bgBtns.forEach(b => document.getElementById(b).classList.remove('active'));
    document.getElementById(id).classList.add('active');
    state.bgMode = idx;
  });
});

function handleImageUpload(inputEl, labelId, isTopLayer) {
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById(labelId).textContent = file.name.slice(0, 12);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        handleCustomImage(img, isTopLayer);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

handleImageUpload(document.getElementById('upload-top'), 'top-file-name', true);
handleImageUpload(document.getElementById('upload-under'), 'under-file-name', false);

// 轻提示 Toast
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast-msg');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// 手机端滑动防误触：滑块锁定开关
let slidersLocked = window.innerWidth <= 860;
const panelBodyEl = document.getElementById('panel-body');
const btnSliderLock = document.getElementById('btn-slider-lock');
const btnPanelLockToggle = document.getElementById('btn-panel-lock-toggle');

function applySliderLockState() {
  panelBodyEl.classList.toggle('sliders-locked', slidersLocked);
  btnSliderLock.classList.toggle('locked', slidersLocked);
  btnPanelLockToggle.classList.toggle('active', slidersLocked);
  btnSliderLock.textContent = slidersLocked ? '🔒 滑块已锁' : '🔓 滑块解锁';
  btnPanelLockToggle.textContent = slidersLocked ? '🔓 点击解锁滑块' : '🔒 锁定滑块 (防误触)';
}
applySliderLockState();

btnSliderLock.addEventListener('click', (e) => {
  e.stopPropagation();
  slidersLocked = !slidersLocked;
  applySliderLockState();
  showToast(slidersLocked ? '已锁定滑块（上下滑动不误触）' : '已解锁滑块（可自由调节参数）');
});

btnPanelLockToggle.addEventListener('click', () => {
  slidersLocked = !slidersLocked;
  applySliderLockState();
  showToast(slidersLocked ? '已锁定滑块（上下滑动不误触）' : '已解锁滑块（可自由调节参数）');
});

// 保存/读取/重置自定义燃烧参数与图片缩放设置
const STORAGE_KEY = 'IMAGE_FLAME_SIM_CONFIG_V1';

function syncAllShaderSlidersFromState() {
  setSlider('param-speed', 'val-speed', state.spreadSpeed, v => v.toFixed(2) + 'x');
  setSlider('param-height', 'val-height', state.flameHeight, v => v.toFixed(1) + ' cm');
  setSlider('param-flicker', 'val-flicker', state.flickerFreq, v => v + ' Hz');
  setSlider('param-char', 'val-char', state.charWidth, v => v.toFixed(3));
  setSlider('param-ember', 'val-ember', state.emberWidth, v => v.toFixed(3));
  setSlider('param-curl', 'val-curl', state.curlStrength, v => v.toFixed(2));
  setSlider('param-smoke', 'val-smoke', state.smokeAmount, v => v.toFixed(2));
  setSlider('param-bloom', 'val-bloom', state.bloomStrength, v => v.toFixed(2));
  setSlider('param-post', 'val-post', state.postStrength, v => v.toFixed(2));
  syncTransformUI();
}

document.getElementById('btn-save-config').addEventListener('click', () => {
  const cfg = {
    spreadSpeed: state.spreadSpeed,
    flameHeight: state.flameHeight,
    flickerFreq: state.flickerFreq,
    charWidth: state.charWidth,
    emberWidth: state.emberWidth,
    curlStrength: state.curlStrength,
    smokeAmount: state.smokeAmount,
    bloomStrength: state.bloomStrength,
    postStrength: state.postStrength,
    bgMode: state.bgMode,
    aspectRatio: state.aspectRatio,
    currentImgWidth: state.currentImgWidth,
    currentImgHeight: state.currentImgHeight,
    zoom: state.zoom,
    stageOffsetX: state.stageOffsetX,
    stageOffsetY: state.stageOffsetY,
    topPanX: state.topPanX,
    topPanY: state.topPanY,
    topZoom: state.topZoom,
    underPanX: state.underPanX,
    underPanY: state.underPanY,
    underZoom: state.underZoom,
    exportFormat: state.exportFormat,
    exportArea: state.exportArea
  };
  setLocalData(STORAGE_KEY, cfg).then(ok => {
    showToast(ok ? '已保存当前燃烧参数与导出设置' : '保存失败：本地存储不可用');
  });
});

const btnFmtMp4 = document.getElementById('export-fmt-mp4');
const btnFmtWebm = document.getElementById('export-fmt-webm');
const btnAreaPaper = document.getElementById('export-area-paper');
const btnAreaFull = document.getElementById('export-area-full');

function syncExportButtonsUI() {
  btnFmtMp4.classList.toggle('active', state.exportFormat === 'mp4');
  btnFmtWebm.classList.toggle('active', state.exportFormat === 'webm');
  btnAreaPaper.classList.toggle('active', state.exportArea === 'paper');
  btnAreaFull.classList.toggle('active', state.exportArea === 'full');
}

btnFmtMp4.addEventListener('click', () => {
  state.exportFormat = 'mp4';
  syncExportButtonsUI();
  showToast('导出视频格式已设为：MP4');
});

btnFmtWebm.addEventListener('click', () => {
  state.exportFormat = 'webm';
  syncExportButtonsUI();
  showToast('导出视频格式已设为：WebM');
});

btnAreaPaper.addEventListener('click', () => {
  state.exportArea = 'paper';
  syncExportButtonsUI();
  showToast('导出画面范围：仅画布区域');
});

btnAreaFull.addEventListener('click', () => {
  state.exportArea = 'full';
  syncExportButtonsUI();
  showToast('导出画面范围：全屏舞台画面');
});

document.getElementById('btn-load-config').addEventListener('click', () => {
  getLocalData(STORAGE_KEY).then(raw => {
    if (!raw) {
      showToast('暂无已保存的设置');
      return;
    }
    let cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (err) {
      showToast('读取设置失败');
      return;
    }
    Object.assign(state, cfg);
    syncAllShaderSlidersFromState();
    syncExportButtonsUI();

    bgBtns.forEach((id, idx) => {
      document.getElementById(id).classList.toggle('active', idx === state.bgMode);
    });

    document.querySelectorAll('[data-aspect]').forEach(b => {
      const [aw, ah] = b.dataset.aspect.split('-').map(Number);
      b.classList.toggle('active', Math.abs(state.aspectRatio - (aw / ah)) < 0.02);
    });

    updateDimensionHUD();
    rebuildAllTextures();
    updateGeometryAndViewport();
    showToast('已恢复保存的燃烧参数与缩放设置');
  }).catch(() => {
    showToast('读取设置失败');
  });
});

document.getElementById('btn-reset-config').addEventListener('click', () => {
  Object.assign(state, {
    spreadSpeed: 1.00,
    flameHeight: 2.6,
    flickerFreq: 14.0,
    charWidth: 0.055,
    emberWidth: 0.028,
    curlStrength: 0.55,
    smokeAmount: 0.32,
    bloomStrength: 0.38,
    postStrength: 0.25,
    bgMode: 0,
    zoom: 1.00,
    stageOffsetX: 0.0,
    stageOffsetY: 0.0,
    topPanX: 0.0,
    topPanY: 0.0,
    topZoom: 1.00,
    underPanX: 0.0,
    underPanY: 0.0,
    underZoom: 1.00,
    exportFormat: 'mp4',
    exportArea: 'paper'
  });
  syncAllShaderSlidersFromState();
  syncExportButtonsUI();
  bgBtns.forEach((id, idx) => {
    document.getElementById(id).classList.toggle('active', idx === 0);
  });
  rebuildAllTextures();
  updateGeometryAndViewport();
  showToast('已重置为初始默认参数');
});

// 燃烧参数使用调整说明弹窗开关
const guideModalMask = document.getElementById('guide-modal-mask');
document.getElementById('btn-open-guide').addEventListener('click', () => guideModalMask.classList.add('open'));
document.getElementById('btn-panel-guide').addEventListener('click', () => guideModalMask.classList.add('open'));
document.getElementById('btn-close-guide').addEventListener('click', () => guideModalMask.classList.remove('open'));
guideModalMask.addEventListener('click', (e) => {
  if (e.target === guideModalMask) guideModalMask.classList.remove('open');
});

// 关于本应用：创作者与版本 1.0 信息弹窗（点击左上角标题触发）
const aboutModalMask = document.getElementById('about-modal-mask');
document.getElementById('btn-open-about').addEventListener('click', () => aboutModalMask.classList.add('open'));
document.getElementById('btn-close-about').addEventListener('click', () => aboutModalMask.classList.remove('open'));
aboutModalMask.addEventListener('click', (e) => {
  if (e.target === aboutModalMask) aboutModalMask.classList.remove('open');
});

// 复制小红书号：容器禁用剪贴板 API，改为高亮可选中文本，引导长按/选中手动复制
document.getElementById('btn-copy-xhs').addEventListener('click', () => {
  const xhsIdEl = document.getElementById('xhs-number');
  if (xhsIdEl) {
    xhsIdEl.classList.add('copy-highlight');
    setTimeout(() => xhsIdEl.classList.remove('copy-highlight'), 2600);
  }
  showToast('请长按或选中号码 1523176659 复制');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    guideModalMask.classList.remove('open');
    aboutModalMask.classList.remove('open');
  }
});

// 手机端抽屉收起/展开逻辑
const controlPanel = document.getElementById('control-panel');
const bottomBar = document.getElementById('bottom-bar');
const drawerToggleText = document.getElementById('drawer-toggle-text');

function toggleMobileDrawer() {
  if (window.innerWidth > 860) return;
  const isCollapsed = controlPanel.classList.toggle('collapsed');
  bottomBar.classList.toggle('drawer-collapsed', isCollapsed);
  drawerToggleText.textContent = isCollapsed ? '展开面板 ▲' : '收起面板 ▼';
  setTimeout(updateGeometryAndViewport, 60);
  setTimeout(updateGeometryAndViewport, 300);
}

document.getElementById('drawer-handle').addEventListener('click', toggleMobileDrawer);
document.getElementById('panel-header-toggle').addEventListener('click', toggleMobileDrawer);

let mediaRecorder = null, recordedChunks = [];
const btnRecord = document.getElementById('btn-record'), recLabel = document.getElementById('rec-label');

function resetRecordUI() {
  btnRecord.classList.remove('recording');
  recLabel.textContent = '录制视频 (60FPS)';
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 视频导出：容器禁用 a[download] 下载，改为 writeTempFile 落成本地文件后经 postNote 唤起视频发布页
btnRecord.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  const miniTool = getMiniTool();
  if (typeof MediaRecorder === 'undefined' || typeof compositeCanvas.captureStream !== 'function') {
    showToast('当前环境不支持视频录制');
    return;
  }
  if (!miniTool || typeof miniTool.writeTempFile !== 'function' || typeof miniTool.postNote !== 'function') {
    showToast('视频导出需在小红书容器内使用');
    return;
  }

  // writeTempFile 的视频类型仅支持 mp4，因此只接受可录制 MP4 的环境
  const mp4MimeTypes = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4'
  ];
  const selectedMime = mp4MimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
  if (!selectedMime) {
    showToast('当前浏览器不支持 MP4 录制，暂无法导出视频');
    return;
  }
  if (state.exportFormat === 'webm') {
    showToast('容器导出仅支持 MP4，本次按 MP4 录制');
  }

  recordedChunks = [];

  let targetRecordCanvas = compositeCanvas;
  if (state.exportArea === 'paper') {
    const crop = getPaperPixelCropRect();
    recordCropCanvas.width = crop.sw;
    recordCropCanvas.height = crop.sh;
    recordCropCtx.clearRect(0, 0, crop.sw, crop.sh);
    recordCropCtx.drawImage(
      compositeCanvas,
      crop.sx, crop.sy, crop.sw, crop.sh,
      0, 0, crop.sw, crop.sh
    );
    targetRecordCanvas = recordCropCanvas;
  }

  const canvasStream = targetRecordCanvas.captureStream(60);
  if (audioDest && audioEnabled) {
    const audioTracks = audioDest.stream.getAudioTracks();
    if (audioTracks.length > 0) canvasStream.addTrack(audioTracks[0]);
  }

  try {
    mediaRecorder = new MediaRecorder(canvasStream, { mimeType: selectedMime, videoBitsPerSecond: 12000000 });
  } catch (err) {
    showToast('无法启动录制：' + ((err && err.message) || '未知错误'));
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    if (recordedChunks.length === 0) {
      resetRecordUI();
      return;
    }
    resetRecordUI();
    const blob = new Blob(recordedChunks, { type: 'video/mp4' });
    showToast('正在处理录制的视频…');
    blobToDataURL(blob).then(dataUrl => {
      return miniTool.writeTempFile({ data: dataUrl });
    }).then(res => {
      if (!res || !res.filePath) throw new Error('临时文件写入失败');
      return miniTool.postNote({
        title: '火焰燃烧模拟',
        content: 'Fire 火焰燃烧模拟作品',
        pageType: 'video_publish',
        mediaInfo: { video_resources: { video_url: res.filePath } }
      });
    }).then(() => {
      showToast('录制完成，已打开视频发布页');
    }).catch(err => {
      showToast('视频导出失败：' + ((err && (err.errMsg || err.message)) || '请重试'));
    });
  };

  mediaRecorder.start(100);
  btnRecord.classList.add('recording');
  recLabel.textContent = '停止并导出视频';
  showToast('开始录制：MP4 · ' + (state.exportArea === 'paper' ? '仅画布区域' : '全屏画面'));
});

setTimeout(() => {
  updateGeometryAndViewport();
}, 100);

// 页面隐藏时静音并重置帧时间基准，避免恢复后补算大帧（performance-budget §4）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (audioGain && audioCtx) audioGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.05);
  } else {
    lastFrameTime = performance.now() * 0.001;
  }
});

// WebGL 上下文丢失：停止 GL 渲染并进入 Canvas 2D 降级（renderLoop 已有 webglValid=false 兜底），不无限重建
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  state.webglValid = false;
  showToast('图形加速已中断，已切换到降级渲染');
});
