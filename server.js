/**
 * 朋友圈 AI 助手 · 自建后端（pyq-server）
 *
 * 一个零依赖 Node 18 服务，负责三件事：
 *  1. AI 代理：智谱密钥只留在服务器，App / 网页端不接触真实 Key。
 *  2. 账号与云同步：手机号 + 密码（scrypt）注册登录，资料 / 文案 / 素材 / 记录整包存服务器。
 *  3. 每日 0 点学习：读取该用户的资料与文案样本，生成「人物画像摘要 + 写作风格规则」；
 *     并把用户数据每日备份到飞书云盘（未配置飞书则自动跳过）。
 *
 * 启动示例：
 *   ZHIPU_API_KEY=xxx PROXY_TOKEN=可选口令 AUTH_SECRET=可选密钥 \
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx FEISHU_FOLDER_TOKEN=fldcnxxx \
 *   node server.js
 */

const http = require("http");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

/* ---------- 轻量 .env 加载：配置可写进数据卷，重启即生效，无需重建容器 ----------
 * 读取顺序：$ENV_FILE > $DATA_DIR/.env > ./.env
 * 已存在的真实环境变量优先，不会被文件覆盖。
 */
(function loadEnvFile() {
  const candidates = [];
  if (process.env.ENV_FILE) candidates.push(path.resolve(process.env.ENV_FILE));
  candidates.push(path.resolve(process.env.DATA_DIR || "./data", ".env"));
  candidates.push(path.resolve(".env"));
  for (const f of candidates) {
    let raw;
    try { raw = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
    raw.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s || s.charAt(0) === "#") return;
      const i = s.indexOf("=");
      if (i < 1) return;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
          (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    });
    console.log("[env] 已加载配置：" + f);
    break;
  }
})();

const PORT = Number(process.env.PORT || 8787);
const ZHIPU_KEY = (process.env.ZHIPU_API_KEY || "").trim();
const PROXY_TOKEN = (process.env.PROXY_TOKEN || "").trim();
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const USERS_DIR = path.join(DATA_DIR, "users");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const UPSTREAM = (process.env.ZHIPU_BASE || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
const MAX_BODY = 24 * 1024 * 1024; // 24MB，够传 base64 图片做云审 / 整包同步
const TOKEN_DAYS = 365; // 云账号 token 有效期 1 年，配合前端自动续期实现"永久在线"
const TZ_OFFSET = 8 * 60 * 60 * 1000; // Asia/Shanghai（中国无夏令时）
const FEISHU_APP_ID = (process.env.FEISHU_APP_ID || "").trim();
const FEISHU_APP_SECRET = (process.env.FEISHU_APP_SECRET || "").trim();
const FEISHU_FOLDER = (process.env.FEISHU_FOLDER_TOKEN || "").trim();
const FEISHU_BASE = (process.env.FEISHU_BASE || "https://open.feishu.cn").replace(/\/+$/, "");
// auto：配置了飞书就同时作为「持久存储」（适合 Koyeb 免费版无持久卷）；off：只用本地磁盘
const REMOTE_STORE = (process.env.REMOTE_STORE || "auto").trim().toLowerCase();
const REMOTE_KEEP = Math.max(3, Number(process.env.REMOTE_KEEP || 14) || 14);

// 短信验证码：未配置短信网关时为「开发模式」，验证码直接随响应返回方便测试
const SMS_PROVIDER = (process.env.SMS_PROVIDER || "").trim().toLowerCase(); // aliyun | tencent | ""
const SMS_ACCESS_KEY = (process.env.SMS_ACCESS_KEY || "").trim();
const SMS_SECRET = (process.env.SMS_SECRET || "").trim();
const SMS_SIGN = (process.env.SMS_SIGN || "").trim();        // 短信签名
const SMS_TEMPLATE = (process.env.SMS_TEMPLATE || "").trim(); // 模板 code，如 SMS_xxx
const SMS_CODE_TTL = 5 * 60 * 1000;   // 验证码 5 分钟有效
const SMS_COOLDOWN = 60 * 1000;       // 同一手机号 60 秒冷却
// 内存验证码存储：{ account: { code, exp, lastSend } }
const smsStore = new Map();

// 邮箱验证码：零依赖 SMTP。配置 SMTP_HOST/SMTP_USER/SMTP_PASS 即可启用，
// 未配置时同样走「开发模式」，验证码随响应返回。
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465) || 465;
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const SMTP_SECURE = process.env.SMTP_SECURE
  ? /^(1|true|yes|ssl|tls|on)$/i.test(String(process.env.SMTP_SECURE).trim())
  : SMTP_PORT === 465;
const MAIL_CODE_TTL = 10 * 60 * 1000; // 邮箱验证码 10 分钟有效

// 只放行这几个模型，避免代理被拿去做别的事
const CHAT_MODELS = new Set(["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4v-flash"]);
const VIDEO_MODELS = new Set(["cogvideox-flash", "cogvideox-3"]);
const IMAGE_MODELS = new Set(["cogview-3-flash", "cogview-3"]);

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function ensureDirs() {
  [DATA_DIR, USERS_DIR, BACKUP_DIR].forEach((d) => {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  });
}

function authSecret() {
  const fromEnv = (process.env.AUTH_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  const file = path.join(DATA_DIR, "secret.txt");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s) return s;
  } catch (e) {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(file, s, { mode: 0o600 }); } catch (e) {}
  return s;
}

const AUTH_SECRET = (() => {
  ensureDirs();
  return authSecret();
})();

function hashId(id) {
  return crypto.createHash("sha256").update(String(id)).digest("hex");
}

function userFile(id) {
  return path.join(USERS_DIR, hashId(id) + ".json");
}

function atomicWrite(file, text) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readUser(id) {
  try {
    const raw = fs.readFileSync(userFile(id), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeUser(record) {
  atomicWrite(userFile(record.user.id), JSON.stringify(record, null, 2));
  queueRemote(record);
}

function listUsers() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(USERS_DIR); } catch (e) { return out; }
  names.filter((n) => n.endsWith(".json")).forEach((n) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(USERS_DIR, n), "utf8"));
      if (r && r.user && r.user.id) out.push(r);
    } catch (e) {}
  });
  return out;
}

function normAccount(v) {
  const a = String(v || "").trim();
  if (!a) return "";
  if (a.indexOf("@") >= 0) return a.toLowerCase();
  return a.replace(/\D/g, "");
}

function accountOK(a) {
  if (!a) return false;
  if (a.indexOf("@") >= 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  return /^1\d{10}$/.test(a);
}

function pwdError(p) {
  const s = String(p || "");
  if (s.length < 6) return "密码至少 6 位";
  if (s.length > 32) return "密码不超过 32 位";
  if (/\s/.test(s)) return "密码不能包含空格";
  return "";
}

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}

