# 服务器部署

入口：**https://account-archive.service.ai-builder.world**。服务位于 `/data/service/account-archive`，由 systemd 管理，通过现有 NGINX 提供 HTTPS。首次部署于 2026-11-04，使用空 SQLite 数据库，访问密码沿用本地设置。

## 目录与运行方式

| 路径 | 用途 |
| --- | --- |
| `program/releases/<提交号>/` | 从 Git 提交导出的代码，不包含本地数据 |
| `program/app` | 指向当前运行版本的符号链接 |
| `program/runtime/` | 独立 Node.js 24.22.2，安装包 SHA-256 已对照官方清单验证 |
| `config/app.env` | 环境配置，模板见 [app.env.example](app.env.example) |
| `config/systemd/` | 应用服务和证书续期 service、timer |
| `config/nginx.conf` | 域名专用 HTTP 跳转与 HTTPS 反向代理 |
| `data/accounts.sqlite` | SQLite 数据库 |
| `data/access.json` | 访问密码的盐和哈希 |
| `logs/nginx/` | 站点日志，每日轮转，保留 10 份 |
| `backups/deployment-uploads/` | 部署包和 Node.js 安装包 |
| `backups/deploy-20261104/` | 上线前的 Homepage、证书配置和服务文档备份 |

应用以 `account-archive` 用户运行，仅监听 `127.0.0.1:23005`。数据目录为 `0700`，数据库与密码文件为 `0600`。systemd 限制应用只写入数据目录；程序和系统配置由 root 管理。

`APP_ORIGIN=https://account-archive.service.ai-builder.world`。NGINX 保留 Host / Origin，关闭代理缓存，HTTP 跳转至 HTTPS。密码哈希仅通过 SSH 传输，不写入仓库；配置文件不包含明文密码。

[应用服务](systemd/account-archive.service)链接到 `/etc/systemd/system/account-archive.service`，开机启动，异常退出自动重启。运行日志由 journald 收集。

## 独立 HTTPS 与自动续期

证书只包含 `account-archive.service.ai-builder.world`，与其他站点证书独立，使用服务器已有 Certbot 和 ACME 账户。

- 证书目录：`/data/service/certbot/config/domains/live/account-archive.service.ai-builder.world/`。
- HTTP-01 验证目录：`/data/service/certbot/data/webroot/`。
- 定时器：`account-archive-cert-renew.timer`，每天北京时间 04:20、16:20 后随机延迟 0–10 分钟检查。
- Certbot 判断是否需要续期；成功后先执行 `nginx -t`，通过后重载 NGINX。
- 定时器开机启动，`Persistent=true` 会补执行停机期间错过的任务。

首次申请证书前，只为新域名启用 HTTP 验证路径，其他路径暂时返回 503；证书签发后再启用完整 [nginx.conf](nginx.conf)。不要将新域名加入其他服务的证书，也不要手工编辑 Certbot 的 renewal 配置。

```sh
sudo systemctl status account-archive
sudo systemctl list-timers --all account-archive-cert-renew.timer
sudo journalctl -u account-archive -n 50 --no-pager
sudo journalctl -u account-archive-cert-renew -n 50 --no-pager
```

续期模拟验证（不替换正式证书）：

```sh
sudo /data/service/certbot/program/bin/certbot renew \
  --cert-name account-archive.service.ai-builder.world \
  --config-dir /data/service/certbot/config/domains \
  --work-dir /data/service/certbot/data/work-domains \
  --logs-dir /data/service/certbot/logs/domains \
  --dry-run --run-deploy-hooks --no-random-sleep-on-renew --non-interactive
```

2026-11-04 验证：正式证书签发成功，常规定时检查 `Result=success`；续期模拟在连接 Let's Encrypt staging 接口时遇到 TLS 连接重置、超时，尚未通过。正式续期配置仍使用 `https://acme-v02.api.letsencrypt.org/directory`，待 staging 接口可达后补跑以上模拟命令。

## 更新与回退

2026-11-06 版本增加账号库直接编辑和账号网站。数据库从版本 1 自动升级至 2，只新增 `accounts.website` 字段，原有数据不变。回退到版本 1 程序时必须先保存升级后的数据，再恢复升级前备份；不能直接让旧程序读取版本 2 数据库。

1. 测试通过后，用 `git archive` 导出指定提交。不要打包本地 `.env`、数据库或密码文件。
2. 上传部署包，校验 SHA-256，解压到新的 `program/releases/<提交号>/`，保留旧版本。
3. 停止应用，备份完整 `data/` 与 `config/app.env` 到仅 root 可访问的备份目录。
4. 将 `program/app` 切换到新版本，启动服务，检查本机和 HTTPS 入口。升级代码不替换运行时数据。
5. 若检查失败，停止应用，将链接切回旧版本后启动。数据库结构若有变更，先保留当前数据，再按版本迁移说明恢复，不能直接覆盖新增数据。

```sh
sudo systemctl restart account-archive
curl -fsS -H 'Host: account-archive.service.ai-builder.world' http://127.0.0.1:23005/api/session
curl -fsS https://account-archive.service.ai-builder.world/api/session
```

修改服务文件后执行 `systemctl daemon-reload`；修改 NGINX 后先 `nginx -t`，再 `systemctl reload nginx`。重启应用会使已有会话失效，需要重新登录。

## Homepage 与数据

https://ai-builder.world 的“常用服务”中添加“账号档案”，与订阅记录、健康管理并列，包含简体、繁体和英文文案。实际文件为 `/data/service/homepage/program/index.html`，更新前备份并检查脚本语法，再原子替换；该页面不属于本仓库。

首次部署不迁移原订阅项目或本地账号数据。上线验收包含 SQLite 完整性和空库检查、访问密码哈希一致性、未登录保护、HTTPS 跳转、证书域名、定时任务与续期模拟。

数据备份目前手动执行：先停止应用，复制完整 `data/` 与 `config/app.env`，保持私有权限，再启动应用。备份应另存到服务器之外；更新前的同机备份不用于异地恢复。
