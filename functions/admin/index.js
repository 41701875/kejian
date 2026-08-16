// 站点管理后台：/admin
// 两个分页：
//   1) 课件管理：新增/更新/删除 courseware/<slug>/（沿用 GitHub API）
//   2) 导航管理：编辑 data/nav.json（栏目 / 分组 / 链接：网址+图标+说明），可整体保存或快捷新增/删除
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

function strToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeFileName(name) {
  return (name || '').replace(/.*[\\/]/, '').replace(/[^\w.\u4e00-\u9fa5()_-]/g, '_');
}
function safeRelPath(name) {
  return (name || '')
    .split('/')
    .map((seg) => seg.replace(/[^\w.\u4e00-\u9fa5()_-]/g, '_'))
    .join('/');
}

// ===== 防爆破：失败次数锁定（需绑定 ADMIN_KV；未绑定时自动跳过，不影响使用）=====
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}
async function checkLock(env, request) {
  if (!env.ADMIN_KV) return false;
  try {
    const raw = await env.ADMIN_KV.get('fail:' + clientIp(request));
    return raw && parseInt(raw, 10) >= MAX_FAILS;
  } catch (_) {
    return false;
  }
}
async function registerFail(env, request) {
  if (!env.ADMIN_KV) return;
  try {
    const ip = clientIp(request);
    const raw = await env.ADMIN_KV.get('fail:' + ip);
    const n = (parseInt(raw || '0', 10) + 1).toString();
    await env.ADMIN_KV.put('fail:' + ip, n, { expirationTtl: LOCK_MINUTES * 60 });
  } catch (_) {}
}
async function clearFails(env, request) {
  if (!env.ADMIN_KV) return;
  try {
    await env.ADMIN_KV.delete('fail:' + clientIp(request));
  } catch (_) {}
}
// 常量时间比较，降低时序侧信道风险
function safeEq(a, b) {
  const ba = new TextEncoder().encode(a || '');
  const bb = new TextEncoder().encode(b || '');
  if (ba.length !== bb.length) return false;
  let r = 0;
  for (let i = 0; i < ba.length; i++) r |= ba[i] ^ bb[i];
  return r === 0;
}