function scryptCheck(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const calc = crypto.scryptSync(String(password), parts[1], 64).toString("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(parts[2], "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signToken(id) {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ id: id, exp: exp }));
  const sig = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest());
  return "v1." + payload + "." + sig;
}

/* ---------------- 短信验证码 ---------------- */

function smsReady() {
  if (!(SMS_PROVIDER && SMS_ACCESS_KEY && SMS_SECRET && SMS_SIGN && SMS_TEMPLATE)) return false;
  if (SMS_PROVIDER === "tencent" && !(process.env.SMS_SDK_APPID || "").trim()) return false;
  return true;
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 阿里云短信签名（HMAC-SHA1）。零依赖实现，参考阿里云官方签名规则。
async function aliSms(phone, code) {
  const method = "GET";
  const params = {
    Action: "SendSms",
    Format: "JSON",
    Version: "2017-05-25",
    AccessKeyId: SMS_ACCESS_KEY,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomBytes(16).toString("hex"),
    RegionId: "cn-hangzhou",
    PhoneNumbers: phone,
    SignName: SMS_SIGN,
    TemplateCode: SMS_TEMPLATE,
    TemplateParam: JSON.stringify({ code: code })
  };
  const keys = Object.keys(params).sort();
  const canonical = keys.map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
  const stringToSign = method + "&%2F&" + encodeURIComponent(canonical);
  const sig = crypto.createHmac("sha1", SMS_SECRET + "&").update(stringToSign).digest("base64");
  const url = "https://dysmsapi.aliyuncs.com/?" + canonical + "&Signature=" + encodeURIComponent(sig);
  const r = await fetch(url, { method: "GET" });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch (e) {}
  if (!r.ok || (d && d.Code && d.Code !== "OK")) {
    throw new Error((d && (d.Message || d.Code)) || ("HTTP " + r.status));
  }
  return { ok: true };
}

async function sendSms(phone, code) {
  if (!smsReady()) return { ok: true, dev: true, devCode: code }; // 开发模式直接返回
  try {
    if (SMS_PROVIDER === "aliyun") return await aliSms(phone, code);
    if (SMS_PROVIDER === "tencent") return await tencentSms(phone, code);
    return { ok: true, dev: true, devCode: code };
  } catch (e) {
    console.error("[SMS] 发送失败:", e.message);
    return { ok: false, error: "短信发送失败，请稍后重试" };
  }
}

// 腾讯云短信 SendSms（TC3-HMAC-SHA256 签名，零依赖）
// 需要的环境变量：SMS_SDK_APPID（短信 SDK AppID）；SecretId/SecretKey 沿用 SMS_ACCESS_KEY/SMS_SECRET
async function tencentSms(phone, code) {
  const SDK_APPID = (process.env.SMS_SDK_APPID || "").trim();
  if (!SDK_APPID) throw new Error("未配置 SMS_SDK_APPID");
  const host = "sms.tencentcloudapi.com";
  const service = "sms";
  const action = "SendSms";
  const version = "2021-01-11";
  const region = "ap-guangzhou";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const secretId = SMS_ACCESS_KEY;
  const secretKey = SMS_SECRET;
  // +86 前缀，国内手机号直接补
  const phoneE164 = phone.startsWith("+") ? phone : "+86" + phone;
  const payload = JSON.stringify({
    SmsSdkAppId: SDK_APPID,
    SignName: SMS_SIGN,
    TemplateId: SMS_TEMPLATE,
    TemplateParamSet: [code, String(Math.floor(SMS_CODE_TTL / 60000))],
    PhoneNumberSet: [phoneE164]
  });
  // 1. 拼接规范请求串
  const canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:" + host + "\n";
  const signedHeaders = "content-type;host";
  const hashedPayload = crypto.createHash("sha256").update(payload).digest("hex");
  const canonicalRequest = "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload;
  // 2. 拼接待签名字符串
  const credentialScope = date + "/" + service + "/tc3_request";
  const hashedCanonical = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = "TC3-HMAC-SHA256\n" + timestamp + "\n" + credentialScope + "\n" + hashedCanonical;
  // 3. 计算签名
  const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const kDate = hmac("TC3" + secretKey, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, "tc3_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = "TC3-HMAC-SHA256 Credential=" + secretId + "/" + credentialScope +
    ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  const r = await fetch("https://" + host + "/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region,
      Authorization: authorization
    },
    body: payload
  });
  const d = await r.json().catch(() => null);
  const resp = d && d.Response;
  if (!r.ok || !resp || resp.Error) {
    throw new Error((resp && resp.Error && (resp.Error.Message || resp.Error.Code)) || ("HTTP " + r.status));
  }
  const status = resp.SendStatusSet && resp.SendStatusSet[0];
  if (status && status.Code !== "Ok") throw new Error(status.Message || status.Code);
  return { ok: true };
}

/* ---------------- 邮箱验证码（零依赖 SMTP） ---------------- */

function mailReady() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

// 在 socket 上挂一个「按行读取 + 按需等待」的会话器
function smtpAttach(st) {
  st.buf = "";
  st.lines = [];
  st.sock.setEncoding("utf8");
  const wake = (err) => {
    const ws = st.waiters.splice(0);
    ws.forEach((w) => (err ? w.reject(err) : null));
  };
  st.onData = (d) => {
    st.buf += d;
    let idx;
    while ((idx = st.buf.indexOf("\n")) >= 0) {
      const line = st.buf.slice(0, idx).replace(/\r$/, "");
      st.buf = st.buf.slice(idx + 1);
      if (!/^\d{3}/.test(line)) continue;
      st.lines.push(line);
      if (line.charAt(3) === "-") continue; // 多行响应，等最后一行
      const w = st.waiters.shift();
      const joined = st.lines.join("\n");
      st.lines = [];
      if (w) w.resolve(joined);
    }
  };
  st.onErr = (e) => { st.dead = true; wake(e instanceof Error ? e : new Error(String(e))); };
  st.sock.on("data", st.onData);
  st.sock.on("error", st.onErr);
  st.sock.on("close", () => st.onErr(new Error("SMTP 连接已关闭")));
  st.expect = () => new Promise((resolve, reject) => st.waiters.push({ resolve, reject }));
  st.cmd = (line) => st.sock.write(line + "\r\n");
}

function smtpDetach(st) {
  try { st.sock.removeAllListeners("data"); } catch (e) {}
  try { st.sock.removeAllListeners("error"); } catch (e) {}
  try { st.sock.removeAllListeners("close"); } catch (e) {}
}

function smtpOpen() {
  return new Promise((resolve, reject) => {
    const st = { sock: null, waiters: [], dead: false };
    st.sock = SMTP_SECURE
      ? tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST })
      : net.connect({ host: SMTP_HOST, port: SMTP_PORT });
    smtpAttach(st);
    const onReady = () => resolve(st);
    st.sock.once("error", reject);
    st.sock.once(SMTP_SECURE ? "secureConnect" : "connect", onReady);
  });
}

