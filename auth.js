/* 账号 + 会员系统
 * - 未登录：全屏遮罩，必须先注册 / 登录才能使用
 * - 登录方式：密码登录 / 短信验证码登录 / 手机号注册
 * - 密码：数字、字母、符号自由组合，实时显示安全强度
 * - 会员：注册起免费试用 7 天；到期后全屏弹窗选择档位扫码付费，凭激活码开通
 */
(function () {
  const B = window.AndroidBridge;
  const isNative = !!(B && typeof B.isNative === "function");
  const DAY = 24 * 60 * 60 * 1000;
  const WX_ID = "zhiyao0a1";
  // 开发者密码：与对外公开的微信号分开，避免用户自行生成激活码
  const DEV_PWD = "PYQ-DEV-2026";

  const TIERS = [
    { tier: 1, name: "月度会员", price: 19.9, days: 30, tag: "灵活体验" },
    { tier: 2, name: "季度会员", price: 39.9, days: 90, tag: "90 天畅用" },
    { tier: 3, name: "半年会员", price: 59.9, days: 180, tag: "半年省心" },
    { tier: 4, name: "年度会员", price: 99.9, days: 365, tag: "最划算" }
  ];

  let seq = 0;
  const waiters = {};

  function resolveCallback(id, payload) {
    const fn = waiters[id];
    if (!fn) return;
    delete waiters[id];
    let data = payload;
    if (typeof payload === "string") {
      try { data = JSON.parse(payload); } catch (e) { data = { ok: false, error: "原生返回解析失败" }; }
    }
    fn(data || { ok: false, error: "未知错误" });
  }

  /* 原生回调统一分发：先匹配账号模块的 waiter，未命中再交给 native-app 的上传/同步回调 */
  (function bindNativeCallback() {
    const app = window.NativeApp;
    if (!app) return;
    const prev = typeof app.__cb === "function" ? app.__cb : null;
    app.__cb = function (id, payload) {
      if (waiters[id]) { resolveCallback(id, payload); return; }
      if (prev) prev(id, payload);
    };
  })();

  function call(method, args) {
    return new Promise((resolve) => {
      const cid = "a" + (++seq);
      waiters[cid] = resolve;
      const a = args || [];
      try {
        if (method === "authGetMe") B.authGetMe(cid);
        else if (method === "authLogin") B.authLogin(a[0], a[1], cid);
        else if (method === "authRegister") B.authRegister(a[0], a[1], a[2], cid);
        else if (method === "authChangeName") B.authChangeName(a[0], cid);
        else if (method === "authChangePassword") B.authChangePassword(a[0], a[1], cid);
        else if (method === "authLogout") B.authLogout(cid);
        else if (method === "authSendCode") B.authSendCode(a[0], cid);
        else if (method === "authVerifyCode") B.authVerifyCode(a[0], a[1], cid);
        else if (method === "authMember") B.authMember(cid);
        else if (method === "authPurchase") B.authPurchase(a[0], cid);
        else if (method === "authActivate") B.authActivate(a[0], cid);
        else if (method === "authGenCode") B.authGenCode(a[0], a[1], a[2], cid);
        else { delete waiters[cid]; resolve({ ok: false, error: "未知原生方法：" + method }); }
      } catch (e) {
        delete waiters[cid];
        resolve({ ok: false, error: "原生调用失败" });
      }
    });
  }

  /* ---------------- Web 预览：localStorage 模拟 ---------------- */

  const FAKE_KEY = "pyq_fake_accounts";
  const FAKE_SESSION = "pyq_fake_session";

  function fakeAccounts() {
    try { return JSON.parse(localStorage.getItem(FAKE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function fakeSave(acc) { localStorage.setItem(FAKE_KEY, JSON.stringify(acc)); }
  function fakeSha(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  function normPhone(p) { return String(p || "").replace(/\D/g, ""); }
  function phoneOK(p) { return /^1\d{10}$/.test(p); }
  // 账号：手机号或邮箱。含 @ 视为邮箱（转小写、去空格），否则按手机号处理
  function normAccount(v) {
    const s = String(v || "").trim();
    return s.indexOf("@") >= 0 ? s.toLowerCase() : s.replace(/\D/g, "");
  }
  function accountOK(a) {
    if (!a) return false;
    if (a.indexOf("@") >= 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
    return /^1\d{10}$/.test(a);
  }
  function isEmail(a) { return String(a || "").indexOf("@") >= 0; }
  function maskAccount(a) {
    if (isEmail(a)) {
      const i = a.indexOf("@");
      const name = a.slice(0, i);
      const head = name.slice(0, Math.min(2, name.length));
      return head + "***" + a.slice(i);
    }
    return a.slice(0, 3) + "****" + a.slice(7);
  }
  function pwdOK(p) { return !!p && p.length >= 6 && p.length <= 32 && !/\s/.test(p); }
  function pwdError(p) {
    if (!p) return "请设置登录密码";
    if (p.length < 6) return "密码至少 6 位";
    if (p.length > 32) return "密码不超过 32 位";
    if (/\s/.test(p)) return "密码不能包含空格";
    return null;
  }

  function fakeMember(acc) {
    const now = Date.now();
    const trialEnd = (acc.trialStart || now) + 7 * DAY;
    const tier = acc.tier || 0;
    const expires = acc.expires || 0;
    const paid = tier >= 1 && (expires > now || expires === 0);
    const trial = trialEnd > now;
    let daysLeft = 0;
    if (tier === 4 && !expires) daysLeft = -1;
    else if (paid) daysLeft = Math.ceil((expires - now) / DAY);
    else if (trial) daysLeft = Math.ceil((trialEnd - now) / DAY);
    return {
      status: paid ? "active" : trial ? "trial" : "expired",
      active: paid || trial,
      tier: tier,
      tierName: (TIERS.find((t) => t.tier === tier) || {}).name || (tier === 0 ? "免费试用" : ""),
      price: (TIERS.find((t) => t.tier === tier) || {}).price || "",
      expiresAt: expires,
      trialEndsAt: trialEnd,
      daysLeft: daysLeft,
      pendingTier: acc.pending || 0,
      pendingTierName: (TIERS.find((t) => t.tier === (acc.pending || 0)) || {}).name || "",
      trialDays: 7
    };
  }

  function nickError(n) {
    const s = String(n || "").trim();
    if (!s) return "请填写昵称";
    if ([...s].length > 20) return "昵称最多 20 个字";
    return null;
  }

  function fakeMe(phone, acc) {
    return {
      phone: phone,
      name: acc.name || "",
      masked: maskAccount(phone),
      member: fakeMember(acc)
    };
  }

  /* ---------------- 对外 API ---------------- */

  async function getMe() {
    if (isNative) {
      const r = await call("authGetMe", []);
      return r && r.ok && r.loggedIn ? (r.me || null) : null;
    }
    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts()[phone];
    return phone && acc ? fakeMe(phone, acc) : null;
  }

  /* ---------------- 云端账号兜底：同一手机号在任意版本都能登录 ---------------- */

  function cloudReady() {
    return !!(window.Cloud && Cloud.configured());
  }

  // 登录/注册成功后，自动用同一账号登录云端，让资料跟随账号（后台异步，不阻塞主流程）
  // 云端没有该账号时自动创建，确保任何时期注册的用户都能无缝上云
  async function autoCloudSync(phone, password) {
    if (!cloudReady() || (window.Cloud && Cloud.hasSession && Cloud.hasSession())) return;
    try {
      const r = await Cloud.signIn(phone, password);
      if (r && r.ok) {
        try { await Cloud.reconcile(false); } catch (e) {}
        if (window.App && App.render) App.render(true);
        return;
      }
      // 云端没有该账号（老用户 / 之前 server 未配置），自动创建并上传本地资料
      const msg = (r && (r.error || r.msg)) || "";
      if (/不存在|未注册|not found|no user/i.test(msg) || !r) {
        const nickname = (window.Core && Core.store && Core.store.user && Core.store.user.name) || ("用户" + phone.slice(-4));
        const sr = await Cloud.signUp(phone, password, nickname);
        if (sr && sr.ok) {
          await Cloud.push(true);
          if (window.App && App.render) App.render(true);
        }
      }
    } catch (e) { /* 云同步失败不影响本地登录 */ }
  }

  // 本地没有该账号（或密码不一致）时，用云端账号验证身份并自动补建本地账号
  async function cloudSignInFallback(phone, password) {
    if (!cloudReady() || Cloud.hasSession()) return null;
    let r;
    try { r = await Cloud.signIn(phone, password); } catch (e) { return null; }
    if (!r || !r.ok) return null;
    // 先拉取云端资料再返回，保证换设备登录时资料已经恢复
    try { await Cloud.init(); } catch (e) {}
    if (window.App && App.render) App.render(true);
    return { name: (r.user && r.user.name) || ("用户" + phone.slice(-4)) };
  }

  // 注册时同步创建云端账号，让其他版本可以用同一账号登录
  async function cloudSignUpQuiet(phone, nickname, password) {
    if (!cloudReady() || Cloud.hasSession()) return;
    try {
      const r = await Cloud.signUp(phone, password, nickname);
      if (r && r.ok) await Cloud.push(true);
    } catch (e) {}
  }

  async function login(phone, password) {
    phone = normAccount(phone);
    if (!accountOK(phone)) return { ok: false, error: "请输入有效的手机号或邮箱" };
    const e = pwdError(password);
    if (e) return { ok: false, error: e };
    if (isNative) {
      const r = await call("authLogin", [phone, password]);
      if (r && r.ok) { autoCloudSync(phone, password); return r; }
      const cl = await cloudSignInFallback(phone, password);
      if (cl) {
        const reg = await call("authRegister", [phone, cl.name, password]);
        if (reg && reg.ok) { autoCloudSync(phone, password); return call("authLogin", [phone, password]); }
      }
      return r;
    }

    const acc = fakeAccounts();
    if (!acc[phone] || acc[phone].hash !== fakeSha(password)) {
      const cl = await cloudSignInFallback(phone, password);
      if (cl) {
        acc[phone] = acc[phone] || { name: cl.name, trialStart: Date.now(), tier: 0, expires: 0, pending: 0 };
        acc[phone].hash = fakeSha(password);
        fakeSave(acc);
        localStorage.setItem(FAKE_SESSION, phone);
        autoCloudSync(phone, password);
        return { ok: true, me: fakeMe(phone, acc[phone]), cloud: true, msg: "已通过云端账号登录" };
      }
      if (!acc[phone]) return { ok: false, error: "该账号未注册，请先注册" };
      return { ok: false, error: "密码错误" };
    }
    localStorage.setItem(FAKE_SESSION, phone);
    autoCloudSync(phone, password);
    return { ok: true, me: fakeMe(phone, acc[phone]) };
  }

  async function register(phone, nickname, password) {
    phone = normAccount(phone);
    nickname = String(nickname || "").trim();
    if (!accountOK(phone)) return { ok: false, error: "请输入有效的手机号或邮箱" };
    const ne = nickError(nickname);
    if (ne) return { ok: false, error: ne };
    const e = pwdError(password);
    if (e) return { ok: false, error: e };
    if (isNative) {
      const r = await call("authRegister", [phone, nickname, password]);
      if (r && r.ok) await cloudSignUpQuiet(phone, nickname, password);
      return r;
    }

    const acc = fakeAccounts();
    if (acc[phone]) return { ok: false, error: "该账号已注册，请直接登录" };
    acc[phone] = { name: nickname, hash: fakeSha(password), trialStart: Date.now(), tier: 0, expires: 0, pending: 0 };
    fakeSave(acc);
    localStorage.setItem(FAKE_SESSION, phone);
    await cloudSignUpQuiet(phone, nickname, password);
    return { ok: true, me: fakeMe(phone, acc[phone]), msg: "注册成功，免费试用 7 天已开启" };
  }

  async function changeName(name) {
    const e = nickError(name);
    if (e) return { ok: false, error: e };
    name = String(name).trim();
    if (isNative) return call("authChangeName", [name]);

    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts();
    if (!phone || !acc[phone]) return { ok: false, error: "未登录" };
    acc[phone].name = name;
    fakeSave(acc);
    return { ok: true, name: name };
  }

  async function changePassword(oldPwd, newPwd) {
    const e = pwdError(newPwd);
    if (e) return { ok: false, error: e };
    if (isNative) return call("authChangePassword", [oldPwd, newPwd]);

    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts();
    if (!phone || !acc[phone]) return { ok: false, error: "未登录" };
    if (acc[phone].hash !== fakeSha(oldPwd)) return { ok: false, error: "原密码错误" };
    acc[phone].hash = fakeSha(newPwd);
    fakeSave(acc);
    return { ok: true };
  }

  async function logout() {
    // 退出前先确认云端已保存：资料跟随账号，退出登录 / 换设备都不会丢
    try {
      if (window.Cloud && Cloud.hasSession()) {
        if (Cloud.state && Cloud.state().error) await Cloud.push(true);
        await Cloud.signOut();
      }
    } catch (e) {}
    if (isNative) return call("authLogout", []);
    localStorage.removeItem(FAKE_SESSION);
    return { ok: true, msg: "已退出，资料已保存在云端" };
  }

  async function member() {
    if (isNative) {
      const r = await call("authMember", []);
      return r && r.ok ? r.member : null;
    }
    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts()[phone];
    return acc ? fakeMember(acc) : null;
  }

  async function sendCode(phone) {
    phone = normAccount(phone);
    if (!accountOK(phone)) return { ok: false, error: "请输入有效的手机号或邮箱" };
    const mail = isEmail(phone);

    // 优先走自建后端验证码接口（支持真短信网关 + 开发模式 devCode）
    if (window.Cloud && Cloud.configured() && Cloud.serverBase()) {
      try {
        const r = await fetch(Cloud.serverBase() + "/auth/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phone })
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) return { ok: false, error: (d && d.error) || "验证码发送失败" };
        return {
          ok: true,
          devCode: d.dev ? d.devCode : "",
          dev: !!d.dev,
          ttl: d.ttl || 300,
          cooldown: d.cooldown || 60
        };
      } catch (e) {
        // 后端不通时降级到原生层（App 内本地验证码）
        if (isNative) return call("authSendCode", [phone]);
        return { ok: false, error: "验证码服务不可用" };
      }
    }

    if (isNative) return call("authSendCode", [phone]);

    // 纯网页版无后端兜底：本地模拟
    const acc = fakeAccounts();
    if (!acc[phone]) return { ok: false, error: mail ? "该邮箱还未注册，请先注册并设置密码" : "该手机号还未注册，请先注册并设置密码" };
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    sessionStorage.setItem("pyq_fake_code_" + phone, code);
    return { ok: true, devCode: code, dev: true, ttl: 300, cooldown: 60 };
  }

  async function verifyCode(phone, code) {
    phone = normAccount(phone);
    code = String(code || "").replace(/\D/g, "");
    if (!accountOK(phone)) return { ok: false, error: "请输入有效的手机号或邮箱" };
    if (code.length !== 6) return { ok: false, error: "请输入 6 位验证码" };

    // 走后端验证，通过则拿到 token 并建立云会话
    if (window.Cloud && Cloud.configured() && Cloud.serverBase()) {
      try {
        const r = await fetch(Cloud.serverBase() + "/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phone, code: code })
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) return { ok: false, error: (d && d.error) || "验证码不正确" };
        // 登录成功：建立云会话
        if (window.Cloud && typeof Cloud.__setSession === "function") {
          Cloud.__setSession({
            access_token: d.token,
            expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            user: d.user || null,
            mode: "pyq"
          });
          try { await Cloud.init(); } catch (e) {}
          if (window.App && App.render) App.render(true);
        }
        return { ok: true, me: d.user ? { phone: phone, name: d.user.name || "", masked: maskAccount(phone), member: {} } : null };
      } catch (e) {
        if (isNative) return call("authVerifyCode", [phone, code]);
        return { ok: false, error: "验证服务不可用" };
      }
    }

    if (isNative) return call("authVerifyCode", [phone, code]);

    const acc = fakeAccounts();
    if (!acc[phone]) return { ok: false, error: "该账号还未注册，请先注册并设置密码" };
    const saved = sessionStorage.getItem("pyq_fake_code_" + phone) || "";
    if (!saved) return { ok: false, error: "请先获取验证码" };
    if (saved !== code) return { ok: false, error: "验证码不正确" };
    sessionStorage.removeItem("pyq_fake_code_" + phone);
    localStorage.setItem(FAKE_SESSION, phone);
    return { ok: true, me: fakeMe(phone, acc[phone]) };
  }

  async function purchase(tier) {
    if (isNative) return call("authPurchase", [tier]);
    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts();
    if (!phone || !acc[phone]) return { ok: false, error: "未登录" };
    acc[phone].pending = tier;
    fakeSave(acc);
    return { ok: true, member: fakeMember(acc[phone]) };
  }

  /* 激活码：与原生 AuthBridge.genCode 保持一致（FNV-1a 32 位） */
  function genCode(phone, tier) {
    let h = 0x811c9dc5;
    const src = phone + "|" + tier + "|PYQ2026-VIP";
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, "0");
  }

  async function activate(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) return { ok: false, error: "激活码为 8 位字符" };
    if (isNative) return call("authActivate", [code]);

    const phone = localStorage.getItem(FAKE_SESSION) || "";
    const acc = fakeAccounts();
    if (!phone || !acc[phone]) return { ok: false, error: "请先登录" };
    let hit = 0;
    for (let t = 1; t <= 4; t++) if (genCode(phone, t) === code) { hit = t; break; }
    if (!hit) return { ok: false, error: "激活码不正确，请核对后重试" };
    const now = Date.now();
    const cur = acc[phone];
    // 早期售出的「永久会员」expires=0，保留无限期，不再变更
    if (cur.tier === 4 && !cur.expires) return { ok: true, member: fakeMember(cur), msg: "当前已是永久会员，无需再开通" };
    const base = (cur.tier >= 1 && cur.expires > now) ? cur.expires : now;
    const days = (TIERS.find((t) => t.tier === hit) || {}).days || 0;
    cur.tier = hit;
    cur.expires = base + days * DAY;
    cur.pending = 0;
    fakeSave(acc);
    return { ok: true, member: fakeMember(cur), msg: ((TIERS.find((t) => t.tier === hit) || {}).name || "会员") + "已开通" };
  }

  async function genDevCode(phone, tier, pwd) {
    phone = normPhone(phone);
    if (!phoneOK(phone)) return { ok: false, error: "请输入 11 位有效手机号" };
    if (isNative) return call("authGenCode", [phone, tier, pwd]);
    if (pwd !== DEV_PWD) return { ok: false, error: "开发者密码错误" };
    return { ok: true, code: genCode(phone, tier), tierName: (TIERS.find((t) => t.tier === tier) || {}).name };
  }

  /* ---------------- 工具 ---------------- */

  function toast(msg) {
    const t = document.getElementById("toast");
    if (t) {
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(toast._tm);
      toast._tm = setTimeout(() => t.classList.remove("show"), 2200);
    }
  }

  function strength(pwd) {
    const p = String(pwd || "");
    if (!p) return { score: 0, label: "未输入", color: "#C9CDD3" };
    if (p.length < 6) return { score: 1, label: "太短", color: "#FA5151" };
    let classes = 0;
    if (/[a-z]/.test(p)) classes++;
    if (/[A-Z]/.test(p)) classes++;
    if (/\d/.test(p)) classes++;
    if (/[^a-zA-Z0-9]/.test(p)) classes++;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (classes >= 2) s++;
    if (classes >= 3) s++;
    if (classes === 4 && p.length >= 8) s++;
    const score = Math.max(1, Math.min(4, s));
    const label = ["", "弱", "中", "强", "很强"][score];
    const color = ["", "#FA5151", "#FF9F43", "#07C160", "#059B4D"][score];
    return { score: score, label: label, color: color };
  }

  function copyText(text) {
    const done = () => toast("已复制：" + text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { toast("复制失败，请长按选择微信号"); }
  }

  function memberActive(m) {
    if (!m) return false;
    if (m.tier === 4) return true;
    const now = Date.now();
    if (m.tier >= 1 && m.expiresAt > now) return true;
    return m.trialEndsAt > now;
  }

  /* ---------------- 登录遮罩 ---------------- */

  let overlayRoot = null;
  let authMode = "pwd"; // pwd | code | reg
  let countdown = 0;
  let codeTimer = null;
  let lastDevCode = "";

  function ensureOverlay() {
    if (overlayRoot) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "auth-overlay";
    document.body.appendChild(overlayRoot);
    return overlayRoot;
  }

  function removeOverlay() {
    if (overlayRoot && overlayRoot.parentNode) overlayRoot.parentNode.removeChild(overlayRoot);
    overlayRoot = null;
    countdown = 0;
    if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
  }

  function field(id, type, placeholder, extra) {
    return '<div class="auth-field"><input id="' + id + '" type="' + type + '" placeholder="' + placeholder + '" ' + (extra || "") + " /></div>";
  }

  function accountField() {
    return '<div class="auth-field"><input id="authPhone" type="text" autocomplete="username" placeholder="手机号或邮箱" /></div>';
  }

  function pwdStrengthHtml() {
    return (
      '<div class="pw-wrap">' +
        '<div class="pw-meter" id="pwMeter"><i></i><i></i><i></i><i></i></div>' +
        '<span class="pw-label" id="pwLabel">密码强度：未输入</span>' +
      "</div>" +
      '<div class="pw-tip">可自由组合数字、字母、符号，6-32 位</div>'
    );
  }

  function renderOverlay() {
    ensureOverlay();
    const isReg = authMode === "reg";
    const isCode = authMode === "code";
    let body = "";

    if (isReg) {
      body =
        field("authName", "text", "昵称（1-20 个字）", 'maxlength="20" autocomplete="nickname"') +
        accountField() +
        '<div class="auth-field"><input id="authPwd" type="password" autocomplete="new-password" placeholder="设置登录密码" oninput="Auth.pwdInput(this.value)" /></div>' +
        pwdStrengthHtml() +
        field("authPwd2", "password", "再次输入密码", 'autocomplete="new-password"') +
        '<button class="auth-submit" onclick="Auth.submit()">注册并登录（免费试用 7 天）</button>' +
        '<div class="auth-foot">昵称可随时修改；注册后 7 天内免费使用全部功能</div>';
    } else if (isCode) {
      body =
        accountField() +
        '<div class="auth-field auth-code-row">' +
          '<input id="authCode" type="tel" inputmode="numeric" maxlength="6" placeholder="6 位验证码" oninput="this.value=this.value.replace(/\\D/g,\'\')" />' +
          '<button class="auth-send" id="authSendBtn" onclick="Auth.sendSmsCode()">获取验证码</button>' +
        "</div>" +
        '<button class="auth-submit" onclick="Auth.submit()">验证码登录</button>' +
        '<div class="auth-foot">验证码 5 分钟内有效，仅已注册账号可用；邮箱验证码 10 分钟有效</div>';
    } else {
      body =
        accountField() +
        field("authPwd", "password", "登录密码", 'autocomplete="current-password"') +
        '<button class="auth-submit" onclick="Auth.submit()">登录</button>' +
        '<div class="auth-foot">还没有账号？点上方「注册」免费试用 7 天</div>';
    }

    overlayRoot.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-logo">朋友圈 AI 助手</div>' +
        '<div class="auth-sub">昵称 + 手机号/邮箱注册登录 · 首次注册免费试用 7 天</div>' +
        '<div class="auth-tabs">' +
          '<button class="auth-tab ' + (authMode === "pwd" ? "active" : "") + '" onclick="Auth.setMode(\'pwd\')">密码登录</button>' +
          '<button class="auth-tab ' + (authMode === "code" ? "active" : "") + '" onclick="Auth.setMode(\'code\')">验证码登录</button>' +
          '<button class="auth-tab ' + (isReg ? "active" : "") + '" onclick="Auth.setMode(\'reg\')">注册</button>' +
        "</div>" +
        body +
        '<div class="auth-hint" id="authHint"></div>' +
      "</div>";

    if (lastDevCode && isCode) {
      const h = document.getElementById("authHint");
      if (h) { h.className = "auth-hint dev"; h.textContent = "演示验证码：" + lastDevCode + "（点这里自动填入）"; h.onclick = () => { const c = document.getElementById("authCode"); if (c) c.value = lastDevCode; }; }
    }
    const p = document.getElementById("authPhone");
    if (p) setTimeout(() => p.focus(), 80);
  }

  function setMode(m) {
    authMode = m;
    lastDevCode = "";
    renderOverlay();
  }

  function pwdInput(v) {
    const s = strength(v);
    const meter = document.getElementById("pwMeter");
    const label = document.getElementById("pwLabel");
    if (meter) {
      const bars = meter.querySelectorAll("i");
      bars.forEach((b, i) => {
        b.style.background = i < s.score ? s.color : "#E8EAEE";
      });
    }
    if (label) {
      label.textContent = "密码强度：" + s.label;
      label.style.color = s.color;
    }
  }

  async function sendSmsCode() {
    const phone = normAccount((document.getElementById("authPhone") || {}).value || "");
    const hint = document.getElementById("authHint");
    if (!accountOK(phone)) { setHint("请输入有效的手机号或邮箱"); return; }
    if (countdown > 0) return;
    const r = await sendCode(phone);
    if (!r || !r.ok) { setHint((r && r.error) || "验证码发送失败"); return; }
    lastDevCode = r.devCode || "";
    setHint(r.devCode ? "演示验证码：" + r.devCode + "（未接入发送通道，点提示自动填入）" : (isEmail(phone) ? "验证码已发送到邮箱，请查收（含垃圾箱）" : "验证码已发送"), "dev");
    const hintEl = document.getElementById("authHint");
    if (hintEl && r.devCode) hintEl.onclick = () => { const c = document.getElementById("authCode"); if (c) c.value = r.devCode; };
    startCountdown(r.cooldown || 60);
  }

  function startCountdown(sec) {
    countdown = sec;
    const btn = document.getElementById("authSendBtn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = countdown + "s 后重发";
    if (codeTimer) clearInterval(codeTimer);
    codeTimer = setInterval(() => {
      countdown--;
      const b = document.getElementById("authSendBtn");
      if (!b) { clearInterval(codeTimer); codeTimer = null; return; }
      if (countdown <= 0) {
        clearInterval(codeTimer);
        codeTimer = null;
        b.disabled = false;
        b.textContent = "获取验证码";
      } else {
        b.textContent = countdown + "s 后重发";
      }
    }, 1000);
  }

  function setHint(msg, cls) {
    const h = document.getElementById("authHint");
    if (!h) return;
    h.className = "auth-hint" + (cls ? " " + cls : "");
    h.textContent = msg;
    h.onclick = null;
  }

  async function submit() {
    const phone = normAccount((document.getElementById("authPhone") || {}).value || "");
    const hint = document.getElementById("authHint");
    setHint("");

    if (authMode === "code") {
      const code = (document.getElementById("authCode") || {}).value || "";
      if (code.replace(/\D/g, "").length !== 6) { setHint("请输入 6 位验证码"); return; }
      const r = await verifyCode(phone, code);
      if (r && r.ok) onLoginOk(r);
      else setHint((r && r.error) || "登录失败");
      return;
    }

    const pwd = (document.getElementById("authPwd") || {}).value || "";
    if (!accountOK(phone)) { setHint("请输入有效的手机号或邮箱"); return; }
    const pe = pwdError(pwd);
    if (pe) { setHint(pe); return; }

    if (authMode === "reg") {
      const nickname = (document.getElementById("authName") || {}).value || "";
      const ne = nickError(nickname);
      if (ne) { setHint(ne); return; }
      const p2 = (document.getElementById("authPwd2") || {}).value || "";
      if (pwd !== p2) { setHint("两次输入的密码不一致"); return; }
      const r = await register(phone, nickname, pwd);
      if (r && r.ok) onLoginOk(r);
      else setHint((r && r.error) || "注册失败");
      return;
    }

    const r = await login(phone, pwd);
    if (r && r.ok) onLoginOk(r);
    else setHint((r && r.error) || "登录失败");
  }

  function onLoginOk(r) {
    removeOverlay();
    Auth.current = r.me || null;
    toast(r.msg || "登录成功");
    window.__authChanged && window.__authChanged(Auth.current);
    if (!memberActive(Auth.current && Auth.current.member)) showLock();
    else hideVip();
  }

  /* ---------------- 会员：到期锁定 / 付费 ---------------- */

  let vipRoot = null;
  let vipView = "tiers";       // tiers | pay | code | contact | dev
  let vipLocked = true;
  let selectedTier = 1;

  function ensureVip() {
    if (vipRoot) return vipRoot;
    vipRoot = document.createElement("div");
    vipRoot.id = "vip-overlay";
    document.body.appendChild(vipRoot);
    return vipRoot;
  }

  function hideVip() {
    if (vipRoot && vipRoot.parentNode) vipRoot.parentNode.removeChild(vipRoot);
    vipRoot = null;
  }

  function showLock() {
    vipLocked = true;
    vipView = "tiers";
    renderVip();
  }

  function showPay(tier) {
    vipLocked = false;
    vipView = "pay";
    selectedTier = tier || 1;
    renderVip();
    purchase(selectedTier);
  }

  function vipViewChange(v) {
    if (v === "close") { closeVip(); return; }
    // 已开通/试用中的用户是从会员中心主动进来的，不是被锁：必须能关掉弹层
    if (v === "code" || v === "contact" || v === "pay") {
      if (memberActive(currentMember())) vipLocked = false;
    }
    vipView = v;
    renderVip();
  }

  function currentMember() {
    return (Auth.current && Auth.current.member) || {};
  }

  function statusText(m) {
    if (m.tier === 4 && m.daysLeft === -1) return "永久会员 · 无限期使用";
    if (m.tier >= 1 && m.expiresAt > Date.now()) return m.tierName + " · 剩余 " + m.daysLeft + " 天";
    if (m.trialEndsAt > Date.now()) return "免费试用 · 剩余 " + m.daysLeft + " 天";
    return "免费试用已结束";
  }

  function tierCards(selected) {
    return TIERS.map((t) => {
      const on = t.tier === selected;
      return (
        '<div class="tier-card' + (on ? " active" : "") + '" onclick="Auth.selectTier(' + t.tier + ')">' +
          '<div class="tier-name">' + t.name + '<span class="tier-tag">' + t.tag + "</span></div>" +
          '<div class="tier-price"><b>¥' + t.price + "</b><span>" + (t.days ? t.days + " 天" : "永久") + "</span></div>" +
        "</div>"
      );
    }).join("");
  }

  function renderVip() {
    ensureVip();
    const m = currentMember();
    const t = TIERS.find((x) => x.tier === selectedTier) || TIERS[0];
    let inner = "";

    if (vipView === "pay") {
      inner =
        '<div class="vip-card">' +
          '<div class="pay-top">' +
            '<button class="pay-back" onclick="Auth.vipView(\'' + (vipLocked ? "tiers" : "close") + '\')">' + (vipLocked ? "←" : "✕") + "</button>" +
            "<b>开通" + t.name + "</b>" +
            '<span class="pay-price">¥' + t.price + "</span>" +
          "</div>" +
          '<div class="pay-qr-wrap"><img src="assets/qr-pay.png" alt="微信收款码" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'qr-miss\')" /></div>' +
          '<div class="pay-amount">应付 ¥' + t.price + " · " + (t.days ? t.days + " 天" : "永久有效") + "</div>" +
          '<div class="pay-tip">请使用微信扫码支付，备注手机号后 4 位</div>' +
          '<div class="pay-wx">开发者微信 <b>' + WX_ID + '</b><button onclick="Auth.copyWx()">复制</button></div>' +
          '<button class="btn primary block mt12" onclick="Auth.vipView(\'code\')">我已支付，输入激活码</button>' +
          '<button class="btn ghost block" style="margin-top:8px" onclick="Auth.vipView(\'contact\')">查看微信二维码</button>' +
          '<div class="pay-note">支付后联系开发者，提供手机号即可获取激活码，输入后立即生效</div>' +
        "</div>";
    } else if (vipView === "code") {
      inner =
        '<div class="vip-card">' +
          '<div class="pay-top">' +
            '<button class="pay-back" onclick="Auth.vipView(\'pay\')">←</button><b>输入激活码</b><span></span>' +
          "</div>" +
          '<div class="auth-field" style="margin-top:6px"><input id="vipCode" maxlength="9" placeholder="8 位激活码，如 A1B2C3D4" style="text-transform:uppercase" /></div>' +
          '<button class="auth-submit" onclick="Auth.submitActivate()">激活并继续使用</button>' +
          '<div class="auth-hint" id="vipHint"></div>' +
          '<div class="pay-note">激活码与手机号绑定，换设备或换账号无效</div>' +
          (vipLocked ? "" : '<button class="btn ghost block" style="margin-top:10px" onclick="Auth.closeVip()">关闭</button>') +
        "</div>";
    } else if (vipView === "contact") {
      inner =
        '<div class="vip-card">' +
          '<div class="pay-top">' +
            '<button class="pay-back" onclick="Auth.vipView(\'' + (vipLocked ? "tiers" : "close") + '\')">' + (vipLocked ? "←" : "✕") + "</button><b>联系开发者</b><span></span>" +
          "</div>" +
          '<div class="pay-qr-wrap"><img src="assets/qr-wechat.png" alt="开发者微信二维码" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'qr-miss\')" /></div>' +
          '<div class="pay-tip">微信扫码添加开发者</div>' +
          '<div class="pay-wx">微信号 <b>' + WX_ID + '</b><button onclick="Auth.copyWx()">复制</button></div>' +
          '<div class="pay-note">添加时请备注「朋友圈 AI 助手」，说明手机号与所选档位</div>' +
          (vipLocked ? '<button class="btn ghost block" style="margin-top:10px" onclick="Auth.vipView(\'tiers\')">返回会员档位</button>'
                     : '<button class="btn ghost block" style="margin-top:10px" onclick="Auth.closeVip()">关闭</button>') +
        "</div>";
    } else if (vipView === "dev") {
      inner =
        '<div class="vip-card">' +
          '<div class="pay-top">' +
            '<button class="pay-back" onclick="Auth.vipView(\'tiers\')">←</button><b>开发者工具</b><span></span>' +
          "</div>" +
          '<div class="auth-field"><input id="devPhone" type="tel" maxlength="11" placeholder="付款用户手机号" /></div>' +
          '<div class="auth-field"><select id="devTier" class="input">' +
            TIERS.map((x) => '<option value="' + x.tier + '">' + x.name + " ¥" + x.price + "</option>").join("") +
          "</select></div>" +
          '<div class="auth-field"><input id="devPwd" type="password" placeholder="开发者密码" /></div>' +
          '<button class="auth-submit" onclick="Auth.devGenTap()">生成激活码</button>' +
          '<div class="auth-hint dev" id="devOut"></div>' +
          '<button class="btn ghost block" style="margin-top:10px" onclick="Auth.closeVip()">关闭</button>' +
        "</div>";
    } else {
      const expired = !memberActive(m);
      inner =
        '<div class="vip-card">' +
          (vipLocked ? "" : '<button class="pay-back close" onclick="Auth.closeVip()">✕</button>') +
          '<div class="vip-crown" onclick="Auth.devTap()">VIP</div>' +
          '<h2 class="vip-title">' + (expired ? "免费试用已结束" : "会员中心") + "</h2>" +
          '<div class="vip-desc">' + (expired ? "开通会员后即可继续使用全部功能" : "选择适合你的会员档位") + "</div>" +
          '<div class="vip-status' + (expired ? " off" : "") + '">' + statusText(m) + "</div>" +
          '<div class="tier-list">' + tierCards(selectedTier) + "</div>" +
          (vipLocked
            ? '<div class="lock-qr"><div class="lock-qr-img"><img src="assets/qr-pay.png" alt="微信收款码" ' +
                'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'qr-miss\')" /></div>' +
                '<span>微信扫码付费 · 备注手机号后 4 位</span></div>'
            : "") +
          '<button class="auth-submit" onclick="Auth.paySelected()">立即开通 ' + t.name + " ¥" + t.price + "</button>" +
          '<div class="vip-links">' +
            '<span onclick="Auth.vipView(\'contact\')">联系开发者</span>' +
            '<span onclick="Auth.vipView(\'code\')">已有激活码</span>' +
            (vipLocked ? '<span onclick="Auth.logoutTap()">退出登录</span>' : "") +
          "</div>" +
        "</div>";
    }

    vipRoot.innerHTML = inner;
    if (vipView === "code") {
      const el = document.getElementById("vipCode");
      if (el) setTimeout(() => el.focus(), 80);
    }
  }

  function selectTier(tier) {
    selectedTier = tier;
    renderVip();
  }

  function paySelected() {
    vipView = "pay";
    renderVip();
    purchase(selectedTier);
  }

  function closeVip() {
    if (vipLocked) return;
    hideVip();
  }

  function copyWx() { copyText(WX_ID); }

  async function submitActivate() {
    const code = (document.getElementById("vipCode") || {}).value || "";
    const h = document.getElementById("vipHint");
    if (code.replace(/[^A-Za-z0-9]/g, "").length !== 8) {
      if (h) { h.className = "auth-hint"; h.textContent = "请输入 8 位激活码"; }
      return;
    }
    const r = await activate(code);
    if (r && r.ok) {
      if (Auth.current) Auth.current.member = r.member || currentMember();
      const m = (r.member || {});
      try { window.Core && Core.logAudit("member", (m.tier === 4 ? "signup" : "renew"), (m.tierName || "会员"), (m.daysLeft === -1 ? "永久" : "剩余 " + m.daysLeft + " 天")); } catch (e) {}
      hideVip();
      toast(r.msg || "会员已开通");
      window.__authChanged && window.__authChanged(Auth.current);
    } else if (h) {
      h.className = "auth-hint";
      h.textContent = (r && r.error) || "激活失败";
    }
  }

  async function devGenTap() {
    const phone = normPhone((document.getElementById("devPhone") || {}).value || "");
    const tier = parseInt((document.getElementById("devTier") || {}).value || "1", 10);
    const pwd = (document.getElementById("devPwd") || {}).value || "";
    const out = document.getElementById("devOut");
    const r = await genDevCode(phone, tier, pwd);
    if (out) {
      out.className = "auth-hint " + (r && r.ok ? "dev" : "");
      out.textContent = r && r.ok ? "激活码：" + r.code + "（" + r.tierName + "）" : ((r && r.error) || "生成失败");
    }
  }

  function logoutTap() {
    if (window.App && App.logout) App.logout();
    else logout().then(() => show());
  }

  function openDevTool() {
    vipLocked = !memberActive(currentMember());
    vipView = "dev";
    renderVip();
  }

  // 隐藏入口：3 秒内连点会员中心顶部 VIP 徽章 5 次才会打开开发者工具
  let devTaps = 0;
  let devTapTimer = null;
  function devTap() {
    devTaps += 1;
    clearTimeout(devTapTimer);
    devTapTimer = setTimeout(() => { devTaps = 0; }, 3000);
    if (devTaps >= 5) {
      devTaps = 0;
      clearTimeout(devTapTimer);
      openDevTool();
    }
  }

  /* ---------------- 启动校验 ---------------- */

  function show() {
    authMode = "pwd";
    lastDevCode = "";
    renderOverlay();
  }

  function gate(me) {
    me = me || Auth.current;
    if (!me) { show(); return; }
    if (!memberActive(me.member)) showLock();
    else hideVip();
  }

  function bindBack(activity) {
    const old = activity.nativeBack;
    activity.nativeBack = function () {
      if (document.getElementById("auth-overlay")) return "sheet";
      if (document.getElementById("vip-overlay")) return "sheet";
      return old();
    };
  }

  window.__nativeResolve = (id, payload) => resolveCallback(id, payload);

  // 试用到期实时锁定：每分钟检查一次
  setInterval(() => {
    if (Auth.current && !memberActive(Auth.current.member) && !document.getElementById("vip-overlay")) {
      showLock();
    }
  }, 60000);

  const Auth = {
    available: () => true,
    current: null,
    isNative: () => isNative,
    isNativeOnly: () => isNative,
    getMe, login, register, changePassword, changeName, logout, member,
    sendCode, verifyCode, purchase, activate, genDevCode,
    gate, show, setMode, submit, pwdInput, sendSmsCode, strength,
    showLock, hideVip, showPay, vipView: vipViewChange, selectTier, paySelected,
    closeVip, copyWx, submitActivate, devGenTap, openDevTool, devTap, logoutTap,
    bindBack,
    tiers: TIERS,
    wxId: WX_ID,
    memberActive
  };
  window.Auth = Auth;
})();
