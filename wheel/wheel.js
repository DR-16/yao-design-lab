/* ═══════════════════════════════════════════════════════════════
   转盘 · 逻辑
   要改的东西基本都在这个文件最上面这一段。
   ═══════════════════════════════════════════════════════════════ */

/* ── 六份礼物 ──────────────────────────────────────────────
   顺序 = 从 12 点方向开始，顺时针。
   brand : 揭晓时显示在礼物名上面的小字，没有品牌就留空 ''。
   name  : 礼物名。转停之前不会出现在转盘上。
   copy  : 礼物名下面那句话。默认不写 —— 东西就是东西，不用配文案。
           只有「信」用了它，因为得告诉她来找你拿。不写就整行不出现。
   color : 转盘上这一格的底色。填了 face 之后它是兜底 —— 照片没加载出来时才露脸。
   face  : 铺在转盘这一格上的她的照片。
   focus : 照片里要对准扇形重心的那一点，[横, 竖]，都是 0~1 的比例。
           照片已经预先裁成对准脸的方形了，所以基本都是 [0.5, 0.5] 附近。
   zoom  : 照片放大倍数，默认 1.05。想让脸更满就调大。
   photo : 揭晓时显示的实物图。没有实物图的两格用 svg / glyph 代替。
   svg   : 没有照片时画的图形，画在这一格颜色的卡片上。
   glyph : 没有照片也没有图形时，退回到写一个字。
   ────────────────────────────────────────────────────────── */
const SEGMENTS = [
  {
    brand: 'Dior',
    name:  'Addict Lip Glow',
    color: '#E0728B',
    face:  'img/her/1.jpg',    // 餐厅
    focus: [0.50, 0.50],
    photo: 'img/dior-lip-glow.jpg',
  },
  {
    brand: 'YSL',
    name:  'Loveshine',
    color: '#D9A441',
    face:  'img/her/5.jpg',    // 暖光自拍
    focus: [0.50, 0.50],
    photo: 'img/ysl-loveshine.png',
  },
  {
    brand: 'Jo Malone London',
    name:  '30 mL 香水',
    color: '#EBE3D5',
    face:  'img/her/3.jpg',    // 湖边
    focus: [0.50, 0.50],
    photo: 'img/jo-malone.png',
  },
  {
    brand: '',
    name:  'Jellycat',
    color: '#B98A62',
    face:  'img/her/4.jpg',    // 草地
    focus: [0.50, 0.50],
    photo: 'img/jellycat.jpg',
  },
  {
    brand: '',
    name:  '信',
    // 这张车里自拍的脸偏左，所以放在转盘左半边的格子上 ——
    // 照片和礼物的对应关系本来就不给人看，哪张放哪格可以纯按取景挑
    face:  'img/her/2.jpg',    // 车里自拍
    focus: [0.30, 0.50],
    copy:  '联系我领取',
    color: '#7E9BB8',          // 信纸的雾蓝
    photo: null,
    // 卡片上画个信封 —— 不能再写一个「信」字，会跟旁边的礼物名撞
    svg: '<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="3.2" ' +
         'stroke-linecap="round" stroke-linejoin="round">' +
         '<rect x="9" y="17" width="46" height="31" rx="4"/>' +
         '<path d="M9.5 20.5 L32 37 L54.5 20.5"/></svg>',
  },
  {
    brand: '',
    name:  '520 红包',
    color: '#CE3A32',
    face:  'img/her/6.jpg',    // 生日那顿饭
    focus: [0.50, 0.50],
    photo: null,
    glyph: '福',
  },
];

/* ── 抽中的概率 ──────────────────────────────────────────────
   六格在转盘上还是均分的，只是被抽中的机会不一样 —— 看不出来。
   下面是相对权重，代码会按总和归一化，不用凑成 100。

     520 红包        6.7%
     其余五格   各   18.7%

   六格等概率的话每格是 16.7%，红包让出 10 个百分点，平均分给了其余五格。
   想改回等概率，把这里全设成一样的数（或者整段删掉）就行。
   ────────────────────────────────────────────────────────── */
const WEIGHTS = {
  '520 红包': 6.6667,
  default:    18.6667,
};

/* 照片放大倍数的默认值。扇形是窄三角，1.0 会显得人很小很远，
   稍微推近一点脸才占得住这一格。 */
const DEFAULT_ZOOM = 1.05;

/* 至少转几圈再停（数字越大转越久，转的时长在 styles.css 的 --spin-duration） */
const MIN_TURNS = 5;

/* 音乐的音量（0~1）和淡入时长（毫秒）。别设成 1 —— 突然满音量会吓到人。 */
const MUSIC_VOLUME = 0.55;
const MUSIC_FADE_MS = 1600;


