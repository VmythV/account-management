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

当前数据库版本为 4；从版本 3 升级仅新增 `passkey_credentials` 公钥表，保留原有密码密文、验证器绑定及所有账号数据。版本 3 的密码功能从版本 2 升级时只新增 `account_secrets` 和 `vault_settings`，不导入任何密码或绑定验证器。升级后由本人在“安全设置”中绑定验证器，再按需保存账号密码。保留服务器 NTP 时间同步。

每次部署在新 release 目录执行 `npm ci --omit=dev --ignore-scripts`，按锁文件安装 OTPAuth、二维码和 SimpleWebAuthn 依赖，再以服务用户执行测试。程序目录与依赖由 root 管理、服务用户只读。

加密密钥使用系统随机数生成 32 字节文件，必须在首次启动版本 3 前配置好权限与 `VAULT_KEY_PATH`。已加密数据库不能通过重新生成密钥恢复；数据库备份与对应密钥均需保留，并在不同的受保护位置保存。服务器备份不是异地备份。

## 通行密钥与 Touch ID

在正式 HTTPS 域名的“安全设置”中，先绑定验证器，再使用访问密码和 2FA 绑定通行密钥。每次查看密码优先 Touch ID / 系统验证，并提供 2FA 入口。系统可能允许设备密码或同步通行密钥，网站无法限制为纯指纹。本站仅保存公钥；不保存指纹。

RP ID 取 `APP_ORIGIN` 的精确主机名，Origin 必须与其完全一致，无额外环境变量。浏览器脚本从安装依赖的本地文件提供。若迁移域名，需要在新域名用访问密码 + 2FA 移除旧绑定并重新绑定。

如果 Mac 丢失但验证器还在，可在网页“安全设置 → 移除通行密钥”用访问密码 + 2FA 撤销；之后使用 2FA 查看密码，或绑定新的通行密钥。如果验证器也丢失，按下方 C 重置，会同时撤销通行密钥。移除本站绑定不会删除 Apple 密码 App 中的旧条目，可随后手动清理。

## 服务器密码恢复与 2FA 重置

本节只供服务器所有者在需要恢复时执行。先区分以下情况，避免重置错误的内容：

| 遇到的问题 | 使用的步骤 | 结果 |
| --- | --- | --- |
| 忘记登录管理工具的访问密码 | B：设置新的访问密码 | 仅替换 `data/access.json`，账号数据、已保存密码、验证器绑定不变 |
| 验证器丢失或需要换手机 | C：重置 2FA | 原验证器和通行密钥同时失效，重新绑定后才能查看账号密码 |
| 无法启动，提示加密密钥丢失或不匹配 | D：恢复原加密密钥 | 必须找回与数据库匹配的原密钥，不能生成新密钥代替 |
| 只是不记得某个网站的账号密码 | 正常登录后在账号详情点击“验证后查看” | 完成系统验证或输入 2FA 验证码查看之前保存的密码；本工具不能重置外部网站密码 |

如果访问密码和验证器同时丢失，先做 B，再做 C，最后统一执行 E。访问密码只保存哈希，无法还原旧密码，只能设置新密码。没有提供恢复码或网页免验证入口。

### A. 登录服务器、停止服务并备份

在自己的电脑打开交互式终端，连接服务器：

```sh
ssh -t -F ~/.ssh/server.conf -l temp20261009 server-01
```

以下命令在服务器执行。备份包含完整数据库、访问密码哈希和环境配置；加密密钥另存至仅 root 可读的 `backups/keys/`。记下输出的备份路径，后续回退要用。

```sh
sudo bash -s <<'SH'
set -eu
umask 077
systemctl stop account-archive
archive_backup=$(mktemp -d /data/service/account-archive/backups/recovery-$(date +%Y%m%d-%H%M%S)-XXXXXX)
cp -a /data/service/account-archive/data "$archive_backup/data"
cp -a /data/service/account-archive/config/app.env "$archive_backup/app.env"
if test -f /data/service/account-archive/config/vault.key; then
  install -d -o root -g root -m 700 /data/service/account-archive/backups/keys
  archive_key_copy="/data/service/account-archive/backups/keys/$(basename "$archive_backup").key"
  install -o root -g root -m 600 /data/service/account-archive/config/vault.key "$archive_key_copy"
  printf '密钥单独备份：%s\n' "$archive_key_copy"
else
  printf '当前密钥文件缺失，请按 D 恢复原密钥。\n'
fi
printf '数据与配置备份：%s\n' "$archive_backup"
SH
```

