import * as THREE from 'three';

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

  if (ease > 0.75 && exitEase < 0.5) categoriesEl.classList.add('visible');
  else categoriesEl.classList.remove('visible');

  camera.position.x += (pointer.x * 0.4 - camera.position.x) * 0.04;
  camera.position.y += (pointer.y * 0.25 - camera.position.y) * 0.04;
  camera.lookAt(0, 0, 0);
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

// ---------- Category buttons ----------
document.querySelectorAll('.cat').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.cat;
    // For now: pulse the flame and log. Hook up to project routes later.
    flameUniforms.uIntensity.value = 1.6;
    setTimeout(() => { flameUniforms.uIntensity.value = 0.55 + scrollProgress * 0.5; }, 400);
    console.log('category:', cat);
  });
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

const aboutScene  = new THREE.Scene();
const aboutCam    = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
aboutCam.position.set(0, 0, 9);

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
aboutScene.add(ringParticles);

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

  // DNA spiral motion (unchanged)
  const TOTAL_RY = -300;
  const START_TY = -275;
  const END_TY   =  275;
  const deg = aboutScrollProgress * TOTAL_RY;
  if (staircaseRotor) {
    const ty  = START_TY + aboutScrollProgress * (END_TY - START_TY);
    staircaseRotor.style.transform = `translateY(${ty}px) rotateY(${deg}deg)`;
  }

  // current = panel facing camera (closest to -deg / 60 multiple)
  // approaching = the NEXT panel in the user's scroll direction; that's the one
  //   fading IN. Panels behind (already passed) fade out automatically because
  //   they're neither current nor approaching.
  const focusF = (-deg) / 60;
  const focusIdx = Math.max(0, Math.min(5, Math.round(focusF)));
  const approachIdx = Math.max(0, Math.min(5, focusIdx + __scrollDir));

  // when the focused panel changes (you've actually arrived at a new step),
  // burst a ring of coloured particles in the scroll direction
  if (typeof updateAboutScroll.lastFocus === 'undefined') updateAboutScroll.lastFocus = focusIdx;
  if (focusIdx !== updateAboutScroll.lastFocus) {
    emitRing(__scrollDir);
    updateAboutScroll.lastFocus = focusIdx;
  }
  // continuous reveal: how far along we are toward the approaching panel (0..1)
  const approachAmount = Math.min(1, Math.max(0, Math.abs(focusF - focusIdx) * 2));
  stepEls().forEach((s, i) => {
    const isCurrent = (i === focusIdx);
    const isApproaching = (i === approachIdx && approachIdx !== focusIdx);
    s.classList.toggle('current', isCurrent);
    s.classList.toggle('approaching', isApproaching);
    if (isApproaching) {
      s.style.setProperty('--approach', approachAmount.toFixed(3));
    } else {
      s.style.removeProperty('--approach');
    }
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
aboutScroll?.addEventListener('scroll', () => {
  markScrolling();
  updateAboutScroll();
}, { passive: true });

// ---------- Enter / exit transitions ----------
let mode = 'hero'; // 'hero' | 'about'
const flashEl = document.getElementById('impactFlash');

// 360° outward-burst particle ring — the "shockwave" that fires the moment
// you slam through the cylinder. Unlike the per-step rings, this one doesn't
// have a vertical direction; it explodes radially in 3D.
function emitShockwave() {
  const slots = pickRingSlots(Math.min(RING_COUNT, 180));
  for (let k = 0; k < slots.length; k++) {
    const i = slots[k];
    const theta = (k / slots.length) * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI * 0.6; // some vertical spread
    const r = 0.4 + Math.random() * 0.3;
    const cphi = Math.cos(phi);
    ringPos[i*3+0] = Math.cos(theta) * cphi * r;
    ringPos[i*3+1] = Math.sin(phi) * r;
    ringPos[i*3+2] = Math.sin(theta) * cphi * r;
    const speed = 3.2 + Math.random() * 1.4;
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

function enterAbout() {
  if (mode === 'about') return;
  mode = 'about';
  document.body.classList.add('mode-about');
  aboutView.classList.add('active');
  aboutView.setAttribute('aria-hidden', 'false');
  aboutScroll.scrollTop = 0;
  updateAboutScroll();

  // Impact flash — restart the CSS animation by toggling the class with a reflow.
  if (flashEl) {
    flashEl.classList.remove('firing');
    void flashEl.offsetWidth; // force reflow so the animation restarts
    flashEl.classList.add('firing');
  }
  // 360° shockwave of coloured particles, fired slightly delayed so it lands
  // just as the about view snaps to focus (≈350ms in).
  setTimeout(emitShockwave, 320);
}
function exitAbout() {
  if (mode === 'hero') return;
  mode = 'hero';
  document.body.classList.remove('mode-about');
  aboutView.classList.remove('active');
  aboutView.setAttribute('aria-hidden', 'true');
}
aboutClose?.addEventListener('click', exitAbout);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitAbout(); });

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
  // For now, clicking ANY ring opens the About view (only WHO I AM's
  // content is built). When you finish ring 1 / ring 2, branch on
  // `rings.findIndex(r => r.mesh === hits[0].object)`.
  enterAbout();
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
    tickRingParticles(dt);
    // gentle camera orbit so the portrait + flame feel "alive"
    aboutCam.position.x = Math.sin(t * 0.18) * 0.4;
    aboutCam.position.y = Math.cos(t * 0.14) * 0.25;
    aboutCam.lookAt(0, 0, 0);
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