/* ═══════════════════════════════════════════════════════════════
   下面一般不用动
   ═══════════════════════════════════════════════════════════════ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200, R = 190;
const COUNT = SEGMENTS.length;
const STEP = 360 / COUNT;          // 六等分 = 每格 60°

const wheel     = document.getElementById('wheel');
const wrap      = document.querySelector('.wheel-wrap');
const spinBtn   = document.getElementById('spin');
const hubLabel  = document.getElementById('hub-label');
const result     = document.getElementById('result');
const resultPhoto= document.getElementById('result-photo');
const resultBrand= document.getElementById('result-brand');
const resultVal  = document.getElementById('result-value');
const resultCopy = document.getElementById('result-copy');
const bgm       = document.getElementById('bgm');
const soundBtn  = document.getElementById('sound');

let rotation = 0;      // 累计角度，只增不减
let spinning = false;

/* 角度换算：0° = 12 点方向，顺时针为正 */
function pointAt(deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
}

/* 画出六个扇形 */
function buildWheel() {
  const defs = document.createElementNS(SVG_NS, 'defs');
  wheel.appendChild(defs);

  SEGMENTS.forEach((seg, i) => {
    const [x1, y1] = pointAt(i * STEP);
    const [x2, y2] = pointAt((i + 1) * STEP);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
                           `A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`);
    path.setAttribute('fill', seg.color);
    path.setAttribute('class', 'seg');
    path.dataset.index = i;
    wheel.appendChild(path);

    // 底色先画上，照片加载完再盖上去。图挂了就停在底色，不会开天窗。
    if (seg.face) fillWithFace(path, seg, i, defs);
  });
}

/* 先把实物图下载好，揭晓那一下才不会先空一块再跳出来 */
function preloadPhotos() {
  SEGMENTS.forEach(seg => { if (seg.photo) new Image().src = seg.photo; });
}

/* 扇形的重心 —— 不是外接矩形的中心。
   扇形是个窄三角，肉最厚的地方在从圆心往外约 2/3 半径处，
   脸要对到这里才不会被切在尖角上。 */
function sectorCentroid(i) {
  const half = (STEP / 2) * Math.PI / 180;
  const d = (2 / 3) * R * Math.sin(half) / half;
  const bisect = (i * STEP + STEP / 2 - 90) * Math.PI / 180;
  return [CX + d * Math.cos(bisect), CY + d * Math.sin(bisect)];
}

function fillWithFace(path, seg, i, defs) {
  const box = path.getBBox();
  const [tx, ty] = sectorCentroid(i);

  const im = new Image();
  im.onload = () => {
    // 先把照片放大到至少盖住外接矩形，再按 zoom 多推近一点
    const cover = Math.max(box.width / im.naturalWidth, box.height / im.naturalHeight);
    const scale = cover * (seg.zoom || DEFAULT_ZOOM);
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;

    // 把 focus 那一点挪到扇形重心上
    const [fx, fy] = seg.focus || [0.5, 0.5];
    // 再夹回来，保证照片始终盖满外接矩形，不会在边上漏出底色
    const x = clamp(tx - w * fx, box.x + box.width - w, box.x);
    const y = clamp(ty - h * fy, box.y + box.height - h, box.y);

    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', `seg-face-${i}`);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('x', box.x);
    pattern.setAttribute('y', box.y);
    pattern.setAttribute('width', box.width);
    pattern.setAttribute('height', box.height);

    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('href', seg.face);
    img.setAttribute('x', x - box.x);      // pattern 内部坐标以 tile 左上角为原点
    img.setAttribute('y', y - box.y);
    img.setAttribute('width', w);
    img.setAttribute('height', h);

    pattern.appendChild(img);
    defs.appendChild(pattern);
    path.setAttribute('fill', `url(#seg-face-${i})`);
  };
  im.src = seg.face;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ── 音乐 ──────────────────────────────────────────────────
   默认是开的：按钮一进来就显示「开」，只有她手动点才变关。

   但浏览器一律禁止带声音的自动播放，必须先有一次用户交互。
   所以「开」是**意愿**，不是「此刻正在响」—— 页面上第一次任何
   点击/触摸都会把音乐接上，不用她专门去点哪个按钮。
   ────────────────────────────────────────────────────────── */
let wantsMusic = true;    // 她想不想听 —— 按钮显示的是这个，不是 bgm.paused
let fadeTimer = null;

function fadeTo(target, ms) {
  clearInterval(fadeTimer);
  const from = bgm.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    bgm.volume = from + (target - from) * k;
    if (k === 1) {
      clearInterval(fadeTimer);
      if (target === 0) bgm.pause();
    }
  }, 40);
}

/* 按钮永远只反映 wantsMusic */
function syncSoundButton() {
  soundBtn.classList.toggle('is-on', wantsMusic);
  soundBtn.setAttribute('aria-pressed', String(wantsMusic));
}

