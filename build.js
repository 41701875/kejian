/**
 * 导航站构建脚本（零依赖，仅用 Node 内置模块）
 *
 * 功能：
 *  1. 读取 data/nav.json（站点信息 + 栏目/分组/链接配置）
 *  2. 自动扫描 courseware/<slug>/ 下每个课件文件夹（meta.json）
 *  3. 把每个课件原样复制到 public/<slug>/
 *  4. 复制 assets/icons/ 图标资源
 *  5. 生成 public/index.html：
 *     - 顶部 sticky 导航栏（桌面悬浮二级下拉 / 移动端汉堡菜单）
 *     - 各栏目分区（支持二级分组）
 *     - 响应式卡片网格（手机 1~2 列、电脑多列）
 *
 * Cloudflare Pages 配置：
 *  构建命令：node build.js
 *  输出目录：public
 *  根目录  ：（留空，即仓库根）
 *
 * 数据模型（data/nav.json）：
 *  {
 *    "site": { "title", "subtitle", "footer" },
 *    "categories": [
 *      { "title", "icon",                       // 栏目（可带子分组）
 *        "groups": [ { "title","icon","links":[ {title,url,icon,desc} ] } ] },
 *      { "title", "icon", "links": [ {title,url,icon,desc} ] },   // 直接放链接
 *      { "title", "icon", "courseware": true }                    // 自动拉取课件
 *    ]
 *  }
 *  - 链接字段：title 必填，url/icon(emoji 或图片地址)/desc 可选
 *  - 最多两级：栏目 → 分组 → 链接
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

// 小号图标（用于导航栏 / 标题），emoji 或图片地址
function iconSpan(icon, fallback) {
  const ic = String(icon || '').trim();
  if (!ic) return esc(fallback);
  if (/^(https?:|\/|data:)/i.test(ic)) return '<img class="nav-ico" src="' + esc(ic) + '" alt="">';
  return esc(ic);
}
// 卡片图标（带底色圆角块），emoji 或图片地址，失败回退 emoji
function cardIcon(icon, fallback) {
  const ic = String(icon || '').trim();
  if (/^(https?:|\/|data:)/i.test(ic)) {
    return '<img class="card-icon-img" src="' + esc(ic) + '" alt="">';
  }
  if (ic) return '<span class="card-icon">' + esc(ic) + '</span>';
  return '<span class="card-icon">' + esc(fallback) + '</span>';
}

// ===== 1. 清理并重建输出目录 =====
rmrf(OUT);
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
const site = Object.assign({ title: '我的导航站', subtitle: '', footer: '' }, nav.site || {});

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
    return {
      slug,
      title: meta.title || slug,
      desc: meta.desc || '',
      cover: meta.cover || ''
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

// 复制课件到 public/<slug>
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
    '<div class="card-body"><h3>' + esc(title) + '</h3>' +
    (desc ? '<p>' + esc(desc) + '</p>' : '') +
    '</div></a>'
  );
}

function renderCategory(cat, idx) {
  const id = 'cat' + idx;
  const head =
    '<h2 class="cat-title">' + iconSpan(cat.icon || '📚', '📚') +
    ' <span>' + esc(cat.title) + '</span></h2>';
  let body = '';

  if (cat.courseware) {
    if (coursewareItems.length) {
      body = coursewareItems
        .map((it) => {
          const icon = it.cover
            ? './' + it.slug + '/' + it.cover
            : './assets/icons/' + pickIcon(it.slug);
          return renderLink(it.title, './' + it.slug + '/', icon, it.desc, true, '📚');
        })
        .join('');
    } else body = '<div class="empty">还没有课件，在 courseware/ 下新建文件夹即可。</div>';
    return '<section class="cat" id="' + id + '">' + head + '<div class="grid">' + body + '</div></section>';
  }

  if (Array.isArray(cat.groups) && cat.groups.length) {
    body = cat.groups
      .map((g, gi) => {
        const gid = id + '-g' + gi;
        const cards = (g.links || [])
          .map((l) => renderLink(l.title, l.url, l.icon, l.desc, false, '🔗'))
          .join('');
        return (
          '<div class="group" id="' + gid + '">' +
          '<h3 class="group-title">' + iconSpan(g.icon || '🔹', '🔹') +
          ' <span>' + esc(g.title) + '</span></h3>' +
          '<div class="grid">' + (cards || '<div class="empty">该分组暂无内容。</div>') + '</div></div>'
        );
      })
      .join('');
    return '<section class="cat" id="' + id + '">' + head + body + '</section>';
  }

  const cards = (cat.links || [])
    .map((l) => renderLink(l.title, l.url, l.icon, l.desc, false, '🔗'))
    .join('');
  return (
    '<section class="cat" id="' + id + '">' + head +
    '<div class="grid">' + (cards || '<div class="empty">该栏目暂无内容。</div>') + '</div></section>'
  );
}

function dropdownLinks(links) {
  return (links || [])
    .map(
      (l) =>
        '<a class="dd-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        '<span class="di">' + iconSpan(l.icon || '🔗', '🔗') + '</span>' +
        '<span>' + esc(l.title) + '</span></a>'
    )
    .join('');
}

function renderNavItem(cat, idx) {
  const id = 'cat' + idx;
  const hasDropdown = cat.courseware || (Array.isArray(cat.groups) && cat.groups.length) || (Array.isArray(cat.links) && cat.links.length);
  const caret = hasDropdown ? '<span class="caret">▾</span>' : '';

  let dd = '';
  if (cat.courseware) {
    dd = coursewareItems
      .map(
        (it) =>
          '<a class="dd-link" href="./' + it.slug + '/"><span class="di">📚</span><span>' +
          esc(it.title) + '</span></a>'
      )
      .join('');
  } else if (Array.isArray(cat.groups) && cat.groups.length) {
    dd = cat.groups
      .map(
        (g) =>
          '<div class="dd-group"><div class="dd-group-title">' +
          iconSpan(g.icon || '🔹', '🔹') + ' ' + esc(g.title) + '</div>' +
          dropdownLinks(g.links) +
          '</div>'
      )
      .join('');
  } else if (Array.isArray(cat.links) && cat.links.length) {
    dd = dropdownLinks(cat.links);
  }

  return (
    '<li class="nav-item">' +
    '<button class="nav-link" data-target="' + id + '">' +
    iconSpan(cat.icon || '📚', '📚') + '<span>' + esc(cat.title) + '</span>' + caret +
    '</button>' +
    (dd ? '<div class="dropdown">' + dd + '</div>' : '') +
    '</li>'
  );
}

const navItemsHtml = nav.categories.map(renderNavItem).join('');
const sectionsHtml = nav.categories.map(renderCategory).join('');

// 统计资源总数（链接 + 课件）
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
  :root {
    color-scheme: light;
    --bg:#f5f7fb; --card:#ffffff; --text:#1f2937; --muted:#6b7280;
    --accent:#2563eb; --accent2:#4f46e5; --border:#e5e7eb; --navbg:#ffffff;
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
  a { color:inherit; }

  /* 导航栏 */
  .navbar { position:sticky; top:0; z-index:50; background:var(--navbg); border-bottom:1px solid var(--border); box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .nav-inner { max-width:1100px; margin:0 auto; display:flex; align-items:center; gap:12px; padding:10px 16px; position:relative; }
  .brand { font-weight:700; font-size:17px; text-decoration:none; white-space:nowrap; display:flex; align-items:center; gap:6px; }
  .nav-toggle { display:none; margin-left:auto; background:none; border:1px solid var(--border); border-radius:8px; font-size:20px; padding:4px 10px; cursor:pointer; }
  .nav-menu { list-style:none; display:flex; gap:4px; margin:0; padding:0; flex:1; flex-wrap:wrap; }
  .nav-item { position:relative; }
  .nav-link { display:flex; align-items:center; gap:4px; background:none; border:none; cursor:pointer; font-size:15px; color:var(--text); padding:8px 12px; border-radius:8px; font-family:inherit; }
  .nav-link:hover { background:#eef2ff; color:var(--accent); }
  .caret { font-size:11px; opacity:.6; }
  .dropdown { position:absolute; top:100%; left:0; min-width:240px; background:#fff; border:1px solid var(--border); border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.12); padding:10px; display:none; z-index:60; }
  .nav-item:hover .dropdown { display:block; }
  .dd-group { margin-bottom:8px; }
  .dd-group:last-child { margin-bottom:0; }
  .dd-group-title { font-size:12px; font-weight:700; color:var(--muted); padding:4px 8px; }
  .dd-link { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:8px; text-decoration:none; color:var(--text); font-size:14px; }
  .dd-link:hover { background:#f1f5f9; }
  .dd-link .di { font-size:16px; width:20px; text-align:center; flex:0 0 auto; }
  .nav-ico { width:18px; height:18px; border-radius:4px; object-fit:cover; vertical-align:middle; }

  /* 头图 */
  .hero { text-align:center; padding:44px 20px 22px; background:linear-gradient(135deg,#eef2ff 0%,#e0f2fe 100%); }
  .hero h1 { margin:0 0 6px; font-size:30px; }
  .hero p { margin:0; color:var(--muted); }

  /* 内容 */
  main { max-width:1100px; margin:0 auto; padding:28px 16px 60px; }
  .cat { margin-bottom:36px; scroll-margin-top:72px; }
  .cat-title { font-size:22px; margin:0 0 14px; display:flex; align-items:center; gap:8px; }
  .group { margin-bottom:22px; }
  .group-title { font-size:16px; margin:0 0 12px; color:var(--accent2); display:flex; align-items:center; gap:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:16px; display:flex; gap:14px; align-items:flex-start; text-decoration:none; transition:transform .15s ease,box-shadow .15s ease; }
  .card:hover { transform:translateY(-3px); box-shadow:0 10px 26px rgba(31,41,55,.12); }
  .card-icon { font-size:24px; line-height:1; flex:0 0 auto; width:42px; height:42px; border-radius:10px; background:#eef2ff; display:flex; align-items:center; justify-content:center; }
  .card-icon-img { width:42px; height:42px; border-radius:10px; object-fit:cover; flex:0 0 auto; }
  .card-body { flex:1; min-width:0; }
  .card-body h3 { margin:0 0 4px; font-size:16px; }
  .card-body p { margin:0; color:var(--muted); font-size:13px; }
  .empty { color:var(--muted); text-align:center; padding:30px; grid-column:1/-1; }

  footer { text-align:center; padding:24px; color:var(--muted); font-size:13px; border-top:1px solid var(--border); }

  /* 移动端 */
  @media (max-width:768px) {
    .nav-toggle { display:block; }
    .nav-menu { display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border-bottom:1px solid var(--border); flex-direction:column; padding:8px; gap:2px; box-shadow:0 8px 20px rgba(0,0,0,.08); }
    .nav-menu.open { display:flex; }
    .nav-item { width:100%; }
    .nav-link { width:100%; justify-content:space-between; }
    .dropdown { position:static; display:none; box-shadow:none; border:none; padding:4px 0 4px 12px; min-width:0; }
    .nav-item.open .dropdown { display:block; }
    .grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
    .card { flex-direction:column; gap:10px; }
    .hero h1 { font-size:24px; }
  }
</style>
</head>
<body id="top">
  <nav class="navbar" id="navbar">
    <div class="nav-inner">
      <a class="brand" href="#top">${iconSpan(site.brandIcon || '🧭', '🧭')} <span>${esc(site.title)}</span></a>
      <button class="nav-toggle" id="navToggle" aria-label="展开菜单">☰</button>
      <ul class="nav-menu" id="navMenu">
        ${navItemsHtml}
      </ul>
    </div>
  </nav>

  <header class="hero">
    <h1>${esc(site.title)}</h1>
    ${site.subtitle ? '<p>' + esc(site.subtitle) + '</p>' : ''}
  </header>

  <main>
    ${sectionsHtml}
  </main>

  <footer>${esc(site.footer || '')}${site.footer ? ' · ' : ''}共 ${total} 个资源</footer>

  <script>
  (function () {
    var toggle = document.getElementById('navToggle');
    var menu = document.getElementById('navMenu');
    if (toggle) {
      toggle.addEventListener('click', function () { menu.classList.toggle('open'); });
    }
    var links = document.querySelectorAll('.nav-link');
    links.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var item = btn.closest('.nav-item');
        if (window.innerWidth <= 768) {
          item.classList.toggle('open');
          e.preventDefault();
          return;
        }
        var target = btn.getAttribute('data-target');
        if (target) {
          var el = document.getElementById(target);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
    document.querySelectorAll('.dd-link').forEach(function (a) {
      a.addEventListener('click', function () {
        if (window.innerWidth <= 768) {
          menu.classList.remove('open');
          document.querySelectorAll('.nav-item.open').forEach(function (n) { n.classList.remove('open'); });
        }
      });
    });
  })();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log('✅ 构建完成：' + nav.categories.length + ' 个栏目，' + total + ' 个资源 → public/index.html');
