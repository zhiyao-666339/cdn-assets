/* 账号 + 数据云同步
 * 默认走自建后端 pyq-server（mode="pyq"）：
 *   POST /auth/register、/auth/login、/auth/logout
 *   GET/PUT /sync、GET /persona、POST /persona/build
 * 保留旧版 Supabase 兼容分支（settings.cloud.mode = "supabase"）。
 *
 * 设计原则：
 *  - 资料跟随账号：资料、草稿、素材、历史、生成记录整包存服务器；
 *  - 整包 last-write-wins，PUT 带 baseUpdatedAt，云端更新时返回 409 + 云端版本；
 *  - 本地保存后防抖 2.5 秒自动上传；登录后先拉取再渲染。
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
    const mode = String(c.mode || "pyq").toLowerCase() === "supabase" ? "supabase" : "pyq";
    return {
      mode: mode,
      server: String(c.server || "").trim().replace(/\/+$/, ""),
      url: String(c.url || "").trim().replace(/\/+$/, ""),
      key: String(c.key || "").trim(),
      account: String(c.account || "").trim(),
      auto: c.auto !== false
    };
  }

  function mode() { return cfg().mode; }
  function serverBase() { return cfg().server; }

  function configured() {
    const c = cfg();
    return c.mode === "pyq" ? !!c.server : !!(c.url && c.key);
  }

  function hasSession() { return !!(session && session.access_token && session.user && (session.user.id || session.user.phone)); }
  function user() { return hasSession() ? session.user : null; }
  function token() { return hasSession() ? session.access_token : ""; }

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

  /* ---------------- 底层请求 ---------------- */

  // pyq-server 请求：base 由 settings.cloud.server 提供
  async function pyq(path, opts) {
    const c = cfg();
    if (!c.server) throw new Error("请先填写自建服务器地址");
    const o = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, o.headers || {});
    if (o.auth !== false) {
      const t = await ensureToken();
      if (!t) throw new Error("请先登录云账号");
      headers.Authorization = "Bearer " + t;
    }
    const res = await fetch(c.server + path, {
      method: o.method || "GET",
      headers: headers,
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

  async function call(path, opts) {
    const c = cfg();
    if (c.mode === "pyq") return pyq(path, opts);
    if (!c.url || !c.key) throw new Error("请先填写 Supabase 地址和 anon key");
    const o = opts || {};
    const headers = Object.assign(
      { apikey: c.key, "Content-Type": "application/json" },
      o.headers || {}
    );
    if (o.auth !== false) {
      const t = await ensureToken();
      if (t) headers.Authorization = "Bearer " + t;
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
    // 距离过期不足 7 天，或已过期但在宽限期内，自动刷新实现永久在线
    const sevenDays = 7 * 24 * 60 * 60;
    if (exp && exp - sevenDays > Math.floor(Date.now() / 1000)) return session.access_token;
    if (cfg().mode === "pyq") {
      const c = cfg();
      try {
        const res = await fetch(c.server + "/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok && data.token) {
          session.access_token = data.token;
          session.expires_at = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
          saveSession(session);
          return session.access_token;
        }
      } catch (e) { /* 刷新失败走下面清除 */ }
      saveSession(null);
      throw new Error("登录已过期，请重新登录");
    }
    if (cfg().mode === "supabase") {
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
    saveSession(null);
    throw new Error("登录已过期，请重新登录");
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

  function pyqSession(data) {
    return {
      access_token: data.token,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      user: data.user || null,
      mode: "pyq"
    };
  }

  function accountId(account) {
    const a = String(account || "").trim();
    if (a.indexOf("@") >= 0) return a.toLowerCase();
    return a.replace(/\D/g, "");
  }

  async function signUp(account, password, nickname) {
    const c = cfg();
    if (c.mode === "pyq") {
      if (!c.server) return { ok: false, error: "请先填写自建服务器地址" };
      if (!accountId(account)) return { ok: false, error: "请填写手机号或邮箱" };
      if (!password || password.length < 6) return { ok: false, error: "密码至少 6 位" };
      try {
        const data = await pyq("/auth/register", {
          method: "POST", auth: false,
          body: { account: accountId(account), password: password, nickname: String(nickname || "").trim() }
        });
        if (!data || !data.ok || !data.token) return { ok: false, error: errText(data, "注册失败") };
        saveSession(pyqSession(data));
        return { ok: true, user: session.user };
      } catch (e) {
        const msg = (e && e.message) || "注册失败";
        return { ok: false, error: /已注册|exists|409/i.test(msg) ? "该账号已注册，请直接登录" : msg };
      }
    }
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
    const c = cfg();
    if (c.mode === "pyq") {
      if (!c.server) return { ok: false, error: "请先填写自建服务器地址" };
      const id = accountId(account);
      if (!id) return { ok: false, error: "请填写手机号或邮箱" };
      if (!password) return { ok: false, error: "请填写密码" };
      try {
        const data = await pyq("/auth/login", {
          method: "POST", auth: false, body: { account: id, password: password }
        });
        if (!data || !data.ok || !data.token) return { ok: false, error: errText(data, "账号或密码不正确") };
        saveSession(pyqSession(data));
        return { ok: true, user: session.user, persona: data.persona || null };
      } catch (e) {
        const msg = (e && e.message) || "登录失败";
        return { ok: false, error: /401|不正确|invalid/i.test(msg) ? "账号或密码不正确" : msg };
      }
    }
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
    const t = session && session.access_token;
    saveSession(null);
    try {
      if (c.mode === "pyq" && c.server && t) {
        await fetch(c.server + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + t } });
      } else if (c.url && t) {
        await fetch(c.url + "/auth/v1/logout", {
          method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + t }
        });
      }
    } catch (e) {}
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
      auditLog: s.auditLog,
      seedCleaned: s.seedCleaned,
      personaDigest: s.personaDigest || "",
      personaHash: s.personaHash || "",
      lastLearnAt: s.lastLearnAt || "",
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

  function applyPersona(persona) {
    if (!persona) return;
    Core.store.personaDigest = persona.digest || "";
    Core.store.personaHash = persona.hash || "";
    Core.store.lastLearnAt = persona.lastLearnAt || "";
  }

  function applyRemote(payload, updatedAt, persona) {
    if (!payload && !persona) return false;
    suspended = true;
    try {
      const s = Core.store;
      const localSettings = s.settings;
      if (payload) {
        Object.keys(s).forEach((k) => { delete s[k]; });
        Object.assign(s, payload);
        s.settings = localSettings || {};
        s.cloudUpdatedAt = updatedAt || payload.cloudUpdatedAt || "";
        // 兜底默认值，避免旧数据缺少字段导致页面报错
        if (!s.materials) s.materials = { copy: [], images: [], videos: [] };
        if (!s.profiles) s.profiles = {};
        if (!s.dailyDate) s.dailyDate = "";
      }
      applyPersona(persona);
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
      const snap = snapshot();
      let resp;
      if (c.mode === "pyq") {
        resp = await pyq("/sync", {
          method: "PUT",
          body: { payload: snap.payload, baseUpdatedAt: Core.store.cloudUpdatedAt || "" }
        });
      } else {
        const u = user();
        resp = await call("/rest/v1/" + TABLE + "?on_conflict=user_id", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: [{ user_id: u.id, payload: snap.payload, updated_at: new Date().toISOString() }]
        });
        resp = { ok: true, updatedAt: new Date().toISOString() };
      }
      if (!resp || resp.ok === false || resp.conflict) {
        if (resp && resp.conflict) {
          applyRemote(resp.payload, resp.updatedAt, resp.persona);
          state.lastPull = resp.updatedAt || "";
          if (!silent && window.App && App.toast) App.toast("云端有更新的内容，已自动同步");
          return { ok: false, conflict: true, direction: "down" };
        }
        throw new Error((resp && resp.error) || "上传失败");
      }
      const now = resp.updatedAt || new Date().toISOString();
      Core.store.cloudUpdatedAt = now;
      try { localStorage.setItem("pyq_store_v1", JSON.stringify(Core.store)); } catch (e) {}
      state.lastPush = now;
      state.error = "";
      if (!silent && window.App && App.toast) App.toast("已上传到云端");
      return { ok: true, size: snap.size, updatedAt: now };
    } catch (e) {
      if (e && e.status === 409 && e.data && e.data.conflict) {
        applyRemote(e.data.payload, e.data.updatedAt, e.data.persona);
        state.lastPull = e.data.updatedAt || "";
        state.error = "";
        if (!silent && window.App && App.toast) App.toast("云端有更新的内容，已自动同步");
        emit();
        return { ok: false, conflict: true, direction: "down" };
      }
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
      let row;
      if (cfg().mode === "pyq") {
        const data = await pyq("/sync", { method: "GET" });
        if (!data || data.ok === false) return { ok: false, error: (data && data.error) || "拉取失败" };
        row = { payload: data.payload, updated_at: data.updatedAt || "", persona: data.persona || null };
      } else {
        const u = user();
        const rows = await call("/rest/v1/" + TABLE + "?select=payload,updated_at&user_id=eq." + encodeURIComponent(u.id));
        const r = Array.isArray(rows) ? rows[0] : rows;
        row = r ? { payload: r.payload, updated_at: r.updated_at } : null;
      }
      if (!row || (!row.payload && !row.persona)) {
        state.lastPull = (row && row.updated_at) || "";
        return { ok: true, empty: true };
      }
      if (apply !== false) applyRemote(row.payload, row.updated_at, row.persona);
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
      applyRemote(r.row.payload, remoteAt, r.row.persona);
      if (!silent && window.App) { App.toast("已从云端同步最新内容"); App.render(true); }
      return { ok: true, direction: "down" };
    }
    const p = await push(true);
    if (p && p.conflict) return { ok: true, direction: "down" };
    return { ok: p.ok, direction: "up" };
  }

  /* ---------- 人物画像 ---------- */
  async function getPersona() {
    if (!configured() || !hasSession()) return { ok: false, error: "未登录云账号" };
    try {
      if (cfg().mode === "pyq") {
        const data = await pyq("/persona", { method: "GET" });
        applyPersona(data);
        return data;
      }
      return { ok: true, digest: Core.store.personaDigest || "" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "读取失败" };
    }
  }

  async function buildPersona(force) {
    if (!configured() || !hasSession()) return { ok: false, error: "未登录云账号" };
    if (cfg().mode !== "pyq") return { ok: false, error: "当前云模式不支持画像学习" };
    try {
      const snap = snapshot();
      const data = await pyq("/persona/build", { method: "POST", body: { force: !!force, payload: snap.payload } });
      if (data && data.ok && data.digest) {
        applyPersona(data);
        Core.store.personaDigest = data.digest;
        Core.store.personaHash = data.hash || "";
        Core.store.lastLearnAt = data.lastLearnAt || "";
        Core.save();
      }
      return data || { ok: false, error: "学习失败" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "学习失败" };
    }
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
    configured, hasSession, user, token, serverBase, mode,
    signUp, signIn, signOut,
    push, pull: (apply) => pull(apply), reconcile, markDirty, init,
    getPersona, buildPersona,
    state: () => state, onChange, toEmail,
    applyRemote: (payload, updatedAt, persona) => applyRemote(payload, updatedAt, persona),
    snapshot,
    __setSession: (s) => saveSession(s)
  };
})();
