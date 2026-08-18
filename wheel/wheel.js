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
   color : 转盘上这一格的颜色，各自呼应这件礼物的调性。
   photo : 揭晓时显示的实物图。没有实物图的两格用 svg / glyph 代替。
   svg   : 没有照片时画的图形，画在这一格颜色的卡片上。
   glyph : 没有照片也没有图形时，退回到写一个字。
   ────────────────────────────────────────────────────────── */
const SEGMENTS = [
  {
    brand: 'Dior',
    name:  'Addict Lip Glow',
    color: '#E0728B',          // 唇膏的玫瑰粉
    photo: 'img/dior-lip-glow.jpg',
  },
  {
    brand: 'YSL',
    name:  'Loveshine',
    color: '#D9A441',          // 圣罗兰的金
    photo: 'img/ysl-loveshine.png',
  },
  {
    brand: 'Jo Malone London',
    name:  '30 mL 香水',
    color: '#EBE3D5',          // 祖玛珑的象牙白
    photo: 'img/jo-malone.png',
  },
  {
    brand: '',
    name:  'Jellycat',
    color: '#B98A62',          // 玩偶的焦糖棕
    photo: 'img/jellycat.jpg',
  },
  {
    brand: '',
    name:  '信',
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
    color: '#CE3A32',          // 红包的正红
    photo: null,
    glyph: '福',
  },
];

/* 实物图放在哪 ——
   false（默认）：转盘上只有颜色，照片只在转停揭晓时出现，六份礼物在转之前是保密的。
   true：把照片直接铺进对应的扇形。转盘会好看，但转之前就能看到六份礼物分别是什么。
   想换成后者，把这里改成 true 就行，别的都不用动。 */
const SHOW_PHOTOS_ON_WHEEL = false;

/* 至少转几圈再停（数字越大转越久，转的时长在 styles.css 的 --spin-duration） */
const MIN_TURNS = 5;


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

    // 开了 SHOW_PHOTOS_ON_WHEEL 才把照片铺进扇形，
    // 铺不上的（没照片的两格）仍然是纯色
    if (SHOW_PHOTOS_ON_WHEEL && seg.photo) fillWithImage(path, seg.photo, i, defs);
  });
}

/* 先把实物图下载好，揭晓那一下才不会先空一块再跳出来 */
function preloadPhotos() {
  SEGMENTS.forEach(seg => { if (seg.photo) new Image().src = seg.photo; });
}

function fillWithImage(path, src, i, defs) {
  const box = path.getBBox();

  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', `seg-img-${i}`);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('x', box.x);
  pattern.setAttribute('y', box.y);
  pattern.setAttribute('width', box.width);
  pattern.setAttribute('height', box.height);

  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('href', src);
  img.setAttribute('x', 0);
  img.setAttribute('y', 0);
  img.setAttribute('width', box.width);
  img.setAttribute('height', box.height);
  img.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  pattern.appendChild(img);
  defs.appendChild(pattern);
  path.setAttribute('fill', `url(#seg-img-${i})`);
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

  // 复位上一轮的结果
  spinBtn.disabled = true;
  wrap.classList.add('is-running');
  wheel.classList.remove('is-settled');
  wheel.querySelectorAll('.seg').forEach(p => p.classList.remove('is-won'));
  result.classList.remove('is-visible');

  const winner = Math.floor(Math.random() * COUNT);

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

  hubLabel.textContent = '再转';
  spinBtn.disabled = false;
}

buildWheel();
preloadPhotos();
spinBtn.addEventListener('click', spin);
