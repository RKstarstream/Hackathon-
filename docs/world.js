/* Tech Tank Hackathon — the 3D scroll journey.
   Scroll position drives one timeline (0..1): the laptop powers on, code runs, the camera dives in,
   then visits a station per topic. Content comes from /api/content and updates live over /api/stream. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeIO = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const pad = (n) => String(n).padStart(2, '0');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = () => innerWidth <= 760;

let C = null;           // content
let participantSignedIn = false;
let P = 0, target = 0;  // journey progress (smoothed, raw)
let hotTrack = -1;

/* Stations: hold windows on the 0..1 timeline. Camera keys line up with these. */
const STATIONS = [
  { id: 'power', label: 'Power on', hold: [0, .02] },
  { id: 'about', label: 'Mission', hold: [.27, .33] },
  { id: 'tracks', label: 'Tracks', hold: [.40, .46] },
  { id: 'twist', label: 'The twist', hold: [.52, .57] },
  { id: 'question', label: 'Question card', hold: [.63, .69] },
  { id: 'schedule', label: 'Timeline', hold: [.75, .80] },
  { id: 'rules', label: 'Rules', hold: [.86, .90] },
  { id: 'register', label: 'Register', hold: [.965, 1] },
];
const KEYS_D = [
  [0, [0, 1.7, 5.4], [0, .45, 0]],
  [.05, [0, 1.8, 5.2], [0, .4, -.2]],
  [.14, [0, 1.7, 4.5], [0, .9, -.8]],
  [.21, [0, 1.35, 2.9], [0, 1.0, -1.1]],
  [.27, [.78, 1.2, 2.5], [.78, 1.07, -1.2]],
  [.33, [.82, 1.2, 2.35], [.78, 1.07, -1.2]],
  [.40, [-4.2, 2.2, 2.7], [1.4, 1.3, -.4]],
  [.46, [-3.9, 2.1, 3.0], [1.4, 1.3, -.4]],
  [.52, [2.5, .42, 1.7], [-.2, 1.0, -1.0]],
  [.57, [2.7, .5, 1.95], [-.2, 1.0, -1.0]],
  [.63, [-1.1, 3.7, 1.3], [-1.1, .3, .3]],
  [.69, [-1.1, 3.45, 1.22], [-1.1, .3, .3]],
  [.75, [3.8, 1.8, -.3], [0, 1.0, -.7]],
  [.80, [3.7, 1.7, -.6], [0, 1.0, -.7]],
  [.86, [-3.3, 1.9, -4.4], [.6, .9, .4]],
  [.90, [-3.1, 1.8, -4.7], [.6, .9, .4]],
  [.965, [0, 2.8, 8.8], [0, 1.0, -.5]],
  [1, [0, 2.9, 9.3], [0, 1.0, -.5]],
];

// Phones: keep the subject centred, since the story panel sits under it instead of beside it.
const KEYS_M = KEYS_D.map((k) => k.map((v) => (Array.isArray(v) ? v.slice() : v)));
KEYS_M[4] = [.27, [0, 1.3, 3.9], [0, 1.0, -1.2]]; KEYS_M[5] = [.33, [0, 1.3, 3.7], [0, 1.0, -1.2]];
KEYS_M[6][2] = [.4, 1.3, -1.5]; KEYS_M[7][2] = [.4, 1.3, -1.5];
KEYS_M[10] = [.63, [.001, 4.2, 1.4], [0, .3, .3]]; KEYS_M[11] = [.69, [.001, 4.0, 1.35], [0, .3, .3]];

/* ======================= 3D STAGE ======================= */
let renderer, scene, camera, three = false;
const W3 = {}; // scene objects
// Draw in logical pixels, upload at 2x so close camera passes retain detail.
const SCR = { w: 1024, h: 640, scale: 2 };

