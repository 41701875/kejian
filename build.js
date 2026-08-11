/**
 * 导航站构建脚本（零依赖，仅用 Node 内置模块）
 *
 * 功能：
 *  1. 读取 data/nav.json（站点信息 + 栏目/分组/链接配置）
 *  2. 自动扫描 courseware/<slug>/ 下每个课件文件夹（meta.json）
 *  3. 把每个课件原样复制到 public/<slug>/
 *  4. 复制 assets/icons/ 图标资源
 *  5. 生成 public/index.html：玻璃质感 sticky 导航（无下拉）+ 渐变头图 + 搜索 +
 *     各栏目分区（点击导航 → 平滑滚动到该分区，下面显示卡片），二级分组在分区内以小标题呈现。
 *
 * Cloudflare Pages 配置：构建命令 node build.js / 输出目录 public / 根目录留空
 *
 * 数据模型（data/nav.json）：
 *  {
 *    "site": { "title", "subtitle", "footer", "brandIcon" },
 *    "categories": [
 *      { "title", "icon",
 *        "groups": [ { "title","icon","links":[ {title,url,icon,desc} ] } ] },   // 带二级分组
 *      { "title", "icon", "links": [ {title,url,icon,desc} ] },                  // 直接链接
 *      { "title", "icon", "courseware": true }                                   // 自动拉取课件
 *    ]
 *  }
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

// 每栏目的主题色（用于图标底色、强调条、卡片左边线）
const PALETTE = [
  { c: '#6366f1', soft: '#eef2ff' },
  { c: '#0ea5e9', soft: '#e0f2fe' },
  { c: '#10b981', soft: '#d1fae5' },
  { c: '#f59e0b', soft: '#fef3c7' },
  { c: '#ef4444', soft: '#fee2e2' },
  { c: '#8b5cf6', soft: '#f3e8ff' },
  { c: '#ec4899', soft: '#fce7f3' },
  { c: '#14b8a6', soft: '#ccfbf1' }
];

// 图标：emoji 直接渲染；图片地址渲染为图标块（背景图）
function iconSpan(icon, fallback) {
  const ic = String(icon || '').trim();
  if (!ic) return esc(fallback);
  if (/^(https?:|\/|data:)/i.test(ic)) return '<img class="nav-ico" src="' + esc(ic) + '" alt="">';
  return esc(ic);
}
function cardIcon(icon, fallback) {
  const ic = String(icon || '').trim();
  if (/^(https?:|\/|data:)/i.test(ic)) {
    return '<span class="ico ico-img" style="background-image:url(\'' + esc(ic) + '\')"></span>';
  }
  return '<span class="ico">' + esc(ic || fallback) + '</span>';
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
const site = Object.assign({ title: '我的导航站', subtitle: '', footer: '', brandIcon: '🧭' }, nav.site || {});

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
    return { slug, title: meta.title || slug, desc: meta.desc || '', cover: meta.cover || '' };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

for (const slug of slugs) copyDir(path.join(SRC, slug), path.join(OUT, slug));

// 复制图标资源 + 无封面时按 slug 稳定分配图标
const iconFiles = fs.existsSync(ICON_DIR)
  ? fs.readdirSync(ICON_DIR).filter((f) => f.toLowerCase().endsWith('.svg'))
  : [];
if (iconFiles.length) copyDir(ICON_DIR, path.join(OUT, 'assets', 'icons'));
function pickIcon(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return iconFiles[h % iconFiles.length];
}

// ===== 4. 生成片段 =====
function renderLink(title, url, icon, desc, internal, fallback) {
  const attrs = internal ? '' : ' target="_blank" rel="noopener"';
  return (
    '<a class="card" href="' + esc(url) + '"' + attrs + '>' +
    cardIcon(icon, fallback) +
    '<span class="meta"><b>' + esc(title) + '</b>' +
    (desc ? '<small>' + esc(desc) + '</small>' : '') +
    '</span></a>'
  );
}

function countOf(cat) {
  if (cat.courseware) return coursewareItems.length;
  if (Array.isArray(cat.groups)) return cat.groups.reduce((n, g) => n + (g.links || []).length, 0);
  return Array.isArray(cat.links) ? cat.links.length : 0;
}

function renderCategory(cat, idx, pal) {
  const id = 'cat' + idx;
  let body = '';

  if (cat.courseware) {
    body = coursewareItems.length
      ? coursewareItems
          .map((it) => {
            const icon = it.cover ? './' + it.slug + '/' + it.cover : './assets/icons/' + pickIcon(it.slug);
            return renderLink(it.title, './' + it.slug + '/', icon, it.desc, true, '📚');
          })
          .join('')
      : '<div class="empty">还没有课件，在 courseware/ 下新建文件夹即可。</div>';
    if (!cat.groups && !cat.links) {
      return (
        '<section class="cat" id="' + id + '" style="--c:' + pal.c + ';--soft:' + pal.soft + '">' +
        catHead(cat, idx) +
        '<div class="grid">' + body + '</div></section>'
      );
    }
  }

  if (Array.isArray(cat.groups) && cat.groups.length) {
    body = cat.groups
      .map((g) => {
        const cards = (g.links || [])
          .map((l) => renderLink(l.title, l.url, l.icon, l.desc, false, '🔗'))
          .join('');
        return (
          '<div class="group">' +
          '<h3 class="group-title">' + iconSpan(g.icon || '🔹', '🔹') + ' <span>' + esc(g.title) + '</span></h3>' +
          '<div class="grid">' + (cards || '<div class="empty">该分组暂无内容。</div>') + '</div></div>'
        );
      })
      .join('');
  } else {
    const cards = (cat.links || [])
      .map((l) => renderLink(l.title, l.url, l.icon, l.desc, false, '🔗'))
      .join('');
    body = '<div class="grid">' + (cards || '<div class="empty">该栏目暂无内容。</div>') + '</div>';
  }

  return (
    '<section class="cat" id="' + id + '" style="--c:' + pal.c + ';--soft:' + pal.soft + '">' +
    catHead(cat, idx) + body + '</section>'
  );
}

function catHead(cat, idx) {
  const n = countOf(cat);
  return (
    '<div class="cat-head">' +
    '<span class="bar"></span>' +
    '<h2>' + iconSpan(cat.icon || '📁', '📁') + ' <span>' + esc(cat.title) + '</span></h2>' +
    '<span class="count">' + n + ' 个</span>' +
    '</div>'
  );
}

const pilHtml = nav.categories
  .map((cat, idx) => {
    const active = idx === 0 ? ' active' : '';
    return (
      '<button class="pill' + active + '" data-target="cat' + idx + '">' +
      iconSpan(cat.icon || '📁', '📁') + '<span>' + esc(cat.title) + '</span></button>'
    );
  })
  .join('');

const sectionsHtml = nav.categories
  .map((cat, idx) => renderCategory(cat, idx, PALETTE[idx % PALETTE.length]))
  .join('');

let total = coursewareItems.length;
nav.categories.forEach((c) => {
  if (c.courseware) return;
  if (Array.isArray(c.groups)) c.groups.forEach((g) => (total += (g.links || []).length));
  else if (Array.isArray(c.links)) total += c.links.length;
});

// ===== 5. 生成页面 =====
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(site.title)}</title>
<style>
  :root { color-scheme: light; --bg:#f4f6fb; --card:#fff; --text:#1e293b; --muted:#64748b; --line:#e8ebf2; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.6; -webkit-font-smoothing:antialiased; }
  a { color:inherit; text-decoration:none; }

  /* 玻璃质感导航 */
  .navbar { position:sticky; top:0; z-index:50; background:rgba(255,255,255,.82); backdrop-filter:saturate(180%) blur(12px); -webkit-backdrop-filter:saturate(180%) blur(12px); border-bottom:1px solid var(--line); }
  .nav-inner { max-width:1180px; margin:0 auto; display:flex; align-items:center; gap:14px; padding:12px 20px; }
  .brand { font-weight:800; font-size:18px; display:flex; align-items:center; gap:8px; white-space:nowrap; letter-spacing:.2px; }
  .brand .logo { font-size:22px; }
  .pills { display:flex; gap:8px; margin-left:auto; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
  .pills::-webkit-scrollbar { display:none; }
  .pill { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; border:1px solid transparent; background:rgba(99,102,241,.06); color:#475569; font-size:14px; font-weight:600; padding:8px 16px; border-radius:999px; cursor:pointer; transition:.18s; font-family:inherit; }
  .pill:hover { background:rgba(99,102,241,.12); color:#4338ca; }
  .pill.active { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; box-shadow:0 6px 16px rgba(99,102,241,.35); }

  /* 渐变头图 + 搜索 */
  .hero { position:relative; overflow:hidden; background:linear-gradient(135deg,#6366f1 0%,#3b82f6 55%,#06b6d4 100%); color:#fff; text-align:center; padding:54px 20px 46px; }
  .hero::after { content:""; position:absolute; inset:0; background:radial-gradient(900px 320px at 50% -20%,rgba(255,255,255,.28),transparent 60%); pointer-events:none; }
  .hero-inner { position:relative; max-width:760px; margin:0 auto; }
  .hero h1 { margin:0 0 8px; font-size:32px; font-weight:800; letter-spacing:.5px; }
  .hero p { margin:0 0 22px; opacity:.92; font-size:15px; }
  .search { display:flex; align-items:center; gap:10px; background:#fff; color:#334155; max-width:520px; margin:0 auto; padding:12px 16px; border-radius:14px; box-shadow:0 12px 30px rgba(15,23,42,.18); }
  .search span { font-size:16px; opacity:.55; }
  .search input { flex:1; border:none; outline:none; font-size:15px; background:transparent; color:#0f172a; }
  .search input::placeholder { color:#94a3b8; }

  /* 内容分区 */
  main { max-width:1180px; margin:0 auto; padding:40px 20px 70px; }
  .cat { scroll-margin-top:78px; margin-bottom:46px; }
  .cat-head { display:flex; align-items:center; gap:10px; margin:0 0 18px; }
  .cat-head .bar { width:5px; height:22px; border-radius:4px; background:var(--c,#6366f1); }
  .cat-head h2 { margin:0; font-size:21px; font-weight:800; display:flex; align-items:center; gap:8px; }
  .cat-head .count { margin-left:auto; font-size:13px; color:var(--muted); background:#fff; border:1px solid var(--line); padding:3px 12px; border-radius:999px; }
  .group { margin-bottom:26px; }
  .group-title { margin:0 0 12px; font-size:15px; font-weight:700; color:#475569; display:flex; align-items:center; gap:7px; }

  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:16px; }
  .card { display:flex; align-items:center; gap:13px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:15px 16px; transition:.18s; position:relative; overflow:hidden; }
  .card::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--c,#6366f1); opacity:0; transition:.18s; }
  .card:hover { transform:translateY(-4px); box-shadow:0 16px 34px rgba(15,23,42,.12); border-color:transparent; }
  .card:hover::before { opacity:1; }
  .ico { width:46px; height:46px; border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:22px; flex:0 0 auto; background:var(--soft,#eef2ff); color:var(--c,#6366f1); }
  .ico-img { background-size:cover; background-position:center; background-color:var(--soft,#eef2ff); }
  .nav-ico { width:18px; height:18px; border-radius:5px; object-fit:cover; vertical-align:middle; }
  .meta { min-width:0; display:flex; flex-direction:column; gap:2px; }
  .meta b { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .meta small { font-size:12.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .empty { color:var(--muted); text-align:center; padding:34px; grid-column:1/-1; background:var(--card); border:1px dashed var(--line); border-radius:16px; }

  footer { text-align:center; padding:26px 20px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); background:#fff; }

  @media (max-width:720px) {
    .nav-inner { flex-wrap:wrap; padding:10px 14px; }
    .brand { font-size:16px; }
    .pills { margin-left:0; width:100%; padding-bottom:2px; }
    .hero { padding:40px 16px 34px; }
    .hero h1 { font-size:25px; }
    .grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
    .card { flex-direction:column; align-items:flex-start; gap:10px; padding:14px; }
    main { padding:28px 14px 60px; }
    .meta b, .meta small { white-space:normal; }
  }
</style>
</head>
<body id="top">
  <nav class="navbar" id="navbar">
    <div class="nav-inner">
      <a class="brand" href="#top"><span class="logo">${iconSpan(site.brandIcon || '🧭', '🧭')}</span><span>${esc(site.title)}</span></a>
      <div class="pills" id="pills">${pilHtml}</div>
    </div>
  </nav>

  <header class="hero">
    <div class="hero-inner">
      <h1>${esc(site.title)}</h1>
      ${site.subtitle ? '<p>' + esc(site.subtitle) + '</p>' : ''}
      <div class="search"><span>🔍</span><input id="q" type="search" placeholder="搜索资源名称或说明…" aria-label="搜索" /></div>
    </div>
  </header>

  <main id="content">${sectionsHtml}</main>

  <footer>${esc(site.footer || '')}${site.footer ? ' · ' : ''}共 ${total} 个资源</footer>

  <script>
  (function () {
    var pills = Array.prototype.slice.call(document.querySelectorAll('.pill'));
    var cats = Array.prototype.slice.call(document.querySelectorAll('.cat'));
    function setActive(id) {
      pills.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-target') === id); });
    }
    pills.forEach(function (p) {
      p.addEventListener('click', function () {
        var el = document.getElementById(p.getAttribute('data-target'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(p.getAttribute('data-target'));
      });
    });
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) setActive(e.target.id);
        });
      }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
      cats.forEach(function (c) { obs.observe(c); });
    }

    // 搜索过滤
    var q = document.getElementById('q');
    q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase();
      document.querySelectorAll('.card').forEach(function (c) {
        var hit = !v || c.textContent.toLowerCase().indexOf(v) !== -1;
        c.style.display = hit ? '' : 'none';
      });
      document.querySelectorAll('.group').forEach(function (g) {
        var any = g.querySelector('.card:not([style*="display: none"])');
        g.style.display = any ? '' : 'none';
      });
      document.querySelectorAll('.cat').forEach(function (c) {
        var any = c.querySelector('.card:not([style*="display: none"])');
        c.style.display = any ? '' : 'none';
      });
    });
  })();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log('✅ 构建完成：' + nav.categories.length + ' 个栏目，' + total + ' 个资源 → public/index.html');