function playMusic() {
  if (!bgm.paused) return;
  bgm.volume = 0;
  // play() 返回 Promise，被浏览器拦下时会 reject —— 不能让它变成未捕获异常。
  // 拦下了也不改按钮：她的意愿还是「开」，下一次交互会把它接上。
  const p = bgm.play();
  if (p) p.then(() => {
    // play() 是异步的，回执到达时她可能已经把音乐关掉了 ——
    // 比如她进来第一下点的就是右上角的静音按钮：pointerdown 先起播，
    // click 再关掉，然后这个回执才到。不重新确认一次就会把她的关掉覆盖掉。
    if (!wantsMusic) { hardStop(); return; }
    fadeTo(MUSIC_VOLUME, MUSIC_FADE_MS);
  }).catch(() => {});
}

function hardStop() {
  clearInterval(fadeTimer);
  bgm.pause();
  bgm.volume = 0;
}

function stopMusic() { fadeTo(0, 400); }

/* 想听就接上。页面上第一次点击/触摸会调它，之后每次转也会调（幂等）。 */
function startMusicIfWanted() {
  if (wantsMusic) playMusic();
}

soundBtn.addEventListener('click', () => {
  wantsMusic = !wantsMusic;
  syncSoundButton();
  if (wantsMusic) playMusic(); else stopMusic();
});

syncSoundButton();
playMusic();   // 先试一次；多半会被浏览器拦掉，那就等她的第一次交互

/* 第一次交互就接上音乐 —— 不限于「开始」按钮，页面上碰哪儿都算。
   注意：如果她第一下点的就是右上角那个按钮，这里会先起播、
   紧接着 click 把 wantsMusic 翻成 false 再停掉，最终还是关 —— 正是她要的。 */
['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
  window.addEventListener(ev, startMusicIfWanted, { once: true, passive: true }));

/* 按权重抽一格 */
function weightOf(seg) {
  return WEIGHTS[seg.name] !== undefined ? WEIGHTS[seg.name] : WEIGHTS.default;
}

function pickWinner() {
  const w = SEGMENTS.map(weightOf);
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return i;
  }
  return w.length - 1;   // 浮点误差的兜底，正常走不到
}

/* 从 CSS 里读转动时长，保证 JS 和 CSS 不会各说各话 */
function spinDurationMs() {
  const raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--spin-duration').trim();
  return raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000;
}

function spin() {
  if (spinning) return;
  spinning = true;
  startMusicIfWanted();   // 这一下点击就是浏览器要的那次交互

  // 复位上一轮的结果
  spinBtn.disabled = true;
  wrap.classList.add('is-running');
  wheel.classList.remove('is-settled');
  wheel.querySelectorAll('.seg').forEach(p => p.classList.remove('is-won'));
  result.classList.remove('is-visible');

  const winner = pickWinner();

  // 让这一格的中心正好停在 12 点的指针下
  const centerAt = (360 - (winner * STEP + STEP / 2)) % 360;
  const delta = ((centerAt - (rotation % 360)) + 360) % 360;
  // 不要每次都停在格子正中央，左右随机偏一点，看着更像真的
  const jitter = (Math.random() * 2 - 1) * (STEP / 2 - 10);

  rotation += delta + 360 * (MIN_TURNS + Math.floor(Math.random() * 3)) + jitter;

  wheel.classList.add('is-spinning');
  // 强制浏览器认下当前值，否则连点两次时新的 transform 不会走过渡
  void wheel.getBoundingClientRect();
  wheel.style.transform = `rotate(${rotation}deg)`;

  setTimeout(() => settle(winner), spinDurationMs() + 80);
}

/* 揭晓那一格的图：有实物图就放图，没有的就用这一格的颜色配个图形或一个字 */
function showPhoto(seg) {
  resultPhoto.textContent = '';
  if (seg.photo) {
    resultPhoto.className = 'result-photo';
    resultPhoto.style.background = '';
    const img = document.createElement('img');
    img.src = seg.photo;
    img.alt = seg.name;
    resultPhoto.appendChild(img);
    return;
  }
  resultPhoto.className = 'result-photo is-drawn';
  resultPhoto.style.background = seg.color;
  if (seg.svg) resultPhoto.innerHTML = seg.svg;   // 只来自上面的配置，不是外部输入
  else resultPhoto.textContent = seg.glyph || '';
}

function settle(winner) {
  spinning = false;
  wrap.classList.remove('is-running');
  wheel.classList.add('is-settled');
  wheel.querySelector(`.seg[data-index="${winner}"]`).classList.add('is-won');

  const seg = SEGMENTS[winner];
  showPhoto(seg);
  resultBrand.textContent = seg.brand || '';
  resultVal.textContent = seg.name;
  resultCopy.textContent = seg.copy || '';
  result.classList.add('is-visible');

  hubLabel.textContent = '转';
  spinBtn.disabled = false;
}

buildWheel();
preloadPhotos();
spinBtn.addEventListener('click', spin);
