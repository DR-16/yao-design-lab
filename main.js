import * as THREE from 'three';
import { Reflector } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/Reflector.js';

// ---------- Setup ----------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 9.5);

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xff9a6b, 0.8);
rim.position.set(-4, 1, -3);
scene.add(rim);
const fillBelow = new THREE.PointLight(0xffb347, 1.2, 12);
fillBelow.position.set(0, -2.2, 1.5);
scene.add(fillBelow);

// ---------- Flame (shader-based) ----------
const flameGroup = new THREE.Group();
scene.add(flameGroup);

const flameUniforms = {
  uTime: { value: 0 },
  uIntensity: { value: 0.55 },
};

const flameMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  uniforms: flameUniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uIntensity;

    // hash + value noise
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f*f*(3.0 - 2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    float fbm(vec2 p){
      float v = 0.0;
      float a = 0.5;
      for(int i=0;i<6;i++){
        v += a * noise(p);
        p = p * 2.07 + vec2(3.1, 1.7);
        a *= 0.52;
      }
      return v;
    }

    void main(){
      vec2 uv = vUv;
      vec2 p = vec2(uv.x - 0.5, uv.y);

      // upward-flowing noise — chaotic, multi-octave
      float t = uTime * 0.55;
      vec2 q1 = vec2(uv.x * 2.6, uv.y * 1.8 - t * 1.3);
      vec2 q2 = vec2(uv.x * 5.0 + 12.3, uv.y * 3.2 - t * 2.2);
      float n1 = fbm(q1);
      float n2 = fbm(q2 + n1 * 1.4);
      float n  = mix(n1, n2, 0.55);

      // distort horizontal coord by noise so the silhouette is jagged
      float distort = (fbm(vec2(uv.y * 2.0 - t, uv.x * 1.2)) - 0.5) * 0.55;
      float xN = p.x + distort * (0.4 + uv.y * 0.9);

      // base envelope: rises like flame but with wandering centerline
      float wander = (fbm(vec2(uv.y * 1.6 - t * 0.8, 7.0)) - 0.5) * 0.35;
      float dx = abs(xN - wander);
      float envWidth = mix(0.42, 0.06, pow(uv.y, 0.85));
      float silhouette = 1.0 - smoothstep(envWidth * 0.55, envWidth * 1.15, dx);

      // chew the silhouette with noise — produces tongues and detached wisps
      float bite = smoothstep(0.25, 0.85, n);
      float mask = silhouette * bite;

      // detached upper wisps
      float wisps = smoothstep(0.55, 0.95, fbm(vec2(uv.x * 3.5 + 4.0, uv.y * 4.0 - t * 2.6)));
      wisps *= smoothstep(0.0, 0.35, uv.y) * smoothstep(1.0, 0.4, uv.y);
      mask = max(mask, wisps * 0.55 * silhouette);

      // bottom rooted, top dissolves into smoke
      mask *= smoothstep(0.0, 0.06, uv.y);
      mask *= smoothstep(1.0, 0.35, uv.y);
      mask = pow(clamp(mask, 0.0, 1.0), 1.25);

      // ---- LIQUID CHROME — high-contrast black & white mercury ----
      // heavy domain warping creates the swirly bulbous chrome shapes
      vec2 q = vec2(uv.x * 2.8 + 13.0, uv.y * 2.2 - t * 0.32);
      float w1 = fbm(q * 1.3);
      float w2 = fbm(q * 1.3 + vec2(5.2, 1.7));
      vec2 warp = (vec2(w1, w2) - 0.5) * 3.2;
      float surf = fbm(q + warp);
      float surf2 = fbm(vec2(uv.x * 6.5 - t * 0.55, uv.y * 5.0 + 5.0) + warp * 0.7);
      surf = mix(surf, surf2, 0.45);

      // aggressively polarize: collapse most pixels to either pure black or pure white
      surf = smoothstep(0.32, 0.62, surf);

      // hard near-binary mapping — narrow smoothstep keeps edges crisp like the ref
      vec3 cVoid   = vec3(0.0);
      vec3 cThin   = vec3(0.15);  // thin sliver of mid grey only at edge of pools
      vec3 cBright = vec3(0.92);
      vec3 cWhite  = vec3(1.0);

      vec3 col = cVoid;
      col = mix(col, cThin,   smoothstep(0.34, 0.42, surf));
      col = mix(col, cBright, smoothstep(0.46, 0.55, surf));
      col = mix(col, cWhite,  smoothstep(0.68, 0.78, surf));

      // sharp specular streaks — extra white pops where sheen noise spikes
      float sheen = fbm(vec2(uv.x * 10.0, uv.y * 7.0 - t * 1.3) + warp * 0.4);
      float streak = smoothstep(0.75, 0.92, sheen);
      col = mix(col, cWhite, streak * 0.8);

      // dark inner pools — extra black where surf is low → deepens shadow areas
      float pool = 1.0 - smoothstep(0.0, 0.22, surf);
      col = mix(col, cVoid, pool * 0.95);

      // black rim around the silhouette so the chrome "ends" sharply
      float edgeProx = clamp(dx / (envWidth * 1.1), 0.0, 1.0);
      float rim = pow(edgeProx, 1.8);
      col = mix(col, cVoid, rim * 0.85);

      float a = mask * uIntensity;
      a = clamp(a * 1.6, 0.0, 1.0);

      if (a < 0.01) discard;
      gl_FragColor = vec4(col, a);
    }
  `,
});

const flameGeo = new THREE.PlaneGeometry(3.6, 6.2, 1, 1);
const flameMesh = new THREE.Mesh(flameGeo, flameMat);
flameMesh.position.set(0, 0.4, -0.4); // taller so it pokes through the rings
flameGroup.add(flameMesh);

// glow disc behind flame
const glowMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  uniforms: { uTime: flameUniforms.uTime },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main(){
      vec2 p = vUv - 0.5;
      float d = length(p);
      // soft dark halo so the chrome reads against the bright stripes
      float a = smoothstep(0.5, 0.0, d) * 0.45;
      gl_FragColor = vec4(vec3(0.0), a);
    }
  `,
});
const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), glowMat);
glowMesh.position.set(0, -0.2, -0.9);
flameGroup.add(glowMesh);

flameGroup.position.y = -0.4;
flameGroup.scale.setScalar(1.0);
// Homepage restructure: the flame model + glowing chip labels + "Four burns" card
// were removed. Keep the THREE.Group + uniforms intact so the existing animation
// loop and About-view transitions don't have to be unpicked — just hide the group
// from the render pass so it adds no visual cost beyond the uTime update.
flameGroup.visible = false;

// ---------- Cylinder: 3 hollow rotating rings ----------
const cylinderGroup = new THREE.Group();
scene.add(cylinderGroup);

function makeRingTexture(lines, opts = {}) {
  const W = 2048, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // metallic silver gradient background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#e9e9ee');
  g.addColorStop(0.45, '#bcbcc2');
  g.addColorStop(0.55, '#d8d8de');
  g.addColorStop(1.0, '#9b9ba2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // subtle scan lines for metal feel
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = 1;

  // top + bottom dark edge
  const edge = ctx.createLinearGradient(0, 0, 0, H);
  edge.addColorStop(0.0, 'rgba(0,0,0,0.45)');
  edge.addColorStop(0.08, 'rgba(0,0,0,0)');
  edge.addColorStop(0.92, 'rgba(0,0,0,0)');
  edge.addColorStop(1.0, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);

  // text
  ctx.fillStyle = '#0b0b0c';
  ctx.textBaseline = 'middle';
  const fontSize = opts.fontSize || 110;
  ctx.font = `${opts.weight || 700} ${fontSize}px "Helvetica Neue", Arial, "PingFang SC", sans-serif`;
  ctx.textAlign = 'left';

  // tile the line(s) across the ring with spacing
  const text = lines.join('   ·   ') + '   ·   ';
  const measure = ctx.measureText(text).width;
  // pick a repeat count that fits roughly
  const repeats = Math.max(1, Math.round(W / measure));
  const unit = W / repeats;
  for (let i = 0; i < repeats; i++) {
    ctx.fillText(text, i * unit + 20, H / 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const RING_RADIUS = 1.75;
const RING_HEIGHT = 0.78;
const RING_GAP = 0.025;

const ringSpecs = [
  {
    y: RING_HEIGHT + RING_GAP,
    text: ['WHO I AM'],
    speed: 0.06,
  },
  {
    y: 0,
    text: ['WHY THIS LAB EXISTS'],
    speed: -0.04,
  },
  {
    y: -(RING_HEIGHT + RING_GAP),
    text: ['FIRE AHEAD'],
    speed: 0.03,
  },
];

const rings = ringSpecs.map((spec) => {
  const tex = makeRingTexture(spec.text);
  // hollow cylinder: open-ended, two-sided
  const geo = new THREE.CylinderGeometry(
    RING_RADIUS, RING_RADIUS, RING_HEIGHT, 128, 1, true
  );
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    side: THREE.DoubleSide,
    metalness: 0.85,
    roughness: 0.35,
    envMapIntensity: 1.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = spec.y;
  cylinderGroup.add(mesh);
  return { mesh, speed: spec.speed, baseY: spec.y };
});

// subtle env via a fake gradient (no HDR needed)
function makeEnvTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.5, '#aaa');
  g.addColorStop(1, '#222');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
const envTex = makeEnvTexture();
scene.environment = envTex;

cylinderGroup.position.y = -0.7;
cylinderGroup.rotation.x = -0.16;

// ---------- Drag interaction (rotate rings) ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = null; // { ring, lastX }
const cursorEl = document.getElementById('cursor');

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

window.addEventListener('pointermove', (e) => {
  setPointer(e);
  cursorEl.style.left = e.clientX + 'px';
  cursorEl.style.top = e.clientY + 'px';
  cursorEl.classList.add('visible');

  if (dragging) {
    const dx = e.clientX - dragging.lastX;
    dragging.ring.mesh.rotation.y += dx * 0.008;
    dragging.lastX = e.clientX;
    return;
  }

  // hover detection
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(rings.map(r => r.mesh), false)[0];
  cursorEl.classList.toggle('drag', !!hit);
});

window.addEventListener('pointerdown', (e) => {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(rings.map(r => r.mesh), false)[0];
  if (hit) {
    const ring = rings.find(r => r.mesh === hit.object);
    dragging = { ring, lastX: e.clientX };
    cursorEl.classList.add('drag');
  }
});

window.addEventListener('pointerup', () => {
  dragging = null;
});

// hide cursor halo when the pointer leaves the browser window, show it again on re-entry
document.addEventListener('mouseleave', () => cursorEl.classList.remove('visible'));
document.addEventListener('mouseenter', () => cursorEl.classList.add('visible'));
window.addEventListener('blur', () => cursorEl.classList.remove('visible'));

// ---------- Scroll-driven animation ----------
// `categoriesEl` previously toggled the orbiting "Economy / Emotion / Welfare /
// Creative" ember chips. The chips were removed in the editorial restructure;
// the query stays as `null` so existing toggle sites can short-circuit.
const categoriesEl = document.querySelector('.categories');
let scrollProgress = 0; // 0→1 across first viewport: cylinder rises, flame grows
let exitProgress = 0;   // 0→1 across second viewport: flame fades so work text shows

// background stripes (CSS) — updated on scroll for parallax.
// 1 + 3 share one direction (rotated -22°), 2 + 4 share the other (rotated +22°).
const stripeEls = [
  { el: document.querySelector('.bg-stripe-1'), rot: -22, speed: -0.35, offset: 0 },
  { el: document.querySelector('.bg-stripe-2'), rot:  22, speed:  0.35, offset: 0 },
  { el: document.querySelector('.bg-stripe-3'), rot: -22, speed: -0.55, offset: 0 },
  { el: document.querySelector('.bg-stripe-4'), rot:  22, speed:  0.55, offset: 0 },
];
function updateStripes() {
  const y = window.scrollY;
  for (const s of stripeEls) {
    if (!s.el) continue;
    s.el.style.transform = `translate3d(0, ${s.offset + y * s.speed}px, 0) rotate(${s.rot}deg)`;
  }
}
updateStripes();

function updateScroll() {
  const h = window.innerHeight;
  scrollProgress = Math.min(1, Math.max(0, window.scrollY / h));
  exitProgress = Math.min(1, Math.max(0, (window.scrollY - h) / h));
  updateStripes();
}
updateScroll();
window.addEventListener('scroll', () => {
  updateScroll();
  renderOnce();
}, { passive: true });

// ---------- Resize ----------
// Responsive baseline: as the viewport gets taller / bigger, push the cylinder down
// and pull the camera back a bit so the title has breathing room above it.
let responsiveCylinderY = -0.7;
let responsiveCamZ = 9.5;

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;

  camera.aspect = aspect;

  // taller viewport (smaller aspect, more vertical pixels) → camera farther + cylinder lower
  const tallness = Math.max(0, Math.min(1.5, (1.6 - aspect)));   // 0 on widescreen, ~1 on portrait/tall
  const bigness  = Math.max(0, Math.min(1.5, (h - 800) / 600));  // 0 at 800px tall, 1 at 1400px+
  responsiveCamZ = 9.5 + tallness * 2.5 + bigness * 1.2;
  responsiveCylinderY = -0.7 - tallness * 0.5 - bigness * 0.45;

  camera.position.z = responsiveCamZ;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// ---------- Animate ----------
const clock = new THREE.Clock();

function applyState(dt) {
  const t = clock.elapsedTime;
  flameUniforms.uTime.value = t;

  rings.forEach((r) => {
    if (!dragging || dragging.ring !== r) {
      r.mesh.rotation.y += r.speed * dt;
    }
  });

  const p = scrollProgress;
  const ease = p * p * (3 - 2 * p);

  cylinderGroup.position.y = responsiveCylinderY + ease * 6.2;
  cylinderGroup.scale.setScalar(1 - ease * 0.2);
  rings.forEach(r => {
    r.mesh.material.opacity = 1 - ease;
    r.mesh.material.transparent = ease > 0.001;
  });

  const heroEl = document.querySelector('.hero-text');
  if (heroEl) {
    heroEl.style.opacity = String(1 - Math.min(1, ease * 1.4));
    heroEl.style.transform = `translate(-50%, ${-ease * 60}px)`;
  }

  // exit fade: as user scrolls past hero into work, flame drops + dims
  // but stays visible at the bottom of the work section as atmosphere
  const xp = exitProgress;
  const exitEase = xp * xp * (3 - 2 * xp);

  const flameScale = (1.0 + ease * 1.6) * (1 - exitEase * 0.25);
  flameGroup.scale.setScalar(flameScale);

  // gentle drift so the flame doesn't feel anchored to centre — stays centred at exit too
  const drift = Math.sin(t * 0.4) * 0.35 + Math.cos(t * 0.27) * 0.18;
  flameGroup.position.x = drift;
  flameGroup.position.y = -0.4 + ease * 0.7 - exitEase * 1.6;
  flameUniforms.uIntensity.value = (0.65 + ease * 0.55) * (1 - exitEase * 0.45);

  if (categoriesEl) {
    if (ease > 0.75 && exitEase < 0.5) categoriesEl.classList.add('visible');
    else categoriesEl.classList.remove('visible');
  }

  // Suspend the gentle pointer-parallax while a camera push animation owns
  // the hero camera (entering About). The tween below sets camera.position
  // and we don't want this loop fighting it.
  if (!__heroTransiting) {
    camera.position.x += (pointer.x * 0.4 - camera.position.x) * 0.04;
    camera.position.y += (pointer.y * 0.25 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
  }
}

let __heroTransiting = false;

// Real dolly-in: tween the hero camera from where it is now to a position
// pressed right up against the clicked ring, looking AT that ring. Eased
// ease-in so it feels like accelerating into the ring.
function playCameraPushToRing(ringIdx, duration, done) {
  const ringMesh = (rings[ringIdx] || rings[0]).mesh;
  const target = new THREE.Vector3();
  ringMesh.getWorldPosition(target);
  // landing pose: 1.0 unit in front of the ring centre, at the same height
  const targetPos = target.clone().add(new THREE.Vector3(0, 0, 1.0));
  const startPos  = camera.position.clone();
  __heroTransiting = true;
  const t0 = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - t0) / duration);
    // accelerating ease-in (t^2): slow start, smashes into the ring
    const k = t * t;
    camera.position.lerpVectors(startPos, targetPos, k);
    camera.lookAt(target);
    if (t < 1) requestAnimationFrame(tick);
    else if (done) done();
  }
  requestAnimationFrame(tick);
}

function renderOnce() {
  applyState(0);
  renderer.render(scene, camera);
}

function tick() {
  const dt = clock.getDelta();
  applyState(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// Fallback: also tick on a setInterval in case rAF gets throttled (hidden tabs).
setInterval(() => {
  if (document.hidden) {
    const dt = clock.getDelta();
    applyState(dt);
    renderer.render(scene, camera);
  }
}, 100);

// ---------- Editorial signage reveal ----------
// FOUR BURNS / FOUR LANGUAGES / FOUR ELEMENTS / ONE FLAME — each .ed-line
// fades + rises into place when its centre enters the viewport. The final
// "ONE FLAME" line lights with the accent colour once revealed.
const edLines = Array.from(document.querySelectorAll('.ed-line'));
if (edLines.length) {
  const edObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
      } else if (e.boundingClientRect.top > window.innerHeight) {
        // user scrolled back above; allow re-reveal on next downward pass
        e.target.classList.remove('revealed');
      }
    }
  }, { threshold: 0.45 });
  edLines.forEach((el) => edObserver.observe(el));
}

