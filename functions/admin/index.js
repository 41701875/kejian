// 课件管理后台：/admin
// GET 显示表单 + 现有课件列表；POST 处理 新增/更新/删除
// 需要环境变量：GH_TOKEN（GitHub PAT，有仓库 Contents 写权限）、ADMIN_PASSWORD（后台密码）

const OWNER = '41701875';
const REPO = 'kejian';
const BRANCH = 'main';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kejian-admin'
  };
}

// 字符串 → base64（兼容中文）
function strToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

// ArrayBuffer → base64（用于二进制文件如图片）
function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 平级文件名：去掉路径，只保留安全字符
function safeFileName(name) {
  return (name || '').replace(/.*[\\/]/, '').replace(/[^\w.\u4e00-\u9fa5()_-]/g, '_');
}

// 相对路径名：保留子目录分隔符 “/”，每段单独清理
function safeRelPath(name) {
  return (name || '')
    .split('/')
    .map(seg => seg.replace(/[^\w.\u4e00-\u9fa5()_-]/g, '_'))
    .join('/');
}

// 写入/更新 GitHub 仓库单个文件（已存在则更新）
async function putFile(headers, filePath, contentBase64, message) {
  let sha;
  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`,
      { headers }
    );
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch (_) {}
  const body = { message, content: contentBase64, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`写入 ${filePath} 失败（${res.status}）：${t}`);
  }
}

// 递归删除 GitHub 上的目录（API 无“删文件夹”，需逐个文件删）
async function deletePath(headers, dirPath) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${dirPath}?ref=${BRANCH}`,
    { headers }
  );
  if (!res.ok) return;
  const data = await res.json();
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    if (item.type === 'file') {
      await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${item.path}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ message: `删除课件：${dirPath}`, sha: item.sha, branch: BRANCH })
        }
      );
    } else if (item.type === 'dir') {
      await deletePath(headers, item.path);
    }
  }
}

