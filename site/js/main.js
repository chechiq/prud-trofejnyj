/* Пруд трофейный — сайт */
(function () {
  'use strict';

  var root = document.documentElement;
  var stage = document.querySelector('.stage');
  /* порядок сцен: десктоп (>=1024) Пруд, О пруде, Фото, Цены, Как добраться; телефон и планшет Пруд, Фото, О пруде, Цены, Как добраться */
  var ORDERS = { d: ['top', 'about', 'photos', 'prices', 'location'], m: ['top', 'photos', 'about', 'prices', 'location'] };
  var desktopMQ = window.matchMedia('(min-width: 1024px)');
  var scenes = [].slice.call(document.querySelectorAll('.scene'));
  var hero = document.getElementById('top');
  if (!stage || !scenes.length || !hero) return;

  var IDS = [], TITLES = [];
  var NEXT_T = { top: 'К началу', about: 'О пруде', photos: 'Фото', prices: 'Цены', location: 'Проезд' };
  var BACK_T = { top: 'началу', about: 'разделу «О пруде»', photos: 'разделу «Фото»', prices: 'разделу «Цены»', location: 'разделу «Как добраться»' };
  /* расставляет сцены, меню, кнопки Назад/Дальше под текущий порядок; массивы меняются на месте, ссылки на них остаются рабочими */
  function applyOrder() {
    var ord = desktopMQ.matches ? ORDERS.d : ORDERS.m;
    scenes.sort(function (a, b) { return ord.indexOf(a.id) - ord.indexOf(b.id); });
    IDS.length = 0; TITLES.length = 0;
    scenes.forEach(function (sc, k) { IDS.push(sc.id); TITLES.push(sc.getAttribute('data-title') || ''); sc.setAttribute('data-scene', k); });
    for (var j = 1; j < scenes.length; j++) { if (scenes[j - 1].nextElementSibling !== scenes[j]) scenes[j - 1].after(scenes[j]); }
    scenes.forEach(function (sc, k) {
      var back = sc.querySelector('.scene-ctl .back'), next = sc.querySelector('.scene-ctl .next');
      if (back && k > 0) { back.setAttribute('href', '#' + IDS[k - 1]); back.setAttribute('aria-label', 'Вернуться к ' + BACK_T[IDS[k - 1]]); }
      if (next && k < IDS.length - 1) {
        next.setAttribute('href', '#' + IDS[k + 1]);
        next.setAttribute('aria-label', 'Перейти к разделу «' + TITLES[k + 1] + '»');
        var nt = next.querySelector('.next__t'); if (nt) nt.textContent = NEXT_T[IDS[k + 1]];
      }
    });
    ['.scene-nav', '.vnav', '.tabbar'].forEach(function (q) {
      var box = document.querySelector(q); if (!box) return;
      IDS.forEach(function (id) { var a = box.querySelector('a[href="#' + id + '"]'); if (a) box.appendChild(a); });
    });
  }
  applyOrder();
  var statusEl = document.getElementById('scene-status');
  var STATUS = (statusEl && statusEl.getAttribute('data-tpl')) || '{n}/{total}: {title}';
  var mqRM = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarseMQ = window.matchMedia('(pointer: coarse)');
  var EASE = 'cubic-bezier(.2,.7,.2,1)';

  function noop() {}
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

  /* =====================================================================
     Сцена 0: геометрия кадра, курсор-капля, рыбы
     ===================================================================== */
  var surfaceImg = hero.querySelector('img.surface');
  var dropCv = hero.querySelector('canvas.drop');
  var heroRow = hero.querySelector('.hero__row');
  var underImg = null;
  var W = 0, H = 0, dpr = 1, horizonY = 0, imgLeft = 0, imgTop = 0, imgScale = 1;
  var touchMode = coarseMQ.matches;
  /* телефон и планшет (<=1023): линза сама дрейфует по воде, тап переносит; на десктопе всё как раньше */
  var phone = !desktopMQ.matches, lensKilled = false, enabledPhone = false;
  var zone = { l: 0, r: 0, t: 0, b: 0, ok: false };
  var enabled = false, running = false, heroOn = true, raf = 0, last = 0;

  /* кэш прямоугольников hero и текстовых блоков: читаем layout один раз, а не на каждый pointermove и кадр патруля;
     сбрасывается при ресайзе, смене сцены, загрузке шрифтов; во время слайда (busy) не кэшируем */
  var heroRectCache = null, textRectCache = null;
  function invalidateRects() { heroRectCache = null; textRectCache = null; }
  function heroRect() {
    if (busy) return hero.getBoundingClientRect();
    return heroRectCache || (heroRectCache = hero.getBoundingClientRect());
  }
  function whenIdle(fn, timeout) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: timeout || 1500 });
    else setTimeout(fn, 60);
  }

  function waterTop() { return horizonY + 12; }
  function waterBot() { return H + 20; }

  function geom() {
    var w = hero.offsetWidth, h = hero.offsetHeight;
    if (!w || !h) return false;
    W = w; H = h;
    var posX = W >= 1024 ? 0.50 : 0.52;
    imgScale = Math.max(W / 1280, H / 872) * (W < 1024 ? 1.2 : 1);
    imgLeft = (W - 1280 * imgScale) * posX;
    imgTop = (H - 872 * imgScale) * (W < 1024 ? 1 : .40);
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
  var glBW = 0, glBH = 0;

  function phoneR() { return Math.round(clamp(.15 * W, 52, 92)); }
  /* зона воды для центра линзы на телефоне (координаты hero): весь круг ниже линии воды и выше ряда кнопок */
  function computeZone() {
    var r = phoneR();
    var rowTop = H;
    if (heroRow) { var hr0 = hero.getBoundingClientRect(), rr0 = heroRow.getBoundingClientRect(); rowTop = rr0.top - hr0.top; }
    zone.t = waterTop() + r + 6; zone.b = rowTop - r - 14;
    zone.l = r + 12; zone.r = W - r - 12;
    zone.ok = zone.b - zone.t >= 24 && zone.r > zone.l;
  }

  function sizeDrop() {
    R = phone ? phoneR() : touchMode ? clamp(.17 * W, 64, 76) : clamp(.065 * W, 64, 92);   // v5: капля меньше на ~23%
    PAD = Math.round(.4 * R + 16);
    HALF = Math.round(R + PAD);
    CSSZ = HALF * 2;
    dpr = Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1);
    TS = phone ? qualMul : Math.min(2, dpr) * qualMul;
    dropCv.style.width = dropCv.style.height = CSSZ + 'px';
    dropCv.width = dropCv.height = Math.round(CSSZ * dpr);
    needRender = true;
    var iw = Math.round(CSSZ * TS);
    inner.width = iw; inner.height = renderMode === '2d' ? iw : iw * 2;
    tmpCv.width = iw; tmpCv.height = iw;
    glBW = glBH = 0;
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
  var D = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 0, dx: 1, dy: 0, ap: 0, av: 0, alpha: 0, visible: false, ox: 0, oy: 0, still: 0 };
  var mode = 'off';              // off | patrol | follow | hold
  var ptr = { x: 0, y: 0, in: false, down: false, type: 'mouse' };
  var startAt = 0, idleSince = 0, patrolStart = 0, patrolUntil = 0, holdUntil = 0, firstPatrolDone = false;
  var introDone = false, introPatrol = false;

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
    if (phone) return { x: clamp(x, zone.l, Math.max(zone.l, zone.r)), y: clamp(y, zone.t, Math.max(zone.t, zone.b)) };
    var m = R * 0.4 + 8;
    return { x: clamp(x, m, W - m), y: clamp(y, m, H - m) };
  }
  function showDrop(x, y) {
    var t = clampTarget(x, y);
    D.tx = t.x; D.ty = t.y;
    if (!D.visible) {
      D.visible = true;
      if (D.alpha <= 0.001) { D.x = t.x; D.y = t.y; D.vx = D.vy = 0; D.k = 0; D.ap = 0; D.av = 0; }
    }
  }
  function hideDrop() { D.visible = false; }
  function setTarget(x, y) { var t = clampTarget(x, y); D.tx = t.x; D.ty = t.y; }

  function patrolPoint(t) {
    var tt = Math.PI * 2;
    if (introPatrol) {
      return { x: W * (.82 + .025 * Math.sin(t * 1.1)), y: horizonY + (H - horizonY) * (.4 + .035 * Math.sin(t * 1.4)) };
    }
    return {
      x: W * (0.5 + 0.30 * Math.sin(tt * t / 14)),
      y: horizonY + (H - horizonY) * (0.5 + 0.26 * Math.sin(tt * t / 9 + 1.1))
    };
  }

  /* ---------- телефон: дрейф -> подплыв по тапу -> покой -> дрейф ---------- */
  var PH = { has: false, st: 'move', bx: 0, by: 0, tvx: 0, tvy: 0, gx: 0, gy: 0, heading: null, acc: 40, t0: 0, until: 0, vSwim: 400 };
  function overTextPad(x, y, pad) {
    var hr = heroRect(), a = textRects(), cx = hr.left + x, cy = hr.top + y, hintGone = hero.classList.contains('used');
    for (var i = 0; i < a.length; i++) {
      if (a[i][4] && hintGone) continue;
      if (cx >= a[i][0] - pad && cx <= a[i][2] + pad && cy >= a[i][1] - pad && cy <= a[i][3] + pad) return true;
    }
    return false;
  }
  function lensAssetsReady() {
    if (document.readyState !== 'complete' || !ready(underImg)) return false;
    var n = 0;
    for (var i = 0; i < fishList.length; i++) if (sprites[fishList[i].id]) n++;
    return n >= Math.min(6, fishList.length);
  }
  function driftSpeed() { return clamp(.06 * W, 20, 30); }
  /* путевая точка: расстояние .25-.6 W, поворот курса до 110 град, не над текстом; до 12 попыток, иначе центр зоны */
  function pickWaypoint() {
    var zh = zone.b - zone.t, best = null, cx = PH.bx, cy = PH.by;
    for (var n = 0; n < 12; n++) {
      var x = zone.l + Math.random() * Math.max(0, zone.r - zone.l), y = zone.t + Math.random() * Math.max(0, zh);
      var d = Math.hypot(x - cx, y - cy);
      if (d < .25 * W || d > .6 * W || Math.abs(y - cy) > .8 * zh) continue;
      if (PH.heading !== null && Math.abs(angDiff(PH.heading, Math.atan2(y - cy, x - cx))) > 110 * Math.PI / 180) continue;
      if (overTextPad(x, y, R * .6)) continue;
      best = { x: x, y: y }; break;
    }
    if (!best) best = { x: (zone.l + zone.r) / 2, y: (zone.t + zone.b) / 2 };
    PH.gx = best.x; PH.gy = best.y;
    PH.heading = Math.atan2(best.y - cy, best.x - cx);
    PH.st = 'move';
  }
  /* скорость к цели с ограничением ускорения; arrive: линейно (дрейф) или ease-out (подплыв) за ar px до цели */
  function stepBase(dt, vmax, acc, ar, ease) {
    var dx = PH.gx - PH.bx, dy = PH.gy - PH.by, d = Math.hypot(dx, dy), sp = vmax;
    if (d < ar) { var s = d / ar; sp = vmax * (ease ? 1 - (1 - s) * (1 - s) : s); }
    var wx = d > .001 ? dx / d * sp : 0, wy = d > .001 ? dy / d * sp : 0;
    var ax = wx - PH.tvx, ay = wy - PH.tvy, al = Math.hypot(ax, ay), mx = acc * dt;
    if (al > mx) { ax *= mx / al; ay *= mx / al; }
    PH.tvx += ax; PH.tvy += ay;
    PH.bx += PH.tvx * dt; PH.by += PH.tvy * dt;
    return d;
  }
  function startRest(now, ms) { PH.st = 'pause'; PH.t0 = now; PH.until = now + ms; PH.tvx = PH.tvy = 0; }
  function wobble(now) {
    var t = (now - PH.t0) / 1000;
    setTarget(PH.bx + 1.5 * Math.sin(2 * Math.PI * .17 * t), PH.by + 2 * Math.sin(2 * Math.PI * .25 * t));
  }
  function phoneBehavior(now, dt) {
    if (mode === 'off') {
      if (now < startAt || !lensAssetsReady()) return;
      computeZone();   // шрифты и раскладка к этому моменту устоялись
      if (!zone.ok) return;
      var s = PH.has ? clampTarget(PH.bx, PH.by) : clampTarget(.68 * W, (zone.t + zone.b) / 2);
      PH.has = true; PH.bx = s.x; PH.by = s.y; PH.tvx = PH.tvy = 0; PH.heading = null; PH.acc = 40;
      mode = 'drift';
      showDrop(s.x, s.y);
      pickWaypoint();
      return;
    }
    var v = driftSpeed();
    if (mode === 'drift') {
      if (PH.st === 'pause') {
        wobble(now);
        if (now >= PH.until) { PH.acc = 40; pickWaypoint(); }
      } else {
        var dd = stepBase(dt, v, PH.acc, 36, false);
        setTarget(PH.bx, PH.by);
        if (dd < 8) startRest(now, 800 + Math.random() * 1200);
      }
    } else if (mode === 'swim') {
      var ds = stepBase(dt, PH.vSwim, 1800, 70, true);
      setTarget(PH.bx, PH.by);
      if (ds < 1.5) { mode = 'rest'; startRest(now, 2500); }
    } else if (mode === 'rest') {
      wobble(now);
      if (now >= PH.until) { mode = 'drift'; PH.acc = v / 1.2; PH.heading = null; pickWaypoint(); }
    }
  }
  /* тап по воде: плыть в точку (зажата в зону) */
  function lensTap(x, y) {
    if (!enabled || !phone || !heroOn || busy || !D.visible || !zone.ok) return;
    if (mode !== 'drift' && mode !== 'swim' && mode !== 'rest') return;
    var g = clampTarget(x, y);
    PH.gx = g.x; PH.gy = g.y; PH.vSwim = clamp(.9 * W, 300, 520);
    mode = 'swim';
  }

  function updateDrop(now, dt) {
    if (!heroOn) { D.visible = false; mode = 'off'; return; }
    /* поведение */
    if (phone) {
      phoneBehavior(now, dt);
    } else if (mode === 'off') {
      if (!touchMode) {
        if (!firstPatrolDone && now >= startAt) {
          firstPatrolDone = true; introDone = true; introPatrol = true; mode = 'patrol'; patrolStart = now; patrolUntil = now + 3200;
          var p0 = patrolPoint(0); showDrop(p0.x, p0.y);
        } else if (firstPatrolDone && !ptr.in && !D.visible && now - idleSince > 8000) {
          introPatrol = false; mode = 'patrol'; patrolStart = now; patrolUntil = now + 2400;
          var p1 = patrolPoint(0); showDrop(p1.x, p1.y);
        }
      }
    } else if (mode === 'patrol') {
      var pp = patrolPoint((now - patrolStart) / 1000);
      setTarget(pp.x, pp.y);
      var hr = heroRect();
      D.visible = !overText(hr.left + pp.x, hr.top + pp.y);   // v5: не над текстом и кнопками
      if (now > patrolUntil) { introPatrol = false; mode = 'off'; idleSince = now; hideDrop(); }
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
    if (sp > 40) { D.dx = D.vx / sp; D.dy = D.vy / sp; }
    D.still = sp < 30 ? D.still + dt : 0;

    if (D.visible) {
      spring(D, 'ap', 'av', 1, 300, 1, dt);
      D.alpha = Math.min(1, D.alpha + dt / (phone ? .4 : .16));
    } else {
      D.ap += (.6 - D.ap) * (1 - Math.exp(-dt * 10)); D.av = 0;
      D.alpha = Math.max(0, D.alpha - dt / (touchMode ? .26 : .22));
      if (D.alpha <= 0) { D.ap = 0; D.av = 0; }
    }
  }

  /* ---------- рыбы ---------- */
  var FISH = { 1:[196,16],2:[155,20],3:[168,18],4:[78,30],5:[62,30],6:[180,22],7:[91,20],8:[176,12],9:[128,18],10:[137,16],11:[200,13],12:[165,15],13:[300,8],14:[172,19],15:[148,21],16:[62,18],17:[54,20],18:[66,16],19:[58,34],20:[50,38],21:[64,32],22:[280,9] };
  var KIND = { 1:'carp',2:'carp',3:'carp',4:'carp',5:'carp',6:'carp',7:'carp',8:'carp',9:'carp',10:'carp',22:'carp',11:'pike',12:'pike',13:'pike',14:'sazan',15:'sazan',16:'crucian',17:'crucian',18:'crucian',19:'roach',20:'roach',21:'roach' };
  /* Скорости считаются в длинах тела в секунду (дл/с). SPEED_MUL — общий множитель скорости рыб:
     при 1 бриф такой: cruise .4-.8, dash 3-4, glide .05-.15 дл/с; угловые скорости и частота виляния привязаны к нему же. */
  var SPEED_MUL = 2;
  var HESITATE = .35;   // во сколько раз рыба притормаживает, оказавшись в капле до того, как испугается
  /* KP: cr/dp/gl = [мин, макс] дл/с для спокойного хода / пика рывка / glide; ut = скорость U-turn (дл/с);
     dl = задержка реакции на каплю (с); fm = сила отталкивания; ret = ускорение после испуга; wg = вилянье курса (рад); modes = веса режимов */
  var KP = {
    carp:  { cr: [.40, .55], dp: [3.0, 3.6], gl: [.05, .12], ut: 1.1, dl: [1.1, 1.9],  fm: 1,    ret: 1.2, wg: .25, modes: { cruise: 3, glide: 3, uturn: 2, dash: .5 } },
    sazan: { cr: [.45, .60], dp: [3.0, 3.6], gl: [.05, .12], ut: 1.1, dl: [1.1, 1.8], fm: 1.1,  ret: 1.2, wg: .25, modes: { cruise: 3, glide: 3.5, uturn: 1.5, dash: .6 } },
    pike:  { cr: [.50, .70], dp: [3.5, 4.0], gl: [.05, .10], ut: 1.3, dl: [1, 1.8],   fm: 1.35, ret: 1.3, wg: .12, modes: { ambush: 4, dash: 2, cruise: 1.4, uturn: 1, glide: .8 } },
    crucian: { cr: [.40, .55], dp: [3.0, 3.5], gl: [.08, .15], ut: 1.1, dl: [.8, 1.4], fm: .9,   ret: 1.2, wg: .28, modes: { glide: 3, cruise: 3, uturn: 1.5, zigzag: 1.2 } },
    roach: { cr: [.60, .80], dp: [3.0, 3.8], gl: [.08, .15], ut: 1.3, dl: [.8, 1.4],   fm: 1.4,  ret: 1.3, wg: .22, modes: { school: 4, zigzag: 2, dash: 1.4, cruise: 1 } }
  };
  var SETS = {
    desk: [1,2,6,7,9,10,22,11,12,13,14,15,16,17,18,19,20,21],
    tab: [1,6,9,22,11,13,14,15,16,17,18,19,20,21],
    phone: [1,6,22,11,13,14,16,17,19,20]
  };
  var WATER_TINT = ['rgba(24,56,76,.12)', 'rgba(34,66,92,.32)', 'rgba(58,92,126,.56)'];   // ближние чище, дальние бледнее и синее (толща воды, дымка)

  /* ---------- перспектива: камера на берегу, горизонт на ~53% кадра, вода уходит вглубь кадра ----------
     Рыба живёт на плоскости воды: курс и цели считаются в «мировых» координатах (x, y / VK),
     по экрану вертикаль сжата в VK раз. Масштаб растёт от S_FAR у дальней воды до S_NEAR у нижнего края. */
  var VK = .30, S_FAR = .36, S_NEAR = 1.06, TILT_MAX = .26;   // TILT_MAX = 15 град
  function fishTop() { var wt = waterTop(); return wt + Math.max(16, (H - wt) * .035); }   // выше береговой линии рыбе нельзя
  function depthAt(y) { var t = fishTop(); return clamp((y - t) / Math.max(1, H - t), 0, 1); }   // 0 дальняя вода, 1 нижний край
  function perspS(d) { return lerp(S_FAR, S_NEAR, d) * (W < 600 ? .6 : 1); }
  function wAng(ax, ay, bx, by) { return Math.atan2((by - ay) / VK, bx - ax); }
  function wDist(ax, ay, bx, by) { return Math.hypot(bx - ax, (by - ay) / VK); }
  /* слева внизу трава и камыш: левая граница воды для рыб. Задана в координатах картинки 1280x872 (трава: x<90 при y 650, x<250 при y 780) */
  function minX(y) {
    var yi = (y - imgTop) / imgScale;
    if (yi < 610) return 0;
    return Math.max(0, imgLeft + Math.min(255, (yi - 610) * 1.5) * imgScale);
  }
  var sprites = {}, fishList = [], fishSorted = [], fishSetKey = '', spritesRequested = false, underLoaded = false;

  /* base: уже растеризованный спрайт w x h (SVG рисуется один раз, варианты копируются с него 1:1) */
  function tinted(base, w, h, fill, blurDiv) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(base, 0, 0);
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
  function buildSprite(id, img) {
    var len = FISH[id][0];
    var d = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(8, Math.round(len * d * 1.1));
    var nw = img.naturalWidth || 180, nh = img.naturalHeight || 100;
    var h = Math.max(4, Math.round(w * nh / nw));
    var base = document.createElement('canvas');
    base.width = w; base.height = h;
    var bx = base.getContext('2d');
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(img, 0, 0, w, h);
    sprites[id] = {
      v: [tinted(base, w, h, WATER_TINT[0], 1), tinted(base, w, h, WATER_TINT[1], 2), tinted(base, w, h, WATER_TINT[2], 3)],
      shadow: tinted(base, w, h, 'rgb(2,10,18)', 3),
      aspect: nh / nw, len: len
    };
  }
  /* спрайты собираются по одному за свободный слот, чтобы не давать long task на загрузке */
  var spriteQueue = [], spriteBusy = false;
  function pumpSprites() {
    if (spriteBusy || !spriteQueue.length) return;
    spriteBusy = true;
    whenIdle(function () {
      spriteBusy = false;
      var q = spriteQueue.shift();
      if (q) buildSprite(q.id, q.img);
      pumpSprites();
    }, 400);
  }
  function loadSprite(id) {
    if (sprites[id] !== undefined) return;
    sprites[id] = null;
    var img = new Image();
    img.onload = function () { spriteQueue.push({ id: id, img: img }); pumpSprites(); };
    img.src = 'img/fish/fish-' + pad2(id) + '.svg';
  }

  var school = { gx: 0, gy: 0, t: 0, burst: 0 };
  function pickGoal(f, top, bot, away) {
    var mx = Math.max(60, W * .06), lo = top + 24, hi = bot - 30;
    if (f.k === KP.roach || f.k === KP.crucian) { if (W < 600) hi = Math.min(hi, top + (bot - top) * .5); }
    if (hi < lo + 10) hi = lo + 10;
    if (f.tier === undefined || Math.random() < .45) f.tier = Math.pow(Math.random(), 1.5);   // дальних (мелких) больше, ближних меньше
    var gx = f.x, gy = f.y;
    for (var n = 0; n < 6; n++) {
      gx = mx + Math.random() * Math.max(10, W - 2 * mx);
      gy = lo + f.tier * (hi - lo) + (Math.random() - .5) * 40;
      gy = f.y + clamp(gy - f.y, -Math.max(24, .22 * Math.abs(gx - f.x)), Math.max(24, .22 * Math.abs(gx - f.x)));   // по экрану в основном вдоль берега
      gy = clamp(gy, lo, hi);
      gx = Math.max(gx, minX(gy) + 60);
      if (Math.hypot(gx - f.x, gy - f.y) > (away || Math.min(300, W * .25))) break;
    }
    return { x: gx, y: clamp(gy, lo, hi) };
  }

  /* ближняя цель на 1.5-5 длин тела впереди (в пределах воды); avoid: не вести к капле */
  function pickNear(f, top, bot, avoid) {
    var L = f.Lb || 100, mx = Math.max(60, W * .06), lo = top + 24, hi = bot - 30;
    if ((f.k === KP.roach || f.k === KP.crucian) && W < 600) hi = Math.min(hi, top + (bot - top) * .5);
    if (hi < lo + 10) hi = lo + 10;
    var ar = R * Math.max(D.ap, .6) * 1.5;
    for (var n = 0; n < 12; n++) {
      var a = f.heading + (Math.random() - .5) * 2.6, r = Math.min(rr(1.5, 5) * L, W * .6);
      var gx = f.x + Math.cos(a) * r, gy = f.y + Math.sin(a) * r * VK;
      if (gx < Math.max(mx, minX(gy) + .5 * L) || gx > W - mx || gy < lo || gy > hi) continue;
      if (avoid && Math.hypot(gx - D.x, gy - D.y) < ar) continue;
      return { x: gx, y: gy };
    }
    var ca = wAng(f.x, f.y, W / 2, (lo + hi) / 2) + (Math.random() - .5) * .8, cr = rr(1.5, 3) * L, fy = clamp(f.y + Math.sin(ca) * cr * VK, lo, hi);
    return { x: clamp(f.x + Math.cos(ca) * cr, Math.max(mx, minX(fy) + .5 * L), W - mx), y: fy };
  }

  /* ---------- поведенческие режимы ---------- */
  var MODE_DUR = { cruise: [3, 8], glide: [3, 6], zigzag: [3, 6], ambush: [3, 8], school: [6, 12], dash: [1.8, 2.6], uturn: [9, 9] };
  var fishActive = 0;
  function isActive(m) { return m === 'dash' || m === 'uturn'; }
  function rr(a, b) { return a + Math.random() * (b - a); }

  function nextMode(f) {
    if (f.force) { var fm = f.force; f.force = null; return fm; }
    var w = f.k.modes;
    /* после рывка или разворота плавно уходим в спокойный ход */
    if (f.mode === 'dash' || f.mode === 'uturn') return (w.glide && Math.random() < .3) ? 'glide' : (w.school ? 'school' : 'cruise');
    var lim = fishActive >= Math.max(1, Math.round(fishList.length * .25)), tot = 0, c = [], key;
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
    var mx = Math.max(50, W * .05), lo = fishTop() + 10, hi = waterBot() - 40;
    for (var n = 0; n < 12; n++) {
      var h = base + (Math.random() - .5) * spread;
      var ex = f.x + Math.cos(h) * len, ey = f.y + Math.sin(h) * len * VK;
      if (ex > Math.max(mx, minX(ey) + .3 * (f.Lb || 100)) && ex < W - mx && ey > lo && ey < hi) return h;
    }
    return wAng(f.x, f.y, W / 2, (lo + hi) / 2) + (Math.random() - .5) * .5;
  }
  function setMode(f, m) {
    if (isActive(f.mode)) fishActive--;
    var k = f.k, L = f.Lb, d = MODE_DUR[m] || [4, 8];
    f.mode = m; f.mt = f.mt0 = rr(d[0], d[1]); f.ph = 0;
    if (isActive(m)) fishActive++;
    f.cs = rr(k.cr[0], k.cr[1]) * SPEED_MUL;   // спокойная скорость, дл/с
    if (m === 'dash') {
      f.dk = rr(k.dp[0], k.dp[1]) * SPEED_MUL * (f.dmk || 1); f.dmk = 0;
      f.dd = rr(.4, .8);   // длительность самого рывка
      f.dh = safeHeading(f, L * (f.dk * f.dd * .6 + 1), f.heading, Math.random() < .25 ? 6.28 : 2.0);
    } else if (m === 'uturn') {
      var vU = k.ut * SPEED_MUL, rad = rr(.9, 1.2) * L;   // дуга радиусом ~ длина тела
      f.us = vU; f.tw = vU * L / rad; f.pt = rr(.7, 1.5);
      f.dh = safeHeading(f, L * (vU * f.pt + 2.5) , f.heading, 1.0);
      var perp = f.dh + Math.PI / 2, px = f.x + Math.cos(perp) * rad, py = f.y + Math.sin(perp) * rad * VK;
      var ok = px > Math.max(50, minX(py) + .3 * L) && px < W - 50 && py > fishTop() + 10 && py < waterBot() - 40;
      f.tdir = ok ? 1 : -1;
      f.tamt = rr(2.7, 3.5);
    } else if (m === 'glide') {
      f.gs = rr(k.gl[0], k.gl[1]) * SPEED_MUL;
      f.hTarget = f.heading + (Math.random() - .5) * 1.0; f.g2 = false;
    } else if (m === 'zigzag') {
      f.zb = f.heading; f.zs = Math.random() < .5 ? -1 : 1; f.zt = rr(.9, 1.6);
      if (!f.home || wDist(f.x, f.y, f.home.x, f.home.y) < 1.5 * L) f.home = pickNear(f, fishTop(), waterBot());
    } else if (m === 'ambush') {
      f.hTarget = f.heading + (Math.random() - .5) * .8; f.dmk = 1.2; f.force = 'dash';
    } else if (m === 'cruise') {
      f.gt = rr(4, 10);
      if (!f.home || wDist(f.x, f.y, f.home.x, f.home.y) < .6 * L) f.home = pickNear(f, fishTop(), waterBot());
    }
  }

  function makeFish() {
    var key = W >= 1024 ? 'desk' : W >= 600 ? 'tab' : 'phone';
    if (key === fishSetKey) return;
    fishSetKey = key;
    var ids = SETS[key];
    if (spritesRequested) ids.forEach(loadSprite);
    var top = fishTop(), bot = H - 10;
    var order = ids.slice().sort(function () { return Math.random() - .5; });
    var schoolX = (.15 + Math.random() * .6) * W, schoolY = top + 30 + Math.random() * Math.max(10, (bot - top) * .4);
    fishActive = 0;
    fishList = ids.map(function (id) {
      var slot = order.indexOf(id);
      var hx = (slot + 0.15 + Math.random() * 0.7) / ids.length * W;
      var hy = top + 12 + Math.pow(Math.random(), 1.5) * Math.max(10, bot - top - 40);   // дальних больше
      var kp = KP[KIND[id]];
      var kind = KIND[id];
      if (kind === 'roach') { hx = schoolX + (id - 19) * 0.035 * W + Math.random() * 0.02 * W; hy = schoolY + (Math.random() - .5) * 50; }
      if (kind === 'roach' || kind === 'crucian') { hy = Math.min(hy, W < 600 ? top + (bot - top) * .5 : bot); }
      hx = Math.max(hx, minX(hy) + 90);
      var fc = Math.random() < .5 ? -1 : 1;
      return {
        k: kp, id: id, seed: Math.random() * 100,
        home: { x: hx, y: hy }, x: hx, y: hy,
        heading: fc < 0 ? Math.PI + (Math.random() - .5) * 1.4 : (Math.random() - .5) * 1.4, ang: 0, hv: 0, face: fc, faceT: fc, tilt: 0, sx: fc, vs: 1, hTarget: 0, hRate: 1,
        kx: 0, ky: 0, boost: 1, inT: 0, outT: 99, delay: rr(kp.dl[0], kp.dl[1]),
        returning: false, fleeing: false, fleeT: 0, fk: 0, fh: 0, phase: Math.random() * 6.28, fq: 1, speed: 0, hov: 0, hovT: 0, s: 1, depth: 0, Lb: 100,
        mode: 'cruise', mt: 0, mt0: 1, ph: 0, sp: 0, cs: 1, gs: .2, gt: 5, bend: 0, sw: 0, lat: 0, sq: 1, sgx: 0, sgy: 0, lag: Math.random() * .5
      };
    });
    fishList.forEach(function (f) {
      f.ang = 0; f.flip = f.face < 0; f.tier = undefined;
      f.off = { x: (f.id - 19) * 45 + (Math.random() - .5) * 20, y: (Math.random() - .5) * 30 };
      f.depth = depthAt(f.y); f.s = perspS(f.depth); f.vs = lerp(.72, 1, f.depth);
      f.Lb = FISH[f.id][0] * f.s;
      if (KIND[f.id] !== 'roach') f.home = pickGoal(f, top, bot, 0);
      f.sgx = schoolX; f.sgy = schoolY;
      f.mode = 'cruise';
      setMode(f, nextMode(f));
      f.sp = f.cs * f.Lb * (f.mode === 'glide' ? .3 : 1);
      f.mt = rr(.5, f.mt0);   // не все в одном режиме и в одной фазе
    });
    school.gx = schoolX; school.gy = schoolY; school.t = 6 + Math.random() * 6;
    fishSorted = fishList.slice();
  }

  function updateFish(now, dt) {
    var t = now / 1000;
    dt = Math.min(dt, .05);
    var top = fishTop(), bot = Math.min(waterBot(), H - 16);   // ближняя рыба не уходит за нижний край
    var F = (touchMode ? 600 : 780) * .4;
    var vMul = touchMode ? 0.9 : 1;
    var fr = Math.pow(0.95, dt * 60);   // трение толчка
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
      var depth = depthAt(f.y);
      var s = perspS(depth);
      f.s = s;
      var L = FISH[f.id][0] * s; f.Lb = L;   // длина тела на экране, px

      var dx = f.x - D.x, dy = f.y - D.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var inZone = zoneOn && d < 1.1 * Req;
      var wasFleeing = f.fleeing, pushing = false;

      if (inZone) {
        f.outT = 0; f.inT += dt;
        if (f.inT >= f.delay) {
          var w = 1 - d / (1.1 * Req); w = w * w;
          var nx, ny;
          if (d > 0.001) { nx = dx / d; ny = dy / d; } else { nx = Math.cos(f.heading); ny = Math.sin(f.heading); }
          f.kx += nx * F * fear * k.fm * w * dt;
          f.ky += ny * F * fear * k.fm * w * dt * .6;   // вглубь кадра отталкивание слабее
          f.fh = Math.atan2(ny / VK, nx);   // курс на плоскости воды, чтобы на экране уйти по направлению (nx, ny)
          if (!f.fleeing) {   // испуг: dash прочь от капли
            f.fleeing = true; f.fleeT = rr(.45, .8);
            f.fk = rr(k.dp[0], k.dp[1]) * SPEED_MUL * (.6 + .4 * fear);
            f.delay = rr(k.dl[0], k.dl[1]);
          }
          f.fleeT = Math.max(f.fleeT, .3);
          f.boost = k.ret; f.returning = false; pushing = true;
        }
      } else { f.inT = 0; f.outT += dt; }

      f.kx *= fr; f.ky *= fr;
      var km = Math.sqrt(f.kx * f.kx + f.ky * f.ky), cap = 1.2 * SPEED_MUL * L;
      if (km > cap) { f.kx *= cap / km; f.ky *= cap / km; }
      if (f.fleeing && !pushing) { f.fleeT -= dt; if (f.fleeT <= 0) f.fleeing = false; }
      if (!inZone && f.boost > 1) f.boost = Math.max(1, f.boost - dt * (k.ret - 1) / 2.5);

      var spT = f.cs, acc = 1.3, rate = .7 * SPEED_MUL;   // рад/с: cruise 40 град/с при SPEED_MUL=1
      var m = f.fleeing ? 'flee' : f.mode;
      if (!f.fleeing) {
        if (wasFleeing) { setMode(f, 'cruise'); f.mt = rr(3, 5); f.home = pickNear(f, top, bot, true); }
        f.mt -= dt;
        m = f.mode;
      }
      if (m === 'flee') {
        f.hTarget = f.fh; rate = 1.57 * SPEED_MUL; acc = 7; f.sq = 1;
        spT = lerp(f.cs, f.fk, clamp(f.fleeT / .35, 0, 1));
      } else if (m === 'cruise') {
        f.gt -= dt;
        if (wDist(f.x, f.y, f.home.x, f.home.y) < .5 * L || f.gt <= 0) { f.home = pickNear(f, top, bot); f.gt = rr(4, 10); }
        f.hTarget = wAng(f.x, f.y, f.home.x, f.home.y) + (Math.sin(t * .5 + f.seed) + Math.sin(t * .23 + f.seed * 2) * .6) * k.wg * .4;
        spT = f.cs; acc = 1.3;
      } else if (m === 'dash') {
        f.hTarget = f.dh; rate = 1.57 * SPEED_MUL * .8;
        var e = f.mt0 - f.mt;
        if (e < f.dd) { spT = f.cs + (f.dk - f.cs) * Math.sin(Math.PI * e / f.dd); acc = 6; }   // плавный разгон и торможение
        else { spT = f.cs * .5; acc = 2.2; }
      } else if (m === 'uturn') {
        if (f.ph === 0) {
          f.hTarget = f.dh; spT = f.us; acc = 2; f.pt -= dt;
          if (f.pt <= 0) { f.ph = 1; f.tleft = f.tamt; }
        } else if (f.ph === 1) {
          spT = f.us; acc = 3; rate = f.tw;
          f.hTarget = f.heading;
          var pr = 1 - f.tleft / f.tamt;
          f.sq = 1 - .06 * Math.sin(Math.PI * pr);
          if (f.tleft <= 0) { f.ph = 2; f.pt = rr(.8, 1.6); f.dh = f.heading; f.sq = 1; }
        } else {
          f.hTarget = f.dh; spT = f.us * .8; acc = 2; f.pt -= dt;
          if (f.pt <= 0) f.mt = 0;
        }
      } else if (m === 'glide') {
        spT = f.gs; acc = 1.2; rate = .15 * SPEED_MUL;
        if (f.mt < f.mt0 * .5 && !f.g2) { f.g2 = true; f.hTarget = f.heading + (Math.random() - .5) * .8; }
      } else if (m === 'zigzag') {
        f.zt -= dt;
        if (f.zt <= 0) { f.zs = -f.zs; f.zt = rr(.9, 1.6); }
        f.zb = turnToward(f.zb, wAng(f.x, f.y, f.home.x, f.home.y), .5 * SPEED_MUL * dt);
        if (wDist(f.x, f.y, f.home.x, f.home.y) < 1.2 * L) f.home = pickNear(f, top, bot);
        f.hTarget = f.zb + f.zs * .5; spT = f.cs * 1.15; acc = 2; rate = 1.0 * SPEED_MUL;
      } else if (m === 'ambush') {
        spT = .03; acc = 1.5; rate = .3 * SPEED_MUL;
      } else if (m === 'school') {
        var mxs = Math.max(60, W * .06), kk = 1 - Math.exp(-dt / (.2 + f.lag));
        f.sgx += (school.gx - f.sgx) * kk; f.sgy += (school.gy - f.sgy) * kk;   // каждая видит курс стаи с запаздыванием
        f.home.y = clamp(f.sgy + f.off.y, top + 12, bot - 30); f.home.x = clamp(f.sgx + f.off.x, Math.max(mxs, minX(f.home.y) + .5 * L), W - mxs);
        var hd = wDist(f.x, f.y, f.home.x, f.home.y);
        f.hTarget = wAng(f.x, f.y, f.home.x, f.home.y) + Math.sin(t * .7 + f.seed) * .1;
        spT = f.cs * (hd > 3 * L ? 1.5 : hd > 1.2 * L ? 1.15 : .75) * (school.burst > 0 ? 1.5 : 1); acc = 1.8; rate = .9 * SPEED_MUL;
      }

      if (inZone && !f.fleeing && m !== 'dash') { spT *= HESITATE; acc = Math.max(acc, 2.5); }   // заметила каплю: замедляется, потом уходит
      /* мягкие границы: заранее заворачиваем внутрь, пропорционально длине тела */
      var uT = (m === 'uturn' && f.ph === 1);
      var em = Math.min(W * .2, Math.max(80, W * .07, L * 1.3)), emy = clamp(L * .7, 60, (bot - top) * .28), rx = 0, ry = 0;
      var lx = minX(f.y);   // слева внизу трава: левая граница зависит от глубины
      if (f.x < lx + em) rx = Math.min(1.5, 1 - (f.x - lx) / em); else if (f.x > W - em) rx = -(1 - (W - f.x) / em);
      if (f.y < top + emy) ry = 1 - (f.y - top) / emy; else if (f.y > bot - emy) ry = -(1 - (bot - f.y) / emy);
      var rs = Math.min(1, Math.hypot(rx, ry));
      if (rs > 0 && !uT) {
        var inw = Math.atan2(ry / VK, rx);
        f.hTarget = f.hTarget + angDiff(f.hTarget, inw) * Math.min(1, rs * 1.6);
        rate = Math.min(Math.max(rate, .7 * SPEED_MUL) * (1 + rs * .8), Math.max(rate, 1.2 * SPEED_MUL));
        if (m === 'uturn' || m === 'dash') f.dh = f.hTarget;
      }

      /* курс: ограниченная угловая скорость, сама угловая скорость сглаживается */
      var want;
      if (uT) want = f.tdir * f.tw;
      else want = clamp(angDiff(f.heading, f.hTarget) * 2.2, -rate, rate);
      f.hv += (want - f.hv) * (1 - Math.exp(-dt * (m === 'flee' ? 9 : 4)));
      f.heading += f.hv * dt;
      if (uT) { f.tleft -= Math.abs(f.hv) * dt; }
      if (f.mode !== 'uturn' || f.fleeing) f.sq += (1 - f.sq) * Math.min(1, dt * 6);
      if (!f.fleeing && f.mt <= 0) setMode(f, nextMode(f));
      f.hRate = rate;

      f.sp += (spT * L * vMul * f.boost - f.sp) * (1 - Math.exp(-acc * dt));
      var vx = Math.cos(f.heading) * f.sp + f.kx;
      var vy = Math.sin(f.heading) * f.sp * VK + f.ky;   // вглубь кадра вертикаль экрана сжата
      if (f.mode === 'glide' && !f.fleeing) vy += Math.sin(t * 1.3 + f.seed) * 3 * s;
      f.x += vx * dt; f.y += vy * dt;
      f.x = clamp(f.x, -30, W + 30);
      f.y = clamp(f.y, top, bot);
      var lxm = minX(f.y) + .3 * L;
      if (lxm > .3 * L && f.x < lxm) f.x = lxm;

      var spd = Math.sqrt(vx * vx + vy * vy);
      f.speed = spd;
      /* рыба всегда боком к камере: смотрит влево или вправо, наклон не больше TILT_MAX, у поворота корпус сужается */
      if (spd > 2) {
        if (vx > .15 * spd) f.faceT = 1; else if (vx < -.15 * spd) f.faceT = -1;
        var tl = clamp(Math.atan2(vy, Math.abs(vx) + .001), -TILT_MAX, TILT_MAX);
        f.tilt += (tl - f.tilt) * (1 - Math.exp(-dt * 6));
      }
      f.face += clamp(f.faceT - f.face, -dt * 5, dt * 5);
      f.flip = f.face < 0;
      f.ang = f.flip ? -f.tilt : f.tilt;
      f.sx = (f.flip ? -1 : 1) * Math.max(.35, Math.abs(f.face)) * (.62 + .38 * Math.abs(Math.cos(f.heading)));
      f.vs = lerp(.72, 1, depth);   // дальних слегка сплющиваем по вертикали

      /* виляние: частота следует за скоростью (glide ~0.4 Гц, cruise ~1-1.6, dash до 3); тело лишь слегка покачивается, изгибается хвост */
      var bl = spd / Math.max(30, L), sn = clamp(bl / (3 * SPEED_MUL), 0, 1);
      var fT = clamp(.25 + .85 * bl, .3, 3.2);
      f.fq += (fT - f.fq) * (1 - Math.exp(-dt * 2.5));
      f.phase += Math.PI * 2 * f.fq * dt;
      f.bend = (.10 + .08 * sn) * Math.sin(f.phase - 1.2);   // хвостовая половина +-6..10 град
      f.sw = (.035 + .015 * sn) * Math.cos(f.phase);        // корпус +-2..3 град
      f.lat = .015 * Math.sin(f.phase);                     // смещение поперёк курса, доля длины
      f.depth = depth;
      f.hov = clamp(f.hov + (f.hovT - f.hov) * Math.min(1, dt / 0.15), 0, 1);
    }
  }

  /* рыба из двух половин: хвостовая часть чуть поворачивается (изгиб хвоста), голова вправо */
  function drawFishImg(c, img, w, h, bend) {
    var iw = img.width, ih = img.height;
    if (Math.abs(bend) < .004) { c.drawImage(img, -w / 2, -h / 2, w, h); return; }
    var cut = Math.round(iw * .34), dw = cut / iw * w, px = -w / 2 + dw;
    c.drawImage(img, cut, 0, iw - cut, ih, px, -h / 2, w - dw, h);
    c.save(); c.translate(px, 0); c.rotate(bend);
    c.drawImage(img, 0, 0, cut, ih, -dw, -h / 2, dw + .6, h);
    c.restore();
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
        var hw = sp.len * f.s / 2 + pd, hh = Math.max(12, sp.len * f.s * sp.aspect * f.vs / 2) + pd;
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
      var arr = fishSorted;   // порядок по глубине: сортировка вставками на месте (массив почти упорядочен)
      for (var si = 1; si < arr.length; si++) {
        var sf = arr[si], sj = si - 1;
        while (sj >= 0 && arr[sj].y > sf.y) { arr[sj + 1] = arr[sj]; sj--; }
        arr[sj + 1] = sf;
      }
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
        ictx.translate(x + 10 * f.depth - Math.sin(f.ang) * f.lat * w, y + 18 * f.depth * f.s + Math.cos(f.ang) * f.lat * w);
        ictx.scale(1, f.vs);
        ictx.rotate(f.ang + f.sw);
        ictx.scale(f.sx * f.sq, 1); /* влево: отражаем по горизонтали, спина остаётся сверху */
        ictx.globalAlpha = .12 + .20 * f.depth;
        drawFishImg(ictx, sp.shadow, w, h, f.bend);
        ictx.restore();
      }
      for (i = 0; i < arr.length; i++) {
        f = arr[i]; sp = sprites[f.id];
        if (!sp) continue;
        x = f.x - D.ox; y = f.y - D.oy;
        if (x < -120 || y < -120 || x > CSSZ + 120 || y > CSSZ + 120) continue;
        w = sp.len * f.s; h = w * sp.aspect;
        var a = clamp(lerp(.5, .96, Math.pow(f.depth, .8)) + f.hov * .15, 0, 1);   // дальние прозрачнее
        ictx.save();
        ictx.translate(x - Math.sin(f.ang) * f.lat * w, y + Math.cos(f.ang) * f.lat * w);
        ictx.scale(1, f.vs);
        ictx.rotate(f.ang + f.sw);
        ictx.scale(f.sx * f.sq, 1);
        var t, vA, vB;
        if (f.depth < .5) { t = f.depth / .5; vA = sp.v[2]; vB = sp.v[1]; }
        else { t = (f.depth - .5) / .5; vA = sp.v[1]; vB = sp.v[0]; }
        ictx.globalAlpha = a * (1 - t);
        drawFishImg(ictx, vA, w, h, f.bend);
        ictx.globalAlpha = a * t;
        drawFishImg(ictx, vB, w, h, f.bend);
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
    /* вьюпорт и uDpr берём у фактического буфера канваса: видимый размер линзы не зависит от DPR и кэпа */
    var bw = gl.drawingBufferWidth || dropCv.width, bh = gl.drawingBufferHeight || dropCv.height;
    if (bw !== glBW || bh !== glBH) { glBW = bw; glBH = bh; gl.viewport(0, 0, bw, bh); gl.uniform1f(glU.uDpr, bw / CSSZ); }
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

  var fpsN = 0, fpsT = 0, fpsDone = false, fpsStage = 0, frameN = 0, needRender = true;
  function drawDrop(now, dt) {
    if (D.alpha <= 0.002 && !D.visible) { dropCv.style.opacity = '0'; dropCv.style.visibility = 'hidden'; return; }
    D.ox = Math.round((D.x - HALF) * dpr) / dpr; D.oy = Math.round((D.y - HALF) * dpr) / dpr;
    dropCv.style.visibility = 'visible';
    dropCv.style.opacity = String(D.alpha);
    dropCv.style.transform = 'translate3d(' + D.ox + 'px,' + D.oy + 'px,0)';
    /* телефон: в drift/rest содержимое линзы рисуем через кадр (~30 fps), transform обновляется каждый кадр */
    frameN++;
    var skip = phone && (mode === 'drift' || mode === 'rest') && D.k === 0 && D.ap > .99 && !needRender && (frameN & 1);
    if (!skip) {
      needRender = false;
      drawInner(now);
      if (renderMode === 'gl') {
        gl.uniform1f(glU.uSpecA, introPatrol ? .90 + .10 * Math.sin((now - patrolStart) / 3200 * Math.PI) : .90);
        renderGL();
      } else render2D();
    }
    if (!fpsDone) {
      if (dt > .25) return;
      fpsN++; fpsT += dt;
      if (fpsT > 3) {
        var fps = fpsN / fpsT;
        if (phone) {
          /* fps<30: качество вдвое ниже; после этого ещё 3 с fps<22 - линза выключается до перезагрузки */
          if (fpsStage === 0 && fps < 30 && qualMul > .5) { qualMul = .5; sizeDrop(); fpsStage = 1; fpsN = 0; fpsT = 0; return; }
          fpsDone = true;
          if (fps < 22 && (fpsStage === 1 || qualMul <= .5)) { lensKilled = true; disable(); }
        } else {
          fpsDone = true;
          if (fps < 30 && qualMul > .5 && renderMode === 'gl') { qualMul = .5; sizeDrop(); }
        }
      }
    }
  }

  /* ---------- главный цикл ---------- */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var raw = (now - last) / 1000;
    var dt = Math.min(.05, raw);
    last = now;
    if (dt <= 0) return;
    if (phone && busy) return;   // идёт переход сцен: кадр не рендерим, позицию не двигаем
    updateDrop(now, dt);
    var hovered = null;
    if (ptr.in && mode === 'follow' && ptr.type !== 'touch') hovered = hitFish(ptr.x, ptr.y, false);
    for (var i = 0; i < fishList.length; i++) fishList[i].hovT = fishList[i] === hovered ? 1 : 0;
    hero.classList.toggle('fish-hover', !!hovered);
    hero.classList.toggle('drop-on', !touchMode && ptr.in && mode === 'follow' && D.visible);
    if (D.visible || D.alpha > .002) {
      updateFish(now, dt);
      updateSilt(now, dt);
    }
    drawDrop(now, raw);
    if (!D.visible && D.alpha <= .002 && mode === 'off' && !ptr.in && !ptr.down && running) idleSleep();
  }
  /* капли нет, указателя нет: цикл не крутим. Просыпается по pointer/touch или по таймеру ближайшего патруля */
  var sleepTimer = 0;
  function idleSleep() {
    stopLoop();
    if (phone) { sleepTimer = setTimeout(startLoop, 250); return; }   // ждём startAt и ресурсы; в drift/rest сюда не попадаем
    D.still = Math.max(D.still, 2);
    var at = touchMode ? 0 : !firstPatrolDone ? startAt : idleSince + 8000;
    if (at) sleepTimer = setTimeout(startLoop, Math.max(0, at - performance.now()) + 20);
  }
  function startLoop() {
    clearTimeout(sleepTimer);
    if (running || !enabled || !heroOn || document.hidden) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; cancelAnimationFrame(raf); clearTimeout(sleepTimer); }

  /* ---------- загрузка ресурсов эффекта ---------- */
  function loadEffectAssets() {
    if (!enabled || mqRM.matches) return;
    if (!underLoaded) { underLoaded = true; underImg = new Image(); underImg.src = 'img/underwater.webp'; }
    if (!spritesRequested) { spritesRequested = true; if (fishSetKey) SETS[fishSetKey].forEach(loadSprite); }
  }

  function measure() {
    var prevTop = waterTop(), prevBot = waterBot(), prevW = W;
    if (!geom()) return;
    if (!enabled) return;
    if (phone) {
      computeZone();
      if (PH.has) { var pc = clampTarget(PH.bx, PH.by); PH.bx = pc.x; PH.by = pc.y; }
    }
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

  function resetTimers(again) {
    startAt = performance.now() + (phone && again ? (busy ? 750 : 0) + 400 : 1200);   // телефон при возврате на #top: 400 мс после перехода
    idleSince = performance.now();
    mode = 'off'; introPatrol = false; firstPatrolDone = touchMode || introDone;   // на телефоне сам не появляется
    D.visible = false; D.alpha = 0; D.ap = 0; D.av = 0;
  }

  function enable() {
    if (enabled || mqRM.matches) return;
    enabledPhone = phone;
    if (renderMode === 'none') renderMode = initGL() ? 'gl' : '2d';
    if (renderMode === '2d' && !ctx2) { ctx2 = dropCv.getContext('2d'); }
    if (renderMode === '2d' && !ctx2) { return; }
    enabled = true;
    root.classList.add(phone ? 'js-lens' : 'js-fx');
    invalidateRects();
    geom(); if (phone) computeZone(); sizeDrop();
    makeFish(); makeSilt();
    resetTimers();
    if (phone) {
      /* телефон: ресурсы после load, в простое */
      var go = function () { whenIdle(loadEffectAssets, 2500); };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
    } else if (document.readyState === 'complete') loadEffectAssets(); else window.addEventListener('load', loadEffectAssets, { once: true });
    startLoop();
  }
  function disable() {
    enabled = false;
    stopLoop(); clearPend(); releaseLensPointer();
    ptr.down = false; ptr.in = false; tap = null; lensGesture = false; sw = null;
    root.classList.remove('js-fx', 'js-lens');
    hero.classList.remove('drop-on', 'fish-hover');
    mode = 'off'; introPatrol = false; D.visible = false; D.alpha = 0; D.ap = 0; D.av = 0;
    dropCv.style.opacity = '0'; dropCv.style.visibility = 'hidden';
  }
  /* телефон: не включаем при reduced-motion, saveData, слабом устройстве, низкой зоне воды и после просадки fps */
  function lensAllowed() {
    if (mqRM.matches) return false;
    if (!phone) return true;
    if (lensKilled) return false;
    var nc = navigator.connection;
    if ((nc && nc.saveData) || (navigator.deviceMemory && navigator.deviceMemory <= 2)) return false;
    if (!geom()) return false;
    computeZone();
    return zone.ok;
  }
  function syncMotion() {
    var was = phone;
    phone = !desktopMQ.matches;
    if (phone) touchMode = true; else if (was) touchMode = coarseMQ.matches;
    if (enabled && enabledPhone !== phone) disable();
    if (!lensAllowed()) disable(); else enable();
  }

  /* ---------- указатель ---------- */
  function onTarget(e) { return e.target && e.target.closest && e.target.closest('a,button'); }
  /* v5: капля только над водой hero; не над небом, шапкой, заголовком, подписями и кнопками */
  var textEls = [].slice.call(hero.querySelectorAll('h1 .t1, h1 .t2, .eyebrow, .hint, .btn, .link, .hero-tag'));
  var rng = document.createRange();
  function textRects() {
    if (textRectCache && !busy) return textRectCache;
    var out = [];
    for (var i = 0; i < textEls.length; i++) {
      var el = textEls[i];
      if (!el.offsetParent && el.getClientRects().length === 0) continue;
      var r;
      if (el.matches('.btn, .link')) r = el.getBoundingClientRect();
      else { rng.selectNodeContents(el); r = rng.getBoundingClientRect(); }
      if (!r.width || !r.height) continue;
      var top = r.top, bot = r.bottom;
      if (el.tagName === 'SPAN' && el.parentNode.tagName === 'H1') {   // рамка текста выше самих заглавных: берём высоту капители
        var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        top += fs * .27; bot -= fs * .27;
      }
      out.push([r.left - 10, top - 10, r.right + 10, bot + 10, el.classList.contains('hint')]);
    }
    if (!busy) textRectCache = out;
    return out;
  }
  function overText(cx, cy) {
    var a = textRects();
    var hintGone = hero.classList.contains('used');   // подсказка погасла (opacity 0): над ней капля работает
    for (var i = 0; i < a.length; i++) {
      if (a[i][4] && hintGone) continue;
      if (cx >= a[i][0] && cx <= a[i][2] && cy >= a[i][1] && cy <= a[i][3]) return true;
    }
    return false;
  }
  function notWater(e, p) { return p.y < waterTop() || overText(e.clientX, e.clientY); }
  function localXY(e) {
    var rect = heroRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function touchDropY(y) { return y - R - 24; }
  function inLensZone(p) { return p.y >= waterTop(); }
  var tap = null, navPending = false;

  /* тап в любой точке линзы: берём ближайшую рыбу (или условную точку), чтобы переход сработал */
  function lensTarget(px, py) {
    if (D.alpha < .6 || sdDropJS(px, py) >= 0) return null;
    var sx = D.x + (px - D.x) / OPT.mag, sy = D.y + (py - D.y) / OPT.mag, best = null, bd = 1e9;
    for (var i = 0; i < fishList.length; i++) {
      var f = fishList[i], d = Math.hypot(sx - f.x, sy - f.y);
      if (sprites[f.id] && d < bd) { bd = d; best = f; }
    }
    return best || { x: px, y: py, kx: 0, ky: 0, k: { dp: [0], ret: 0 }, fh: 0, fk: 0 };
  }
  function fishGo(f, px, py) {
    if (navPending || busy) return;
    navPending = true;
    var dx = f.x - px, dy = f.y - py, d = Math.hypot(dx, dy) || 1;
    f.kx += dx / d * 420; f.ky += dy / d * 420;
    f.fleeing = true; f.fleeT = .7; f.fh = Math.atan2(dy / VK, dx); f.fk = f.k.dp[0] * SPEED_MUL; f.boost = f.k.ret; f.returning = false;
    var ox = f.x, oy = f.y;
    setTimeout(function () { navPending = false; goTo(1, { push: true, via: 'fish', ox: ox, oy: oy }); }, 140);
  }

  function stopIntro() {
    introDone = true; firstPatrolDone = true;
    if (introPatrol) { introPatrol = false; mode = 'off'; idleSince = performance.now(); hideDrop(); }
  }
  document.addEventListener('pointermove', stopIntro, { once: true, passive: true, capture: true });
  document.addEventListener('pointerdown', stopIntro, { once: true, passive: true, capture: true });
  document.addEventListener('keydown', stopIntro, { once: true });

  hero.addEventListener('pointermove', function (e) {
    if (!enabled || !heroOn || phone) return;
    var p = localXY(e);
    ptr.type = e.pointerType;
    if (e.pointerType === 'touch') {
      if (!ptr.down || e.pointerId !== lensPointer) return;
      ptr.x = p.x; ptr.y = p.y;
      if (tap) {
        if (Math.hypot(e.clientX - tap.cx, e.clientY - tap.cy) >= 10) tap.moved = true;
        if (tap.inside && !tap.moved) return;
      }
      mode = 'follow';
      showDrop(p.x, touchDropY(p.y));
      return;
    }
    if (touchMode) { touchMode = false; measure(); }
    if (onTarget(e) || notWater(e, p)) { ptr.in = false; if (mode === 'follow') { mode = 'off'; idleSince = performance.now(); hideDrop(); } hero.classList.remove('drop-on', 'fish-hover'); return; }
    ptr.in = true; ptr.x = p.x; ptr.y = p.y;
    if (!busy) { mode = 'follow'; hero.classList.add('used'); showDrop(p.x, p.y); startLoop(); }
  });
  hero.addEventListener('pointerleave', function (e) {
    if (!enabled || phone || e.pointerType === 'touch') return;
    ptr.in = false;
    if (mode === 'follow') { mode = 'off'; idleSince = performance.now(); hideDrop(); }
    hero.classList.remove('drop-on', 'fish-hover');
  });
  var pend = null, lensGesture = false, lensPointer = null;
  function clearPend() { if (pend) { clearTimeout(pend.timer); pend = null; } }
  function releaseLensPointer() {
    var id = lensPointer;
    lensPointer = null;
    if (id !== null && hero.hasPointerCapture && hero.hasPointerCapture(id)) hero.releasePointerCapture(id);
  }
  function startLens(cx, cy, inside, pointerId) {
    var rect = heroRect(), p = { x: cx - rect.left, y: cy - rect.top };
    if (!touchMode) { touchMode = true; measure(); }
    ptr.type = 'touch';
    var f = inside ? hitFish(p.x, p.y, true) : null;
    tap = { f: f, inside: inside, t0: performance.now(), cx: cx, cy: cy, px: p.x, py: p.y, moved: false };
    ptr.down = true; ptr.x = p.x; ptr.y = p.y;
    lensPointer = pointerId;
    if (hero.setPointerCapture && pointerId !== undefined) hero.setPointerCapture(pointerId);
    lensGesture = true;
    hero.classList.add('used');
    mode = 'follow';
    if (!inside) showDrop(p.x, touchDropY(p.y));
    startLoop();
  }
  hero.addEventListener('pointerdown', function (e) {
    if (!enabled || phone || !heroOn || e.pointerType !== 'touch' || e.isPrimary === false || lensPointer !== null) return;
    clearPend(); lensGesture = false;
    if (onTarget(e)) return;
    var p = localXY(e);
    var inside = D.visible && D.alpha > .6 && sdDropJS(p.x, p.y) < 0;
    if (!inside && (!inLensZone(p) || notWater(e, p))) return;
    startLens(e.clientX, e.clientY, inside, e.pointerId);
  });
  function touchEnd(e) {
    clearPend();
    if (e.pointerType !== 'touch' || !ptr.down || e.pointerId !== lensPointer) return;
    ptr.down = false;
    var tp = tap; tap = null;
    releaseLensPointer();
    if (e.type !== 'pointerup') {
      mode = 'off'; lensGesture = false; sw = null; hideDrop(); return;
    }
    mode = 'hold'; holdUntil = performance.now() + 3000;
    if (tp && tp.inside && !tp.moved && performance.now() - tp.t0 < 250) {
      var tf = tp.f || lensTarget(tp.px, tp.py); if (tf) fishGo(tf, tp.px, tp.py);
    }
  }
  hero.addEventListener('pointerup', touchEnd);
  hero.addEventListener('pointercancel', touchEnd);
  hero.addEventListener('lostpointercapture', function (e) {
    if (e.pointerId !== lensPointer) return;
    touchEnd({ type: 'pointercancel', pointerType: 'touch', pointerId: e.pointerId });
  });
  /* телефон: один пассивный обработчик тапа по воде (без preventDefault, capture и touch-action); свайп идёт в swipeEnd как обычно */
  var tapDown = null;
  hero.addEventListener('pointerdown', function (e) {
    tapDown = null;
    if (!phone || !enabled || !heroOn || e.pointerType !== 'touch' || e.isPrimary === false) return;
    tapDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), a: !!onTarget(e) };
  }, { passive: true });
  hero.addEventListener('pointerup', function (e) {
    var d = tapDown; tapDown = null;
    if (!d || !phone || e.pointerId !== d.id || d.a || busy) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 10 || performance.now() - d.t >= 300) return;
    var hr = heroRect(), x = e.clientX - hr.left, y = e.clientY - hr.top;
    var rowTop = heroRow ? heroRow.getBoundingClientRect().top - hr.top : H;
    if (y <= waterTop() || y >= rowTop || overText(e.clientX, e.clientY)) return;
    lensTap(x, y);
  }, { passive: true });
  hero.addEventListener('pointercancel', function () { tapDown = null; }, { passive: true });
  hero.addEventListener('click', function (e) {
    if (!enabled || phone || ptr.type === 'touch' || onTarget(e)) return;
    var p = localXY(e);
    if (notWater(e, p)) return;
    var f = hitFish(p.x, p.y, false) || lensTarget(p.x, p.y);
    if (f) fishGo(f, p.x, p.y);
  });

  function onHeroResize() {
    invalidateRects();
    syncMotion();
    if (lensPointer !== null) touchEnd({ type: 'pointercancel', pointerType: 'touch', pointerId: lensPointer });
    measure(); if (enabled) { makeFish(); makeSilt(); } }
  if ('ResizeObserver' in window) new ResizeObserver(onHeroResize).observe(hero);
  else window.addEventListener('resize', onHeroResize);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopLoop(); else startLoop(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(invalidateRects);
  if (mqRM.addEventListener) mqRM.addEventListener('change', syncMotion); else if (mqRM.addListener) mqRM.addListener(syncMotion);
  if (desktopMQ.addEventListener) desktopMQ.addEventListener('change', syncMotion); else if (desktopMQ.addListener) desktopMQ.addListener(syncMotion);

  function heroShown(on) {
    heroOn = on;
    if (on) { if (enabled) { resetTimers(true); firstPatrolDone = true; startLoop(); } }
    else {
      stopLoop(); clearPend(); releaseLensPointer(); lensGesture = false; mode = 'off'; ptr.in = false; ptr.down = false; tap = null;
      D.visible = false; D.alpha = 0; D.ap = 0; D.av = 0;
      dropCv.style.opacity = '0'; dropCv.style.visibility = 'hidden';
      hero.classList.remove('drop-on', 'fish-hover');
    }
  }

  /* =====================================================================
     Сцены: менеджер, переходы, ввод
     ===================================================================== */
  var navLinks = [].slice.call(document.querySelectorAll('.scene-nav a'));
  var vLinks = [].slice.call(document.querySelectorAll('.vnav a, .tabbar a'));
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
      if (im.decode) im.decode().then(noop, noop);   // растр готов до перехода в сцену
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
    navLinks.forEach(function (a) {
      if (a.getAttribute('href') === '#' + IDS[i]) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    vLinks.forEach(function (a) {
      if (a.getAttribute('href') === '#' + IDS[i]) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    cur = i;
    root.setAttribute('data-scene', IDS[i]);
    var inn = scenes[i].querySelector('.scene__inner');
    if (inn) inn.scrollTop = 0;
    if (statusEl) statusEl.textContent = STATUS.replace('{n}', i + 1).replace('{total}', scenes.length).replace('{title}', TITLES[i]);
    heroShown(i === 0);
    invalidateRects();
    if (i > 0) prepareScene(i, true);
    if (bgNear) prepareNext();
    scrollState();
    if (IDS[i] === 'photos') updateCount();
  }

  function wait(ms, fn) { return setTimeout(fn, ms); }

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
    hero.classList.add('used');

    var instant = o.instant || mqRM.matches || typeof from.animate !== 'function';
    var after = function () { if (wantFocus || focusBefore) focusHeading(i); };

    if (instant) { setActive(i); after(); return true; }

    /* вертикальный слайд: текущая сцена уезжает вверх, следующая въезжает снизу (назад наоборот); без заливок поверх */
    var dir = i > cur ? 1 : -1;
    var DUR = 720, EZ = 'cubic-bezier(.65,0,.35,1)';
    busy = true;
    root.classList.add('scene-busy');
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
      root.classList.remove('scene-busy');
      busy = false;
      invalidateRects();
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

  /* переход через 1024px (поворот планшета, ресайз): порядок сцен меняется, активная сцена остаётся той же */
  function onOrderChange() {
    var id = IDS[cur];
    applyOrder();
    var i = IDS.indexOf(id);
    if (i >= 0) cur = i;
    if (statusEl) statusEl.textContent = STATUS.replace('{n}', cur + 1).replace('{total}', scenes.length).replace('{title}', TITLES[cur]);
    refreshBgs();
    if (location.hash) { try { history.replaceState({ s: cur }, '', '#' + IDS[cur]); } catch (e) {} }
  }
  if (desktopMQ.addEventListener) desktopMQ.addEventListener('change', onOrderChange); else if (desktopMQ.addListener) desktopMQ.addListener(onOrderChange);

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
    var wasLens = lensGesture; lensGesture = false;
    if (busy || lbOpen || wasLens || e.type === 'touchcancel') return;
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
    else if (k === 'PageUp') { dir = -1; kind = 'page'; }
    else if (k === 'Home') { e.preventDefault(); if (!busy) goTo(0, { push: true, via: 'kbd' }); return; }
    else if (k === 'End') { e.preventDefault(); if (!busy) goTo(scenes.length - 1, { push: true, via: 'kbd' }); return; }
    else if (k === 'Enter') {
      if (!neutral) return;
      e.preventDefault();
      if (!busy && !e.repeat) step(1, 'enter');
      return;
    }
    else return;
    var ksc = scrollerFor(tg, dir) || scrollerFor(scenes[cur].querySelector('.loc__main'), dir) || (canScroll(inn, dir) ? inn : null);
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

  /* фон-фото сцен 1-3: подгрузка по data-bg (на десктопе у «О пруде» свой снимок data-bg-lg), с декодом до показа */
  function photoOf(i) { return scenes[i] && scenes[i].querySelector('.scene__photo'); }
  function bgUrl(el) { return (desktopMQ.matches && el.getAttribute('data-bg-lg')) || el.getAttribute('data-bg'); }
  function loadBg(i) {
    var el = photoOf(i);
    if (!el || el.getAttribute('data-state')) return;
    el.setAttribute('data-state', 'loading');
    var url = bgUrl(el);
    var im = new Image();
    var done = function (ok) {
      if (ok) el.style.backgroundImage = 'url("' + url + '")';
      el.setAttribute('data-url', url);
      el.setAttribute('data-state', 'done');
      el.classList.add('is-loaded');
    };
    im.onerror = function () { done(false); };
    im.src = url;
    if (im.decode) im.decode().then(function () { done(true); }, function () { done(false); });
    else im.onload = function () { done(true); };
  }
  /* карта в «Как добраться»: одна картинка на всех ширинах */
  var mapImg = document.querySelector('.loc__map img[data-src]');
  function loadMap() {
    if (mapImg && !mapImg.getAttribute('src')) mapImg.src = mapImg.getAttribute('data-src');
  }
  /* смена ширины через 1024: у «О пруде» другой снимок */
  function refreshBgs() {
    loadMap();
    scenes.forEach(function (sc, i) {
      var el = photoOf(i);
      if (el && el.getAttribute('data-state') === 'done' && el.getAttribute('data-url') !== bgUrl(el)) { el.removeAttribute('data-state'); loadBg(i); }
    });
  }
  /* следующая сцена готовится в простое: фон, миниатюры галереи, карта, CSS-фоны карточек; остальное не качаем */
  var keepWarm = [];
  function warm(urls, then) {
    Promise.all(urls.map(function (url) {
      return new Promise(function (res) {
        var im = new Image();
        keepWarm.push(im);
        im.src = url;
        if (im.decode) im.decode().then(res, res); else { im.onload = im.onerror = res; }
      });
    })).then(then);
  }
  /* CSS-фоны карточек тарифов (кроме 768-1023, там фото нет) и баннера «Как добраться» (>=1024): класс на html включает url() в CSS */
  function prepareScene(k, now) {
    var id = IDS[k];
    if (!id) return;
    loadBg(k);
    if (id === 'photos') loadThumbs(now ? 12 : 4);
    if (id === 'location') loadMap();
    var cls = id === 'prices' ? 'bg-prices' : id === 'location' ? 'bg-location' : '';
    if (!cls || root.classList.contains(cls)) return;
    var urls = [];
    if (id === 'prices' && !window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches) urls = ['img/gallery/gallery-03.webp', 'img/gallery/gallery-06.webp', 'img/gallery/gallery-04.webp'];
    if (id === 'location' && desktopMQ.matches) urls = ['img/gallery/gallery-09-lg.webp'];
    if (now || !urls.length) root.classList.add(cls);
    else warm(urls, function () { root.classList.add(cls); });
  }
  function prepareNext() {
    whenIdle(function () { prepareScene(cur + 1, false); }, 2500);
  }
  var bgNear = false;
  function loadBgNear() {
    if (bgNear) return;
    bgNear = true;
    prepareNext();
  }
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

  /* параллакс фото убран: из-за сдвигов на доли пикселя фото дрожали */

  /* счётчик ленты: номер карточки по прокрутке (ближайшая к центру ленты; у краёв первая и последняя) */
  var countRaf = 0;
  function updateCount() {
    if (!gCount || !gCards.length) return;
    var gw = gallery.clientWidth, max = gallery.scrollWidth - gw, sl = gallery.scrollLeft, n = 0;
    if (!gw || max <= 2) return;   // на десктопе лента не прокручивается и счётчик скрыт
    if (sl <= 2) n = 0;
    else if (sl >= max - 2) n = gCards.length - 1;
    else {
      var gl = gallery.getBoundingClientRect().left, mid = gw / 2, best = 1e9;
      for (var k = 0; k < gCards.length; k++) {
        var r = gCards[k].getBoundingClientRect(), d = Math.abs(r.left - gl + r.width / 2 - mid);
        if (d < best) { best = d; n = k; }
      }
    }
    gCount.textContent = (n + 1) + ' / ' + TOTAL;
  }
  function queueCount() { if (!countRaf) countRaf = requestAnimationFrame(function () { countRaf = 0; updateCount(); }); }
  if (gCount) {
    gallery.addEventListener('scroll', queueCount, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(queueCount).observe(gallery);
  }

  /* лайтбокс */
  var lb = document.querySelector('.lightbox');
  var lbImg = lb.querySelector('.lb__img');
  var lbAlt = lb.querySelector('.lb__alt');
  var lbCnt = lb.querySelector('.lb__count');
  var lbTpl = lbCnt.getAttribute('data-tpl') || '{n} / {total}';
  var lbIdx = 0, lbWanted = 0, lbAnim = null, lbClosing = false;

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
  function lbCancelAnimation() {
    if (!lbAnim) return;
    lbAnim.onfinish = null;
    try { lbAnim.cancel(); } catch (e) {}
    lbAnim = null;
  }
  function lbGo(dir) {
    if (!lbOpen || lbClosing) return;
    var n = wrap(lbWanted + dir);
    lbWanted = n;
    lbCancelAnimation();
    if (mqRM.matches || typeof lbImg.animate !== 'function') { lbSet(n); return; }
    lbAnim = lbImg.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(' + (-16 * dir) + 'px)' }],
      { duration: 140, easing: 'ease-in', fill: 'forwards' });
    lbAnim.onfinish = function () {
      lbCancelAnimation();
      lbSet(n);
      var a2 = lbImg.animate([{ opacity: 0, transform: 'translateX(' + (16 * dir) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 200, easing: EASE });
      lbAnim = a2;
      a2.onfinish = function () { if (lbAnim === a2) lbAnim = null; };
    };
  }
  function lbOpenAt(i) {
    lbCancelAnimation();
    lbWanted = i;
    lbSet(i);
    lbClosing = false;
    lb.classList.remove('is-closing');
    if (typeof lb.showModal === 'function') lb.showModal(); else lb.setAttribute('open', '');
    lbOpen = true;
    lb.querySelector('.lb__close').focus();
  }
  function lbClose() {
    if (!lbOpen || lbClosing) return;
    lbCancelAnimation();
    lbWanted = lbIdx;
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

  /* управление лайтбоксом: кнопки, фон, стрелки, Esc, свайп; блокировка снимается при любом закрытии */
  lb.querySelector('.lb__prev').addEventListener('click', function (e) { e.stopPropagation(); lbGo(-1); });
  lb.querySelector('.lb__next').addEventListener('click', function (e) { e.stopPropagation(); lbGo(1); });
  lb.querySelector('.lb__close').addEventListener('click', function (e) { e.stopPropagation(); lbClose(); });
  lb.addEventListener('click', function (e) {
    if (e.target === lb || (e.target.classList && e.target.classList.contains('lb__frame'))) lbClose();
  });
  lb.addEventListener('cancel', function (e) { e.preventDefault(); lbClose(); });
  lb.addEventListener('close', function () {
    lbCancelAnimation();
    lbOpen = false; lbClosing = false; lb.classList.remove('is-closing');
    var a = links[lbIdx];
    if (a && document.activeElement !== a) { try { a.focus({ preventScroll: true }); } catch (e) {} }
  });
  document.addEventListener('keydown', function (e) {
    if (!lbOpen) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbGo(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbGo(1); }
    else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); lbClose(); }
  });
  var lbX0 = null;
  lb.addEventListener('touchstart', function (e) { lbX0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (lbX0 === null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - lbX0; lbX0 = null;
    if (Math.abs(dx) > 50) lbGo(dx < 0 ? 1 : -1);
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