function initStage() {
  if (!window.THREE) return false;
  const T = THREE;
  try {
    renderer = new T.WebGLRenderer({ canvas: $('#world'), antialias: true, powerPreference: 'high-performance' });
  } catch { return false; }
  if (!renderer.getContext()) return false;
  renderer.setClearColor(0x04050a, 1);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.physicallyCorrectLights = false;
  scene = new T.Scene();
  scene.fog = new T.FogExp2(new T.Color(0x04050a).convertSRGBToLinear(), .038);
  camera = new T.PerspectiveCamera(40, 1, .05, 120);

  // floor + light grid that "boots" into a digital world
  const floor = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshStandardMaterial({ color: 0x07090f, roughness: .7, metalness: .55, envMapIntensity: .12 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const gpos = []; const N = 30, S = 1;
  for (let i = -N; i <= N; i++) { gpos.push(-N * S, 0, i * S, N * S, 0, i * S, i * S, 0, -N * S, i * S, 0, N * S); }
  const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(gpos, 3));
  W3.gridMat = new T.LineBasicMaterial({ color: 0x40d6ff, transparent: true, opacity: 0 });
  const grid = new T.LineSegments(gg, W3.gridMat); grid.position.y = .003; scene.add(grid);
  W3.ring = new T.Mesh(new T.RingGeometry(.97, 1, 128), new T.MeshBasicMaterial({ color: 0x40d6ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, side: T.DoubleSide, depthWrite: false }));
  W3.ring.rotation.x = -Math.PI / 2; W3.ring.position.y = .006; scene.add(W3.ring);

  // studio reflections: a dark room with a softbox and two coloured light strips, baked into an env map
  try {
    const env = new T.Scene(); const bm = (c, s) => new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(s), side: T.DoubleSide });
    env.add(new T.Mesh(new T.BoxGeometry(30, 30, 30), bm(0x020306, 1)));
    const panel = (w, h, c, s, x, y, z, rx, ry) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), bm(c, s)); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel(10, 5, 0xffffff, 1.6, 0, 14, 2, Math.PI / 2, 0);      // overhead softbox
    panel(1.2, 14, 0x40d6ff, 2.4, -14, 4, -2, 0, Math.PI / 2);  // cyan strip
    panel(1.2, 14, 0x70b5ce, 2, 14, 4, -2, 0, -Math.PI / 2);  // violet strip
    panel(8, 2.2, 0xffd9b0, .6, 0, 3, 14, 0, Math.PI);         // warm front fill
    panel(14, 1, 0x40d6ff, .8, 0, 1, -14, 0, 0);                 // horizon line behind
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, .02).texture; pm.dispose();
  } catch (e) { /* plain lighting still works */ }

  // lights
  W3.amb = new T.AmbientLight(0x2a3a55, .35); scene.add(W3.amb);
  W3.key = new T.DirectionalLight(0xc8dcff, .55); W3.key.position.set(3, 6, 5); scene.add(W3.key);
  W3.key.castShadow = true;
  const ms = isSmall() ? 1024 : 4096; W3.key.shadow.mapSize.set(ms, ms);
  Object.assign(W3.key.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 1, far: 16 });
  W3.key.shadow.bias = -.0002; W3.key.shadow.normalBias = .008; W3.key.shadow.radius = 2;
  W3.rimA = new T.PointLight(0x40d6ff, 0, 14); W3.rimA.position.set(-4.5, 4.2, -3.5); scene.add(W3.rimA);
  W3.rimB = new T.PointLight(0x70b5ce, 0, 14); W3.rimB.position.set(4.5, 4.2, -3.5); scene.add(W3.rimB);
  W3.red = new T.PointLight(0xff3344, 0, 9); W3.red.position.set(0, 2.2, 1.5); scene.add(W3.red);
  W3.amberL = new T.PointLight(0xffb547, 0, 4); W3.amberL.position.set(0, 1.9, .4); scene.add(W3.amberL);
  W3.screenL = new T.PointLight(0x7fdfff, 0, 2.4, 2); W3.screenL.position.set(0, 1.1, -.4); scene.add(W3.screenL);

  // laptop: a thin, flat "Air" style unibody in smooth midnight aluminium
  const body = new T.MeshStandardMaterial({ color: 0x343f50, metalness: .86, roughness: .27, envMapIntensity: 1.25 });
  const hinge = new T.MeshStandardMaterial({ color: 0x161b24, metalness: .8, roughness: .35, envMapIntensity: 1 });
  const cast = (o, c = true, r = true) => { o.castShadow = c; o.receiveShadow = r; return o; };
  const laptop = new T.Group(); scene.add(laptop); W3.laptop = laptop;
  laptop.add(cast(new T.Mesh(slabGeometry(3, 2, .11, .14, .022), body)));
  // backlight bleeding out from under the keys
  W3.wellMat = new T.MeshBasicMaterial({ map: glowTexture('64,214,255'), color: 0x40d6ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
  const well = new T.Mesh(new T.PlaneGeometry(2.9, 1.25), W3.wellMat); well.rotation.x = -Math.PI / 2; well.position.set(0, .1115, -.45); laptop.add(well);
  // keyboard: function row, number row, wide modifiers and inverted-T arrows, like a real laptop
  W3.keyMat = new T.MeshStandardMaterial({ color: 0x08090c, metalness: .1, roughness: .62, emissive: 0x40d6ff, emissiveIntensity: 0, envMapIntensity: .25, emissiveMap: keyGlowTexture() });
  const KU = .165, GAP = .022, KW = 2.62;
  const keys = new T.InstancedMesh(slabGeometry(KU, KU, .016, .03, .005), W3.keyMat, 96);
  const m = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(); let k = 0;
  const KEYPOS = [];
  const putKey = (x, z, w, d) => { m.compose(v.set(x, .106, z), q, sc.set(w / KU, 1, d / KU)); keys.setMatrixAt(k++, m); KEYPOS.push([x, z, w, d]); };
  const ROWS = [
    [-.9, .09, Array(14).fill(1)],
    [-.76, KU, [...Array(13).fill(1), 1.5]],
    [-.575, KU, [1.5, ...Array(13).fill(1)]],
    [-.39, KU, [1.8, ...Array(11).fill(1), 1.7]],
    [-.205, KU, [2.3, ...Array(10).fill(1), 2.2]],
    [-.02, KU, [1, 1, 1, 1.25, 5, 1.25, 1, 'arrows']],
  ];
  ROWS.forEach(([z, d, row]) => {
    const U = row.reduce((a, w) => a + (w === 'arrows' ? 3 : w), 0);
    const u = (KW - GAP * (row.length - 1)) / U; let x = -KW / 2;
    row.forEach((w) => {
      if (w === 'arrows') {
        const s = (3 * u - 2 * GAP) / 3, h = (d - GAP / 2) / 2;
        putKey(x + s / 2, z + d / 2 - h / 2, s, h);
        putKey(x + s * 1.5 + GAP, z - d / 2 + h / 2, s, h); putKey(x + s * 1.5 + GAP, z + d / 2 - h / 2, s, h);
        putKey(x + s * 2.5 + GAP * 2, z + d / 2 - h / 2, s, h); x += 3 * u;
      } else { putKey(x + w * u / 2, z, w * u, d); x += w * u + GAP; }
    });
  });
  keys.count = k; laptop.add(cast(keys, false));
  // printed legends on the key tops, one texture laid over the whole keyboard
  const LEG = { z0: -.95, z1: .07, x0: -KW / 2 - .01, x1: KW / 2 + .01 };
  W3.legend = { canvas: document.createElement('canvas'), keys: KEYPOS, box: LEG };
  W3.legend.tex = new T.CanvasTexture(W3.legend.canvas); W3.legend.tex.encoding = T.sRGBEncoding; W3.legend.tex.anisotropy = 8;
  drawLegends();
  W3.legendMat = new T.MeshBasicMaterial({ map: W3.legend.tex, transparent: true, depthWrite: false, toneMapped: false, color: 0x8f98ab });
  const legend = new T.Mesh(new T.PlaneGeometry(LEG.x1 - LEG.x0, LEG.z1 - LEG.z0), W3.legendMat);
  legend.rotation.x = -Math.PI / 2; legend.position.set((LEG.x0 + LEG.x1) / 2, .1225, (LEG.z0 + LEG.z1) / 2); laptop.add(legend);
  // big glass trackpad, flush with the deck
  const pad2 = new T.Mesh(roundRectGeometry(1.3, .74, .045), new T.MeshStandardMaterial({ color: 0x20262f, metalness: .6, roughness: .32, envMapIntensity: .9 }));
  pad2.rotation.x = -Math.PI / 2; pad2.position.set(0, .1104, .56); laptop.add(cast(pad2, false));
  W3.led = new T.Mesh(new T.SphereGeometry(.012, 12, 12), new T.MeshBasicMaterial({ color: 0x40d6ff, toneMapped: false })); W3.led.position.set(1.32, .07, 1.0); laptop.add(W3.led);
  const barrel = new T.Mesh(new T.CylinderGeometry(.045, .045, 2.5, 32), hinge); barrel.rotation.z = Math.PI / 2; barrel.position.set(0, .085, -.985); laptop.add(cast(barrel));

  const lid = new T.Group(); lid.position.set(0, .11, -1); laptop.add(lid); W3.lid = lid;
  const shellGeo = roundBoxGeometry(3, 1.95, .045, .14, .014); shellGeo.translate(0, .975, -.045);
  lid.add(cast(new T.Mesh(shellGeo, body)));
  const bezel = new T.Mesh(roundRectGeometry(2.94, 1.89, .11), new T.MeshStandardMaterial({ color: 0x030405, roughness: .5, metalness: .1, envMapIntensity: .5 }));
  bezel.position.set(0, .975, .0015); lid.add(bezel);
  W3.scrCanvas = document.createElement('canvas'); W3.scrCanvas.width = SCR.w * SCR.scale; W3.scrCanvas.height = SCR.h * SCR.scale;
  W3.scr = W3.scrCanvas.getContext('2d');
  W3.scr.scale(SCR.scale, SCR.scale);
  W3.scrTex = new T.CanvasTexture(W3.scrCanvas); W3.scrTex.encoding = T.sRGBEncoding; W3.scrTex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  W3.scrMat = new T.MeshBasicMaterial({ map: W3.scrTex, toneMapped: false });
  // edge-to-edge display with thin bezels
  const screen = new T.Mesh(new T.PlaneGeometry(2.86, 1.7875), W3.scrMat); screen.position.set(0, .975, .003); lid.add(screen);
  // webcam centred in the top bezel: dark ring, glass lens, tiny glint
  const camY = 1.8945;
  const ringC = new T.Mesh(new T.CircleGeometry(.0105, 32), new T.MeshBasicMaterial({ color: 0x15181f })); ringC.position.set(0, camY, .0025); lid.add(ringC);
  const lens = new T.Mesh(new T.CircleGeometry(.0062, 32), new T.MeshStandardMaterial({ color: 0x0a1630, roughness: .08, metalness: .6, envMapIntensity: 1.5 })); lens.position.set(0, camY, .003); lid.add(lens);
  const glint = new T.Mesh(new T.CircleGeometry(.0018, 12), new T.MeshBasicMaterial({ color: 0x5f7fb8 })); glint.position.set(.0022, camY + .0022, .0034); lid.add(glint);
  // glass: adds only the reflection of the studio on top of the screen
  const glass = new T.Mesh(new T.PlaneGeometry(2.92, 1.87), new T.MeshBasicMaterial({ color: 0x000000, envMap: scene.environment, combine: T.MixOperation, reflectivity: .07, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  glass.position.set(0, .975, .0045); lid.add(glass);
  // TT logo on the lid: polished mirror metal, with a glow that wakes up with the world
  const logoAlpha = logoTexture('#ffffff', false);
  const logoMetal = new T.Mesh(new T.PlaneGeometry(.72, .72), new T.MeshStandardMaterial({ color: 0xdfe6f2, metalness: 1, roughness: .22, alphaMap: logoAlpha, transparent: true, envMapIntensity: 2, emissive: 0x3a4458, depthWrite: false }));
  // the logo is turned every frame so it always reads the right way up on screen (see uprightLogo)
  logoMetal.position.set(0, .975, -.0462); logoMetal.rotation.set(0, Math.PI, 0); lid.add(logoMetal);
  const logo = new T.Mesh(new T.PlaneGeometry(.72, .72), new T.MeshBasicMaterial({ map: logoTexture('#40d6ff', true), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
  logo.position.set(0, .975, -.0466); logo.rotation.set(0, Math.PI, 0); lid.add(logo); W3.logoMat = logo.material;
  W3.logoMeshes = [logoMetal, logo];
  // the logo font may arrive after the first draw
  if (document.fonts) document.fonts.ready.then(() => { drawLegends(); logoMetal.material.alphaMap = logoTexture('#ffffff', false); logoMetal.material.needsUpdate = true; logo.material.map = logoTexture('#40d6ff', true); logo.material.needsUpdate = true; });
  // soft contact shadow so it sits on the floor
  const contact = new T.Mesh(new T.PlaneGeometry(4.4, 3.4), new T.MeshBasicMaterial({ map: glowTexture('0,0,0'), transparent: true, opacity: .85, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .002; scene.add(contact);

  // floating dust
  const dp = []; for (let i = 0; i < 900; i++) dp.push((Math.random() - .5) * 30, Math.random() * 9, (Math.random() - .6) * 26);
  const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.Float32BufferAttribute(dp, 3));
  W3.dustMat = new T.PointsMaterial({ color: 0x9fe8ff, size: .035, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
  W3.dust = new T.Points(dg, W3.dustMat); scene.add(W3.dust);

  // track holograms + question card are built when content arrives
  W3.tiles = new T.Group(); scene.add(W3.tiles);
  W3.qCanvas = document.createElement('canvas'); W3.qCanvas.width = 2048; W3.qCanvas.height = 1280;
  W3.qCanvas.getContext('2d').scale(2, 2);
  W3.qTex = new T.CanvasTexture(W3.qCanvas); W3.qTex.encoding = T.sRGBEncoding;
  W3.qTex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const qGeo = new T.PlaneGeometry(1.5, .9375); qGeo.rotateX(-Math.PI / 2);
  W3.qMat = new T.MeshBasicMaterial({ map: W3.qTex, transparent: true, opacity: 0, side: T.DoubleSide, toneMapped: false, depthWrite: false });
  W3.qcard = new T.Mesh(qGeo, W3.qMat); W3.qcard.position.set(0, .13, .35); scene.add(W3.qcard);
  const qGlow = new T.Mesh(new T.PlaneGeometry(2.2, 1.5).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: glowTexture('255,181,71'), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  qGlow.position.set(0, .125, .35); scene.add(qGlow); W3.qGlow = qGlow;

  // post-processing: bloom for anything glowing, rendered in linear space then gamma-corrected
  try {
    const gl2 = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    if (T.EffectComposer && T.UnrealBloomPass && gl2) {
      const rt = new T.WebGLMultisampleRenderTarget(4, 4, { format: T.RGBAFormat, type: T.HalfFloatType });
      rt.samples = 4;
      W3.composer = new T.EffectComposer(renderer, rt);
      W3.composer.addPass(new T.RenderPass(scene, camera));
      W3.bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), .28, .3, .9);
      W3.composer.addPass(W3.bloom);
      W3.composer.addPass(new T.ShaderPass(T.GammaCorrectionShader));
      // the render target is linear, so the clear colour has to be too
      renderer.setClearColor(new T.Color(0x04050a).convertSRGBToLinear(), 1);
    }
  } catch (e) { W3.composer = null; }

  resize(); addEventListener('resize', resize);
  return true;
}

/* geometry + texture helpers for the laptop */
function roundShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
// box with rounded corners and bevelled edges; spans z 0..d
function roundBoxGeometry(w, h, d, r, b) {
  const g = new THREE.ExtrudeGeometry(roundShape(w - 2 * b, h - 2 * b, Math.max(.001, r - b)), { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 10 });
  g.translate(0, 0, b); return g;
}
// the same, lying flat: footprint w x d, height h, sits on y = 0
function slabGeometry(w, d, h, r, b) { const g = roundBoxGeometry(w, d, h, r, b); g.rotateX(-Math.PI / 2); return g; }
function roundRectGeometry(w, h, r) { return new THREE.ShapeGeometry(roundShape(w, h, r), 10); }
// key legends drawn at each key's position (labels in keyboard order), in a bold gaming-laptop style font
const KEY_LABELS = [
  ['esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', ''],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'delete'],
  ['tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['caps lock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return'],
  ['shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'shift'],
  ['fn', 'control', 'option', 'command', '', 'command', 'option', '◀', '▲', '▼', '▶'],
].flat();
const KEY_FONT = '"Chakra Petch", "Arial Black", sans-serif';
function drawLegends() {
  const L = W3.legend; if (!L) return; const b = L.box, PX = 900;
  const c = L.canvas; c.width = Math.round((b.x1 - b.x0) * PX); c.height = Math.round((b.z1 - b.z0) * PX); const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.textBaseline = 'middle';
  L.keys.forEach(([x, z, w, d], i) => {
    const t = KEY_LABELS[i]; if (!t) return;
    const cx = (x - b.x0) * PX, cy = (z - b.z0) * PX, hw = w * PX / 2, hd = d * PX / 2;
    if (t.length === 1 || /^[◀▲▼▶]$/.test(t)) { g.font = `700 ${d < .1 ? 34 : 60}px ${KEY_FONT}`; g.textAlign = 'center'; g.fillText(t, cx, cy + 3); }
    else if (/^F\d/.test(t) || t === 'esc') { g.font = `700 30px ${KEY_FONT}`; g.textAlign = 'center'; g.fillText(t, cx, cy + 2); }
    else { g.font = `700 30px ${KEY_FONT}`; const right = x > 0 && /return|delete|shift|option|command/.test(t); g.textAlign = right ? 'right' : 'left'; g.fillText(t, right ? cx + hw - 16 : cx - hw + 16, cy + hd - 24); }
  });
  L.tex.needsUpdate = true;
}

// keep the lid logo upright on screen: flip it whenever the lid's top edge points down in the view
const _lp = window.THREE ? [new THREE.Vector3(), new THREE.Vector3()] : null;
function uprightLogo() {
  if (!W3.logoMeshes) return;
  W3.lid.updateMatrixWorld(); camera.updateMatrixWorld();
  _lp[0].set(0, .975, -.05); _lp[1].set(0, 1.5, -.05); W3.lid.localToWorld(_lp[0]); W3.lid.localToWorld(_lp[1]);
  _lp[0].project(camera); _lp[1].project(camera);
  const flip = _lp[1].y < _lp[0].y ? Math.PI : 0;
  W3.logoMeshes.forEach((o) => { o.rotation.z = flip; });
}

// backlight leaking around each key's edge
function keyGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 5; g.filter = 'blur(2px)'; g.strokeRect(2, 2, 60, 60);
  g.filter = 'none';
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.repeat.set(1 / .165, 1 / .165); t.offset.set(.5, .5); return t;
}
function logoTexture(col, glow) {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'); g.scale(4, 4);
  if (!glow) { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); }
  g.strokeStyle = col; g.lineWidth = 7; if (glow) { g.shadowColor = col; g.shadowBlur = 24; }
  g.beginPath(); g.moveTo(40, 40); g.lineTo(216, 40); g.lineTo(216, 170); g.lineTo(170, 216); g.lineTo(40, 216); g.closePath(); g.stroke();
  g.fillStyle = col; g.font = '700 92px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TT', 128, 132);
  const t = new THREE.CanvasTexture(c); if (glow) t.encoding = THREE.sRGBEncoding; return t;
}
function glowTexture(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, `rgba(${rgb},.9)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

function buildTiles() {
  if (!three) return;
  const T = THREE;
  W3.tiles.children.slice().forEach((m) => { W3.tiles.remove(m); m.material.map && m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); });
  (C.tracks || []).slice(0, 7).forEach((t, i, arr) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800; const g = c.getContext('2d'); g.scale(2, 2);
    const col = '#70dcf4';
    g.fillStyle = 'rgba(6,10,20,.82)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(600, 0); g.lineTo(640, 40); g.lineTo(640, 400); g.lineTo(40, 400); g.lineTo(0, 360); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(112,220,244,.45)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = col; g.fillRect(36, 40, 70, 6);
    g.font = '600 30px "IBM Plex Mono", monospace'; g.fillText('TRACK 0' + (i + 1), 36, 100);
    g.fillStyle = '#e9eef9'; g.font = '700 50px "Chakra Petch", sans-serif';
    wrap(g, t.name.toUpperCase(), 36, 170, 570, 54, 3);
    g.fillStyle = '#9fb0cc'; g.font = '400 23px "IBM Plex Mono", monospace';
    g.fillText((t.areas || []).slice(0, 2).join(' · ').slice(0, 44), 36, 330);
    g.fillStyle = col; g.font = '600 22px "IBM Plex Mono", monospace'; g.fillText('TAP FOR THE FULL BRIEF  >', 36, 370);
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const mesh = new T.Mesh(new T.PlaneGeometry(1.28, .8), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
    const n = arr.length; const off = i - (n - 1) / 2;
    mesh.userData = { x: off * 1.3, z: -2.6 + Math.abs(off) * .45, y: 1.7 + (i % 2) * .38, i };
    mesh.position.set(mesh.userData.x, -1, mesh.userData.z);
    W3.tiles.add(mesh);
  });
}

function wrap(g, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(/\s+/); let line = ''; let n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += lh; line = words[i]; if (++n >= maxLines - 1) { line = words.slice(i).join(' '); break; } }
    else line = test;
  }
  if (n >= maxLines - 1 && g.measureText(line).width > maxW) { while (g.measureText(line + '…').width > maxW && line.length) line = line.slice(0, -1); line += '…'; }
  g.fillText(line, x, y); return y;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  // Native 4K at 3840x2160; supersample smaller displays within a bounded pixel budget.
  const budget = W3.lowQ ? 4_000_000 : w < 760 ? 3_000_000 : 8_294_400;
  const pr = Math.min(Math.max(devicePixelRatio || 1, W3.lowQ ? 1 : 1.5), 2.5, Math.sqrt(budget / (w * h)));
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  if (W3.composer) { W3.composer.setPixelRatio(pr); W3.composer.setSize(w, h); }
  camera.aspect = w / h;
  camera.fov = w / h < .8 ? 62 : w / h < 1.2 ? 52 : 40;
  // on phones the story panel sits at the bottom, so lift the 3D subject into the top half
  W3.viewLift = -1;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

/* camera path: cylindrical interpolation around the laptop so moves feel like orbits */
const tmpL = [0, 0, 0];
function camAt(p) {
  const KEYS = isSmall() ? KEYS_M : KEYS_D;
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++;
  const [pa, A, LA] = KEYS[i]; const [pb, B, LB] = KEYS[i + 1];
  const t = easeIO(seg(p, pa, pb));
  const ra = Math.hypot(A[0], A[2]), rb = Math.hypot(B[0], B[2]);
  const aa = Math.atan2(A[2], A[0]); let ab = Math.atan2(B[2], B[0]);
  let d = ab - aa; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  const r = lerp(ra, rb, t), a = aa + d * t;
  tmpL[0] = lerp(LA[0], LB[0], t); tmpL[1] = lerp(LA[1], LB[1], t); tmpL[2] = lerp(LA[2], LB[2], t);
  return [Math.cos(a) * r, lerp(A[1], B[1], t), Math.sin(a) * r];
}

/* ======================= LAPTOP SCREEN ======================= */
const SCREEN_MODES = [[0, 'off'], [.13, 'boot'], [.17, 'code'], [.255, 'theme'], [.36, 'tracks'], [.485, 'glitch'], [.595, 'question'], [.715, 'schedule'], [.83, 'rules'], [.925, 'register']];
let lastMode = 'off', modeSwitch = 0;
function screenMode(p) { let m = 'off'; for (const [a, n] of SCREEN_MODES) if (p >= a) m = n; return m; }

const codeCheck = new Image();
codeCheck.src = './icons/check.svg';
const CODE = () => [
  '// tech_tank.js',
  'import { future } from "unexpected";',
  '',
  'const hackathon = {',
  `  name:   "${(C && C.event.name) || 'Tech Tank'}",`,
  `  theme:  "${(C && C.event.theme) || 'Build for the Unexpected'}",`,
  `  tracks: ${(C && C.tracks.length) || 5},`,
  '  hours:  4,',
  '  twist:  "reality check",',
  '};',
  '',
  'while (!solved) {',
  '  build();',
  '  breakThings(); // something will fail',
  '  adapt();',
  '}',
  '',
  '> npm run hackathon',
  '  \uFFFC BUILD.   \uFFFC BREAK.   \uFFFC ADAPT.',
];
const TOK = /(\/\/.*$)|("[^"]*")|\b(import|from|const|while|true|false)\b|\b(\d+)\b|(\uFFFC)/g;
function drawCodeLine(g, line, x, y) {
  let last = 0; TOK.lastIndex = 0; let mm;
  const put = (s, col) => { g.fillStyle = col; g.fillText(s, x, y); x += g.measureText(s).width; };
  while ((mm = TOK.exec(line))) {
    if (mm.index > last) put(line.slice(last, mm.index), line.startsWith('>') ? '#e9eef9' : '#c8d3ea');
    if (mm[5]) {
      if (codeCheck.complete && codeCheck.naturalWidth) g.drawImage(codeCheck, x, y - 17, 20, 20);
      x += 20;
    } else put(mm[0], mm[1] ? '#5c6886' : mm[2] ? '#7ef0b8' : mm[3] ? '#b4a6ff' : '#ffb547');
    last = mm.index + mm[0].length;
  }
  if (last < line.length) put(line.slice(last), line.startsWith('>') ? '#40d6ff' : '#c8d3ea');
  return x;
}

function drawScreen(p, now) {
  const g = W3.scr, w = SCR.w, h = SCR.h;
  const mode = screenMode(p);
  if (mode !== lastMode) { lastMode = mode; modeSwitch = now; }
  g.save();
  g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h);
  const mono = (s, wt = 500) => `${wt} ${s}px "IBM Plex Mono", monospace`;
  const disp = (s, wt = 700) => `${wt} ${s}px "Chakra Petch", sans-serif`;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';

  if (mode === 'off') {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0b0f1a'); gr.addColorStop(.5, '#040508'); gr.addColorStop(1, '#020203');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } else if (mode === 'boot') {
    const b = seg(p, .13, .17);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.fillStyle = `rgba(64,214,255,${clamp(b * 2)})`; g.font = disp(86);
    g.fillText('TECH TANK', w / 2, h / 2 - 20);
    g.strokeStyle = 'rgba(64,214,255,.35)'; g.strokeRect(w / 2 - 200, h / 2 + 30, 400, 10);
    g.fillStyle = '#40d6ff'; g.fillRect(w / 2 - 198, h / 2 + 32, 396 * b, 6);
    g.font = mono(20); g.fillStyle = '#5c6886';
    const lines = ['POST ok', 'mounting /ideas ... ok', 'checking assumptions ... 3 found', 'loading theme ...'];
    lines.slice(0, Math.ceil(b * lines.length)).forEach((l, i) => g.fillText(l, w / 2, h / 2 + 90 + i * 28));
  } else if (mode === 'code') {
    const c = seg(p, .17, .25);
    g.fillStyle = '#0a0d16'; g.fillRect(0, 0, w, 44);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(28 + i * 24, 22, 7, 0, 7); g.fill(); });
    g.fillStyle = '#c8d3ea'; g.font = mono(18); g.fillText('tech_tank.js', 120, 28);
    const code = CODE(); const total = code.join('\n').length; let left = Math.floor(total * c);
    g.font = mono(22);
    let y = 84;
    for (let i = 0; i < code.length && left >= 0; i++) {
      const line = code[i].slice(0, Math.max(0, left)); left -= code[i].length + 1;
      g.fillStyle = '#2c3550'; g.fillText(String(i + 1).padStart(2, ' '), 20, y);
      const endX = drawCodeLine(g, line, 70, y);
      if (left < 0 && Math.floor(now / 400) % 2) { g.fillStyle = '#40d6ff'; g.fillRect(endX + 2, y - 20, 12, 24); }
      y += 29;
    }
  } else if (mode === 'theme') {
    const gr = g.createRadialGradient(w * .3, h * .2, 10, w * .5, h * .5, w * .8); gr.addColorStop(0, '#13203d'); gr.addColorStop(1, '#04050a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const words = String(C ? C.event.theme : 'Build for the Unexpected').toUpperCase().split(' ');
    const last = words.pop();
    g.font = mono(20); g.fillStyle = '#40d6ff'; g.fillText((C ? C.event.name : 'TECH TANK').toUpperCase() + '  //  ' + (C ? C.event.campaign : ''), 64, 110);
    g.font = disp(84); g.fillStyle = '#e9eef9'; g.fillText(words.join(' '), 60, 270);
    const tg = g.createLinearGradient(60, 0, 900, 0); tg.addColorStop(0, '#40d6ff'); tg.addColorStop(1, '#70b5ce');
    g.font = disp(132); g.fillStyle = tg; g.fillText(last, 56, 400);
    g.font = mono(22); g.fillStyle = '#8f99b3'; g.fillText(C ? C.event.tagline : '', 64, 500);
  } else if (mode === 'tracks') {
    g.font = mono(20); g.fillStyle = '#40d6ff'; g.fillText('~/tracks $ ls', 48, 70);
    (C ? C.tracks : []).forEach((t, i) => {
      const y = 130 + i * 92; const on = i === hotTrack;
      g.fillStyle = on ? 'rgba(64,214,255,.12)' : 'rgba(255,255,255,.03)'; g.fillRect(40, y - 52, w - 80, 76);
      g.fillStyle = '#70dcf4'; g.fillRect(40, y - 52, 8, 76);
      g.font = mono(18); g.fillText('0' + (i + 1), 72, y - 16);
      g.fillStyle = '#e9eef9'; g.font = disp(38, 600); g.fillText(t.name.toUpperCase().slice(0, 34), 130, y - 4);
    });
  } else if (mode === 'glitch') {
    const k = Math.floor(now / 90);
    g.fillStyle = '#120207'; g.fillRect(0, 0, w, h);
    g.font = disp(96); g.fillStyle = '#ff4d5e'; g.textAlign = 'center';
    g.fillText(k % 14 < 11 ? 'ASSUMPTION' : 'ADAPT()', w / 2, 230); g.fillText(k % 14 < 11 ? 'FAILED' : 'RUNNING', w / 2, 330);
    g.textAlign = 'left'; g.font = mono(22);
    const L = [['> primary data source', 'OFFLINE', '#ff4d5e'], ['> users', '×10 SURGE', '#ffb547'], ['> network', 'UNSTABLE', '#ffb547'], ['> adapt()', 'RUNNING', '#3ee6a6']];
    L.forEach(([a, b, col], i) => { g.fillStyle = '#c8d3ea'; g.fillText(a.padEnd(28, '.'), 120, 430 + i * 36); g.fillStyle = col; g.fillText(b, 560, 430 + i * 36); });
    for (let i = 0; i < 7; i++) { const y = Math.random() * h, hh = Math.random() * 28 + 4; g.drawImage(W3.scrCanvas, 0, y * SCR.scale, w * SCR.scale, hh * SCR.scale, (Math.random() - .5) * 24, y, w, hh); }
  } else if (mode === 'question') {
    const q = C ? C.question : {}; const sealed = !q || q.sealed !== false;
    g.fillStyle = '#0d0a04'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,181,71,.5)'; g.lineWidth = 3; g.strokeRect(30, 30, w - 60, h - 60);
    g.textAlign = 'center'; g.fillStyle = '#ffb547'; g.font = mono(22); g.fillText(sealed ? 'QUESTION_CARD.lock' : 'QUESTION_CARD.unsealed', w / 2, 100);
    // padlock
    g.lineWidth = 12; g.strokeStyle = '#ffb547'; g.beginPath(); g.arc(w / 2, 230, 46, Math.PI, 0); g.stroke();
    g.fillStyle = '#ffb547'; g.fillRect(w / 2 - 70, 230, 140, 100);
    if (!sealed) { g.fillStyle = '#0d0a04'; g.fillRect(w / 2 + 34, 170, 30, 60); }
    g.font = disp(64); g.fillStyle = '#e9eef9';
    g.fillText(sealed ? countdownText(q && q.revealAt) : 'UNSEALED', w / 2, 440);
    g.font = mono(20); g.fillStyle = '#8f99b3'; g.fillText(sealed ? 'until the question is revealed' : 'read the card below', w / 2, 490);
  } else if (mode === 'schedule') {
    g.font = mono(20); g.fillStyle = '#40d6ff'; g.fillText('$ tail timeline.log', 48, 70);
    const items = (C ? C.schedule : []).slice(0, 12);
    g.font = mono(21);
    items.forEach((it, i) => { const y = 120 + i * 40; g.fillStyle = it.type === 'crisis' ? '#ff4d5e' : it.type === 'key' ? '#40d6ff' : '#5c6886'; g.fillText(`${(it.day || '').replace(/day\s*/i, 'D')} ${it.time || '--:--'}`, 48, y); g.fillStyle = '#c8d3ea'; g.fillText(String(it.title).slice(0, 44), 210, y); });
  } else if (mode === 'rules') {
    g.font = mono(20); g.fillStyle = '#40d6ff'; g.fillText('rules.md', 48, 70);
    g.font = disp(44); g.fillStyle = '#e9eef9'; g.fillText('# RULES', 48, 130);
    g.font = mono(20); g.fillStyle = '#c8d3ea';
    let y = 180; (C ? C.rules : []).slice(0, 7).forEach((r, i) => { g.fillStyle = '#70b5ce'; g.fillText(pad(i + 1), 48, y); g.fillStyle = '#c8d3ea'; y = wrap(g, r, 100, y, w - 150, 26, 2) + 40; });
  } else if (mode === 'register') {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#062033'); gr.addColorStop(1, '#0b0820');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.font = mono(24); g.fillStyle = '#40d6ff'; g.fillText('> join --team', w / 2, 150);
    g.font = disp(120); g.fillStyle = '#e9eef9'; g.fillText('REGISTER', w / 2, 300);
    g.font = disp(40, 600); g.fillStyle = '#8f99b3'; g.fillText('TEAMS OF 2–4', w / 2, 370);
    const dl = C && C.event.registrationDeadline; g.font = mono(26); g.fillStyle = '#ffb547';
    if (dl) g.fillText('closes in ' + countdownText(dl), w / 2, 470);
  }
  // scanlines + switch static
  g.globalAlpha = .018; g.fillStyle = '#000'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); g.globalAlpha = 1;
  const sw = 1 - clamp((now - modeSwitch) / 280);
  if (sw > 0 && mode !== 'off') { for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${220 + Math.random() * 35 | 0},255,${Math.random() * .5 * sw})`; g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 200, Math.random() * 8 + 1); } }
  g.restore();
  W3.scrTex.needsUpdate = true;
}

function countdownText(iso) {
  const t = Date.parse(iso); if (isNaN(t)) return 'TBA';
  let s = Math.max(0, (t - Date.now()) / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  return `${d}D ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(Math.floor(s % 60))}`;
}

let qLastDraw = 0;
function drawQCard(now) {
  if (now - qLastDraw < 500) return; qLastDraw = now;
  const g = W3.qCanvas.getContext('2d'), w = 1024, h = 640; const q = (C && C.question) || {}; const sealed = q.sealed !== false;
  g.clearRect(0, 0, w, h);
  g.fillStyle = sealed ? '#140e04' : '#06121a';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w - 60, 0); g.lineTo(w, 60); g.lineTo(w, h); g.lineTo(60, h); g.lineTo(0, h - 60); g.closePath(); g.fill();
  g.lineWidth = 8; g.strokeStyle = sealed ? '#ffb547' : '#40d6ff'; g.stroke();
  g.save(); g.clip(); g.globalAlpha = .07; g.fillStyle = sealed ? '#ffb547' : '#40d6ff';
  for (let i = -h; i < w; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 + h, h); g.lineTo(i + h, h); g.fill(); }
  g.restore();
  g.fillStyle = sealed ? '#ffb547' : '#40d6ff'; g.font = '600 34px "IBM Plex Mono", monospace'; g.fillText('TECH TANK // QUESTION CARD', 60, 90);
  g.fillStyle = '#e9eef9';
  if (sealed) {
    g.font = '700 120px "Chakra Petch", sans-serif'; g.fillText('SEALED', 60, 290);
    g.font = '700 78px "Chakra Petch", sans-serif'; g.fillStyle = '#ffb547'; g.fillText(countdownText(q.revealAt), 60, 420);
    g.font = '400 30px "IBM Plex Mono", monospace'; g.fillStyle = '#9fb0cc'; g.fillText('reveals live on this site', 60, 540);
  } else {
    g.font = '700 76px "Chakra Petch", sans-serif'; const y = wrap(g, String(q.title || 'The Question').toUpperCase(), 60, 210, 900, 80, 2);
    g.font = '400 32px "Manrope", sans-serif'; g.fillStyle = '#c8d3ea'; wrap(g, q.statement || '', 60, y + 70, 900, 42, 5);
  }
  W3.qTex.needsUpdate = true;
}

/* ======================= FRAME ======================= */
let last = performance.now(), mx = 0, my = 0, smx = 0, smy = 0;
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });

function journeyMax() { return Math.max(1, $('#journey').offsetHeight - innerHeight); }
function readScroll() { target = clamp(scrollY / journeyMax()); }
addEventListener('scroll', readScroll, { passive: true });

// if the device struggles, drop the heavy effects instead of stuttering
const perf = { n: 0, t: 0 };
function watchPerf(dt) {
  if (W3.lowQ || perf.n > 200 || document.hidden || /[?&]hq\b/.test(location.search)) return;
  perf.n++;
  if (perf.n > 40) perf.t += dt;                            // skip warm-up frames
  if (perf.n === 160 && perf.t / 120 > 1 / 30) {
    W3.lowQ = true; W3.composer = null;
    renderer.setClearColor(0x04050a, 1); renderer.shadowMap.enabled = false;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    resize();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  P += (target - P) * (reduced ? 1 : 1 - Math.exp(-dt * 5.5));
  if (Math.abs(target - P) < 1e-5) P = target;
  smx += (mx - smx) * .05; smy += (my - smy) * .05;
  updateHUD(P);
  if (!three) return;
  const past = scrollY - journeyMax();
  if (past > innerHeight * 1.3) return; // control area fully covers the stage
  if (!$('#trackModal').hidden || !$('#lightbox').hidden) return; // an overlay covers the stage

  const p = P;
  if (isSmall()) {
    // Leave space below the opening title; lift the subject when bottom panels enter.
    const lift = Math.round(innerHeight * .2 * smooth(seg(p, .02, .2)));
    if (lift !== W3.viewLift) {
      camera.setViewOffset(innerWidth, innerHeight + 2 * lift, 0, 2 * lift, innerWidth, innerHeight);
      W3.viewLift = lift;
    }
  }
  const world = seg(p, .18, .27);
  const twist = seg(p, .47, .515) * (1 - seg(p, .585, .62));
  const finale = seg(p, .91, .97);
  const flick = twist ? (Math.random() < .12 ? .2 : 1) : 1;

  // lid opens, screen powers
  W3.lid.rotation.x = lerp(Math.PI / 2, -.2, easeIO(seg(p, .035, .14)));
  const power = seg(p, .125, .15);
  W3.scrMat.color.setScalar(.04 + power * .96);
  W3.led.material.color.setHex(power > 0 ? 0x3ee6a6 : 0x40d6ff);
  W3.led.scale.setScalar(power > 0 ? 1 : .6 + Math.sin(now / 300) * .4);
  W3.screenL.intensity = power * 2.4 * (lastMode === 'glitch' ? .4 : 1);
  W3.screenL.color.setHex(lastMode === 'glitch' ? 0xff4d5e : lastMode === 'question' ? 0xffb547 : 0x7fdfff);
  W3.keyMat.emissive.setHex(twist > .3 ? 0xff3344 : 0x40d6ff);
  W3.keyMat.emissiveIntensity = (world * .7 + twist * 1.1) * flick;
  W3.logoMat.opacity = world * .75;

  // world boot: grid, ring pulse, dust, rims
  const pulse = seg(p, .17, .3);
  W3.ring.scale.setScalar(.5 + pulse * 26); W3.ring.material.opacity = pulse > 0 && pulse < 1 ? (1 - pulse) * .8 : 0;
  W3.gridMat.opacity = (world * .09 + finale * .05) * flick;
  W3.gridMat.color.setHex(twist > .3 ? 0xff4d5e : 0x40d6ff);
  W3.dustMat.opacity = world * .22;
  W3.dust.rotation.y = now * .00002;
  W3.rimA.intensity = (world * 1.5 + finale * 1.1) * (1 - twist * .8);
  W3.rimB.intensity = (world * 1.2 + finale * 1.1) * (1 - twist * .8);
  W3.red.intensity = twist * 3.2 * flick;
  W3.amb.intensity = .35 + world * .2 + finale * .25;
  W3.key.intensity = .55 + finale * .3;

  // track holograms rise from the floor
  W3.tiles.children.forEach((m) => {
    const u = m.userData; const s = smooth(seg(p, .33 + u.i * .011, .39 + u.i * .011)) * (1 - smooth(seg(p, .47, .51)));
    m.position.set(u.x, lerp(-1, u.y + Math.sin(now / 900 + u.i) * .04, s), u.z);
    const hot = hoverTile >= 0 ? hoverTile : hotTrack;
    m.material.opacity = s * (hot === -1 || hot === u.i ? 1 : .35);
    m.scale.setScalar(hot === u.i ? 1.12 : 1);
    m.lookAt(camera.position.x, m.position.y, camera.position.z);
    m.visible = s > .001;
  });

  // question card rises out of the keyboard
  const qs = smooth(seg(p, .575, .625)) * (1 - smooth(seg(p, .71, .75)));
  W3.qcard.visible = qs > .001; W3.qGlow.visible = W3.qcard.visible;
  W3.qcard.position.y = lerp(.13, .95, qs) + Math.sin(now / 700) * .02 * qs;
  W3.qcard.rotation.y = Math.sin(now / 1600) * .06;
  W3.qMat.opacity = qs; W3.qGlow.material.opacity = qs * .3; W3.qGlow.position.y = .125;
  W3.amberL.intensity = qs * 1.1;
  if (qs > 0) drawQCard(now);

  // camera
  const cp = camAt(p);
  const shake = twist > 0 && twist < 1 ? (Math.random() - .5) * .02 : 0;
  camera.position.set(cp[0] + smx * .25 + shake, cp[1] - smy * .15 + shake, cp[2]);
  camera.lookAt(tmpL[0], tmpL[1], tmpL[2]);

  drawScreen(p, now);
  W3.wellMat.opacity = W3.keyMat.emissiveIntensity * .3;
  const kl = clamp(W3.keyMat.emissiveIntensity);
  W3.legendMat.color.setRGB(lerp(.68, twist > .3 ? 1 : .7, kl), lerp(.71, twist > .3 ? .5 : .95, kl), lerp(.78, twist > .3 ? .55 : 1, kl));
  uprightLogo();
  W3.wellMat.color.setHex(twist > .3 ? 0xff3344 : 0x40d6ff);
  if (W3.composer) {
    W3.bloom.strength = .24 + twist * .16 + finale * .08;
    W3.composer.render(dt);
  } else renderer.render(scene, camera);
  watchPerf(dt);
}

/* ======================= HUD + PANELS ======================= */
const panelState = {};
function updateHUD(p) {
  const past = clamp((scrollY - journeyMax()) / (innerHeight * .5));
  $('#hint').style.opacity = 1 - seg(p, 0, .025);
  $('#progressBar').style.width = (p * 100).toFixed(2) + '%';
  const small = isSmall();
  STATIONS.forEach((st) => {
    const el = document.getElementById('p-' + st.id); if (!el) return;
    if (document.body.classList.contains('no3d') || small) return;
    const [a, b] = st.hold;
    let o = st.id === 'power' ? 1 - seg(p, .005, .045) : Math.min(seg(p, a - .035, a), st.id === 'register' ? 1 : 1 - seg(p, b, b + .035));
    if (st.id === 'register') o *= 1 - past;
    o = smooth(o);
    if (panelState[st.id] === o) return;
    const was = panelState[st.id] || 0; panelState[st.id] = o;
    el.style.opacity = o;
    el.style.visibility = o > .01 ? 'visible' : 'hidden';
    el.style.pointerEvents = o > .6 ? 'auto' : 'none';
    el.style.filter = '';
    const dy = ((1 - o) * 40).toFixed(1);
    el.style.transform = small && !el.classList.contains('intro') ? `translateY(${dy}px)` : el.classList.contains('center') || el.classList.contains('intro') ? `translate(-50%, calc(-50% + ${dy}px))` : `translateY(calc(-50% + ${dy}px))`;
    if (was < .5 && o >= .5) enterPanel(el);
  });
  // station dots
  let cur = 0; STATIONS.forEach((st, i) => { if (p >= st.hold[0] - .04) cur = i; });
  if (small) STATIONS.forEach((st, i) => { if (document.getElementById('p-' + st.id).getBoundingClientRect().top <= innerHeight * .4) cur = i; });
  $$('#stations button').forEach((b, i) => b.classList.toggle('on', i === cur));
}

function enterPanel(el) {
  $$('.crit .bar i', el).forEach((b) => { b.style.width = b.dataset.w; });
}
const GLYPHS = '!<>-_\\/[]{}=+*^?#01';
function scramble(el) {
  if (reduced) return;
  const final = el.dataset.final || el.textContent; el.dataset.final = final;
  const start = performance.now(), dur = 700;
  (function step(now) {
    const t = clamp((now - start) / dur); const n = Math.floor(final.length * t);
    el.textContent = final.slice(0, n) + [...final.slice(n)].map((ch) => (ch === ' ' ? ' ' : GLYPHS[Math.random() * GLYPHS.length | 0])).join('');
    if (t < 1) requestAnimationFrame(step); else el.textContent = final;
  })(start);
}

function buildStations() {
  $('#exploreButton').addEventListener('click', () => goTo(STATIONS[1]));
  $('#stations').innerHTML = STATIONS.map((s) => `<button type="button" aria-label="${esc(s.label)}"><span>${esc(s.label)}</span></button>`).join('');
  $$('#stations button').forEach((b, i) => b.addEventListener('click', () => goTo(STATIONS[i])));
}
function goTo(st) {
  if (isSmall()) {
    document.getElementById('p-' + st.id).scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    return;
  }
  const mid = st.id === 'power' ? 0 : st.id === 'register' ? 1 : (st.hold[0] + st.hold[1]) / 2;
  scrollTo({ top: mid * journeyMax(), behavior: reduced ? 'auto' : 'smooth' });
}

/* ======================= CONTENT ======================= */
const PHASES = { upcoming: 'Registrations open', live: 'Hacking live', crisis: 'Twist active', judging: 'Judging', ended: 'Event ended' };
const fmtDate = (iso, opts) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

function renderAll() {
  const e = C.event;
  document.title = `${e.name} · ${e.theme}`;
  $('#phase').dataset.phase = e.phase || 'upcoming';
  $('#phaseText').textContent = e.phase === 'upcoming' && e.registrationOpen === false ? 'Coming soon' : PHASES[e.phase] || e.phase;
  setText('#introTitle', e.name);
  $('#introTag').textContent = e.campaign || '';
  $('#introDetails').innerHTML = (e.stats || []).slice(0, 3).map((s) => `<span><b>${esc(s.value)}</b>${esc(s.label)}</span>`).join('');
  setText('#aboutTitle', e.theme);
  $('#aboutText').textContent = e.about || '';
  $('#stats').innerHTML = (e.stats || []).slice(0, 4).map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('');
  $('#eventMeta').innerHTML = [e.startsAt && esc(fmtDate(e.startsAt)), e.venue && esc(e.venue), e.datesTentative && '<b>dates tentative</b>'].filter(Boolean).join(' · ');

  $('#trackList').innerHTML = (C.tracks || []).map((t, i) => `<li style="--c:${esc(t.color)}" data-i="${i}" tabindex="0" role="button"><span class="n" aria-hidden="true"></span><div><b>${esc(t.name)}</b><span>${esc(t.description)}</span><span class="more">Full brief<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span></div></li>`).join('');
  $$('#trackList li').forEach((li) => {
    li.addEventListener('pointerenter', () => { hotTrack = +li.dataset.i; }); li.addEventListener('pointerleave', () => { hotTrack = -1; });
    li.addEventListener('click', () => openTrack(+li.dataset.i));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrack(+li.dataset.i); } });
  });
  $('#aiNote').textContent = C.aiNote || ''; $('#aiNote').hidden = !C.aiNote;
  buildTiles();

  const cr = C.crisis || {};
  setText('#twistTitle', e.campaign || 'Build. Break. Adapt.');
  $('#twistText').textContent = cr.sealed ? (cr.revealAt ? 'The twist is sealed until ' + fmtDate(cr.revealAt) + '.' : 'The twist is sealed. The organisers will announce its release.') : cr.intro || '';
  $('#twistTests').innerHTML = (cr.tests || []).map((t) => `<li>${esc(t)}</li>`).join('');
  $('#twistRelease').textContent = cr.sealed ? '' : cr.statement || '';
  $('#twistRelease').hidden = !$('#twistRelease').textContent;

  renderQuestion();
  renderSchedule();
  const tw = (C.judging || []).reduce((a, j) => a + (Number(j.weight) || 0), 0) || 100;
  $('#rulesList').innerHTML = (C.rules || []).map((r) => `<li>${esc(r)}</li>`).join('');
  $('#judging').innerHTML = (C.judging || []).map((j) => `<div class="crit ${/crisis|adapt/i.test(j.name) ? 'twist' : ''}"><span>${esc(j.name)}</span><span class="w">${esc(j.weight)}%</span>${j.desc ? `<p class="crit-desc">${esc(j.desc)}</p>` : ''}<div class="bar"><i data-w="${Math.min(100, Number(j.weight) / tw * 300).toFixed(1)}%"></i></div></div>`).join('');
  if (isSmall() || (panelState.rules || 0) >= .5) $$('#judging .bar i').forEach((b) => { b.style.width = b.dataset.w; });

  renderRegister();
  renderControl();
  renderTicker(); renderAlert();
  if (typeof refreshCardWidget === 'function') refreshCardWidget();
}
function setText(sel, txt) { const el = $(sel); el.textContent = txt || ''; el.dataset.final = txt || ''; }

