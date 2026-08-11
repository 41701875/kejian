/**
 * 导航站构建脚本（零依赖，仅用 Node 内置模块）
 *
 * 生成风格借鉴「星辰导航」：毛玻璃导航 + 暗/亮主题切换 + 标签切换面板
 * （点导航 → 整块内容切换，不再下拉、不再长页滚动）+ 统一卡片（图标块+标题+说明+域名/箭头）。
 *
 * 功能：
 *  1. 读取 data/nav.json（站点信息 + 栏目/分组/链接配置）
 *  2. 自动扫描 courseware/<slug>/ 下每个课件文件夹（meta.json）
 *  3. 把每个课件原样复制到 public/<slug>/
 *  4. 复制 assets/icons/ 图标资源
 *  5. 生成 public/index.html
 *
 * Cloudflare Pages 配置：构建命令 node build.js / 输出目录 public / 根目录留空
 *
 * 数据模型（data/nav.json）：见 README。
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'courseware');
const OUT = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const ICON_DIR = path.join(ROOT, 'assets', 'icons');

// ===== 工具函数 =====
function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function loadMeta(slug) {
  const metaPath = path.join(SRC, slug, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      console.warn('⚠️ ' + slug + '/meta.json 解析失败，使用默认信息');
    }
  }
  return {};
}
function isImg(ic) {
  return /^(https?:|\/|data:)/i.test(String(ic || '').trim());
}
// 图标块内容：图片→<img>，否则 emoji
function iconInner(icon, fallback) {
  const ic = String(icon || '').trim();
  if (isImg(ic)) return '<img class="ic-img" src="' + esc(ic) + '" alt="">';
  return esc(ic || fallback);
}

// ===== 1. 清理并重建输出目录 =====
// 说明：生产环境（Cloudflare Pages）无此限制，rmrf 会正常清空 public。
// 本地若被安全删除机制拦截，则跳过清空（仅覆盖生成文件），不影响结果。
try {
  rmrf(OUT);
} catch (e) {
  console.warn('⚠️ 本地清理 public 被拦截（可忽略，仅影响本地预览）：' + e.message);
}
fs.mkdirSync(OUT, { recursive: true });

// ===== 2. 读取导航配置 =====
const DEFAULT_NAV = {
  site: { title: '我的导航站', subtitle: '', footer: '' },
  categories: [{ title: '课件', icon: '📚', courseware: true }]
};
let nav = DEFAULT_NAV;
const navPath = path.join(DATA_DIR, 'nav.json');
if (fs.existsSync(navPath)) {
  try {
    nav = JSON.parse(fs.readFileSync(navPath, 'utf8'));
  } catch (e) {
    console.warn('⚠️ data/nav.json 解析失败，使用默认配置：' + e.message);
  }
}
if (!nav.categories) nav.categories = [];
const site = Object.assign({ title: '我的导航站', subtitle: '', footer: '', brandIcon: '✦' }, nav.site || {});

// ===== 3. 收集课件 =====
const slugs = fs.existsSync(SRC)
  ? fs
      .readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)
  : [];

const coursewareItems = slugs
  .map((slug) => {
    const meta = loadMeta(slug);
    return { slug, title: meta.title || slug, desc: meta.desc || '', cover: meta.cover || '', internal: true };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

for (const slug of slugs) copyDir(path.join(SRC, slug), path.join(OUT, slug));

const iconFiles = fs.existsSync(ICON_DIR)
  ? fs.readdirSync(ICON_DIR).filter((f) => f.toLowerCase().endsWith('.svg'))
  : [];
if (iconFiles.length) copyDir(ICON_DIR, path.join(OUT, 'assets', 'icons'));
function pickIcon(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return iconFiles[h % iconFiles.length];
}

// ===== 4. 把各栏目展开成「条目」列表，供首页快捷入口使用 =====
function itemsOf(cat) {
  if (cat.courseware) {
    return coursewareItems.map((it) => {
      const icon = it.cover ? './' + it.slug + '/' + it.cover : './assets/icons/' + pickIcon(it.slug);
      return { title: it.title, url: './' + it.slug + '/', icon, desc: it.desc, internal: true, group: '' };
    });
  }
  if (Array.isArray(cat.groups)) {
    return cat.groups.flatMap((g) =>
      (g.links || []).map((l) => Object.assign({ group: g.title }, l))
    );
  }
  return (cat.links || []).map((l) => Object.assign({ group: '' }, l));
}
const allItems = nav.categories.flatMap(itemsOf);

// ===== 5. 生成片段 =====
function urlLabel(item) {
  if (item.internal) return '课件';
  return String(item.url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '') || item.url || '';
}
function renderCard(item, idx) {
  const attrs = item.internal ? '' : ' target="_blank" rel="noopener"';
  const groupAttr = item.group ? ' data-group="' + esc(item.group) + '"' : '';
  return (
    '<a class="card" href="' + esc(item.url || '#') + '"' + attrs + groupAttr + '>' +
    '<div class="card-top"><div class="icon-box">' + iconInner(item.icon, '🔗') + '</div>' +
    '<div class="title">' + esc(item.title) + '</div></div>' +
    (item.desc ? '<div class="desc">' + esc(item.desc) + '</div>' : '') +
    '<div class="card-footer"><span class="url-label">' + esc(urlLabel(item)) + '</span>' +
    '<span class="arrow">→</span></div></a>'
  );
}
function renderQuick(item) {
  const attrs = item.internal ? '' : ' target="_blank" rel="noopener"';
  return (
    '<a class="quick-card" href="' + esc(item.url || '#') + '"' + attrs + '>' +
    '<div class="qc-icon">' + iconInner(item.icon, '🔗') + '</div>' +
    '<div class="qc-title">' + esc(item.title) + '</div>' +
    (item.desc ? '<div class="qc-desc">' + esc(item.desc) + '</div>' : '') +
    '</a>'
  );
}

// 首页面板
const homePanel =
  '<section class="panel active" id="home">' +
  '<div class="hero">' +
  '<h1>' + esc(site.title) + '</h1>' +
  (site.subtitle ? '<p>' + esc(site.subtitle) + '</p>' : '') +
  '<div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
  '<input type="text" placeholder="搜索任意资源…" id="globalSearch" aria-label="搜索"></div>' +
  '</div>' +
  '<div class="page-header"><h2>📌 常用快捷入口</h2><p>共 ' + allItems.length + ' 个资源，一站直达</p></div>' +
  '<div class="quick-grid">' + allItems.map(renderQuick).join('') + '</div>' +
  '</section>';

// 各栏目面板
const panelsHtml = nav.categories
  .map((cat, i) => {
    const id = 'cat' + i;
    const items = itemsOf(cat);
    const head =
      '<div class="page-header"><h2>' + iconSpan(cat.icon || '📁') + ' ' + esc(cat.title) + '</h2>' +
      '<p>' + (cat.desc ? esc(cat.desc) : '共 ' + items.length + ' 个资源') + '</p></div>';

    let body;
    if (Array.isArray(cat.groups) && cat.groups.length) {
      const tags =
        '<div class="cat-tags">' +
        '<button class="cat-tag active" data-group="all">全部</button>' +
        cat.groups.map((g) => '<button class="cat-tag" data-group="' + esc(g.title) + '">' + esc(g.title) + '</button>').join('') +
        '</div>';
      const cards = items.map(renderCard).join('');
      body = tags + '<div class="card-grid">' + (cards || '<div class="empty">该栏目暂无内容。</div>') + '</div>';
    } else {
      const cards = items.map(renderCard).join('');
      body = '<div class="card-grid">' + (cards || '<div class="empty">该栏目暂无内容。</div>') + '</div>';
    }
    return '<section class="panel" id="' + id + '">' + head + body + '</section>';
  })
  .join('');

function iconSpan(icon) {
  const ic = String(icon || '').trim();
  if (isImg(ic)) return '<img class="nav-ico" src="' + esc(ic) + '" alt="">';
  return esc(ic || '📁');
}

// 导航链接：首页 + 各栏目
const navLinksHtml =
  '<li><a class="active" data-tab="home"><span class="nav-icon">' + esc(site.brandIcon || '✦') + '</span>首页</a></li>' +
  nav.categories
    .map((cat, i) => '<li><a data-tab="cat' + i + '"><span class="nav-icon">' + iconSpan(cat.icon) + '</span>' + esc(cat.title) + '</a></li>')
    .join('');

// ===== 6. 生成页面 =====
const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(site.title)}</title>
<style>
  :root[data-theme="dark"] {
    --bg:#0f0e17; --bg-grad:radial-gradient(ellipse at top,#1a1832 0%,#0f0e17 50%);
    --nav-bg:rgba(20,18,35,.75); --nav-border:rgba(255,255,255,.06);
    --card-bg:rgba(255,255,255,.04); --card-border:rgba(255,255,255,.08);
    --card-hover:rgba(255,255,255,.08);
    --text:#e8e6f0; --text-sec:#9b97b3; --text-dim:#6b6781;
    --accent:#a78bfa; --accent-2:#60a5fa; --accent-glow:rgba(167,139,250,.35);
    --tag-bg:rgba(167,139,250,.15); --tag-text:#c4b5fd;
    --input-bg:rgba(255,255,255,.06); --input-border:rgba(255,255,255,.1);
    --shadow:0 4px 24px rgba(0,0,0,.4);
  }
  :root[data-theme="light"] {
    --bg:#f8f7ff; --bg-grad:linear-gradient(180deg,#eef0ff 0%,#f8f7ff 40%);
    --nav-bg:rgba(255,255,255,.85); --nav-border:rgba(0,0,0,.06);
    --card-bg:#ffffff; --card-border:rgba(0,0,0,.06);
    --card-hover:#fafaff;
    --text:#1e1b2e; --text-sec:#5b5771; --text-dim:#9b97b3;
    --accent:#6d5cf0; --accent-2:#3b82f6; --accent-glow:rgba(109,92,240,.2);
    --tag-bg:rgba(109,92,240,.1); --tag-text:#6d5cf0;
    --input-bg:#fff; --input-border:rgba(0,0,0,.1);
    --shadow:0 2px 16px rgba(0,0,0,.06);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--bg); background-image:var(--bg-grad); background-attachment:fixed; color:var(--text);
    min-height:100vh; transition:background .4s,color .4s; -webkit-font-smoothing:antialiased; }

  /* 毛玻璃导航 */
  .navbar { position:sticky; top:0; z-index:100; background:var(--nav-bg); backdrop-filter:blur(16px) saturate(180%);
    -webkit-backdrop-filter:blur(16px) saturate(180%); border-bottom:1px solid var(--nav-border);
    display:flex; align-items:center; padding:0 48px; height:64px; transition:background .3s,border-color .3s; }
  .navbar .logo { font-size:19px; font-weight:700; background:linear-gradient(135deg,var(--accent),var(--accent-2));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-right:48px;
    white-space:nowrap; letter-spacing:-.3px; display:flex; align-items:center; gap:8px; }
  .navbar .logo svg { width:24px; height:24px; filter:drop-shadow(0 0 6px var(--accent-glow)); }
  .nav-links { display:flex; gap:2px; list-style:none; }
  .nav-links a { display:flex; align-items:center; gap:6px; padding:8px 18px; border-radius:10px; text-decoration:none;
    color:var(--text-sec); font-size:14px; font-weight:500; transition:all .25s; cursor:pointer; }
  .nav-links a:hover { background:var(--card-bg); color:var(--text); }
  .nav-links a.active { background:linear-gradient(135deg,var(--accent),var(--accent-2)); color:#fff; box-shadow:0 2px 12px var(--accent-glow); }
  .nav-links a .nav-icon { font-size:15px; line-height:1; }
  .nav-ico { width:16px; height:16px; border-radius:4px; object-fit:cover; }
  .theme-toggle { margin-left:auto; width:38px; height:38px; border-radius:10px; border:1px solid var(--nav-border);
    background:var(--card-bg); color:var(--text-sec); cursor:pointer; display:flex; align-items:center; justify-content:center;
    font-size:16px; transition:all .25s; }
  .theme-toggle:hover { color:var(--text); border-color:var(--accent); }

  /* 内容区 */
  .content { max-width:1200px; margin:0 auto; padding:48px 28px 80px; }
  .panel { display:none; animation:panelIn .35s cubic-bezier(.4,0,.2,1); }
  .panel.active { display:block; }
  @keyframes panelIn { from{opacity:0;transform:translateY(12px);filter:blur(4px);} to{opacity:1;transform:translateY(0);filter:blur(0);} }

  .page-header { margin-bottom:28px; }
  .page-header h2 { font-size:28px; font-weight:700; letter-spacing:-.5px; margin-bottom:6px; }
  .page-header p { font-size:14px; color:var(--text-dim); }

  /* 搜索 */
  .search-wrap { position:relative; margin:28px auto 0; max-width:580px; }
  .search-wrap svg { position:absolute; left:18px; top:50%; transform:translateY(-50%); width:18px; height:18px; color:var(--text-dim); pointer-events:none; }
  .search-wrap input { width:100%; padding:14px 20px 14px 48px; border:1px solid var(--input-border); border-radius:14px;
    font-size:15px; outline:none; background:var(--input-bg); color:var(--text); transition:all .25s; backdrop-filter:blur(8px); }
  .search-wrap input::placeholder { color:var(--text-dim); }
  .search-wrap input:focus { border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-glow); }

  /* 分类标签（二级分组过滤） */
  .cat-tags { display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap; }
  .cat-tag { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500; background:var(--tag-bg);
    color:var(--tag-text); border:none; cursor:pointer; transition:all .2s; }
  .cat-tag:hover { filter:brightness(1.15); }
  .cat-tag.active { background:linear-gradient(135deg,var(--accent),var(--accent-2)); color:#fff; }

  /* 卡片网格 */
  .card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:18px; }
  .card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:16px; padding:22px; text-decoration:none;
    color:var(--text); transition:transform .3s cubic-bezier(.4,0,.2,1),box-shadow .3s,border-color .3s,background .3s;
    display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden; }
  .card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px;
    background:linear-gradient(90deg,var(--accent),var(--accent-2)); opacity:0; transition:opacity .3s; }
  .card:hover { transform:translateY(-4px); box-shadow:0 12px 32px rgba(0,0,0,.18),0 0 0 1px var(--accent-glow); border-color:transparent; background:var(--card-hover); }
  .card:hover::before { opacity:1; }
  .card-top { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
  .icon-box { width:42px; height:42px; border-radius:11px; display:flex; align-items:center; justify-content:center;
    font-size:20px; background:var(--tag-bg); flex-shrink:0; overflow:hidden; }
  .ic-img { width:42px; height:42px; object-fit:cover; border-radius:11px; }
  .card .title { font-weight:600; font-size:15px; letter-spacing:-.2px; }
  .card .desc { font-size:13px; color:var(--text-sec); line-height:1.5; }
  .card .card-footer { margin-top:auto; padding-top:12px; display:flex; align-items:center; justify-content:space-between; }
  .card .url-label { font-size:11px; color:var(--text-dim); font-family:ui-monospace,"SF Mono",Menlo,monospace; }
  .card .arrow { font-size:14px; color:var(--text-dim); transition:transform .25s,color .25s; }
  .card:hover .arrow { transform:translateX(3px); color:var(--accent); }
  .empty { color:var(--text-dim); text-align:center; padding:34px; grid-column:1/-1; border:1px dashed var(--card-border); border-radius:16px; }

  /* 首页快捷入口 */
  .quick-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; margin-top:8px; }
  .quick-card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:20px 16px;
    text-decoration:none; color:var(--text); text-align:center; transition:all .25s; display:flex; flex-direction:column;
    align-items:center; gap:8px; }
  .quick-card:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.15); border-color:var(--accent-glow); }
  .quick-card .qc-icon { font-size:28px; }
  .quick-card .qc-icon .ic-img { width:28px; height:28px; }
  .quick-card .qc-title { font-size:14px; font-weight:600; }
  .quick-card .qc-desc { font-size:11px; color:var(--text-dim); }

  /* Hero */
  .hero { text-align:center; padding:32px 0 8px; }
  .hero h1 { font-size:42px; font-weight:800; letter-spacing:-1px; background:linear-gradient(135deg,var(--accent),var(--accent-2));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:12px; }
  .hero p { font-size:16px; color:var(--text-sec); max-width:480px; margin:0 auto 8px; line-height:1.6; }

  footer { text-align:center; padding:32px 24px; color:var(--text-dim); font-size:12px; border-top:1px solid var(--nav-border); }

  ::-webkit-scrollbar { width:8px; } ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--card-border); border-radius:4px; }
  ::-webkit-scrollbar-thumb:hover { background:var(--text-dim); }

  @media (max-width:768px) {
    .navbar { padding:0 16px; height:56px; }
    .navbar .logo { margin-right:16px; font-size:16px; }
    .nav-links { overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
    .nav-links::-webkit-scrollbar { display:none; }
    .nav-links a { padding:6px 12px; font-size:13px; white-space:nowrap; }
    .content { padding:28px 16px 60px; }
    .hero h1 { font-size:30px; }
    .card-grid { grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); }
  }