// 发送一封纯文本邮件：465 走隐式 TLS，587/25 自动 STARTTLS 升级
// method: "login" | "plain"。163/QQ 只认 LOGIN，Gmail 两种都行
async function smtpSendAuth(to, subject, text, method) {
  const st = await smtpOpen();
  try {
    let r = await st.expect();
    if (r.charAt(0) !== "2") throw new Error("SMTP 握手失败：" + r);

    st.cmd("EHLO pyq-assistant");
    r = await st.expect();
    if (r.charAt(0) !== "2") throw new Error("EHLO 失败：" + r);

    // 非 465 端口：服务器声明支持 STARTTLS 就升级
    if (!SMTP_SECURE && /STARTTLS/i.test(r)) {
      st.cmd("STARTTLS");
      const sr = await st.expect();
      if (sr.charAt(0) !== "2") throw new Error("STARTTLS 失败：" + sr);
      smtpDetach(st);
      const plain = st.sock;
      st.sock = tls.connect({ socket: plain, servername: SMTP_HOST });
      smtpAttach(st);
      await new Promise((res, rej) => {
        st.sock.once("secureConnect", res);
        st.sock.once("error", rej);
      });
      st.cmd("EHLO pyq-assistant");
      r = await st.expect();
      if (r.charAt(0) !== "2") throw new Error("TLS 后 EHLO 失败：" + r);
    }

    // 认证：163/QQ 只认 AUTH LOGIN；Gmail/Outlook 两种都行
    if (method !== "plain") {
      st.cmd("AUTH LOGIN");
      let ar = await st.expect();
      if (ar.charAt(0) !== "3") throw new Error("SMTP 认证失败：" + ar);
      st.cmd(Buffer.from(SMTP_USER).toString("base64"));
      ar = await st.expect();
      if (ar.charAt(0) !== "3") throw new Error("SMTP 认证失败：" + ar);
      st.cmd(Buffer.from(SMTP_PASS).toString("base64"));
      ar = await st.expect();
      if (ar.charAt(0) !== "2") throw new Error("SMTP 认证失败（授权码可能不对）：" + ar);
    } else {
      const token = Buffer.from("\0" + SMTP_USER + "\0" + SMTP_PASS).toString("base64");
      st.cmd("AUTH PLAIN " + token);
      const ar = await st.expect();
      if (ar.charAt(0) !== "2") throw new Error("SMTP 认证失败：" + ar);
    }

    st.cmd("MAIL FROM:<" + SMTP_FROM + ">");
    r = await st.expect();
    if (r.charAt(0) !== "2") throw new Error("MAIL FROM 被拒：" + r);

    st.cmd("RCPT TO:<" + to + ">");
    r = await st.expect();
    if (r.charAt(0) !== "2") throw new Error("收件地址被拒：" + r);

    st.cmd("DATA");
    r = await st.expect();
    if (r.charAt(0) !== "3") throw new Error("DATA 被拒：" + r);

    const body = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    const head = [
      "From: 朋友圈AI助手 <" + SMTP_FROM + ">",
      "To: <" + to + ">",
      "Subject: =?UTF-8?B?" + Buffer.from(subject, "utf8").toString("base64") + "?=",
      "Date: " + new Date().toUTCString(),
      "Message-ID: <" + Date.now() + "." + crypto.randomBytes(6).toString("hex") + "@pyq>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64"
    ].join("\r\n");
    st.sock.write(head + "\r\n\r\n" + body + "\r\n.\r\n");
    r = await st.expect();
    if (r.charAt(0) !== "2") throw new Error("邮件正文被拒：" + r);

    try { st.cmd("QUIT"); } catch (e) {}
    try { st.sock.end(); } catch (e) {}
    return { ok: true };
  } finally {
    if (st.dead) { try { st.sock.destroy(); } catch (e) {} }
  }
}