function renderQuestion() {
  const q = C.question || {};
  const box = $('#questionBody');
  if (q.sealed !== false) {
    const when = q.revealAt ? fmtDate(q.revealAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    box.innerHTML = `<div class="qcard-state"><i></i>Sealed</div>
      <h2 class="display">The question is locked</h2>
      <p class="lead">${when ? `It unseals right here on <b>${esc(when)}</b>. Every team sees it at the same moment.` : 'The reveal time will be announced. Every team sees it at the same moment.'}</p>
      ${q.revealAt ? '<div class="qcount" id="qCount"></div>' : ''}
      <p class="note small">Keep this page open at reveal time. The card flips by itself.</p>`;
  } else {
    const li = (a) => (a || []).map((x) => `<li>${esc(x)}</li>`).join('');
    box.innerHTML = `<div class="qcard-state" style="color:var(--signal)"><i></i>Unsealed</div>
      ${q.sample ? '<span class="sample-tag">Sample · final question to be announced</span>' : ''}
      <h2 class="q-title">${esc(q.title)}</h2>
      <p class="lead">${esc(q.statement)}</p>
      ${q.context ? `<p class="small dim">${esc(q.context)}</p>` : ''}
      ${(q.requirements || []).length ? `<p class="q-sub">What you must do</p><ol class="q-list">${li(q.requirements)}</ol>` : ''}
      ${(q.deliverables || []).length ? `<p class="q-sub">Submit</p><ol class="q-list">${li(q.deliverables)}</ol>` : ''}`;
  }
  qLastDraw = 0; tick();
}

let schedDay = null;
function itemTime(it) {
  const m = /^(\d{4}-\d{2}-\d{2})T[\d:.]+(.*)$/.exec(C.event.startsAt || ''); if (!m || !/^\d{1,2}:\d{2}$/.test(it.time || '')) return NaN;
  const n = parseInt(String(it.day).replace(/\D/g, ''), 10) || 1;
  return Date.parse(`${m[1]}T${it.time.padStart(5, '0')}:00${m[2] || ''}`) + (n - 1) * 864e5;
}
function renderSchedule() {
  const items = C.schedule || []; const days = [...new Set(items.map((i) => i.day || 'Day 1'))];
  let nowIdx = -1; items.forEach((it, i) => { const t = itemTime(it); if (!isNaN(t) && t <= Date.now()) nowIdx = i; });
  if (Date.now() > Date.parse(C.event.endsAt) + 36e5) nowIdx = -1;
  if (!days.includes(schedDay)) schedDay = nowIdx >= 0 ? items[nowIdx].day : days[0];
  $('#dayTabs').innerHTML = days.length > 1 ? days.map((d) => `<button type="button" class="${d === schedDay ? 'on' : ''}">${esc(d)}</button>`).join('') : '';
  $$('#dayTabs button').forEach((b) => b.addEventListener('click', () => { schedDay = b.textContent; renderSchedule(); }));
  $('#timeline').innerHTML = items.map((it, i) => (it.day || days[0]) !== schedDay ? '' : `<li class="${esc(it.type || '')} ${i === nowIdx ? 'now' : ''}"><span class="t">${esc(it.time)}</span><div><b>${esc(it.title)}</b>${it.desc ? `<span>${esc(it.desc)}</span>` : ''}</div></li>`).join('');
  $('#scheduleNote').textContent = C.event.datesTentative ? 'Tentative timings. The final schedule will be updated here.' : '';
  $('#scheduleNote').hidden = !C.event.datesTentative;
}

function renderRegister() {
  const e = C.event; const btn = $('#regButton'); const nav = $('#navRegister');
  if (window.TECH_TANK_STATIC) {
    const external = /^https:\/\//.test(e.registerUrl || '') ? e.registerUrl : '#registration-info';
    [btn, nav, $('#navPortal')].forEach(a => { a.href = external; });
    btn.textContent = external.startsWith('https:') ? 'Register for the event' : 'Registration information';
    nav.textContent = 'Register'; $('#navPortal').hidden = true;
    $('#regText').textContent = 'Four hours to build. One unexpected twist. See registration information for participant access.';
    return;
  }
  const open = e.registrationOpen !== false; const closed = e.registrationDeadline && Date.now() > Date.parse(e.registrationDeadline);
  $('#regText').textContent = participantSignedIn ? 'Your question, event details and team progress are waiting in your participant portal.' : closed ? 'Registrations are closed. Existing participants can sign in to their portal.' : open ? `Create your participant account to register and access your portal. ${e.registrationDeadline ? 'Registrations close ' + fmtDate(e.registrationDeadline) + '.' : ''}` : 'Registrations open soon. Existing participants can sign in.';
  [btn, nav].forEach((a) => {
    a.removeAttribute('target'); a.classList.remove('off');
    a.href = participantSignedIn ? '/portal' : open && !closed ? '/register' : '/login';
  });
  btn.textContent = participantSignedIn ? 'Open my portal' : open && !closed ? 'Create account & register' : 'Participant sign in';
  nav.textContent = participantSignedIn ? 'My portal' : open && !closed ? 'Register' : 'Sign in';
  $('#navPortal').textContent = participantSignedIn ? 'My portal ↗' : 'Participant sign in';
  $('#navPortal').href = participantSignedIn ? '/portal' : '/login';
  $('#navPortal').hidden = participantSignedIn;
}

function countdownBoxes(iso, labels = ['Days', 'Hrs', 'Min', 'Sec']) {
  let s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
  const v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), Math.floor(s % 60)];
  return v.map((x, i) => `<div><b>${pad(x)}</b><span>${labels[i]}</span></div>`).join('');
}
let fetchingReveal = false;
function tick() {
  if (!C) return;
  const q = C.question || {};
  const qc = $('#qCount'); if (qc && q.revealAt) qc.innerHTML = countdownBoxes(q.revealAt);
  if (q.sealed !== false && q.revealAt && Date.now() >= Date.parse(q.revealAt) && !fetchingReveal) { fetchingReveal = true; setTimeout(() => { load().finally(() => { fetchingReveal = false; }); }, 1500); }
  const e = C.event; const box = $('#regCountdown');
  const now = Date.now(); const dl = Date.parse(e.registrationDeadline), st = Date.parse(e.startsAt);
  if (e.registrationOpen !== false && dl > now) box.innerHTML = `<div style="flex-basis:100%;border:0;background:none;padding:0"><p class="countdown-label">Registrations close in</p></div>` + countdownBoxes(e.registrationDeadline);
  else if (st > now) box.innerHTML = `<div style="flex-basis:100%;border:0;background:none;padding:0"><p class="countdown-label">Hacking starts in</p></div>` + countdownBoxes(e.startsAt);
  else box.innerHTML = '';
  box.style.flexWrap = 'wrap';
}
setInterval(tick, 1000);