// ---------- Exhibition coverflow carousels ----------
// Each .ex-stack is a horizontal scroller; per-cover transforms are written
// every scroll frame so the card sitting at the stack's centre stands
// forward and flat, while cards on either side rotate Y, push back in Z,
// shrink, and dim — the "fan blade" pose with real depth, not flat cards.
document.querySelectorAll('.ex-stack').forEach((stack) => {
  const covers = stack.querySelectorAll('.cover');
  if (!covers.length) return;

  let raf = 0;
  function update() {
    raf = 0;
    const rect = stack.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    // half-window over which a card transitions from focused → fully fanned
    const range = rect.width * 0.45;
    covers.forEach((c) => {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      let t = (cx - centerX) / range;       // -1 (left edge) .. +1 (right edge)
      if (t < -1.6) t = -1.6;
      if (t >  1.6) t =  1.6;
      const abs = Math.abs(t);
      const ry  = -t * 38;                  // tilt out toward viewer
      const tz  = -abs * 220;               // push back as it leaves centre
      const tx  = -t * 30;                  // pull side cards slightly outward
      const sc  = 1 - abs * 0.22;
      const op  = Math.max(0.22, 1 - abs * 0.5);
      c.style.transform =
        `translate3d(${tx}px, 0, ${tz}px) rotateY(${ry}deg) scale(${sc})`;
      c.style.opacity = String(op);
      // z-index so the focused card actually paints over its neighbours
      c.style.zIndex = String(100 - Math.round(abs * 50));
    });
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }
  stack.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // initial pose — wait one frame so layout has settled (padding-inline etc.)
  requestAnimationFrame(update);
});

// =====================================================================
// ABOUT VIEW — triggered when user clicks the top cylinder ring (WHO I AM).
// A separate WebGL scene (liquid-glass flame + particle portrait) renders into
// #aboutStage canvas. A CSS-3D spiral staircase of text rotates in sync with
// the user's scroll inside .about-scroll.
// =====================================================================
const aboutCanvas = document.getElementById('aboutStage');
const aboutView   = document.getElementById('aboutView');
const aboutClose  = document.getElementById('aboutClose');
const aboutScroll = document.getElementById('aboutScroll');
const aboutHint   = document.getElementById('aboutHint');
const staircaseRotor = document.getElementById('staircaseRotor');

const aboutRenderer = new THREE.WebGLRenderer({
  canvas: aboutCanvas,
  antialias: true,
  alpha: true,
});
aboutRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
aboutRenderer.setSize(window.innerWidth, window.innerHeight);
aboutRenderer.outputColorSpace = THREE.SRGBColorSpace;
// ACES filmic tone mapping — compresses HDR highlights into the displayable
// range with a smooth roll-off. Critical for polished metal: without it,
// bright env reflections clip hard to pure white and the chrome reads as
// plastic. With ACES the highlights have natural cinematic falloff.
aboutRenderer.toneMapping = THREE.ACESFilmicToneMapping;
aboutRenderer.toneMappingExposure = 1.0;

const aboutScene  = new THREE.Scene();
const aboutCam    = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
aboutCam.position.set(0, 0, 3);

aboutScene.add(new THREE.AmbientLight(0xffffff, 0.6));
const aboutKey = new THREE.PointLight(0xc0d8ff, 1.1, 30);
aboutKey.position.set(2, 3, 4);
aboutScene.add(aboutKey);

// ---------- Liquid-glass flame ----------
const glassUniforms = {
  uTime: { value: 0 },
  uIntensity: { value: 0.55 },
};
const glassMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  uniforms: glassUniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uIntensity;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f*f*(3.0 - 2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.07 + vec2(3.1,1.7); a *= 0.52; }
      return v;
    }
    void main(){
      vec2 uv = vUv;
      vec2 p = vec2(uv.x - 0.5, uv.y);
      float t = uTime * 0.45;

      // flame silhouette (same as main chrome flame)
      vec2 q1 = vec2(uv.x*2.6, uv.y*1.8 - t*1.3);
      float n1 = fbm(q1);
      float wander = (fbm(vec2(uv.y*1.6 - t*0.8, 7.0)) - 0.5) * 0.32;
      float dx = abs(p.x - wander);
      float envWidth = mix(0.4, 0.06, pow(uv.y, 0.85));
      float silhouette = 1.0 - smoothstep(envWidth*0.55, envWidth*1.15, dx);
      float bite = smoothstep(0.25, 0.85, n1);
      float mask = silhouette * bite;
      mask *= smoothstep(0.0, 0.06, uv.y);
      mask *= smoothstep(1.0, 0.35, uv.y);
      mask = pow(clamp(mask, 0.0, 1.0), 1.2);

      // ---- Liquid GLASS look ----
      // domain-warped low-frequency noise for the smooth glass surface
      vec2 g = vec2(uv.x*2.2, uv.y*1.6 - t*0.6);
      float w1 = fbm(g);
      float w2 = fbm(g + vec2(3.2, 1.1));
      vec2 warp = (vec2(w1, w2) - 0.5) * 1.2;
      float surf = fbm(g + warp);
      float sheen = fbm(vec2(uv.x*7.0, uv.y*5.0 - t*1.0) + warp*0.5);

      // base glass colour: a faint cool tint, mostly white-blue
      vec3 cBase = vec3(0.80, 0.88, 1.0);
      vec3 cDeep = vec3(0.18, 0.28, 0.42);   // shadow tone
      vec3 cWhite = vec3(1.0);
      vec3 col = mix(cDeep, cBase, smoothstep(0.25, 0.55, surf));
      col = mix(col, cWhite, smoothstep(0.65, 0.88, surf));

      // sharp white speculars — glass catches highlights
      float spec = smoothstep(0.78, 0.96, sheen);
      col = mix(col, cWhite, spec * 0.85);

      // fresnel: alpha rises near the silhouette edge → looks like glass thickness
      float edgeProx = clamp(dx / (envWidth * 1.1), 0.0, 1.0);
      float fresnel = pow(edgeProx, 1.4);
      float a = mask * (0.18 + fresnel * 0.65) * uIntensity;

      // central body slightly transparent so you can see the particle photo behind
      a = clamp(a, 0.0, 0.85);

      if (a < 0.01) discard;
      gl_FragColor = vec4(col, a);
    }
  `,
});
const glassFlame = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.2), glassMat);
glassFlame.position.set(0, 0.3, 0);
aboutScene.add(glassFlame);

// ---------- Particle portrait placeholder ----------
// Builds a particle cloud in a humanoid silhouette (head + bust) as a stand-in.
// When you upload a photo, replace `buildPlaceholderShape()` with a function that
// samples the image's brightness and emits one particle per dark pixel.
function buildPlaceholderShape(count = 1400) {
  // Particles arranged in a FLAME silhouette: wide at the base, tapering to
  // a slim tip at the top. Sampled by rejection so density follows the flame
  // profile (lots of points at the base, few wisps at the tip).
  const pos = new Float32Array(count * 3);
  const Y_BASE = -1.7;
  const Y_TOP  =  1.9;
  for (let i = 0; i < count; i++) {
    let x, y, z, ok = false;
    while (!ok) {
      y = Math.random() * (Y_TOP - Y_BASE) + Y_BASE;
      const t = (y - Y_BASE) / (Y_TOP - Y_BASE); // 0 base → 1 tip
      // flame width: 0.95 at base, narrows non-linearly to ~0.1 at tip
      const width = 0.1 + 0.9 * Math.pow(1.0 - t, 1.6);
      x = (Math.random() - 0.5) * width * 2.2;
      // soft density falloff toward the edge of the flame
      const nx = Math.abs(x) / Math.max(width, 0.01);
      const inside = (1.0 - nx) > Math.random() * 1.0;
      // also pinch the base inward a touch
      const baseFade = t < 0.05 ? Math.random() < t / 0.05 : true;
      if (inside && baseFade) ok = true;
    }
    z = (Math.random() - 0.5) * 0.7;
    pos[i*3 + 0] = x;
    pos[i*3 + 1] = y;
    pos[i*3 + 2] = z;
  }
  return pos;
}
const portraitGeo = new THREE.BufferGeometry();
portraitGeo.setAttribute('position', new THREE.BufferAttribute(buildPlaceholderShape(1400), 3));

const portraitMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uDissolve: { value: 0 }, // 0 → 1 as user scrolls; particles drift outward
    uOpacity: { value: 0.3 },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uDissolve;
    varying float vDist;
    varying float vTop;
    varying float vEmber;

    // cheap hash for per-particle deterministic randomness (no jitter from frame to frame)
    float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5); }

    void main(){
      vec3 p = position;
      float t = uTime;
      // 0 at the base, 1 at the tip — controls how lively a particle moves
      float topness = clamp((position.y + 1.7) / 3.6, 0.0, 1.0);

      // per-particle deterministic "personality": phase + ember status
      float r = h(position);
      float r2 = h(position + 7.3);
      float phaseX = r * 6.28;
      float phaseY = r2 * 6.28;

      // ---- TURBULENT FLOW ----
      // Multi-frequency horizontal sway — looks like rising heat carrying
      // particles back and forth, never the same way twice. Layered freq.
      float swayA = sin(t * 1.4 + position.y * 4.2 + phaseX) * 0.20;
      float swayB = sin(t * 2.6 + position.y * 8.0 + phaseX * 1.7) * 0.10;
      float swayC = sin(t * 0.7 + position.y * 1.6 + phaseY) * 0.12;
      // sway scales with how high up you are — base barely moves, tip whips around
      p.x += (swayA + swayB + swayC) * (0.25 + topness * 1.4);

      // Upward drifting — base rises a touch, tip dances vertically
      p.y += sin(t * 1.1 + phaseY) * 0.10 * (0.3 + topness * 1.6);

      // Depth wobble keeps it volumetric, not a flat sheet
      p.z += sin(t * 0.9 + phaseX) * 0.06;

      // ---- EMBERS ----
      // ~6% of particles "escape" — they detach from the flame body and float
      // upward + outward, like sparks rising from a real fire. Their motion is
      // deliberately slower (long arc) and they fade more aggressively.
      float emberMask = step(0.94, r);
      vEmber = emberMask;
      if (emberMask > 0.5) {
        // ember rises slowly and curves
        float emberT = mod(t * 0.4 + r * 12.0, 4.0); // 4s cycle per ember
        p.y += emberT * 0.7;
        p.x += sin(emberT * 1.5 + r * 10.0) * 0.25 * emberT;
        p.z += cos(emberT * 1.2 + r * 8.0) * 0.18 * emberT;
      }

      // dissolve: push particles outward (used when scrolling toward the top)
      vec3 dir = normalize(p + vec3(0.001));
      p += dir * uDissolve * 2.5;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vDist = -mv.z;
      vTop = topness;
      // embers stay a little brighter / bigger so they're visible
      float sizeBase = (0.6 + 0.9 * (1.0 - uDissolve)) + emberMask * 0.4;
      gl_PointSize = sizeBase * (220.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uDissolve;
    uniform float uOpacity;
    varying float vDist;
    varying float vTop;
    varying float vEmber;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q);
      float a = smoothstep(0.5, 0.0, d);
      // tip particles fade more; embers get their own subtle envelope
      a *= (1.0 - uDissolve * 0.85) * uOpacity * (1.0 - vTop * 0.45);
      // hot white at the base → cool blue tip; embers gain a faint ember warmth
      vec3 cBase = vec3(0.95, 0.98, 1.0);
      vec3 cTip  = vec3(0.55, 0.65, 1.0);
      vec3 col = mix(cBase, cTip, vTop);
      col = mix(col, vec3(1.0, 0.7, 0.4), vEmber * 0.35);
      gl_FragColor = vec4(col, a);
    }
  `,
});
const portrait = new THREE.Points(portraitGeo, portraitMat);
portrait.position.set(0, 0.1, 0.4);
aboutScene.add(portrait);

// ---------- Ring particle burst ----------
// When the user scrolls and the focused step changes, a circular ring of
// particles bursts outward (and rises or falls depending on scroll direction).
// Colours are drawn at random from the hero's four stripe colours.
const RING_PALETTE = [
  [0.75, 0.15, 0.83], // violet  #c026d3
  [0.98, 0.75, 0.14], // yellow  #fbbf24
  [0.12, 0.25, 0.69], // blue    #1e40af
  [0.50, 0.11, 0.11], // red     #7f1d1d
];
const RING_COUNT = 240;
const RING_PER_BURST = 80;
const ringPos    = new Float32Array(RING_COUNT * 3);
const ringVel    = new Float32Array(RING_COUNT * 3);
const ringColor  = new Float32Array(RING_COUNT * 3);
const ringLife   = new Float32Array(RING_COUNT); // 1 just born → 0 dead
const ringGeo    = new THREE.BufferGeometry();
ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
ringGeo.setAttribute('color',    new THREE.BufferAttribute(ringColor, 3));
ringGeo.setAttribute('life',     new THREE.BufferAttribute(ringLife, 1));

const ringMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute vec3 color;
    attribute float life;
    varying vec3 vColor;
    varying float vLife;
    void main(){
      vColor = color;
      vLife = life;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // smaller points so the ring reads as a thin glowing band, not a fat cloud
      float s = 6.0 * (0.55 + 0.45 * life);
      gl_PointSize = s * (260.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying float vLife;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q);
      float a = smoothstep(0.5, 0.0, d) * vLife;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor * (1.2 + vLife * 0.6), a);
    }
  `,
});
const ringParticles = new THREE.Points(ringGeo, ringMat);
ringParticles.visible = false;   // retired: stray colour particles don't fit the metal room
aboutScene.add(ringParticles);

// ---------- Wormhole TUNNEL (made of particle rings stacked along Z) ----------
// Multiple coloured rings stacked along the negative Z axis form a tunnel.
// Each ring is on its own XY plane (face-on to the camera). As the camera
// pushes forward through Z, every ring grows in our view and slides past us,
// just like flying through a wormhole in a film.
const TUNNEL_LAYERS = 6;
const TUNNEL_RING_COUNT = 48;
const TUNNEL_COUNT = TUNNEL_LAYERS * TUNNEL_RING_COUNT;
const tunnelPos    = new Float32Array(TUNNEL_COUNT * 3);
const tunnelColor  = new Float32Array(TUNNEL_COUNT * 3);
const tunnelDepth  = new Float32Array(TUNNEL_COUNT); // 0 = nearest, LAYERS-1 = farthest
for (let layer = 0; layer < TUNNEL_LAYERS; layer++) {
  for (let i = 0; i < TUNNEL_RING_COUNT; i++) {
    const a = (i / TUNNEL_RING_COUNT) * Math.PI * 2 + layer * 0.4; // each layer phase-shifted
    const k = layer * TUNNEL_RING_COUNT + i;
    // unit-radius ring on XY plane, z = -1 -3 -5 -7 ... going into the distance
    tunnelPos[k*3+0] = Math.cos(a);
    tunnelPos[k*3+1] = Math.sin(a);
    tunnelPos[k*3+2] = -1.0 - layer * 2.2;
    tunnelDepth[k] = layer;
    const c = RING_PALETTE[(layer + Math.floor(i/12)) % RING_PALETTE.length];
    const jitter = 0.8 + ((i * 0.137 + layer * 0.31) % 1) * 0.4;
    tunnelColor[k*3+0] = c[0] * jitter;
    tunnelColor[k*3+1] = c[1] * jitter;
    tunnelColor[k*3+2] = c[2] * jitter;
  }
}
const tunnelGeo = new THREE.BufferGeometry();
tunnelGeo.setAttribute('position', new THREE.BufferAttribute(tunnelPos, 3));
tunnelGeo.setAttribute('color',    new THREE.BufferAttribute(tunnelColor, 3));
tunnelGeo.setAttribute('depth',    new THREE.BufferAttribute(tunnelDepth, 1));
const tunnelMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
  vertexShader: /* glsl */`
    attribute vec3 color;
    attribute float depth;
    uniform float uTime;
    varying vec3 vColor;
    varying float vNear;
    void main(){
      vColor = color;
      vec3 p = position;
      // very subtle radial pulse so the tunnel feels alive
      float pulse = 1.0 + sin(uTime * 0.5 + depth * 0.8) * 0.04;
      p.xy *= pulse;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float dist = -mv.z;
      // nearer rings → bigger particles; perspective handles most of it but
      // we boost the near ones for that "rushing past" feel
      vNear = clamp(8.0 / max(dist, 0.3), 0.0, 2.5);
      gl_PointSize = 6.5 * (260.0 / max(dist, 0.3));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uOpacity;
    varying vec3 vColor;
    varying float vNear;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q);
      float a = smoothstep(0.5, 0.0, d) * uOpacity * (0.6 + vNear * 0.4);
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor, a);
    }
  `,
});
const tunnel = new THREE.Points(tunnelGeo, tunnelMat);
const portalGroup = new THREE.Group();
portalGroup.add(tunnel);
portalGroup.visible = false;
aboutScene.add(portalGroup);

// ============================================================
// DIRECTION Z (v2) — Chrome enclosure + random neon light lines
// ============================================================
// The about-view is now wrapped in a long bright-chrome tube. The camera
// lives INSIDE this tube — conceptually we've "punched through" the
// hero's 3-layer ring on the homepage and we are now physically inside
// the same metal structure. The tube runs along the z-axis and is long
// enough that BOTH sceneA (camera z=9) and sceneB settle (camera z=-19)
// happen inside the same surround.
//
// Colour enters as occasional neon "light lines" — thin glowing bars
// that fade in at random positions and orientations inside the chamber,
// each carrying one of the four hero colours (violet/yellow/blue/red).
// Each line is paired with a PointLight, and the chrome wall uses
// MeshStandardMaterial with metalness=1 + low roughness, so the colour
// of every active line naturally illuminates the chrome surface around
// it — the random-colour reflections asked for, without faking it.

// --- Procedural environment map (high-quality studio reflection) ---
// PBR metals don't have a colour of their own — they look entirely like
// what they reflect. To make the chrome room read as REAL polished metal
// (not flat grey paint), the env map needs structured content the metal
// can reflect: bright softbox sources at top, vertical bright streaks at
// mid-height (which read as vertical bright bars on the walls), a soft
// horizon band, and subtle hero-stripe colour patches at the bottom.
//
// 2048×1024 — high enough resolution that the PMREM mips at low roughness
// preserve sharp reflection detail. The whole thing is pre-filtered by
// PMREMGenerator so every roughness level samples a correctly-blurred
// version of the env.
function buildAboutEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');

  // NEUTRAL SILVER STUDIO ENVIRONMENT.
  // The room must read as polished SILVER aluminium, so the reflected world is
  // a clean bright studio: a light upper "sky", a softbox-lit mid, a darker
  // floor band, plus a few bright softbox pools and vertical light strips that
  // give the metal something crisp to mirror. Colour is intentionally absent
  // here — all hue in the room comes from the emissive neon columns and the
  // random colour light lines, never from tinting the metal itself.
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0.00, '#eef1f7');   // bright sky
  g.addColorStop(0.40, '#c4c9d4');
  g.addColorStop(0.62, '#878d9c');
  g.addColorStop(1.00, '#2b2f3a');   // darker ground
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 1024);

  // Bright softbox pools across the upper band — crisp highlights on the metal.
  ctx.globalCompositeOperation = 'lighter';
  const softboxes = [
    { u: 0.12, v: 0.20, rx: 240, ry: 90 },
    { u: 0.37, v: 0.15, rx: 200, ry: 80 },
    { u: 0.60, v: 0.22, rx: 250, ry: 95 },
    { u: 0.84, v: 0.16, rx: 210, ry: 82 },
  ];
  for (const sb of softboxes) {
    const cx = sb.u * 2048, cy = sb.v * 1024;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(sb.rx, sb.ry) * 1.5);
    rg.addColorStop(0.00, 'rgba(255,255,255,0.95)');
    rg.addColorStop(0.40, 'rgba(255,255,255,0.45)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.ellipse(cx, cy, sb.rx, sb.ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Tall vertical light strips — reflect as bright machined rails on the wall.
  const strips = [0.04, 0.27, 0.50, 0.73, 0.96];
  for (const u of strips) {
    const cx = u * 2048;
    const rg = ctx.createLinearGradient(cx - 26, 0, cx + 26, 0);
    rg.addColorStop(0.0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    rg.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - 26, 120, 52, 620);
  }
  // A whisper of the four brand colours, very faint, low on the wall only.
  const tints = [
    { x: 256,  c: 'rgba(192,38,211,0.06)' },
    { x: 768,  c: 'rgba(75,125,255,0.07)' },
    { x: 1280, c: 'rgba(251,191,36,0.05)' },
    { x: 1792, c: 'rgba(255,60,60,0.05)' },
  ];
  for (const tn of tints) {
    const rg = ctx.createRadialGradient(tn.x, 820, 0, tn.x, 820, 360);
    rg.addColorStop(0, tn.c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, 2048, 1024);
  }

  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.mapping    = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const __aboutEnvSrc = buildAboutEnvTexture();
const __aboutPMREM  = new THREE.PMREMGenerator(aboutRenderer);
const __aboutEnvRT  = __aboutPMREM.fromEquirectangular(__aboutEnvSrc);
aboutScene.environment = __aboutEnvRT.texture;
__aboutEnvSrc.dispose();
__aboutPMREM.dispose();

// =============================================================================
// CYLINDRICAL METAL LABORATORY  —  a real architectural interior
// The camera stands INSIDE a tall brushed-aluminium cylinder. The wall is not
// a smooth mirror (which only ever reflects a flat gradient) — it is a STRUCT-
// URED surface: vertical panel mullions, horizontal level rings, and embedded
// hero-colour neon columns, so curvature and depth are unmistakable. Six text
// panels are mounted ON the wall, spiralling up; a true planar-reflector floor
// throws the whole room back; the top opens to a bright light source far over-
// head. Scroll dollies the camera up through the shaft, framing each panel.
// References: Apple Vision Pro stage, teamLab chamber, sci-fi museum hall.
const ROOM_R = 6.5;                 // ≈13 m diameter
const ROOM_H = 70;                  // tall shaft to travel up through (10 panels)
const FLOOR_Y = -ROOM_H / 2;
const HERO_HEX = [0xc026d3, 0x4b7dff, 0xfbbf24, 0xff3030];
const HERO_CSS = ['#c026d3', '#4b7dff', '#fbbf24', '#ff3030'];

// ---- Wall colour texture: brushed steel + mullion seams + level rings -------
function buildWallColorTex() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 4096;
  const x = c.getContext('2d');
  // brushed steel base
  const g = x.createLinearGradient(0, 0, 0, 4096);
  g.addColorStop(0.0, '#aeb4c2');
  g.addColorStop(0.5, '#cdd2dd');
  g.addColorStop(1.0, '#9aa0b0');
  x.fillStyle = g; x.fillRect(0, 0, 2048, 4096);
  // fine vertical brushed streaks
  for (let i = 0; i < 1400; i++) {
    const px = Math.random() * 2048;
    x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    x.lineWidth = Math.random() * 1.5;
    x.beginPath(); x.moveTo(px, 0); x.lineTo(px + (Math.random() - 0.5) * 6, 4096); x.stroke();
  }
  // 12 vertical mullion seams (panel divisions around the circumference)
  const cols = 12;
  for (let i = 0; i < cols; i++) {
    const px = (i / cols) * 2048;
    const sg = x.createLinearGradient(px - 14, 0, px + 14, 0);
    sg.addColorStop(0.0, 'rgba(60,66,80,0)');
    sg.addColorStop(0.42, 'rgba(40,44,56,0.85)');
    sg.addColorStop(0.5, 'rgba(20,22,30,0.95)');
    sg.addColorStop(0.58, 'rgba(40,44,56,0.85)');
    sg.addColorStop(1.0, 'rgba(60,66,80,0)');
    x.fillStyle = sg; x.fillRect(px - 14, 0, 28, 4096);
    // bright highlight rail just left of each seam (machined edge)
    x.fillStyle = 'rgba(255,255,255,0.5)';
    x.fillRect(px - 17, 0, 2, 4096);
  }
  // horizontal level rings (structural floor bands)
  const rings = 9;
  for (let i = 1; i < rings; i++) {
    const py = (i / rings) * 4096;
    const rg = x.createLinearGradient(0, py - 10, 0, py + 10);
    rg.addColorStop(0.0, 'rgba(60,66,80,0)');
    rg.addColorStop(0.5, 'rgba(22,24,32,0.9)');
    rg.addColorStop(1.0, 'rgba(60,66,80,0)');
    x.fillStyle = rg; x.fillRect(0, py - 10, 2048, 20);
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.fillRect(0, py - 13, 2048, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
  return t;
}
// ---- Wall emissive texture: hero-colour neon columns set into seams ---------
function buildWallEmissiveTex() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 4096;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 2048, 4096);
  // 4 tall neon columns, one per hero colour, recessed into 4 of the seams
  const seams = [1, 4, 7, 10];
  for (let k = 0; k < 4; k++) {
    const px = (seams[k] / 12) * 2048;
    const sg = x.createLinearGradient(px - 8, 0, px + 8, 0);
    sg.addColorStop(0.0, 'rgba(0,0,0,0)');
    sg.addColorStop(0.5, HERO_CSS[k]);
    sg.addColorStop(1.0, 'rgba(0,0,0,0)');
    x.fillStyle = sg;
    x.globalAlpha = 0.9;
    x.fillRect(px - 8, 60, 16, 4096 - 120);
    x.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const wallMat = new THREE.MeshStandardMaterial({
  map: buildWallColorTex(),
  metalness: 0.95,
  roughness: 0.17,                  // polished aluminium — structure still reads
  envMapIntensity: 1.5,
  emissive: 0xffffff,
  emissiveMap: buildWallEmissiveTex(),
  emissiveIntensity: 1.25,          // neon columns are accents, not the mood
  side: THREE.BackSide,
});
const roomWall = new THREE.Mesh(
  new THREE.CylinderGeometry(ROOM_R, ROOM_R, ROOM_H, 200, 1, true),
  wallMat
);
aboutScene.add(roomWall);

// ---- Floor: true planar mirror (Reflector) reflecting the whole room --------
const reflectorFloor = new Reflector(
  new THREE.CircleGeometry(ROOM_R, 128),
  { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x6b7280 }
);
reflectorFloor.rotation.x = -Math.PI / 2;
reflectorFloor.position.y = FLOOR_Y + 0.01;
aboutScene.add(reflectorFloor);
// faint concentric grid laid over the mirror so it reads as a real surface
function buildFloorGridTex() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 1024);
  x.strokeStyle = 'rgba(180,195,225,0.5)';
  for (let r = 1; r <= 7; r++) {
    x.lineWidth = r === 7 ? 4 : 1.5;
    x.beginPath(); x.arc(512, 512, (r / 7) * 500, 0, Math.PI * 2); x.stroke();
  }
  x.strokeStyle = 'rgba(180,195,225,0.32)';
  x.lineWidth = 1.2;
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    x.beginPath(); x.moveTo(512, 512);
    x.lineTo(512 + Math.cos(ang) * 500, 512 + Math.sin(ang) * 500); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const floorGrid = new THREE.Mesh(
  new THREE.CircleGeometry(ROOM_R, 128),
  new THREE.MeshBasicMaterial({
    map: buildFloorGridTex(), transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
);
floorGrid.rotation.x = -Math.PI / 2;
floorGrid.position.y = FLOOR_Y + 0.02;
aboutScene.add(floorGrid);

// ---- Ceiling: BRUSHED-SILVER dome with a soft skylight at the centre -------
const CEIL_Y = ROOM_H / 2;
// A machined silver ceiling: concentric brushed-metal rings converging to a
// softly glowing skylight. Matches the wall's polished-aluminium quality —
// no black cap, no stark white disc.
function buildCeilingTex() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  const cx = 512, cy = 512;
  // brushed-silver radial base
  const base = x.createRadialGradient(cx, cy, 0, cx, cy, 512);
  base.addColorStop(0.00, '#f6f8fc');   // bright skylight core
  base.addColorStop(0.18, '#e6e9f1');
  base.addColorStop(0.30, '#cfd3dd');
  base.addColorStop(0.62, '#bcc1cd');
  base.addColorStop(1.00, '#d2d6df');
  x.fillStyle = base; x.fillRect(0, 0, 1024, 1024);
  // concentric machined grooves
  for (let r = 30; r < 512; r += 26) {
    x.strokeStyle = 'rgba(40,44,54,0.45)'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, r - 2, 0, Math.PI * 2); x.stroke();
  }
  // fine radial brushed streaks
  for (let i = 0; i < 720; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r0 = 60 + Math.random() * 440, r1 = r0 + 20 + Math.random() * 60;
    x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    x.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
  return t;
}
// The four SceneB theme sentences live ENGRAVED into the metal ceiling — they
// read as glowing reflections on the polished disc, not pasted labels.
// SceneC text floats as a BILLBOARDED plane that always faces the user, so it
// reads upright no matter where the camera looks. The ceiling itself stays a
// clean polished disc + skylight; the text is rendered separately below.
const CEIL_COPY = {
  en: {
    manifesto: ['There is no final version.', 'Only the next one.'],
    y2: { label: '2 YEARS', body: 'Build a creative platform with 1,000 active users.' },
    y5: { label: '5 YEARS', body: 'Generate over $200,000 through projects, products, and ideas created inside this lab.' },
    motto: 'CREATE  •  TEST  •  FAIL  •  LEARN  •  REPEAT',
  },
  cn: {
    manifesto: ['没有最终版本。', '只有下一个。'],
    y2: { label: '2 年', body: '打造一个拥有 1,000 名活跃用户的创作平台。' },
    y5: { label: '5 年', body: '通过这个实验室里诞生的项目、产品与想法，创造超过 $200,000 的价值。' },
    motto: '创造  •  试验  •  失败  •  学习  •  再来',
  },
};

function __ceilWrap(ctx, text, maxW) {
  const isCJK = /[一-鿿]/.test(text);
  if (isCJK) {
    // wrap per-character for CJK (no spaces)
    const out = []; let cur = '';
    for (const ch of text) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const words = text.split(' '), out = []; let cur = '';
  for (const w of words) {
    const t = (cur ? cur + ' ' : '') + w;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

// Ceiling emissive = clean skylight sheen only (no text — SceneC text lives on
// a billboarded plane that always faces the camera).
function buildCeilingEmissive(_lang) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 1024);
  const g = x.createRadialGradient(512, 512, 0, 512, 512, 380);
  g.addColorStop(0.0, 'rgba(208,222,250,0.30)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ceilMatStd = new THREE.MeshStandardMaterial({
  map: buildCeilingTex(),
  emissive: 0xffffff, emissiveMap: buildCeilingEmissive(__ceilLang()), emissiveIntensity: 1.25,
  metalness: 0.72, roughness: 0.3, envMapIntensity: 1.25,   // polished + reflective
  side: THREE.DoubleSide,
});
function __ceilLang() { return document.body.classList.contains('lang-cn') ? 'cn' : 'en'; }
function redrawCeiling(lang) {
  const old = ceilMatStd.emissiveMap;
  ceilMatStd.emissiveMap = buildCeilingEmissive(lang === 'cn' ? 'cn' : 'en');
  ceilMatStd.needsUpdate = true;
  if (old) old.dispose();
}
const ceilDisc = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 128), ceilMatStd);
ceilDisc.rotation.x = Math.PI / 2;     // normal pointing down into the room
ceilDisc.position.y = CEIL_Y;
aboutScene.add(ceilDisc);
// very soft central sheen (the polished metal does the rest)
const ceilGlow = new THREE.Mesh(
  new THREE.CircleGeometry(ROOM_R * 0.22, 96),
  new THREE.MeshBasicMaterial({
    color: 0xcad8f5, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  })
);
ceilGlow.rotation.x = Math.PI / 2;
ceilGlow.position.y = CEIL_Y - 0.15;
aboutScene.add(ceilGlow);
const ceilKey = new THREE.PointLight(0xeaf2ff, 2.2, ROOM_H * 2.6, 1.3);
ceilKey.position.set(0, CEIL_Y - 1.5, 0);
aboutScene.add(ceilKey);
const fillKey = new THREE.PointLight(0xbfd0ff, 0.8, ROOM_H * 1.2, 1.6);
fillKey.position.set(0, 0, 0);
aboutScene.add(fillKey);
// volumetric shaft cone widening down from the opening
const lightShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(ROOM_R * 0.55, ROOM_R * 0.99, ROOM_H, 64, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xc4d6ff, transparent: true, opacity: 0.045,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  })
);
aboutScene.add(lightShaft);

// ---- SceneC text plane (billboarded, always faces the camera) -------------
function __sceneCWrap(ctx, text, maxW) {
  const isCJK = /[一-鿿]/.test(text);
  if (isCJK) {
    const out = []; let cur = '';
    for (const ch of text) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const words = text.split(' '); const out = []; let cur = '';
  for (const w of words) {
    const t = (cur ? cur + ' ' : '') + w;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
function buildSceneCCanvas(lang) {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 1600;        // 4:5 portrait
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1280, 1600);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const copy = CEIL_COPY[lang === 'cn' ? 'cn' : 'en'];
  const cx = 640, MAXW = 1080;
  // DEEP INK text + soft white halo — high contrast against the silver ceiling.
  const INK = 'rgba(8, 10, 16, 0.97)';
  const INK_SOFT = 'rgba(14, 18, 28, 0.85)';
  // ---- manifesto ----
  x.shadowColor = 'rgba(255,255,255,0.85)'; x.shadowBlur = 22;
  x.fillStyle = INK;
  x.font = (lang === 'cn')
    ? '500 100px "Songti SC", "Times New Roman", serif'
    : 'italic 92px "Instrument Serif", Georgia, serif';
  x.fillText(copy.manifesto[0], cx, 200, MAXW);
  x.fillText(copy.manifesto[1], cx, 320, MAXW);
  // ---- 2 YEARS ----
  x.shadowBlur = 14;
  x.fillStyle = INK;
  x.font = (lang === 'cn')
    ? '700 52px "PingFang SC", "Songti SC", sans-serif'
    : '800 44px "Helvetica Neue", Arial, sans-serif';
  x.fillText(copy.y2.label, cx, 540, 800);
  x.fillStyle = INK_SOFT;
  x.font = (lang === 'cn')
    ? '400 44px "PingFang SC", "Hiragino Sans GB", sans-serif'
    : '400 40px "Helvetica Neue", Arial, sans-serif';
  let yy = 620;
  for (const ln of __sceneCWrap(x, copy.y2.body, MAXW)) { x.fillText(ln, cx, yy, MAXW); yy += 58; }
  // ---- 5 YEARS ----
  yy += 50;
  x.shadowBlur = 14;
  x.fillStyle = INK;
  x.font = (lang === 'cn')
    ? '700 52px "PingFang SC", "Songti SC", sans-serif'
    : '800 44px "Helvetica Neue", Arial, sans-serif';
  x.fillText(copy.y5.label, cx, yy, 800); yy += 80;
  x.fillStyle = INK_SOFT;
  x.font = (lang === 'cn')
    ? '400 44px "PingFang SC", "Hiragino Sans GB", sans-serif'
    : '400 40px "Helvetica Neue", Arial, sans-serif';
  for (const ln of __sceneCWrap(x, copy.y5.body, MAXW)) { x.fillText(ln, cx, yy, MAXW); yy += 58; }
  // ---- motto (bottom) ----
  x.shadowBlur = 10;
  x.fillStyle = 'rgba(8,10,16,0.78)';
  x.font = (lang === 'cn')
    ? '600 30px "PingFang SC", "Songti SC", sans-serif'
    : '800 28px "Helvetica Neue", Arial, sans-serif';
  x.fillText(copy.motto, cx, 1520, 1180);
  x.shadowBlur = 0;
  return c;
}
function buildSceneCTexture(lang) {
  const t = new THREE.CanvasTexture(buildSceneCCanvas(lang));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
  return t;
}
const sceneCMat = new THREE.MeshBasicMaterial({
  map: buildSceneCTexture(__ceilLang()),
  transparent: true, opacity: 0, depthWrite: false,
});
const sceneCPlane = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 6.75), sceneCMat);
sceneCPlane.renderOrder = 8;
aboutScene.add(sceneCPlane);
function redrawSceneC(lang) {
  const old = sceneCMat.map;
  sceneCMat.map = buildSceneCTexture(lang === 'cn' ? 'cn' : 'en');
  sceneCMat.needsUpdate = true;
  if (old) old.dispose();
}
window.__redrawSceneC = redrawSceneC;

// =============================================================================
// WALL-MOUNTED CONTENT PANELS  —  the six SceneA steps, embedded in the wall
// Each is a curved cylinder-segment screen flush to the inner wall, carrying a
// canvas texture (step number + heading + body + accent edge). They spiral up
// the shaft so the travelling camera frames them one by one. The wall itself
// is the information carrier — no floating cards.
const PANEL_DATA = [
  { num: '01',
    en: { h: 'Turning Ideas Into Things', p: 'Most of my projects begin as simple thoughts. Building them helps me understand what works, what fails.' },
    cn: { h: '把想法变成事物', p: '我的大多数项目，都从一个简单的想法开始。把它们做出来，才能看清什么行得通、什么不行。' } },
  { num: '02',
    en: { h: 'Curiosity Has Always Been My Motivation', p: 'Business, technology, design, and psychology are the areas of mine. Exploring different areas often leads to unexpected connections and new possibilities.' },
    cn: { h: '好奇心一直是我的动力', p: '商业、技术、设计与心理学，是我关切的几个领域。在它们之间穿行，常常带来意想不到的连接和崭新的可能。' } },
  { num: '03',
    en: { h: 'Creation Is How I Learn', p: 'I was born in 2009. Since the age of fifteen, creating value has become one of the ways I define myself.' },
    cn: { h: '创造是我学习的方式', p: '我出生于 2009 年。从十五岁起，创造价值成为我定义自己的方式之一。' } },
  { num: '04',
    en: { h: '“Don’t Ever Leave Yourself Behind Today”', p: 'Each step forward helps build the future I want to live in, a world full of act, now I am better.' },
    cn: { h: '“别把今天的自己留在身后”', p: '每一步向前，都在搭建我想要生活的未来——一个充满行动的世界。此刻的我，更好了。' } },
  { num: '05',
    en: { h: 'I Am Still Figuring Things Out', p: 'YAO FLAME LAB is here due to It is a record of exploration experimentation and continuous learning.' },
    cn: { h: '我还在摸索', p: 'YAO FLAME LAB 之所以存在，因为它是一份关于探索、实验与持续学习的记录。' } },
  { num: '06',
    en: { h: 'This Is Daniel Rong', p: 'A young creator · A persistent builder · A 16 years old from West Vancouver.  Still learning, still exploring, still building.' },
    cn: { h: '他是 Daniel Rong', p: '一个年轻的创作者 · 一个执着的建造者 · 一个来自西温哥华的 16 岁少年。仍在学习，仍在探索，仍在创造。' } },
];
// SceneB content frames — four empty panels the user will fill with copy.
// They continue the spiral above the six SceneA panels (a new chapter, marked
// with a "WHY THIS LAB EXISTS" eyebrow) and carry placeholder text for now.
const PANEL_DATA_B = [
  { en: { h: 'Ideas Are Usually Invisible',
          p: 'Most ideas are never seen. This lab exists to make those ideas visible — to give them a place where they can be explored, questioned, and shared.' },
    cn: { h: '想法通常是看不见的',
          p: '大多数想法从未被看见。这个实验室的存在，是为了让这些想法被看见——给它们一个可以被探索、被质疑、被分享的地方。' } },
  { en: { h: 'Projects Tell A Different Story',
          p: 'Finished work only shows the outcome. What interests me more is everything behind it: the experiments, revisions, failures, and unexpected turns. This lab focuses on the process, not just the result.' },
    cn: { h: '项目讲述的是另一种故事',
          p: '完成的作品只展示结果。我更感兴趣的是它背后的一切：实验、修改、失败，以及意料之外的转折。这个实验室关注的是过程，而不只是结果。' } },
  { en: { h: 'Different Worlds Can Meet Here',
          p: 'Badminton, business, artificial intelligence, photography, design, and storytelling may seem unrelated. Yet within this space, they are able to intersect, influence one another, and become part of the same creative journey.' },
    cn: { h: '不同世界可以在这里相遇',
          p: '羽毛球、商业、人工智能、摄影、设计、叙事，看似毫无关联。但在这个空间里，它们能彼此交汇、相互影响，成为同一段创作旅程的一部分。' } },
  { en: { h: 'This Is An Ongoing Experiment',
          p: 'This is not the final version of a portfolio. It is an evolving laboratory of ideas. New projects will appear, old projects will be reimagined, and the experiment itself will continue to grow.' },
    cn: { h: '这是一场持续进行的实验',
          p: '这不是一份作品集的最终版本。它是一个不断演化的想法实验室。新项目会出现，旧项目会被重新构想，实验本身也会继续生长。' } },
];
const ALL_PANEL_DATA = PANEL_DATA.concat(PANEL_DATA_B);
const PANEL_ARC = 1.05;             // radians of circumference each panel spans
// 3:2 frame (a compromise between the old 5:4 and the wide 16:9): width =
// (ROOM_R-0.06)*PANEL_ARC ≈ 6.76, so height = 6.76 / 1.5 ≈ 4.5. The panel
// texture is the matching 3:2 aspect (1280×853) so nothing is stretched.
const PANEL_H   = 4.5;
// Character-level wrap that also handles CJK (which has no spaces): Latin runs
// break at the last space, CJK breaks per glyph, so Chinese never overflows.
function wrapText(x, text, maxW) {
  const lines = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (x.measureText(cur + ch).width > maxW && cur) {
      const lastSpace = cur.lastIndexOf(' ');
      if (lastSpace > 0 && /[A-Za-z0-9(),.'"’“”—-]/.test(ch)) {
        lines.push(cur.slice(0, lastSpace).trimEnd());
        cur = cur.slice(lastSpace + 1) + ch;
      } else {
        lines.push(cur.trimEnd());
        cur = (ch === ' ') ? '' : ch;
      }
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}
function drawPanelTexture(canvas, data, idx, lang) {
  const x = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const accent = HERO_CSS[idx % 4];
  // dark inset screen background
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#181b24'); g.addColorStop(1, '#0c0e14');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // subtle brushed sheen
  for (let i = 0; i < 200; i++) {
    x.strokeStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    x.lineWidth = 1; const px = Math.random() * W;
    x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke();
  }
  // accent edge bar (left) + inner frame
  x.fillStyle = accent; x.fillRect(70, 70, 12, H - 140);
  x.strokeStyle = 'rgba(150,165,200,0.25)'; x.lineWidth = 2;
  x.strokeRect(70, 70, W - 140, H - 140);
  const L = 130;
  const d = data[lang] || data.en;
  x.textBaseline = 'top';
  const maxW = W - L - 130;
  // "Syne" — avant-garde but highly readable display sans for headings; a
  // clean modern CJK sans (PingFang) for Chinese.
  const headFont = (lang === 'cn')
    ? '600 74px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    : '700 80px "Syne", "Helvetica Neue", Arial, sans-serif';
  const bodyFont = (lang === 'cn')
    ? '400 38px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    : '400 40px "Helvetica Neue", Arial, sans-serif';
  const headLH = (lang === 'cn') ? 92 : 88;
  const bodyLH = (lang === 'cn') ? 56 : 58;

  // Measure first so the heading + body block can be vertically CENTERED in the
  // frame (the 3:2 panel is taller, so top-aligned text would look top-heavy).
  x.font = headFont; const hLines = wrapText(x, d.h, maxW);
  x.font = bodyFont; const bLines = wrapText(x, d.p, maxW);
  const blockH = hLines.length * headLH + 28 + bLines.length * bodyLH;
  const tagH = data.tag ? 70 : 0;
  let yy = Math.max(140, tagH + (H - 140 - tagH - blockH) / 2 + 40);

  // optional eyebrow tag (SceneB chapter marker), sits just above the block
  if (data.tag) {
    x.fillStyle = accent;
    x.font = '700 34px "Helvetica Neue", Arial, sans-serif';
    x.fillText(data.tag, L, yy - 60);
  }
  x.fillStyle = '#f1f3fa';
  x.font = headFont;
  for (const line of hLines) { x.fillText(line, L, yy); yy += headLH; }
  yy += 28;
  x.fillStyle = 'rgba(206,214,232,0.82)';
  x.font = bodyFont;
  for (const line of bLines) { x.fillText(line, L, yy); yy += bodyLH; }
  // accent glow footer line
  x.fillStyle = accent; x.globalAlpha = 0.7;
  x.fillRect(L, H - 150, 220, 5); x.globalAlpha = 1;
}
const aboutPanels = [];
let __aboutLang = (document.body.classList.contains('lang-cn')) ? 'cn' : 'en';
const PANEL_COUNT = ALL_PANEL_DATA.length;             // 6 SceneA + 4 SceneB
for (let i = 0; i < PANEL_COUNT; i++) {
  const cv = document.createElement('canvas');
  cv.width = 1280; cv.height = 853;   // 3:2, matches the panel geometry
  drawPanelTexture(cv, ALL_PANEL_DATA[i], i, __aboutLang);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
  // mirror horizontally: a BackSide cylinder segment flips U, so pre-flip here
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; tex.offset.x = 1;
  const angle = i * (Math.PI * 2 / 6);                  // keep 60° spiral step
  // All ten panels occupy the lower ~62% of the shaft; the top is the SceneB
  // doubt-voice swarm + the reflective ceiling.
  const py = FLOOR_Y + 6 + i * ((ROOM_H * 0.62) / (PANEL_COUNT - 1));
  const geo = new THREE.CylinderGeometry(
    ROOM_R - 0.06, ROOM_R - 0.06, PANEL_H, 48, 1, true,
    angle - PANEL_ARC / 2, PANEL_ARC
  );
  const mat = new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85,
    metalness: 0.1, roughness: 0.65, side: THREE.BackSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = py;
  aboutScene.add(mesh);
  aboutPanels.push({ mesh, canvas: cv, tex, angle, y: py, data: ALL_PANEL_DATA[i] });
}
// redraw all panels on language switch (called from setLang)
function redrawAboutPanels(lang) {
  __aboutLang = (lang === 'cn') ? 'cn' : 'en';
  for (let i = 0; i < aboutPanels.length; i++) {
    drawPanelTexture(aboutPanels[i].canvas, aboutPanels[i].data, i, __aboutLang);
    aboutPanels[i].tex.needsUpdate = true;
  }
  // also redraw the SceneB theme sentences engraved into the metal ceiling
  if (typeof redrawCeiling === 'function') redrawCeiling(__aboutLang);
  if (window.__redrawSceneC) window.__redrawSceneC(__aboutLang);
}
window.__redrawAboutPanels = redrawAboutPanels;
// Redraw once the web fonts load so headings pick up Syne (panels) and the
// ceiling sentences pick up Instrument Serif, rather than the fallbacks.
if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load("700 80px 'Syne'"),
    document.fonts.load("italic 56px 'Instrument Serif'"),
  ]).then(() => redrawAboutPanels(__aboutLang)).catch(() => {});
}

// The HTML staircase + portrait centrepiece are retired — content now lives on
// the wall, so the room is never blocked by a floating figure or glass card.
const __staircaseEl = document.getElementById('staircase');
if (__staircaseEl) __staircaseEl.style.display = 'none';
glassFlame.visible = false;
portrait.visible = false;

// =============================================================================
// SCENE B  —  embedded into the same chamber (no HTML overlay)
// The upper quarter of the shaft is the "doubt zone": eight negative voices
// drift in the air around the camera as it rises, materialising in hero
// colours. Above them, four resolution lines light up one by one along the
// central axis, leading the eye up into the skylight. The old HTML overlays
// (fog words, centre lines, corridor placeholders) are hidden.
['sceneBFog', 'sceneBLines', 'corridorStage'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
});

// Generic glowing-text texture on a transparent canvas.
function makeTextTexture(text, opts) {
  const o = Object.assign({ w: 512, h: 256, font: '700 italic 96px Georgia, serif',
    color: '#ffffff', glow: 'rgba(255,255,255,0.5)', chroma: null }, opts);
  const c = document.createElement('canvas');
  c.width = o.w; c.height = o.h;
  const x = c.getContext('2d');
  x.clearRect(0, 0, o.w, o.h);
  x.font = o.font; x.textAlign = 'center'; x.textBaseline = 'middle';
  const cx = o.w / 2, cy = o.h / 2;
  // chromatic-aberration ghost (negative-voice horror feel)
  if (o.chroma) {
    x.globalAlpha = 0.55;
    x.fillStyle = o.chroma[0]; x.fillText(text, cx - 5, cy - 3);
    x.fillStyle = o.chroma[1]; x.fillText(text, cx + 5, cy + 3);
    x.globalAlpha = 1;
  }
  x.shadowColor = o.glow; x.shadowBlur = 28;
  x.fillStyle = o.color; x.fillText(text, cx, cy);
  x.shadowBlur = 0;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---- Doubt voices ----------------------------------------------------------
const DOUBT_ZONE_Y0 = FLOOR_Y + 6 + ROOM_H * 0.62 + 4;   // just above top panel
const DOUBT_ZONE_Y1 = CEIL_Y - 4;
const DOUBT_WORDS = [
  { t: 'Too young',            ci: 0 },
  { t: 'Impossible',           ci: 2 },
  { t: 'Not practical',        ci: 3 },
  { t: 'Maybe one day',        ci: 1 },
  { t: 'Nobody cares',         ci: 2 },
  { t: 'Unfinished',           ci: 0 },
  { t: 'What if it fails',     ci: 1 },
  { t: 'Someone already did it', ci: 3 },
];
const doubtVoices = [];
for (let i = 0; i < DOUBT_WORDS.length; i++) {
  const d = DOUBT_WORDS[i];
  // Wide canvas (1600) so even the longest phrase ("Someone already did it")
  // fits with margin and isn't clipped at the edges; it only adds transparent
  // margin, so the text size/scale is unchanged.
  const DV_W = 1600;
  const tex = makeTextTexture(d.t, {
    w: DV_W, h: 256,
    font: '700 italic 92px Georgia, "Times New Roman", serif',
    color: HERO_CSS[d.ci], glow: HERO_CSS[d.ci],
    chroma: ['rgba(80,200,255,0.7)', 'rgba(255,70,180,0.7)'],
  });
  const aspect = DV_W / 256;
  const hgt = 1.05 + Math.random() * 0.5;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(hgt * aspect, hgt),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })
  );
  // Cluster the voices in the camera's FORWARD wedge (it looks toward azimuth
  // ≈ PI while it rises), spread across the whole rise-height band, so as the
  // camera climbs they ALL drift through frame instead of scattering 360°
  // (most of which the 60° view never sees).
  // Centre the voices on the camera's mid look-azimuth and keep a TIGHT spread
  // so they stay near the middle of the frame and don't swing wildly across it
  // as the camera turns (the rotation itself is unchanged).
  const baseAz = Math.PI + 0.85;
  // alternate left/right by index (plus a little jitter) so the tight central
  // cluster doesn't stack two voices on top of each other
  const ang = baseAz + ((i % 2) - 0.5) * 0.8 + (Math.random() - 0.5) * 0.3;
  const rad = 3.0 + Math.random() * 1.6;                   // 3.0–4.6
  const frac = i / (DOUBT_WORDS.length - 1);
  const wy  = DOUBT_ZONE_Y0 + 1
            + frac * 9                                     // tighter band ~17→26
            + (Math.random() - 0.5) * 1.6;                 // matches the eye-level rise
  mesh.position.set(Math.sin(ang) * rad, wy, Math.cos(ang) * rad);
  mesh.renderOrder = 5;
  aboutScene.add(mesh);
  doubtVoices.push({
    mesh, baseY: wy,
    appearAt: 0.62 + frac * 0.12,                          // staggered 0.62→0.74
    drift: 0.3 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
  });
}

// (The four theme sentences are no longer 3D planes in the air — they are
// engraved into the metal ceiling as glowing reflections; see buildCeilingEmissive.)

// Materialise + billboard the doubt voices each frame. They fade out near the
// final page so the ending settles to the reflective ceiling + its text.
function tickSceneB(sp, t) {
  const settle = Math.max(0, Math.min(1, (sp - 0.92) / 0.06));
  for (const v of doubtVoices) {
    const k = Math.max(0, Math.min(1, (sp - v.appearAt) / 0.10));
    v.mesh.material.opacity = k * 0.95 * (1 - settle);
    v.mesh.position.y = v.baseY + Math.sin(t * v.drift + v.phase) * 0.25;
    v.mesh.scale.setScalar(0.6 + k * 0.4);
    if (k > 0) v.mesh.quaternion.copy(aboutCam.quaternion);  // billboard
  }
}

// Illumination = ceiling key light + emissive neon columns + iridescent env
// reflection + the random colour light lines. Real volumetric light + true
// environment + planar floor reflection together sell the architectural space.

// --- Random neon light line pool ---
// Six simultaneous slots. Each holds an additive-blended cylinder mesh
// (the visible glowing bar) plus a paired PointLight (the source that
// lights the chrome around it). Slots cycle through idle → fade in →
// hold → fade out → idle, with random spawn timing.
const LIGHT_LINE_COUNT  = 6;
const LIGHT_LINE_COLORS = [0xc026d3, 0xfbbf24, 0x4b7dff, 0xff3030];
const lightLines = [];
for (let i = 0; i < LIGHT_LINE_COUNT; i++) {
  const lineMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 4.5, 8, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  aboutScene.add(lineMesh);
  const light = new THREE.PointLight(0xffffff, 0, 22, 1.6);
  aboutScene.add(light);
  lightLines.push({
    mesh: lineMesh,
    light,
    state: 'idle',
    t0: 0,
    lifetime: 0,
  });
}
function tickLightLines(t, dt) {
  for (const ln of lightLines) {
    if (ln.state === 'idle') {
      // ~0.012 chance per frame to spawn → roughly 0.7 spawns/sec per slot.
      // With 6 slots and ~3s mean lifetimes you get 2–4 active at once.
      if (Math.random() < 0.012) {
        const hex = LIGHT_LINE_COLORS[Math.floor(Math.random() * 4)];
        ln.mesh.material.color.setHex(hex);
        ln.light.color.setHex(hex);
        // Random spawn inside the vertical room volume. Cylindrical coords:
        // radius ≤ 5 (inset from the 6.5 wall), spread up the full shaft so
        // neon bars hang at all levels and their reflections streak the wall.
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 5;
        ln.mesh.position.set(
          Math.cos(ang) * rad,
          (Math.random() - 0.5) * ROOM_H * 0.9,
          Math.sin(ang) * rad
        );
        ln.light.position.copy(ln.mesh.position);
        // Random orientation — some lines pillar-vertical, some diagonal,
        // some near-radial. Reads as "neon tubes scattered in the chamber".
        ln.mesh.rotation.set(
          (Math.random() - 0.5) * Math.PI,
          (Math.random() - 0.5) * Math.PI,
          (Math.random() - 0.5) * Math.PI
        );
        ln.lifetime = 2.6 + Math.random() * 3.8;
        ln.t0       = t;
        ln.state    = 'active';
      }
    } else {
      const ratio = (t - ln.t0) / ln.lifetime;
      let amp;
      if (ratio < 0.15)      amp = ratio / 0.15;
      else if (ratio < 0.82) amp = 1.0;
      else if (ratio < 1.0)  amp = (1.0 - ratio) / 0.18;
      else { ln.state = 'idle'; amp = 0; }
      ln.mesh.material.opacity = amp * 0.95;
      ln.light.intensity       = amp * 3.2;
    }
  }
}

// Streak particles — a few hundred points scattered in the tunnel volume so
// when the camera rushes forward they whip past as motion streaks.
const STREAK_COUNT = 140;
const streakPos   = new Float32Array(STREAK_COUNT * 3);
const streakColor = new Float32Array(STREAK_COUNT * 3);
for (let i = 0; i < STREAK_COUNT; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 0.3 + Math.random() * 1.2;
  const z = -1 - Math.random() * 18; // spread along the tunnel depth
  streakPos[i*3+0] = Math.cos(a) * r;
  streakPos[i*3+1] = Math.sin(a) * r;
  streakPos[i*3+2] = z;
  const c = RING_PALETTE[Math.floor(Math.random() * RING_PALETTE.length)];
  streakColor[i*3+0] = c[0];
  streakColor[i*3+1] = c[1];
  streakColor[i*3+2] = c[2];
}
const streakGeo = new THREE.BufferGeometry();
streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
streakGeo.setAttribute('color',    new THREE.BufferAttribute(streakColor, 3));
const streakMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uOpacity: { value: 0 } },
  vertexShader: /* glsl */`
    attribute vec3 color;
    varying vec3 vColor;
    void main(){
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = -mv.z;
      gl_PointSize = 4.0 * (200.0 / max(dist, 0.3));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uOpacity;
    varying vec3 vColor;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q);
      float a = smoothstep(0.5, 0.0, d) * uOpacity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor, a);
    }
  `,
});
const streaks = new THREE.Points(streakGeo, streakMat);
portalGroup.add(streaks);

// ===== PER-PANEL WALL-EMBEDDED ARCHIVE WINDOWS =====
// Each SceneA panel has a recessed observation window cut straight INTO the
// cylinder wall: a rectangular hole is alpha-cut through the metal, a metal-
// lined recess goes back into the wall, and the real photo sits on the recessed
// back face behind only a hairline metal rim. The photo BELONGS to the wall — a
// lab archive window, not a framed picture hung on it.
const PANEL_IMAGES = [
  'img/p1.jpg', 'img/p2.jpg', 'img/p3.jpg',
  'img/p4.jpg', 'img/p5.jpg', 'img/p6.jpg',
];
const exhibits = new Array(6).fill(null);
const PANEL_CLOUD_TARGET_OP = new Array(6).fill(0);
const PANEL_CLOUD_OP = new Array(6).fill(0);

const NICHE_PW = 2.4, NICHE_PH = 3.2, NICHE_DEPTH = 0.4;  // larger, comparable to the panel
const NICHE_ANGLE_OFF = -0.72;
function __nicheAt(i) { const p = aboutPanels[i]; return { a: p.angle + NICHE_ANGLE_OFF, y: p.y }; }

// 1) Cut the six window holes through the wall (alphaMap + alphaTest).
(function cutWallWindows() {
  const AW = 2048, AH = 4096;
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, AW, AH);          // wall = opaque
  x.fillStyle = '#000';                                    // holes = transparent
  const hw = (NICHE_PW / ROOM_R) / (2 * Math.PI) * AW / 2;
  const hh = (NICHE_PH / ROOM_H) * AH / 2;
  for (let i = 0; i < 6; i++) {
    const { a, y } = __nicheAt(i);
    let U = (a / (2 * Math.PI)) % 1; if (U < 0) U += 1;
    const V = (y + ROOM_H / 2) / ROOM_H;
    const cx = U * AW, cy = (1 - V) * AH;
    for (const off of [-AW, 0, AW]) {                      // wrap across the UV seam
      x.beginPath();
      x.roundRect(cx - hw + off, cy - hh, 2 * hw, 2 * hh, 12);
      x.fill();
    }
  }
  const alphaTex = new THREE.CanvasTexture(c);
  wallMat.alphaMap = alphaTex;
  wallMat.alphaTest = 0.5;
  wallMat.needsUpdate = true;
})();

// 2) Build the recess + back-face photo for each window.
const __nicheMetal = () => new THREE.MeshStandardMaterial({
  color: 0x8e94a2, metalness: 0.9, roughness: 0.42, envMapIntensity: 1.0, side: THREE.DoubleSide,
});
for (let i = 0; i < 6; i++) {
  const { a, y } = __nicheAt(i);
  const RB = ROOM_R + NICHE_DEPTH;                         // photo sits behind the wall
  const group = new THREE.Group();
  // dark back-face photo (filled in once the image loads)
  const photoMat = new THREE.MeshBasicMaterial({ color: 0x0d0f14 });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(NICHE_PW, NICHE_PH), photoMat);
  // recess liner: four metal walls from the back face to the opening
  const m = __nicheMetal();
  const top = new THREE.Mesh(new THREE.PlaneGeometry(NICHE_PW, NICHE_DEPTH), m);
  top.position.set(0, NICHE_PH / 2, NICHE_DEPTH / 2); top.rotation.x = Math.PI / 2;
  const bot = new THREE.Mesh(new THREE.PlaneGeometry(NICHE_PW, NICHE_DEPTH), m);
  bot.position.set(0, -NICHE_PH / 2, NICHE_DEPTH / 2); bot.rotation.x = -Math.PI / 2;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(NICHE_DEPTH, NICHE_PH), m);
  left.position.set(-NICHE_PW / 2, 0, NICHE_DEPTH / 2); left.rotation.y = Math.PI / 2;
  const right = new THREE.Mesh(new THREE.PlaneGeometry(NICHE_DEPTH, NICHE_PH), m);
  right.position.set(NICHE_PW / 2, 0, NICHE_DEPTH / 2); right.rotation.y = -Math.PI / 2;
  // hairline metal rim flush at the opening (z = DEPTH ⇒ wall surface)
  const rim = __nicheMetal();
  const barH = new THREE.BoxGeometry(NICHE_PW + 0.06, 0.045, 0.06);
  const barV = new THREE.BoxGeometry(0.045, NICHE_PH + 0.06, 0.06);
  const rimT = new THREE.Mesh(barH, rim); rimT.position.set(0, NICHE_PH / 2, NICHE_DEPTH);
  const rimB = new THREE.Mesh(barH, rim); rimB.position.set(0, -NICHE_PH / 2, NICHE_DEPTH);
  const rimL = new THREE.Mesh(barV, rim); rimL.position.set(-NICHE_PW / 2, 0, NICHE_DEPTH);
  const rimR = new THREE.Mesh(barV, rim); rimR.position.set(NICHE_PW / 2, 0, NICHE_DEPTH);
  group.add(photo, top, bot, left, right, rimT, rimB, rimL, rimR);
  group.position.set(Math.sin(a) * RB, y, Math.cos(a) * RB);
  group.lookAt(0, y, 0);                                   // +Z faces inward through the hole
  aboutScene.add(group);
  exhibits[i] = { photoMat };
}

// 3) Load each photo (gentle archival grade) onto its window's back face.
function loadArchivePhoto(url, idx) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const W = 384, H = 512, targetAR = W / H;               // 3:4
    let cw = img.width, ch = img.height;
    if (cw / ch > targetAR) cw = ch * targetAR; else ch = cw / targetAR;
    const sx = (img.width - cw) / 2, sy = (img.height - ch) * 0.32;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, W, H);
    const id = ctx.getImageData(0, 0, W, H), d = id.data;
    const SAT = 0.82;                                       // gentle grade only
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let R = lum + (r - lum) * SAT, G = lum + (g - lum) * SAT, B = lum + (b - lum) * SAT;
      const grain = (Math.random() - 0.5) * 0.05;
      R += grain; G += grain; B += grain + 0.012;            // tiny cool lift
      d[i] = Math.max(0, Math.min(255, R * 255));
      d[i + 1] = Math.max(0, Math.min(255, G * 255));
      d[i + 2] = Math.max(0, Math.min(255, B * 255));
    }
    ctx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aboutRenderer.capabilities.getMaxAnisotropy();
    const ex = exhibits[idx];
    if (ex) { ex.photoMat.map = tex; ex.photoMat.color.set(0xffffff); ex.photoMat.needsUpdate = true; }
  };
  img.onerror = () => console.warn('[window] failed to load', url);
  img.src = url;
}
PANEL_IMAGES.forEach((url, idx) => { if (url) loadArchivePhoto(url, idx); });

// Pick the indices in the particle pool that this burst will use. Prefer
// dead slots so existing rings keep flying undisturbed; if not enough are
// dead, take the ones nearest to death (the ones the user would barely
// notice replacing). This makes fast scrolling feel smooth — multiple rings
// can coexist instead of slamming each other on top.
function pickRingSlots(n) {
  const dead = [];
  for (let i = 0; i < RING_COUNT; i++) {
    if (ringLife[i] <= 0.001) dead.push(i);
    if (dead.length === n) return dead;
  }
  // not enough dead — fill rest with the lowest-life living particles
  const remaining = [];
  for (let i = 0; i < RING_COUNT; i++) {
    if (ringLife[i] > 0.001) remaining.push(i);
  }
  remaining.sort((a, b) => ringLife[a] - ringLife[b]);
  while (dead.length < n && remaining.length) dead.push(remaining.shift());
  return dead;
}

function emitRing(dir /* +1 = scroll down (rising up), -1 = scroll up (falling down) */) {
  const slots = pickRingSlots(RING_PER_BURST);
  for (let k = 0; k < slots.length; k++) {
    const i = slots[k];
    const angle = (k / slots.length) * Math.PI * 2 + Math.random() * 0.04;
    const r = 2.6 + Math.random() * 0.35;
    ringPos[i*3+0] = Math.cos(angle) * r;
    ringPos[i*3+1] = -dir * 0.4;
    ringPos[i*3+2] = Math.sin(angle) * r;

    const expandSpeed = 0.12 + Math.random() * 0.12;
    ringVel[i*3+0] = Math.cos(angle) * expandSpeed;
    ringVel[i*3+1] = dir * (1.7 + Math.random() * 0.5);
    ringVel[i*3+2] = Math.sin(angle) * expandSpeed;

    const c = RING_PALETTE[Math.floor(Math.random() * RING_PALETTE.length)];
    const jitter = 0.85 + Math.random() * 0.3;
    ringColor[i*3+0] = c[0] * jitter;
    ringColor[i*3+1] = c[1] * jitter;
    ringColor[i*3+2] = c[2] * jitter;

    ringLife[i] = 1.0;
  }
  ringGeo.attributes.position.needsUpdate = true;
  ringGeo.attributes.color.needsUpdate    = true;
  ringGeo.attributes.life.needsUpdate     = true;
}

function tickRingParticles(dt) {
  let anyAlive = false;
  for (let i = 0; i < RING_COUNT; i++) {
    if (ringLife[i] <= 0) continue;
    anyAlive = true;
    ringLife[i] = Math.max(0, ringLife[i] - dt * 0.42); // ~2.4s lifetime — longer arc, smoother fade
    ringPos[i*3+0] += ringVel[i*3+0] * dt;
    ringPos[i*3+1] += ringVel[i*3+1] * dt;
    ringPos[i*3+2] += ringVel[i*3+2] * dt;
    // slow expansion + slight gravity
    ringVel[i*3+0] *= (1 - dt * 0.5);
    ringVel[i*3+1] *= (1 - dt * 0.2);
    ringVel[i*3+2] *= (1 - dt * 0.5);
  }
  if (anyAlive) {
    ringGeo.attributes.position.needsUpdate = true;
    ringGeo.attributes.life.needsUpdate = true;
  }
}

// ---------- About scroll → staircase rotation + portrait dissolve ----------
// Three scroll regions:
//   [ 0,        SCENE_A_END  ) — scene A (DNA helix)
//   [ SCENE_A_END, PORTAL_END ) — portal phase (camera rises through 3D portal)
//   [ PORTAL_END, 1          ] — scene B (vertical narrative)
const SCENE_A_END  = 0.50;
const PORTAL_END   = 0.72;
// Legacy alias kept so snap-to-panel and the hero-ring jump-to-B path still work.
const SCENE_A_FRACTION = SCENE_A_END;
let aboutScrollProgress = 0; // 0 at top, 1 at full scroll
let __prevAboutScroll = 0;
let __scrollDir = 1; // +1 = scrolling down, -1 = up
const stepEls = () => document.querySelectorAll('.step');
function updateAboutScroll() {
  if (!aboutScroll) return;
  const max = Math.max(1, aboutScroll.scrollHeight - aboutScroll.clientHeight);
  aboutScrollProgress = Math.min(1, Math.max(0, aboutScroll.scrollTop / max));

  // track direction so we can reveal only the panel arriving from that side
  const cur = aboutScroll.scrollTop;
  if (cur > __prevAboutScroll + 0.5) __scrollDir = 1;
  else if (cur < __prevAboutScroll - 0.5) __scrollDir = -1;
  __prevAboutScroll = cur;

  // ===== THREE SCROLL REGIONS =====
  const progressA = Math.min(1, aboutScrollProgress / SCENE_A_END);
  const portalProgress = Math.max(0, Math.min(1, (aboutScrollProgress - SCENE_A_END) / (PORTAL_END - SCENE_A_END)));
  const progressB = Math.max(0, Math.min(1, (aboutScrollProgress - PORTAL_END) / (1 - PORTAL_END)));
  const inPortal = portalProgress > 0 && progressB <= 0;
  const inSceneB = progressB > 0;

  // ---- Scene A: helix laid out manually in JS each frame ----
  // Each step orbits a vertical axis at radius 360, with progressA driving
  // a global rotation. Steps always face the camera (no rotateY on the
  // element itself) so the focused panel reads dead-on, no tilt, no offset.
  const TOTAL_RY = -300;
  const START_TY = -275;
  const END_TY   =  275;
  const effA = Math.min(1, progressA);
  const rotorRyDeg = effA * TOTAL_RY;
  const rotorTy    = START_TY + effA * (END_TY - START_TY);
  const rotorRyRad = rotorRyDeg * Math.PI / 180;
  const cosR = Math.cos(rotorRyRad);
  const sinR = Math.sin(rotorRyRad);

  if (staircaseRotor) {
    // rotor element itself no longer rotates; opacity/blur driven by portal
    if (portalProgress <= 0.001) {
      staircaseRotor.style.opacity = '';
      staircaseRotor.style.filter = '';
    } else {
      const fade = Math.min(1, portalProgress / 0.08);
      staircaseRotor.style.opacity = String(Math.max(0, 1 - fade));
      staircaseRotor.style.filter = `blur(${(fade * 22).toFixed(1)}px)`;
    }
  }
  document.querySelectorAll('.step').forEach((s, i) => {
    // step's natural slot on the helix
    const stepRyDeg = i * 60;
    const stepTy    = 275 - i * 110;
    const stepRyRad = stepRyDeg * Math.PI / 180;
    const baseX = 360 * Math.sin(stepRyRad);
    const baseZ = 360 * Math.cos(stepRyRad);
    // apply rotor's rotation around Y to (baseX, baseZ)
    const x = baseX * cosR + baseZ * sinR;
    const z = -baseX * sinR + baseZ * cosR;
    const y = stepTy + rotorTy;
    s.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) translate(-50%, -50%)`;
  });
  const degA = rotorRyDeg; // alias used below for focus calc

  // ---- Wormhole tunnel ----
  // Tunnel rings sit along negative Z, face-on. The camera physically flies
  // toward and through them. A tail of scene A previews the first ring so
  // the appearance is continuous.
  const ringPreview = Math.max(0, Math.min(1, (progressA - 0.9) / 0.1));
  const tunnelActive = portalProgress > 0 || ringPreview > 0;
  if (tunnelActive) {
    portalGroup.visible = true;
    portalGroup.rotation.z += 0.002; // slow self-rotation gives the tunnel life
    const inOpacity  = portalProgress > 0 ? Math.min(1, portalProgress / 0.12) : ringPreview * 0.5;
    const outOpacity = portalProgress > 0.96 ? Math.max(0, 1 - (portalProgress - 0.96) / 0.04) : 1;
    const op = inOpacity * outOpacity;
    tunnelMat.uniforms.uOpacity.value = op * 0.95;
    streakMat.uniforms.uOpacity.value = op * 0.8;
  } else {
    portalGroup.visible = false;
    tunnelMat.uniforms.uOpacity.value = 0;
    streakMat.uniforms.uOpacity.value = 0;
  }

  // ---- Camera physical motion ----
  // Pure Z translation along the tunnel axis. As portalProgress climbs from 0
  // to 1, the camera moves from z=9 (well outside the tunnel, looking in) all
  // the way to z=-18 (out the far end, into scene B's space). Rings live in
  // z = -1 to -18 so the camera literally passes each one.
  if (portalProgress <= 0) {
    aboutCam.userData.target = null;
  } else {
    let camZ;
    if (portalProgress < 0.12) {
      // pull back a touch to give a sense of depth ramp-up
      const k = portalProgress / 0.12;
      camZ = 9.0 + k * 1.5;          // 9 → 10.5
    } else {
      // accelerate forward through the entire tunnel
      const k = (portalProgress - 0.12) / 0.88;
      // ease-in (slow start, fast finish) so it feels like accelerating
      const eased = k * k;
      camZ = 10.5 - eased * 28.5;    // 10.5 → -18
    }
    aboutCam.userData.target = {
      x: 0, y: 0, z: camZ,
      // look straight down the tunnel axis (always at z 5 in front of the camera)
      look: { x: 0, y: 0, z: camZ - 5 },
    };
  }
  aboutCam.userData.sceneBSettle = progressB > 0;

  // ---- Scene B: corridor track ----
  // 4 panels at z = -300, -800, -1300, -1800. Pull the whole track forward
  // (positive translateZ) so each panel arrives at z = 0 = the camera plane.
  const corridorTrack = document.getElementById('corridorTrack');
  if (corridorTrack) {
    const zOffset = progressB * 1800;
    corridorTrack.style.transform = `translateZ(${zOffset}px)`;
  }

  // ---- Compute focus ----
  // global focusIdx: 0..5 = scene A panels, 6..9 = scene B corridor panels.
  let focusIdx, approachAmount;
  if (progressB <= 0.001) {
    const focusF = (-degA) / 60;
    focusIdx = Math.max(0, Math.min(5, Math.round(focusF)));
    approachAmount = Math.min(1, Math.abs(focusF - focusIdx) * 2);
  } else {
    // 4 corridor panels at z=-300,-800,-1300,-1800 — spacing 500.
    // panel k centred when offset = -panel_z[k] = 300+500k → progressB = (300+500k)/1800
    const localF = (progressB * 1800 - 300) / 500;
    const localIdx = Math.max(0, Math.min(3, Math.round(localF)));
    focusIdx = 6 + localIdx;
    approachAmount = Math.min(1, Math.abs(localF - localIdx) * 2);
  }
  const approachIdx = Math.max(0, Math.min(9, focusIdx + __scrollDir));

  // Body class state machine — eyebrow flips to scene B once the camera is past
  // the portal's mid-point (portalProgress > 0.5), so by the time the user lands
  // in scene B the title already says "WHY THIS LAB EXISTS".
  document.body.classList.toggle('in-portal', inPortal);
  document.body.classList.toggle('scene-b', inSceneB || portalProgress > 0.5);

  // When the focused panel changes, fire ONE coloured ring (no scene-cross
  // explosion). At the A↔B boundary the ring naturally streaks upward and
  // off-screen — that's the visual cue the camera is "chasing" it into the
  // next scene.
  if (typeof updateAboutScroll.lastFocus === 'undefined') updateAboutScroll.lastFocus = focusIdx;
  if (focusIdx !== updateAboutScroll.lastFocus) {
    // (Removed) coloured ring burst — it read as stray floating particles in
    // the metal chamber. void to keep emitRing referenced without firing.
    void emitRing;
    updateAboutScroll.lastFocus = focusIdx;
  }
  // Update scene-A panels (.step, indices 0..5) and scene-B panels (.corridor-step,
  // global indices 6..9) — only the matching one shows as current.
  document.querySelectorAll('.step').forEach((s, i) => {
    const isCurrent = (i === focusIdx);
    const isApproaching = (i === approachIdx && approachIdx < 6 && approachIdx !== focusIdx);
    s.classList.toggle('current', isCurrent);
    s.classList.toggle('approaching', isApproaching);
    if (isApproaching) s.style.setProperty('--approach', approachAmount.toFixed(3));
    else s.style.removeProperty('--approach');
  });

  // Per-panel image cloud opacity targets — also fade away during the portal phase
  const inSceneA = (progressB <= 0.001) && (portalProgress < 0.05);
  for (let i = 0; i < 6; i++) {
    let op = 0;
    if (inSceneA) {
      if (i === focusIdx)      op = 1;
      else if (i === approachIdx && approachIdx < 6) op = approachAmount * 0.85;
    }
    PANEL_CLOUD_TARGET_OP[i] = op;
  }

  // (Holograms are fixed in space beside their panels — the old DNA-helix
  // positioning is retired; opacity is driven from aboutTick instead.)
  document.querySelectorAll('.corridor-step').forEach((s, i) => {
    const g = 6 + i;
    const isCurrent = (g === focusIdx);
    const isApproaching = (g === approachIdx && approachIdx >= 6 && approachIdx !== focusIdx);
    s.classList.toggle('current', isCurrent);
    s.classList.toggle('approaching', isApproaching);
    if (isApproaching) s.style.setProperty('--approach', approachAmount.toFixed(3));
    else s.style.removeProperty('--approach');
  });

  // SceneB centre lines: panel 1 (focusIdx 6) → 1 line, panel 4 (focusIdx 9) → 4 lines.
  // Scrolling back removes lines (toggle .show off).
  const sceneBLines = document.querySelectorAll('.scene-b-lines p');
  let visibleLines = 0;
  if (focusIdx >= 6) visibleLines = Math.min(4, focusIdx - 6 + 1);
  sceneBLines.forEach((p, i) => p.classList.toggle('show', i < visibleLines));

  // SceneB "doubt voices": 8 scattered phrases that materialize as the user
  // advances through corridor panels (panel 1→2 adds 2, …, all 8 by panel 4).
  // The reveal order is a stable random shuffle generated once per session, so
  // scrolling back hides the same words in reverse without reshuffling.
  if (!updateAboutScroll.fogOrder) {
    const idx = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    updateAboutScroll.fogOrder = idx;
    updateAboutScroll.fogWords = Array.from(document.querySelectorAll('.fog-word'));
  }
  // Inverted progression: panel 1 shows the full chorus of 8 doubts; each
  // panel deeper dissolves 2 random ones into particles. Two stubborn doubts
  // persist at the final panel. The shuffled order determines which 2 fade
  // at each step, so reverse-scrolling re-materializes them in stable order.
  let visibleFog = 0;
  if (focusIdx === 6)      visibleFog = 8;
  else if (focusIdx === 7) visibleFog = 6;
  else if (focusIdx === 8) visibleFog = 4;
  else if (focusIdx >= 9)  visibleFog = 2;
  updateAboutScroll.fogOrder.forEach((wordIdx, k) => {
    const w = updateAboutScroll.fogWords[wordIdx];
    if (w) w.classList.toggle('visible', k < visibleFog);
  });

  // dissolve the portrait gradually
  portraitMat.uniforms.uDissolve.value = Math.min(1, aboutScrollProgress * 1.05);
  if (aboutScrollProgress > 0.03 && aboutHint) aboutHint.classList.add('faded');
}