async function smtpSend(to, subject, text) {
  let lastErr = null;
  for (const method of ["login", "plain"]) {
    try {
      return await smtpSendAuth(to, subject, text, method);
    } catch (e) {
      lastErr = e;
      // 只有「认证类」错误才换方式重试，其它错误（收件人被拒等）直接抛出
      if (!/认证失败|authentication failed/i.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

async function sendMailCode(to, code) {
  if (!mailReady()) return { ok: true, dev: true, devCode: code };
  const minutes = Math.floor(MAIL_CODE_TTL / 60000);
  const text =
    "您好！\n\n" +
    "您正在登录「朋友圈 AI 助手」，本次验证码是：\n\n" +
    "        " + code + "\n\n" +
    "验证码 " + minutes + " 分钟内有效，请勿转发给他人。\n" +
    "如果这不是您本人的操作，请忽略本邮件。\n\n" +
    "—— 朋友圈 AI 助手\n";
  try {
    await smtpSend(to, "朋友圈 AI 助手 · 登录验证码 " + code, text);
    return { ok: true };
  } catch (e) {
    console.error("[MAIL] 发送失败:", e.message);
    return { ok: false, error: "邮件发送失败：" + e.message };
  }
}

function verifyToken(token) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = parts[1];
  const sig = parts[2];
  const expect = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest());
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let obj = null;
  try { obj = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch (e) { return null; }
  if (!obj || !obj.id || !obj.exp || obj.exp < Date.now()) return null;
  return obj;
}

// 宽限期解析：过期 7 天内的 token 仍可用于 /auth/refresh 续期，避免用户刚好掉线
const REFRESH_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
function parseTokenLenient(token) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = parts[1];
  const sig = parts[2];
  const expect = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest());
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let obj = null;
  try { obj = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch (e) { return null; }
  if (!obj || !obj.id || !obj.exp) return null;
  // 允许过期 7 天内的 token 续期
  if (obj.exp < Date.now() - REFRESH_GRACE_MS) return null;
  return obj;
}

function bearer(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

function requireUser(req) {
  const token = bearer(req);
  const info = verifyToken(token);
  if (!info) return null;
  const record = readUser(info.id);
  if (!record) return null;
  return record;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Pyq-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function send(res, code, obj, raw) {
  cors(res);
  if (raw) {
    res.writeHead(code, { "Content-Type": "application/octet-stream" });
    res.end(raw);
    return;
  }
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  const token = bearer(req);
  if (token && verifyToken(token)) return true; // 已登录云账号的用户可直接用 AI
  if (PROXY_TOKEN) {
    const header = (req.headers["x-pyq-token"] || "").trim();
    return token === PROXY_TOKEN || header === PROXY_TOKEN;
  }
  return true; // 未设置口令则开放（公网部署请务必设置）
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw new Error("JSON 格式错误"); }
}

// undici 的 fetch/Headers 要求所有 header 的 name 和 value 都是 ByteString（码点 ≤ 255）
// 任何非 ASCII 字符都会导致 "Cannot convert argument to a ByteString" 错误
// 这个函数确保 header 字典中的每个值都安全
function safeHeaders(obj) {
  const out = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") { out[k] = v; continue; }
    // 只保留 ASCII 可打印字符（码点 32-126），其他替换为空
    out[k] = v.replace(/[^\x20-\x7E]/g, "");
  }
  return out;
}

async function upstream(pathname, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  try {
    // body 如果是字符串，显式转为 UTF-8 Buffer，避免任何编码歧义
    const body = init && init.body && typeof init.body === "string"
      ? Buffer.from(init.body, "utf8")
      : (init ? init.body : undefined);
    const r = await fetch(UPSTREAM + pathname, {
      ...init,
      body: body,
      signal: ctrl.signal,
      headers: safeHeaders({
        "Content-Type": "application/json",
        Authorization: "Bearer " + ZHIPU_KEY,
        ...(init && init.headers ? init.headers : {})
      })
    });
    const text = await r.text();
    return { status: r.status, text: text };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 人物画像：从用户资料 + 文案样本归纳，禁止编造                        */
/* ------------------------------------------------------------------ */

function clipText(v, n) {
  const t = String(v || "").replace(/\r/g, "").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function buildCorpus(payload) {
  const p = payload || {};
  const u = p.user || {};
  const rows = [];
  if (u.name) rows.push("昵称：" + u.name);
  if (u.tagline) rows.push("一句话标签：" + u.tagline);
  if (Array.isArray(u.perspectives) && u.perspectives.length) rows.push("身份标签：" + u.perspectives.join("、"));
  (Array.isArray(p.profileSections) ? p.profileSections : []).forEach((s) => {
    const v = String((s && s.content) || "").trim();
    if (v) rows.push("【资料 · " + String(s.id || "") + "】\n" + clipText(v, 800));
  });
  // 日记：AI 学习用户最近的生活记录、心情与常用表达，让文案更像本人
  const diaries = (Array.isArray(p.diaries) ? p.diaries : []).slice(0, 20);
  diaries.forEach((d) => {
    if (!d || !d.content) return;
    const date = String(d.date || "").slice(0, 10);
    const mood = d.mood ? ("心情：" + d.mood + " ") : "";
    const weather = d.weather ? ("天气：" + d.weather + " ") : "";
    rows.push("【日记 " + date + "】" + (mood || weather ? ("\n" + mood + weather).trim() : "") + "\n" + clipText(String(d.content), 400));
  });
  const samples = [];
  ((p.materials && p.materials.copy) || []).forEach((m) => {
    if (m && m.text) samples.push(String(m.text).trim());
  });
  (Array.isArray(p.drafts) ? p.drafts : []).forEach((d) => {
    if (d && (d.text || d.content)) samples.push(String(d.text || d.content).trim());
  });
  (Array.isArray(p.history) ? p.history : []).slice(0, 40).forEach((h) => {
    if (h && h.text) samples.push(String(h.text).trim());
  });
  const seen = {};
  const uniq = [];
  samples.forEach((s) => {
    const t = s.trim();
    if (!t || seen[t]) return;
    seen[t] = true;
    uniq.push(clipText(t, 600));
  });
  uniq.slice(0, 25).forEach((t, i) => rows.push("【文案样本 " + (i + 1) + "】\n" + t));
  return clipText(rows.join("\n\n"), 12000);
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function buildPersona(record, force) {
  const corpus = buildCorpus(record.payload);
  if (!corpus.trim()) {
    return { ok: true, skipped: true, reason: "还没有资料或文案样本", digest: record.personaDigest || "" };
  }
  const hash = sha256(corpus);
  if (!force && record.personaHash === hash && record.personaDigest) {
    return { ok: true, skipped: true, reason: "资料没有变化", digest: record.personaDigest, hash: hash };
  }
  if (!ZHIPU_KEY) {
    return { ok: false, error: "服务器未配置 ZHIPU_API_KEY，暂时无法生成画像" };
  }
  const prompt = [
    "你是「人物画像 + 写作风格」分析器。只能依据下面提供的资料和文案样本归纳，绝对不允许推测、补全或编造任何没有出现的事实。",
    "",
    "输出必须严格是下面的结构，总字数不超过 1200 字：",
    "【事实清单】",
    "- 只写资料里明确出现的事实：身份、职业、产品/服务、客户、所在地、经历等，每行一条；资料没写的不要写。",
    "【写作风格】",
    "- 语气：",
    "- 句式：",
    "- 常用表达/口癖：",
    "- 段落与篇幅习惯：",
    "【禁止虚构】",
    "- 资料未提到的职业经历、数据、客户案例、地点、时间、他人评价、收入、承诺，一律不得写进文案。",
    "【使用规则】",
    "- 生成文案时按上面的风格写，只使用事实清单里的事实；信息不足就写得模糊克制，不要编造。",
    "",
    "以下是用户资料与真实文案样本：",
    corpus
  ].join("\n");
  const r = await upstream("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "glm-4-flash",
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: "你只做归纳，不创作，不补全不存在的信息。" },
        { role: "user", content: prompt }
      ]
    })
  }, 90000);
  if (r.status >= 400) {
    return { ok: false, error: "模型返回 HTTP " + r.status + "：" + String(r.text).slice(0, 120) };
  }
  let text = "";
  try {
    const d = JSON.parse(r.text);
    text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
  } catch (e) { text = r.text; }
  text = String(text || "").trim().slice(0, 1200);
  if (!text) return { ok: false, error: "模型没有返回内容" };
  const now = new Date().toISOString();
  record.personaDigest = text;
  record.personaHash = hash;
  record.lastLearnAt = now;
  writeUser(record);
  return { ok: true, digest: text, hash: hash, lastLearnAt: now };
}

/* ------------------------------------------------------------------ */
/* 飞书云盘备份（未配置则跳过）                                          */
/* ------------------------------------------------------------------ */

let feishuCache = { token: "", expireAt: 0 };
let restoringRemote = false;
const remoteTimers = new Map();
let lastRestore = { count: 0, at: "" };

function remoteEnabled() {
  if (REMOTE_STORE === "off") return false;
  return !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_FOLDER);
}

async function feishuToken() {
  const now = Date.now();
  if (feishuCache.token && feishuCache.expireAt - 60 * 1000 > now) return feishuCache.token;
  const res = await fetch(FEISHU_BASE + "/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: safeHeaders({ "Content-Type": "application/json" }),
    body: Buffer.from(JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }), "utf8")
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.tenant_access_token) {
    throw new Error("飞书 token 获取失败：" + ((data && (data.msg || data.code)) || res.status));
  }
  feishuCache = {
    token: data.tenant_access_token,
    expireAt: now + Number(data.expire || 7200) * 1000
  };
  return feishuCache.token;
}