function textResponse(status, msg, cls) {
  if (!cls) return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const body = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>课件后台</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.box{max-width:520px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:32px;text-align:center}.box a{color:#6366f1}p{margin-top:12px;color:#64748b;font-size:14px}.ok{color:#065f46}.err{color:#991b1b;word-break:break-all}</style></head><body><div class="box"><div class="${cls}">${msg}</div><p><a href="/admin">← 返回后台</a></p></div></body></html>`;
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== GET：后台表单 + 现有课件列表 =====
export async function onRequestGet(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);

  // 拉取现有课件列表（公开仓库可不带 token，带 token 更稳）
  let cwList = [];
  try {
    const h = env.GH_TOKEN ? authHeaders(env.GH_TOKEN) : {};
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/courseware?ref=${BRANCH}`,
      { headers: h }
    );
    if (r.ok) {
      const d = await r.json();
      cwList = d.filter(x => x.type === 'dir').map(x => x.name);
    }
  } catch (_) {}

  const listHtml = cwList.length
    ? cwList.map(s => `<div class="cw"><span>${s}　<span class="u">/${s}/</span></span><button class="del" data-slug="${s}">删除</button></div>`).join('')
    : '<p class="empty">（暂无课件）</p>';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>课件管理后台</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;padding:24px}
  .wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:32px}
  h1{font-size:22px;margin-bottom:6px}
  .sub{color:#64748b;font-size:14px;margin-bottom:8px}
  label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
  input,textarea{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;background:#fff}
  input:focus,textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
  .row{display:flex;gap:12px}
  .row>div{flex:1}
  button{width:100%;margin-top:20px;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#4f46e5}
  button:disabled{background:#94a3b8;cursor:not-allowed}
  .hint{font-size:12px;color:#94a3b8;margin-top:4px}
  .ok{background:#ecfdf5;color:#065f46;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:14px}
  .err{background:#fef2f2;color:#991b1b;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:13px;word-break:break-all}
  .files{margin-top:8px;font-size:13px;color:#64748b}
  .list{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:14px}
  .cw{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;font-size:14px}
  .cw .u{color:#94a3b8;font-weight:400}
  .cw .del{width:auto;margin:0;padding:6px 14px;background:#ef4444;font-size:13px}
  .cw .del:hover{background:#dc2626}
  .empty{color:#94a3b8;font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <h1>课件管理后台</h1>
  <p class="sub">填写后提交，自动写入仓库并触发 Cloudflare 重新部署。</p>
  <form id="f" method="post" enctype="multipart/form-data">
    <label>后台密码</label>
    <input type="password" name="password" required autocomplete="off">
    <div class="hint">防止他人随意提交。</div>

    <label>课件文件夹名（英文 / 数字 / 横线）</label>
    <input type="text" name="slug" required placeholder="如 lesson-3">
    <div class="hint">将作为网址一部分，如 lesson-3 → xxx.pages.dev/lesson-3/</div>

    <label>课件标题</label>
    <input type="text" name="title" required placeholder="如 第三课：CSS 布局">

    <label>简介</label>
    <textarea name="desc" rows="2" placeholder="一句话介绍这个课件"></textarea>

    <div class="row">
      <div>
        <label>日期</label>
        <input type="date" name="date" value="${today}" required>
      </div>
      <div>
        <label>标签（逗号分隔）</label>
        <input type="text" name="tags" placeholder="入门, CSS">
      </div>
    </div>

    <label>课件主文件 index.html</label>
    <input type="file" name="htmlfile" accept=".html,.htm" required>

    <label>附加文件（可选：css / js / 图片，可多选，平级放入课件目录）</label>
    <input type="file" name="files" multiple>
    <div class="files" id="filelist"></div>

    <label>附加文件夹（可选：选整个文件夹，<b>保留子目录结构</b>，如 images/、assets/）</label>
    <input type="file" name="folderfiles" webkitdirectory multiple>
    <div class="hint">适合需要配套资源文件夹的课件（例如主页引用 images/cover.png）。</div>

    <button type="submit">提交并发布</button>
  </form>

  <div class="list">
    <h1 style="font-size:16px;margin-bottom:4px">现有课件（点删除可移除）</h1>
    ${listHtml}
  </div>

  <div id="result"></div>
</div>
<script>
document.querySelector('input[name="files"]').addEventListener('change',function(){
  var list=Array.from(this.files).map(function(f){return f.name}).join('、');
  document.getElementById('filelist').textContent=list||'';
});
document.getElementById('f').addEventListener('submit', async function(e){
  e.preventDefault();
  var form=document.getElementById('f');
  var btn=form.querySelector('button[type="submit"]');
  btn.disabled=true;btn.textContent='提交中…';
  var result=document.getElementById('result');
  result.innerHTML='';
  try{
    var fd=new FormData();
    ['password','slug','title','desc','date','tags'].forEach(function(k){ fd.append(k, form[k].value); });
    if(form.htmlfile.files[0]) fd.append('htmlfile', form.htmlfile.files[0]);
    for(var i=0;i<form.files.files.length;i++) fd.append('files', form.files.files[i]);
    for(var j=0;j<form.folderfiles.files.length;j++){
      var f=form.folderfiles.files[j];
      fd.append('folderfiles', f, f.webkitRelativePath || f.name);
    }
    var res=await fetch('/admin',{method:'POST',body:fd});
    var text=await res.text();
    if(res.ok){ result.innerHTML='<div class="ok">'+text+'</div>'; form.reset(); }
    else{ result.innerHTML='<div class="err">'+text+'</div>'; }
  }catch(err){
    result.innerHTML='<div class="err">'+err.message+'</div>';
  }
  btn.disabled=false;btn.textContent='提交并发布';
});
document.querySelectorAll('.del').forEach(function(b){
  b.addEventListener('click', async function(){
    var slug=b.getAttribute('data-slug');
    var pwd=prompt('输入后台密码以删除【'+slug+'】：');
    if(!pwd) return;
    if(!confirm('确定删除【'+slug+'】吗？该课件所有文件将被移除，且不可恢复。')) return;
    b.disabled=true;b.textContent='删除中…';
    try{
      var res=await fetch('/admin',{method:'POST',body:new URLSearchParams({action:'delete',password:pwd,slug:slug})});
      var text=await res.text();
      if(res.ok){ alert('已删除 '+slug+'，Cloudflare 会重新部署。'); location.reload(); }
      else{ alert('删除失败：'+text); b.disabled=false;b.textContent='删除'; }
    }catch(err){ alert('错误：'+err.message); b.disabled=false;b.textContent='删除'; }
  });
});
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== POST：处理提交（新增 / 更新 / 删除）=====
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GH_TOKEN) return textResponse(500, '服务器未配置 GH_TOKEN 环境变量', 'err');
  if (!env.ADMIN_PASSWORD) return textResponse(500, '服务器未配置 ADMIN_PASSWORD 环境变量', 'err');

  let form;
  try {
    form = await request.formData();
  } catch {
    return textResponse(400, '表单解析失败', 'err');
  }

  const password = form.get('password') || '';
  if (password !== env.ADMIN_PASSWORD) return textResponse(403, '密码错误', 'err');

  const action = (form.get('action') || 'add').trim();

  // ===== 删除课件 =====
  if (action === 'delete') {
    const slug = (form.get('slug') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return textResponse(400, '文件夹名非法', 'err');
    const headers = authHeaders(env.GH_TOKEN);
    try {
      await deletePath(headers, `courseware/${slug}`);
    } catch (e) {
      return textResponse(500, '删除出错：' + e.message, 'err');
    }
    return textResponse(200, `已删除课件 ${slug}。Cloudflare 会在几十秒内重新部署，刷新首页即可看到变化。`, 'ok');
  }

  // ===== 新增 / 更新课件 =====
  const slug = (form.get('slug') || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return textResponse(400, '文件夹名只能用英文、数字、横线、下划线', 'err');
  }

  const title = (form.get('title') || '').trim();
  if (!title) return textResponse(400, '请填写课件标题', 'err');
  const desc = (form.get('desc') || '').trim();
  const date = (form.get('date') || '').trim();
  const tagsRaw = (form.get('tags') || '').trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];

  const htmlFile = form.get('htmlfile');
  if (!htmlFile || !htmlFile.size) return textResponse(400, '请上传 index.html', 'err');

  const extraFiles = form.getAll('files').filter(f => f && f.size > 0);
  const folderFiles = form.getAll('folderfiles').filter(f => f && f.size > 0);

  const headers = authHeaders(env.GH_TOKEN);
  const base = `courseware/${slug}`;
  const uploaded = [];
  let coverPath = '';

  try {
    // 1. index.html
    const htmlBuf = await htmlFile.arrayBuffer();
    await putFile(headers, `${base}/index.html`, bufToBase64(htmlBuf), `新增/更新课件：${title} (index.html)`);
    uploaded.push('index.html');

    // 2. 附加文件（平级）+ 附加文件夹（保留子目录）
    const allExtras = [...extraFiles, ...folderFiles];
    for (const f of allExtras) {
      const isFolder = folderFiles.indexOf(f) !== -1;
      const rawName = f.name || '';
      const fname = isFolder ? safeRelPath(rawName) : safeFileName(rawName);
      if (!fname || fname === '.' || fname === '..') continue;
      const lastSeg = rawName.split('/').pop();
      // 名为 cover.* 的图片自动作为封面
      if (/^cover\.(png|jpe?g|gif|webp|svg)$/i.test(lastSeg)) coverPath = fname;
      const fbuf = await f.arrayBuffer();
      await putFile(headers, `${base}/${fname}`, bufToBase64(fbuf), `新增/更新课件：${title} (${fname})`);
      uploaded.push(fname);
    }

    // 3. meta.json（最后写，cover 优先取用户上传的 cover 图片；其次沿用已存在的）
    let finalCover = coverPath;
    if (!finalCover) {
      try {
        const getRes = await fetch(
          `https://api.github.com/repos/${OWNER}/${REPO}/contents/${base}/meta.json?ref=${BRANCH}`,
          { headers }
        );
        if (getRes.ok) {
          const data = await getRes.json();
          const oldMeta = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
          finalCover = oldMeta.cover || '';
        }
      } catch (_) {}
    }
    const meta = { title, desc, cover: finalCover, date, tags };
    await putFile(headers, `${base}/meta.json`, strToBase64(JSON.stringify(meta, null, 2)), `新增/更新课件：${title} (meta.json)`);
    uploaded.push('meta.json');
  } catch (e) {
    return textResponse(500, '提交出错：' + e.message, 'err');
  }

  return textResponse(
    200,
    `提交成功！已写入 ${uploaded.length} 个文件（${uploaded.join('、')}）。` +
      (coverPath ? '<br>已自动将封面图设为 ' + coverPath + '。' : '') +
      '<br>Cloudflare 会在几十秒内自动重新部署，刷新首页即可看到新课件。',
    'ok'
  );
}