// while the user is actively scrolling, reveal every step; idle for 350ms → fade back
// to only the focused step. <body> carries the class so it applies to all step descendants.
let __scrollIdleTimer = null;
function markScrolling() {
  document.body.classList.add('about-scrolling');
  clearTimeout(__scrollIdleTimer);
  __scrollIdleTimer = setTimeout(() => {
    document.body.classList.remove('about-scrolling');
  }, 380);
}

// ---------- Snap-to-panel ("damping pull") ----------
// When the user stops scrolling, smoothly pull the scroll position to the
// nearest panel's natural centre so panels always settle face-on. The
// movement is short and cubic-eased so it doesn't fight the user nor disrupt
// the fade-in/out — they keep transitioning naturally as scrollTop animates.

let __snapTimer = null;
let __snappingActive = false;

function panelTargetProgress(curProgress) {
  // snap to the nearest of the ten panel stops (+ doubt-swarm + final page)
  const stops = buildScrollStops();
  let best = stops[0], bd = Infinity;
  for (const s of stops) {
    const d = Math.abs(s - curProgress);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function smoothScrollAbout(targetTop, duration = 360) {
  const startTop = aboutScroll.scrollTop;
  const delta = targetTop - startTop;
  if (Math.abs(delta) < 1.5) return;
  const startTime = performance.now();
  __snappingActive = true;
  function tick() {
    const t = Math.min(1, (performance.now() - startTime) / duration);
    // cubic ease-out — soft pull, no hard stop
    const eased = 1 - Math.pow(1 - t, 3);
    aboutScroll.scrollTop = startTop + delta * eased;
    if (t < 1) requestAnimationFrame(tick);
    else __snappingActive = false;
  }
  requestAnimationFrame(tick);
}

function maybeSnap() {
  clearTimeout(__snapTimer);
  __snapTimer = setTimeout(() => {
    if (__snappingActive) return;
    const max = aboutScroll.scrollHeight - aboutScroll.clientHeight;
    if (max <= 0) return;
    const cur = aboutScroll.scrollTop / max;
    const target = panelTargetProgress(cur);
    // only snap if we're meaningfully off-centre — otherwise leave alone
    const targetTop = target * max;
    if (Math.abs(targetTop - aboutScroll.scrollTop) > 6) {
      smoothScrollAbout(targetTop, 380);
    }
  }, 220);
}

aboutScroll?.addEventListener('scroll', () => {
  markScrolling();
  updateAboutScroll();
  if (!__snappingActive) maybeSnap();
}, { passive: true });

// ---------- Step-locked scroll ----------
// One wheel/swipe = one panel. We intercept wheel events, jump exactly to the
// neighbouring stop, then ignore further input until the animation finishes —
// so a long flick can't tear through multiple panels in a single gesture.
// Stops:
//   index 0..5  → scene A panel 1..6
//   index 6..9  → scene B panel 1..4 (corridor)
// The 5↔6 transition is the wormhole — it gets a longer duration.
function buildScrollStops() {
  // 10 wall panels framed across the first 66% of scroll, then a pause in the
  // doubt swarm and the final reflective-ceiling page.
  const arr = [];
  const N = 10, P1 = 0.66;
  for (let i = 0; i < N; i++) arr.push((i / (N - 1)) * P1);
  // doubt-swarm stops: two — a lower and an upper view of the voices …
  arr.push(0.77);
  arr.push(0.88);
  // … then the final reflective-ceiling page. MUST be 1.0 so the finale
  // easing (which ramps over sp ∈ [0.92, 1.0]) reaches fE = 1: camera lands
  // exactly on the central axis (orbit = 0), the skylight is dead centre,
  // the up-vector blend completes, and the billboarded SceneC text stops
  // tilting. Setting this below 1.0 leaves the camera off-axis at the final
  // stop and the whole composition slants.
  arr.push(1.0);
  return arr;
}

// Lock model: only TWO conditions can block a step.
//   1) An animation is currently playing  (now < __scrollLockUntil)
//   2) The wheel stream hasn't paused long enough  (gap < QUIET_MS)
// Crucially the lock NEVER auto-extends. The moment the user stops scrolling,
// they can immediately start the next step — no "infinite chain locks".
let __scrollLockUntil = 0;
let __lastWheelAt = 0;
// A trackpad "flick" fires 20+ inertia events. Treat one BURST of events as a
// single gesture: the first event triggers a step, all the others are ignored
// until the burst ends (no input for GESTURE_END_MS). The queue is for an
// honest second gesture that arrives while the previous step is still animating.
const GESTURE_END_MS = 120;
let __inGesture = false;
let __gestureEndTimer = null;
function __markGesture() {
  if (__gestureEndTimer) clearTimeout(__gestureEndTimer);
  __gestureEndTimer = setTimeout(() => { __inGesture = false; }, GESTURE_END_MS);
}
let __queuedDir = 0;            // one-deep queue
let __queueTimer = null;
function __consumeQueue() {
  __queueTimer = null;
  if (__queuedDir === 0) return;
  if (performance.now() < __scrollLockUntil) {
    __queueTimer = setTimeout(__consumeQueue, __scrollLockUntil - performance.now() + 10);
    return;
  }
  const d = __queuedDir; __queuedDir = 0;
  doStep(d);
}
function __queueStep(dir) {
  __queuedDir = dir;             // latest direction wins
  if (__queueTimer) clearTimeout(__queueTimer);
  __queueTimer = setTimeout(__consumeQueue, Math.max(20, __scrollLockUntil - performance.now() + 10));
}

function nearestStopIndex(curProg) {
  const stops = buildScrollStops();
  let idx = 0, best = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = Math.abs(stops[i] - curProg);
    if (d < best) { best = d; idx = i; }
  }
  return idx;
}

function doStep(dir) {
  const stops = buildScrollStops();
  const max = Math.max(1, aboutScroll.scrollHeight - aboutScroll.clientHeight);
  const curIdx = nearestStopIndex(aboutScroll.scrollTop / max);
  // At the FINAL stop, scrolling DOWN one more time pushes the camera into the
  // ceiling skylight and loops back to the homepage WORK section.
  if (dir > 0 && curIdx >= stops.length - 1) { __exitThroughSkylight(); return; }
  const nextIdx = Math.max(0, Math.min(stops.length - 1, curIdx + dir));
  if (nextIdx === curIdx) return;
  const duration = 320;
  smoothScrollAbout(stops[nextIdx] * max, duration);
  __scrollLockUntil = performance.now() + duration;
}

// --------- Exit through the skylight → homepage WORK section ----------------
let __exiting = false;
let __exitStart = 0;
let __exitStartY = 0;
const __EXIT_MS = 1100;
let __exitFlashEl = null;
function __ensureFlash() {
  if (__exitFlashEl) return __exitFlashEl;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:#ffffff;opacity:0;pointer-events:none;z-index:9000;mix-blend-mode:normal;transition:none;';
  document.body.appendChild(el);
  __exitFlashEl = el;
  return el;
}
function __exitThroughSkylight() {
  if (__exiting) return;
  __exiting = true;
  __exitStart = performance.now();
  __exitStartY = aboutCam.position.y;
  __ensureFlash();
  // lock all input for the duration of the exit
  __scrollLockUntil = performance.now() + __EXIT_MS + 200;
  setTimeout(() => {
    // jump main page to the WORK section
    const work = document.getElementById('work');
    if (work) {
      const top = work.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top, behavior: 'instant' in window ? 'instant' : 'auto' });
    }
    // tear about-view down
    aboutView.classList.remove('active');
    aboutView.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mode-about');
    mode = 'hero';
    // reset the about scroll so re-entry starts fresh
    aboutScroll.scrollTop = 0;
    // CRITICAL: hero camera was rammed up against a ring by playCameraPushToRing
    // when the user first entered the About view; if we don't reset it here,
    // scrolling back up to the hero page from #work shows the cylinder pressed
    // right against the lens — distorted and filling the screen. The user is
    // landing on #work (well past the hero), so snap the camera home instantly
    // instead of tweening; by the time they scroll back, it's in the right pose.
    camera.position.set(0, 0, responsiveCamZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    __heroTransiting = false;
    // fade the flash out over the next 600ms
    const el = __exitFlashEl;
    const t0 = performance.now();
    function fadeOut() {
      const t = Math.min(1, (performance.now() - t0) / 600);
      el.style.opacity = String(1 - t);
      if (t < 1) requestAnimationFrame(fadeOut); else { el.style.opacity = '0'; __exiting = false; }
    }
    requestAnimationFrame(fadeOut);
  }, __EXIT_MS);
}

