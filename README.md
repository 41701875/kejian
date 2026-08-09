# GitHub → Cloudflare Pages 自动部署

本仓库用于验证「用 GitHub 做版本控制 + 通过 GitHub push 自动部署到 Cloudflare Pages」的完整链路。
项目本身是一个极简静态站点（单页 `index.html`），重点是打通 **push 即更新线上** 的流程。

> 本仓库由 WorkBuddy 于 2026-08-09 从 2026-08-05 23:53 的往期任务（同一目标）迁移并初始化。

## 当前进度

- [x] 工作区初始化为 git 仓库
- [x] 生成 SSH 部署密钥（位于 `~/.ssh/id_ed25519`，私钥权限已收紧）
- [x] 配置 `git config core.sshCommand` 走该密钥
- [x] 写入最小静态站点 `index.html` + `.gitignore`
- [ ] **待你操作**：把 SSH 公钥添加到 GitHub 账户
- [ ] **待你操作**：在 GitHub 创建空仓库（记录 用户名/仓库名）
- [ ] **待你操作**：提供 git 提交身份（user.name / user.email）
- [ ] 提交并 `git push` 到 GitHub
- [ ] 在 Cloudflare Pages 连接该仓库，完成自动部署

## 你需要做的三件事（然后交给我收尾）

### 1. 把 SSH 公钥添加到 GitHub
复制下面这段公钥，到 GitHub → Settings → SSH and GPG keys → New SSH key 粘贴保存：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF0v0K/FY9Nsk05opY0tyEGqkdtAqMORFflQ3mNwUx/1 workbuddy-cloudflare-pages
```

（公钥文件也在仓库的 `deploy_key.pub` 与本机 `~/.ssh/id_ed25519.pub`。）

### 2. 在 GitHub 创建一个空仓库
- 仓库名建议：`github-pages-demo`（随意）
- 不要勾选初始化 README / .gitignore（保持空仓库）
- 记下你的 **GitHub 用户名** 和 **仓库名**，告诉我即可

### 3. 提供 git 提交身份
告诉我你希望提交记录显示的名字和邮箱，例如：
- user.name = `你的名字`
- user.email = `you@example.com`

## 之后的自动化（Cloudflare Pages）

仓库 push 成功后，在 Cloudflare Pages 控制台：
1. Create a project → 连接 GitHub → 选择该仓库
2. 构建命令：留空（纯静态）
3. 输出目录：`/`（根目录）
4. 保存 → 首次部署 → 此后每次 `git push` 自动更新

## 本地常用命令

```bash
git add -A
git commit -m "更新内容"
git push origin main
```
