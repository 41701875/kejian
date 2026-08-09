/**
 * 课件中心构建脚本（零依赖，仅用 Node 内置模块）
 *
 * 功能：
 *  1. 扫描 courseware/<slug>/ 下每个课件文件夹
 *  2. 读取各自 meta.json（标题/简介/封面/日期/标签）
 *  3. 把每个课件原样复制到 public/<slug>/
 *  4. 自动生成 public/index.html（首页，列出全部课件）
 *
 * 在 Cloudflare Pages 中配置：
 *  构建命令：node build.js
 *  输出目录：public
 *  根目录 ：（留空，即仓库根）
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'courseware');
const OUT = path.join(ROOT, 'public');

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

// ---- 1. 清理并重建输出目录 ----
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// ---- 2. 收集课件（跳过以下划线开头的文件夹，如 _template）----
const slugs = fs
  .readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name);

const items = slugs
  .map((slug) => {
    const meta = loadMeta(slug);
    return {
      slug: slug,
      title: meta.title || slug,
      desc: meta.desc || '',
      cover: meta.cover || '',
      date: meta.date || '',
      tags: Array.isArray(meta.tags) ? meta.tags : []
    };
  })
  .sort(
    (a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')) ||
      a.title.localeCompare(b.title)
  );

// ---- 3. 复制每个课件到 public/<slug> ----
for (const slug of slugs) {
  copyDir(path.join(SRC, slug), path.join(OUT, slug));
}

// ---- 4. 生成首页 ----
const cards = items
  .map((it) => {
    const coverHtml = it.cover
      ? '<div class="cover-wrap"><img class="cover-img" src="./' + it.slug + '/' + it.cover + '" alt="' + it.title + '" /></div>'
      : '<div class="cover-wrap placeholder"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>';
    const tagsHtml = it.tags.map((t) => '<span class="tag">' + t + '</span>').join('');
    const metaLine = (it.date ? '<span class="date">' + it.date + '</span>' : '') + tagsHtml;
    return (
      '<a class="card" href="./' + it.slug + '/">' +
      coverHtml +
      '<div class="body">' +
      '<h3>' + it.title + '</h3>' +
      (it.desc ? '<p>' + it.desc + '</p>' : '') +
      (metaLine ? '<div class="meta">' + metaLine + '</div>' : '') +
      '</div>' +
      '</a>'
    );
  })
  .join('');

const cardsHtml = items.length
  ? cards
  : '<div class="empty">还没有课件，在 courseware/ 下新建文件夹即可。</div>';

const html =
  '<!DOCTYPE html>\n' +
  '<html lang="zh-CN">\n' +
  '<head>\n' +
  '<meta charset="UTF-8" />\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
  '<title>我的课件中心</title>\n' +
  '<style>\n' +
  '  :root { color-scheme: light; --bg: #f5f7fb; --card: #ffffff; --text: #1f2937; --muted: #6b7280; --accent: #2563eb; --border: #e5e7eb; }\n' +
  '  * { box-sizing: border-box; }\n' +
  '  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }\n' +
  '  header { padding: 48px 24px 24px; text-align: center; background: linear-gradient(135deg, #eef2ff 0%, #e0f2fe 100%); }\n' +
  '  header h1 { margin: 0 0 8px; font-size: 28px; }\n' +
  '  header p { margin: 0; color: var(--muted); }\n' +
  '  main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 64px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }\n' +
  '  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; text-decoration: none; color: inherit; transition: transform 0.15s ease, box-shadow 0.15s ease; display: flex; flex-direction: column; }\n' +
  '  .card:hover { transform: translateY(-4px); box-shadow: 0 12px 30px rgba(31, 41, 55, 0.12); }\n' +
  '  .cover-wrap { width: 100%; height: 120px; background: linear-gradient(135deg, #eef2ff, #e0f2fe); overflow: hidden; display: flex; align-items: center; justify-content: center; }\n' +
  '  .cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }\n' +
  '  .cover-wrap.placeholder { color: #94a3b8; }\n' +
  '  .cover-wrap.placeholder svg { width: 40px; height: 40px; }\n' +
  '  .body { padding: 16px 18px 20px; flex: 1; display: flex; flex-direction: column; }\n' +
  '  .body h3 { margin: 0 0 8px; font-size: 17px; }\n' +
  '  .body p { margin: 0 0 12px; color: var(--muted); font-size: 14px; flex: 1; }\n' +
  '  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }\n' +
  '  .meta .date { font-size: 12px; color: var(--muted); margin-right: 4px; }\n' +
  '  .tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: var(--accent); }\n' +
  '  footer { text-align: center; padding: 24px; color: var(--muted); font-size: 13px; }\n' +
  '  .empty { text-align: center; color: var(--muted); grid-column: 1 / -1; padding: 40px; }\n' +
  '</style>\n' +
  '</head>\n' +
  '<body>\n' +
  '  <header>\n' +
  '    <h1>📚 我的课件中心</h1>\n' +
  '    <p>所有课件集中托管 · 每新增一节即自动更新</p>\n' +
  '  </header>\n' +
  '  <main>\n' +
  '    __CARDS__\n' +
  '  </main>\n' +
  '  <footer>这些课件由 盛军老师 创建 · 共 __COUNT__ 个课件</footer>\n' +
  '</body>\n' +
  '</html>';

const finalHtml = html
  .replace('__CARDS__', cardsHtml)
  .replace('__COUNT__', String(items.length));

fs.writeFileSync(path.join(OUT, 'index.html'), finalHtml, 'utf8');
console.log('✅ 构建完成：' + items.length + ' 个课件 → public/index.html');