function onAboutWheel(e) {
  e.preventDefault();
  const now = performance.now();
  const dir = e.deltaY > 0 ? 1 : -1;
  __lastWheelAt = now;
  __markGesture();                         // keep the burst alive
  if (__inGesture) return;                 // we already counted this gesture
  __inGesture = true;
  if (now < __scrollLockUntil) { __queueStep(dir); return; }
  doStep(dir);
}
// Attach the wheel/touch listeners to aboutView so events over BOTH the inner
// scroller AND the WebGL canvas (siblings inside aboutView) reach the gesture
// handler — otherwise wheels over the canvas (common in SceneB where the
// staircase content is hidden) bypass it and trigger native multi-step jumps.
// Use capture:true so we receive them before any child handler.
const __wheelHost = aboutView || aboutScroll;
__wheelHost?.addEventListener('wheel', onAboutWheel, { passive: false, capture: true });

// Touch swipe → same lock model. Each touchstart resets the gesture gate so a
// new finger-down counts as a fresh user intent.
let __touchStartY = null;
__wheelHost?.addEventListener('touchstart', (e) => {
  __touchStartY = e.touches[0]?.clientY ?? null;
  __inGesture = false;
  if (__gestureEndTimer) { clearTimeout(__gestureEndTimer); __gestureEndTimer = null; }
}, { passive: true, capture: true });
__wheelHost?.addEventListener('touchmove', (e) => {
  const now = performance.now();
  if (__touchStartY == null) { e.preventDefault(); return; }
  const dy = __touchStartY - (e.touches[0]?.clientY ?? __touchStartY);
  if (Math.abs(dy) < 30) return;
  e.preventDefault();
  __touchStartY = null;
  const dir = dy > 0 ? 1 : -1;
  if (now < __scrollLockUntil) { __queueStep(dir); return; }
  doStep(dir);
}, { passive: false, capture: true });