</style>
</head>
<body>
<nav class="navbar">
  <div class="logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>
    <span>${esc(site.title)}</span>
  </div>
  <ul class="nav-links">${navLinksHtml}</ul>
  <button class="theme-toggle" id="themeToggle" title="切换主题">🌙</button>
</nav>

<main class="content">
  ${homePanel}
  ${panelsHtml}
</main>

<footer>${esc(site.footer || '')}${site.footer ? ' · ' : ''}共 ${allItems.length} 个资源 · 点击顶部栏目切换内容 · 按 🌙 切换主题</footer>

<script>
(function () {
  var navLinks = document.querySelectorAll('.navbar .nav-links a');
  var panels = document.querySelectorAll('.panel');
  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      navLinks.forEach(function (l) { l.classList.remove('active'); });
      panels.forEach(function (p) { p.classList.remove('active'); });
      link.classList.add('active');
      var tab = link.getAttribute('data-tab');
      var el = document.getElementById(tab);
      if (el) el.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // 主题切换
  var themeToggle = document.getElementById('themeToggle');
  var html = document.documentElement;
  var saved = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-theme', saved);
  themeToggle.textContent = saved === 'dark' ? '🌙' : '☀️';
  themeToggle.addEventListener('click', function () {
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    themeToggle.textContent = next === 'dark' ? '🌙' : '☀️';
    localStorage.setItem('theme', next);
  });

  // 二级分组过滤（分类标签）
  document.querySelectorAll('.cat-tags').forEach(function (group) {
    group.querySelectorAll('.cat-tag').forEach(function (tag) {
      tag.addEventListener('click', function () {
        group.querySelectorAll('.cat-tag').forEach(function (t) { t.classList.remove('active'); });
        tag.classList.add('active');
        var g = tag.getAttribute('data-group');
        var panel = group.closest('.panel');
        panel.querySelectorAll('.card').forEach(function (c) {
          var show = g === 'all' || c.getAttribute('data-group') === g;
          c.style.display = show ? '' : 'none';
        });
      });
    });
  });

  // 搜索（实时过滤当前面板）
  var q = document.getElementById('globalSearch');
  q.addEventListener('input', function () {
    var v = q.value.trim().toLowerCase();
    var scope = document.querySelector('.panel.active');
    if (!scope) return;
    scope.querySelectorAll('.card,.quick-card').forEach(function (c) {
      var hit = !v || c.textContent.toLowerCase().indexOf(v) !== -1;
      c.style.display = hit ? '' : 'none';
    });
  });
})();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log('✅ 构建完成：' + nav.categories.length + ' 个栏目，' + allItems.length + ' 个资源 → public/index.html');
