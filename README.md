# 课件中心（单个 Cloudflare Pages 托管全部课件）

把**多个课件放进同一个 Cloudflare Pages 项目**，每个课件是一个独立文件夹，
首页由构建脚本自动扫描生成。**新增一节课件 = 新建文件夹 + 推送，自动上线。**

## 目录结构

```
kejian/
├── build.js              # 构建脚本：扫描 courseware/ → 生成 public/
├── serve.js              # 本地预览服务器（npm run preview）
├── package.json          # npm run build / npm run preview
├── courseware/           # ← 你的课件都放这里，每个一节一个文件夹
│   ├── lesson-1/
│   │   ├── index.html    #   课件页面（可含 css/js/图片等任意文件）
│   │   └── meta.json     #   课件元信息（标题/简介/封面/日期/标签）
│   ├── lesson-2/
│   │   ├── index.html
│   │   └── meta.json
│   └── _template/        #   （可选）新课件模板，以下划线开头不会被列到首页
└── public/               # 构建产物，由 Cloudflare Pages 生成，无需提交
```

线上访问地址示例：
- 首页：`https://<你的项目>.pages.dev/`
- 某课件：`https://<你的项目>.pages.dev/lesson-1/`

## 新增一节课件（以后天天做的事）

1. 在 `courseware/` 下新建文件夹，例如 `courseware/lesson-3/`
2. 放入你的网页 `index.html`（可带 css/js/图片，整文件夹会被原样发布）
3. 新建 `meta.json`：

```json
{
  "title": "第三课：标题写这里",
  "desc": "一句话简介，会显示在首页卡片上",
  "cover": "",                 // 可选：封面图文件名，放同文件夹内
  "date": "2026-08-10",        // 用于首页排序（倒序）
  "tags": ["标签1", "标签2"]
}
```

4. 提交并推送：

```bash
git add -A
git commit -m "新增第三课"
git push origin main
```

推送后 Cloudflare 自动重新构建，首页会**自动出现新课件**，无需任何额外操作。

## 本地预览

```bash
npm run build     # 生成 public/
npm run preview   # 打开 http://localhost:3000 查看效果
```

## Cloudflare Pages 设置（只需配置一次）

在 Cloudflare Pages 控制台连接本 GitHub 仓库，填写：

| 配置项 | 值 |
| --- | --- |
| 构建命令 (Build command) | `node build.js` |
| 输出目录 (Output directory) | `public` |
| 根目录 (Root directory) | 留空（仓库根） |
| 框架预设 (Framework) | `None` |

保存后首次部署；此后**每次 `git push` 都会自动更新线上**。

> 提示：可在 Pages 设置里绑定自己的域名；所有课件共用一个站点，
> 通过不同子路径区分，彻底告别"每节课建一个 Pages"。