// ---------- Enter / exit transitions ----------
let mode = 'hero'; // 'hero' | 'about'

// 360° outward-burst particle ring — used when the camera "drills through"
// the portal between scene A (WHO I AM) and scene B (WHY THIS LAB EXISTS).
function emitShockwave() {
  const slots = pickRingSlots(Math.min(RING_COUNT, 160));
  for (let k = 0; k < slots.length; k++) {
    const i = slots[k];
    const theta = (k / slots.length) * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI * 0.7;
    const r = 0.4 + Math.random() * 0.3;
    const cphi = Math.cos(phi);
    ringPos[i*3+0] = Math.cos(theta) * cphi * r;
    ringPos[i*3+1] = Math.sin(phi) * r;
    ringPos[i*3+2] = Math.sin(theta) * cphi * r;
    const speed = 3.0 + Math.random() * 1.4;
    ringVel[i*3+0] = Math.cos(theta) * cphi * speed;
    ringVel[i*3+1] = Math.sin(phi) * speed;
    ringVel[i*3+2] = Math.sin(theta) * cphi * speed;
    const c = RING_PALETTE[Math.floor(Math.random() * RING_PALETTE.length)];
    const jitter = 0.85 + Math.random() * 0.3;
    ringColor[i*3+0] = c[0] * jitter;
    ringColor[i*3+1] = c[1] * jitter;
    ringColor[i*3+2] = c[2] * jitter;
    ringLife[i] = 1.0;
  }
  ringGeo.attributes.position.needsUpdate = true;
  ringGeo.attributes.color.needsUpdate    = true;
  ringGeo.attributes.life.needsUpdate     = true;
}