此时服务保持停止，继续对应的恢复步骤。任何命令失败时先检查错误，不要继续覆盖文件。不要删除数据库或重新生成 `vault.key`。

### B. 忘记管理工具访问密码：设置新密码

完成 A 后，在同一个交互式 SSH 终端执行下面的整段命令。程序会提示输入两次新密码，输入不回显；密码需为 12–256 个字符。不要把密码填写在命令参数、环境变量、聊天消息或脚本文件中。

此操作复用项目的 scrypt 密码哈希实现：先生成新的临时哈希文件，成功后原子替换 `data/access.json`。新密码无效或生成失败时，旧文件保持不变。不需要关闭 HTTPS 或开放初始化接口。

```sh
cd /data/service/account-archive/program/app
sudo -u account-archive python3 - <<'PY'
import getpass
import subprocess
import warnings

warnings.simplefilter('error', getpass.GetPassWarning)
archive_password = getpass.getpass('新的管理工具访问密码：')
archive_confirm = getpass.getpass('再次输入新密码：')
if archive_password != archive_confirm:
    raise SystemExit('两次输入不一致，未修改密码。')
archive_reset_code = r'''
import { readFileSync, mkdtempSync, renameSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createAuth } from './lib/auth.mjs';
const authPath='/data/service/account-archive/data/access.json';
const temporary=mkdtempSync(join(dirname(authPath),'.access-reset-'));
try {
  const next=join(temporary,'access.json');
  await createAuth(next,readFileSync(0,'utf8'));
  const fd=openSync(next,'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(next,authPath);
  console.log('新的访问密码已保存；请继续执行 E 启动服务。');
} finally {
  rmSync(temporary,{recursive:true,force:true});
}
'''
subprocess.run(
    ['/data/service/account-archive/program/runtime/bin/node',
     '--input-type=module', '-e', archive_reset_code],
    input=archive_password.encode('utf-8'), check=True)
PY
```

正常完成后执行 E，并用新密码登录。原有 2FA 和通行密钥仍然有效；查看账号密码仍需逐次验证。若需要撤销此次访问密码重置，停机后把 A 中备份的 `data/access.json` 恢复到 `/data/service/account-archive/data/access.json`，设置为 `account-archive:account-archive`、`0600`，再执行 E；其他数据无需回退。

### C. 验证器丢失：重置 2FA 后重新绑定

完成 A 后执行：

```sh
cd /data/service/account-archive/program/app
sudo -u account-archive /data/service/account-archive/program/runtime/bin/node \
  --env-file=/data/service/account-archive/config/app.env \
  scripts/reset-2fa.mjs --confirm-reset
```

这个命令清除验证器、通行密钥绑定及验证状态，保留已保存的密码密文与加密密钥。随后执行 E，使用管理工具访问密码登录，在“安全设置 → 绑定验证器”扫描新二维码并输入验证码确认。

绑定成功后，等待验证器生成下一个验证码，再在账号详情点击“验证后查看”。绑定时使用的验证码已经消耗，不能立即重复使用。重置会同时撤销已有通行密钥，不会直接显示密码，也不会解除每次查看都需要验证的要求。重新绑定验证器后，可再绑定通行密钥。

### D. 加密密钥丢失或损坏：恢复原密钥

先完成 A，保留当前数据及仍存在的密钥文件。已确认的首次上线密钥备份为：

`/data/service/account-archive/backups/keys/vault-20261106-121330-8bcb3aa.key`

在密钥从未更换、数据库仍属于本部署的前提下，可恢复该备份；如果后来迁移或更换过密钥，必须选择与当前数据库匹配的备份，不要盲目覆盖。

