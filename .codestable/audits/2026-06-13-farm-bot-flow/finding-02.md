---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-02"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: open
---

# Finding 02：人工等待范围过宽且默认 10 分钟，非人工异常也会进入长等待

## 速答

当前代码把 `/login`、`linux.do`、`accounts.google.com`、`oauth2`、安全验证等都归入“需要人工处理”，并用全局 10 分钟等待；这不符合“只有安全认证和 Google 密码必须手动，其他异常重进/恢复”的流程要求。

## 关键证据

- `scripts/farm-bot.js:14` — `LOGIN_URL_PATTERN = /\/login|linux\.do|accounts\.google\.com|oauth2/i` 把普通登录页、LinuxDo、OAuth 都视作同一类登录状态。
- `scripts/farm-bot.js:19` — `timeoutMs` 默认是 `10 * 60 * 1000`，所有未传 timeout 的 `waitUntil()` 都会继承 10 分钟。
- `scripts/farm-bot.js:311` — `waitForManualLogin()` 用默认 timeout 等待 dashboard 或农场，不区分 Cloudflare、Google 密码页、OAuth 授权页或异常空白页。
- `scripts/farm-bot.js:399` — 只要还没进入 dashboard/farm，就通知“Cloudflare 安全验证、手工登录或授权”并进入人工等待，范围比用户允许的两类人工场景更宽。

## 影响

一旦页面停在非预期登录页、授权中间页、站点异常页或前端空白页，脚本会把它当成人工场景等待很久，而不是重新从主页/农场开始。Telegram 通知也过于泛化，用户无法判断到底是 Cloudflare、Google 密码，还是脚本没走到预期界面。

## 修复方向

把页面状态分类为：Cloudflare 安全验证、Google 密码输入、可自动点击登录/授权、已登录 dashboard、农场、未知异常。只有前两类进入人工等待并发明确 TG；其他状态采用有限重进/重试，失败后报错进入下一轮。

## 建议动作

`cs-issue`，因为这是流程控制 bug，会直接导致长等待和错误通知。