function enterAbout(startSceneIdx /* 0=SceneA, 1=SceneB, 2=SceneC */) {
  if (mode === 'about') return;
  mode = 'about';
  const ringIdx = Math.max(0, Math.min(2, startSceneIdx | 0));

  // Step 1: hero camera physically rams into the clicked ring.
  // Step 2 (mid-push): hero shell starts fading + about-view enters.
  // Step 3 (push end): about-view fully active; scroll is set INSTANTLY to the
  // requested stop (no smooth animation through panels, so it doesn't auto-fly
  // through intermediate stops or get caught by the snap/gesture system).
  playCameraPushToRing(ringIdx, 650, () => {
    setTimeout(() => { __heroTransiting = false; }, 600);
  });
  setTimeout(() => { document.body.classList.add('mode-about'); }, 200);
  setTimeout(() => {
    aboutView.classList.add('active');
    aboutView.setAttribute('aria-hidden', 'false');
    const max = Math.max(1, aboutScroll.scrollHeight - aboutScroll.clientHeight);
    const stops = buildScrollStops();
    // SceneA → first panel (stop 0); SceneB → first SceneB content panel
    // (stop 6 = panel 7); SceneC → first doubt-zone stop (10), one scroll
    // up to upper doubt, two scrolls up to the ceiling.
    const targetIdx = ringIdx === 2 ? 10 : ringIdx === 1 ? 6 : 0;
    aboutScroll.scrollTop = stops[targetIdx] * max;
    updateAboutScroll();
  }, 480);
}
// Reverse of playCameraPushToRing — eases the hero camera from wherever it
// landed (right up against a cylinder ring) back to its home pose so the
// next time the user looks at the hero, the cylinder is at full distance
// again. ease-out so the move feels like a graceful retreat, not a snap.
function playCameraReturnToHero(duration, done) {
  const startPos = camera.position.clone();
  const targetPos = new THREE.Vector3(0, 0, responsiveCamZ);
  __heroTransiting = true;
  const t0 = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - t0) / duration);
    const k = 1 - Math.pow(1 - t, 3); // cubic ease-out
    camera.position.lerpVectors(startPos, targetPos, k);
    camera.lookAt(0, 0, 0);
    if (t < 1) requestAnimationFrame(tick);
    else {
      __heroTransiting = false;
      if (done) done();
    }
  }
  requestAnimationFrame(tick);
}