/* control area */
function renderControl() {
  const qf = C.qualifiers || {};
  $('#qualifiers').hidden = !qf.published;
  $('#qualNote').textContent = qf.note || '';
  const list = qf.list || [];
  const qv = ($('#qualSearch').value || '').toLowerCase();
  $('#qualList').innerHTML = list.length ? list.map((x) => `<li class="${qv && (x.name + ' ' + (x.detail || '')).toLowerCase().includes(qv) ? 'match' : ''}"><b>${esc(x.name)}</b>${x.detail ? `<span>${esc(x.detail)}</span>` : ''}</li>`).join('') : '<li class="empty" style="grid-column:1/-1">The list will appear here.</li>';

  const r = C.results || {};
  $('#results').hidden = !r.published;
  if (r.published) {
    $('#resultsNote').textContent = r.note || '';
    $('#winners').innerHTML = (r.winners || []).filter((w) => w.team).map((w) => `<div class="winner"><span>${esc(w.award)}</span><b>${esc(w.team)}</b></div>`).join('');
    const crit = C.judging || [];
    const rows = (C.teams || []).map((t) => ({ ...t, total: Math.round(crit.reduce((a, j) => a + (Number((t.scores || {})[j.name]) || 0) / 10 * Number(j.weight || 0), 0) * 10) / 10 })).sort((a, b) => b.total - a.total);
    const tr = (id) => (C.tracks || []).find((t) => t.id === id) || { name: '', color: '#8f99b3' };
    $('#board').innerHTML = rows.length ? rows.map((t, i) => `<div class="row ${i === 0 ? 'first' : ''}" style="--c:${esc(tr(t.track).color)}"><span class="rk">${pad(i + 1)}</span><div class="nm"><b>${esc(t.name)}</b><span>${esc(tr(t.track).name)}</span></div><div class="bar"><i style="width:${t.total}%"></i></div><span class="tot">${t.total.toFixed(1)}</span></div>`).join('') : '<div class="empty">No scores yet.</div>';
  }

  renderTwistSummary();

  $('#faqList').innerHTML = (C.faq || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  $('#faq').hidden = !(C.faq || []).length;
  $('#footerTag').textContent = C.event.tagline || '';
  $('#committee').innerHTML = (C.committee || []).map((n) => `<span>${esc(n)}</span>`).join('');
  const e = C.event; const links = [];
  if (e.contactEmail) links.push(`<span>${esc(e.contactEmail)}</span>`);
  if (e.instagram) links.push(`<a href="${esc(/^https?:/.test(e.instagram) ? e.instagram : 'https://instagram.com/' + e.instagram.replace('@', ''))}" target="_blank" rel="noopener">Instagram ${esc(e.instagram.startsWith('@') ? e.instagram : '')}</a>`);
  links.push('<a href="#registration-info">Participant registration</a><a href="#registration-info">My participant portal ↗</a>');
  $('#contact').innerHTML = links.join('') || '<span class="dim" style="color:var(--dim)">Contact details coming soon.</span>';
  $('#updated').textContent = C.updatedAt ? 'Last updated ' + new Date(C.updatedAt).toLocaleString() : '';
}
function renderTwistSummary() {
  const twist = C.crisis || {};
  const sealed = twist.sealed !== false;
  $('#twistSummaryTitle').textContent = sealed ? 'The twist is sealed' : twist.title || 'The twist is live';
  $('#twistSummary').classList.toggle('is-sealed', sealed);
  $('#twistSummaryContent').innerHTML = sealed
    ? '<p class="lead">' + (twist.revealAt ? 'The twist unlocks on ' + esc(fmtDate(twist.revealAt)) + '.' : 'The organisers will announce the reveal. Be ready to adapt.') + '</p><p class="note">Every team faces the unexpected during the four-hour build.</p>'
    : '<p class="lead">' + esc(twist.statement || twist.intro || '') + '</p>' + (twist.statement && twist.intro ? '<p class="note">' + esc(twist.intro) + '</p>' : '') + '<ul class="tests">' + (twist.tests || []).map((test) => '<li>' + esc(test) + '</li>').join('') + '</ul><a class="btn-ghost" href="#registration-info">View your team’s twist ↗</a>';
}
$('#qualSearch').addEventListener('input', () => renderControl());

const ytId = (u) => { const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(u || ''); return m && m[1]; };
/* track brief: opened from the list or by clicking a floating track card */
let tmI = 0;
function openTrack(i) {
  const ts = C.tracks || []; if (!ts.length) return; tmI = (i + ts.length) % ts.length; const t = ts[tmI];
  $('.tm-box').style.setProperty('--c', t.color || '#40d6ff');
  $('#tmBody').innerHTML = `<p class="tm-n">Track ${tmI + 1} of ${ts.length}</p><h3 id="tmTitle">${esc(t.name)}</h3>
    <p class="tm-lead">${esc(t.about || t.description)}</p>
    ${(t.areas || []).length ? `<h4>Focus areas</h4><div class="tm-chips">${t.areas.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
    ${(t.examples || []).length ? `<h4>Ideas to get you started</h4><ul class="tm-ex">${t.examples.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${t.lookFor ? `<h4>What judges look for</h4><p class="tm-look">${esc(t.lookFor)}</p>` : ''}`;
  $('#trackModal').hidden = false; $('#tmClose').focus({ preventScroll: true });
}
const closeTrack = () => { $('#trackModal').hidden = true; };
$('#tmClose').onclick = closeTrack; $('#tmPrev').onclick = () => openTrack(tmI - 1); $('#tmNext').onclick = () => openTrack(tmI + 1);
$('#trackModal').addEventListener('click', (e) => { if (e.target.id === 'trackModal') closeTrack(); });
addEventListener('keydown', (e) => { if ($('#trackModal').hidden) return; if (e.key === 'Escape') closeTrack(); if (e.key === 'ArrowLeft') openTrack(tmI - 1); if (e.key === 'ArrowRight') openTrack(tmI + 1); });

// clicking a floating track card in the 3D world
const ray = window.THREE ? new THREE.Raycaster() : null; const ndc = window.THREE ? new THREE.Vector2() : null;
function tileAt(x, y) {
  if (!three || !ray) return null;
  const vis = W3.tiles.children.filter((m) => m.visible && m.material.opacity > .2); if (!vis.length) return null;
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(vis)[0]; return hit ? hit.object : null;
}
const UI_SEL = 'a,button,input,summary,.panel,#control,.lightbox,.track-modal,.hud-top,.stations,.alert-modal,.alert-bar';
addEventListener('click', (e) => { if (e.target.closest(UI_SEL)) return; const t = tileAt(e.clientX, e.clientY); if (t) openTrack(t.userData.i); });
let hoverTile = -1;
addEventListener('pointermove', (e) => {
  const t = e.target.closest(UI_SEL) ? null : tileAt(e.clientX, e.clientY);
  const n = t ? t.userData.i : -1; if (n !== hoverTile) { hoverTile = n; document.body.style.cursor = n >= 0 ? 'pointer' : ''; }
}, { passive: true });

let lbI = 0, lbId = null, lbReturnFocus = null;
function cardWidget(it) {
  const e = C.event, c = C.crisis || {}, q = C.question || {}, p = C.portal || {};
  const list = (items) => `<ul class="widget-list">${(items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const heading = (title) => `<h2 id="cardWidgetTitle">${esc(title)}</h2>`;
  const portalLink = '<a class="btn-ghost widget-link" href="#registration-info">Open my participant portal</a>';
  const locked = (title, time) => heading(title) + `<p class="widget-status">SEALED</p><p>${time ? 'Scheduled release: ' + esc(fmtDate(time)) + '.' : 'The organisers have not published this yet.'}</p><p>Details appear here automatically when released.</p>`;
  switch (it.topic) {
    case 'twist': return c.sealed ? locked('The twist is sealed', c.revealAt) : heading(c.title || 'The twist') + `<p class="widget-status">PUBLISHED</p><p>${esc(c.statement || c.intro)}</p>${c.statement && c.intro ? `<p>${esc(c.intro)}</p>` : ''}${list(c.tests)}<p>Your team’s assigned scenario is available in your participant portal.</p>${portalLink}`;
    case 'theme': return heading(e.theme || 'Event theme') + `<p>${esc(e.about)}</p><div class="widget-stats">${(e.stats || []).map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>${C.aiNote ? `<p>${esc(C.aiNote)}</p>` : ''}`;
    case 'campaign': return heading(e.campaign || e.name) + `<p>${esc(e.tagline)}</p><p>${esc(e.about)}</p><p>${esc(e.venue || 'Venue to be announced')}</p><p>${esc(fmtDate(e.startsAt))}</p>${portalLink}`;
    case 'question': return q.sealed !== false ? locked('The question is sealed', q.revealAt) : heading(q.title || 'The question') + `<p>${esc(q.statement)}</p><p>${esc(q.context)}</p><h3>Requirements</h3>${list(q.requirements)}<h3>Deliverables</h3>${list(q.deliverables)}${portalLink}`;
    case 'rules': return heading('Rules & judging') + list(C.rules) + '<h3>Judging criteria</h3>' + (C.judging || []).map((j) => `<p><b>${esc(j.name)} · ${esc(j.weight)}%</b><br>${esc(j.desc)}</p>`).join('');
    case 'presentation': return heading('Presentation format') + `<p><b>${esc(p.demoMinutes ?? 3)} minutes</b> to present, followed by <b>${esc(p.qaMinutes ?? 2)} minutes</b> of questions.</p><p>${esc(p.presentationIntro)}</p><p>${esc(p.presentationNotes)}</p>${list(p.parameters)}${portalLink}`;
    case 'schedule': return heading('Event schedule') + (C.schedule || []).map((s) => `<p><b>${esc(s.day)} · ${esc(s.time)} — ${esc(s.title)}</b><br>${esc(s.desc)}</p>`).join('');
    case 'results': return heading('Results') + `<p>${C.results?.published ? esc(C.results.note || 'The latest results are published.') : 'Results have not been published yet.'}</p>${portalLink}`;
    default: {
      const yt = ytId(it.url);
      return heading(it.caption || 'Event update') + `<p>${esc(it.details || 'An update from the Tech Tank event team.')}</p>${it.type === 'video' ? `<video src="${esc(it.url)}" controls playsinline preload="metadata"></video>` : yt ? `<iframe src="https://www.youtube.com/embed/${esc(yt)}" title="${esc(it.caption || 'Event video')}" allowfullscreen></iframe>` : ''}${portalLink}`;
    }
  }
}
function openLb(i, focus = true) {
  const media = C.media || []; if (!media.length) return;
  lbI = (i + media.length) % media.length; const it = media[lbI]; lbId = it.id;
  if ($('#lightbox').hidden) lbReturnFocus = document.activeElement;
  $('#lbStage').innerHTML = cardWidget(it);
  $('#lbCap').textContent = `Card ${lbI + 1} of ${media.length}`;
  $('#lbPrev').hidden = $('#lbNext').hidden = media.length < 2;
  $('#lightbox').hidden = false;
  document.body.classList.add('card-widget-open');
  if (focus) $('#lbClose').focus({ preventScroll: true });
}
function refreshCardWidget() {
  if ($('#lightbox').hidden) return;
  const index = (C.media || []).findIndex((m) => m.id === lbId);
  if (index < 0) closeLb(); else openLb(index, false);
}
const closeLb = () => { $('#lightbox').hidden = true; $('#lbStage').innerHTML = ''; document.body.classList.remove('card-widget-open'); const target = lbReturnFocus?.isConnected ? lbReturnFocus : $$('.g-item')[lbI]; target?.focus({ preventScroll: true }); };
$('#lbClose').onclick = closeLb; $('#lbPrev').onclick = () => openLb(lbI - 1); $('#lbNext').onclick = () => openLb(lbI + 1);
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLb(); });
addEventListener('keydown', (e) => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') openLb(lbI - 1);
  if (e.key === 'ArrowRight') openLb(lbI + 1);
  if (e.key === 'Tab') {
    const controls = [...$('#lightbox').querySelectorAll('button:not([hidden]),a[href],video[controls],iframe')];
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

function renderTicker() {
  const a = (C.announcements || []).filter((x) => x.text);
  const html = a.map((x) => `<p class="event-update"><b>${x.time ? esc(x.time) : 'Update'}</b><span>${esc(x.text)}</span></p>`).join('');
  $('#tickerTrack').innerHTML = html; $('#ticker').hidden = !a.length;
}
let lastAlertId = null;
function renderAlert() {
  const a = C.alert || {}; const bar = $('#alertBar');
  bar.hidden = !a.active; if (!a.active) { $('#alertModal').hidden = true; return; }
  $('#alertBarText').textContent = `${a.title || 'Alert'}${a.message ? ' · ' + a.message : ''}`;
  bar.style.background = a.level === 'AMBER' ? 'var(--amber)' : a.level === 'INFO' ? 'var(--signal)' : 'var(--red)';
  bar.style.color = a.level === 'RED' || !a.level ? '#fff' : '#05070d';
  let acked = false; try { acked = sessionStorage.getItem('tt-alert') === a.id; } catch {}
  if (!acked && a.id !== lastAlertId) {
    const box = $('.alert-box'); box.className = 'alert-box ' + (a.level === 'AMBER' ? 'amber' : a.level === 'INFO' ? 'info' : '');
    $('#alertLevel').textContent = a.level === 'INFO' ? 'ANNOUNCEMENT' : a.level === 'AMBER' ? 'HEADS UP' : 'ALERT · LEVEL RED';
    $('#alertTitle').textContent = a.title || ''; $('#alertMsg').textContent = a.message || ''; $('#alertModal').hidden = false;
  }
  lastAlertId = a.id;
}
$('#alertClose').onclick = () => { $('#alertModal').hidden = true; try { sessionStorage.setItem('tt-alert', C.alert.id); } catch {} };
$('#alertBar').onclick = () => { lastAlertId = null; try { sessionStorage.removeItem('tt-alert'); } catch {} renderAlert(); };

let contentJSON = '';
let contentRevision = 0;
let pendingLoad = null;
function applyContent(content) {
  if (!content || !content.event) throw new Error('Invalid event content');
  const next = JSON.stringify(content);
  if (next === contentJSON) return;
  C = content;
  renderAll();
  contentJSON = next;
  contentRevision++;
  $('#contentError')?.remove();
}
function load() {
  if (pendingLoad) return pendingLoad;
  const revision = contentRevision;
  pendingLoad = (async () => {
    const res = await fetch('./content.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Could not load event content');
    const content = await res.json();
    // A live update received during the request is newer than this response.
    if (revision === contentRevision) applyContent(content);
  })().finally(() => { pendingLoad = null; });
  return pendingLoad;
}

/* ======================= BOOT ======================= */
(async () => {
  buildStations();
  $('#brand').addEventListener('click', (e) => { e.preventDefault(); goTo(STATIONS[0]); });
  three = initStage();
  if (!three) document.body.classList.add('no3d');
  try { await load(); } catch { document.body.insertAdjacentHTML('afterbegin', '<p id="contentError" role="status" style="position:fixed;z-index:200;top:70px;left:16px;color:#ff4d5e">Could not load event content. Retrying…</p>'); }
  const refreshAccount = () => fetch('/api/account', { cache: 'no-store' }).then((res) => { participantSignedIn = res.ok; if (C) renderRegister(); }).catch(() => {});
  if (!window.TECH_TANK_STATIC) refreshAccount();
  document.addEventListener('visibilitychange', () => { if (!window.TECH_TANK_STATIC && !document.hidden) refreshAccount(); });
  if (document.fonts) document.fonts.ready.then(() => { if (C) { buildTiles(); qLastDraw = 0; } });
  readScroll(); P = target;
  requestAnimationFrame(frame);
  if (!window.TECH_TANK_STATIC && 'EventSource' in window) {
    const es = new EventSource('/api/stream');
    es.addEventListener('content', (ev) => { try { applyContent(JSON.parse(ev.data)); } catch { load().catch(() => {}); } });
  }
  // Recover after sleeping, losing connectivity, or a host that buffers SSE.
  const refresh = () => { if (!document.hidden) load().catch(() => {}); };
  addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 15000);
  setInterval(() => { if (C) renderSchedule(); }, 60000);
})();
})();
