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

// --- Chrome enclosure ---
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0x2a2a36,
  metalness: 1.0,
  roughness: 0.18,
  side: THREE.BackSide,
});
const chromeTube = new THREE.Mesh(
  new THREE.CylinderGeometry(9, 9, 80, 48, 1, true),
  chromeMat
);
chromeTube.rotation.x = Math.PI / 2; // lay along z so its axis matches the camera's forward
chromeTube.position.set(0, 0, -10);
aboutScene.add(chromeTube);

// --- Base illumination — gives the chrome shape even when no colour
//     line is currently active. Two opposed warm/cool sources. ---
const tubeBaseLightWarm = new THREE.PointLight(0xc8c0d8, 0.85, 60, 1.4);
tubeBaseLightWarm.position.set(0, 5, 6);
aboutScene.add(tubeBaseLightWarm);
const tubeBaseLightCool = new THREE.PointLight(0x6580b0, 0.55, 70, 1.4);
tubeBaseLightCool.position.set(-4, -3, -12);
aboutScene.add(tubeBaseLightCool);

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
        // Random angle around the tube axis, offset from centre, random z.
        const angle  = Math.random() * Math.PI * 2;
        const radius = 2.8 + Math.random() * 4.6;
        ln.mesh.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          -10 + (Math.random() * 70 - 35)
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

// ===== PER-PANEL PARTICLE PORTRAITS =====
// 6 images (one per sceneA panel). Each is sampled into ~6000 coloured
// particles arranged in the image's shape and tinted with its original RGB.
// They sit behind the text panel and in front of the flame, half-transparent
// so the flame still shows through.
const PANEL_IMAGES = [
  'img/p1.jpg', // panel 1
  'img/p2.jpg', // panel 2
  'img/p3.jpg', // panel 3
  'img/p4.jpg', // panel 4
  'img/p5.jpg', // panel 5
  'img/p6.jpg', // panel 6
];
const panelClouds = new Array(6).fill(null);
const PANEL_CLOUD_TARGET_OP = new Array(6).fill(0); // tween target per cloud
const PANEL_CLOUD_OP = new Array(6).fill(0);        // current displayed opacity

function loadImageParticles(url, idx) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // larger sample canvas + every-pixel sampling → super dense point cloud.
    // Tens of thousands of tiny coloured points where the photo reads from
    // sheer density, with a soft noisy edge mask so the cloud doesn't end
    // in a hard rectangle.
    const MAX_W = 360;
    const w = MAX_W;
    const h = Math.round(MAX_W * img.height / img.width);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const positions = [], colors = [];
    const STEP = 1; // every pixel → ~130k particles per image at 360 × ~480
    // smaller image footprint so it doesn't dominate the screen
    const worldW = 2.4;
    const worldH = worldW * h / w;
    for (let py = 0; py < h; py += STEP) {
      for (let px = 0; px < w; px += STEP) {
        const i = (py * w + px) * 4;
        const r = data[i]   / 255;
        const g = data[i+1] / 255;
        const b = data[i+2] / 255;
        const a = data[i+3] / 255;
        if (a < 0.05) continue;

        // === SOFT IRREGULAR EDGE MASK ===
        // distance from centre (0 at centre, ~0.71 at corners)
        const cx = px / w - 0.5;
        const cy = py / h - 0.5;
        const dist = Math.sqrt(cx * cx + cy * cy);
        // start fading from 0.32 outward, fully gone past 0.46. Multiply with
        // per-pixel noise so the edge breaks up into a jagged, organic shape.
        const fade = 1 - Math.max(0, (dist - 0.32) / 0.14);
        const noise = 0.65 + Math.random() * 0.7;
        if (fade * noise < 0.5) continue;

        const x = cx * worldW;
        const y = -cy * worldH;
        positions.push(x, y, 0);
        // soften pure black so the cloud doesn't disappear against the background
        colors.push(Math.max(0.08, r), Math.max(0.08, g), Math.max(0.08, b));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 color;
        varying vec3 vColor;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 0.55 * (60.0 / max(-mv.z, 0.3));
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
          // brighter colour + higher alpha so the photo is clearly identifiable
          gl_FragColor = vec4(vColor * 1.55, a * 0.88);
        }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.set(0, 0, 1.8); // behind text panel (in front of flame)
    aboutScene.add(pts);
    panelClouds[idx] = pts;
    console.log('[panelCloud]', idx, url, 'particles:', positions.length / 3);
  };
  img.onerror = () => { console.warn('[panelCloud] failed to load', url); };
  img.src = url;
}