function exitAbout() {
  if (mode === 'hero') return;
  mode = 'hero';
  document.body.classList.remove('mode-about');
  document.body.classList.remove('scene-b');
  document.body.classList.remove('in-portal');
  aboutView.classList.remove('active');
  aboutView.setAttribute('aria-hidden', 'true');
  // pull the hero camera back to its starting position so the hero page
  // looks the same as it did before the user opened about
  playCameraReturnToHero(600);
}
aboutClose?.addEventListener('click', exitAbout);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitAbout(); });

// Topbar nav wiring:
//   ABOUT → open the about view at SceneA (WHO I AM), same as clicking the
//           top cylinder ring. Intercept the anchor so we run the camera
//           push instead of an unhelpful jump-to-#about (which doesn't exist).
//   WORK  → smooth-scroll the homepage to the exhibition section (id="work"
//           was moved from the editorial title to "THE FLOOR"), so default
//           anchor behaviour already does the right thing — but if we're
//           currently inside the about view, close it first.
document.querySelectorAll('a[data-nav="about"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (mode === 'about') return;
    enterAbout(0);
  });
});
document.querySelectorAll('a[data-nav="work"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (mode === 'about') exitAbout();
    const work = document.getElementById('work');
    if (work) {
      const top = work.getBoundingClientRect().top + window.scrollY;
      // tiny defer so the exitAbout transition starts before we scroll
      setTimeout(() => window.scrollTo({ top, behavior: 'smooth' }), mode === 'about' ? 50 : 0);
    }
  });
});

// ---------- Click the top ring (WHO I AM) → open about ----------
let __clickStart = null;
window.addEventListener('pointerdown', (e) => {
  __clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
window.addEventListener('pointerup', (e) => {
  const start = __clickStart;
  __clickStart = null;
  if (!start) return;
  const dt = performance.now() - start.t;
  const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
  if (dt > 350 || moved > 8) return; // it was a drag, not a click
  if (mode !== 'hero') return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(rings.map(r => r.mesh), false);
  if (!hits.length) return;
  // ring 0 (WHO I AM) → SceneA panel 1
  // ring 1 (WHY THIS LAB EXISTS) → SceneB first content panel (stop 6)
  // ring 2 (FIRE AHEAD) → doubt-zone + ceiling (stop 10)
  const idx = rings.findIndex(r => r.mesh === hits[0].object);
  enterAbout(idx === 2 ? 2 : idx === 1 ? 1 : 0);
});

// ---------- About scene resize ----------
function onAboutResize() {
  aboutCam.aspect = window.innerWidth / window.innerHeight;
  aboutCam.updateProjectionMatrix();
  aboutRenderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onAboutResize);
onAboutResize();

// ---------- About scene tick (only renders while active to save GPU) ----------
let __aboutLastT = 0;
function aboutTick() {
  if (mode === 'about' || aboutView.classList.contains('active')) {
    const t = clock.elapsedTime;
    const dt = Math.min(0.05, t - __aboutLastT);
    __aboutLastT = t;
    glassUniforms.uTime.value = t;
    portraitMat.uniforms.uTime.value = t;
    tunnelMat.uniforms.uTime.value = t;
    tickRingParticles(dt);

    // (Removed) the free-floating random neon light-line pool — it read as
    // bars hovering in mid-air rather than reflections. The only neon now is
    // the colour columns baked into the wall's emissive map.
    void tickLightLines;

    // (Archive windows are part of the wall — always visible, no opacity tween.)

    // TRAVEL CAMERA — the operator rides UP the cylindrical shaft.
    // Phase 1 (scroll 0→0.66): frame the ten wall panels one by one (6 SceneA +
    // 4 SceneB). The eye sits off-centre opposite each panel so the curved wall
    // wraps around it. Phase 2 (0.66→1): drift to the central axis and rise
    // through the doubt-voice swarm, then up to the reflective ceiling.
    const sp = aboutScrollProgress;
    const N = aboutPanels.length;
    const bob = Math.sin(t * 0.5) * 0.12;
    const PHASE1_END = 0.66;

    // ---- panel-framing pose ----
    const travel = Math.min(1, sp / PHASE1_END);
    const fIdx = travel * (N - 1);
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(N - 1, i0 + 1);
    const f  = fIdx - i0;
    const ease = f * f * (3 - 2 * f);
    const pAng  = aboutPanels[i0].angle + (aboutPanels[i1].angle - aboutPanels[i0].angle) * ease;
    const pY    = aboutPanels[i0].y + (aboutPanels[i1].y - aboutPanels[i0].y) * ease;
    const camRad = 2.7, camAng = pAng + Math.PI;
    const pPosX = Math.sin(camAng) * camRad, pPosZ = Math.cos(camAng) * camRad, pPosY = pY + bob;
    const pLookX = Math.sin(pAng) * ROOM_R, pLookY = pY, pLookZ = Math.cos(pAng) * ROOM_R;

    // ---- central rising pose (doubt zone → skylight) ----
    // The camera rises SLOWLY through the doubt swarm with a forward gaze across
    // 0.66 → 0.90 (a long window so the viewer can step through the voices,
    // lower → upper), then pitches up into the reflective ceiling only in the
    // final 0.90 → 1.0.
    const a = Math.max(0, Math.min(1, (sp - PHASE1_END) / (0.92 - PHASE1_END)));
    const aE = a * a * (3 - 2 * a);
    const spiral = a * Math.PI * 0.42;                 // gentle turn so the forward
    //                                                    doubt-wedge stays in view
    const aRad = 1.9;
    const topY = aboutPanels[N - 1].y;
    const riseY = topY + aE * ((CEIL_Y - 9) - topY) + bob * 0.4;
    const finale = Math.max(0, Math.min(1, (sp - 0.92) / 0.08));   // pitch up 0.92→1.0
    const fE = finale * finale;
    // At the final page, pull the camera onto the central axis AND look almost
    // straight up so the ceiling disc sits fronto-parallel and the four lines
    // read horizontal (instead of looking up at an angle and seeing the text
    // skewed into spokes). A small forward offset keeps lookAt non-degenerate.
    const orbit = aRad * (1 - fE);
    const aPosX = Math.sin(spiral) * orbit, aPosZ = Math.cos(spiral) * orbit, aPosY = riseY;
    const aLookX = -Math.sin(spiral) * 2.0 * (1 - fE);
    const aLookZ = -Math.cos(spiral) * 2.0 * (1 - fE) - 0.001 * fE;
    const aLookY = riseY + 1.4 + fE * (CEIL_Y + 2 - riseY);

    // ---- blend the two poses ----
    // Pose blend resolves fast (camera is on the central axis by ~sp 0.73) so
    // the viewer is inside the doubt swarm well before it materialises; the
    // vertical rise (riseY, via aE) keeps climbing gradually after that.
    const kk = Math.max(0, Math.min(1, (sp - PHASE1_END) / 0.05));
    const k = kk * kk * (3 - 2 * kk);
    aboutCam.position.set(
      pPosX + (aPosX - pPosX) * k,
      pPosY + (aPosY - pPosY) * k,
      pPosZ + (aPosZ - pPosZ) * k
    );
    // When easing into SceneC the camera ends up on the central axis looking
    // straight up at the skylight. Three.js's default camera.up = (0,1,0)
    // becomes parallel to the forward vector at that pose — pure gimbal lock,
    // so the camera's roll angle flips arbitrarily and the billboarded SceneC
    // text spins around the forward axis. Blend the up vector toward world
    // -Z as we approach the SceneC pose (tracked by fE) so the roll always
    // has a stable horizontal reference, and lookAt produces a consistent
    // quaternion the text plane can copy.
    const upBlend = Math.max(0, Math.min(1, fE * 1.4));
    aboutCam.up.set(0, 1 - upBlend, -upBlend).normalize();
    aboutCam.lookAt(
      pLookX + (aLookX - pLookX) * k,
      pLookY + (aLookY - pLookY) * k,
      pLookZ + (aLookZ - pLookZ) * k
    );

    // SceneB doubt voices materialise and billboard to the camera.
    tickSceneB(sp, t);

    // SceneC text plane — billboard to the camera, fade in at the final page.
    let appearC = Math.max(0, Math.min(1, (sp - 0.88) / 0.06));
    if (appearC > 0) {
      aboutCam.updateMatrixWorld();
      const e = aboutCam.matrixWorld.elements;
      const fwd = new THREE.Vector3(-e[8], -e[9], -e[10]);
      const D = 6.4;
      sceneCPlane.position.copy(aboutCam.position).addScaledVector(fwd, D);
      sceneCPlane.quaternion.copy(aboutCam.quaternion);
    }

    // ---- Exit-through-the-skylight animation (loops back to homepage WORK) ----
    if (__exiting) {
      const ex = Math.min(1, (performance.now() - __exitStart) / __EXIT_MS);
      const exE = ex * ex;                             // ease-in (accelerating dive)
      // pull camera straight up toward the skylight at CEIL_Y - 0.4
      const targetY = CEIL_Y - 0.4;
      aboutCam.position.set(0, __exitStartY + (targetY - __exitStartY) * exE, 0);
      // straight-up look — same gimbal-lock fix as the SceneC pose above
      aboutCam.up.set(0, 0, -1);
      aboutCam.lookAt(0, CEIL_Y + 6, 0);               // look up into the white
      // SceneC text fades out as we dive in
      appearC = Math.max(0, 1 - ex * 1.4);
      // white flash grows from 0 → 1 (eased late so it peaks at the end)
      if (__exitFlashEl) __exitFlashEl.style.opacity = String(exE);
    }
    sceneCMat.opacity = appearC;

    // Hard-hide the retired tunnel point cloud so it never floats in the room.
    portalGroup.visible = false;

    aboutRenderer.render(aboutScene, aboutCam);
  }
  requestAnimationFrame(aboutTick);
}
aboutTick();

// ---------- Language switch ----------
const LANG_KEY = 'ydl-lang';
function setLang(lang) {
  if (lang !== 'en' && lang !== 'cn') lang = 'en';
  document.body.classList.remove('lang-en', 'lang-cn');
  document.body.classList.add('lang-' + lang);
  document.documentElement.lang = (lang === 'cn') ? 'zh-CN' : 'en';
  if (window.__redrawAboutPanels) window.__redrawAboutPanels(lang);
  document.querySelectorAll('.lang-switch button[data-set-lang]').forEach((b) => {
    b.classList.toggle('active', b.dataset.setLang === lang);
  });
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
}
document.querySelectorAll('.lang-switch button[data-set-lang]').forEach((b) => {
  b.addEventListener('click', () => setLang(b.dataset.setLang));
});
// restore previous choice
try {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved) setLang(saved);
} catch {}
