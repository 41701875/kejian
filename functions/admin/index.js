// 课件管理后台：/admin
// GET 显示表单，POST 调用 GitHub API 把课件写入仓库
// 需要环境变量：GH_TOKEN（GitHub PAT，有仓库 Contents 写权限）、ADMIN_PASSWORD（后台密码）

const OWNER = '41701875';
const REPO = 'kejian';
const BRANCH = 'main';

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

// 清理文件名：去掉路径，只保留安全字符
function safeFileName(name) {
  return (name || '').replace(/.*[\\/]/, '').replace(/[^\w.\u4e00-\u9fa5()_-]/g, '_');
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

function textResponse(status, msg, cls) {
  const body = cls
    ? `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>课件后台</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.box{max-width:520px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:32px;text-align:center}.box a{color:#6366f1}p{margin-top:12px;color:#64748b;font-size:14px}.ok{color:#065f46}.err{color:#991b1b;word-break:break-all}</style></head><body><div class="box"><div class="${cls}">${msg}</div><p><a href="/admin">← 返回后台</a></p></div></body></html>`
    : msg;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ===== GET：后台表单页面 =====
export async function onRequestGet() {
  const today = new Date().toISOString().slice(0, 10);
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
  button{width:100%;margin-top:24px;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#4f46e5}
  button:disabled{background:#94a3b8;cursor:not-allowed}
  .hint{font-size:12px;color:#94a3b8;margin-top:4px}
  .ok{background:#ecfdf5;color:#065f46;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:14px}
  .err{background:#fef2f2;color:#991b1b;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:13px;word-break:break-all}
  .files{margin-top:8px;font-size:13px;color:#64748b}
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

    <label>附加文件（可选：css / js / 图片，可多选）</label>
    <input type="file" name="files" multiple>
    <div class="files" id="filelist"></div>

    <button type="submit">提交并发布</button>
  </form>
  <div id="result"></div>
</div>
<script>
document.querySelector('input[name="files"]').addEventListener('change',function(){
  var list=Array.from(this.files).map(function(f){return f.name}).join('、');
  document.getElementById('filelist').textContent=list||'';
});
document.getElementById('f').addEventListener('submit', async function(e){
  e.preventDefault();
  var btn=e.target.querySelector('button');
  btn.disabled=true;btn.textContent='提交中…';
  var result=document.getElementById('result');
  result.innerHTML='';
  try{
    var fd=new FormData(e.target);
    var res=await fetch('/admin',{method:'POST',body:fd});
    var text=await res.text();
    if(res.ok){
      result.innerHTML='<div class="ok">'+text+'</div>';
      e.target.reset();
    }else{
      result.innerHTML='<div class="err">'+text+'</div>';
    }
  }catch(err){
    result.innerHTML='<div class="err">'+err.message+'</div>';
  }
  btn.disabled=false;btn.textContent='提交并发布';
});
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== POST：处理提交 =====
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

  const headers = {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kejian-admin'
  };

  const base = `courseware/${slug}`;
  const uploaded = [];

  try {
    // 1. index.html
    const htmlBuf = await htmlFile.arrayBuffer();
    await putFile(headers, `${base}/index.html`, bufToBase64(htmlBuf), `新增/更新课件：${title} (index.html)`);
    uploaded.push('index.html');

    // 2. 附加文件
    for (const f of extraFiles) {
      const fname = safeFileName(f.name);
      if (!fname || fname === '.' || fname === '..') continue;
      const fbuf = await f.arrayBuffer();
      await putFile(headers, `${base}/${fname}`, bufToBase64(fbuf), `新增/更新课件：${title} (${fname})`);
      uploaded.push(fname);
    }

    // 3. meta.json（最后写，确保 build.js 能读到完整课件）
    const meta = { title, desc, cover: '', date, tags };
    await putFile(headers, `${base}/meta.json`, strToBase64(JSON.stringify(meta, null, 2)), `新增/更新课件：${title} (meta.json)`);
    uploaded.push('meta.json');
  } catch (e) {
    return textResponse(500, '提交出错：' + e.message, 'err');
  }

  return textResponse(
    200,
    `提交成功！已写入 ${uploaded.length} 个文件（${uploaded.join('、')}）。<br>Cloudflare 会在几十秒内自动重新部署，刷新首页即可看到新课件。`,
    'ok'
  );
}
