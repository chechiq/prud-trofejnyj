/* Пруд трофейный — сайт */
(function () {
  'use strict';

  var root = document.documentElement;
  var stage = document.querySelector('.stage');
  var scenes = [].slice.call(document.querySelectorAll('.scene'));
  var hero = document.getElementById('top');
  if (!stage || !scenes.length || !hero) return;
  root.classList.add('js-scenes');

  var IDS = scenes.map(function (s) { return s.id; });
  var TITLES = scenes.map(function (s) { return s.getAttribute('data-title') || ''; });
  var statusEl = document.getElementById('scene-status');
  var STATUS = (statusEl && statusEl.getAttribute('data-tpl')) || '{n}/{total}: {title}';
  var mqRM = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarseMQ = window.matchMedia('(pointer: coarse)');
  var EASE = 'cubic-bezier(.2,.7,.2,1)';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function noise(x) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  }
  function angDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function turnToward(cur, target, maxStep) { return cur + clamp(angDiff(cur, target), -maxStep, maxStep); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href="#"]');
    if (a) ev.preventDefault();
  }, true);

  /* =====================================================================
     Сцена 0: геометрия кадра, курсор-капля, рыбы
     ===================================================================== */
  var surfaceImg = hero.querySelector('img.surface');
  var dropCv = hero.querySelector('canvas.drop');
  var underImg = null;
  var W = 0, H = 0, dpr = 1, horizonY = 0, imgLeft = 0, imgTop = 0, imgScale = 1;
  var touchMode = coarseMQ.matches;
  var enabled = false, running = false, heroOn = true, raf = 0, last = 0;

  function waterTop() { return horizonY + 12; }
  function waterBot() { return H + 20; }

  function geom() {
    var w = hero.offsetWidth, h = hero.offsetHeight;
    if (!w || !h) return false;
    W = w; H = h;
    var posX = W >= 1024 ? 0.50 : 0.52;
    imgScale = Math.max(W / 1280, H / 872);
    imgLeft = (W - 1280 * imgScale) * posX;
    imgTop = (H - 872 * imgScale) * 0.40;
    horizonY = imgTop + 460 * imgScale;
    hero.style.setProperty('--hz', horizonY.toFixed(1) + 'px');
    return true;
  }

  /* ---------- параметры капли ---------- */
  var R = 120, PAD = 64, HALF = 184, CSSZ = 368, TS = 1, qualMul = 1;
  var OPT = { bevel: .55, refr: .36, mag: 1.18, pow: 1.8 };
  var inner = document.createElement('canvas'), ictx = inner.getContext('2d');
  var tmpCv = document.createElement('canvas'), tctx = tmpCv.getContext('2d');
  var gl = null, glProg = null, glU = {}, glTex = null, ctx2 = null, renderMode = 'none';

  function sizeDrop() {
    R = touchMode ? Math.min(58, .16 * W) : clamp(.065 * W, 64, 92);   // v5: капля меньше на ~23%
    PAD = Math.round(.4 * R + 16);
    HALF = Math.round(R + PAD);
    CSSZ = HALF * 2;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    TS = Math.min(2, dpr) * qualMul;
    dropCv.style.width = dropCv.style.height = CSSZ + 'px';
    dropCv.width = dropCv.height = Math.round(CSSZ * dpr);
    var iw = Math.round(CSSZ * TS);
    inner.width = iw; inner.height = renderMode === '2d' ? iw : iw * 2;
    tmpCv.width = iw; tmpCv.height = iw;
    if (gl) { gl.viewport(0, 0, dropCv.width, dropCv.height); setStaticUniforms(); }
  }

  /* ---------- WebGL ---------- */
  var VS = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D uTex; uniform vec2 uSize; uniform float uR; uniform vec3 uMove;',
    'uniform vec4 uOptic; uniform vec2 uDisp; uniform vec4 uRing; uniform vec4 uRim; uniform vec4 uSpec;',
    'uniform float uSpecA; uniform vec4 uShadow; uniform vec3 uShadowCol; uniform float uDpr;',
    'const vec2 L = vec2(-0.60, -0.80);',
    'float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h*h*k*0.25; }',
    'float sdDrop(vec2 p){',
    '  float c = length(p) - uR;',
    '  float k = uMove.x; if (k < 0.001) return c;',
    '  vec2 t = p + uMove.yz * uR * 0.62 * k;',
    '  return smin(c, length(t) - uR * (1.0 - 0.42 * k), max(0.45 * uR * clamp(k * 3.0, 0.0, 1.0), 0.01));',
    '}',
    'vec3 inner(vec2 q){ vec2 uv = clamp(q / uSize, 0.001, 0.999); return texture2D(uTex, vec2(uv.x, uv.y * 0.5)).rgb; }',
    'vec3 frame(vec2 q){ vec2 uv = clamp(q / uSize, 0.001, 0.999); return texture2D(uTex, vec2(uv.x, 0.5 + uv.y * 0.5)).rgb; }',
    'void main(){',
    '  vec2 vP = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;',
    '  vec2 c = uSize * 0.5, p = vP - c;',
    '  float sd = sdDrop(p);',
    '  float ss = sdDrop(p - vec2(0.0, uShadow.x));',
    '  float sh = uShadow.z * pow(max(1.0 - smoothstep(-uShadow.y * 0.3, uShadow.y, ss), 1e-4), 1.5);',
    '  vec4 outside = vec4(uShadowCol * sh, sh);',
    '  if (sd > 1.0 / uDpr) { gl_FragColor = outside; return; }',
    '  float d = -sd;',
    '  vec2 e = vec2(0.75, 0.0);',
    '  vec2 N = normalize(vec2(sdDrop(p + e.xy) - sdDrop(p - e.xy), sdDrop(p + e.yx) - sdDrop(p - e.yx)) + vec2(1e-5));',
    '  float B = uOptic.x * uR, S = uOptic.y * uR;',
    '  float t = clamp(d / B, 0.0, 1.0);',
    '  vec2 o = N * S * pow(max(1.0 - t, 1e-4), uOptic.w);',
    '  vec2 b = c + p / uOptic.z;',
    '  vec3 col = vec3(inner(b + o * (1.0 - uDisp.x)).r, inner(b + o).g, inner(b + o * (1.0 + uDisp.x)).b);',
    '  col = mix(col, frame(b + o * 1.4), uDisp.y * pow(max(1.0 - t, 1e-4), 3.0));',
    '  col *= uRing.z;',
    '  float t2 = clamp(d / (uRing.x * uR), 0.0, 1.0);',
    '  col *= 1.0 - uRing.y * pow(max(1.0 - t2, 1e-4), 1.6);',
    '  float f = dot(N, L);',
    '  float band = 1.0 - smoothstep(0.0, uRim.x, d);',
    '  float rim = band * (uRim.y * pow(max(f, 0.0), 2.2) + uRim.z * pow(max(-f, 0.0), 4.0));',
    '  rim += (1.0 - smoothstep(0.0, uRim.x * 4.0, d)) * uRim.w * pow(max(f, 0.0), 3.0);',
    '  vec2 hp = p - uSpec.xy * uR;',
    '  vec2 hr = vec2(hp.x * 0.816 + hp.y * 0.578, -hp.x * 0.578 + hp.y * 0.816) / (uSpec.zw * uR);',
    '  float sp = uSpecA * (1.0 - smoothstep(0.55, 1.0, length(hr)));',
    '  col += (1.0 - col) * min(1.0, rim + sp);',
    '  float aa = clamp(0.5 - sd * uDpr, 0.0, 1.0);',
    '  gl_FragColor = mix(outside, vec4(col, 1.0), aa);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function initGL() {
    try {
      gl = dropCv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
      if (!gl) return false;
      glProg = gl.createProgram();
      gl.attachShader(glProg, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(glProg, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(glProg);
      if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg));
      gl.useProgram(glProg);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(glProg, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uTex', 'uSize', 'uR', 'uMove', 'uOptic', 'uDisp', 'uRing', 'uRim', 'uSpec', 'uSpecA', 'uShadow', 'uShadowCol', 'uDpr']
        .forEach(function (n) { glU[n] = gl.getUniformLocation(glProg, n); });
      glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.disable(gl.BLEND);
      dropCv.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); useFallback(); }, false);
      return true;
    } catch (err) {
      gl = null;
      return false;
    }
  }
  function setStaticUniforms() {
    if (!gl) return;
    gl.useProgram(glProg);
    gl.uniform1i(glU.uTex, 0);
    gl.uniform2f(glU.uSize, CSSZ, CSSZ);
    gl.uniform4f(glU.uOptic, OPT.bevel, OPT.refr, OPT.mag, OPT.pow);
    gl.uniform2f(glU.uDisp, .06, .45);
    gl.uniform4f(glU.uRing, .30, .42, 1.22, 0);
    gl.uniform4f(glU.uRim, touchMode ? 2.0 : 2.4, 1.0, .50, .30);
    gl.uniform4f(glU.uSpec, -.42, -.50, .085, .035);
    gl.uniform1f(glU.uSpecA, .90);
    if (touchMode) gl.uniform4f(glU.uShadow, 8, 18, .30, 0); else gl.uniform4f(glU.uShadow, 10, 26, .30, 0);
    gl.uniform3f(glU.uShadowCol, 3 / 255, 8 / 255, 20 / 255);
    gl.uniform1f(glU.uDpr, dropCv.width / CSSZ);
  }
  function useFallback() {
    if (renderMode === '2d') return;
    // контекст WebGL занят canvas: нужен новый элемент для 2D
    var nc = document.createElement('canvas');
    nc.className = dropCv.className; nc.setAttribute('aria-hidden', 'true');
    dropCv.parentNode.replaceChild(nc, dropCv);
    dropCv = nc; gl = null; renderMode = '2d';
    ctx2 = dropCv.getContext('2d');
    if (enabled) sizeDrop();
  }

  /* ---------- состояние капли ---------- */
  var D = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 0, kv: 0, dx: 1, dy: 0, ap: 0, av: 0, alpha: 0, visible: false, ox: 0, oy: 0, still: 0 };
  var mode = 'off';              // off | patrol | follow | hold
  var ptr = { x: 0, y: 0, in: false, down: false, type: 'mouse' };
  var startAt = 0, idleSince = 0, patrolStart = 0, patrolUntil = 0, holdUntil = 0, firstPatrolDone = false;

  function spring(o, key, vkey, target, k, z, dt) {
    var a = -k * (o[key] - target) - 2 * z * Math.sqrt(k) * o[vkey];
    o[vkey] += a * dt; o[key] += o[vkey] * dt;
  }
  function smin(a, b, k) { var h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function sdDropJS(px, py) {
    var x = px - D.x, y = py - D.y, r = R * D.ap;
    var c = Math.hypot(x, y) - r;
    if (D.k < 0.001) return c;
    var tx = x + D.dx * r * 0.62 * D.k, ty = y + D.dy * r * 0.62 * D.k;
    return smin(c, Math.hypot(tx, ty) - r * (1 - 0.42 * D.k), Math.max(0.45 * r * clamp(D.k * 3, 0, 1), 0.01));
  }
  function clampTarget(x, y) {
    var m = R * 0.4 + 8;
    return { x: clamp(x, m, W - m), y: clamp(y, m, H - m) };
  }
  function showDrop(x, y) {
    var t = clampTarget(x, y);
    D.tx = t.x; D.ty = t.y;
    if (!D.visible) {
      D.visible = true;
      if (D.alpha <= 0.001) { D.x = t.x; D.y = t.y; D.vx = D.vy = 0; D.k = D.kv = 0; D.ap = 0; D.av = 0; }
    }
  }
  function hideDrop() { D.visible = false; }
  function setTarget(x, y) { var t = clampTarget(x, y); D.tx = t.x; D.ty = t.y; }

  function patrolPoint(t) {
    var tt = Math.PI * 2;
    return {
      x: W * (0.5 + 0.30 * Math.sin(tt * t / 14)),
      y: horizonY + (H - horizonY) * (0.5 + 0.26 * Math.sin(tt * t / 9 + 1.1))
    };
  }

  function updateDrop(now, dt) {
    if (!heroOn) { D.visible = false; mode = 'off'; return; }
    /* поведение */
    if (mode === 'off') {
      if (!touchMode) {
        if (!firstPatrolDone && now >= startAt) {
          firstPatrolDone = true; mode = 'patrol'; patrolStart = now; patrolUntil = now + 2400;
          var p0 = patrolPoint(0); showDrop(p0.x, p0.y);
        } else if (firstPatrolDone && !ptr.in && !D.visible && now - idleSince > 8000) {
          mode = 'patrol'; patrolStart = now; patrolUntil = now + 2400;
          var p1 = patrolPoint(0); showDrop(p1.x, p1.y);
        }
      }
    } else if (mode === 'patrol') {
      var pp = patrolPoint((now - patrolStart) / 1000);
      setTarget(pp.x, pp.y);
      var hr = hero.getBoundingClientRect();
      D.visible = !overText(hr.left + pp.x, hr.top + pp.y);   // v5: не над текстом и кнопками
      if (now > patrolUntil) { mode = 'off'; idleSince = now; hideDrop(); }
    } else if (mode === 'hold') {
      if (now > holdUntil) { mode = 'off'; idleSince = now; hideDrop(); }
    }

    /* пружины */
    var kP = touchMode ? 220 : 170, zP = touchMode ? .95 : .92;
    if (D.visible || D.alpha > 0) {
      spring(D, 'x', 'vx', D.tx, kP, zP, dt);
      spring(D, 'y', 'vy', D.ty, kP, zP, dt);
    }
    var sp = Math.hypot(D.vx, D.vy);
    /* хвост: гладкое приближение без пружины (без отскока), при остановке плавно исчезает; радиус не трогаем */
    var kt = clamp((sp - 90) / 900, 0, 1);
    D.k += (kt - D.k) * (1 - Math.exp(-dt * (kt > D.k ? 14 : 5)));
    if (D.k < 0.002) D.k = 0;
    D.kv = 0;
    if (sp > 40) { D.dx = D.vx / sp; D.dy = D.vy / sp; }
    D.still = sp < 30 ? D.still + dt : 0;

    if (D.visible) {
      spring(D, 'ap', 'av', 1, 300, 1, dt);
      D.alpha = Math.min(1, D.alpha + dt / .16);
    } else {
      D.ap += (.6 - D.ap) * (1 - Math.exp(-dt * 10)); D.av = 0;
      D.alpha = Math.max(0, D.alpha - dt / (touchMode ? .26 : .22));
      if (D.alpha <= 0) { D.ap = 0; D.av = 0; }
    }
  }

  /* ---------- рыбы ---------- */
  var FISH = { 1:[196,16],2:[155,20],3:[168,18],4:[78,30],5:[62,30],6:[180,22],7:[91,20],8:[176,12],9:[128,18],10:[137,16],11:[200,13],12:[165,15],13:[300,8],14:[172,19],15:[148,21],16:[62,18],17:[54,20],18:[66,16],19:[58,34],20:[50,38],21:[64,32],22:[280,9] };
  var KIND = { 1:'carp',2:'carp',3:'carp',4:'carp',5:'carp',6:'carp',7:'carp',8:'carp',9:'carp',10:'carp',22:'carp',11:'pike',12:'pike',13:'pike',14:'sazan',15:'sazan',16:'crucian',17:'crucian',18:'crucian',19:'roach',20:'roach',21:'roach' };
  /* KP: параметры вида. tf/tc: скорость поворота (испуг/спокойно), cr: множитель спокойной скорости, wg: вилянье курса,
     dm: пик рывка (в единицах спокойной скорости), ut: скорость U-turn, ff/fc: частота хвоста, modes: веса режимов */
  var KP = {
    carp:  { dMin: .08, dMax: .16, fm: 1,    cap: 260, tf: 7,   tc: 1.6, wn: 1,   pause: .6, ret: 1.5, calm: 2.5, fc: 1.6, ff: 6,   cr: 1.2,  wg: .30, dm: 6, ut: 2.4, modes: { cruise: 3, glide: 3, uturn: 2, dash: .5 } },
    sazan: { dMin: .07, dMax: .14, fm: 1.1,  cap: 270, tf: 7,   tc: 1.6, wn: 1,   pause: .6, ret: 1.5, calm: 2.5, fc: 1.6, ff: 6,   cr: 1.2,  wg: .28, dm: 6, ut: 2.4, modes: { cruise: 3, glide: 3.5, uturn: 1.5, dash: .6 } },
    pike:  { dMin: .04, dMax: .08, fm: 1.35, cap: 340, tf: 10,  tc: 1.2, wn: .5,  pause: .4, ret: 2.0, calm: 1.5, fc: 1.0, ff: 7.5, cr: 1.1,  wg: .12, dm: 15, ut: 3, modes: { ambush: 4, dash: 2, cruise: 1.4, uturn: 1, glide: .8 } },
    amur:  { dMin: .14, dMax: .24, fm: .8,   cap: 210, tf: 4.5, tc: 1.0, wn: .7,  pause: .9, ret: 1.2, calm: 3.5, fc: 1.6, ff: 4.5, cr: 1.1,  wg: .2,  dm: 4, ut: 2, modes: { cruise: 3, glide: 3 } },
    crucian: { dMin: .10, dMax: .20, fm: .9, cap: 220, tf: 5.5, tc: 1.4, wn: .9, pause: .8, ret: 1.3, calm: 3.0, fc: 1.4, ff: 5,   cr: 1.15, wg: .35, dm: 5, ut: 2.2, modes: { glide: 3, cruise: 3, uturn: 1.5, zigzag: 1.2 } },
    roach: { dMin: .03, dMax: .07, fm: 1.4, cap: 360, tf: 11, tc: 2.4, wn: 1.4, pause: .3, ret: 2.2, calm: 1.2, fc: 2.2, ff: 8.5, cr: 1.3,  wg: .30, dm: 6, ut: 2.6, modes: { school: 4, zigzag: 2, dash: 1.4, cruise: 1 } }
  };
  var SETS = {
    desk: [1,2,6,7,9,10,22,11,12,13,14,15,16,17,18,19,20,21],
    tab: [1,6,9,22,11,13,14,15,16,17,18,19,20,21],
    phone: [1,6,22,11,13,14,16,17,19,20]
  };
  var WATER_TINT = ['rgba(24,56,76,.12)', 'rgba(24,56,76,.28)', 'rgba(24,56,76,.45)'];
  var sprites = {}, fishList = [], fishSetKey = '', spritesRequested = false, underLoaded = false;

  function tinted(img, w, h, fill, blurDiv) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    if (fill) {
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = fill; x.fillRect(0, 0, w, h);
    }
    if (blurDiv > 1) {
      var sw = Math.max(2, Math.round(w / blurDiv)), sh = Math.max(2, Math.round(h / blurDiv));
      var s = document.createElement('canvas');
      s.width = sw; s.height = sh;
      var sx = s.getContext('2d');
      sx.imageSmoothingQuality = 'high';
      sx.drawImage(c, 0, 0, sw, sh);
      var c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      var x2 = c2.getContext('2d');
      x2.imageSmoothingEnabled = true; x2.imageSmoothingQuality = 'high';
      x2.drawImage(s, 0, 0, w, h);
      return c2;
    }
    return c;
  }
  function loadSprite(id) {
    if (sprites[id] !== undefined) return;
    sprites[id] = null;
    var img = new Image();
    img.onload = function () {
      var len = FISH[id][0];
      var d = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.max(8, Math.round(len * d));
      var nw = img.naturalWidth || 180, nh = img.naturalHeight || 100;
      var h = Math.max(4, Math.round(w * nh / nw));
      sprites[id] = {
        v: [tinted(img, w, h, WATER_TINT[0], 1), tinted(img, w, h, WATER_TINT[1], 2), tinted(img, w, h, WATER_TINT[2], 3)],
        shadow: tinted(img, w, h, 'rgb(2,10,18)', 3),
        aspect: nh / nw, len: len
      };
    };
    img.src = 'img/fish/fish-' + pad2(id) + '.svg';
  }

  var school = { gx: 0, gy: 0, t: 0, burst: 0 };
  function pickGoal(f, top, bot, away) {
    var mx = Math.max(60, W * .06), lo = top + 24, hi = bot - 30;
    if (f.k === KP.roach || f.k === KP.crucian) { if (W < 600) hi = Math.min(hi, top + (bot - top) * .5); }
    if (hi < lo + 10) hi = lo + 10;
    if (f.tier === undefined || Math.random() < .45) f.tier = Math.random();
    var gx = f.x, gy = f.y;
    for (var n = 0; n < 6; n++) {
      gx = mx + Math.random() * Math.max(10, W - 2 * mx);
      gy = lo + f.tier * (hi - lo) + (Math.random() - .5) * 40;
      if (Math.hypot(gx - f.x, gy - f.y) > (away || Math.min(300, W * .25))) break;
    }
    return { x: gx, y: clamp(gy, lo, hi) };
  }

  /* ---------- поведенческие режимы ---------- */
  var MODE_DUR = { cruise: [4, 9], glide: [2.5, 6], zigzag: [3, 6], ambush: [3, 8], school: [7, 13], dash: [1.0, 1.5], uturn: [9, 9] };
  var fishActive = 0;
  function isActive(m) { return m === 'dash' || m === 'uturn'; }
  function rr(a, b) { return a + Math.random() * (b - a); }

  function nextMode(f) {
    if (f.force) { var fm = f.force; f.force = null; return fm; }
    var w = f.k.modes, lim = fishActive >= Math.max(1, Math.round(fishList.length * .25)), tot = 0, c = [], key;
    for (key in w) {
      if (key === f.mode && key !== 'cruise' && key !== 'school') continue;
      if (lim && isActive(key)) continue;
      c.push(key); tot += w[key];
    }
    if (!c.length) return 'cruise';
    var r = Math.random() * tot;
    for (var i = 0; i < c.length; i++) { r -= w[c[i]]; if (r <= 0) return c[i]; }
    return c[c.length - 1];
  }
  /* курс, при котором прямой путь длиной len остаётся в воде */
  function safeHeading(f, len, base, spread) {
    var mx = Math.max(50, W * .05), lo = waterTop() + 36, hi = waterBot() - 40;
    for (var n = 0; n < 12; n++) {
      var h = base + (Math.random() - .5) * spread;
      var ex = f.x + Math.cos(h) * len, ey = f.y + Math.sin(h) * len;
      if (ex > mx && ex < W - mx && ey > lo && ey < hi) return h;
    }
    return Math.atan2((lo + hi) / 2 - f.y, W / 2 - f.x) + (Math.random() - .5) * .5;
  }
  function setMode(f, m, vMul) {
    if (isActive(f.mode)) fishActive--;
    var k = f.k, u = f.v0 * f.s * vMul, d = MODE_DUR[m] || [4, 8];
    f.mode = m; f.mt = f.mt0 = rr(d[0], d[1]); f.ph = 0;
    if (isActive(m)) fishActive++;
    if (m === 'dash') {
      f.dk = f.dmk || k.dm; f.dmk = 0;
      f.dh = safeHeading(f, u * f.dk * .9, f.heading, Math.random() < .25 ? 6.28 : 2.6);
    } else if (m === 'uturn') {
      f.pt = rr(1.8, 3.4);
      f.dh = safeHeading(f, u * k.ut * f.pt * 1.1 + 100, f.heading, 1.4);
      var perp = f.dh + Math.PI / 2, px = f.x + Math.cos(perp) * 70, py = f.y + Math.sin(perp) * 70;
      var ok = px > 50 && px < W - 50 && py > waterTop() + 40 && py < waterBot() - 40;
      f.tdir = ok ? 1 : -1;
      f.tamt = rr(2.6, 3.5);
    } else if (m === 'glide') {
      f.hTarget = f.heading + (Math.random() - .5) * 1.4; f.g2 = false;
    } else if (m === 'zigzag') {
      f.zb = f.heading; f.zs = Math.random() < .5 ? -1 : 1; f.zt = rr(.3, .7);
      if (!f.home || Math.hypot(f.home.x - f.x, f.home.y - f.y) < 80) f.home = pickGoal(f, waterTop(), waterBot());
    } else if (m === 'ambush') {
      f.hTarget = f.heading + (Math.random() - .5) * .8; f.dmk = k.dm * 1.3; f.force = 'dash';
    } else if (m === 'cruise') {
      if (!f.home || Math.hypot(f.home.x - f.x, f.home.y - f.y) < 90) f.home = pickGoal(f, waterTop(), waterBot());
    }
  }

  function makeFish() {
    var key = W >= 1024 ? 'desk' : W >= 600 ? 'tab' : 'phone';
    if (key === fishSetKey) return;
    fishSetKey = key;
    var ids = SETS[key];
    if (spritesRequested) ids.forEach(loadSprite);
    var top = waterTop(), bot = H - 10;
    var order = ids.slice().sort(function () { return Math.random() - .5; });
    var schoolX = (.15 + Math.random() * .6) * W, schoolY = top + 30 + Math.random() * Math.max(10, (bot - top) * .4);
    fishActive = 0;
    fishList = ids.map(function (id) {
      var slot = order.indexOf(id);
      var hx = (slot + 0.15 + Math.random() * 0.7) / ids.length * W;
      var hy = top + 20 + Math.random() * Math.max(10, bot - top - 20);
      var kp = KP[KIND[id]];
      var kind = KIND[id];
      if (kind === 'roach') { hx = schoolX + (id - 19) * 0.035 * W + Math.random() * 0.02 * W; hy = schoolY + (Math.random() - .5) * 50; }
      if (kind === 'roach' || kind === 'crucian') { hy = Math.min(hy, W < 600 ? top + (bot - top) * .5 : bot); }
      return {
        k: kp, id: id, v0: FISH[id][1], seed: Math.random() * 100,
        home: { x: hx, y: hy }, x: hx, y: hy,
        heading: Math.random() * Math.PI * 2, ang: 0, hTarget: 0, hRate: 1,
        kx: 0, ky: 0, boost: 1, inT: 0, outT: 99, delay: kp.dMin + Math.random() * (kp.dMax - kp.dMin),
        returning: false, fleeing: false, phase: Math.random() * 6.28, speed: 0, hov: 0, hovT: 0, s: 1, depth: 0,
        mode: 'cruise', mt: 0, mt0: 1, ph: 0, sp: 0, wig: .05, sq: 1, sgx: 0, sgy: 0, lag: Math.random() * .5
      };
    });
    fishList.forEach(function (f) {
      f.ang = f.heading; f.flip = Math.cos(f.heading) < 0; f.tier = undefined;
      f.off = { x: (f.id - 19) * 45 + (Math.random() - .5) * 20, y: (Math.random() - .5) * 50 };
      if (KIND[f.id] !== 'roach') f.home = pickGoal(f, top, bot, 0);
      f.sgx = schoolX; f.sgy = schoolY;
      f.sp = f.v0 * 0.7;
      f.s = lerp(0.45, 1.0, clamp((f.y - top) / Math.max(1, H - top), 0, 1)) * (W < 600 ? 0.6 : 1);
      f.mode = 'cruise';
      setMode(f, nextMode(f), touchMode ? .8 : 1);
      f.mt = rr(.5, f.mt0);   // не все в одном режиме и в одной фазе
    });
    school.gx = schoolX; school.gy = schoolY; school.t = 6 + Math.random() * 6;
  }

  function updateFish(now, dt) {
    var t = now / 1000;
    var top = waterTop(), bot = waterBot();
    var F = touchMode ? 600 : 780;
    var vMul = touchMode ? 0.8 : 1;
    var fr = Math.pow(0.95, dt * 60);
    var Req = R * D.ap * (1 + .3 * D.k);
    var zoneOn = D.alpha > .3 && Req > 8;
    var sp = Math.hypot(D.vx, D.vy);
    var fear = D.still > 1.2 ? .25 : clamp(sp / 300, .25, 1);
    school.t -= dt;
    if (school.burst > 0) school.burst -= dt;
    if (school.t <= 0) {
      var sf = null;
      for (var q = 0; q < fishList.length; q++) if (KIND[fishList[q].id] === 'roach') { sf = fishList[q]; break; }
      if (sf) { var g = pickGoal(sf, top, bot, Math.min(350, W * .3)); school.gx = g.x; school.gy = g.y; }
      school.t = 9 + Math.random() * 9;
      if (Math.random() < .5) school.burst = rr(.9, 1.6);
    }
    fishActive = 0;
    for (var q2 = 0; q2 < fishList.length; q2++) if (isActive(fishList[q2].mode)) fishActive++;

    for (var i = 0; i < fishList.length; i++) {
      var f = fishList[i], k = f.k;
      var depth = clamp((f.y - top) / Math.max(1, H - top), 0, 1);
      var s = lerp(0.45, 1.0, depth) * (W < 600 ? 0.6 : 1);
      f.s = s;
      var u = f.v0 * s * vMul;

      var dx = f.x - D.x, dy = f.y - D.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var inZone = zoneOn && d < 1.1 * Req;
      var wasFleeing = f.fleeing;

      if (inZone) {
        f.outT = 0; f.inT += dt;
        if (f.inT >= f.delay) {
          var w = 1 - d / (1.1 * Req); w = w * w;
          var nx, ny;
          if (d > 0.001) { nx = dx / d; ny = dy / d; } else { nx = Math.cos(f.heading); ny = Math.sin(f.heading); }
          f.kx += nx * F * fear * k.fm * w * dt;
          f.ky += ny * F * fear * k.fm * w * dt;
          f.boost = k.ret; f.returning = false; f.fleeing = true;
        }
      } else { f.inT = 0; f.outT += dt; }

      f.kx *= fr; f.ky *= fr;
      var km = Math.sqrt(f.kx * f.kx + f.ky * f.ky);
      if (km > k.cap) { f.kx *= k.cap / km; f.ky *= k.cap / km; km = k.cap; }
      if (km <= 30) f.fleeing = false;
      if (!inZone && f.boost > 1) f.boost = Math.max(1, f.boost - dt * (k.ret - 1) / k.calm);

      var spT = 1, acc = 2, rate = k.tc;
      if (f.fleeing) {
        f.heading = turnToward(f.heading, Math.atan2(f.ky, f.kx), k.tf * dt);
        rate = k.tf; acc = 10; f.sq = 1;
      } else {
        if (wasFleeing) { setMode(f, 'cruise', vMul); f.mt = rr(1.5, 3); }
        f.mt -= dt;
        var m = f.mode;
        if (m === 'cruise') {
          if (Math.hypot(f.home.x - f.x, f.home.y - f.y) < 70) f.home = pickGoal(f, top, bot);
          f.hTarget = Math.atan2(f.home.y - f.y, f.home.x - f.x) + Math.sin(t * .9 + f.seed) * k.wg + Math.sin(t * .37 + f.seed * 2) * k.wg * .6;
          spT = k.cr; acc = 1.6; rate = k.tc;
        } else if (m === 'dash') {
          f.hTarget = f.dh; rate = k.tf * .8;
          if (f.mt0 - f.mt < f.mt0 * .3) { spT = f.dk; acc = 9; } else { spT = .35; acc = 1.7; }   // рывок, затем трение
        } else if (m === 'uturn') {
          if (f.ph === 0) {
            f.hTarget = f.dh; spT = k.ut; acc = 2; rate = k.tc * 1.2; f.pt -= dt;
            if (f.pt <= 0) { f.ph = 1; f.tleft = f.tamt; }
          } else if (f.ph === 1) {
            var tr = 2.3, stp = Math.min(f.tleft, tr * dt);
            f.heading += f.tdir * stp; f.tleft -= stp; f.hTarget = f.heading;
            var pr = 1 - f.tleft / f.tamt;
            spT = pr < .5 ? .3 : .9; acc = 3; rate = tr;
            f.sq = 1 - .3 * Math.sin(Math.PI * pr);
            if (f.tleft <= 0) { f.ph = 2; f.pt = rr(1.6, 3); f.dh = f.heading; f.sq = 1; }
          } else {
            f.hTarget = f.dh; spT = k.ut; acc = 2.5; rate = k.tc; f.pt -= dt;
            if (f.pt <= 0) f.mt = 0;
          }
        } else if (m === 'glide') {
          spT = .1; acc = 1.4; rate = .5;
          if (f.mt < f.mt0 * .5 && !f.g2) { f.g2 = true; f.hTarget = f.heading + (Math.random() - .5) * 1.0; }
        } else if (m === 'zigzag') {
          f.zt -= dt;
          if (f.zt <= 0) { f.zs = -f.zs; f.zt = rr(.3, .7); }
          f.zb = turnToward(f.zb, Math.atan2(f.home.y - f.y, f.home.x - f.x), .9 * dt);
          if (Math.hypot(f.home.x - f.x, f.home.y - f.y) < 80) f.home = pickGoal(f, top, bot);
          f.hTarget = f.zb + f.zs * .75; spT = 1.2; acc = 3; rate = k.tf * .55;
        } else if (m === 'ambush') {
          spT = .02; acc = 2.5; rate = .7;
        } else if (m === 'school') {
          var mxs = Math.max(60, W * .06), kk = 1 - Math.exp(-dt / (.2 + f.lag));
          f.sgx += (school.gx - f.sgx) * kk; f.sgy += (school.gy - f.sgy) * kk;   // каждая видит курс стаи с запаздыванием
          f.home.x = clamp(f.sgx + f.off.x, mxs, W - mxs); f.home.y = clamp(f.sgy + f.off.y, top + 20, bot - 30);
          var hd = Math.hypot(f.home.x - f.x, f.home.y - f.y);
          f.hTarget = Math.atan2(f.home.y - f.y, f.home.x - f.x) + Math.sin(t * 1.3 + f.seed) * .22;
          spT = (hd > 160 ? 1.7 : hd > 60 ? 1.25 : .7) * (school.burst > 0 ? 1.7 : 1); acc = 2.5; rate = k.tc;
        }
        /* мягкие границы: у краёв курс заворачивает внутрь */
        var em = Math.max(80, W * .07), emy = 60, rx = 0, ry = 0;
        if (f.x < em) rx = 1 - f.x / em; else if (f.x > W - em) rx = -(1 - (W - f.x) / em);
        if (f.y < top + emy) ry = 1 - (f.y - top) / emy; else if (f.y > bot - emy) ry = -(1 - (bot - f.y) / emy);
        var rs = Math.min(1, Math.hypot(rx, ry));
        if (rs > 0 && !(m === 'uturn' && f.ph === 1)) {
          var inw = Math.atan2(ry, rx);
          f.hTarget = f.hTarget + angDiff(f.hTarget, inw) * Math.min(1, rs * 1.6);
          rate = Math.max(rate, k.tc * (1 + rs * 1.5));
          if (m === 'uturn' || m === 'dash') f.dh = f.hTarget;
        }
        if (!(m === 'uturn' && f.ph === 1)) f.heading = turnToward(f.heading, f.hTarget, rate * dt);
        if (f.mt <= 0) setMode(f, nextMode(f), vMul);
        if (f.mode !== 'uturn') f.sq += (1 - f.sq) * Math.min(1, dt * 6);
      }
      f.hRate = rate;

      f.sp += (spT * u * f.boost - f.sp) * (1 - Math.exp(-acc * dt));
      var vx = Math.cos(f.heading) * f.sp + f.kx;
      var vy = Math.sin(f.heading) * f.sp + f.ky;
      if (f.mode === 'glide' && !f.fleeing) vy += Math.sin(t * 1.3 + f.seed) * 4;
      f.x += vx * dt; f.y += vy * dt;
      f.x = clamp(f.x, -30, W + 30);
      f.y = clamp(f.y, top - 10, bot);

      var spd = Math.sqrt(vx * vx + vy * vy);
      f.speed = spd;
      f.ang = turnToward(f.ang, spd > 2 ? Math.atan2(vy, vx) : f.heading, (f.fleeing ? k.tf : Math.max(k.tc, rate) * 1.3) * dt);
      var ca = Math.cos(f.ang);
      if (ca < -.15) f.flip = true; else if (ca > .15) f.flip = false;

      var sn = clamp(spd / (u * 2.6), 0, 1);
      var freq = lerp(k.fc * .5, k.ff, Math.sqrt(sn));   // частота хвоста растёт со скоростью
      f.phase += Math.PI * 2 * freq * dt;
      f.wig = .025 + .06 * sn;
      f.depth = depth;
      f.hov = clamp(f.hov + (f.hovT - f.hov) * Math.min(1, dt / 0.15), 0, 1);
    }
  }

  /* попадание в рыбу внутри капли: точка курсора переводится в координаты подводного слоя */
  function hitFish(px, py, touch) {
    if (D.alpha < .6 || D.ap < .8) return null;
    var sd = sdDropJS(px, py);
    if (sd >= 0 || -sd < .25 * R) return null;
    var sx = D.x + (px - D.x) / OPT.mag, sy = D.y + (py - D.y) / OPT.mag;
    var best = null, bd = 1e9;
    for (var i = 0; i < fishList.length; i++) {
      var f = fishList[i], sp = sprites[f.id];
      if (!sp) continue;
      var dx = sx - f.x, dy = sy - f.y, d = Math.hypot(dx, dy);
      var ok = d < (touch ? 48 : 40);
      if (!ok) {
        var c = Math.cos(-f.ang), s = Math.sin(-f.ang);
        var lx = dx * c - dy * s, ly = dx * s + dy * c;
        var pd = touch ? 24 : 16;
        var hw = sp.len * f.s / 2 + pd, hh = Math.max(12, sp.len * f.s * sp.aspect / 2) + pd;
        ok = Math.abs(lx) <= hw && Math.abs(ly) <= hh;
      }
      if (ok && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /* ---------- взвесь ---------- */
  var silt = [];
  function makeSilt() {
    var n = touchMode || W < 1024 ? 24 : 40;
    var top = waterTop(), h = Math.max(1, H - top);
    silt = [];
    for (var i = 0; i < n; i++) {
      var y = top + Math.random() * h;
      silt.push({
        x: Math.random() * W, y: y, y0: y,
        z: clamp((y - top) / h + (Math.random() - .5) * .3, 0, 1),
        vx: 2 + Math.random() * 3, seed: Math.random() * 100
      });
    }
  }
  function updateSilt(now, dt) {
    var t = now / 1000;
    for (var i = 0; i < silt.length; i++) {
      var p = silt[i];
      p.x += (p.vx * (0.7 + noise(t * 0.2 + p.seed))) * dt;
      p.y = p.y0 + Math.sin(t * 0.6 + p.seed) * 4;
      if (p.x > W + 5) p.x = -5;
    }
  }
  function drawSilt(from, to) {
    ictx.fillStyle = 'rgb(176,222,236)';
    for (var i = 0; i < silt.length; i++) {
      var p = silt[i];
      if (p.z < from || p.z >= to) continue;
      var x = p.x - D.ox, y = p.y - D.oy;
      if (x < 0 || y < 0 || x > CSSZ || y > CSSZ) continue;
      ictx.globalAlpha = .10 + .25 * p.z;
      ictx.beginPath(); ictx.arc(x, y, .5 + 1.5 * p.z, 0, 6.2832); ictx.fill();
    }
    ictx.globalAlpha = 1;
  }

  /* ---------- рисование внутреннего слоя ---------- */
  function ready(img) { return img && img.complete && img.naturalWidth > 0; }

  function drawFrameTo(c) {
    c.drawImage(surfaceImg, imgLeft - D.ox, imgTop - D.oy, 1280 * imgScale, 872 * imgScale);
  }
  function drawInner(now) {
    var hasPond = ready(surfaceImg);
    /* верхняя половина: подводный слой с рыбами */
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.save();
    ictx.beginPath(); ictx.rect(0, 0, inner.width, inner.width); ictx.clip();
    ictx.setTransform(TS, 0, 0, TS, 0, 0);
    ictx.fillStyle = '#0a1426'; ictx.fillRect(0, 0, CSSZ, CSSZ);
    if (hasPond) drawFrameTo(ictx);
    var hzL = horizonY - D.oy;
    if (ready(underImg) && hzL < CSSZ + 20) {
      var uw = 1280 * imgScale, uh = 872 * imgScale;
      if (hzL + 26 < 0) {
        ictx.drawImage(underImg, imgLeft - D.ox, imgTop - D.oy, uw, uh);
      } else {
        tctx.setTransform(TS, 0, 0, TS, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
        tctx.clearRect(0, 0, CSSZ, CSSZ);
        tctx.drawImage(underImg, imgLeft - D.ox, imgTop - D.oy, uw, uh);
        tctx.globalCompositeOperation = 'destination-in';
        var g = tctx.createLinearGradient(0, hzL + 10, 0, hzL + 24);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        tctx.fillStyle = g; tctx.fillRect(0, 0, CSSZ, CSSZ);
        tctx.globalCompositeOperation = 'source-over';
        ictx.drawImage(tmpCv, 0, 0, CSSZ, CSSZ);
      }
    }
    if (fishList.length) {
      drawSilt(0, .5);
      var arr = fishList.slice().sort(function (a, b) { return a.y - b.y; });
      ictx.imageSmoothingQuality = 'high';
      var i, f, sp, w, h, x, y;
      // тени на дне
      for (i = 0; i < arr.length; i++) {
        f = arr[i]; sp = sprites[f.id];
        if (!sp) continue;
        x = f.x - D.ox; y = f.y - D.oy;
        if (x < -120 || y < -120 || x > CSSZ + 120 || y > CSSZ + 120) continue;
        w = sp.len * f.s; h = w * sp.aspect;
        ictx.save();
        ictx.translate(x + 10 * f.depth, y + 18 * f.depth);
        ictx.rotate(f.ang + f.wig * Math.sin(f.phase));
        if (f.flip) ictx.scale(1, -1); /* влево: отражаем, чтобы спина оставалась сверху */
        ictx.globalAlpha = .30;
        ictx.drawImage(sp.shadow, -w / 2, -h / 2, w, h);
        ictx.restore();
      }
      for (i = 0; i < arr.length; i++) {
        f = arr[i]; sp = sprites[f.id];
        if (!sp) continue;
        x = f.x - D.ox; y = f.y - D.oy;
        if (x < -120 || y < -120 || x > CSSZ + 120 || y > CSSZ + 120) continue;
        w = sp.len * f.s; h = w * sp.aspect;
        var a = clamp(.95 + f.hov * .15, 0, 1);
        ictx.save();
        ictx.translate(x, y);
        ictx.rotate(f.ang + f.wig * Math.sin(f.phase));
        if (f.flip) ictx.scale(1, -1);
        ictx.scale(f.sq, 1);
        var t, vA, vB;
        if (f.depth < .5) { t = f.depth / .5; vA = sp.v[2]; vB = sp.v[1]; }
        else { t = (f.depth - .5) / .5; vA = sp.v[1]; vB = sp.v[0]; }
        ictx.globalAlpha = a * (1 - t);
        ictx.drawImage(vA, -w / 2, -h / 2, w, h);
        ictx.globalAlpha = a * t;
        ictx.drawImage(vB, -w / 2, -h / 2, w, h);
        ictx.restore();
      }
      drawSilt(.5, 1.01);
    }
    ictx.restore();
    /* нижняя половина: кадр сайта (для отражения у кромки) */
    if (renderMode === 'gl' && hasPond) {
      ictx.save();
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.beginPath(); ictx.rect(0, inner.width, inner.width, inner.width); ictx.clip();
      ictx.setTransform(TS, 0, 0, TS, 0, CSSZ * TS);
      drawFrameTo(ictx);
      ictx.restore();
    }
  }

  /* ---------- вывод капли ---------- */
  function renderGL() {
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inner);
    gl.uniform1f(glU.uR, R * D.ap);
    gl.uniform3f(glU.uMove, clamp(D.k, 0, 1.2), D.dx, D.dy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function render2D() {
    var c = ctx2, r = R * D.ap, cx = HALF, cy = HALF, k = clamp(D.k, 0, 1);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, CSSZ, CSSZ);
    if (r < 1) return;
    function path() {
      c.beginPath(); c.arc(cx, cy, r, 0, 6.2832);
      if (k > .05) {
        var r2 = r * (1 - .42 * k), tx = cx - D.dx * .62 * r * k, ty = cy - D.dy * .62 * r * k;
        c.moveTo(tx + r2, ty); c.arc(tx, ty, r2, 0, 6.2832);
      }
    }
    c.save();
    c.shadowColor = 'rgba(3,8,20,.30)'; c.shadowBlur = 26 * dpr; c.shadowOffsetY = 10 * dpr;
    c.fillStyle = '#000'; path(); c.fill();
    c.restore();
    c.save();
    path(); c.clip();
    var m = OPT.mag, sz = CSSZ * m;
    c.drawImage(inner, 0, 0, inner.width, inner.height, cx - sz / 2, cy - sz / 2, sz, sz);
    var rg = c.createRadialGradient(cx, cy, r * .70, cx, cy, r);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = rg; c.fillRect(0, 0, CSSZ, CSSZ);
    c.restore();
    var lg = c.createLinearGradient(cx - .6 * r, cy - .8 * r, cx + .6 * r, cy + .8 * r);
    lg.addColorStop(0, 'rgba(255,255,255,.95)'); lg.addColorStop(.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(255,255,255,.35)');
    c.strokeStyle = lg; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r - 1, 0, 6.2832); c.stroke();
    c.save();
    c.translate(cx - .42 * r, cy - .5 * r); c.rotate(-35 * Math.PI / 180);
    var sg = c.createRadialGradient(0, 0, 0, 0, 0, .085 * r);
    sg.addColorStop(0, 'rgba(255,255,255,.9)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.scale(1, .035 / .085); c.fillStyle = sg; c.beginPath(); c.arc(0, 0, .085 * r, 0, 6.2832); c.fill();
    c.restore();
  }

  var fpsN = 0, fpsT = 0, fpsDone = false;
  function drawDrop(now, dt) {
    if (D.alpha <= 0.002 && !D.visible) { dropCv.style.opacity = '0'; dropCv.style.visibility = 'hidden'; return; }
    D.ox = Math.round((D.x - HALF) * dpr) / dpr; D.oy = Math.round((D.y - HALF) * dpr) / dpr;
    dropCv.style.visibility = 'visible';
    dropCv.style.opacity = String(D.alpha);
    dropCv.style.transform = 'translate3d(' + D.ox + 'px,' + D.oy + 'px,0)';
    drawInner(now);
    if (renderMode === 'gl') renderGL(); else render2D();
    if (!fpsDone) {
      if (dt > .25) return;
      fpsN++; fpsT += dt;
      if (fpsT > 3) {
        fpsDone = true;
        if (fpsN / fpsT < 30 && qualMul > .5 && renderMode === 'gl') { qualMul = .5; sizeDrop(); }
      }
    }
  }

  /* ---------- главный цикл ---------- */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var raw = (now - last) / 1000;
    var dt = Math.min(1 / 30, raw);
    last = now;
    if (dt <= 0) return;
    updateDrop(now, dt);
    var hovered = null;
    if (ptr.in && mode === 'follow' && ptr.type !== 'touch') hovered = hitFish(ptr.x, ptr.y, false);
    for (var i = 0; i < fishList.length; i++) fishList[i].hovT = fishList[i] === hovered ? 1 : 0;
    hero.classList.toggle('fish-hover', !!hovered);
    hero.classList.toggle('drop-on', !touchMode && ptr.in && mode === 'follow' && D.visible);
    updateFish(now, dt);
    updateSilt(now, dt);
    drawDrop(now, raw);
  }
  function startLoop() {
    if (running || !enabled || !heroOn || document.hidden) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; cancelAnimationFrame(raf); }

  /* ---------- загрузка ресурсов эффекта ---------- */
  function loadEffectAssets() {
    if (!underLoaded) { underLoaded = true; underImg = new Image(); underImg.src = 'img/underwater.webp'; }
    if (!spritesRequested) { spritesRequested = true; if (fishSetKey) SETS[fishSetKey].forEach(loadSprite); }
  }

  function measure() {
    var prevTop = waterTop(), prevBot = waterBot(), prevW = W;
    if (!geom()) return;
    if (!enabled) return;
    sizeDrop();
    if (fishList.length && prevW) {
      var sx = W / prevW, top = waterTop(), bot = waterBot();
      fishList.forEach(function (f) {
        f.x *= sx; f.home.x *= sx;
        f.y = top + (f.y - prevTop) / Math.max(1, prevBot - prevTop) * (bot - top);
        f.home.y = top + (f.home.y - prevTop) / Math.max(1, prevBot - prevTop) * (bot - top);
      });
    }
  }

  function resetTimers() {
    startAt = performance.now() + (touchMode ? 1200 : 600);
    idleSince = performance.now();
    mode = 'off'; firstPatrolDone = touchMode;   // на телефоне сам не появляется
    D.visible = false; D.alpha = 0; D.ap = 0; D.av = 0;
  }

  function enable() {
    if (enabled) return;
    if (renderMode === 'none') renderMode = initGL() ? 'gl' : '2d';
    if (renderMode === '2d' && !ctx2) { ctx2 = dropCv.getContext('2d'); }
    if (renderMode === '2d' && !ctx2) { return; }
    enabled = true;
    root.classList.add('js-fx');
    geom(); sizeDrop();
    makeFish(); makeSilt();
    resetTimers();
    if (document.readyState === 'complete') loadEffectAssets(); else window.addEventListener('load', loadEffectAssets, { once: true });
    startLoop();
  }
  function disable() {
    enabled = false;
    stopLoop();
    root.classList.remove('js-fx');
    hero.classList.remove('drop-on', 'fish-hover');
    mode = 'off'; D.visible = false; D.alpha = 0;
  }
  function syncMotion() { if (mqRM.matches) disable(); else enable(); }

  /* ---------- указатель ---------- */
  function onTarget(e) { return e.target && e.target.closest && e.target.closest('a,button'); }
  /* v5: капля только над водой hero; не над небом, шапкой, заголовком, подписями и кнопками */
  var textEls = [].slice.call(hero.querySelectorAll('h1 .t1, h1 .t2, .eyebrow, .rating-card, .hero-stats, .hero-addr, .hint, .btn, .link, .scroll-hint'));
  var rng = document.createRange();
  function overText(cx, cy) {
    for (var i = 0; i < textEls.length; i++) {
      var el = textEls[i];
      if (!el.offsetParent && el.getClientRects().length === 0) continue;
      var r;
      if (el.matches('.btn, .link, .rating-card, .scroll-hint')) r = el.getBoundingClientRect();
      else { rng.selectNodeContents(el); r = rng.getBoundingClientRect(); }
      if (!r.width || !r.height) continue;
      var top = r.top, bot = r.bottom;
      if (el.tagName === 'SPAN' && el.parentNode.tagName === 'H1') {   // рамка текста выше самих заглавных: берём высоту капители
        var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        top += fs * .27; bot -= fs * .27;
      }
      if (cx >= r.left - 10 && cx <= r.right + 10 && cy >= top - 10 && cy <= bot + 10) return true;
    }
    return false;
  }
  function notWater(e, p) { return p.y < waterTop() || overText(e.clientX, e.clientY); }
  function localXY(e) {
    var rect = hero.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  var TOUCH_OFF = .7;   // центр капли выше пальца на 0.7 радиуса
  var tap = null, navPending = false;

  function fishGo(f, px, py) {
    if (navPending || busy) return;
    navPending = true;
    var dx = f.x - px, dy = f.y - py, d = Math.hypot(dx, dy) || 1;
    f.kx += dx / d * 420; f.ky += dy / d * 420;
    f.fleeing = true; f.boost = f.k.ret; f.returning = false;
    var ox = f.x, oy = f.y;
    setTimeout(function () { navPending = false; goTo(1, { push: true, via: 'fish', ox: ox, oy: oy }); }, 140);
  }

  hero.addEventListener('pointermove', function (e) {
    if (!enabled || !heroOn) return;
    var p = localXY(e);
    ptr.type = e.pointerType;
    if (e.pointerType === 'touch') {
      if (!ptr.down) return;
      ptr.x = p.x; ptr.y = p.y;
      if (tap) {
        if (Math.hypot(e.clientX - tap.cx, e.clientY - tap.cy) >= 10) tap.moved = true;
        if (tap.inside && !tap.moved) return;
      }
      mode = 'follow';
      showDrop(p.x, p.y - R * TOUCH_OFF);
      return;
    }
    if (touchMode) { touchMode = false; measure(); }
    if (onTarget(e) || notWater(e, p)) { ptr.in = false; if (mode === 'follow') { mode = 'off'; idleSince = performance.now(); hideDrop(); } hero.classList.remove('drop-on', 'fish-hover'); return; }
    ptr.in = true; ptr.x = p.x; ptr.y = p.y;
    if (!busy) { mode = 'follow'; hero.classList.add('used'); showDrop(p.x, p.y); }
  });
  hero.addEventListener('pointerleave', function (e) {
    if (!enabled || e.pointerType === 'touch') return;
    ptr.in = false;
    if (mode === 'follow') { mode = 'off'; idleSince = performance.now(); hideDrop(); }
    hero.classList.remove('drop-on', 'fish-hover');
  });
  hero.addEventListener('pointerdown', function (e) {
    if (!enabled || !heroOn || e.pointerType !== 'touch') return;
    if (onTarget(e)) return;
    var p = localXY(e);
    if (notWater(e, p)) return;
    if (!touchMode) { touchMode = true; measure(); }
    ptr.type = 'touch';
    var inside = D.visible && D.alpha > .6 && sdDropJS(p.x, p.y) < 0;
    var f = inside ? hitFish(p.x, p.y, true) : null;
    tap = { f: f, inside: inside, t0: performance.now(), cx: e.clientX, cy: e.clientY, px: p.x, py: p.y, moved: false };
    ptr.down = true; ptr.x = p.x; ptr.y = p.y;
    hero.classList.add('used');
    mode = 'follow';
    if (!inside) {
      showDrop(p.x, p.y - R * TOUCH_OFF);
    }
  });
  function touchEnd(e) {
    if (!enabled || e.pointerType !== 'touch' || !ptr.down) return;
    ptr.down = false;
    var tp = tap; tap = null;
    mode = 'hold'; holdUntil = performance.now() + 3000;
    if (e.type === 'pointerup' && tp && tp.f && !tp.moved && performance.now() - tp.t0 < 250) fishGo(tp.f, tp.px, tp.py);
  }
  hero.addEventListener('pointerup', touchEnd);
  hero.addEventListener('pointercancel', touchEnd);
  hero.addEventListener('click', function (e) {
    if (!enabled || ptr.type === 'touch' || onTarget(e)) return;
    var p = localXY(e);
    if (notWater(e, p)) return;
    var f = hitFish(p.x, p.y, false);
    if (f) fishGo(f, p.x, p.y);
  });

  function onHeroResize() { measure(); if (enabled) { makeFish(); makeSilt(); } }
  if ('ResizeObserver' in window) new ResizeObserver(onHeroResize).observe(hero);
  else window.addEventListener('resize', onHeroResize);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopLoop(); else startLoop(); });
  if (mqRM.addEventListener) mqRM.addEventListener('change', syncMotion); else if (mqRM.addListener) mqRM.addListener(syncMotion);

  function heroShown(on) {
    heroOn = on;
    if (on) { if (enabled) { resetTimers(); firstPatrolDone = true; startLoop(); } }
    else {
      stopLoop(); mode = 'off'; ptr.in = false; ptr.down = false; tap = null;
      D.visible = false; D.alpha = 0; D.ap = 0; D.av = 0;
      dropCv.style.opacity = '0'; dropCv.style.visibility = 'hidden';
      hero.classList.remove('drop-on', 'fish-hover');
    }
  }

  /* =====================================================================
     Сцены: менеджер, переходы, ввод
     ===================================================================== */
  var navLinks = [].slice.call(document.querySelectorAll('.scene-nav a'));
  var vLinks = [].slice.call(document.querySelectorAll('.vnav a'));
  var cur = 0, busy = false, pendingIdx = null, lbOpen = false;

  function idxFromHash() {
    var h = (location.hash || '').replace('#', '');
    var i = IDS.indexOf(h);
    return i < 0 ? 0 : i;
  }
  function resetUnknownHash() {
    var h = (location.hash || '').replace('#', '');
    if (h && IDS.indexOf(h) < 0) { try { history.replaceState({ s: 0 }, '', location.pathname + location.search); } catch (e) {} }
  }
  function headingOf(i) { return scenes[i].querySelector('h1, h2'); }

  function scrollState() {
    var sc = scenes[cur], inner = sc.querySelector('.scene__inner');
    var can = false, atEnd = true;
    [].forEach.call(sc.querySelectorAll('.scene__inner, .loc__main'), function (el) {
      if (el.scrollHeight > el.clientHeight + 4) {
        can = true;
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 4) atEnd = false;
      }
    });
    sc.classList.toggle('can-scroll', can);
    sc.classList.toggle('at-end', !can || atEnd);
    root.classList.toggle('inner-scrolled', !!inner && inner.scrollTop > 6);
  }
  scenes.forEach(function (sc) {
    var inn = sc.querySelector('.scene__inner');
    if (inn) inn.addEventListener('scroll', scrollState, { passive: true });
    var lm = sc.querySelector('.loc__main');
    if (lm) lm.addEventListener('scroll', scrollState, { passive: true });
  });
  if ('ResizeObserver' in window) {
    var roSc = new ResizeObserver(scrollState);
    scenes.forEach(function (sc) { var inn = sc.querySelector('.scene__inner'); if (inn) { roSc.observe(inn); if (inn.firstElementChild) roSc.observe(inn.firstElementChild); } var lm = sc.querySelector('.loc__main'); if (lm) roSc.observe(lm); });
  } else window.addEventListener('resize', scrollState);

  /* галерея: отложенная загрузка превью */
  var gImgs = [].slice.call(document.querySelectorAll('.g-img'));
  function loadThumbs(n) {
    for (var i = 0; i < Math.min(n, gImgs.length); i++) {
      var im = gImgs[i];
      if (im.getAttribute('src')) continue;
      im.addEventListener('load', function () { this.classList.add('is-loaded'); }, { once: true });
      im.addEventListener('error', function () { this.classList.add('is-loaded'); }, { once: true });
      im.src = im.getAttribute('data-src');
    }
  }
  var photosNav = document.querySelector('.scene-nav a[href="#photos"]');
  if (photosNav) ['pointerenter', 'focus'].forEach(function (n) { photosNav.addEventListener(n, function () { loadThumbs(4); }, { passive: true }); });

  function setActive(i) {
    scenes.forEach(function (s, k) {
      var on = k === i;
      s.classList.toggle('is-active', on);
      if (on) { s.removeAttribute('inert'); s.removeAttribute('aria-hidden'); }
      else { s.setAttribute('inert', ''); s.setAttribute('aria-hidden', 'true'); }
    });
    navLinks.forEach(function (a, k) {
      if (k === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    vLinks.forEach(function (a, k) {
      if (k === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    cur = i;
    var inn = scenes[i].querySelector('.scene__inner');
    if (inn) inn.scrollTop = 0;
    if (statusEl) statusEl.textContent = STATUS.replace('{n}', i + 1).replace('{total}', scenes.length).replace('{title}', TITLES[i]);
    heroShown(i === 0);
    if (i > 0) { loadBg(i); loadBg(i + 1); }
    if (i === 1) loadThumbs(4);
    if (i === 2) loadThumbs(12);
    scrollState();
  }

  function wait(ms, fn) { return setTimeout(fn, ms); }

  function reveal(sc, baseDelay) {
    var els = [].slice.call(sc.querySelectorAll('[data-reveal]')).slice(0, 5);
    els.forEach(function (el, k) {
      var a = el.animate([
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 360, delay: baseDelay + k * 60, easing: EASE, fill: 'backwards' });
      a.onfinish = function () { a.cancel(); };
      setTimeout(function () { try { a.cancel(); } catch (e) {} }, baseDelay + k * 60 + 360 + 250);
    });
  }

  function focusHeading(i) {
    var h = headingOf(i);
    if (h) h.focus({ preventScroll: true });
  }

  function goTo(i, o) {
    o = o || {};
    if (i < 0 || i >= scenes.length || i === cur) return false;
    if (busy) { if (o.via === 'hash') pendingIdx = i; return false; }
    var from = scenes[cur], to = scenes[i];
    var focusBefore = from.contains(document.activeElement);
    var wantFocus = o.via === 'kbd' || o.via === 'link';
    if (o.push) { try { history.pushState({ s: i }, '', '#' + IDS[i]); } catch (err) {} }
    if (o.replace) { try { history.replaceState({ s: i }, '', '#' + IDS[i]); } catch (err2) {} }
    root.classList.add('scene-changed');
    hero.classList.add('used');

    var instant = o.instant || mqRM.matches || typeof from.animate !== 'function';
    var after = function () { if (wantFocus || focusBefore) focusHeading(i); };

    if (instant) { setActive(i); after(); return true; }

    /* вертикальный слайд: текущая сцена уезжает вверх, следующая въезжает снизу (назад наоборот); без заливок поверх */
    var dir = i > cur ? 1 : -1;
    var DUR = 720, EZ = 'cubic-bezier(.65,0,.35,1)';
    busy = true;
    from.classList.add('is-leaving');
    to.classList.add('is-entering');
    var anims = [];
    anims.push(to.animate([{ transform: 'translate3d(0,' + (100 * dir) + '%,0)' }, { transform: 'translate3d(0,0,0)' }],
      { duration: DUR, easing: EZ, fill: 'both' }));
    anims.push(from.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,' + (-100 * dir) + '%,0)' }],
      { duration: DUR, easing: EZ, fill: 'both' }));
    setActive(i);
    wait(DUR + 30, function () {
      anims.forEach(function (a) { try { a.cancel(); } catch (err3) {} });
      from.classList.remove('is-leaving');
      to.classList.remove('is-entering');
      busy = false;
      after();
      if (pendingIdx !== null) {
        var p = pendingIdx; pendingIdx = null;
        if (p !== cur) goTo(p, { via: 'hash' });
      }
    });
    return true;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var i = IDS.indexOf(a.getAttribute('href').slice(1));
    if (i < 0) return;
    e.preventDefault();
    if (i === cur) { focusHeading(i); return; }
    goTo(i, { push: true, via: 'link' });
  });

  window.addEventListener('popstate', function () { resetUnknownHash(); goTo(idxFromHash(), { via: 'hash' }); });
  window.addEventListener('hashchange', function () { resetUnknownHash(); goTo(idxFromHash(), { via: 'hash' }); });

  function innerOf() { return scenes[cur].querySelector('.scene__inner'); }
  function canScroll(el, dir) {
    if (!el) return false;
    return dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 0;
  }
  /* ближайший прокручиваемый блок от target до сцены с запасом прокрутки в нужную сторону */
  function scrollerFor(target, dir) {
    var el = target && target.nodeType === 1 ? target : target && target.parentElement;
    var sc = scenes[cur];
    while (el && el !== stage && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 2) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && canScroll(el, dir)) return el;
      }
      if (el === sc) break;
      el = el.parentElement;
    }
    return null;
  }
  function step(dir, via, extra) {
    var n = cur + dir;
    if (n < 0) return false;
    if (n >= scenes.length) { if (via === 'enter') n = 0; else return false; }
    var o = { push: true, via: via === 'enter' ? 'kbd' : via };
    if (extra) for (var k in extra) o[k] = extra[k];
    return goTo(n, o);
  }

  /* колесо */
  var wAcc = 0, wDir = 0, lastWheel = 0, wMode = 'new';
  stage.addEventListener('wheel', function (e) {
    if (e.ctrlKey || lbOpen) return;
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1);
    if (Math.abs(dy) < Math.abs(e.deltaX) || dy === 0) return;
    var now = performance.now();
    var gap = now - lastWheel;
    lastWheel = now;
    var dir = dy > 0 ? 1 : -1;
    var inn = innerOf();
    var newGesture = gap > 160;
    if (newGesture) { wMode = 'new'; if (gap > 220) { wAcc = 0; wDir = 0; } }
    if (busy) { e.preventDefault(); wMode = 'done'; return; }
    if (wMode === 'done') { e.preventDefault(); return; }
    var sc2 = scrollerFor(e.target, dir);
    if (!sc2 && canScroll(inn, dir) && !inn.contains(e.target)) sc2 = inn;
    if (sc2) {
      wMode = 'inner';
      e.preventDefault(); sc2.scrollTop += dy;
      return;
    }
    e.preventDefault();
    if (wMode === 'inner') return;
    if (dir !== wDir) { wAcc = 0; wDir = dir; }
    wAcc += Math.abs(dy);
    if (wAcc >= 40) { wAcc = 0; wMode = 'done'; step(dir, 'wheel'); }
  }, { passive: false });

  /* свайп: на воде в hero не листает (палец водит каплю) */
  var sw = null;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || lbOpen) { sw = null; return; }
    var t = e.touches[0], inn = innerOf();
    var rect = stage.getBoundingClientRect();
    sw = {
      x0: t.clientX, y0: t.clientY, x1: t.clientX, y1: t.clientY, t0: performance.now(),
      atTop: !scrollerFor(e.target, -1) && (!inn || inn.scrollTop <= 0), atBot: !scrollerFor(e.target, 1) && !canScroll(inn, 1),
      onWater: cur === 0 && (t.clientY - rect.top) > waterTop() && !(e.target.closest && e.target.closest('a,button'))
    };
  }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!sw || !e.touches.length) return;
    sw.x1 = e.touches[0].clientX; sw.y1 = e.touches[0].clientY;
  }, { passive: true });
  function swipeEnd(e) {
    if (!sw) return;
    var s = sw; sw = null;
    if (e.changedTouches && e.changedTouches.length) { s.x1 = e.changedTouches[0].clientX; s.y1 = e.changedTouches[0].clientY; }
    if (busy || lbOpen || s.onWater) return;
    var dy = s.y0 - s.y1, dx = s.x0 - s.x1, dt = performance.now() - s.t0;
    var Hh = stage.clientHeight, ady = Math.abs(dy);
    var fast = cur === 0 ? (dt <= 450 && ady >= 80) : ((dt <= 700 || ady >= 0.25 * Hh) && ady >= Math.max(56, 0.08 * Hh));
    if (!fast || ady < 1.4 * Math.abs(dx)) return;
    var dir = dy > 0 ? 1 : -1;
    if (dir > 0 && !s.atBot) return;
    if (dir < 0 && !s.atTop) return;
    step(dir, 'swipe');
  }
  stage.addEventListener('touchend', swipeEnd, { passive: true });
  stage.addEventListener('touchcancel', swipeEnd, { passive: true });

  /* кнопки «Позвонить»: номер скрыт, короткий тост */
  var toastEl = null, toastT = 0;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    void toastEl.offsetWidth;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2000);
  }
  [].forEach.call(document.querySelectorAll('.act[aria-disabled="true"]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); showToast('Номер скрыт'); });
    a.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); showToast('Номер скрыт'); } });
  });

  /* клавиатура */
  document.addEventListener('keydown', function (e) {
    if (lbOpen || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    var tg = e.target, tag = tg && tg.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
    var k = e.key, inn = innerOf();
    var onCtl = tg && tg.closest && tg.closest('a,button');
    var neutral = tg === document.body || tg === stage || (tg && tg.classList && tg.classList.contains('scene'));
    var dir = 0, kind = '';
    if (k === 'ArrowDown') { dir = 1; kind = 'arrow'; }
    else if (k === 'PageDown') { dir = 1; kind = 'page'; }
    else if (k === ' ' || k === 'Spacebar') { if (onCtl && !e.shiftKey) return; dir = e.shiftKey ? -1 : 1; kind = 'page'; }
    else if (k === 'ArrowUp') { dir = -1; kind = 'arrow'; }
    else if (k === 'PageUp' || k === 'Escape' || k === 'Esc') { dir = -1; kind = 'page'; }
    else if (k === 'Home') { e.preventDefault(); if (!busy) goTo(0, { push: true, via: 'kbd' }); return; }
    else if (k === 'End') { e.preventDefault(); if (!busy) goTo(scenes.length - 1, { push: true, via: 'kbd' }); return; }
    else if (k === 'Enter') {
      if (!neutral) return;
      e.preventDefault();
      if (!busy && !e.repeat) step(1, 'enter');
      return;
    }
    else return;
    if ((k === 'Escape' || k === 'Esc') && cur === 0) return;
    var ksc = (k === 'Escape' || k === 'Esc') ? null : (scrollerFor(tg, dir) || scrollerFor(scenes[cur].querySelector('.loc__main'), dir) || (canScroll(inn, dir) ? inn : null));
    if (ksc) {
      e.preventDefault();
      inn = ksc;
      inn.scrollBy({ top: dir * (kind === 'page' ? inn.clientHeight * 0.85 : 60), behavior: mqRM.matches ? 'auto' : 'smooth' });
      return;
    }
    e.preventDefault();
    if (busy || e.repeat) return;
    step(dir, 'kbd');
  });

  /* фон-фото сцен 1-3: ленивая подгрузка через data-src (по приближению сцены или через 1.5 s после load) */
  var bgImgs = scenes.map(function (sc) { return sc.querySelector('.scene__photo'); });
  function loadBg(i) {
    var el = bgImgs[i];
    if (!el || el.getAttribute('data-state')) return;
    el.setAttribute('data-state', 'loading');
    var im = new Image();
    var done = function (ok) {
      if (ok) el.style.backgroundImage = 'url("' + el.getAttribute('data-bg') + '")';
      el.setAttribute('data-state', 'done');
      el.classList.add('is-loaded');
    };
    im.onload = function () { done(true); };
    im.onerror = function () { done(false); };
    im.src = el.getAttribute('data-bg');
  }
  var bgNear = false;
  function loadBgNear() { if (bgNear) return; bgNear = true; loadBg(1); }
  window.addEventListener('load', function () { setTimeout(loadBgNear, 1500); }, { once: true });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (n) {
    window.addEventListener(n, loadBgNear, { once: true, passive: true });
  });

  /* =====================================================================
     Галерея: параллакс, счётчик ленты, лайтбокс
     ===================================================================== */
  var photos = document.getElementById('photos');
  var gallery = photos.querySelector('.gallery');
  var gCards = [].slice.call(gallery.querySelectorAll('.g-card'));
  var gCount = photos.querySelector('.gallery__count');
  var links = [].slice.call(gallery.querySelectorAll('.g-link'));
  var TOTAL = links.length;

  /* параллакс desktop */
  var fineMQ = window.matchMedia('(pointer: fine)');
  var par = { tx: 0, ty: 0, x: 0, y: 0, raf: 0, until: 0 };
  function parTick(now) {
    par.x += (par.tx - par.x) * .08; par.y += (par.ty - par.y) * .08;
    gallery.style.setProperty('--px', par.x.toFixed(3));
    gallery.style.setProperty('--py', par.y.toFixed(3));
    if (now < par.until || Math.abs(par.tx - par.x) > .002 || Math.abs(par.ty - par.y) > .002) par.raf = requestAnimationFrame(parTick);
    else par.raf = 0;
  }
  photos.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || mqRM.matches || !fineMQ.matches || window.innerWidth < 1024) return;
    var r = photos.getBoundingClientRect();
    par.tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
    par.ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
    par.until = performance.now() + 600;
    if (!par.raf) par.raf = requestAnimationFrame(parTick);
  });
  /* параллакс ленты на телефоне */
  var ribRaf = 0;
  function ribbon() {
    ribRaf = 0;
    if (mqRM.matches || window.innerWidth >= 1024) return;
    var vw = window.innerWidth;
    gCards.forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.right < -50 || r.left > vw + 50) return;
      c.style.setProperty('--px', ((r.left + r.width / 2 - vw / 2) / vw).toFixed(3));
      c.style.setProperty('--py', '0');
    });
  }
  gallery.addEventListener('scroll', function () { if (!ribRaf) ribRaf = requestAnimationFrame(ribbon); }, { passive: true });

  /* счётчик ленты */
  if (gCount && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) gCount.textContent = (gCards.indexOf(en.target) + 1) + ' / ' + TOTAL;
      });
    }, { root: gallery, threshold: .6 });
    gCards.forEach(function (c) { io.observe(c); });
  }

  /* лайтбокс */
  var lb = document.querySelector('.lightbox');
  var lbImg = lb.querySelector('.lb__img');
  var lbAlt = lb.querySelector('.lb__alt');
  var lbCnt = lb.querySelector('.lb__count');
  var lbTpl = lbCnt.getAttribute('data-tpl') || '{n} / {total}';
  var lbIdx = 0, lbAnim = null, lbClosing = false;

  function wrap(i) { return (i + TOTAL) % TOTAL; }
  function lbSet(i) {
    lbIdx = i;
    var a = links[i], th = a.querySelector('.g-img');
    var w = +a.getAttribute('data-w'), h = +a.getAttribute('data-h');
    lbImg.style.setProperty('--ar', (w / h).toFixed(4));
    lbImg.width = w; lbImg.height = h;
    lbImg.src = th.getAttribute('src') || th.getAttribute('data-src');
    lbAlt.textContent = a.getAttribute('data-alt');
    lbCnt.innerHTML = '<span aria-hidden="true">' + (i + 1) + ' / ' + TOTAL + '</span><span class="sr-only">' +
      lbTpl.replace('{n}', i + 1).replace('{total}', TOTAL) + '</span>';
    var big = new Image();
    big.onload = function () { if (lbIdx === i) lbImg.src = big.src; };
    big.src = a.getAttribute('data-lg');
  }
  function lbGo(dir) {
    var n = wrap(lbIdx + dir);
    if (mqRM.matches || typeof lbImg.animate !== 'function' || lbAnim) { lbSet(n); return; }
    lbAnim = lbImg.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(' + (-16 * dir) + 'px)' }],
      { duration: 140, easing: 'ease-in', fill: 'forwards' });
    lbAnim.onfinish = function () {
      lbSet(n);
      var a2 = lbImg.animate([{ opacity: 0, transform: 'translateX(' + (16 * dir) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 200, easing: EASE });
      try { lbAnim.cancel(); } catch (e) {}
      lbAnim = a2;
      a2.onfinish = function () { lbAnim = null; };
    };
  }
  function lbOpenAt(i) {
    lbSet(i);
    lbClosing = false;
    lb.classList.remove('is-closing');
    if (typeof lb.showModal === 'function') lb.showModal(); else lb.setAttribute('open', '');
    lbOpen = true;
    lb.querySelector('.lb__close').focus();
  }
  function lbClose() {
    if (!lbOpen || lbClosing) return;
    lbClosing = true;
    var fin = function () {
      lbClosing = false;
      if (lb.close) lb.close(); else lb.removeAttribute('open');
      lb.classList.remove('is-closing');
      lbOpen = false;
      var a = links[lbIdx];
      try { a.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {}
      a.focus({ preventScroll: true });
    };
    if (mqRM.matches) fin(); else { lb.classList.add('is-closing'); setTimeout(fin, 160); }
  }
  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      lbOpenAt(i);
    });
  });
  lb.querySelector('.lb__prev').addEventListener('click', function () { lbGo(-1); });
  lb.querySelector('.lb__next').addEventListener('click', function () { lbGo(1); });
  lb.querySelector('.lb__close').addEventListener('click', lbClose);
  lb.addEventListener('click', function (e) { if (e.target === lb) lbClose(); });
  lb.addEventListener('cancel', function (e) { e.preventDefault(); lbClose(); });
  lb.addEventListener('close', function () { lbOpen = false; });
  lb.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbGo(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbGo(1); }
    else if (e.key === 'Home') { e.preventDefault(); lbSet(0); }
    else if (e.key === 'End') { e.preventDefault(); lbSet(TOTAL - 1); }
  });
  var lbT = null;
  lb.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { lbT = null; return; }
    lbT = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (!lbT || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - lbT.x, dy = e.changedTouches[0].clientY - lbT.y;
    lbT = null;
    if (Math.abs(dx) >= 48 && Math.abs(dx) >= 1.4 * Math.abs(dy)) lbGo(dx < 0 ? 1 : -1);
    else if (dy >= 96 && dy >= 1.4 * Math.abs(dx)) lbClose();
  }, { passive: true });

  /* ---------- старт ---------- */
  var startIdx = idxFromHash();
  resetUnknownHash();
  setActive(0);
  geom();
  syncMotion();
  if (startIdx !== 0) {
    setActive(startIdx);
    try { history.replaceState({ s: startIdx }, '', '#' + IDS[startIdx]); } catch (e) {}
  }
})();