async function feishuJson(pathname, init) {
  const token = await feishuToken();
  const body = init && init.body && typeof init.body === "string"
    ? Buffer.from(init.body, "utf8")
    : (init ? init.body : undefined);
  const res = await fetch(FEISHU_BASE + pathname, {
    ...init,
    body: body,
    headers: safeHeaders(Object.assign({ Authorization: "Bearer " + token }, (init && init.headers) || {}))
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error("飞书接口失败 HTTP " + res.status);
  if (data && data.code !== 0) {
    if ([99991661, 99991663, 99991668].indexOf(data.code) >= 0) feishuCache = { token: "", expireAt: 0 };
    throw new Error("飞书接口失败：" + (data.msg || data.code));
  }
  return data;
}

async function feishuUpload(name, buf) {
  const token = await feishuToken();
  const form = new FormData();
  form.append("file_name", name);
  form.append("parent_type", "explorer");
  form.append("parent_node", FEISHU_FOLDER);
  form.append("size", String(buf.length));
  form.append("file", new Blob([buf], { type: "application/json" }), name);
  const res = await fetch(FEISHU_BASE + "/open-apis/drive/v1/files/upload_all", {
    method: "POST",
    headers: safeHeaders({ Authorization: "Bearer " + token }),
    body: form
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.code !== 0) {
    if (res.status === 401 || (data && [99991661, 99991663, 99991668].indexOf(data.code) >= 0)) {
      feishuCache = { token: "", expireAt: 0 };
    }
    throw new Error("飞书上传失败：" + ((data && (data.msg || data.code)) || res.status));
  }
  return { ok: true, file: name, token: data.data && data.data.file_token };
}

async function feishuListFiles() {
  const out = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const q = "/open-apis/drive/v1/files?folder_token=" + encodeURIComponent(FEISHU_FOLDER)
      + "&page_size=200" + (page ? "&page_token=" + encodeURIComponent(page) : "");
    const data = await feishuJson(q, { method: "GET" });
    const files = (data && data.data && data.data.files) || [];
    files.forEach((f) => { if (f && f.type === "file") out.push(f); });
    if (!data || !data.data || !data.data.has_more) break;
    page = data.data.next_page_token || "";
    if (!page) break;
  }
  return out;
}

async function feishuDownload(fileToken) {
  const token = await feishuToken();
  const res = await fetch(FEISHU_BASE + "/open-apis/drive/v1/files/" + encodeURIComponent(fileToken) + "/download", {
    headers: safeHeaders({ Authorization: "Bearer " + token })
  });
  if (!res.ok) throw new Error("飞书下载失败 HTTP " + res.status);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function feishuDelete(fileToken) {
  await feishuJson("/open-apis/drive/v1/files/" + encodeURIComponent(fileToken) + "?type=file", { method: "DELETE" });
}

function remoteKey() {
  return crypto.createHash("sha256").update("pyq-remote-v1:" + AUTH_SECRET).digest();
}

// 密码哈希用 AUTH_SECRET 加密后再上传，飞书里只存密文
function encryptPwd(v) {
  if (!v) return v;
  try {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", remoteKey(), iv);
    const enc = Buffer.concat([c.update(String(v), "utf8"), c.final()]);
    return "enc:v1:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
  } catch (e) {
    return v;
  }
}

function decryptPwd(v) {
  const s = String(v || "");
  if (s.indexOf("enc:v1:") !== 0) return s;
  try {
    const raw = Buffer.from(s.slice(7), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", remoteKey(), raw.slice(0, 12));
    d.setAuthTag(raw.slice(12, 28));
    return Buffer.concat([d.update(raw.slice(28)), d.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

function safeTag(id) {
  return String(id).replace(/@/g, "_at_").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
}

function cstStamp(ms) {
  const d = new Date((ms || Date.now()) + TZ_OFFSET);
  const p = (n, w) => String(n).padStart(w || 2, "0");
  return String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-"
    + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + p(d.getUTCMilliseconds(), 3);
}

function parseRemoteName(name) {
  const m = String(name || "").match(/^(.*)-(\d{8}(?:-\d{9})?)\.json$/);
  if (!m) return null;
  return { tag: m[1], stamp: m[2].replace("-", "") };
}

async function pushRemote(record) {
  if (!remoteEnabled()) return { ok: false, skipped: true };
  const copy = Object.assign({}, record);
  copy.pwd = encryptPwd(record.pwd);
  copy.remoteAt = new Date().toISOString();
  const name = safeTag(record.user.id) + "-" + cstStamp() + ".json";
  const buf = Buffer.from(JSON.stringify(copy, null, 2));
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await feishuUpload(name, buf);
    } catch (e) {
      lastErr = (e && e.message) || String(e);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  console.log("[pyq-server] 远程存档失败 " + record.user.id + "：" + lastErr);
  return { ok: false, error: lastErr };
}

// 本地保存后防抖 3 秒推到飞书，避免频繁写盘把云盘刷爆
function queueRemote(record) {
  if (!remoteEnabled() || restoringRemote) return;
  const id = record.user.id;
  clearTimeout(remoteTimers.get(id));
  remoteTimers.set(id, setTimeout(() => {
    remoteTimers.delete(id);
    pushRemote(record).catch(() => {});
  }, 3000));
}

async function restoreFromRemote() {
  if (!remoteEnabled()) return;
  const files = await feishuListFiles();
  const groups = new Map();
  files.forEach((f) => {
    const p = parseRemoteName(f.name);
    if (!p) return;
    if (!groups.has(p.tag)) groups.set(p.tag, []);
    groups.get(p.tag).push({ file: f, stamp: p.stamp });
  });
  let count = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
    try {
      const raw = await feishuDownload(list[0].file.token || list[0].file.file_token);
      const obj = JSON.parse(raw.toString("utf8"));
      if (!obj || !obj.user || !obj.user.id) continue;
      const pwd = decryptPwd(obj.pwd);
      if (!pwd) {
        console.log("[pyq-server] 远程记录缺少可用密码，跳过：" + obj.user.id);
        continue;
      }
      const local = readUser(obj.user.id);
      const remoteAt = String(obj.updatedAt || "");
      const localAt = local ? String(local.updatedAt || "") : "";
      if (local && localAt && remoteAt && localAt >= remoteAt) continue;
      obj.pwd = pwd;
      delete obj.remoteAt;
      restoringRemote = true;
      try {
        atomicWrite(userFile(obj.user.id), JSON.stringify(obj, null, 2));
      } finally {
        restoringRemote = false;
      }
      count++;
    } catch (e) {
      console.log("[pyq-server] 远程恢复失败：" + ((e && e.message) || e));
    }
  }
  lastRestore = { count: count, at: new Date().toISOString() };
  console.log("[pyq-server] 远程恢复完成：" + count + " 个账号");
}

// 每个账号只保留最近 REMOTE_KEEP 份，避免云盘无限膨胀
async function cleanupRemote() {
  if (!remoteEnabled()) return;
  const files = await feishuListFiles();
  const groups = new Map();
  files.forEach((f) => {
    const p = parseRemoteName(f.name);
    if (!p) return;
    if (!groups.has(p.tag)) groups.set(p.tag, []);
    groups.get(p.tag).push({ file: f, stamp: p.stamp });
  });
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length <= REMOTE_KEEP) continue;
    list.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
    for (let i = REMOTE_KEEP; i < list.length; i++) {
      const t = list[i].file.token || list[i].file.file_token;
      if (!t) continue;
      try { await feishuDelete(t); removed++; } catch (e) {}
    }
  }
  if (removed) console.log("[pyq-server] 已清理旧存档 " + removed + " 份");
}

function cstDate(ms) {
  return new Date((ms || Date.now()) + TZ_OFFSET).toISOString().slice(0, 10);
}

async function runDaily(reason) {
  const started = Date.now();
  const users = listUsers();
  console.log("[pyq-server] 每日任务开始（" + cstDate(started) + "）：" + users.length + " 个用户，触发来源：" + reason);
  for (const record of users) {
    try {
      const built = await buildPersona(record, false);
      if (built.ok && !built.skipped) {
        console.log("[pyq-server] " + record.user.id + " 已更新人物画像");
      } else if (built.ok && built.skipped) {
        console.log("[pyq-server] " + record.user.id + " 画像无需更新：" + built.reason);
      } else {
        console.log("[pyq-server] " + record.user.id + " 画像生成失败：" + (built.error || "未知"));
      }
      await pushRemote(record);
    } catch (e) {
      console.log("[pyq-server] 用户任务失败：" + ((e && e.message) || e));
    }
  }
  if (remoteEnabled()) {
    try { await cleanupRemote(); } catch (e) {
      console.log("[pyq-server] 清理旧存档失败：" + ((e && e.message) || e));
    }
  }
  try {
    atomicWrite(path.join(DATA_DIR, "last-daily.txt"), String(started));
  } catch (e) {}
  console.log("[pyq-server] 每日任务结束，用时 " + Math.round((Date.now() - started) / 1000) + "s");
}

let dailyTimer = null;
let dailyRunning = false;

function scheduleDaily() {
  const now = Date.now();
  const local = now + TZ_OFFSET;
  const nextMidnight = Math.ceil((local + 1) / 86400000) * 86400000 - TZ_OFFSET;
  const delay = Math.max(60000, nextMidnight - now + 5000);
  clearTimeout(dailyTimer);
  dailyTimer = setTimeout(() => {
    if (!dailyRunning) {
      dailyRunning = true;
      runDaily("定时 00:00").finally(() => { dailyRunning = false; scheduleDaily(); });
    } else {
      scheduleDaily();
    }
  }, delay);
  console.log("[pyq-server] 下次学习任务：" + new Date(Date.now() + delay).toISOString() + "（北京时间 00:00）");
}

function catchUpDaily() {
  let last = 0;
  try { last = Number(fs.readFileSync(path.join(DATA_DIR, "last-daily.txt"), "utf8")) || 0; } catch (e) {}
  const now = Date.now();
  const todayStart = Math.floor((now + TZ_OFFSET) / 86400000) * 86400000 - TZ_OFFSET;
  if (last < todayStart) {
    setTimeout(() => {
      if (dailyRunning) return;
      dailyRunning = true;
      runDaily("启动补跑").finally(() => { dailyRunning = false; });
    }, 60000);
  }
}

/* ------------------------------------------------------------------ */
/* 审核结果解析                                                         */
/* ------------------------------------------------------------------ */

function parseModeration(txt) {
  let obj = null;
  const m = String(txt || "").match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch (e) { obj = null; } }
  const list = Array.isArray(obj && obj.violations) ? obj.violations : [];
  const violations = list.slice(0, 8).map((v) => ({
    category: String((v && v.category) || "云审违规").slice(0, 30),
    word: String((v && v.word) || "").slice(0, 30),
    reason: String((v && v.reason) || "云端审核未通过").slice(0, 120),
    suggestion: String((v && v.suggestion) || "删除相关内容后重新发布").slice(0, 80)
  }));
  return {
    ok: true,
    blocked: !!(obj && obj.blocked) || violations.length > 0,
    violations,
    provider: "zhipu"
  };
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  // 同时兼容 /chat/completions 与 /v1/chat/completions（前端一般把 base 填成 .../v1）
  let pathname = u.pathname.replace(/\/+$/, "") || "/";
  pathname = pathname.replace(/^\/v1(?=\/|$)/, "") || "/";
  const method = req.method;

  if (method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  if (pathname === "/" || pathname === "/health") {
    send(res, 200, {
      ok: true,
      service: "pyq-server",
      upstream: ZHIPU_KEY ? "zhipu" : "未配置模型 Key",
      auth: PROXY_TOKEN ? "token" : "open",
      users: listUsers().length,
      feishu: (FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_FOLDER) ? "on" : "off",
      sms: smsReady() ? SMS_PROVIDER : "dev",
      mail: mailReady() ? "on" : "dev",
      store: remoteEnabled() ? "feishu" : "local",
      restored: lastRestore,
      time: new Date().toISOString()
    });
    return;
  }

  try {
    /* ---------------- 账号 ---------------- */
    if (pathname === "/auth/register" && method === "POST") {
      const body = await readJson(req);
      const id = normAccount(body.account || body.phone);
      if (!accountOK(id)) { send(res, 400, { ok: false, error: "请输入 11 位有效手机号或邮箱" }); return; }
      const pe = pwdError(body.password);
      if (pe) { send(res, 400, { ok: false, error: pe }); return; }
      if (readUser(id)) { send(res, 409, { ok: false, error: "该账号已注册，请直接登录" }); return; }
      const now = new Date().toISOString();
      const record = {
        user: {
          id: id,
          phone: id.indexOf("@") >= 0 ? "" : id,
          name: String(body.nickname || "").trim().slice(0, 20) || ("用户" + id.slice(-4)),
          createdAt: now
        },
        pwd: scryptHash(body.password),
        payload: null,
        updatedAt: "",
        personaDigest: "",
        personaHash: "",
        lastLearnAt: "",
        createdAt: now
      };
      writeUser(record);
      send(res, 200, { ok: true, token: signToken(id), user: record.user, updatedAt: "", persona: {} });
      return;
    }

    if (pathname === "/auth/login" && method === "POST") {
      const body = await readJson(req);
      const id = normAccount(body.account || body.phone);
      const record = id ? readUser(id) : null;
      if (!record || !scryptCheck(body.password, record.pwd)) {
        send(res, 401, { ok: false, error: "账号或密码不正确" });
        return;
      }
      send(res, 200, {
        ok: true,
        token: signToken(id),
        user: record.user,
        updatedAt: record.updatedAt || "",
        persona: {
          digest: record.personaDigest || "",
          hash: record.personaHash || "",
          lastLearnAt: record.lastLearnAt || ""
        }
      });
      return;
    }

    if (pathname === "/auth/logout" && method === "POST") {
      send(res, 200, { ok: true });
      return;
    }

    // 续期：旧 token 在有效期内（或过期 7 天宽限期内）可换发新 token，实现云账号永久在线
    if (pathname === "/auth/refresh" && method === "POST") {
      const token = bearer(req);
      const info = parseTokenLenient(token);
      if (!info) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      const record = readUser(info.id);
      if (!record) { send(res, 401, { ok: false, error: "账号不存在，请重新注册" }); return; }
      const newToken = signToken(info.id);
      send(res, 200, { ok: true, token: newToken, expiresAt: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000 });
      return;
    }

    // 发送验证码：支持手机号或邮箱，账号必须已注册；未配置网关时走开发模式
    if (pathname === "/auth/send-code" && method === "POST") {
      const body = await readJson(req);
      const acc = normAccount(body.phone || body.account || body.email);
      const isMail = acc.indexOf("@") >= 0;
      if (!accountOK(acc)) { send(res, 400, { ok: false, error: "请输入有效的手机号或邮箱" }); return; }
      if (!readUser(acc)) {
        send(res, 404, { ok: false, error: isMail ? "该邮箱未注册，请先注册" : "该手机号未注册，请先注册" });
        return;
      }
      const now = Date.now();
      const cached = smsStore.get(acc);
      if (cached && now - cached.lastSend < SMS_COOLDOWN) {
        send(res, 429, { ok: false, error: "发送过于频繁，请 60 秒后再试" });
        return;
      }
      const code = genCode();
      const ttl = isMail ? MAIL_CODE_TTL : SMS_CODE_TTL;
      const r = isMail ? await sendMailCode(acc, code) : await sendSms(acc, code);
      if (!r.ok) { send(res, 502, { ok: false, error: r.error || "发送失败" }); return; }
      smsStore.set(acc, { code, exp: now + ttl, lastSend: now });
      send(res, 200, {
        ok: true,
        channel: isMail ? "email" : "sms",
        dev: !!r.dev,
        devCode: r.devCode || "",
        ttl: ttl / 1000,
        cooldown: SMS_COOLDOWN / 1000
      });
      return;
    }

    // 验证码登录：验证通过直接签发 token（手机号 / 邮箱通用）
    if (pathname === "/auth/verify-code" && method === "POST") {
      const body = await readJson(req);
      const acc = normAccount(body.phone || body.account || body.email);
      const code = String(body.code || "").replace(/\D/g, "");
      if (!accountOK(acc)) { send(res, 400, { ok: false, error: "请输入有效的手机号或邮箱" }); return; }
      if (code.length !== 6) { send(res, 400, { ok: false, error: "请输入 6 位验证码" }); return; }
      const cached = smsStore.get(acc);
      if (!cached) { send(res, 400, { ok: false, error: "请先获取验证码" }); return; }
      if (cached.exp < Date.now()) {
        smsStore.delete(acc);
        send(res, 400, { ok: false, error: "验证码已过期，请重新获取" }); return;
      }
      if (cached.code !== code) { send(res, 400, { ok: false, error: "验证码不正确" }); return; }
      const record = readUser(acc);
      if (!record) { send(res, 404, { ok: false, error: "该账号未注册" }); return; }
      smsStore.delete(acc);
      send(res, 200, {
        ok: true,
        token: signToken(acc),
        user: record.user,
        updatedAt: record.updatedAt || "",
        persona: { digest: record.personaDigest || "", hash: record.personaHash || "", lastLearnAt: record.lastLearnAt || "" }
      });
      return;
    }

    if (pathname === "/auth/me" && method === "GET") {
      const record = requireUser(req);
      if (!record) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      send(res, 200, { ok: true, user: record.user, updatedAt: record.updatedAt || "" });
      return;
    }

    /* ---------------- 云同步 ---------------- */
    if (pathname === "/sync" && method === "GET") {
      const record = requireUser(req);
      if (!record) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      send(res, 200, {
        ok: true,
        payload: record.payload || null,
        updatedAt: record.updatedAt || "",
        user: record.user,
        persona: {
          digest: record.personaDigest || "",
          hash: record.personaHash || "",
          lastLearnAt: record.lastLearnAt || ""
        }
      });
      return;
    }

    if (pathname === "/sync" && method === "PUT") {
      const record = requireUser(req);
      if (!record) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      const body = await readJson(req);
      if (!body.payload || typeof body.payload !== "object") { send(res, 400, { ok: false, error: "payload 不能为空" }); return; }
      const base = String(body.baseUpdatedAt || "");
      const serverAt = record.updatedAt || "";
      if (!body.force && serverAt && base && serverAt > base) {
        send(res, 409, {
          ok: false,
          conflict: true,
          error: "云端数据比本地新，已返回云端版本",
          payload: record.payload,
          updatedAt: serverAt,
          persona: { digest: record.personaDigest || "", hash: record.personaHash || "", lastLearnAt: record.lastLearnAt || "" }
        });
        return;
      }
      record.payload = body.payload;
      record.updatedAt = new Date().toISOString();
      writeUser(record);
      send(res, 200, { ok: true, updatedAt: record.updatedAt });
      return;
    }

    /* ---------------- 人物画像 ---------------- */
    if (pathname === "/persona" && method === "GET") {
      const record = requireUser(req);
      if (!record) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      send(res, 200, {
        ok: true,
        digest: record.personaDigest || "",
        hash: record.personaHash || "",
        lastLearnAt: record.lastLearnAt || "",
        updatedAt: record.updatedAt || ""
      });
      return;
    }

    if (pathname === "/persona/build" && method === "POST") {
      const record = requireUser(req);
      if (!record) { send(res, 401, { ok: false, error: "登录已过期，请重新登录" }); return; }
      let body = {};
      try { body = await readJson(req); } catch (e) {}
      if (body.payload && typeof body.payload === "object") {
        // 允许把刚保存的资料一起带上来，避免「保存后立刻学习」读到旧数据
        record.payload = body.payload;
        record.updatedAt = new Date().toISOString();
        writeUser(record);
      }
      const recent = record.lastLearnAt ? Date.now() - new Date(record.lastLearnAt).getTime() : Infinity;
      if (!body.force && recent < 60 * 1000) {
        send(res, 200, {
          ok: true, throttled: true, digest: record.personaDigest || "",
          lastLearnAt: record.lastLearnAt || "", msg: "刚刚学过，1 分钟内不重复调用模型"
        });
        return;
      }
      const r = await buildPersona(record, true);
      if (!r.ok) { send(res, 502, r); return; }
      pushRemote(record).catch(() => {});
      send(res, 200, r);
      return;
    }

    /* ---------------- AI 代理 ---------------- */
    if (!authorized(req)) { send(res, 401, { error: "访问令牌错误" }); return; }

    if (pathname === "/chat/completions" && method === "POST") {
      if (!ZHIPU_KEY) { send(res, 503, { error: "服务器未配置模型 Key" }); return; }
      const body = await readJson(req);
      const model = body.model || "glm-4-flash";
      if (!CHAT_MODELS.has(model)) { send(res, 400, { error: "不支持的模型：" + model }); return; }
      if (!Array.isArray(body.messages) || !body.messages.length) { send(res, 400, { error: "messages 不能为空" }); return; }
      const payload = {
        model,
        messages: body.messages,
        stream: false,
        temperature: Number(body.temperature) || 0.8,
        ...(body.max_tokens ? { max_tokens: Number(body.max_tokens) } : {})
      };
      const r = await upstream("/chat/completions", { method: "POST", body: JSON.stringify(payload) }, 60000);
      send(res, r.status, null, r.text);
      return;
    }

    if (pathname === "/videos/generations" && method === "POST") {
      if (!ZHIPU_KEY) { send(res, 503, { error: "服务器未配置模型 Key" }); return; }
      const body = await readJson(req);
      const model = body.model || "cogvideox-flash";
      if (!VIDEO_MODELS.has(model)) { send(res, 400, { error: "不支持的模型：" + model }); return; }
      if (!body.prompt) { send(res, 400, { error: "prompt 不能为空" }); return; }
      const payload = { model, prompt: String(body.prompt).slice(0, 2000) };
      const r = await upstream("/videos/generations", { method: "POST", body: JSON.stringify(payload) }, 60000);
      send(res, r.status, null, r.text);
      return;
    }

    const vm = pathname.match(/^(?:\/videos\/generations|\/async-result)\/([A-Za-z0-9_-]+)$/);
    if (vm && method === "GET") {
      const r = await upstream("/async-result/" + encodeURIComponent(vm[1]), { method: "GET" }, 30000);
      send(res, r.status, null, r.text);
      return;
    }

    if (pathname === "/images/generations" && method === "POST") {
      if (!ZHIPU_KEY) { send(res, 503, { error: "服务器未配置模型 Key" }); return; }
      const body = await readJson(req);
      const model = body.model || "cogview-3-flash";
      if (!IMAGE_MODELS.has(model)) { send(res, 400, { error: "不支持的模型：" + model }); return; }
      if (!body.prompt) { send(res, 400, { error: "prompt 不能为空" }); return; }
      const payload = { model, prompt: String(body.prompt).slice(0, 1000), size: body.size || "1024x1024" };
      const r = await upstream("/images/generations", { method: "POST", body: JSON.stringify(payload) }, 90000);
      send(res, r.status, null, r.text);
      return;
    }

    if (pathname === "/moderate" && method === "POST") {
      if (!ZHIPU_KEY) { send(res, 503, { ok: false, error: "服务器未配置模型 Key" }); return; }
      const body = await readJson(req);
      const task = body.task === "video" ? "video" : "image";
      const raw = String(body.fileBase64 || "");
      if (!raw) { send(res, 400, { ok: false, error: "缺少 fileBase64" }); return; }
      if (task === "video") {
        send(res, 200, { ok: true, blocked: false, violations: [], provider: "zhipu", note: "视频暂不支持代理云审" });
        return;
      }
      const mime = body.mimeType || "image/jpeg";
      const dataUrl = raw.indexOf("data:") === 0 ? raw : "data:" + mime + ";base64," + raw;
      const ask = "你是内容安全审核员。判断这张图片是否包含违规内容（色情、暴恐、政治敏感、违法违规、引流诈骗、辱骂攻击）。"
        + '只输出 JSON：{"blocked":true|false,"violations":[{"category":"","word":"","reason":"","suggestion":""}]}；'
        + "没有违规时 violations 为空数组，不要输出多余文字。";
      const payload = {
        model: "glm-4v-flash",
        stream: false,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: ask }] }]
      };
      const r = await upstream("/chat/completions", { method: "POST", body: JSON.stringify(payload) }, 90000);
      if (r.status >= 400) { send(res, r.status, { ok: false, error: String(r.text).slice(0, 160) }); return; }
      let txt = "";
      try {
        const d = JSON.parse(r.text);
        txt = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
      } catch (e) { txt = r.text; }
      send(res, 200, parseModeration(txt));
      return;
    }

    /* ---------------- 运维：手动触发每日任务 ---------------- */
    if (pathname === "/admin/daily" && method === "POST") {
      const admin = (process.env.ADMIN_TOKEN || "").trim();
      const given = (req.headers["x-admin-token"] || "").trim();
      if (!admin || given !== admin) { send(res, 403, { ok: false, error: "无权限" }); return; }
      if (dailyRunning) { send(res, 200, { ok: true, running: true }); return; }
      dailyRunning = true;
      runDaily("手动触发").finally(() => { dailyRunning = false; });
      send(res, 202, { ok: true, accepted: true });
      return;
    }

    send(res, 404, { error: "接口不存在：" + pathname });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    const code = msg === "body too large" ? 413 : msg === "JSON 格式错误" ? 400 : 502;
    const stack = (e && e.stack) ? e.stack.split("\n").slice(0, 4).join("\n") : "";
    console.error("[ERROR]", new Date().toISOString(), msg, "\n", stack);
    send(res, code, {
      error: code === 413 ? "请求体过大（上限 24MB）" : "服务处理失败：" + msg,
      _stack: stack
    });
  }
});

async function boot() {
  // Koyeb 免费实例重建后本地磁盘会清空，所以启动时先从飞书恢复账号
  if (remoteEnabled()) {
    try {
      await Promise.race([
        restoreFromRemote(),
        new Promise((r) => setTimeout(r, 15000))
      ]);
    } catch (e) {
      console.log("[pyq-server] 远程恢复失败（继续用本地数据启动）：" + ((e && e.message) || e));
    }
  }
  server.listen(PORT, process.env.HOST || "0.0.0.0", () => {
    console.log("[pyq-server] listening on :" + PORT);
    console.log("[pyq-server] 数据目录：" + DATA_DIR);
    console.log("[pyq-server] 模型：" + (ZHIPU_KEY ? "已配置" : "未配置（AI 接口会返回 503）"));
    console.log("[pyq-server] 持久存储：" + (remoteEnabled() ? "飞书云盘（本地磁盘仅作缓存）" : "本地磁盘（无持久卷时重启会丢数据）"));
    scheduleDaily();
    catchUpDaily();
  });
}

boot();