```sh
sudo install -o root -g account-archive -m 640 \
  /data/service/account-archive/backups/keys/vault-20261106-121330-8bcb3aa.key \
  /data/service/account-archive/config/vault.key
```

然后执行 E。程序启动时会检查密钥是否匹配；若提示校验失败，保持服务停止，检查备份配对。不要修改数据库中的密钥校验值，不要删除加密表来绕过错误。

**如果原密钥及其所有备份都丢失，已保存的账号密码和验证器密钥无法解密，重置访问密码或 2FA 也无法恢复它们。** 没有保存过的密码，本工具同样无法恢复；只能去对应网站按其流程重置，再重新记录。恢复旧数据库备份会回退备份之后的数据，不能当作普通密码重置使用。

### E. 恢复服务并检查

```sh
sudo systemctl start account-archive
sudo systemctl is-active account-archive
curl -fsS https://account-archive.service.ai-builder.world/api/session
```

正常应看到服务状态 `active`，接口返回 `{"initialized":true,"authenticated":false}`。这只表示服务和初始化状态正常，仍需在浏览器实际登录、绑定或验证查看密码。

若启动失败，先停止自动重试，再检查日志：

```sh
sudo systemctl stop account-archive
sudo journalctl -u account-archive -n 50 --no-pager
```

常见问题：`access.json` 应为 `account-archive:account-archive`、`0600`；`vault.key` 应为 `root:account-archive`、`0640`，且内容必须是原来的 32 字节密钥；验证码连续失败时检查手机与服务器时间，限流后需等待 15 分钟。不要为了恢复而关闭 HTTPS 或取消验证码校验。

重启会清除旧登录会话。服务器本机备份不等于异地备份，应把数据备份与对应密钥分别存入受保护的异地位置。

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

## 从旧订阅管理迁移与回退

一次性导入工具为 `program/app/scripts/import-subscriptions.mjs`。来源库为 `/data/service/ai-subscription-records/data/subscriptions.sqlite`，目标库为本项目的 `data/accounts.sqlite`。使用本项目 Node.js 运行环境；系统 Python SQLite 版本过旧，不能用于读取 STRICT 表。

执行前将审核的计划、演练快照及报告保存在本项目 `backups/import-<日期>/`，目录权限 `0700`、文件 `0600`，仅服务器所有者访问。计划与报告不得上传公开仓库。先在数据库副本执行并验证全部历史、状态、续费规则和累计时长；之后停止 `ai-subscription-records` 与 `account-archive`，完整复制两个服务的数据目录及配置，单独备份目标加密密钥，核对计划摘要后执行：

```sh
sudo /data/service/account-archive/program/runtime/bin/node \
  /data/service/account-archive/program/app/scripts/import-subscriptions.mjs \
  /data/service/ai-subscription-records/data/subscriptions.sqlite \
  /data/service/account-archive/data/accounts.sqlite \
  '/data/service/account-archive/backups/import-<日期>/plan.json' \
  '/data/service/account-archive/backups/import-<日期>/result.json' --apply
```

替换示例中的 `<日期>` 为实际批次目录。脚本不会自动停止服务。报告包含旧订阅、新账号、目标订阅及节点 ID 映射。目标已有账号字段保留，标签追加时版本号递增；合并订阅时仅追加历史并递增版本号。重跑相同计划不会重复导入；报告使用另一个新文件名。来源数据或已导入数据变化时须重新核对，不能强行覆盖。

**回退**：停止 `account-archive`，先备份当前目标 `data/`，再恢复本次迁移前冷备份的完整目标 `data/`，保持 `account-archive:account-archive` 属主、目录 `0700`、文件 `0600`；程序或配置若随批次切换，恢复批次记录中的原 release 链接及配置，再启动并检查 `/api/session` 和数据。来源数据库未被修改，无需回退。原密钥保持原样，禁止生成新密钥替代。回退整个数据库会撤销迁移之后的新增或修改，执行前需核对时间范围。

迁移后两个服务不会自动同步。旧服务保留作核对，后续日常记录使用账号档案；是否下线旧服务另行决定。每次实际执行的备份路径、版本和验收结果追加在服务器项目根目录的 README 中。