PANEL_IMAGES.forEach((url, idx) => { if (url) loadImageParticles(url, idx); });

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
    emitRing(__scrollDir);
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

  // Position each image cloud on a DNA helix in the RIGHT half of the viewport,
  // mirroring the text staircase on the left. Same rotor angle / vertical
  // sweep as the text helix, but offset along +X so the photo sits to the
  // right of the text panel that corresponds to the focused step.
  const IMG_HELIX_RADIUS = 0.9;
  const IMG_PANEL_Y_GAP  = 0.4;
  const IMG_GROUP_X      = 2.4; // world-units offset → right half of screen
  const rotorTyUnits     = (IMG_PANEL_Y_GAP * 2.5) - effA * (IMG_PANEL_Y_GAP * 5);
  for (let i = 0; i < panelClouds.length; i++) {
    const pts = panelClouds[i];
    if (!pts) continue;
    const stepRyRad = (i * 60) * Math.PI / 180;
    const baseX = IMG_HELIX_RADIUS * Math.sin(stepRyRad);
    const baseZ = IMG_HELIX_RADIUS * Math.cos(stepRyRad);
    const stepY = (i - 2.5) * IMG_PANEL_Y_GAP; // panel 1 lowest, panel 6 highest
    const x = baseX * cosR + baseZ * sinR;
    const z = -baseX * sinR + baseZ * cosR;
    pts.position.set(x + IMG_GROUP_X, stepY + rotorTyUnits, z);
  }
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
  if (curProgress < SCENE_A_END) {
    // 6 sceneA panels at local progress k/5 for k=0..5
    const local = curProgress / SCENE_A_END;
    const k = Math.max(0, Math.min(5, Math.round(local * 5)));
    return (k / 5) * SCENE_A_END;
  }
  if (curProgress < PORTAL_END) {
    // user is paused in the portal phase — pull them through to scene B's first
    // panel, or back to scene A's last, whichever is closer
    const midPortal = (SCENE_A_END + PORTAL_END) / 2;
    return curProgress < midPortal ? SCENE_A_END : PORTAL_END;
  }
  // 4 corridor panels at progressB = (300+500k)/1800
  const localB = (curProgress - PORTAL_END) / (1 - PORTAL_END);
  const k = Math.max(0, Math.min(3, Math.round((localB * 1800 - 300) / 500)));
  const localTarget = (300 + 500 * k) / 1800;
  return PORTAL_END + localTarget * (1 - PORTAL_END);
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
  const arr = [];
  for (let k = 0; k < 6; k++) arr.push((k / 5) * SCENE_A_END);
  for (let k = 0; k < 4; k++) {
    const localTarget = (300 + 500 * k) / 1800;
    arr.push(PORTAL_END + localTarget * (1 - PORTAL_END));
  }
  return arr;
}

// Lock model: only TWO conditions can block a step.
//   1) An animation is currently playing  (now < __scrollLockUntil)
//   2) The wheel stream hasn't paused long enough  (gap < QUIET_MS)
// Crucially the lock NEVER auto-extends. The moment the user stops scrolling,
// they can immediately start the next step — no "infinite chain locks".
let __scrollLockUntil = 0;
let __lastWheelAt = 0;
const QUIET_MS = 180; // user must pause this long between flicks

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
  const nextIdx = Math.max(0, Math.min(stops.length - 1, curIdx + dir));
  if (nextIdx === curIdx) return;
  const crossing = (curIdx === 5 && nextIdx === 6) || (curIdx === 6 && nextIdx === 5);
  const duration = crossing ? 1500 : 500;
  smoothScrollAbout(stops[nextIdx] * max, duration);
  __scrollLockUntil = performance.now() + duration;
}

function onAboutWheel(e) {
  e.preventDefault();
  const now = performance.now();
  const gap = now - __lastWheelAt;
  __lastWheelAt = now;
  if (now < __scrollLockUntil) return;  // animation in progress
  if (gap < QUIET_MS) return;           // still in last flick's momentum tail
  doStep(e.deltaY > 0 ? 1 : -1);
}
aboutScroll?.addEventListener('wheel', onAboutWheel, { passive: false });

