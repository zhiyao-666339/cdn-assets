/* 云端账号 + 数据同步（Supabase 免费版）
 * - 纯浏览器 fetch，网页版与 App（WebView）行为一致
 * - 账号：手机号或邮箱 + 密码（手机号会自动转成 手机号@pyq.local）
 * - 数据表：public.pyq_data(user_id uuid primary key, payload jsonb, updated_at timestamptz)
 * - 策略：整包 last-write-wins；每次本地保存后防抖 2.5 秒自动上传
 */
(function () {
  const SESSION_KEY = "pyq_cloud_session";
  const TABLE = "pyq_data";
  const PUSH_DELAY = 2500;
  const MAX_BYTES = 6 * 1024 * 1024; // 单次上传体积上限，超出时丢弃内联图片

  let session = loadSession();
  let timer = null;
  let pushing = false;
  let suspended = false;
  let state = { lastPush: "", lastPull: "", error: "", busy: false };

  const listeners = [];
  function emit() { listeners.forEach((fn) => { try { fn(state); } catch (e) {} }); }

  function cfg() {
    const s = (window.Core && Core.store && Core.store.settings) || {};
    const c = s.cloud || {};
    return {
      url: String(c.url || "").trim().replace(/\/+$/, ""),
      key: String(c.key || "").trim(),
      account: String(c.account || "").trim(),
      auto: c.auto !== false
    };
  }
  function configured() { const c = cfg(); return !!(c.url && c.key); }
  function hasSession() { return !!(session && session.access_token && session.user && session.user.id); }
  function user() { return hasSession() ? session.user : null; }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function toEmail(account) {
    const a = String(account || "").trim();
    if (!a) return "";
    if (a.indexOf("@") >= 0) return a;
    const phone = a.replace(/\D/g, "");
    return phone.length === 11 ? phone + "@pyq.local" : a + "@pyq.local";
  }

  function errText(data, fallback) {
    if (!data) return fallback || "请求失败";
    return data.msg || data.error_description || data.error || data.message || fallback || "请求失败";
  }

  async function call(path, opts) {
    const c = cfg();
    if (!c.url || !c.key) throw new Error("请先填写 Supabase 地址和 anon key");
    const o = opts || {};
    const headers = Object.assign(
      { apikey: c.key, "Content-Type": "application/json" },
      o.headers || {}
    );
    if (o.auth !== false) {
      const token = await ensureToken();
      if (token) headers.Authorization = "Bearer " + token;
    }
    const res = await fetch(c.url + path, {
      method: o.method || "GET",
      headers: Object.assign(headers, o.prefer ? { Prefer: o.prefer } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    if (!res.ok) {
      const e = new Error(errText(data, "HTTP " + res.status));
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  /* ---------- 登录态 ---------- */
  async function ensureToken() {
    if (!hasSession()) return null;
    const exp = Number(session.expires_at || 0);
    if (exp && exp - 60 > Math.floor(Date.now() / 1000)) return session.access_token;
    const c = cfg();
    const res = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: c.key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.access_token) {
      saveSession(null);
      throw new Error(errText(data, "登录已过期，请重新登录"));
    }
    saveSession(normalizeSession(data));
    return session.access_token;
  }

  function normalizeSession(data) {
    const expiresAt = Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      user: data.user || (session && session.user) || null
    };
  }

  async function signUp(account, password) {
    const email = toEmail(account);
    if (!email) return { ok: false, error: "请填写手机号或邮箱" };
    if (!password || password.length < 6) return { ok: false, error: "密码至少 6 位" };
    try {
      const data = await call("/auth/v1/signup", {
        method: "POST", auth: false, body: { email: email, password: password }
      });
      if (!data || !data.access_token) {
        return { ok: false, needConfirm: true, error: "注册成功，但 Supabase 开启了邮箱验证。请到 Supabase → Authentication → Providers → Email 关闭 Confirm email 后再登录。" };
      }
      saveSession(normalizeSession(data));
      return { ok: true, user: session.user };
    } catch (e) {
      const msg = (e && e.message) || "注册失败";
      return { ok: false, error: /already|registered|exists/i.test(msg) ? "该账号已注册，请直接登录" : msg };
    }
  }

  async function signIn(account, password) {
    const email = toEmail(account);
    if (!email) return { ok: false, error: "请填写手机号或邮箱" };
    if (!password) return { ok: false, error: "请填写密码" };
    try {
      const data = await call("/auth/v1/token?grant_type=password", {
        method: "POST", auth: false, body: { email: email, password: password }
      });
      if (!data || !data.access_token) return { ok: false, error: "账号或密码不正确" };
      saveSession(normalizeSession(data));
      return { ok: true, user: session.user };
    } catch (e) {
      const msg = (e && e.message) || "登录失败";
      return { ok: false, error: /invalid|credential/i.test(msg) ? "账号或密码不正确" : msg };
    }
  }

  async function signOut() {
    const c = cfg();
    const token = session && session.access_token;
    saveSession(null);
    if (c.url && token) {
      try {
        await fetch(c.url + "/auth/v1/logout", {
          method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + token }
        });
      } catch (e) {}
    }
    emit();
    return { ok: true };
  }

  /* ---------- 数据快照 ---------- */
  function snapshot() {
    const s = Core.store;
    const snap = {
      user: s.user,
      profileSections: s.profileSections,
      profileVersion: s.profileVersion,
      profiles: s.profiles,
      currentPhone: s.currentPhone,
      types: s.types,
      slots: s.slots,
      topics: s.topics,
      materials: s.materials,
      drafts: s.drafts,
      history: s.history,
      blocks: s.blocks,
      schedule: s.schedule,
      dailyDate: s.dailyDate,
      todayTopics: s.todayTopics,
      recentTopicIds: s.recentTopicIds,
      topicCycle: s.topicCycle,
      words: s.words,
      rules: s.rules,
      rulesVersion: s.rulesVersion,
      rulesLiveVersion: s.rulesLiveVersion,
      seedCleaned: s.seedCleaned,
      cloudUpdatedAt: s.cloudUpdatedAt || ""
    };

    // 体积保护：内联图片过大时丢弃 dataURL，避免上传失败
    let json = JSON.stringify(snap);
    if (json.length > MAX_BYTES) {
      if (snap.materials && snap.materials.images) {
        snap.materials.images = snap.materials.images.map((img) => {
          if (/^data:/.test(img.src || "")) {
            const copy = Object.assign({}, img);
            copy.src = "";
            copy.srcSkipped = true;
            return copy;
          }
          return img;
        });
      }
      json = JSON.stringify(snap);
    }
    return { payload: snap, size: json.length };
  }

  function applyRemote(payload, updatedAt) {
    if (!payload) return false;
    suspended = true;
    try {
      const s = Core.store;
      const localSettings = s.settings;
      Object.keys(s).forEach((k) => { delete s[k]; });
      Object.assign(s, payload);
      s.settings = localSettings || {};
      s.cloudUpdatedAt = updatedAt || payload.cloudUpdatedAt || "";
      // 兜底默认值，避免旧数据缺少字段导致页面报错
      if (!s.materials) s.materials = { copy: [], images: [], videos: [] };
      if (!s.profiles) s.profiles = {};
      if (!s.dailyDate) s.dailyDate = "";
      Core.save();
    } finally {
      suspended = false;
    }
    return true;
  }

  /* ---------- 上传 / 下载 ---------- */
  async function push(silent) {
    if (!configured() || !hasSession()) return { ok: false, error: "未登录云账号" };
    if (pushing) return { ok: false, error: "正在上传" };
    pushing = true;
    state.busy = true;
    emit();
    try {
      const c = cfg();
      const u = user();
      const snap = snapshot();
      await call("/rest/v1/" + TABLE + "?on_conflict=user_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: [{ user_id: u.id, payload: snap.payload, updated_at: new Date().toISOString() }]
      });
      const now = new Date().toISOString();
      Core.store.cloudUpdatedAt = now;
      try { localStorage.setItem("pyq_store_v1", JSON.stringify(Core.store)); } catch (e) {}
      state.lastPush = now;
      state.error = "";
      if (!silent && window.App && App.toast) App.toast("已上传到云端");
      return { ok: true, size: snap.size };
    } catch (e) {
      state.error = (e && e.message) || "上传失败";
      if (!silent && window.App && App.toast) App.toast("云端上传失败：" + state.error);
      return { ok: false, error: state.error };
    } finally {
      pushing = false;
      state.busy = false;
      emit();
    }
  }

  async function pull(apply) {
    if (!configured() || !hasSession()) return { ok: false, error: "未登录云账号" };
    try {
      const u = user();
      const rows = await call("/rest/v1/" + TABLE + "?select=payload,updated_at&user_id=eq." + encodeURIComponent(u.id));
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return { ok: true, empty: true };
      if (apply !== false) applyRemote(row.payload, row.updated_at);
      state.lastPull = row.updated_at || "";
      state.error = "";
      return { ok: true, row: row };
    } catch (e) {
      state.error = (e && e.message) || "拉取失败";
      return { ok: false, error: state.error };
    }
  }

  /* 登录后对齐：云端更新则覆盖本地，否则把本地推上去 */
  async function reconcile(silent) {
    if (!configured() || !hasSession()) return { ok: false };
    const r = await pull(false);
    if (!r.ok) return r;
    const local = Core.store.cloudUpdatedAt || "";
    if (r.empty) {
      const p = await push(true);
      return { ok: p.ok, direction: "up" };
    }
    const remoteAt = r.row.updated_at || "";
    if (remoteAt > local) {
      applyRemote(r.row.payload, remoteAt);
      if (!silent && window.App) { App.toast("已从云端同步最新内容"); App.render(true); }
      return { ok: true, direction: "down" };
    }
    const p = await push(true);
    return { ok: p.ok, direction: "up" };
  }

  /* ---------- 自动同步 ---------- */
  function markDirty() {
    if (suspended) return;
    if (!configured() || !hasSession()) return;
    if (!cfg().auto) return;
    clearTimeout(timer);
    timer = setTimeout(() => { push(true).then(() => emit()); }, PUSH_DELAY);
  }

  async function init() {
    if (!configured() || !hasSession()) return;
    try { await reconcile(true); } catch (e) {}
    emit();
  }

  function onChange(fn) { listeners.push(fn); }

  window.Cloud = {
    configured, hasSession, user, signUp, signIn, signOut,
    push, pull: (apply) => pull(apply), reconcile, markDirty, init,
    state: () => state, onChange, toEmail,
    applyRemote: (payload, updatedAt) => applyRemote(payload, updatedAt),
    snapshot
  };
})();