// 读取仓库文件内容为文本；不存在返回 null
async function getText(headers, filePath) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`,
    { headers }
  );
  if (!res.ok) return null;
  const d = await res.json();
  return { text: Buffer.from(d.content, 'base64').toString('utf8'), sha: d.sha };
}

async function putFileText(headers, filePath, content, message, sha) {
  const body = { message, content: strToBase64(content), branch: BRANCH };
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

// 写入二进制文件
async function putFileBin(headers, filePath, contentBase64, message, sha) {
  const body = { message, content: contentBase64, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`写入 ${filePath} 失败（${res.status}）`);
}

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
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${item.path}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ message: `删除：${dirPath}`, sha: item.sha, branch: BRANCH })
      });
    } else if (item.type === 'dir') {
      await deletePath(headers, item.path);
    }
  }
}

// 读取 nav.json（用于导航管理）。返回 { nav, sha }
async function getNav(headers) {
  try {
    const got = await getText(headers, 'data/nav.json');
    if (got) return { nav: JSON.parse(got.text), sha: got.sha };
  } catch (_) {}
  return {
    nav: { site: { title: '盛军老师的导航站', subtitle: '', footer: '' }, categories: [{ title: '课件', icon: '📚', courseware: true }] },
    sha: null
  };
}

function textResponse(status, msg, cls) {
  if (!cls)
    return new Response(msg, {
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  const body = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>后台</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.box{max-width:520px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:32px;text-align:center}.box a{color:#6366f1}p{margin-top:12px;color:#64748b;font-size:14px}.ok{color:#065f46}.err{color:#991b1b;word-break:break-all}</style></head><body><div class="box"><div class="${cls}">${msg}</div><p><a href="/admin">← 返回后台</a></p></div></body></html>`;
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== GET：后台（课件管理 + 导航管理 两个分页）=====
export async function onRequestGet(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);
  const h = env.GH_TOKEN ? authHeaders(env.GH_TOKEN) : {};

  // 现有课件列表
  let cwList = [];
  try {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/courseware?ref=${BRANCH}`,
      { headers: h }
    );
    if (r.ok) {
      const d = await r.json();
      cwList = d.filter((x) => x.type === 'dir').map((x) => x.name);
    }
  } catch (_) {}

  const listHtml = cwList.length
    ? cwList
        .map(
          (s) =>
            `<div class="cw"><span>${esc(s)}　<span class="u">/${esc(s)}/</span></span><button class="del" data-slug="${esc(s)}">删除</button></div>`
        )
        .join('')
    : '<p class="empty">（暂无课件）</p>';

  // 导航配置（用于预填文本框 + 栏目下拉）
  let navObj = { site: { title: '盛军老师的导航站', subtitle: '', footer: '' }, categories: [] };
  let navSha = null;
  try {
    const got = await getNav(h);
    navObj = got.nav || navObj;
    navSha = got.sha;
  } catch (_) {}
  const navJsonText = JSON.stringify(navObj, null, 2);
  const catOptions = (navObj.categories || [])
    .map((c) => `<option value="${esc(c.title)}">${esc(c.title)}${c.courseware ? '（课件）' : ''}</option>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>站点管理后台</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;padding:24px}
  .wrap{max-width:760px;margin:0 auto}
  .tabs{display:flex;gap:8px;margin-bottom:16px}
  .tab{padding:10px 18px;border-radius:10px 10px 0 0;background:#e2e8f0;cursor:pointer;font-weight:600;border:none;font-size:15px}
  .tab.active{background:#fff;color:#4f46e5}
  .panel{background:#fff;border-radius:0 14px 14px 14px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:28px;display:none}
  .panel.active{display:block}
  h1{font-size:22px;margin-bottom:6px}
  .sub{color:#64748b;font-size:14px;margin-bottom:8px}
  label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
  input,textarea,select{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;background:#fff}
  input:focus,textarea:focus,select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
  .row{display:flex;gap:12px}
  .row>div{flex:1}
  button.submit{width:100%;margin-top:18px;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button.submit:hover{background:#4f46e5}
  button.submit:disabled{background:#94a3b8;cursor:not-allowed}
  .hint{font-size:12px;color:#94a3b8;margin-top:4px}
  .ok{background:#ecfdf5;color:#065f46;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:14px;white-space:pre-wrap}
  .err{background:#fef2f2;color:#991b1b;padding:12px 14px;border-radius:8px;margin-top:16px;font-size:13px;word-break:break-all;white-space:pre-wrap}
  .files{margin-top:8px;font-size:13px;color:#64748b}
  .list{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:14px}
  .cw{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;font-size:14px}
  .cw .u{color:#94a3b8;font-weight:400}
  .cw .del{width:auto;margin:0;padding:6px 14px;background:#ef4444;font-size:13px}
  .cw .del:hover{background:#dc2626}
  .empty{color:#94a3b8;font-size:13px}
  .nav-edit{width:100%;height:260px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}
  .group-box{border:1px dashed #cbd5e1;border-radius:10px;padding:14px;margin-top:14px;background:#f8fafc}
  .group-box h3{font-size:14px;margin-bottom:8px;color:#475569}
</style>
</head>
<body>
<div class="wrap">
  <div class="tabs">
    <button class="tab active" data-tab="cw">课件管理</button>
    <button class="tab" data-tab="nav">导航管理</button>
  </div>

  <!-- 课件管理 -->
  <div class="panel active" id="panel-cw">
    <h1>课件管理</h1>
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

      <label>附加文件夹（可选：选整个文件夹，保留子目录结构，如 images/）</label>
      <input type="file" name="folderfiles" webkitdirectory multiple>
      <div class="hint">适合需要配套资源文件夹的课件（例如主页引用 images/cover.png）。</div>

      <button type="submit" class="submit">提交并发布</button>
    </form>

    <div class="list">
      <h1 style="font-size:16px;margin-bottom:4px">现有课件（点删除可移除）</h1>
      ${listHtml}
    </div>
    <div id="result"></div>
  </div>

  <!-- 导航管理 -->
  <div class="panel" id="panel-nav">
    <h1>导航管理</h1>
    <p class="sub">编辑栏目 / 分组 / 链接（网址 + 图标 + 说明）。保存后自动重新部署。</p>
    <form id="navForm" method="post">
      <input type="hidden" name="action" value="nav_save">
      <label>后台密码</label>
      <input type="password" name="password" required autocomplete="off">
      <div class="hint">直接编辑下面的 JSON 最灵活：可任意增删栏目、分组、链接。</div>

      <label>导航配置（data/nav.json）</label>
      <textarea class="nav-edit" name="navjson" spellcheck="false">${escText(navJsonText)}</textarea>
      <div class="hint">结构：categories[].groups[].links[] 或 categories[].links[] 或 courseware:true（自动拉取课件）。图标可填 emoji 或图片网址。</div>

      <button type="submit" class="submit">保存配置并发布</button>
    </form>

    <div class="group-box">
      <h3>快捷新增栏目（顶级，最多二级下拉请直接编辑上方 JSON）</h3>
      <form id="catForm" method="post">
        <input type="hidden" name="action" value="nav_add_cat">
        <input type="hidden" name="password" id="catPwd">
        <div class="row">
          <div><label>栏目名称</label><input type="text" name="title" required placeholder="如 常用网站"></div>
          <div><label>图标 emoji</label><input type="text" name="icon" placeholder="🌐"></div>
        </div>
        <button type="submit" class="submit">新增栏目</button>
      </form>
    </div>

    <div class="group-box">
      <h3>快捷新增链接</h3>
      <form id="linkForm" method="post">
        <input type="hidden" name="action" value="nav_add_link">
        <input type="hidden" name="password" id="linkPwd">
        <label>所属栏目</label>
        <select name="category">${catOptions || '<option value="">（暂无栏目）</option>'}</select>
        <div class="row">
          <div><label>分组（仅该栏目有分组时填，留空放入栏目顶层）</label><input type="text" name="group" placeholder="如 系统工具"></div>
          <div><label>图标 emoji / 图片网址</label><input type="text" name="icon" placeholder="🔗"></div>
        </div>
        <div class="row">
          <div><label>标题</label><input type="text" name="title" required placeholder="如 百度"></div>
          <div><label>网址</label><input type="text" name="url" required placeholder="https://..."></div>
        </div>
        <label>说明（可选）</label>
        <input type="text" name="desc" placeholder="一句话描述">
        <button type="submit" class="submit">新增链接</button>
      </form>
    </div>

    <div class="group-box">
      <h3>删除栏目</h3>
      <form id="delForm" method="post">
        <input type="hidden" name="action" value="nav_del_cat">
        <input type="hidden" name="password" id="delPwd">
        <label>选择要删除的栏目</label>
        <select name="category">${catOptions || '<option value="">（暂无栏目）</option>'}</select>
        <button type="submit" class="submit" style="background:#ef4444">删除该栏目</button>
      </form>
    </div>

    <div id="navResult"></div>
  </div>
</div>

<script>
document.querySelector('.tab[data-tab="cw"]').addEventListener('click',function(){switchTab('cw')});
document.querySelector('.tab[data-tab="nav"]').addEventListener('click',function(){switchTab('nav')});
function switchTab(t){
  document.querySelectorAll('.tab').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===t)});
  document.getElementById('panel-cw').classList.toggle('active',t==='cw');
  document.getElementById('panel-nav').classList.toggle('active',t==='nav');
}
// 课件：文件列表
document.querySelector('input[name="files"]').addEventListener('change',function(){
  var list=Array.from(this.files).map(function(f){return f.name}).join('、');
  document.getElementById('filelist').textContent=list||'';
});
// 课件：提交
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
    for(var j=0;j<form.folderfiles.files.length;j++){ var f=form.folderfiles.files[j]; fd.append('folderfiles', f, f.webkitRelativePath || f.name); }
    var res=await fetch('/admin',{method:'POST',body:fd});
    var text=await res.text();
    if(res.ok){ result.innerHTML='<div class="ok">'+text+'</div>'; form.reset(); }
    else{ result.innerHTML='<div class="err">'+text+'</div>'; }
  }catch(err){ result.innerHTML='<div class="err">'+err.message+'</div>'; }
  btn.disabled=false;btn.textContent='提交并发布';
});
// 课件：删除
document.querySelectorAll('.del').forEach(function(b){
  b.addEventListener('click', async function(){
    var slug=b.getAttribute('data-slug');
    var pwd=prompt('输入后台密码以删除【'+slug+'】：');
    if(!pwd) return;
    if(!confirm('确定删除【'+slug+'】吗？不可恢复。')) return;
    b.disabled=true;b.textContent='删除中…';
    try{
      var res=await fetch('/admin',{method:'POST',body:new URLSearchParams({action:'delete',password:pwd,slug:slug})});
      var text=await res.text();
      if(res.ok){ alert('已删除 '+slug+'，即将重新部署。'); location.reload(); }
      else{ alert('删除失败：'+text); b.disabled=false;b.textContent='删除'; }
    }catch(err){ alert('错误：'+err.message); b.disabled=false;b.textContent='删除'; }
  });
});
// 导航：把密码同步到各快捷表单
['catPwd','linkPwd','delPwd'].forEach(function(id){
  var el=document.getElementById(id);
  document.querySelector('#navForm input[name=password]').addEventListener('input',function(){ el.value=this.value; });
});
async function navPost(form, resultId){
  var result=document.getElementById(resultId);
  result.innerHTML='';
  var btn=form.querySelector('button[type="submit"]');
  btn.disabled=true; var old=btn.textContent; btn.textContent='处理中…';
  try{
    var res=await fetch('/admin',{method:'POST',body:new URLSearchParams(new FormData(form))});
    var text=await res.text();
    result.innerHTML = res.ok ? '<div class="ok">'+text+'</div>' : '<div class="err">'+text+'</div>';
    if(res.ok) setTimeout(function(){location.reload();}, 800);
  }catch(err){ result.innerHTML='<div class="err">'+err.message+'</div>'; }
  btn.disabled=false; btn.textContent=old;
}
document.getElementById('navForm').addEventListener('submit',function(e){e.preventDefault();navPost(this,'navResult');});
document.getElementById('catForm').addEventListener('submit',function(e){e.preventDefault();navPost(this,'navResult');});
document.getElementById('linkForm').addEventListener('submit',function(e){e.preventDefault();navPost(this,'navResult');});
document.getElementById('delForm').addEventListener('submit',function(e){e.preventDefault(); if(!confirm('确定删除该栏目及其全部内容？'))return; navPost(this,'navResult');});
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== POST =====
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

  // 失败锁定：同一 IP 连续错 5 次，15 分钟内禁止再试
  if (await checkLock(env, request)) {
    return textResponse(429, `尝试次数过多，请 ${LOCK_MINUTES} 分钟后再试。`, 'err');
  }
  if (!safeEq(password, env.ADMIN_PASSWORD)) {
    await registerFail(env, request);
    return textResponse(403, '密码错误', 'err');
  }
  await clearFails(env, request);

  const action = (form.get('action') || 'add').trim();

  // ===== 导航：直接保存 JSON =====
  if (action === 'nav_save') {
    const raw = (form.get('navjson') || '').trim();
    let nav;
    try {
      nav = JSON.parse(raw);
    } catch (e) {
      return textResponse(400, 'JSON 格式错误，未保存：' + e.message, 'err');
    }
    if (!nav.categories || !Array.isArray(nav.categories))
      return textResponse(400, '缺少 categories 数组，未保存。', 'err');
    const headers = authHeaders(env.GH_TOKEN);
    try {
      const got = await getNav(headers);
      await putFileText(headers, 'data/nav.json', JSON.stringify(nav, null, 2), '更新导航配置 (nav.json)', got.sha);
    } catch (e) {
      return textResponse(500, '保存出错：' + e.message, 'err');
    }
    return textResponse(200, '导航配置已保存，Cloudflare 正在重新部署，刷新首页即可看到变化。', 'ok');
  }

  // ===== 导航：新增栏目 =====
  if (action === 'nav_add_cat') {
    const title = (form.get('title') || '').trim();
    const icon = (form.get('icon') || '').trim();
    if (!title) return textResponse(400, '请填写栏目名称', 'err');
    const headers = authHeaders(env.GH_TOKEN);
    try {
      const got = await getNav(headers);
      const nav = got.nav;
      if ((nav.categories || []).some((c) => c.title === title))
        return textResponse(400, '已存在同名栏目：' + title, 'err');
      nav.categories = nav.categories || [];
      nav.categories.push({ title, icon: icon || '📁', links: [] });
      await putFileText(headers, 'data/nav.json', JSON.stringify(nav, null, 2), '新增栏目：' + title, got.sha);
    } catch (e) {
      return textResponse(500, '出错：' + e.message, 'err');
    }
    return textResponse(200, '已新增栏目【' + title + '】。', 'ok');
  }

  // ===== 导航：新增链接 =====
  if (action === 'nav_add_link') {
    const category = (form.get('category') || '').trim();
    const group = (form.get('group') || '').trim();
    const title = (form.get('title') || '').trim();
    const url = (form.get('url') || '').trim();
    const icon = (form.get('icon') || '').trim();
    const desc = (form.get('desc') || '').trim();
    if (!category) return textResponse(400, '请选择所属栏目', 'err');
    if (!title || !url) return textResponse(400, '请填写标题和网址', 'err');
    const headers = authHeaders(env.GH_TOKEN);
    try {
      const got = await getNav(headers);
      const nav = got.nav;
      const cat = (nav.categories || []).find((c) => c.title === category);
      if (!cat) return textResponse(400, '找不到栏目：' + category, 'err');
      const link = { title, url, icon: icon || '🔗', desc };
      if (Array.isArray(cat.groups) && cat.groups.length) {
        if (!group) return textResponse(400, '该栏目有分组，请填写“分组”名称', 'err');
        const g = cat.groups.find((x) => x.title === group);
        if (!g) return textResponse(400, '找不到分组：' + group, 'err');
        g.links = g.links || [];
        g.links.push(link);
      } else {
        cat.links = cat.links || [];
        cat.links.push(link);
      }
      await putFileText(headers, 'data/nav.json', JSON.stringify(nav, null, 2), '新增链接：' + title, got.sha);
    } catch (e) {
      return textResponse(500, '出错：' + e.message, 'err');
    }
    return textResponse(200, '已为【' + category + '】新增链接【' + title + '】。', 'ok');
  }

  // ===== 导航：删除栏目 =====
  if (action === 'nav_del_cat') {
    const category = (form.get('category') || '').trim();
    if (!category) return textResponse(400, '请选择要删除的栏目', 'err');
    const headers = authHeaders(env.GH_TOKEN);
    try {
      const got = await getNav(headers);
      const nav = got.nav;
      const before = (nav.categories || []).length;
      nav.categories = (nav.categories || []).filter((c) => c.title !== category);
      if (nav.categories.length === before) return textResponse(400, '找不到栏目：' + category, 'err');
      await putFileText(headers, 'data/nav.json', JSON.stringify(nav, null, 2), '删除栏目：' + category, got.sha);
    } catch (e) {
      return textResponse(500, '出错：' + e.message, 'err');
    }
    return textResponse(200, '已删除栏目【' + category + '】。', 'ok');
  }

  // ===== 课件：删除 =====
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

  // ===== 课件：新增 / 更新 =====
  const slug = (form.get('slug') || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return textResponse(400, '文件夹名只能用英文、数字、横线、下划线', 'err');
  }
  const title = (form.get('title') || '').trim();
  if (!title) return textResponse(400, '请填写课件标题', 'err');
  const desc = (form.get('desc') || '').trim();
  const date = (form.get('date') || '').trim();
  const tagsRaw = (form.get('tags') || '').trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];

  const htmlFile = form.get('htmlfile');
  if (!htmlFile || !htmlFile.size) return textResponse(400, '请上传 index.html', 'err');

  const extraFiles = form.getAll('files').filter((f) => f && f.size > 0);
  const folderFiles = form.getAll('folderfiles').filter((f) => f && f.size > 0);

  const headers = authHeaders(env.GH_TOKEN);
  const base = `courseware/${slug}`;
  const uploaded = [];
  let coverPath = '';

  try {
    const htmlBuf = await htmlFile.arrayBuffer();
    await putFileBin(headers, `${base}/index.html`, bufToBase64(htmlBuf), `新增/更新课件：${title} (index.html)`);
    uploaded.push('index.html');

    const allExtras = [...extraFiles, ...folderFiles];
    for (const f of allExtras) {
      const isFolder = folderFiles.indexOf(f) !== -1;
      const rawName = f.name || '';
      const fname = isFolder ? safeRelPath(rawName) : safeFileName(rawName);
      if (!fname || fname === '.' || fname === '..') continue;
      const lastSeg = rawName.split('/').pop();
      if (/^cover\.(png|jpe?g|gif|webp|svg)$/i.test(lastSeg)) coverPath = fname;
      const fbuf = await f.arrayBuffer();
      await putFileBin(headers, `${base}/${fname}`, bufToBase64(fbuf), `新增/更新课件：${title} (${fname})`);
      uploaded.push(fname);
    }

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
    await putFileText(
      headers,
      `${base}/meta.json`,
      JSON.stringify(meta, null, 2),
      `新增/更新课件：${title} (meta.json)`
    );
    uploaded.push('meta.json');
  } catch (e) {
    return textResponse(500, '提交出错：' + e.message, 'err');
  }

  return textResponse(
    200,
    `提交成功！已写入 ${uploaded.length} 个文件（${uploaded.join('、')}）。` +
      (coverPath ? '\n已自动将封面图设为 ' + coverPath + '。' : '') +
      '\nCloudflare 会在几十秒内自动重新部署，刷新首页即可看到新课件。',
    'ok'
  );
}
