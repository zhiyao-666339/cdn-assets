/* 页面：排期 / 资料库 / 历史 / 合规检测 / 云盘同步 / 我的 */
(function () {
  const { store, ui } = Core;
  const icon = UI.icon;

  /* ---------- 发布时间排期（今日选题 ↔ 时间段） ---------- */
  function renderSchedule() {
    const n = Core.now();
    const hm = n.getHours() * 60 + n.getMinutes();
    const schedule = store.schedule || [];
    const topicList = Core.todayTopicList();
    const planned = topicList.filter((t) => schedule.some((x) => x.topicId === t.id)).length;

    // 今日选题：每条后面可直接安排 / 调整时间段
    const topicRows = topicList.map((t, i) => {
      const item = schedule.find((x) => x.topicId === t.id);
      const slot = item ? store.slots.find((s) => s.id === item.slotId) : null;
      const type = Core.typeById(t.type);
      return (
        '<div class="topic-plan">' +
          '<div class="topic-index">' + (i + 1 < 10 ? "0" : "") + (i + 1) + "</div>" +
          '<div class="topic-plan-body">' +
            "<b>" + Core.escapeHtml(t.title) + "</b>" +
            '<div class="topic-meta">' +
              (type ? '<span class="tag gray">' + type.name + "</span>" : "") +
              (slot ? '<span class="tag green">' + slot.time + "</span>" : '<span class="tag gray">未安排</span>') +
            "</div>" +
          "</div>" +
          '<button class="btn soft small" onclick="App.openSlotPicker(\'' + t.id + '\')">' +
            (slot ? "改时段" : "安排") + "</button>" +
        "</div>"
      );
    }).join("");

    const cards = store.slots.map((s) => {
      const start = s.time.split("-")[0].split(":");
      const live = hm >= parseInt(start[0]) * 60 + parseInt(start[1]);
      const item = schedule.find((x) => x.slotId === s.id) || {};
      const tp = item.topicId ? Core.topicById(item.topicId) : null;
      const t = item.type ? Core.typeById(item.type) : null;
      const has = !!(tp || item.text);
      const hasContent = !!(item.content && item.content.trim());
      const levelTag = s.level === "黄金" ? "green" : s.level === "小黄金" ? "orange" : s.level === "睡前" ? "blue" : "gray";
      const cls = s.level === "黄金" ? "gold" : s.level === "小黄金" ? "mini-gold" : s.level === "睡前" ? "bed" : "";
      const contentPreview = hasContent
        ? '<div class="slot-content">' + Core.escapeHtml(item.content.slice(0, 80)) + (item.content.length > 80 ? "…" : "") + "</div>"
        : "";
      return (
        '<div class="slot-card ' + cls + '">' +
          '<div class="slot-top"><span class="slot-t">' + s.time + "</span>" +
            '<span class="tag ' + levelTag + '">' + s.level + "档" + (live && !has ? " · 已过" : "") + "</span>" +
            (s.custom ? '<span class="tag purple">自定义</span>' : "") +
          "</div>" +
          '<div class="slot-desc">' + s.scene + " · " + s.title + "</div>" +
          '<div class="slot-types">' + s.types.map((x) => '<span class="tag gray">' + x + "</span>").join("") + "</div>" +
          (has
            ? '<div class="slot-plan">' +
                '<div class="slot-plan-main">' +
                  (tp ? '<span class="tag blue">选题</span>' : '<span class="tag orange">文案</span>') +
                  "<b>" + Core.escapeHtml(tp ? tp.title : item.text) + "</b>" +
                "</div>" +
                '<div class="slot-note">' + (item.status || "待排") + (t ? " · " + t.name : "") + "</div>" +
                contentPreview +
                '<div class="slot-content-act">' +
                  (hasContent
                    ? '<button class="btn ghost small" onclick="App.editSlotContent(\'' + s.id + '\')">编辑内容</button>'
                    : '<button class="btn soft small" onclick="App.genSlotContent(\'' + s.id + '\')">生成内容</button>') +
                  '<button class="btn ghost small" onclick="App.editSlotContent(\'' + s.id + '\')">自由创作</button>' +
                "</div>" +
              "</div>"
            : '<div class="slot-note">暂未安排 · 可点下方生成内容或去创作</div>') +
          '<div class="slot-act">' +
            (item.status === "待发布"
              ? '<button class="btn soft small" onclick="App.publishSlot(\'' + s.id + '\')">标记已发布</button>'
              : '<button class="btn ghost small" onclick="App.fillSlot(\'' + s.id + '\')">去创作</button>') +
            (has ? '<button class="btn ghost small" onclick="App.clearSlot(\'' + s.id + '\')">移出</button>' : "") +
            '<button class="btn ghost small" onclick="App.openSlotSheet(\'' + s.id + '\')">改时段</button>' +
            '<button class="btn ghost small" style="color:#FA5151" onclick="App.delSlot(\'' + s.id + '\')">删</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="page">' +
        UI.head("发布时间排期", "选题 + 时段 + 内容，自由搭配",
          '<button class="icon-btn round" onclick="App.openSlotSheet()">' + icon("plus", 19) + "</button>") +
        '<div class="notice">' + icon("clock", 15) +
          "<span>每天 0 点自动按今日选题生成一版排期与内容；可随时新增/删除时段、生成或编辑内容，所有操作自动留痕。</span>" +
        "</div>" +
        '<div class="section-title"><h2>今日选题</h2><span>' + planned + " / " + topicList.length + " 已安排</span></div>" +
        '<div class="card" style="padding:2px 14px">' + (topicRows || UI.empty("今天还没有选题，去选题库添加", "bulb")) + "</div>" +
        '<div class="section-title"><h2>今日时段</h2><span>' + Core.todayKey() + " · " + store.slots.length + " 个</span></div>" +
        cards +
        '<button class="btn ghost block mt12" onclick="App.openSlotSheet()">' + icon("plus", 16) + "新增自定义时段</button>" +
        '<div class="hint">' + icon("bulb", 14) +
          "<span>时段顺序按「黄金 40% 干货 / 30% 生活 / 20% 互动 / 10% 转化」推荐，每天 2-4 条，间隔至少 2 小时。可自由增删时段并搭配选题与内容。</span></div>" +
      "</div>"
    );
  }

  /* ---------- 人设资料库（注册用户自行填写） ---------- */
  function avatarHtml() {
    const u = store.user || {};
    if (u.avatar) {
      return '<div class="profile-avatar"><img src="' + Core.escapeHtml(u.avatar) + '" alt="头像" /></div>';
    }
    const ch = [...(u.name || "我")][0] || "我";
    return '<div class="profile-avatar">' + Core.escapeHtml(ch) + "</div>";
  }

  function renderProfile() {
    const u = store.user || {};
    const filled = store.profileSections.filter((s) => s.content).length;
    const rows = store.profileSections.map((s, i) =>
      '<div class="section-item" onclick="App.editSection(\'' + s.id + '\')">' +
        '<div class="section-num">' + (i + 1 < 10 ? "0" : "") + (i + 1) + "</div>" +
        '<div class="section-body"><b>' + s.title + "</b><span>" +
          (s.content ? Core.escapeHtml(s.summary) : "待填写 · 点击录入") + "</span></div>" +
        icon("right", 16) +
      "</div>"
    ).join("");

    return (
      '<div class="page">' +
        UI.head("让 AI 认识你", "填得越具体，生成的文案越像你", "", true) +
        '<div class="hint" style="margin-bottom:10px">' + icon("bulb", 14) +
          "<span>这里是给 AI 的「认识你」档案，不是对外展示的个人简介。它只作为 AI 理解你的背景，生成时用来把握身份、处境和语气，<b>不会把里面的内容原样写进文案</b>。</span>" +
        "</div>" +
        '<input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="App.onAvatarFile(this)" />' +
        '<div class="profile-hero">' +
          '<div class="avatar-wrap" onclick="App.pickAvatar()">' + avatarHtml() +
            '<i class="avatar-edit">换</i></div>' +
          '<div><div class="profile-name">' + Core.escapeHtml(u.name || "未设置昵称") +
            '<button class="btn soft small" style="margin-left:8px" onclick="App.editName()">改昵称</button></div>' +
            '<div class="profile-tag">' + Core.escapeHtml(u.tagline || "点击下方「一句话标签」完善资料") + "</div></div>" +
          '<span class="profile-badge' + (filled ? "" : " off") + '">' + (filled ? "已填 " + filled + "/7" : "待完善") + "</span>" +
        "</div>" +
        '<div class="prof-actions">' +
          '<button class="btn ghost small" onclick="App.editTagline()">一句话标签</button>' +
          '<button class="btn ghost small" onclick="App.editPerspectives()">身份标签</button>' +
          (u.avatar ? '<button class="btn ghost small" onclick="App.removeAvatar()">移除头像</button>' : "") +
        "</div>" +
        ((u.perspectives || []).length
          ? '<div class="persp">' + u.perspectives.map((p) => "<span>" + Core.escapeHtml(p) + "</span>").join("") + "</div>"
          : "") +
        '<div class="section-title"><h2>AI 需要了解你的信息</h2><span>' + filled + " / 7 已填写</span></div>" +
        '<div class="card" style="padding:2px 14px">' + rows + "</div>" +
        '<div class="hint">' + icon("shield", 14) +
          "<span>资料按登录账号独立保存，只给 AI 做背景参考：生成文案 / 选题 / 排期时会参考「身份 / 产品 / 客户 / 表达风格」，但不会把这些内容直接输出到文案里。</span>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---------- 历史记录 ---------- */
  // 图片 / 视频记录的缩略预览
  function histMedia(h) {
    const md = h.media || {};
    if (h.kind === "image") {
      const src = md.src || md.url || "";
      if (!src) return "";
      return '<img class="hist-media" src="' + Core.escapeHtml(src) + '" alt="" loading="lazy" onclick="App.previewHistoryMedia(\'' + h.id + '\')" />';
    }
    if (h.kind === "video") {
      if (md.url) return '<video class="hist-media" controls playsinline preload="metadata" src="' + Core.escapeHtml(md.url) + '"></video>';
      if (md.local) return '<div class="hist-media none">已保存到手机相册，可在相册播放</div>';
      return '<div class="hist-media none">未提供视频文件</div>';
    }
    return "";
  }

  function renderHistory() {
    const tab = ui.historyTab || "gen";
    let body = "";
    if (tab === "gen") {
      const rows = store.history.map((h) => {
        const t = Core.typeById(h.type);
        const media = histMedia(h);
        return (
          '<div class="hist-item">' +
            '<div class="hist-top">' +
              '<span class="tag ' + (h.status === "已拦截" ? "red" : "green") + '">' + h.status + "</span>" +
              '<span class="tag gray">' + (t ? t.name : h.typeName || "") + "</span>" +
              '<span class="tag blue">' + h.mode + "</span>" +
              '<span class="time">' + Core.timeAgo(h.time) + "</span>" +
            "</div>" +
            media +
            '<div class="hist-text">' + Core.escapeHtml(h.kind && h.kind !== "text" ? (h.title || h.text) : h.text) + "</div>" +
          "</div>"
        );
      }).join("");
      body = rows || UI.empty("还没有生成记录", "clock");
    } else if (tab === "audit") {
      body = auditListHtml();
    } else {
      body = store.blocks.map((b) =>
        '<div class="hist-item blocked">' +
          '<div class="hist-top"><span class="tag red">已拦截</span><span class="tag orange">' + b.category + "</span>" +
            '<span class="time">' + Core.timeAgo(b.time) + "</span></div>" +
          histMedia(b) +
          '<div class="block-detail">' +
            '<div class="block-row"><b>违规原因：</b>' + b.reason + "</div>" +
            '<div class="block-row"><b>违规内容：</b>' + Core.escapeHtml(b.original) + "</div>" +
            (b.replaced ? '<div class="block-row"><b>替换内容：</b><em>' + Core.escapeHtml(b.replaced) + "</em></div>" : "") +
            '<div class="block-row" style="color:#9AA0A7">来源：' + b.source + (b.word ? " · " + b.word : "") + "</div>" +
          "</div>" +
        "</div>"
      ).join("") || UI.empty("没有被拦截的记录，很好", "shield");
    }

    return (
      '<div class="page">' +
        UI.head("历史生成记录", "复盘、迭代与再次调用", "", true) +
        '<div class="tabs">' +
          '<button class="' + (tab === "gen" ? "active" : "") + '" onclick="App.setHistoryTab(\'gen\')">生成记录</button>' +
          '<button class="' + (tab === "block" ? "active" : "") + '" onclick="App.setHistoryTab(\'block\')">拦截记录 ' + store.blocks.length + "</button>" +
          '<button class="' + (tab === "audit" ? "active" : "") + '" onclick="App.setHistoryTab(\'audit\')">操作留痕 ' + (store.auditLog || []).length + "</button>" +
        "</div>" + body +
      "</div>"
    );
  }

  /* 操作留痕列表：选题 / 时段 / 素材 / 创作 / 排期 / 资料 的增删改记录 */
  const AUDIT_TYPE_META = {
    topic:    { label: "选题",   color: "#5B8FF9", bg: "#EEF3FF" },
    slot:     { label: "时段",   color: "#FF9F43", bg: "#FFF5E9" },
    material: { label: "素材",   color: "#07C160", bg: "#EAFBF1" },
    compose:  { label: "创作",   color: "#8B6CFF", bg: "#F2F0FF" },
    schedule: { label: "排期",   color: "#D48806", bg: "#FFF8E6" },
    profile:  { label: "资料",   color: "#576B95", bg: "#EEF3FF" }
  };
  const AUDIT_ACTION_META = {
    create: "新增", edit: "修改", delete: "删除", copy: "复制",
    assign: "排期", clear: "清空", login: "登录", signup: "注册",
    renew: "续费", push: "上传", pull: "拉取", generate: "生成"
  };
  function auditListHtml(filterType) {
    const list = (Core.auditList && Core.auditList(filterType)) || (store.auditLog || []);
    if (!list.length) return UI.empty("暂无操作留痕", "clock");
    return list.map((a) => {
      const meta = AUDIT_TYPE_META[a.type] || { label: a.type || "其他", color: "#8A8F99", bg: "#F0F1F5" };
      const act = AUDIT_ACTION_META[a.action] || a.action || "";
      return (
        '<div class="audit-item">' +
          '<span class="audit-tag" style="background:' + meta.bg + ";color:" + meta.color + '">' + meta.label + "</span>" +
          '<div class="audit-body">' +
            '<div class="audit-main"><b>' + Core.escapeHtml(a.target || "") + "</b>" +
              (act ? '<span class="audit-act">' + act + "</span>" : "") + "</div>" +
            (a.detail ? '<div class="audit-detail">' + Core.escapeHtml(a.detail) + "</div>" : "") +
            '<div class="audit-time">' + Core.timeAgo(a.ts) + "</div>" +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------- 合规检测 ---------- */
  function renderCompliance() {
    const r = ui.checkResult;
    const src = ui.checkInput || "";
    const byCat = {};
    store.words.forEach((w) => { (byCat[w.c] = byCat[w.c] || []).push(w.w); });

    const resultHtml = !r ? "" :
      '<div class="compliance ' + (r.passed ? "pass" : "fail") + '" style="margin-top:12px">' +
        '<div class="comp-head">' + icon(r.passed ? "shield" : "alert", 16) +
          (r.passed ? "检测通过，可以发布" : "检测到 " + r.count + " 处违规，已强制拦截") + "</div>" +
        '<div class="comp-desc">' + (r.passed ? "未命中词库中的任何风险词。" : "必须替换为安全版本后，才能复制 / 保存 / 发布。") + "</div>" +
        (r.violations || []).map((v) =>
          '<div class="vio"><div class="vio-head"><span class="tag red">' + v.category + '</span><span class="vio-word">' + Core.escapeHtml(v.word) + "</span></div>" +
          '<div class="vio-reason">' + v.reason + "</div>" +
          '<div class="vio-fix">建议替换为「' + Core.escapeHtml(v.suggestion) + "」</div></div>"
        ).join("") +
        (!r.passed ? '<div class="btn-row" style="margin-top:12px"><button class="btn danger" onclick="App.checkFix()">一键替换为合规版本</button></div>' : "") +
      "</div>";

    const groups = Object.keys(byCat).map((c) =>
      '<div class="word-group"><h4>' + c + " · " + byCat[c].length + ' 个</h4><div class="word-list">' +
        byCat[c].slice(0, 24).map((w) => "<span>" + w + "</span>").join("") +
      "</div></div>"
    ).join("");

    const rules = (store.rules && store.rules.length ? store.rules : (window.SEED.rules || []));
    const rulesHtml = rules.map((r) =>
      '<div class="rule-item">' +
        '<div class="rule-head">' + icon("shield", 14) + "<b>" + Core.escapeHtml(r.title) + "</b>" +
          '<span class="tag gray">' + Core.escapeHtml(r.org) + "</span></div>" +
        '<div class="rule-scope">' + Core.escapeHtml(r.scope) + "</div>" +
        (r.updatedAt ? '<div class="rule-date">官方更新 ' + Core.escapeHtml(r.updatedAt) + "</div>" : "") +
        '<div class="rule-action">平台处置：' + Core.escapeHtml(r.action) + "</div>" +
        ((r.excerpts && r.excerpts.length)
          ? '<div class="rule-excerpt">最新条款：' + r.excerpts.slice(0, 2).map((x) => "「" + Core.escapeHtml(x) + "」").join(" ") + "</div>"
          : "") +
      "</div>"
    ).join("");

    const live = ui.rules || {};
    const onlineHtml =
      '<div class="card auto-rule">' +
        '<div class="ar-head">' + icon("cloud", 15) +
          "<b>规则自动更新</b>" +
          '<span class="tag ' + (live.version ? "green" : "gray") + '">' + (live.version ? "已联网" : "未连接") + "</span>" +
        "</div>" +
        '<div class="ar-row"><span>在线版本</span><em>' + (live.version || store.rulesLiveVersion || "待同步") + "</em></div>" +
        '<div class="ar-row"><span>官方最新日期</span><em>' + (store.rulesUpdatedAt || "—") + "</em></div>" +
        '<div class="ar-row"><span>最近检查</span><em>' + (live.checkedAt || store.rulesCheckedAt || "—") + "</em></div>" +
        '<div class="ar-row"><span>检查频率</span><em>每天 00:00 自动</em></div>' +
        ((live.sources || []).length
          ? '<div class="ar-sources">' + live.sources.map((s) =>
              '<div class="ar-src"><i class="dot ' + (s.ok ? "on" : "off") + '"></i><span>' + Core.escapeHtml(s.title) + "</span>" +
              "<em>" + (s.updatedAt || "—") + "</em></div>").join("") + "</div>"
          : "") +
        (ui.rulesError ? '<div class="ar-err">' + Core.escapeHtml(ui.rulesError) + "</div>" : "") +
        '<button class="btn ghost small block" style="margin-top:10px" onclick="App.refreshRules(true)">' +
          (ui.rulesLoading ? "正在联网检查…" : "立即联网检查更新") + "</button>" +
      "</div>";

    return (
      '<div class="page">' +
        UI.head("合规检测", "依据微信官方规则 · 强制拦截", "", true) +
        '<div class="notice">' + icon("alert", 15) +
          "<span>覆盖 AI 生成、自由创作、上传的全部内容。按微信官方规范与广告法词库严格检测，命中即拦截，不提供跳过入口。</span>" +
        "</div>" +
        '<div class="section-title"><h2>检测依据</h2><span>' + rules.length + " 部规则</span></div>" +
        onlineHtml +
        '<div class="card rules-card">' + rulesHtml + "</div>" +
        '<div class="card" style="margin-top:12px">' +
          '<textarea class="textarea" rows="5" placeholder="把要发布的朋友圈文案粘贴到这里…" oninput="App.setCheckInput(this.value)">' + Core.escapeHtml(src) + "</textarea>" +
          '<button class="btn primary block mt12" onclick="App.runCheck()">' + icon("shield", 16) + "开始深度检测</button>" +
        "</div>" +
        resultHtml +
        '<div class="section-title"><h2>风险词库</h2><span>' + store.words.length + " 条</span></div>" +
        '<div class="card">' + groups + "</div>" +
        '<div class="hint">' + icon("bulb", 14) + "<span>词库依据微信官方规则与《广告法》持续更新，检测结果会同步归档到「合规检测」文件夹。</span></div>" +
      "</div>"
    );
  }

  /* ---------- 云端同步（Supabase） ---------- */
  function cloudCard() {
    const c = (store.settings && store.settings.cloud) || {};
    const on = !!window.Cloud;
    const configured = on && Cloud.configured();
    const session = on && Cloud.hasSession();
    const u = session ? Cloud.user() : null;
    const st = on ? Cloud.state() : {};
    const tag = session
      ? '<span class="tag green">已连接</span>'
      : configured ? '<span class="tag orange">未登录</span>' : '<span class="tag gray">未配置</span>';

    const account = session && u
      ? "已登录：" + Core.escapeHtml((u.email || "").replace(/@pyq\.local$/, ""))
      : "用手机号或邮箱注册 / 登录；手机号会自动转成 手机号@pyq.local";

    return (
      '<div class="section-title"><h2>云端同步</h2><span>网页版 / APP 互通</span></div>' +
      '<div class="card">' +
        '<div class="cloud-head">' + icon("cloud", 15) + "<b>Supabase 云端账号</b>" + tag + "</div>" +
        '<div class="muted" style="margin:6px 0 10px">在任意版本注册同一个云账号，资料、文案、素材、选题、排期都会自动互通。</div>' +
        '<div' + (session ? ' style="display:none"' : '') + '>' +
        '<div class="field"><label>Project URL</label>' +
          '<input class="input" id="clUrl" placeholder="https://xxxx.supabase.co" value="' + Core.escapeHtml(c.url || "") + '" /></div>' +
        '<div class="field"><label>anon public key</label>' +
          '<input class="input" id="clKey" placeholder="eyJhbGciOi..." value="' + Core.escapeHtml(c.key || "") + '" /></div>' +
        '<button class="btn ghost small block" onclick="App.saveCloudCfg()">保存云端配置</button>' +
        '<div class="field" style="margin-top:12px"><label>云账号（手机号 / 邮箱）</label>' +
          '<input class="input" id="clAccount" placeholder="13800138000 或 you@mail.com" value="' + Core.escapeHtml(c.account || "") + '" /></div>' +
        '<div class="field"><label>密码（6 位以上）</label>' +
          '<input class="input" id="clPwd" type="password" placeholder="登录密码" /></div>' +
        '<div class="btn-row">' +
          '<button class="btn ghost small" onclick="App.cloudAuth(\'up\')">注册并登录</button>' +
          '<button class="btn primary small" onclick="App.cloudAuth(\'in\')">登录</button>' +
        "</div>" +
        '<div class="muted" style="margin-top:8px">' + account + "</div>" + "</div>" +
        (session
          ? '<div class="muted">' + account + "</div>" +
            '<div class="btn-row" style="margin-top:12px">' +
              '<button class="btn soft small" onclick="App.cloudPushNow()">立即上传</button>' +
              '<button class="btn soft small" onclick="App.cloudPullNow()">从云端拉取</button>' +
              '<button class="btn ghost small" onclick="App.cloudSignOut()">退出云账号</button>' +
            "</div>" +
            '<div class="card" style="box-shadow:none;margin-top:10px;display:flex;align-items:center;justify-content:space-between">' +
              "<div><b style=\"font-size:13px\">自动同步</b><div class=\"muted\">保存后 2 秒自动上传；每 3 分钟拉取一次</div></div>" +
              '<label class="switch"><input type="checkbox" ' + (c.auto !== false ? "checked" : "") + ' onchange="App.toggleCloudAuto(this.checked)" /><i></i></label>' +
            "</div>" +
            '<div class="muted" style="margin-top:8px">上次上传：' + (st.lastPush ? Core.timeAgo(st.lastPush) : "—") +
              " · 上次拉取：" + (st.lastPull ? Core.timeAgo(st.lastPull) : "—") + "</div>" +
            (st.error ? '<div class="ar-err">' + Core.escapeHtml(st.error) + "</div>" : "")
          : "") +
      "</div>"
    );
  }

  /* ---------- 本地归档（已取消飞书云盘同步） ---------- */
  function renderSync() {
    const sync = ui.sync || {};
    const pending = (sync.pending || []).length;
    const stateText = sync.state === "busy" ? "归档中" : "本机归档";
    const dot = sync.state === "busy" ? "busy" : "";

    const maps = [
      ["个人资料库预设", "7 个资料文件"],
      ["文案创作", "8 类型 × AI 生成 / 自由创作"],
      ["选题库", "选题自动归档"],
      ["素材库", "文案 / 图片 / 视频"],
      ["历史生成记录", "生成 + 违规拦截记录"],
      ["发布时间排期", "每日排期表"],
      ["合规检测", "风险词库与拦截记录"]
    ].map(([a, b]) => '<div class="map-row"><span>' + a + "</span><em>" + b + "</em></div>").join("");

    const nativeMode = !!(window.NativeApp && NativeApp.available());

    // 存储位置：把三类内容的实际路径摊开，并提供一键导出（归档原本在私有目录，手机上看不到）
    const storageCard = nativeMode
      ? '<div class="section-title"><h2>内容存放位置</h2><span>手机上查看</span></div>' +
        '<div class="card">' +
          '<div class="map-row"><span>图片</span><em>内部存储 / Pictures / 朋友圈AI助手</em></div>' +
          '<div class="map-row"><span>视频</span><em>内部存储 / Movies / 朋友圈AI助手</em></div>' +
          '<div class="map-row"><span>文案归档</span><em>App 私有目录（手机上无法直接打开）</em></div>' +
          '<div class="muted" style="margin-top:8px">图片和视频已写入系统相册，打开「图库」即可看到「朋友圈AI助手」相册。文案/选题/排期保存在 App 私有目录，需点下方按钮导出到公共目录后才能用文件管理器查看。</div>' +
          '<button class="btn ghost block mt12" onclick="App.exportArchive()">导出归档到手机（Documents）</button>' +
          '<div class="server-test" id="exportResult" style="display:none"></div>' +
        "</div>"
      : "";

    return (
      '<div class="page">' +
        UI.head("云同步与本地归档", "跨版本同步 / 本机备份", "", true) +
        cloudCard() +
        '<div class="section-title"><h2>本机归档</h2><span>' + stateText + "</span></div>" +
        '<div class="sync-hero">' +
          '<div class="sync-top"><i class="sync-dot ' + dot + '"></i><span>' + stateText + "</span>" +
            '<span style="margin-left:auto;font-size:11px;color:rgba(255,255,255,.5)">' + (sync.last ? "上次 " + Core.timeAgo(sync.last) : "尚未归档") + "</span>" +
          "</div>" +
          '<div class="sync-path">📁 本机 App 目录 / 归档</div>' +
          '<div class="sync-nums">' +
            '<div><b>' + (sync.synced || 0) + '</b><span>本次已归档</span></div>' +
            '<div><b>' + pending + '</b><span>待归档</span></div>' +
            '<div><b>' + store.history.length + '</b><span>历史记录</span></div>' +
          "</div>" +
        "</div>" +

        (nativeMode
          ? '<div class="card mt12" style="display:flex;align-items:center;justify-content:space-between">' +
              '<div><b style="font-size:13.5px">保存后自动归档</b><div class="muted">生成、保存、改资料时自动写入本机</div></div>' +
              '<label class="switch"><input type="checkbox" ' + (sync.auto ? "checked" : "") + ' onchange="App.toggleAutoSync(this.checked)" /><i></i></label>' +
            "</div>" +
            '<button class="btn primary block mt12" onclick="App.syncNow()">' + icon("cloud", 17) +
              (sync.state === "busy" ? "正在归档…" : "立即归档到本机") + "</button>"
          : '<div class="card mt12"><b style="font-size:13.5px">网页版自动保存</b>' +
              '<div class="muted" style="margin-top:4px">内容实时保存在浏览器；登录云账号后与 App 版互通，无需本机归档。</div></div>') +

        (nativeMode && sync.error ? '<div class="compliance fail" style="margin-top:10px"><div class="comp-head">' + icon("alert", 15) + '归档未完成</div><div class="comp-desc">' + Core.escapeHtml(sync.error) + "</div></div>" : "") +

        storageCard +

        '<div class="section-title"><h2>本机归档目录</h2><span>与方案一致</span></div>' +
        '<div class="card">' + maps + "</div>" +
        '<div class="hint">' + icon("cloud", 14) +
          "<span>" + (nativeMode
            ? "内容默认保存在本机；登录云账号后会自动上传到你的 Supabase，与网页版互通。图片/视频进手机相册，文案/选题/排期归档到 App 私有目录，需要查看时点上方按钮导出到 Documents。"
            : "网页版内容保存在浏览器本地；登录云账号后，资料、文案、素材、选题、排期会与 App 版自动互通。") +
          "</span>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---------- AI 模型接入 ---------- */
  function aiField(id, label, value, placeholder, type) {
    return '<div class="field"><label>' + label + '</label><input class="input" id="' + id +
      '" type="' + (type || "text") + '" placeholder="' + placeholder + '" value="' + Core.escapeHtml(value || "") + '" /></div>';
  }

  function aiPresetChips(kind) {
    const list = (window.App && App.aiPresets ? App.aiPresets()[kind] : []) || [];
    return '<div class="chips" style="margin:-4px 0 10px">' + list.map((p) =>
      '<button class="chip small" onclick="App.aiPreset(\'' + kind + '\',\'' + p.id + '\')">' + p.name + "</button>"
    ).join("") + "</div>";
  }

  function aiSecHead(ic, title, state) {
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
      '<span style="color:#7A5AF8">' + icon(ic, 16) + "</span>" +
      '<b style="font-size:14px">' + title + "</b>" +
      '<em style="margin-left:auto;font-style:normal;font-size:11px;color:#8A8F99">' + state + "</em>" +
      "</div>";
  }

  /* ---------- 云端媒体审核卡片 ---------- */
  function renderModerationCard(ai) {
    const mod = (ai && ai.moderate) || {};
    const providers = [
      { id: "zhipu", name: "智谱视觉（免费额度最多）", hint: "open.bigmodel.cn 注册拿 API Key，每月有免费额度" },
      { id: "tencent", name: "腾讯云 IM（TC3 签名）", hint: "ims.tencentcloudapi.com，需 SecretId / SecretKey，ap-guangzhou 区域" },
      { id: "alibaba", name: "阿里云绿网（HMAC-SHA1）", hint: "green.cn-shanghai.aliyuncs.com，需 AccessKeyId / AccessKeySecret" },
      { id: "proxy", name: "自建代理（网页版/通用）", hint: "用户自建 Node/Python 代理，代理持签名密钥，前端只给代理 URL" }
    ];
    const provStatus = !mod.enabled ? "已关闭（仅本地浅检）" :
      mod.provider === "proxy" ? (mod.proxyUrl ? "自建代理" : "代理未配置") :
      (mod.provider === "zhipu" ? (mod.apiKey ? "智谱视觉" : "未填 Key") :
      mod.provider === "tencent" ? ((mod.secretId && mod.secretKey) ? "腾讯云 IM" : "密钥未填") :
      mod.provider === "alibaba" ? ((mod.secretId && mod.secretKey) ? "阿里云绿网" : "密钥未填") :
      mod.provider);

    const selected = mod.provider || "zhipu";
    const enabled = !!mod.enabled;

    // 根据选中的提供商动态显示输入框
    let providerFields = "";
    if (selected === "zhipu") {
      providerFields =
        aiField("aiModZhipuKey", "智谱 API Key", mod.apiKey || "", "在 bigmodel.cn 控制台获取", "password");
    } else if (selected === "tencent") {
      providerFields =
        aiField("aiModTencentSid", "SecretId", mod.secretId || "", "腾讯云访问管理里获取") +
        aiField("aiModTencentSkey", "SecretKey", mod.secretKey || "", "腾讯云访问管理里获取", "password") +
        aiField("aiModTencentRegion", "区域 Region", mod.region || "ap-guangzhou", "ap-guangzhou （默认华南）");
    } else if (selected === "alibaba") {
      providerFields =
        aiField("aiModAlibabaAk", "AccessKeyId", mod.secretId || "", "阿里云访问控制 RAM 里获取") +
        aiField("aiModAlibabaSk", "AccessKeySecret", mod.secretKey || "", "阿里云访问控制 RAM 里获取", "password");
    } else if (selected === "proxy") {
      providerFields =
        aiField("aiModProxyUrl", "自建代理地址", mod.proxyUrl || "", "https://your-proxy.example.com") +
        '<div class="hint" style="margin-bottom:10px">' + icon("shield", 13) +
          "<span>代理须支持 POST /moderate，body 包含 {provider, task, fileBase64, mimeType}；代理端完成签名后返回归一化结果。</span></div>";
    }

    const providerOptions = providers.map((p) =>
      '<option value="' + p.id + '"' + (selected === p.id ? " selected" : "") + ">" + p.name + "</option>"
    ).join("");
    const currentHint = (providers.find((p) => p.id === selected) || {}).hint || "";

    return (
      '<div class="card mt12">' +
        aiSecHead("shield", "云端媒体审核", provStatus) +
        '<div class="muted" style="margin:0 0 8px">在本地浅检（文件名/格式/大小/EXIF）之后，把图片/视频送到云端做画面语义审核。App 内原生 HTTP + 原生签名，密钥不暴露；网页版只能走自建代理。</div>' +
        '<div class="field"><label style="display:flex;align-items:center;gap:8px">' +
          '<input type="checkbox" id="aiModerateEnabled"' + (enabled ? " checked" : "") + ' style="width:18px;height:18px;accent-color:#7A5AF8" />' +
          "<b>开启云端深度审核</b>（关闭时仅本地浅检）</label></div>" +
        '<div class="field"><label>审核服务提供商</label>' +
          '<select class="input" id="aiModerateProvider" onchange="App.go(\'ai\')">' +
          providerOptions + "</select></div>" +
        '<div class="hint" style="margin:-4px 0 10px">' + icon("alert", 13) +
          "<span>" + currentHint + "</span></div>" +
        providerFields +
        '<button class="btn soft block" onclick="App.aiTest(\'moderate\')">测试云端审核</button>' +
      "</div>"
    );
  }

  function renderAI() {
    const ai = (store.settings && store.settings.ai) || {};
    const t = ai.text || {}, im = ai.image || {}, vd = ai.video || {};
    return (
      '<div class="page">' +
        UI.head("AI 模型接入", "文案 / 图片 / 视频 · 支持免费模型", "", true) +
        '<div class="hint" style="margin-bottom:12px">' + icon("shield", 13) +
          "<span>全部走 OpenAI 兼容协议，Key 只保存在本机。带「免费」的预设注册后即可领取免费额度；图片免费通道连 Key 都不用填。</span></div>" +

        '<div class="card">' +
          aiSecHead("spark", "文案生成", t.base && t.key ? "已接入" : "未配置") +
          '<div class="muted" style="margin:0 0 8px">用于「创作」页的 AI 生成与润色；未配置时自动使用本地模板。</div>' +
          aiPresetChips("text") +
          aiField("aiTextBase", "接口地址", t.base, "https://open.bigmodel.cn/api/paas/v4") +
          aiField("aiTextKey", "API Key", t.key, "在 bigmodel.cn 控制台获取", "password") +
          aiField("aiTextModel", "模型", t.model || "glm-4-flash", "glm-4-flash") +
          '<button class="btn soft block" onclick="App.aiTest(\'text\')">测试文案模型</button>' +
        "</div>" +

        '<div class="card mt12">' +
          aiSecHead("image", "图片生成", im.mode === "free" ? "免费通道" : (im.base && im.key ? "自定义接口" : "未配置")) +
          '<div class="muted" style="margin:0 0 8px">免费通道由 Pollinations 提供，无需 Key；也可填自己的 OpenAI 兼容图片接口。</div>' +
          aiPresetChips("image") +
          '<div class="field"><label>通道</label><select class="input" id="aiImageMode">' +
            '<option value="free"' + (im.mode === "free" ? " selected" : "") + ">免费通道（无需 Key）</option>" +
            '<option value="custom"' + (im.mode === "custom" ? " selected" : "") + ">自定义接口</option>" +
          "</select></div>" +
          aiField("aiImageBase", "接口地址（自定义时填写）", im.base, "https://api.openai.com/v1") +
          aiField("aiImageKey", "API Key（自定义时填写）", im.key, "sk-...", "password") +
          aiField("aiImageModel", "模型", im.model, "gpt-image-1 / cogview-3-flash") +
          aiField("aiImageSize", "尺寸", im.size, "1024x1024") +
          '<button class="btn soft block" onclick="App.aiTest(\'image\')">测试图片接口</button>' +
        "</div>" +

        '<div class="card mt12">' +
          aiSecHead("video", "视频生成", vd.base && vd.key ? "已接入" : "未配置") +
          '<div class="muted" style="margin:0 0 8px">使用智谱 CogVideoX 免费模型，异步生成，约 1-3 分钟；需在 App 内使用。</div>' +
          aiPresetChips("video") +
          aiField("aiVideoBase", "接口地址", vd.base, "https://open.bigmodel.cn/api/paas/v4") +
          aiField("aiVideoKey", "API Key", vd.key, "在 bigmodel.cn 控制台获取", "password") +
          aiField("aiVideoModel", "模型", vd.model || "cogvideox-flash", "cogvideox-flash") +
          '<button class="btn soft block" onclick="App.aiTest(\'video\')">检查视频配置</button>' +
        "</div>" +

        renderModerationCard(ai) +

        '<button class="btn primary block mt12" onclick="App.aiSaveSettings()">保存 AI 模型设置</button>' +
        '<div class="hint" style="margin-top:12px">' + icon("spark", 13) +
          "<span>省事方案：文案和视频都用智谱（同一个 Key，注册一次即可），图片直接用免费通道，零配置。</span></div>" +
      "</div>"
    );
  }

  /* ---------- 我的 ---------- */
  function memberStatus(m) {
    if (!m) return "未开通";
    if (m.tier === 4 && m.daysLeft === -1) return "永久会员 · 无限期";
    if (m.tier >= 1 && m.expiresAt > Date.now()) return m.tierName + " · 剩余 " + m.daysLeft + " 天";
    if (m.trialEndsAt > Date.now()) return "免费试用 · 剩余 " + m.daysLeft + " 天";
    return "免费试用已到期";
  }

  function aiMenuNote() {
    const ai = (store.settings && store.settings.ai) || {};
    const t = ai.text || {}, im = ai.image || {}, vd = ai.video || {}, mod = ai.moderate || {};
    const imgState = im.mode === "free" ? "图片免费通道" : (im.base && im.key ? "图片自定义" : "图片未配置");
    const modState = !mod.enabled ? "云审关闭" :
      mod.provider === "proxy" ? (mod.proxyUrl ? "云审代理" : "云审未填代理") :
      (mod.provider === "zhipu" ? (mod.apiKey ? "云审智谱" : "云审未填 Key") :
      mod.provider === "tencent" ? ((mod.secretId && mod.secretKey) ? "云审腾讯" : "云审未填密钥") :
      mod.provider === "alibaba" ? ((mod.secretId && mod.secretKey) ? "云审阿里" : "云审未填密钥") : "云审已开启");
    return (t.base && t.key ? "文案已接入" : "文案未配置") + " · " + imgState + (vd.base && vd.key ? " · 视频已接入" : "") + " · " + modState;
  }

  function renderMore() {
    const me = (window.Auth && Auth.current) || null;
    const mm = (me && me.member) || null;
    const menu = [
      ["account", "shield", "#FFF1F0", "#FA5151", "账号与安全", me ? (me.masked || "已登录") : "未登录"],
      ["member", "star", "#FFF8E6", "#D48806", "会员中心", memberStatus(mm)],
      ["profile", "user", "#EAFBF1", "#07C160", "让 AI 认识你", "AI 背景档案 · " + store.profileSections.filter((s) => s.content).length + "/7 已填写"],
      ["history", "clock", "#EEF3FF", "#5B8FF9", "历史生成记录", store.history.length + " 条"],
      ["logs", "shield", "#FFF8E6", "#D48806", "系统日志", (store.auditLog || []).length + " 条留痕"],
      ["compliance", "shield", "#FFF1F0", "#FA5151", "合规检测", store.words.length + " 条词库"],
      ["ai", "spark", "#F2F0FF", "#7A5AF8", "AI 模型接入", aiMenuNote()],
      ["schedule", "calendar", "#FFF5E9", "#FF9F43", "发布时间排期", store.slots.length + " 个时段"],
      ["sync", "cloud", "#E9F8F7", "#38B2AC", "云同步与归档", (window.Cloud && Cloud.hasSession) ? (Cloud.hasSession() ? "已连接云端" : "未登录云端") : "本机存储"],
      ["update", "refresh", "#F0F1F5", "#4E5969", "检查更新", updateMenuNote()],
      ["contact", "user", "#F2F0FF", "#7A5AF8", "联系开发者", "微信号 " + (window.Auth ? Auth.wxId : "zhiyao0a1")]
    ].map(([page, ic, bg, color, label, note]) =>
      '<div class="menu-item" onclick="App.go(\'' + page + '\')">' +
        '<div class="menu-icon" style="background:' + bg + ";color:" + color + '">' + icon(ic, 16) + "</div>" +
        "<b>" + label + "</b><span>" + note + "</span>" + icon("right", 16) +
      "</div>"
    ).join("");

    return (
      '<div class="page">' +
        UI.head("我的", "朋友圈运营工作台") +
        '<div class="profile-hero" onclick="App.go(\'profile\')" style="cursor:pointer">' +
          avatarHtml() +
          "<div><div class=\"profile-name\">" + Core.escapeHtml(store.user.name || (me ? (me.name || me.masked || me.phone) : "未登录")) + "</div>" +
          '<div class="profile-tag">' + Core.escapeHtml(store.user.tagline || (me ? me.masked : "请先注册登录")) + "</div></div>" +
          '<span class="profile-badge">' + (me ? (mm && mm.tier === 4 && mm.daysLeft === -1 ? "永久会员" : (mm && mm.tier >= 1 && mm.expiresAt > Date.now() ? mm.tierName : (mm && mm.trialEndsAt > Date.now() ? "试用中" : "已登录"))) : "点击登录") + '</span>' +
        "</div>" +
        '<div class="stat-row">' +
          '<div class="stat"><b>' + store.drafts.length + '</b><span>草稿</span></div>' +
          '<div class="stat"><b>' + store.history.length + '</b><span>生成记录</span></div>' +
          '<div class="stat"><b>' + store.blocks.length + '</b><span>拦截记录</span></div>' +
        "</div>" +
        '<div class="section-title"><h2>功能与设置</h2></div>' +
        '<div class="menu-card">' + menu + "</div>" +
        '<div class="hint" style="margin-top:16px;justify-content:center">' + icon("shield", 13) +
          "<span>朋友圈 AI 助手 v1.2 · 手机号登录 · 会员制</span>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---------- 会员中心 ---------- */
  function renderMember() {
    const me = (window.Auth && Auth.current) || null;
    const m = (me && me.member) || null;
    const tiers = (window.Auth && Auth.tiers) || [];
    const active = m && Auth.memberActive(m);
    const badge = !m ? "未开通" : m.tier === 4 && m.daysLeft === -1 ? "永久会员" : m.tier >= 1 && m.expiresAt > Date.now() ? m.tierName : m.trialEndsAt > Date.now() ? "免费试用" : "已到期";

    const cards = tiers.map((t) =>
      '<div class="m-tier" onclick="Auth.showPay(' + t.tier + ')">' +
        '<div class="m-tier-l"><div class="m-tier-name">' + t.name + '<i>' + t.tag + "</i></div>" +
          '<div class="m-tier-days">' + (t.days ? "有效期 " + t.days + " 天" : "无限期使用") + "</div></div>" +
        '<div class="m-tier-r"><b>¥' + t.price + '</b><button class="btn soft small">立即开通</button></div>' +
      "</div>"
    ).join("");

    const expireLine = m
      ? (m.tier === 4 && m.daysLeft === -1
          ? "已开通永久会员，无需续费"
          : m.tier >= 1 && m.expiresAt > Date.now()
            ? "到期时间：" + new Date(m.expiresAt).toLocaleDateString("zh-CN") + "（剩余 " + m.daysLeft + " 天）"
            : m.trialEndsAt > Date.now()
              ? "试用到期：" + new Date(m.trialEndsAt).toLocaleDateString("zh-CN") + "（剩余 " + m.daysLeft + " 天）"
              : "免费试用已结束，开通会员后继续使用")
      : "登录后自动开启 7 天免费试用";

    return (
      '<div class="page">' +
        UI.head("会员中心", "免费试用 7 天 · 4 档会员", "", true) +
        '<div class="m-hero' + (active ? "" : " off") + '">' +
          '<div class="m-hero-top"><span class="m-crown">VIP</span><span class="m-badge">' + badge + "</span></div>" +
          '<div class="m-hero-name">' + (m && m.tier >= 1 && m.tier !== 0 ? m.tierName : (m && m.trialEndsAt > Date.now() ? "免费试用中" : "会员未开通")) + "</div>" +
          '<div class="m-hero-desc">' + expireLine + "</div>" +
        "</div>" +
        '<div class="section-title"><h2>选择会员档位</h2><span>随时可升级</span></div>' +
        '<div class="card m-tiers">' + cards + "</div>" +
        '<div class="card mt12" style="display:flex;flex-direction:column;gap:10px">' +
          '<div class="m-row" onclick="Auth.vipView(\'code\')"><span>已有激活码</span><em>去激活 ›</em></div>' +
          '<div class="m-row" onclick="App.go(\'contact\')"><span>联系开发者</span><em>微信号 ' + Auth.wxId + " ›</em></div>" +
        "</div>" +
        '<div class="hint" style="margin-top:14px">' + icon("shield", 13) +
          "<span>免费试用从首次注册登录开始计算 7 天；付费会员从付费日计算，到期需续费才能继续使用。</span>" +
        "</div>" +
        '<div class="dev-entry" onclick="Auth.openDevTool()">开发者激活码生成</div>' +
      "</div>"
    );
  }

  /* ---------- 检查更新 ---------- */
  function curVer() {
    return (window.App && App.currentVersion) ? App.currentVersion() : { code: 0, name: "网页版" };
  }

  function updateMenuNote() {
    const s = (window.App && App.updateState) ? App.updateState() : null;
    if (s && s.state === "done") {
      if (s.hasNew) return "有新版本 v" + ((s.latest && s.latest.versionName) || "");
      return "已是最新";
    }
    if (s && s.state === "error") return "点此重试";
    return "当前 v" + curVer().name;
  }

  function fmtSize(n) {
    const v = Number(n) || 0;
    if (!v) return "";
    return v > 1048576 ? (v / 1048576).toFixed(1) + " MB" : Math.round(v / 1024) + " KB";
  }

  function renderUpdate() {
    const s = (window.App && App.updateState) ? App.updateState() : { state: "idle" };
    const cur = curVer();
    const nativeMode = !!(window.NativeApp && NativeApp.available());
    // 进入页面自动检查一次
    if (s.state === "idle" && !s.auto) {
      s.auto = true;
      setTimeout(() => { if (window.App) App.checkUpdate(); }, 80);
    }
    const latest = s.latest || {};
    const notes = (Array.isArray(latest.notes) ? latest.notes : [])
      .slice(0, 8)
      .map((t) => '<div class="map-row"><span>' + Core.escapeHtml(String(t)) + "</span></div>")
      .join("");

    let body = "";
    if (s.state === "checking") {
      body = '<div class="card mt12"><div class="muted">正在联网检查更新…</div></div>';
    } else if (s.state === "install") {
      body = '<div class="card mt12"><div class="muted">正在下载安装包，请保持网络畅通，不要退出 App…</div></div>';
    } else if (s.state === "error") {
      body = '<div class="compliance fail mt12"><div class="comp-head">' + icon("alert", 15) +
        '检查失败</div><div class="comp-desc">' + Core.escapeHtml(s.error || "无法连接更新服务") + "</div></div>";
    } else if (s.state === "done" && s.hasNew) {
      body = '<div class="card mt12">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<b style="font-size:14px">发现新版本 v' + Core.escapeHtml(latest.versionName || "") + "</b>" +
          '<em style="font-style:normal;font-size:12px;color:#9AA0A6">当前 v' + Core.escapeHtml(cur.name) + "</em>" +
        "</div>" +
        (notes ? '<div style="margin-top:10px">' + notes + "</div>" : "") +
        '<div class="muted" style="margin-top:10px">' +
          (latest.size ? "安装包 " + fmtSize(latest.size) + "，" : "") +
          "覆盖安装后，本机文案、资料与会员状态都会保留。</div>" +
        (nativeMode
          ? '<button class="btn primary block mt12" onclick="App.installUpdate()">' +
            icon("refresh", 16) + "立即更新到 v" + Core.escapeHtml(latest.versionName || "") + "</button>"
          : '<div class="muted" style="margin-top:10px">网页版无法安装更新，请在 App 内点「检查更新」完成升级。</div>') +
        "</div>";
    } else if (s.state === "done") {
      body = '<div class="card mt12">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          "<b style=\"font-size:14px\">已是最新版本</b>" +
          '<em style="font-style:normal;font-size:12px;color:#9AA0A6">v' + Core.escapeHtml(cur.name) + "</em>" +
        "</div>" +
        (s.checkedAt ? '<div class="muted" style="margin-top:6px">检查时间：' + Core.timeAgo(s.checkedAt) + "</div>" : "") +
        "</div>";
    } else {
      body = '<div class="card mt12"><div class="muted">点下方按钮联网检查是否有新版本。</div></div>';
    }

    return (
      '<div class="page">' +
        UI.head("检查更新", "联网获取最新版本", "", true) +
        '<div class="card mt12">' +
          '<div style="display:flex;align-items:center;justify-content:space-between">' +
            '<b style="font-size:13.5px">当前版本</b>' +
            '<em style="font-style:normal;font-size:12px;color:#9AA0A6">v' + Core.escapeHtml(cur.name) +
              (cur.code ? "（" + cur.code + "）" : "") + "</em>" +
          "</div>" +
        "</div>" +
        body +
        (s.error && s.state !== "error"
          ? '<div class="compliance fail mt12"><div class="comp-head">' + icon("alert", 15) +
            '更新未完成</div><div class="comp-desc">' + Core.escapeHtml(s.error) + "</div></div>"
          : "") +
        '<button class="btn ghost block mt12" onclick="App.checkUpdate()">' + icon("refresh", 16) +
          (s.state === "checking" ? "检查中…" : "检查更新") + "</button>" +
        '<div class="card mt12">' +
          '<b style="font-size:13.5px">永久更新下载源（备用）</b>' +
          '<div class="muted" style="margin-top:4px">内置更新源全部失效或下载中断时才会启用这里填写的地址。可填 version.json 清单地址，也可直接填 APK 下载直链。</div>' +
          '<div class="field" style="margin-top:8px"><label>备用地址</label>' +
            '<input class="input" id="updSrc" placeholder="https://…/version.json 或 https://…/app.apk" value="' +
              Core.escapeHtml((store.settings && store.settings.updateUrl) || "") + '" /></div>' +
          '<button class="btn ghost small block" onclick="App.saveUpdateUrl()">保存并重新检查</button>' +
        "</div>" +
        '<div class="hint" style="margin-top:14px">' + icon("refresh", 13) +
          "<span>" + (nativeMode
            ? "更新为覆盖安装，不会清除本机已生成的文案、资料与会员状态。首次更新需在系统提示里允许「安装未知应用」。"
            : "网页版无法安装更新，升级请在手机 App 内点「检查更新」完成。") +
          "</span>" +
        "</div>" +
      "</div>"
    );
  }

  function renderContact() {
    const wx = (window.Auth && Auth.wxId) || "zhiyao0a1";
    return (
      '<div class="page">' +
        UI.head("联系开发者", "开通会员 / 问题反馈", "", true) +
        '<div class="card mt12 contact-card">' +
          '<div class="wx-head">' +
            '<div class="wx-avatar"><span>知</span>' +
              '<img src="assets/wx-avatar.png" alt="知遥读书头像" onerror="this.remove()" /></div>' +
            '<div class="wx-info"><div class="wx-name">知遥读书</div>' +
              '<div class="wx-city">云南 昆明</div></div>' +
          "</div>" +
          '<div class="contact-qr"><img src="assets/qr-wechat.png" alt="开发者微信二维码" ' +
            'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'qr-miss\')" /></div>' +
          '<div class="contact-tip">扫二维码，添加我为朋友</div>' +
          '<div class="contact-wx">微信号 <b>' + Core.escapeHtml(wx) + '</b>' +
            '<button class="btn soft small" onclick="Auth.copyWx()">复制微信号</button></div>' +
          '<div class="muted" style="margin-top:10px;line-height:1.6">添加时请备注「朋友圈 AI 助手」，并说明你的手机号与所选会员档位，支付后即可获取激活码。</div>' +
        "</div>" +
        '<div class="card mt12">' +
          '<div class="m-row" onclick="App.go(\'member\')"><span>查看会员档位</span><em>月 / 季 / 年 / 二年 ›</em></div>' +
          '<div class="m-row" onclick="Auth.vipView(\'code\')"><span>输入激活码</span><em>已付费用户 ›</em></div>' +
        "</div>" +
        '<div class="hint" style="margin-top:14px;justify-content:center">' + icon("user", 13) +
          "<span>开发者微信：" + Core.escapeHtml(wx) + "</span>" +
        "</div>" +
      "</div>"
    );
  }

  function renderAccount() {
    const me = (window.Auth && Auth.current) || null;
    if (!me) {
      // 未登录直接弹登录遮罩并返回首页
      setTimeout(() => { if (window.Auth) Auth.show(); }, 0);
      return (
        '<div class="page">' +
          UI.head("账号与安全", "先登录才能使用完整功能", "", true) +
          '<div class="card mt12 auth-warn">' +
            '<div><b>尚未登录</b><div class="muted">请先注册手机号并设置密码，注册即开启 7 天免费试用</div></div>' +
            '<button class="btn primary" onclick="Auth.show()">去登录</button>' +
          '</div>' +
        "</div>"
      );
    }
    return (
      '<div class="page">' +
        UI.head("账号与安全", "昵称 · 手机号 · 密码", "", true) +
        '<input type="file" id="avatarInput" accept="image/*" style="display:none" onchange="App.onAvatarFile(this)" />' +
        '<div class="profile-hero" style="cursor:default">' +
          '<div class="avatar-wrap" onclick="App.pickAvatar()">' + avatarHtml() + '<i class="avatar-edit">换</i></div>' +
          '<div><div class="profile-name">' + Core.escapeHtml(store.user.name || me.name || "未设置昵称") + '</div>' +
            '<div class="profile-tag">' + me.masked + " · 当前登录中</div></div>" +
          '<span class="profile-badge">已验证</span>' +
        '</div>' +
        '<div class="card mt12">' +
          '<div class="section-item" onclick="App.editName()">' +
            '<div class="section-num" style="width:auto;height:auto;background:transparent;color:#14171A;font-size:15px">👤</div>' +
            '<div class="section-body"><b>修改昵称</b><span>' + Core.escapeHtml(store.user.name || "未设置") + '</span></div>' +
            icon("right", 16) +
          '</div>' +
          '<div class="section-item" onclick="App.pickAvatar()">' +
            '<div class="section-num" style="width:auto;height:auto;background:transparent;color:#14171A;font-size:15px">🖼️</div>' +
            '<div class="section-body"><b>更换头像</b><span>' + (store.user.avatar ? "已设置" : "未设置") + '</span></div>' +
            icon("right", 16) +
          '</div>' +
          '<div class="section-item" onclick="App.go(\'member\')">' +
            '<div class="section-num" style="width:auto;height:auto;background:transparent;color:#D48806;font-size:15px">⭐</div>' +
            '<div class="section-body"><b>会员状态</b><span>' + memberStatus(me.member) + '</span></div>' +
            icon("right", 16) +
          '</div>' +
          '<div class="section-item" onclick="App.openChangePassword()">' +
            '<div class="section-num" style="width:auto;height:auto;background:transparent;color:#14171A;font-size:15px">🔐</div>' +
            '<div class="section-body"><b>修改登录密码</b><span>原密码 + 新密码</span></div>' +
            icon("right", 16) +
          '</div>' +
          '<div class="section-item" onclick="App.logout()">' +
            '<div class="section-num" style="width:auto;height:auto;background:transparent;color:#FA5151;font-size:15px">🚪</div>' +
            '<div class="section-body"><b style="color:#FA5151">退出登录</b><span>再次打开需重新登录</span></div>' +
            icon("right", 16) +
          '</div>' +
        '</div>' +
        '<div class="hint" style="margin-top:14px;justify-content:center">' + icon("shield", 13) +
          '<span>账号与密码保存在本设备，密码仅存哈希、不上传明文；会员状态同样保存在本机。</span>' +
        '</div>' +
      "</div>"
    );
  }

  /* ---------- 系统日志：账号 / 资料 / 会员 / 同步 / 归档 ---------- */
  function renderLogs() {
    const tabs = [
      { id: "account", label: "账号", types: ["account"] },
      { id: "profile", label: "资料", types: ["profile"] },
      { id: "member", label: "会员", types: ["member"] },
      { id: "sync", label: "同步归档", types: ["sync", "archive"] }
    ];
    const cur = ui.logsTab || "account";
    const active = tabs.find((t) => t.id === cur) || tabs[0];
    const all = store.auditLog || [];
    const rows = all.filter((a) => active.types.indexOf(a.type) >= 0);

    const tabBtns = tabs.map((t) => {
      const cnt = all.filter((a) => t.types.indexOf(a.type) >= 0).length;
      return '<button class="' + (cur === t.id ? "active" : "") + '" onclick="App.setLogsTab(\'' + t.id + '\')">' + t.label + " " + cnt + "</button>";
    }).join("");

    const SYS_META = {
      account: { color: "#5B8FF9", bg: "#EEF3FF" },
      member:  { color: "#D48806", bg: "#FFF8E6" },
      sync:    { color: "#38B2AC", bg: "#E9F8F7" },
      archive: { color: "#07C160", bg: "#EAFBF1" },
      profile: { color: "#576B95", bg: "#EEF3FF" }
    };
    const list = rows.map((a) => {
      const meta = SYS_META[a.type] || { color: "#8A8F99", bg: "#F0F1F5" };
      const act = AUDIT_ACTION_META[a.action] || a.action || "";
      return (
        '<div class="audit-item">' +
          '<span class="audit-tag" style="background:' + meta.bg + ";color:" + meta.color + '">' + (a.type || "") + "</span>" +
          '<div class="audit-body">' +
            '<div class="audit-main"><b>' + Core.escapeHtml(a.target || "") + "</b>" +
              (act ? '<span class="audit-act">' + act + "</span>" : "") + "</div>" +
            (a.detail ? '<div class="audit-detail">' + Core.escapeHtml(a.detail) + "</div>" : "") +
            '<div class="audit-time">' + Core.timeAgo(a.ts) + "</div>" +
          "</div>" +
        "</div>"
      );
    }).join("");

    // 会员状态展示
    const me = (window.Auth && Auth.current) || null;
    const mm = (me && me.member) || null;
    const memberLine = mm
      ? (mm.tier === 4 && mm.daysLeft === -1 ? "永久会员 · 无限期"
        : mm.tier >= 1 && mm.expiresAt > Date.now() ? mm.tierName + " · 剩余 " + mm.daysLeft + " 天"
        : mm.trialEndsAt > Date.now() ? "免费试用 · 剩余 " + mm.daysLeft + " 天"
        : "会员已到期")
      : "未登录";

    return (
      '<div class="page">' +
        UI.head("系统日志", "账号 · 资料 · 会员 · 同步 · 归档", "", true) +
        '<div class="card logs-status">' +
          '<div class="ls-row"><span>当前账号</span><em>' + Core.escapeHtml((me && (me.name || me.masked || me.phone)) || "未登录") + "</em></div>" +
          '<div class="ls-row"><span>会员状态</span><em>' + memberLine + "</em></div>" +
          '<div class="ls-row"><span>日志总数</span><em>' + all.length + " 条（保留最近 500 条）</em></div>" +
        "</div>" +
        '<div class="tabs">' + tabBtns + "</div>" +
        (list || UI.empty("该分类暂无日志", "clock")) +
        '<div class="hint">' + icon("shield", 14) +
          "<span>系统日志自动记录账号登录注册、资料增删改、会员开通续费、云端同步与本地归档，方便追溯。</span></div>" +
      "</div>"
    );
  }

  window.ViewsMore = { renderSchedule, renderProfile, renderHistory, renderCompliance, renderSync, renderMore, renderAccount, renderMember, renderContact, renderUpdate, renderLogs, renderAI };
})();
