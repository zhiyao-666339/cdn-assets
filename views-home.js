/* 页面：工作台 + 文案创作入口 */
(function () {
  const { store, ui } = Core;
  const icon = UI.icon;

  function greeting() {
    const h = Core.now().getHours();
    if (h < 6) return "凌晨好";
    if (h < 11) return "早上好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  }

  function dateLine() {
    const d = Core.now();
    const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 · " + week;
  }

  function renderHome() {
    const pendingSync = (ui.sync.pending || []).length;
    const slots = store.slots;
    const today = store.schedule || [];
    const sentCount = today.filter((x) => x.status === "已发布").length;
    const todoCount = today.filter((x) => x.status !== "已发布").length;
    const blocked = store.blocks.length;

    const slotRows = today.slice(0, 3).map((item) => {
      const slot = slots.find((s) => s.id === item.slotId) || {};
      const t = Core.typeById(item.type);
      const state = item.status === "已发布" ? "done" : item.status === "待发布" ? "warn" : "";
      return (
        '<div class="slot-mini">' +
          '<span class="slot-time">' + (slot.time || "").split("-")[0] + "</span>" +
          '<span class="slot-dot ' + state + '"></span>' +
          '<div class="slot-info"><b>' + (item.text || "还空着，去排一条") + "</b><span>" +
            (t ? t.name : "待定") + " · " + (slot.level || "常规") + "档</span></div>" +
          '<span class="slot-status ' + (item.status === "已发布" ? "done" : "") + '">' + item.status + "</span>" +
        "</div>"
      );
    }).join("");

    const draftRows = store.drafts.slice(0, 2).map((d) => {
      const t = Core.typeById(d.type);
      return (
        '<div class="hist-item" style="box-shadow:none;padding:11px 0;border-bottom:1px solid var(--line);border-radius:0;margin:0" onclick="App.openDraft(\'' + d.id + '\')">' +
          '<div class="hist-top">' +
            '<span class="tag ' + (d.passed ? "green" : "red") + '">' + (d.passed ? "已合规" : "被拦截") + "</span>" +
            '<span class="tag gray">' + (t ? t.name : "") + "</span>" +
            '<span class="time">' + Core.timeAgo(d.time) + "</span>" +
          "</div>" +
          '<div class="hist-text">' + Core.escapeHtml(d.text) + "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="page">' +
        UI.head(
          "朋友圈 AI 助手",
          dateLine(),
          '<button class="icon-btn round" onclick="App.go(\'sync\')" style="position:relative">' + icon("cloud", 19) +
            (pendingSync ? '<i style="position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#FA5151"></i>' : "") +
          "</button>"
        ) +

        '<div class="hero">' +
          '<div class="hero-top">' +
            "<div><div class=\"hero-greet\">" + greeting() + "，</div><div class=\"hero-title\">" +
              Core.escapeHtml(store.user.name || "朋友") + "</div></div>" +
            (store.user.avatar
              ? '<div class="hero-avatar" style="padding:0;overflow:hidden"><img src="' + Core.escapeHtml(store.user.avatar) + '" alt="头像" /></div>'
              : '<div class="hero-avatar">' + Core.escapeHtml([...(store.user.name || "我")][0] || "我") + "</div>") +
          "</div>" +
          '<div class="hero-stats">' +
            '<div class="hero-stat"><b>' + sentCount + '</b><span>今日已发</span></div>' +
            '<div class="hero-stat"><b>' + todoCount + '</b><span>待发 / 待排</span></div>' +
            '<div class="hero-stat"><b>' + blocked + '</b><span>累计拦截</span></div>' +
          "</div>" +
          '<button class="hero-cta" onclick="App.tab(\'create\')">' + icon("spark", 17) + " 写一条今天的朋友圈</button>" +
        "</div>" +

        '<div class="quick-grid">' +
          quick("create", "tool", "#EAFBF1", "#07C160", "写文案", "App.tab('create')") +
          quick("compliance", "shield", "#FFF1F0", "#FA5151", "合规检测", "App.go('compliance')") +
          quick("topics", "bulb", "#FFF5E9", "#FF9F43", "找选题", "App.tab('topics')") +
          quick("schedule", "clock", "#EEF3FF", "#5B8FF9", "今日排期", "App.go('schedule')") +
        "</div>" +

        '<div class="stat-row">' +
          '<div class="stat"><b>' + store.drafts.length + '<em>条</em></b><span>草稿待发</span></div>' +
          '<div class="stat"><b>' + store.history.length + '<em>条</em></b><span>本周产出</span></div>' +
          '<div class="stat"><b>' + (store.materials.copy.length + store.materials.images.length + store.materials.videos.length) + '<em>个</em></b><span>素材沉淀</span></div>' +
        "</div>" +

        '<div class="section-title"><h2>今日发布节奏</h2><span onclick="App.go(\'schedule\')" style="color:var(--green-dark)">全部排期</span></div>' +
        '<div class="card" style="padding:4px 14px">' + (slotRows || UI.empty("今天还没有排期")) + "</div>" +

        '<div class="section-title"><h2>内容黄金比例</h2><span>4 : 3 : 2 : 1</span></div>' +
        '<div class="card">' +
          ratio("干货价值", 40, "#07C160") +
          ratio("生活人设", 30, "#5B8FF9") +
          ratio("互动引导", 20, "#FF9F43") +
          ratio("促销转化", 10, "#FF6B81") +
          '<div class="hint">' + icon("bulb", 14) + '<span>让用户有收获，是别人不屏蔽你的唯一理由。</span></div>' +
        "</div>" +

        '<div class="section-title"><h2>最近草稿</h2><span onclick="App.go(\'history\')" style="color:var(--green-dark)">历史记录</span></div>' +
        '<div class="card" style="padding:6px 14px">' + (draftRows || UI.empty("还没有草稿，去创作一条吧")) + "</div>" +
      "</div>"
    );
  }

  function quick(page, ic, bg, color, label, action) {
    return (
      '<button class="quick" onclick="' + action + '" style="border:none;font-family:inherit">' +
        '<div class="q-icon" style="background:' + bg + ';color:' + color + '">' + icon(ic, 18) + "</div>" +
        "<span>" + label + "</span>" +
      "</button>"
    );
  }

  function ratio(label, n, color) {
    return (
      '<div class="ratio-item">' +
        '<span class="ratio-label">' + label + "</span>" +
        '<div class="ratio-bar"><i style="width:' + n + "%;background:" + color + '"></i></div>' +
        '<span class="ratio-num">' + n + "%</span>" +
      "</div>"
    );
  }

  function renderCreate() {
    const cards = store.types.map((t) =>
      '<div class="type-card" onclick="App.pickType(\'' + t.id + '\')">' +
        '<div class="type-icon" style="background:' + t.bg + ";color:" + t.color + '">' + icon(t.icon, 19) + "</div>" +
        '<span class="type-arrow">' + icon("right", 15) + "</span>" +
        "<h3>" + t.name + "</h3>" +
        "<p>" + t.structure + "</p>" +
      "</div>"
    ).join("");

    return (
      '<div class="page">' +
        UI.head("文案创作", "先合规，再复制发布") +
        '<div class="notice">' + icon("shield", 15) +
          "<span>所有 AI 生成、自由创作、上传的内容，都会自动做一次严格合规检测。未通过前不可复制、保存或发布。</span>" +
        "</div>" +
        '<div class="section-title"><h2>选择文案类型</h2><span>8 种结构</span></div>' +
        '<div class="type-grid">' + cards + "</div>" +
        '<div class="hint" style="margin-top:16px">' + icon("bulb", 14) +
          "<span>每种类型都有固定的写作结构和细分方向，先选结构，再让 AI 按你的人设填内容。</span>" +
        "</div>" +
      "</div>"
    );
  }

  window.ViewsHome = { renderHome, renderCreate };
})();
