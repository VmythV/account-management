# 服务器部署

入口：**https://account-archive.service.ai-builder.world**。服务位于 `/data/service/account-archive`，由 systemd 管理，通过现有 NGINX 提供 HTTPS。首次部署于 2026-11-04，使用空 SQLite 数据库，访问密码沿用本地设置。

## 目录与运行方式

| 路径 | 用途 |
| --- | --- |
| `program/releases/<提交号>/` | 从 Git 提交导出的代码，不包含本地数据 |
| `program/app` | 指向当前运行版本的符号链接 |
| `program/runtime/` | 独立 Node.js 24.22.2，安装包 SHA-256 已对照官方清单验证 |
| `config/vault.key` | 32 字节密码加密密钥，root:account-archive，0640；与数据库分开备份 |
| `config/app.env` | 环境配置，模板见 [app.env.example](app.env.example) |
| `config/systemd/` | 应用服务和证书续期 service、timer |
| `config/nginx.conf` | 域名专用 HTTP 跳转与 HTTPS 反向代理 |
| `data/accounts.sqlite` | SQLite 数据库 |
| `data/access.json` | 访问密码的盐和哈希 |
| `logs/nginx/` | 站点日志，每日轮转，保留 10 份 |
| `backups/deployment-uploads/` | 部署包和 Node.js 安装包 |
| `backups/deploy-20261104/` | 上线前的 Homepage、证书配置和服务文档备份 |

应用以 `account-archive` 用户运行，仅监听 `127.0.0.1:23005`。数据目录为 `0700`，数据库与密码文件为 `0600`。systemd 限制应用只写入数据目录；程序和系统配置由 root 管理。

`APP_ORIGIN=https://account-archive.service.ai-builder.world`。NGINX 保留 Host / Origin，关闭代理缓存，HTTP 跳转至 HTTPS。密码哈希仅通过 SSH 传输，不写入仓库；环境配置不包含明文密码。`VAULT_KEY_PATH=/data/service/account-archive/config/vault.key`；此密钥在部署时由服务器随机生成，只允许服务组读取，不上传 Git，不与数据库一起打包。

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

## 密码与验证器部署

密码功能使用数据库版本 3；从版本 2 升级只新增 `account_secrets` 和 `vault_settings`，不导入任何密码或绑定验证器。升级后由本人在“安全设置”中绑定验证器，再按需保存账号密码。保留服务器 NTP 时间同步。

每次部署在新 release 目录执行 `npm ci --omit=dev --ignore-scripts`，按锁文件安装 OTPAuth 和二维码依赖，再以服务用户执行测试。程序目录与依赖由 root 管理、服务用户只读。

加密密钥使用系统随机数生成 32 字节文件，必须在首次启动版本 3 前配置好权限与 `VAULT_KEY_PATH`。已加密数据库不能通过重新生成密钥恢复；数据库备份与对应密钥均需保留，并在不同的受保护位置保存。服务器备份不是异地备份。

丢失或更换验证器时，仅服务器所有者执行下面的重置；操作前先停机并备份数据及对应密钥：

```sh
sudo systemctl stop account-archive
cd /data/service/account-archive/program/app
sudo -u account-archive /data/service/account-archive/program/runtime/bin/node \
  --env-file=/data/service/account-archive/config/app.env \
  scripts/reset-2fa.mjs --confirm-reset
sudo systemctl start account-archive
```

该命令保留密码密文与加密密钥，只清除验证器绑定与验证状态。重新登录并使用访问密码绑定新验证器后，仍需每次输入验证码才能查看密码。不提供恢复码、网页重置或临时免验证模式。

## 更新与回退

2026-11-06 版本增加账号库直接进入详情和账号网站。数据库从版本 1 自动升级至 2，只新增 `accounts.website` 字段，原有数据不变。回退到版本 1 程序时必须先保存升级后的数据，再恢复升级前备份；不能直接让旧程序读取版本 2 数据库。密码功能升级至版本 3 后，回退到版本 2 同样必须先保存当前数据与密钥，再恢复升级前数据库。

1. 测试通过后，用 `git archive` 导出指定提交。不要打包本地 `.env`、数据库或密码文件。
2. 上传部署包，校验 SHA-256，解压到新的 `program/releases/<提交号>/`，保留旧版本。
3. 停止应用，备份完整 `data/` 与 `config/app.env` 到仅 root 可访问的备份目录；单独备份 `config/vault.key`，不要混入数据库部署包。
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

数据备份目前手动执行：先停止应用，复制完整 `data/` 与 `config/app.env`，另行备份 `config/vault.key`，保持私有权限，再启动应用。备份应另存到服务器之外；更新前的同机备份不用于异地恢复。