// Touch swipe → same lock model. Each touchstart resets the timestamp gate,
// so each new finger-down can immediately count as a fresh user intent.
let __touchStartY = null;
aboutScroll?.addEventListener('touchstart', (e) => {
  __touchStartY = e.touches[0]?.clientY ?? null;
  __lastWheelAt = 0; // a new touch counts as a fresh gesture, bypass quiet check
}, { passive: true });
aboutScroll?.addEventListener('touchmove', (e) => {
  const now = performance.now();
  if (now < __scrollLockUntil || __touchStartY == null) { e.preventDefault(); return; }
  const dy = __touchStartY - (e.touches[0]?.clientY ?? __touchStartY);
  if (Math.abs(dy) < 30) return;
  e.preventDefault();
  __touchStartY = null;
  doStep(dy > 0 ? 1 : -1);
}, { passive: false });

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

function enterAbout(startSceneIdx /* 0 = scene A, 1 = scene B */) {
  if (mode === 'about') return;
  mode = 'about';

  const ringIdx = startSceneIdx === 1 ? 1 : 0;

  // Step 1: hero camera physically rams into the clicked ring.
  // Step 2 (mid-push): hero shell starts fading + about-view enters.
  // Step 3 (push end): about-view fully active, scroll state initialised.
  playCameraPushToRing(ringIdx, 650, () => {
    // unfreeze hero camera so it can resume parallax if the user ever exits about
    setTimeout(() => { __heroTransiting = false; }, 600);
  });

  // half-way through the push, start crossfading the world to the about view
  setTimeout(() => {
    document.body.classList.add('mode-about');
  }, 200);
  setTimeout(() => {
    aboutView.classList.add('active');
    aboutView.setAttribute('aria-hidden', 'false');
    if (startSceneIdx === 1) {
      aboutScroll.scrollTop = 0;
      requestAnimationFrame(() => {
        const max = Math.max(1, aboutScroll.scrollHeight - aboutScroll.clientHeight);
        aboutScroll.scrollTop = max * (SCENE_A_END - 0.02);
        updateAboutScroll();
        setTimeout(() => {
          smoothScrollAbout(max * (PORTAL_END + 0.05), 1500);
        }, 650);
      });
    } else {
      aboutScroll.scrollTop = 0;
      updateAboutScroll();
    }
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
  // ring 0 (top, WHO I AM) → about scene A; ring 1 (middle, WHY THIS LAB
  // EXISTS) → about scene B (jumps directly to panel 7). ring 2 falls back
  // to scene A for now (scene C not built).
  const idx = rings.findIndex(r => r.mesh === hits[0].object);
  enterAbout(idx === 1 ? 1 : 0);
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

    // Direction Z (v2): cycle the random neon light lines — spawn, fade
    // in, hold, fade out, return to idle. The PBR chrome tube picks up
    // each active line's colour as a natural metallic reflection.
    tickLightLines(t, dt);

    // Ease each panel image cloud's opacity toward its target so swaps are smooth
    for (let i = 0; i < panelClouds.length; i++) {
      const pc = panelClouds[i];
      if (!pc) continue;
      PANEL_CLOUD_OP[i] += (PANEL_CLOUD_TARGET_OP[i] - PANEL_CLOUD_OP[i]) * 0.12;
      pc.material.uniforms.uOpacity.value = PANEL_CLOUD_OP[i];
    }

    // Camera behaviour by phase:
    //   Scene A:      gentle floating orbit (no userData.target)
    //   Portal phase: smoothly chase the precomputed target position/look —
    //                 real physical movement: rises along Y, pushes through on Z
    //   Scene B:      settle into the narrative pose
    const tg = aboutCam.userData.target;
    if (tg) {
      aboutCam.position.x += (tg.x - aboutCam.position.x) * 0.12;
      aboutCam.position.y += (tg.y - aboutCam.position.y) * 0.12;
      aboutCam.position.z += (tg.z - aboutCam.position.z) * 0.12;
      aboutCam.lookAt(tg.look.x, tg.look.y, tg.look.z);
    } else if (aboutCam.userData.sceneBSettle) {
      // Settled on the far side of the tunnel. We DON'T snap back to z=9;
      // we keep the camera where the punch-through left it, so the new space
      // feels physically distinct from the old one.
      aboutCam.position.x += (0 - aboutCam.position.x) * 0.08;
      aboutCam.position.y += (0 - aboutCam.position.y) * 0.08;
      aboutCam.position.z += (-19 - aboutCam.position.z) * 0.08;
      aboutCam.lookAt(0, 0, -24);
    } else {
      aboutCam.position.x = Math.sin(t * 0.18) * 0.4;
      aboutCam.position.y = Math.cos(t * 0.14) * 0.25;
      aboutCam.position.z = 9;
      aboutCam.lookAt(0, 0, 0);
    }

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
