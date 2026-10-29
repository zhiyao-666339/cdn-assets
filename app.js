/* 应用主控：导航、动作、云盘同步 */
(function () {
  const { store, ui, save, nowISO, todayKey, uid, escapeHtml } = Core;
  const icon = UI.icon;
  const SYNC_KEY = "pyq_sync_v1";
  const TABS = { home: "home", create: "create", topics: "topics", materials: "materials", more: "more" };
  const TAB_OF = { schedule: "more", profile: "more", history: "more", compliance: "more", sync: "more", account: "more", member: "more", contact: "more", update: "more", logs: "more", ai: "more" };
  let stack = [];

  const RENDERERS = {
    home: ViewsHome.renderHome,
    create: ViewsHome.renderCreate,
    compose: ViewsCompose.renderCompose,
    topics: ViewsLibrary.renderTopics,
    materials: ViewsLibrary.renderMaterials,
    schedule: ViewsMore.renderSchedule,
    profile: ViewsMore.renderProfile,
    history: ViewsMore.renderHistory,
    compliance: ViewsMore.renderCompliance,
    sync: ViewsMore.renderSync,
    account: ViewsMore.renderAccount,
    member: ViewsMore.renderMember,
    contact: ViewsMore.renderContact,
    update: ViewsMore.renderUpdate,
    logs: ViewsMore.renderLogs,
    ai: ViewsMore.renderAI,
    more: ViewsMore.renderMore
  };

  function render(scrollTop) {
    const view = document.getElementById("view");
    const y = view ? view.scrollTop : 0;
    const html = (RENDERERS[ui.page] || RENDERERS.home)();
    view.innerHTML = html;
    const active = TAB_OF[ui.page] || ui.page;
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === active);
    });
    if (scrollTop) view.scrollTop = 0;
    else view.scrollTop = y;
  }

  function tab(page) {
    ui.page = page;
    stack = [page];
    render(true);
  }

  function go(page) {
    if (ui.page !== page) stack.push(ui.page);
    ui.page = page;
    render(true);
  }

  function back() {
    const prev = stack.pop();
    ui.page = prev || "home";
    render(true);
  }

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------- 底部弹层 ---------- */
  const sheetRoot = () => document.getElementById("sheet-root");
  function openSheet(html) {
    sheetRoot().innerHTML =
      '<div class="sheet-mask" onclick="if(event.target===this)App.closeSheet()"><div class="sheet"><div class="sheet-handle"></div>' + html + "</div></div>";
  }
  function closeSheet() { sheetRoot().innerHTML = ""; }

  /* ---------- 文案创作 ---------- */
  function pickType(id) {
    const t = Core.typeById(id);
    ui.compose = {
      typeId: id, mode: "ai", size: "short", topic: Core.topicFor(id), styles: [], materialIds: [],
      text: "", result: "", check: null, variant: 0, replaced: false,
      fixedText: "", loading: false, blockId: "", slotId: "", histId: ""
    };
    go("compose");
  }

  function ensureCompose() {
    if (!ui.compose) pickType(store.types[0].id);
    return ui.compose;
  }

  function setMode(mode) {
    const c = ensureCompose();
    c.mode = mode;
    if (mode === "free" && !c.text) c.text = c.result || "";
    c.check = null; c.replaced = false; c.result = "";
    render();
  }

  // 篇幅：短文 / 长文，切换后清空上一次结果，避免篇幅与结果不一致
  function setSize(size) {
    const c = ensureCompose();
    if (c.size === size) return;
    c.size = size;
    c.result = "";
    c.check = null;
    c.replaced = false;
    c.fixedText = "";
    if (c.mode === "ai") c.text = "";
    render();
  }

  function setTopic(v) { ensureCompose().topic = v; }
  function setDraftText(v) {
    const c = ensureCompose();
    c.text = v;
    const el = document.getElementById("charCount");
    if (el) el.textContent = [...v].length + " 字 · " + (c.size === "long" ? "目标 300+" : "目标 ≤ " + Core.SHORT_MAX);
  }

  function toggleStyle(id) {
    const c = ensureCompose();
    const i = c.styles.indexOf(id);
    if (i >= 0) c.styles.splice(i, 1); else c.styles.push(id);
    render();
  }

  function toggleMaterial(id) {
    const c = ensureCompose();
    const i = c.materialIds.indexOf(id);
    if (i >= 0) c.materialIds.splice(i, 1); else c.materialIds.push(id);
    render();
  }

  // 统一收尾：写结果 + 合规检测 + 记入历史 / 拦截记录
  function finishCompose(c, text, setDraft) {
    c.variant += 1;
    c.result = text;
    if (setDraft !== false) c.text = text;
    c.check = Core.checkText(text);
    c.fixedText = c.check.passed ? "" : Core.replaceText(text, c.check.violations);
    c.loading = false;
    if (!c.check.passed) recordBlock(c); else recordPass(c);
    render();
    const view = document.getElementById("view");
    const res = view.querySelector(".result");
    if (res) view.scrollTop = view.scrollHeight;
  }

  async function generate() {
    const c = ensureCompose();
    c.loading = true;
    c.replaced = false;
    render();
    const cfg = aiCfg().text;
    if (cfg.base && cfg.key) {
      toast("AI 正在生成文案…");
      const r = await aiChat([
        { role: "system", content: "你是一位真实的中文朋友圈写作者，擅长写有人味、不营销的日常文案。" },
        { role: "user", content: aiTextPrompt(c) }
      ]);
      if (r && r.ok && r.text) {
        finishCompose(c, cleanAIText(r.text));
        return;
      }
      toast("AI 接口失败，已改用本地模板：" + ((r && r.error) || ""));
    }
    setTimeout(() => {
      finishCompose(c, Core.generate(c.typeId, c.topic, c.variant + 1, c.styles, c.materialIds, c.size));
    }, 720);
  }

  async function polish() {
    const c = ensureCompose();
    if (!c.text.trim()) { toast("先写下你的原文"); return; }
    c.loading = true;
    render();
    const cfg = aiCfg().text;
    if (cfg.base && cfg.key) {
      toast("AI 正在润色…");
      const r = await aiChat([
        { role: "system", content: "你是中文朋友圈润色助手，只调整语气、结构和营销感，不改原意。" },
        { role: "user", content: "请润色下面这条朋友圈，保持原意，去掉 AI 腔和营销感，篇幅：" +
          (c.size === "long" ? "长文 300 字以上" : "短文 " + Core.SHORT_MAX + " 字以内") +
          (c.styles.length ? "；文风：" + c.styles.map((s) => STYLE_HINT[s] || s).join("；") : "") +
          "\n\n原文：\n" + c.text + "\n\n直接输出润色后的正文。" }
      ]);
      if (r && r.ok && r.text) {
        finishCompose(c, cleanAIText(r.text), false);
        return;
      }
      toast("AI 润色失败，已用本地规则处理：" + ((r && r.error) || ""));
    }
    setTimeout(() => {
      let text = Core.polish(c.text, c.size);
      text = Core.applyStyles(text, c.styles);
      finishCompose(c, text, false);
    }, 620);
  }

  function recordPass(c) {
    const t = Core.typeById(c.typeId);
    if (c.histId) {
      const h = store.history.find((x) => x.id === c.histId);
      if (h) {
        h.title = c.topic || h.title;
        h.text = c.result;
        h.time = nowISO();
        h.status = "已通过";
        save();
        return;
      }
    }
    const item = {
      id: uid("h"), type: c.typeId, typeName: t ? t.name : "",
      mode: c.mode === "ai" ? "AI 生成" : "自由创作",
      title: c.topic || (t ? t.defaultTopic : ""), text: c.result, time: nowISO(), status: "已通过"
    };
    store.history.unshift(item);
    c.histId = item.id;
    save();
  }

  function recordBlock(c) {
    const t = Core.typeById(c.typeId);
    const cats = [...new Set(c.check.violations.map((v) => v.category))].join("、");
    const words = [...new Set(c.check.violations.map((v) => v.word))].join(" / ");
    const replaced = c.fixedText || Core.replaceText(c.result, c.check.violations);
    if (c.blockId) {
      const b = store.blocks.find((x) => x.id === c.blockId);
      if (b) { b.original = c.result; b.replaced = replaced; b.word = words; b.category = cats; }
    } else {
      c.blockId = uid("b");
      store.blocks.unshift({
        id: c.blockId, word: words, category: cats,
        reason: "命中 " + cats + " 风险词，已强制拦截，未替换前不可复制 / 保存 / 发布。",
        original: c.result, replaced: replaced, time: nowISO(),
        source: (t ? t.name : "") + " · " + (c.mode === "ai" ? "AI 生成" : "自由创作")
      });
      const hid = uid("h");
      c.histId = hid;
      store.history.unshift({
        id: hid, type: c.typeId, typeName: t ? t.name : "", mode: c.mode === "ai" ? "AI 生成" : "自由创作",
        title: c.topic, text: c.result, time: nowISO(), status: "已拦截"
      });
    }
    save();
    queueHistory(c);
  }

  function applyFix() {
    const c = ensureCompose();
    if (!c.check || c.check.passed) return;
    const fixed = Core.replaceText(c.result, c.check.violations);
    const recheck = Core.checkText(fixed);
    c.fixedText = fixed;
    c.result = fixed;
    c.text = fixed;
    c.check = recheck;
    c.replaced = true;
    const b = store.blocks.find((x) => x.id === c.blockId);
    if (b) b.replaced = fixed;
    save();
    toast(recheck.passed ? "已替换为合规版本" : "替换后仍有风险，请再改一改");
    render();
  }

  function copy() {
    const c = ensureCompose();
    if (!c.result) return;
    if (!c.check || (!c.check.passed && !c.replaced)) { toast("未通过合规检测，暂不可复制"); return; }
    ViewsCompose.copyText(c.result).then((ok) => toast(ok ? "已复制完整文案，防折叠" : "复制失败，请手动选择文本"));
  }

  function saveDraft(status) {
    const c = ensureCompose();
    if (!c.result) { toast("先生成或润色一条文案"); return; }
    if (!c.check || !c.check.passed) { toast("未通过合规检测，不能保存"); return; }
    const t = Core.typeById(c.typeId);
    const item = {
      id: uid("d"), type: c.typeId, mode: c.mode === "ai" ? "AI 生成" : "自由创作",
      title: c.topic || t.defaultTopic, text: c.result, time: nowISO(), status: status || "待发布", passed: true
    };
    store.drafts.unshift(item);
    recordPass(c);
    Core.logAudit("compose", "create", item.title, item.text.slice(0, 60));
    if (c.slotId) {
      const s = store.schedule.find((x) => x.slotId === c.slotId);
      if (s) { s.type = c.typeId; s.text = item.text.slice(0, 40); s.status = "待发布"; s.content = item.text; }
    }
    save();
    queueArtifact(c, item);
    toast("已保存并归档到飞书云盘");
    render();
  }

  function toMaterials() {
    const c = ensureCompose();
    if (!c.result || !c.check || !c.check.passed) { toast("合规通过后才能存入素材库"); return; }
    const m = { id: uid("m"), category: "成品文案", text: c.result, time: nowISO() };
    store.materials.copy.unshift(m);
    save();
    queueItem("素材库/文案库/成品文案", m.id + "_成品文案.txt", m.text);
    toast("已存入成品文案库");
  }

  /* 加入排期：先选发布时间段，再写入当日排期 */
  function addToSchedule() {
    const c = ensureCompose();
    if (!c.result || !c.check || !c.check.passed) { toast("合规通过后才能加入排期"); return; }
    const rows = store.slots.map((s) => {
      const item = (store.schedule || []).find((x) => x.slotId === s.id) || {};
      const busy = !!(item.text || item.topicId);
      const label = busy
        ? "已排：" + (item.topicId ? (Core.topicById(item.topicId) || {}).title || item.text : item.text)
        : "空闲";
      const mine = c.slotId === s.id;
      return (
        '<div class="slot-pick' + (mine ? " active" : "") + '" onclick="App.commitSchedule(\'' + s.id + '\')">' +
          '<div><b>' + s.time + '</b><span>' + s.level + "档 · " + s.title + "</span></div>" +
          '<em class="' + (busy ? "busy" : "") + '">' + escapeHtml(label) + "</em>" +
        "</div>"
      );
    }).join("");
    openSheet(
      "<h3>选择发布时间段</h3>" +
      '<div class="muted" style="margin:6px 0 12px">选一个时段加入今日排期，已有内容的时段会被这条替换。</div>' +
      rows +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button></div>'
    );
  }

  function commitSchedule(slotId) {
    const slot = store.slots.find((s) => s.id === slotId);
    if (!slot) return;
    const cur = (store.schedule || []).find((x) => x.slotId === slotId);
    const busyText = cur ? (cur.topicId ? ((Core.topicById(cur.topicId) || {}).title || "") : cur.text || "") : "";
    if (busyText) {
      openSheet(
        "<h3>该时段已有内容</h3>" +
        '<div class="muted" style="margin:6px 0 12px">' + slot.time + " 当前是「" + escapeHtml(busyText.slice(0, 20)) +
          "」。替换后原内容会移出排期（选题仍在选题库，不会删除）。</div>" +
        '<div class="sheet-actions">' +
          '<button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
          '<button class="btn primary" onclick="App.doCommitSchedule(\'' + slotId + '\')">确认替换</button>' +
        "</div>"
      );
      return;
    }
    doCommitSchedule(slotId);
  }

  function doCommitSchedule(slotId) {
    const c = ensureCompose();
    const slot = store.slots.find((s) => s.id === slotId);
    if (!slot) return;
    let item = (store.schedule || []).find((x) => x.slotId === slotId);
    if (!item) {
      item = { slotId: slotId, topicId: "", status: "待排", type: c.typeId, text: "", time: slot.time.split("-")[0] };
      store.schedule.push(item);
    }
    item.type = c.typeId;
    item.topicId = "";
    item.status = "待发布";
    item.text = c.result.replace(/\n/g, " ").slice(0, 40);
    c.slotId = slotId;
    save();
    queueSchedule();
    closeSheet();
    render();
    toast("已加入 " + slot.time + " 排期");
  }

  /* 选题 ↔ 时间段：自由调整某条选题在哪个时段发布 */
  function openSlotPicker(topicId) {
    const tp = Core.topicById(topicId);
    if (!tp) return;
    const current = (store.schedule || []).find((x) => x.topicId === topicId);
    const rows = store.slots.map((s) => {
      const item = (store.schedule || []).find((x) => x.slotId === s.id) || {};
      let note = "空闲";
      if (item.topicId && item.topicId !== topicId) {
        const other = Core.topicById(item.topicId);
        note = "已排：" + (other ? other.title : item.text);
      } else if (item.topicId === topicId) {
        note = "当前安排";
      } else if (item.text) {
        note = "已排：" + item.text;
      }
      const mine = current && current.slotId === s.id;
      return (
        '<div class="slot-pick' + (mine ? " active" : "") + '" onclick="App.assignTopic(\'' + topicId + "','" + s.id + '\')">' +
          '<div><b>' + s.time + '</b><span>' + s.level + "档 · " + s.title + "</span></div>" +
          '<em class="' + (note === "空闲" || mine ? "" : "busy") + '">' + escapeHtml(note) + "</em>" +
        "</div>"
      );
    }).join("");
    openSheet(
      "<h3>安排发布时间段</h3>" +
      '<div class="muted" style="margin:6px 0 12px">' + escapeHtml(tp.title) + " · 已有选题的时段会自动换位，不会丢内容。</div>" +
      rows +
      '<div class="sheet-actions">' +
        (current ? '<button class="btn ghost" onclick="App.clearSlot(\'' + current.slotId + '\')">移出排期</button>' : "") +
        '<button class="btn ghost" onclick="App.closeSheet()">取消</button></div>'
    );
  }

  function assignTopic(topicId, slotId) {
    const tp = Core.topicById(topicId);
    const slot = store.slots.find((s) => s.id === slotId);
    if (!tp || !slot) return;
    const list = store.schedule || [];
    const prev = list.find((x) => x.topicId === topicId && x.slotId !== slotId) || null;
    let target = list.find((x) => x.slotId === slotId);
    if (!target) {
      target = { slotId: slotId, topicId: "", status: "待排", type: "", text: "", time: slot.time.split("-")[0] };
      list.push(target);
    }
    const otherId = target.topicId && target.topicId !== topicId ? target.topicId : "";
    const other = otherId ? Core.topicById(otherId) : null;

    // 该选题先离开原时段
    if (prev) { prev.topicId = ""; prev.text = ""; prev.type = ""; prev.status = "待排"; }
    // 目标时段原有的另一条选题换回原时段（真正互换，内容不丢）
    if (otherId) {
      if (prev) {
        prev.topicId = otherId;
        prev.type = other ? other.type : target.type;
        prev.text = other ? other.title : target.text;
        prev.status = "待排";
      } else {
        target.topicId = "";
        target.text = "";
      }
    }
    target.topicId = topicId;
    target.type = tp.type;
    target.text = tp.title;
    target.status = "待排";
    save();
    queueSchedule();
    closeSheet();
    render();
    toast("已安排到 " + slot.time + (other && prev ? "，与「" + other.title.slice(0, 8) + "…」互换" : other ? "，「" + other.title.slice(0, 8) + "…」已移出排期" : ""));
  }

  function clearSlot(slotId) {
    const item = (store.schedule || []).find((x) => x.slotId === slotId);
    if (!item) return;
    item.topicId = "";
    item.text = "";
    item.type = "";
    item.content = "";
    item.status = "待排";
    save();
    queueSchedule();
    closeSheet();
    render();
    toast("已移出该时段");
  }

  function openDraft(id) {
    const d = store.drafts.find((x) => x.id === id);
    if (!d) return;
    ui.compose = {
      typeId: d.type, mode: d.mode === "AI 生成" ? "ai" : "free", size: [...(d.text || "")].length > 200 ? "long" : "short", topic: d.title,
      styles: [], materialIds: [], text: d.text, result: d.text,
      check: Core.checkText(d.text), variant: 0, replaced: false,
      fixedText: "", loading: false, blockId: "", slotId: ""
    };
    go("compose");
  }

  /* ---------- 选题 ---------- */
  function setTopicFilter(v) { ui.topicFilter = v; render(); }

  function openTopicPicker() {
    const list = store.topics.slice(0, 30).map((t) =>
      '<div class="topic-card" style="margin-bottom:6px;box-shadow:none;border:1px solid var(--line);padding:10px 12px" onclick="App.useTopic(\'' + t.id + '\')">' +
        '<div class="topic-body"><h3 style="font-size:12.5px">' + escapeHtml(t.title) + '</h3>' +
          '<div class="topic-meta"><span class="tag blue">' + t.direction + "</span></div></div>" +
        icon("right", 15) +
      "</div>"
    ).join("");
    openSheet("<h3>从选题库选择</h3>" + list);
  }

  function useTopic(id) {
    const t = store.topics.find((x) => x.id === id);
    const c = ensureCompose();
    if (t) { c.topic = t.title; if (t.type) c.typeId = t.type; }
    closeSheet();
    render();
  }

  function topicToCompose(id) {
    const t = store.topics.find((x) => x.id === id);
    if (!t) return;
    pickType(t.type || "view");
    ui.compose.topic = t.title;
    render();
  }

  function openTopicSheet() {
    const dirs = [...new Set(store.topics.map((t) => t.direction))];
    openSheet(
      "<h3>新增选题</h3>" +
      '<div class="field"><label>方向</label><select class="input" id="newTopicDir">' +
        dirs.map((d) => "<option>" + d + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>选题</label><textarea class="textarea" id="newTopicTitle" rows="3" placeholder="一句话写清楚要讲什么"></textarea></div>' +
      '<div class="field"><label>适合类型</label><select class="input" id="newTopicType">' +
        store.types.map((t) => '<option value="' + t.id + '">' + t.name + "</option>").join("") + "</select></div>" +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveTopic()">保存</button></div>'
    );
  }

  function saveTopic() {
    const dir = document.getElementById("newTopicDir").value;
    const title = document.getElementById("newTopicTitle").value.trim();
    const type = document.getElementById("newTopicType").value;
    if (!title) { toast("写一个选题再保存"); return; }
    const t = Core.addTopic(dir, title, type);
    queueItem("选题库", t.id + "_" + dir + ".txt", "方向：" + dir + "\n\n选题：" + title);
    closeSheet();
    render();
    toast("选题已保存并归档");
  }

  /* 切换选题库范围：全部 / 今日 */
  function setTopicScope(scope) { ui.topicScope = scope; render(); }

  /* 编辑选题：复用新增弹层，预填原数据 */
  function editTopic(id) {
    const t = Core.topicById(id);
    if (!t) return;
    const dirs = [...new Set(store.topics.map((x) => x.direction))];
    openSheet(
      "<h3>编辑选题</h3>" +
      '<div class="field"><label>方向</label><select class="input" id="newTopicDir">' +
        dirs.map((d) => '<option' + (d === t.direction ? " selected" : "") + ">" + d + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>选题</label><textarea class="textarea" id="newTopicTitle" rows="3" placeholder="一句话写清楚要讲什么">' + escapeHtml(t.title) + "</textarea></div>" +
      '<div class="field"><label>适合类型</label><select class="input" id="newTopicType">' +
        store.types.map((x) => '<option value="' + x.id + '"' + (x.id === t.type ? " selected" : "") + ">" + x.name + "</option>").join("") + "</select></div>" +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.updateTopic(\'' + id + '\')">保存</button></div>'
    );
  }

  function updateTopic(id) {
    const dir = document.getElementById("newTopicDir").value;
    const title = document.getElementById("newTopicTitle").value.trim();
    const type = document.getElementById("newTopicType").value;
    if (!title) { toast("选题不能为空"); return; }
    Core.updateTopic(id, { direction: dir, title: title, type: type });
    closeSheet();
    render();
    toast("选题已更新");
  }

  function delTopic(id) {
    const t = Core.topicById(id);
    if (!t) return;
    openSheet(
      "<h3>删除选题？</h3>" +
      '<div class="muted" style="margin:8px 0 14px">「' + escapeHtml(t.title) +
        '」会从选题库移除；若已排入今日排期，对应时段会清空为待排。操作可在「历史记录 → 操作留痕」查看。</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn danger" onclick="App.confirmDelTopic(\'' + id + '\')">删除</button></div>'
    );
  }
  function confirmDelTopic(id) {
    Core.deleteTopic(id);
    closeSheet();
    render();
    toast("选题已删除");
  }

  function copyTopic(id) {
    const nt = Core.copyTopic(id);
    if (nt) toast("已复制为「" + nt.title.slice(0, 16) + "…」");
    render();
  }

  /* ---------- 时段管理 ---------- */
  function openSlotSheet(slotId) {
    const sl = slotId ? Core.slotById(slotId) : null;
    const levels = ["黄金", "小黄金", "睡前", "常规"];
    const typeNames = store.types.map((t) => t.name);
    const selected = sl ? (sl.types || []) : ["生活日常型"];
    openSheet(
      "<h3>" + (sl ? "编辑时段" : "新增时段") + "</h3>" +
      '<div class="field"><label>时间段</label><input class="input" id="slotTime" placeholder="例如 08:00-09:00" value="' + escapeHtml(sl ? sl.time : "") + '" /></div>' +
      '<div class="field"><label>时段等级</label><select class="input" id="slotLevel">' +
        levels.map((l) => '<option' + (sl && sl.level === l ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>时段标题</label><input class="input" id="slotTitle" placeholder="例如 早高峰干货" value="' + escapeHtml(sl ? sl.title : "") + '" /></div>' +
      '<div class="field"><label>场景描述</label><input class="input" id="slotScene" placeholder="例如 通勤路上刷手机" value="' + escapeHtml(sl ? sl.scene : "") + '" /></div>' +
      '<div class="field"><label>适合类型（逗号分隔）</label><input class="input" id="slotTypes" placeholder="生活日常型,观点认知型" value="' + escapeHtml(selected.join(",")) + '" /></div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveSlot(' + (sl ? "'" + sl.id + "'" : "null") + ')">保存</button></div>'
    );
  }

  function saveSlot(slotId) {
    const time = document.getElementById("slotTime").value.trim();
    const level = document.getElementById("slotLevel").value;
    const title = document.getElementById("slotTitle").value.trim();
    const scene = document.getElementById("slotScene").value.trim();
    const types = document.getElementById("slotTypes").value.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!time) { toast("请填写时间段"); return; }
    if (!types.length) types.push("生活日常型");
    if (slotId) {
      Core.updateSlot(slotId, { time: time, level: level, title: title, scene: scene, types: types });
      // 同步排期里的 time
      const item = (store.schedule || []).find((x) => x.slotId === slotId);
      if (item) item.time = time.split("-")[0];
    } else {
      const sl = Core.addSlot(time, level, title, scene, types);
      // 新增时段补一条排期记录
      store.schedule.push({ slotId: sl.id, topicId: "", status: "待排", type: "", text: "", content: "", time: time.split("-")[0] });
      save();
    }
    closeSheet();
    render();
    toast(slotId ? "时段已更新" : "时段已添加");
  }

  function delSlot(id) {
    const sl = Core.slotById(id);
    if (!sl) return;
    openSheet(
      "<h3>删除时段？</h3>" +
      '<div class="muted" style="margin:8px 0 14px">「' + escapeHtml(sl.time + " " + sl.title) +
        '」会从排期移除，对应排期内容会清空。操作留痕可在历史记录查看。</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn danger" onclick="App.confirmDelSlot(\'' + id + '\')">删除</button></div>'
    );
  }
  function confirmDelSlot(id) {
    Core.deleteSlot(id);
    closeSheet();
    render();
    toast("时段已删除");
  }

  /* 为排期时段生成完整可编辑文案 */
  function genSlotContent(slotId) {
    const text = Core.generateScheduleContent(slotId);
    render();
    toast(text ? "已生成内容，可点「编辑」修改" : "生成失败");
  }

  /* 编辑排期时段内容 */
  function editSlotContent(slotId) {
    const item = (store.schedule || []).find((x) => x.slotId === slotId);
    if (!item) return;
    const slot = Core.slotById(slotId);
    openSheet(
      "<h3>编辑 " + (slot ? slot.time : "") + " 内容</h3>" +
      '<div class="field"><textarea class="textarea" id="slotContentText" rows="10" placeholder="生成后可自由修改文案">' + escapeHtml(item.content || "") + "</textarea></div>" +
      '<div class="muted" style="margin-bottom:10px">修改后会保存到该时段排期，留痕到操作记录。</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveSlotContent(\'' + slotId + '\')">保存</button></div>'
    );
  }
  function saveSlotContent(slotId) {
    const item = (store.schedule || []).find((x) => x.slotId === slotId);
    if (!item) return;
    const text = document.getElementById("slotContentText").value;
    item.content = text;
    item.text = text.replace(/\n/g, " ").slice(0, 40);
    item.status = "待发布";
    Core.logAudit("schedule", "edit", Core.slotById(slotId) ? Core.slotById(slotId).time : slotId, "修改排期内容");
    save();
    closeSheet();
    render();
    toast("内容已保存");
  }

  /* ---------- 素材 ---------- */
  function setMaterialTab(v) { ui.materialsTab = v; render(); }
  function setMaterialCat(v) { ui.materialCat = v; render(true); }

  function materialToCompose(id) {
    const m = store.materials.copy.find((x) => x.id === id);
    if (!m) return;
    const name = m.type || m.category;
    const t = store.types.find((x) => x.name === name);
    pickType(t ? t.id : "life");
    ui.compose.topic = m.text;
    ui.compose.materialIds = [id];
    render();
    toast("已带入「" + name + "」文案");
  }

  function copyMaterial(id) {
    const m = store.materials.copy.find((x) => x.id === id);
    if (m) ViewsCompose.copyText(m.text).then(() => toast("已复制素材"));
  }
  function copyMaterialText(text) { ViewsCompose.copyText(text).then(() => toast("已复制")); }

  function openMaterialAdd() {
    if (ui.materialsTab === "image") { openImageSheet(); return; }
    if (ui.materialsTab === "video") { openVideoSheet(); return; }
    const cats = ViewsLibrary.copyTypeNames();
    const cur = ui.materialCat && cats.indexOf(ui.materialCat) >= 0 ? ui.materialCat : cats[0];
    openSheet(
      "<h3>新增文案素材</h3>" +
      '<div class="field"><label>文案类型</label><select class="input" id="matCat">' +
        cats.map((c) => '<option' + (c === cur ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>内容</label><textarea class="textarea" id="matText" rows="5" placeholder="灵感、金句、感悟，先记下来"></textarea></div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveMaterial()">保存并同步</button></div>'
    );
  }

  function saveMaterial() {
    const type = document.getElementById("matCat").value;
    const text = document.getElementById("matText").value.trim();
    if (!text) { toast("写点内容再保存"); return; }
    const m = { id: uid("m"), type: type, category: type, text: text, time: nowISO() };
    store.materials.copy.unshift(m);
    Core.logAudit("material", "create", type, text.slice(0, 60));
    if (!save()) {
      store.materials.copy = store.materials.copy.filter((x) => x.id !== m.id);
      toast("本地存储已满，请先清理素材后重试");
      return;
    }
    queueItem("素材库/文案库/" + type, m.id + "_" + type + ".txt", text);
    syncNow();
    closeSheet();
    render();
    toast("已存入「" + type + "」并同步云盘");
  }

  /* 上传文案文件：按文案类型归档 */
  let copyUploadFiles = [];

  function openCopyUpload() {
    copyUploadFiles = [];
    const cats = ViewsLibrary.copyTypeNames();
    const cur = ui.materialCat && cats.indexOf(ui.materialCat) >= 0 ? ui.materialCat : cats[0];
    openSheet(
      "<h3>上传文案文件</h3>" +
      '<div class="field"><label>文案类型</label><select class="input" id="copyUpType">' +
        cats.map((c) => '<option' + (c === cur ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>" +
      '<label class="btn ghost block file-label" style="margin-bottom:10px">选择文件（.txt / .md，可多选）' +
        '<input class="file-cover" type="file" accept=".txt,.md,.markdown,text/plain" multiple onchange="App.pickCopyFiles(this)" />' +
      "</label>" +
      '<div class="muted" id="copyUpInfo">还没有选择文件</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveCopyFiles()">保存并同步</button></div>'
    );
  }

  function pickCopyFiles(input) {
    copyUploadFiles = Array.prototype.slice.call(input.files || []).slice(0, 20);
    const info = document.getElementById("copyUpInfo");
    if (info) {
      info.textContent = copyUploadFiles.length
        ? "已选择 " + copyUploadFiles.length + " 个文件：" + copyUploadFiles.map((f) => f.name).join("、")
        : "还没有选择文件";
    }
  }

  function saveCopyFiles() {
    if (!copyUploadFiles.length) { toast("先选择要上传的文案文件"); return; }
    const type = document.getElementById("copyUpType").value;
    const files = copyUploadFiles.slice();
    copyUploadFiles = [];
    const readers = files.map((f) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result || "") });
      r.onerror = () => resolve({ name: f.name, text: "" });
      r.readAsText(f, "utf-8");
    }));
    toast("正在读取 " + files.length + " 个文件…");
    Promise.all(readers).then((arr) => {
      let ok = 0;
      arr.forEach((item) => {
        const text = (item.text || "").trim().slice(0, 5000);
        if (!text) return;
        const id = uid("m");
        store.materials.copy.unshift({
          id: id, type: type, category: type, text: text,
          fileName: item.name, time: nowISO()
        });
        queueItem("素材库/文案库/" + type, id + "_" + (item.name || "文案.txt"), text);
        ok++;
      });
      if (!ok) { toast("文件为空或格式不支持"); return; }
      save();
      syncNow();
      closeSheet();
      ui.materialCat = type;
      render();
      toast("已上传 " + ok + " 条「" + type + "」文案并同步云盘");
    });
  }

  /* ---------- AI 模型：文案 / 图片 / 视频（统一 OpenAI 兼容配置） ---------- */

  // 免费 / 常用预设：一键填入接口地址与模型
  const AI_PRESETS = {
    text: [
      { id: "zhipu", name: "智谱 GLM（免费）", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
      { id: "siliconflow", name: "硅基流动（送额度）", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
      { id: "custom", name: "自定义兼容接口", base: "", model: "" }
    ],
    image: [
      { id: "free", name: "免费通道（无需 Key）", mode: "free", base: "", model: "" },
      { id: "zhipu", name: "智谱 CogView（免费）", mode: "custom", base: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-3-flash" },
      { id: "openai", name: "OpenAI 兼容", mode: "custom", base: "", model: "gpt-image-1" }
    ],
    video: [
      { id: "zhipu", name: "智谱 CogVideoX（免费）", base: "https://open.bigmodel.cn/api/paas/v4", model: "cogvideox-flash" },
      { id: "custom", name: "自定义兼容接口", base: "", model: "" }
    ]
  };

  function aiCfg() {
    if (!store.settings) store.settings = {};
    if (!store.settings.ai) store.settings.ai = {};
    const ai = store.settings.ai;
    if (!ai.text) ai.text = { base: "", key: "", model: "" };
    if (!ai.image) ai.image = { mode: "free", base: "", key: "", model: "gpt-image-1", size: "1024x1024" };
    if (!ai.video) ai.video = { base: "", key: "", model: "cogvideox-flash" };
    if (!ai.moderate) ai.moderate = { enabled: false, provider: "zhipu", apiKey: "", secretId: "", secretKey: "", region: "ap-guangzhou", proxyUrl: "" };
    if (!ai.image.mode) ai.image.mode = "free";
    return ai;
  }

  // 图片配置（兼容旧字段）
  function imageCfg() {
    return aiCfg().image;
  }

  const STYLE_HINT = {
    deai: "去掉 AI 腔，像普通人说话",
    like: "更接近作者本人的口吻",
    real: "有真人感和生活细节",
    softsell: "营销感弱一点，不要推销",
    emotion: "带一点情绪和故事感",
    casual: "口语化，专业感弱一点"
  };

  // 调用 OpenAI 兼容的 chat/completions：App 内走原生 HTTP，网页版回退 fetch
  async function aiChat(messages) {
    const c = aiCfg().text;
    if (!c.base) return { ok: false, error: "未配置文案模型" };
    const model = c.model || "glm-4-flash";
    if (window.NativeApp && NativeApp.available() && NativeApp.aiChat) {
      return NativeApp.aiChat(c.base, c.key, model, JSON.stringify(messages));
    }
    if (!c.key) return { ok: false, error: "未配置 API Key" };
    try {
      const url = c.base.replace(/\/+$/, "") + "/chat/completions";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key },
        body: JSON.stringify({ model: model, messages: messages, temperature: 0.8, stream: false })
      });
      const txt = await res.text();
      if (!res.ok) return { ok: false, error: "接口返回 HTTP " + res.status + "：" + txt.slice(0, 160) };
      let data = {};
      try { data = JSON.parse(txt); } catch (e) { return { ok: false, error: "接口返回格式错误" }; }
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      const text = (msg && msg.content) || "";
      if (!text.trim()) return { ok: false, error: "接口没有返回内容" };
      return { ok: true, text: text.trim() };
    } catch (e) {
      return { ok: false, error: "请求失败（网页版可能受跨域限制）：" + ((e && e.message) || e) };
    }
  }

  // 组装文案生成提示词：类型结构 + 作者人设 + 文风 + 真实素材
  function aiTextPrompt(c) {
    const t = Core.typeById(c.typeId) || {};
    const p = Core.persona ? Core.persona() : {};
    const lines = [
      "你是中文朋友圈写作助手。请写一条可以直接发到朋友圈的文案。",
      "必须做到：真实、口语化、有具体细节；不要 AI 腔、不要排比堆砌、不要书面总结；不要营销话术和夸张承诺；emoji 最多 1 个。",
      "文案类型：" + (t.name || ""),
      "结构：" + (t.structure || ""),
      "写作要求：" + (t.instruction || ""),
      "本次选题 / 素材：" + (c.topic || t.defaultTopic || ""),
      "篇幅：" + (c.size === "long"
        ? "长文，4-8 段，300 字以上，段落之间空一行"
        : "短文，" + Core.SHORT_MAX + " 字以内，最多 3 行，适合朋友圈不折叠")
    ];
    if (c.styles && c.styles.length) {
      lines.push("文风：" + c.styles.map((s) => STYLE_HINT[s] || s).join("；"));
    }
    const mats = (c.materialIds || []).slice(0, 2)
      .map((id) => (store.materials.copy.find((m) => m.id === id) || {}).text)
      .filter(Boolean);
    if (mats.length) lines.push("可参考的真实素材：" + mats.join(" / "));
    if (p.identity) lines.push("作者身份：" + p.identity);
    if (p.style) lines.push("作者平时的表达风格：" + String(p.style).slice(0, 200));
    if (p.avoid) lines.push("作者不喜欢的表达：" + String(p.avoid).slice(0, 200));
    lines.push("直接输出文案正文，不要标题、不要引号、不要解释。");
    return lines.join("\n");
  }

  // 清理模型输出：去掉代码块、前缀标签和成对引号
  function cleanAIText(s) {
    let t = String(s || "").trim();
    t = t.replace(/^```[^\n]*\n/, "").replace(/\n?```$/, "").trim();
    t = t.replace(/^(文案|朋友圈文案|正文)[:：]\s*/, "");
    t = t.replace(/^["“]([\s\S]*)["”]$/, "$1");
    return t.trim();
  }

  /* ---------- AI 模型接入设置页（我的 → AI 模型接入） ---------- */

  // 预设只填表单，保存后生效
  function aiPreset(kind, id) {
    const p = (AI_PRESETS[kind] || []).find((x) => x.id === id);
    if (!p) return;
    if (kind === "image") {
      const mode = document.getElementById("aiImageMode");
      if (mode) mode.value = p.mode;
      const base = document.getElementById("aiImageBase");
      if (base) base.value = p.base;
      const model = document.getElementById("aiImageModel");
      if (model) model.value = p.model;
    } else {
      const prefix = kind === "text" ? "aiText" : "aiVideo";
      const base = document.getElementById(prefix + "Base");
      if (base) base.value = p.base;
      const model = document.getElementById(prefix + "Model");
      if (model) model.value = p.model;
    }
    toast("已填入「" + p.name + "」，保存后生效");
  }

  function aiSaveSettings() {
    const ai = aiCfg();
    ai.text.base = document.getElementById("aiTextBase").value.trim();
    ai.text.key = document.getElementById("aiTextKey").value.trim();
    ai.text.model = document.getElementById("aiTextModel").value.trim();
    ai.image.mode = document.getElementById("aiImageMode").value;
    ai.image.base = document.getElementById("aiImageBase").value.trim();
    ai.image.key = document.getElementById("aiImageKey").value.trim();
    ai.image.model = document.getElementById("aiImageModel").value.trim();
    ai.image.size = document.getElementById("aiImageSize").value;
    ai.video.base = document.getElementById("aiVideoBase").value.trim();
    ai.video.key = document.getElementById("aiVideoKey").value.trim();
    ai.video.model = document.getElementById("aiVideoModel").value.trim();
    // 云端审核
    const modOn = document.getElementById("aiModerateEnabled");
    const modProv = document.getElementById("aiModerateProvider");
    ai.moderate.enabled = !!(modOn && modOn.checked);
    ai.moderate.provider = (modProv && modProv.value) || ai.moderate.provider;
    const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    if (ai.moderate.provider === "zhipu") ai.moderate.apiKey = get("aiModZhipuKey");
    else if (ai.moderate.provider === "tencent") {
      ai.moderate.secretId = get("aiModTencentSid");
      ai.moderate.secretKey = get("aiModTencentSkey");
      ai.moderate.region = get("aiModTencentRegion") || "ap-guangzhou";
    } else if (ai.moderate.provider === "alibaba") {
      ai.moderate.secretId = get("aiModAlibabaAk");
      ai.moderate.secretKey = get("aiModAlibabaSk");
    } else if (ai.moderate.provider === "proxy") {
      ai.moderate.proxyUrl = get("aiModProxyUrl");
    }
    save();
    render();
    toast("AI 模型设置已保存");
  }

  async function aiTest(kind) {
    const ai = aiCfg();
    if (kind === "text") {
      ai.text.base = document.getElementById("aiTextBase").value.trim();
      ai.text.key = document.getElementById("aiTextKey").value.trim();
      ai.text.model = document.getElementById("aiTextModel").value.trim();
      save();
      if (!ai.text.base || !ai.text.key) { toast("先填接口地址和 API Key"); return; }
      toast("正在测试文案模型…");
      const r = await aiChat([{ role: "user", content: "只回复两个字：你好" }]);
      toast(r && r.ok ? "文案模型连接成功：" + String(r.text || "").slice(0, 20) : "文案模型失败：" + ((r && r.error) || ""));
      return;
    }
    if (kind === "image") {
      ai.image.mode = document.getElementById("aiImageMode").value;
      ai.image.base = document.getElementById("aiImageBase").value.trim();
      ai.image.key = document.getElementById("aiImageKey").value.trim();
      ai.image.model = document.getElementById("aiImageModel").value.trim();
      save();
      if (ai.image.mode === "free") { toast("免费通道无需配置，直接到「素材 → 生成图片」使用"); return; }
      if (!ai.image.base || !ai.image.key) { toast("先填接口地址和 API Key"); return; }
      if (!(window.NativeApp && NativeApp.available() && NativeApp.genImage)) { toast("自定义图片接口需在 App 内测试"); return; }
      toast("正在测试图片接口…");
      const r = await NativeApp.genImage(ai.image.base, ai.image.key, ai.image.model, "一只橘猫趴在窗台上晒太阳", ai.image.size);
      toast(r && r.ok ? "图片接口连接成功，图片已存相册" : "图片接口失败：" + ((r && r.error) || ""));
      return;
    }
    if (kind === "moderate") {
      // 保存当前表单值到 store
      const modProv = (document.getElementById("aiModerateProvider") || {}).value || ai.moderate.provider;
      ai.moderate.provider = modProv;
      if (modProv === "zhipu") ai.moderate.apiKey = (document.getElementById("aiModZhipuKey") || {}).value || ai.moderate.apiKey;
      else if (modProv === "tencent") {
        ai.moderate.secretId = (document.getElementById("aiModTencentSid") || {}).value || ai.moderate.secretId;
        ai.moderate.secretKey = (document.getElementById("aiModTencentSkey") || {}).value || ai.moderate.secretKey;
        ai.moderate.region = (document.getElementById("aiModTencentRegion") || {}).value || "ap-guangzhou";
      } else if (modProv === "alibaba") {
        ai.moderate.secretId = (document.getElementById("aiModAlibabaAk") || {}).value || ai.moderate.secretId;
        ai.moderate.secretKey = (document.getElementById("aiModAlibabaSk") || {}).value || ai.moderate.secretKey;
      } else if (modProv === "proxy") {
        ai.moderate.proxyUrl = (document.getElementById("aiModProxyUrl") || {}).value || ai.moderate.proxyUrl;
      }
      save();
      // 用内置的 1x1 红色 JPEG（base64）作为测试文件，包装成 data URL
      const testB64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AV/9k=";
      const testDataUrl = "data:image/jpeg;base64," + testB64;
      toast("正在测试云端审核（" + modProv + "）…");
      try {
        const r = await Core.moderateMedia(testDataUrl, "image");
        if (!r) { toast("未开启云端审核或未配置代理地址"); return; }
        const cat = (r.violations || []).map((v) => v.category).join("、");
        toast(r.passed ? "测试通过：未检测到违规（" + (r.provider || "") + "）" : "测试返回：" + (cat || "云端判定未通过") + "（" + (r.provider || "") + "）");
      } catch (e) {
        toast("云端审核测试失败：" + (e.message || e));
      }
      return;
    }
    ai.video.base = document.getElementById("aiVideoBase").value.trim();
    ai.video.key = document.getElementById("aiVideoKey").value.trim();
    ai.video.model = document.getElementById("aiVideoModel").value.trim();
    save();
    if (!ai.video.base || !ai.video.key) { toast("先填接口地址和 API Key"); return; }
    toast("视频生成较慢，请到「素材 → 新增视频」里直接生成");
  }

  /* ---------- AI 图片 / 视频生成记录 ---------- */

  // 把图片/视频记录写入生成记录；被拦截时同时写入拦截记录
  function recordMedia(o) {
    const kindName = o.kind === "video" ? "AI 视频" : "AI 图片";
    const item = {
      id: uid("h"), type: "", typeName: kindName, mode: o.source || "AI 生成",
      title: o.title || "", text: "", time: nowISO(), status: o.status,
      kind: o.kind, media: o.media || null
    };
    store.history.unshift(item);
    if (o.status === "已拦截") {
      store.blocks.unshift({
        id: uid("b"), word: o.word || "", category: o.category || "违规拦截",
        reason: o.reason || "内容违规，已强制拦截", original: o.title || "", replaced: "",
        time: nowISO(), source: kindName + " · " + (o.source || "AI 生成"),
        kind: o.kind, media: o.media || null
      });
    }
    save();
    queueItem(
      "历史生成记录",
      todayKey() + "_" + kindName + "_" + (o.status === "已拦截" ? "拦截" : "通过") + "_" + uid("").slice(1) + ".txt",
      "类型：" + kindName + "\n模式：" + (o.source || "AI 生成") + "\n时间：" + item.time +
        "\n合规：" + o.status + "\n画面/标题：" + (o.title || "") + "\n---\n" + (o.reason || "")
    );
    return item;
  }

  function blockInfo(check) {
    const cats = [...new Set(check.violations.map((v) => v.category))];
    const words = [...new Set(check.violations.map((v) => v.word))];
    return {
      category: cats.join("、"), word: words.join(" / "),
      reason: "命中 " + cats.join("、") + " 风险词：" + words.join(" / ")
    };
  }

  function openImageSheet() {
    const cfg = imageCfg();
    const presets = AI_PRESETS.image.map((p) =>
      '<button class="chip small' + (p.id === "free" && cfg.mode === "free" ? " active" : "") +
      '" onclick="App.aiImagePreset(\'' + p.id + '\')">' + p.name + "</button>"
    ).join("");
    openSheet(
      "<h3>AI 生成图片</h3>" +
      '<div class="field"><label>画面描述</label><textarea class="textarea" id="imgPrompt" rows="3" placeholder="例如：我的书桌，暖色台灯，真实生活感"></textarea></div>' +
      '<div class="field"><label>通道</label>' +
        '<select class="input" id="imgMode">' +
          '<option value="free"' + (cfg.mode === "free" ? " selected" : "") + ">免费通道（无需 Key）</option>" +
          '<option value="custom"' + (cfg.mode === "custom" ? " selected" : "") + ">自定义接口（OpenAI 兼容）</option>" +
        "</select>" +
      "</div>" +
      '<div class="chips" style="margin:-4px 0 10px">' + presets + "</div>" +
      '<details class="api-box"' + (cfg.mode === "custom" ? " open" : "") + "><summary>自定义接口设置（填一次即可）</summary>" +
        '<div class="field"><label>接口地址</label><input class="input" id="imgApiBase" placeholder="https://api.openai.com/v1" value="' + escapeHtml(cfg.base) + '" /></div>' +
        '<div class="field"><label>API Key</label><input class="input" id="imgApiKey" type="password" placeholder="sk-..." value="' + escapeHtml(cfg.key) + '" /></div>' +
        '<div class="field"><label>模型</label><input class="input" id="imgApiModel" placeholder="gpt-image-1 / cogview-3-flash" value="' + escapeHtml(cfg.model) + '" /></div>' +
        '<div class="field"><label>尺寸</label><input class="input" id="imgApiSize" placeholder="1024x1024" value="' + escapeHtml(cfg.size) + '" /></div>' +
        '<div class="muted" style="font-size:11px">Key 只保存在本机，不会上传到任何服务器；公用手机请勿填写。</div>' +
      "</details>" +
      '<div class="hint" style="margin-bottom:10px">' + icon("shield", 13) + "<span>免费通道由 Pollinations 提供，无需注册和 Key；描述会先过合规检测，命中风险词直接拦截；生成成功的图片自动存入相册。</span></div>" +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.generateImage()">生成</button></div>'
    );
  }

  // 图片预设：只改表单，不重建弹层，避免丢失已输入的描述
  function aiImagePreset(id) {
    const p = AI_PRESETS.image.find((x) => x.id === id);
    if (!p) return;
    const mode = document.getElementById("imgMode");
    if (mode) mode.value = p.mode;
    const base = document.getElementById("imgApiBase");
    if (base && p.base) base.value = p.base;
    const model = document.getElementById("imgApiModel");
    if (model && p.model) model.value = p.model;
    toast(p.mode === "free" ? "已切换到免费通道，无需填写 Key" : "已填入「" + p.name + "」，还需填写 API Key");
  }

  // 免费图片：Pollinations 直接 GET 返回图片，无需 Key
  async function generateFreeImage(prompt, size) {
    const dim = String(size || "1024x1024").split("x");
    const w = parseInt(dim[0], 10) || 1024;
    const h = parseInt(dim[1], 10) || 1024;
    const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
      "?width=" + w + "&height=" + h + "&nologo=true&seed=" + Date.now();
    toast("正在生成图片，请稍候…");
    let thumb = "";
    let saved = false;
    if (window.NativeApp && NativeApp.available() && NativeApp.saveMediaUrl) {
      const r = await NativeApp.saveMediaUrl(url, "AI图片_" + Date.now(), false);
      if (!r || !r.ok) { toast((r && r.error) || "图片下载失败，请重试"); return; }
      saved = true;
      thumb = r.thumb || "";
    }
    const m = {
      id: uid("img"), kind: "image", source: "AI 生成 · 免费通道", prompt: prompt,
      src: thumb || url, url: url, saved: saved, time: nowISO()
    };
    store.materials.images.unshift(m);
    if (!save()) { m.src = m.url || ""; save(); }
    recordMedia({
      kind: "image", status: "已通过", title: prompt, source: "AI 生成 · 免费通道",
      media: { src: m.src, url: m.url, prompt: prompt }
    });
    queueItem(
      "素材库/图片库/AI 生成", m.id + "_图片说明.txt",
      "提示词：" + prompt + "\n图片地址：" + url + "\n生成时间：" + m.time
    );
    render();
    toast(saved ? "图片已生成并保存到手机相册" : "图片已生成，点图片可预览 / 保存");
  }

  async function generateImage() {
    const prompt = document.getElementById("imgPrompt").value.trim();
    if (!prompt) { toast("先写画面描述"); return; }
    const cfg = imageCfg();
    cfg.mode = document.getElementById("imgMode").value;
    cfg.base = document.getElementById("imgApiBase").value.trim();
    cfg.key = document.getElementById("imgApiKey").value.trim();
    cfg.model = document.getElementById("imgApiModel").value.trim();
    cfg.size = document.getElementById("imgApiSize").value;
    save();

    const check = Core.checkText(prompt);
    if (!check.passed) {
      const info = blockInfo(check);
      recordMedia({
        kind: "image", status: "已拦截", title: prompt, source: "AI 生成",
        category: info.category, word: info.word,
        reason: info.reason + "，画面描述未通过检测，已拦截未生成"
      });
      closeSheet(); render();
      toast("画面描述含风险词，已拦截并记入生成记录");
      return;
    }

    closeSheet();

    // 免费通道：无需 Key，App 内下载入相册，网页版直接用图片地址
    if (cfg.mode === "free") {
      await generateFreeImage(prompt, cfg.size);
      return;
    }

    if (!(window.NativeApp && NativeApp.available() && NativeApp.genImage)) { toast("自定义图片接口需在 App 内使用"); return; }
    if (!cfg.base || !cfg.key) { toast("请先填写接口地址和 API Key，或切换到免费通道"); return; }

    toast("正在生成图片，请稍候…");
    const r = await NativeApp.genImage(cfg.base, cfg.key, cfg.model, prompt, cfg.size);
    if (!r || !r.ok) {
      const e = (r && r.error) || "生成失败";
      if (/违规|敏感|安全|policy|safety|moderat|blocked|reject|风险/i.test(e)) {
        recordMedia({
          kind: "image", status: "已拦截", title: prompt, source: "AI 生成",
          reason: "接口安全拦截：" + e
        });
        render();
        toast("图片被接口拦截，已记入生成记录");
        return;
      }
      toast(e);
      return;
    }

    const m = {
      id: uid("img"), kind: "image", source: "AI 生成", prompt: prompt,
      src: r.thumb || r.url || "", url: r.url || "", saved: !!r.saved, time: nowISO()
    };
    store.materials.images.unshift(m);
    // 缩略图过大时降级为原图地址，避免本地存储写满
    if (!save()) { m.src = m.url || ""; save(); }
    recordMedia({
      kind: "image", status: "已通过", title: prompt, source: "AI 生成",
      media: { src: m.src, url: m.url, prompt: prompt }
    });
    queueItem(
      "素材库/图片库/AI 生成", m.id + "_图片说明.txt",
      "提示词：" + prompt + "\n图片地址：" + (m.url || "见相册") + "\n生成时间：" + m.time
    );
    render();
    toast(r.saved ? "图片已生成并保存到手机相册" : "图片已生成，点图片可预览 / 保存");
  }

  /* ---------- 图片 / 视频预览与保存 ---------- */

  function openMediaPreview(kind, media, title, time, saveAction) {
    const md = media || {};
    const src = md.src || md.url || "";
    const mediaHtml = kind === "image"
      ? (src
        ? '<img class="preview-img" src="' + escapeHtml(src) + '" alt="" />'
        : '<div class="preview-empty">没有可预览的图片</div>')
      : (md.url
        ? '<video class="preview-video" controls playsinline src="' + escapeHtml(md.url) + '"></video>'
        : '<div class="preview-empty">没有可播放的视频文件<br>请重新选择本地视频或填写视频链接</div>');
    openSheet(
      "<h3>" + escapeHtml(title || (kind === "image" ? "图片预览" : "视频预览")) + "</h3>" +
      mediaHtml +
      '<div class="muted" style="margin:8px 0 10px">' + escapeHtml(md.prompt || "") +
        (time ? " · " + Core.timeAgo(time) : "") + "</div>" +
      '<div class="sheet-actions">' +
        (saveAction ? '<button class="btn ghost" onclick="' + saveAction + '">保存到手机</button>' : "") +
        '<button class="btn primary" onclick="App.closeSheet()">关闭</button>' +
      "</div>"
    );
  }

  async function saveMediaToPhone(kind, media, name) {
    const md = media || {};
    const url = md.url || "";
    const src = md.src || "";
    const native = window.NativeApp && NativeApp.available();
    if (native && NativeApp.saveMediaUrl && /^https?:/i.test(url)) {
      toast("正在保存到手机相册…");
      const r = await NativeApp.saveMediaUrl(url, name || "朋友圈素材", kind === "video");
      toast(r && r.ok ? "已保存到手机相册" : "保存失败：" + ((r && r.error) || "未知错误"));
      return;
    }
    if (kind === "image" && /^data:image\//.test(src)) {
      toast("正在保存到手机相册…");
      const r = await uploadBinary("素材库/图片库/保存", (name || "AI图片") + "_" + Date.now() + ".png", dataUrlToBlob(src));
      toast(r && r.ok ? "已保存到手机相册" : "保存失败：" + ((r && r.error) || "未知错误"));
      return;
    }
    const target = url || src;
    if (/^https?:/i.test(target)) { window.open(target, "_blank"); return; }
    toast("没有可保存的文件");
  }

  function previewImage(id) {
    const m = store.materials.images.find((x) => x.id === id);
    if (!m) return;
    const src = m.src || m.url || "";
    if (!src) { toast("这条记录没有可预览的图片"); return; }
    openMediaPreview("image", { src: m.src, url: m.url, prompt: m.prompt },
      m.prompt || "图片预览", m.time, "App.saveImageToPhone('" + id + "')");
  }

  function previewVideo(id) {
    const v = store.materials.videos.find((x) => x.id === id);
    if (!v) return;
    const src = v.url || videoPreviewUrls[id] || "";
    openMediaPreview("video", { url: src, prompt: v.title }, v.title || "视频预览", v.time,
      /^https?:/i.test(v.url || "") ? "App.saveVideoToPhone('" + id + "')" : "");
  }

  function previewHistoryMedia(id) {
    const h = store.history.find((x) => x.id === id) || store.blocks.find((x) => x.id === id);
    if (!h) return;
    const md = h.media || {};
    const canSave = /^https?:/i.test(md.url || "") || (h.kind === "image" && /^data:image\//.test(md.src || ""));
    openMediaPreview(h.kind, md, h.title || (h.kind === "image" ? "图片预览" : "视频预览"), h.time,
      canSave ? "App.saveHistoryMedia('" + id + "')" : "");
  }

  function saveImageToPhone(id) {
    const m = store.materials.images.find((x) => x.id === id);
    if (!m) return;
    saveMediaToPhone("image", { src: m.src, url: m.url }, "AI图片");
  }

  function saveVideoToPhone(id) {
    const v = store.materials.videos.find((x) => x.id === id);
    if (!v) return;
    saveMediaToPhone("video", { url: v.url }, v.title);
  }

  function saveHistoryMedia(id) {
    const h = store.history.find((x) => x.id === id) || store.blocks.find((x) => x.id === id);
    if (!h) return;
    saveMediaToPhone(h.kind, h.media || {}, h.kind === "video" ? h.title : "AI图片");
  }

  /* ---------- 素材上传 ---------- */
  const IMG_SOURCE_LIMIT = 30 * 1024 * 1024;   // 原图上限 30MB
  const VIDEO_LIMIT = 300 * 1024 * 1024;       // 视频上限 300MB
  // 本次打开期间可播放的本地视频临时地址（刷新后失效，文件已存相册）
  const videoPreviewUrls = {};

  // 独立 App 且未配置服务器：素材保存到手机本地而不是飞书云盘
  function nativeLocal() {
    return !!(window.NativeApp && NativeApp.available() && !NativeApp.hasServer());
  }

  // 用 canvas 压缩图片，避免手机大图撑爆 localStorage
  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const mime = (file.type || "").toLowerCase();
      // 浏览器无法解码 HEIC/HEIF 等格式，直接返回原文件做上传用
      if (mime && !mime.startsWith("image/") || mime === "image/heic" || mime === "image/heif") {
        reject(new Error("unsupported"));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      let done = false;
      const finish = (fn) => { if (!done) { done = true; URL.revokeObjectURL(url); fn(); } };
      const timer = setTimeout(() => finish(() => reject(new Error("图片处理超时"))), 15000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const w0 = img.naturalWidth || img.width;
          const h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) throw new Error("图片尺寸无效");
          const scale = Math.min(1, maxEdge / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const src = canvas.toDataURL("image/jpeg", quality);
          finish(() => resolve(src));
        } catch (e) {
          finish(() => reject(e));
        }
      };
      img.onerror = () => { clearTimeout(timer); finish(() => reject(new Error("unsupported"))); };
      img.src = url;
    });
  }

  // 将 File 直接转成 data URL（用于不支持 canvas 解码的图片格式，如 HEIC）
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(",");
    const meta = parts[0] || "";
    const mime = (meta.match(/:(.*?);/) || [])[1] || "application/octet-stream";
    const bin = atob(parts[1] || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // 二进制直传：服务端流式落盘后用 lark-cli 上传，大文件不占用页面内存与本地存储
  function uploadBinary(folder, name, blob, onProgress) {
    // 独立 App：由原生层保存到手机相册或转发到自定义服务器
    if (window.NativeApp && NativeApp.available()) {
      return NativeApp.upload(folder, name, blob, onProgress);
    }
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload?folder=" + encodeURIComponent(folder) + "&name=" + encodeURIComponent(name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText || "{}"); } catch (e) { d = { ok: false, error: "返回解析失败" }; }
        if (!d.ok && !d.error) d.error = "上传失败（HTTP " + xhr.status + "）";
        resolve(d);
      };
      xhr.onerror = () => resolve({ ok: false, error: "网络异常，请确认本地服务已启动" });
      xhr.send(blob);
    });
  }

  async function uploadImages(input) {
    const files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    if (!files.length) return;
    const big = files.filter((f) => f.size > IMG_SOURCE_LIMIT);
    const list = files.filter((f) => f.size <= IMG_SOURCE_LIMIT);
    if (big.length) toast(big.length + " 张图片超过 30MB，已跳过");
    if (!list.length) return;

    let done = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      toast("正在处理图片 " + (i + 1) + "/" + list.length + "…");

      // 媒体合规浅检测
      const cm = await Core.checkImage(file);
      if (!cm.passed) {
        const info = Core.blockInfo(cm);
        recordMedia({
          kind: "image", status: "已拦截", title: file.name, source: "图片上传",
          category: info.category, word: info.word,
          reason: "媒体合规浅检测未通过：" + (cm.violations[0] && cm.violations[0].reason || "")
        });
        toast("「" + file.name + "」疑似风险，已跳过并记入拦截记录");
        continue;
      }

      // 云端深度审核（在浅检之后）
      let cloudResult = null;
      try { cloudResult = await Core.moderateMedia(file, "image"); } catch (e) { cloudResult = null; }
      const cloudV = cloudResult && cloudResult.violations ? cloudResult.violations : [];
      const mergedPassed = !cloudResult || (cloudResult.passed && !cloudV.some((v) => /异常|未配置|代理/.test(v.category)));
      if (cloudResult && cloudV.length && !mergedPassed) {
        const info = Core.blockInfo({ violations: cloudV });
        recordMedia({
          kind: "image", status: "已拦截", title: file.name, source: "图片上传",
          category: info.category, word: info.word,
          reason: "云端审核未通过（" + (cloudResult.provider || "") + "）：" + (cloudV[0] && cloudV[0].reason || "")
        });
        toast("「" + file.name + "」云端审核未通过，已拦截");
        continue;
      } else if (cloudResult && cloudV.length) {
        // 有疑似 violation 但未到 block 级别（Review 级别），只提示
        toast("「" + file.name + "」云端审核有 " + cloudV.length + " 条疑似风险，建议人工复核");
      }

      let src, thumb, uploadBlob, ext = "jpg";
      try {
        src = await compressImage(file, 1280, 0.82);
        thumb = await compressImage(file, 480, 0.6);
        uploadBlob = dataUrlToBlob(src);
      } catch (e) {
        // canvas 无法解码（如 iPhone HEIC），直接用原文件上传
        if (e.message === "unsupported") {
          try {
            src = await fileToDataURL(file);
            thumb = src;
            uploadBlob = file;
            ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          } catch (e2) {
            toast("「" + file.name + "」处理失败：" + (e2.message || "无法读取"));
            continue;
          }
        } else {
          toast("「" + file.name + "」处理失败：" + (e.message || "无法读取"));
          continue;
        }
      }
      const m = {
        id: uid("img"), source: "图片上传", prompt: file.name, src: src, time: nowISO(),
        size: Math.round(file.size / 1024), synced: false, url: ""
      };
      store.materials.images.unshift(m);
      if (!save()) {
        m.src = thumb;
        if (!save()) {
          store.materials.images = store.materials.images.filter((x) => x.id !== m.id);
          toast("本地存储已满，请先删除部分图片再上传");
          break;
        }
      }
      render();
      const safe = (file.name || "image").replace(/[\\/:*?"<>|]/g, "").replace(/\.[^.]+$/, "") || "image";
      const d = await uploadBinary(
        "素材库/图片库/图片上传",
        m.id + "_" + safe + "." + ext,
        uploadBlob,
        (p) => toast("图片 " + (i + 1) + "/" + list.length + " 上传中 " + p + "%")
      );
      if (d && d.ok) {
        m.synced = true;
        m.url = d.url || "";
        delete m.error;
        done++;
        save();
      } else {
        m.error = (d && d.error) || "上传失败";
        save();
      }
      render();
    }
    if (done) toast(nativeLocal() ? "已保存 " + done + " 张图片到手机相册" : "已上传 " + done + " 张图片到云盘图片库");
    else toast("图片已存入素材库，保存失败：" + (store.materials.images[0] && store.materials.images[0].error || "请重试"));
  }

  function removeImage(id) {
    const m = store.materials.images.find((x) => x.id === id);
    if (!m) return;
    store.materials.images = store.materials.images.filter((x) => x.id !== id);
    Core.logAudit("material", "delete", "图片", (m.prompt || "图片").slice(0, 40));
    save();
    render();
    toast(m.synced ? "已从本地删除（云盘文件保留）" : "已删除");
  }

  // 重试上传失败的图片（使用本地已存的压缩图数据）
  async function retryImage(id) {
    const m = store.materials.images.find((x) => x.id === id);
    if (!m || m.synced) return;
    toast("正在重试上传…");
    const blob = dataUrlToBlob(m.src);
    const safe = (m.prompt || "image").replace(/[\\/:*?"<>|]/g, "").replace(/\.[^.]+$/, "") || "image";
    const ext = (m.prompt || "x.jpg").split(".").pop() || "jpg";
    const d = await uploadBinary(
      "素材库/图片库/图片上传",
      m.id + "_" + safe + "." + ext,
      blob,
      (p) => toast("重试上传中 " + p + "%")
    );
    if (d && d.ok) {
      m.synced = true;
      m.url = d.url || "";
      delete m.error;
      toast("图片已重新上传到云盘");
    } else {
      m.error = (d && d.error) || "上传失败";
      toast("重试失败：" + m.error);
    }
    save();
    render();
  }

  /* ---------- 视频素材 ---------- */
  let pendingVideoFile = null;

  function openVideoSheet() {
    pendingVideoFile = null;
    openSheet(
      "<h3>新增视频素材</h3>" +
      '<div class="field"><label>标题</label><input class="input" id="videoTitle" placeholder="例如：我的一天 vlog" /></div>' +
      '<div class="field"><label>来源</label><select class="input" id="videoSource"><option>AI 生成</option><option>视频链接</option><option>本地视频</option></select></div>' +
      '<div class="field"><label>视频链接（可播放的 mp4 直链）</label><input class="input" id="videoUrl" placeholder="https://.../video.mp4" /></div>' +
      '<label class="btn ghost block file-label" style="margin-bottom:6px">选择手机里的视频<input class="file-cover" type="file" accept="video/*" onchange="App.pickVideoFile(this)" /></label>' +
      '<div class="muted" id="videoPick" style="margin-bottom:10px">未选择本地视频；选择后会自动保存到手机相册</div>' +
      '<div class="field"><label>AI 生成视频（免费 CogVideoX）</label>' +
        '<textarea class="textarea" id="videoPrompt" rows="3" placeholder="例如：傍晚的城市街道，暖光，慢镜头，写实风格"></textarea></div>' +
      '<button class="btn soft block" style="margin-bottom:10px" onclick="App.generateVideo()">' + icon("spark", 16) + "AI 生成视频（约 1-3 分钟）</button>" +
      '<div class="hint" style="margin-bottom:10px">' + icon("shield", 13) + "<span>标题会先过合规检测，命中风险词会直接拦截并记入生成记录；AI 生成视频需在 App 内使用，需先在「AI 模型接入」配置智谱 Key。</span></div>" +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveVideo()">保存</button></div>'
    );
  }

  // AI 生成视频：智谱 CogVideoX 异步任务，原生侧创建 + 轮询
  async function generateVideo() {
    const prompt = (document.getElementById("videoPrompt") || {}).value.trim();
    if (!prompt) { toast("先写画面描述"); return; }
    const cfg = aiCfg().video;
    if (!(window.NativeApp && NativeApp.available() && NativeApp.genVideo)) { toast("AI 生成视频需在 App 内使用"); return; }
    if (!cfg.base || !cfg.key) { toast("请先在「AI 模型接入」里配置视频模型和 Key"); return; }

    const check = Core.checkText(prompt);
    if (!check.passed) {
      const info = blockInfo(check);
      recordMedia({
        kind: "video", status: "已拦截", title: prompt, source: "AI 生成",
        category: info.category, word: info.word,
        reason: info.reason + "，视频描述未通过检测，已拦截未生成"
      });
      closeSheet(); render();
      toast("画面描述含风险词，已拦截并记入生成记录");
      return;
    }

    closeSheet();
    toast("视频生成中，约需 1-3 分钟，完成后自动保存…");
    const r = await NativeApp.genVideo(cfg.base, cfg.key, cfg.model, prompt);
    if (!r || !r.ok) { toast((r && r.error) || "视频生成失败"); return; }
    const url = r.url || "";
    let saved = false;
    if (url && NativeApp.saveMediaUrl) {
      const s = await NativeApp.saveMediaUrl(url, "AI视频_" + Date.now(), true);
      saved = !!(s && s.ok);
    }
    const v = {
      id: uid("v"), kind: "video", title: prompt.slice(0, 40), source: "AI 生成",
      url: url, time: nowISO(), size: 0, synced: false, local: false, error: ""
    };
    store.materials.videos.unshift(v);
    save();
    recordMedia({ kind: "video", status: "已通过", title: prompt, source: "AI 生成", media: { url: url, prompt: prompt } });
    queueItem(
      "素材库/视频库/AI 生成", v.id + "_视频说明.txt",
      "提示词：" + prompt + "\n视频地址：" + url + "\n生成时间：" + v.time
    );
    render();
    toast(saved ? "视频已生成并保存到手机相册" : "视频已生成，可在素材库预览");
  }

  function pickVideoFile(input) {
    const f = (input.files || [])[0];
    input.value = "";
    if (!f) return;
    pendingVideoFile = f;
    const el = document.getElementById("videoPick");
    if (el) el.textContent = "已选择：" + f.name + "（" + (f.size / 1048576).toFixed(1) + " MB）";
  }

  async function saveVideo() {
    const title = document.getElementById("videoTitle").value.trim();
    const source = document.getElementById("videoSource").value;
    const url = document.getElementById("videoUrl").value.trim();
    if (!title) { toast("写个标题再保存"); return; }

    const check = Core.checkText(title);
    if (!check.passed) {
      const info = blockInfo(check);
      recordMedia({
        kind: "video", status: "已拦截", title: title, source: source,
        category: info.category, word: info.word,
        reason: info.reason + "，视频标题未通过检测，已拦截未保存"
      });
      pendingVideoFile = null;
      closeSheet(); render();
      toast("标题含风险词，已拦截并记入生成记录");
      return;
    }

    const v = {
      id: uid("v"), kind: "video", title: title, source: source, url: url,
      time: nowISO(), size: 0, synced: false, local: false, error: ""
    };
    store.materials.videos.unshift(v);
    save();
    closeSheet();
    render();

    if (pendingVideoFile) {
      const file = pendingVideoFile;
      pendingVideoFile = null;
      v.local = true;
      v.size = Math.round(file.size / 1024);
      videoPreviewUrls[v.id] = URL.createObjectURL(file);
      render();
      const safe = (file.name || "video").replace(/[\\/:*?"<>|]/g, "");
      const d = await uploadBinary(
        "素材库/视频库/本地视频", v.id + "_" + safe, file,
        (p) => toast("视频保存中 " + p + "%")
      );
      if (d && d.ok) { v.synced = true; v.url = d.url || ""; delete v.error; }
      else { v.error = (d && d.error) || "保存失败"; }
      save();
      render();
      if (v.synced) {
        recordMedia({
          kind: "video", status: "已通过", title: title, source: source,
          media: { url: v.url, local: true }
        });
        toast("视频已保存到手机相册，可点卡片播放");
      } else {
        toast("记录已保存，文件保存失败：" + (v.error || "请重试"));
      }
      return;
    }

    recordMedia({
      kind: "video", status: "已通过", title: title, source: source,
      media: { url: url, local: false }
    });
    toast(url ? "视频素材已保存，可点卡片播放" : "视频记录已保存（未提供视频文件）");
  }

  async function uploadVideos(input) {
    const files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    if (!files.length) return;
    const big = files.filter((f) => f.size > VIDEO_LIMIT);
    const list = files.filter((f) => f.size <= VIDEO_LIMIT);
    if (big.length) toast(big.length + " 个视频超过 300MB，已跳过");
    if (!list.length) return;

    let done = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];

      // 媒体合规浅检测
      const cv = await Core.checkVideo(file);
      if (!cv.passed) {
        const info = Core.blockInfo(cv);
        recordMedia({
          kind: "video", status: "已拦截", title: file.name, source: "视频上传",
          category: info.category, word: info.word,
          reason: "媒体合规浅检测未通过：" + (cv.violations[0] && cv.violations[0].reason || "")
        });
        toast("「" + file.name + "」疑似风险，已跳过并记入拦截记录");
        continue;
      }

      // 云端深度审核
      let cloudResult = null;
      try { cloudResult = await Core.moderateMedia(file, "video"); } catch (e) { cloudResult = null; }
      const cloudV = cloudResult && cloudResult.violations ? cloudResult.violations : [];
      const mergedPassed = !cloudResult || (cloudResult.passed && !cloudV.some((v) => /异常|未配置|代理/.test(v.category)));
      if (cloudResult && cloudV.length && !mergedPassed) {
        const info = Core.blockInfo({ violations: cloudV });
        recordMedia({
          kind: "video", status: "已拦截", title: file.name, source: "视频上传",
          category: info.category, word: info.word,
          reason: "云端审核未通过（" + (cloudResult.provider || "") + "）：" + (cloudV[0] && cloudV[0].reason || "")
        });
        toast("「" + file.name + "」云端审核未通过，已拦截");
        continue;
      } else if (cloudResult && cloudV.length) {
        toast("「" + file.name + "」云端审核有 " + cloudV.length + " 条疑似风险，建议人工复核");
      }

      const safe = (file.name || "video").replace(/[\\/:*?"<>|]/g, "");
      const v = {
        id: uid("v"), kind: "video", title: safe, source: "视频上传", time: nowISO(),
        size: Math.round(file.size / 1024), synced: false, url: "", error: ""
      };
      videoPreviewUrls[v.id] = URL.createObjectURL(file);
      store.materials.videos.unshift(v);
      save();
      render();
      const d = await uploadBinary(
        "素材库/视频库/视频上传",
        v.id + "_" + safe,
        file,
        (p) => toast("视频 " + (i + 1) + "/" + list.length + " 上传中 " + p + "%")
      );
      if (d && d.ok) {
        v.synced = true;
        v.url = d.url || "";
        done++;
      } else {
        v.error = (d && d.error) || "上传失败";
      }
      save();
      render();
    }
    if (done) toast(nativeLocal() ? "已保存 " + done + " 个视频到手机相册" : "已上传 " + done + " 个视频到云盘视频库");
    else toast("视频记录已保存，上传失败：" + ((store.materials.videos[0] && store.materials.videos[0].error) || "请重试"));
  }

  function removeVideo(id) {
    const v = store.materials.videos.find((x) => x.id === id);
    store.materials.videos = store.materials.videos.filter((x) => x.id !== id);
    Core.logAudit("material", "delete", "视频", v ? (v.title || "视频").slice(0, 40) : "");
    save(); render();
    toast(v && v.synced ? "已从本地删除（云盘文件保留）" : "已删除");
  }

  // 视频文件不存本地，重试即重新选择文件上传
  function retryVideo(id) {
    const v = store.materials.videos.find((x) => x.id === id);
    if (v && !v.synced) {
      store.materials.videos = store.materials.videos.filter((x) => x.id !== id);
      save();
    }
    const input = document.querySelector('input.file-cover[accept="video/*"]');
    if (input) input.click();
    else toast("请点击「上传视频」重新选择");
  }


  /* ---------- 个人资料（按登录账号保存） ---------- */
  const SEC_HINT = {
    who: "例：我是谁、做什么的、在哪个城市、有什么身份标签",
    client: "例：我的客户是谁、他们的痛点与需求",
    product: "例：我的产品/服务名称、价格、能解决什么问题",
    style: "例：说话直接、口语化、接地气、有真实情感",
    avoid: "例：不要太硬广、不要有 AI 味、不要端着说教",
    samples: "粘贴 2-4 条你真实发过的朋友圈，生成时会模仿语气",
    manual: "一句话介绍自己，会作为个人说明书"
  };

  function editSection(id) {
    const s = store.profileSections.find((x) => x.id === id);
    if (!s) return;
    openSheet(
      "<h3>" + s.title + "</h3>" +
      '<div class="field"><textarea class="textarea" id="secInput" rows="9" placeholder="' + escapeHtml(SEC_HINT[id] || "") + '">' + escapeHtml(s.content) + "</textarea></div>" +
      '<div class="muted" style="margin-bottom:10px">仅保存在当前账号，生成文案 / 选题 / 排期时会参考</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveSection(\'' + id + '\')">保存</button></div>'
    );
  }

  function saveSection(id) {
    const s = store.profileSections.find((x) => x.id === id);
    if (!s) return;
    const before = s.content;
    s.content = document.getElementById("secInput").value.trim();
    Core.saveProfile();
    Core.logAudit("profile", "edit", s.title, (before ? "修改" : "新增") + "资料：" + (s.content || "已清空").slice(0, 40));
    closeSheet(); render();
    toast(s.content ? "资料已保存，生成时会参考" : "已清空该模块");
  }

  function editName() {
    openSheet(
      "<h3>修改昵称</h3>" +
      '<div class="field"><input class="input" id="nameInput" maxlength="20" value="' + escapeHtml(store.user.name || "") + '" placeholder="1-20 个字" /></div>' +
      '<div class="muted" style="margin-bottom:10px">昵称会显示在朋友圈预览和生成内容中</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveName()">保存</button></div>'
    );
  }

  async function saveName() {
    const v = (document.getElementById("nameInput").value || "").trim();
    if (!v) return toast("昵称不能为空");
    if (v.length > 20) return toast("昵称最多 20 个字");
    const r = window.Auth ? await Auth.changeName(v) : { ok: true };
    if (!r || !r.ok) return toast((r && r.error) || "修改失败");
    store.user.name = v;
    Core.saveProfile();
    Core.logAudit("profile", "edit", "昵称", v);
    if (window.Auth && Auth.current) Auth.current.name = v;
    closeSheet(); render(); toast("昵称已更新");
  }

  function editTagline() {
    openSheet(
      "<h3>一句话标签</h3>" +
      '<div class="field"><input class="input" id="tagInput" maxlength="30" value="' + escapeHtml(store.user.tagline || "") + '" placeholder="例：95 后 · 自媒体 · 一人公司" /></div>' +
      '<div class="muted" style="margin-bottom:10px">会展示在个人主页，也会用于生成时的身份描述</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.saveTagline()">保存</button></div>'
    );
  }

  function saveTagline() {
    store.user.tagline = (document.getElementById("tagInput").value || "").trim();
    Core.saveProfile();
    Core.logAudit("profile", "edit", "一句话标签", store.user.tagline);
    closeSheet(); render(); toast("标签已更新");
  }

  function editPerspectives() {
    openSheet(
      "<h3>身份标签</h3>" +
      '<div class="field"><textarea class="textarea" id="perspInput" rows="4" placeholder="用逗号或换行分隔，例：AI 自媒体创作者，自由职业者">' + escapeHtml((store.user.perspectives || []).join("，")) + "</textarea></div>" +
      '<div class="muted" style="margin-bottom:10px">最多 6 个；第一个会用于生成选题与身份句</div>' +
      '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
      '<button class="btn primary" onclick="App.savePerspectives()">保存</button></div>'
    );
  }

  function savePerspectives() {
    const raw = (document.getElementById("perspInput").value || "").trim();
    store.user.perspectives = raw.split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
    Core.saveProfile();
    Core.logAudit("profile", "edit", "身份标签", store.user.perspectives.join("、"));
    closeSheet(); render(); toast("身份标签已更新");
  }

  function pickAvatar() {
    const input = document.getElementById("avatarInput");
    if (input) input.click();
  }

  function onAvatarFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast("请选择图片文件");
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 200;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d");
        const s = Math.min(img.width, img.height) || 1;
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        try {
          store.user.avatar = c.toDataURL("image/jpeg", 0.86);
        } catch (e) {
          return toast("头像处理失败");
        }
        Core.saveProfile();
        render(); toast("头像已更新");
      };
      img.onerror = () => toast("图片读取失败");
      img.src = String(fr.result || "");
    };
    fr.onerror = () => toast("图片读取失败");
    fr.readAsDataURL(f);
  }

  function removeAvatar() {
    store.user.avatar = "";
    Core.saveProfile();
    Core.logAudit("profile", "edit", "头像", "移除头像");
    render(); toast("已恢复默认头像");
  }

  /* ---------- 排期 ---------- */
  function fillSlot(slotId) {
    const slot = store.slots.find((s) => s.id === slotId);
    const typeName = (slot.types[0] || "").replace("（克制）", "");
    const t = store.types.find((x) => x.name === typeName) || store.types[0];
    pickType(t.id);
    ui.compose.slotId = slotId;
    render();
  }

  function publishSlot(slotId) {
    const s = store.schedule.find((x) => x.slotId === slotId);
    if (!s) return;
    s.status = "已发布";
    save(); queueSchedule(); render(); toast("已标记为已发布");
  }

  /* ---------- 历史 / 合规 ---------- */
  function setHistoryTab(v) { ui.historyTab = v; render(); }
  function setLogsTab(v) { ui.logsTab = v; render(); }
  function setCheckInput(v) { ui.checkInput = v; }

  function runCheck() {
    ui.checkResult = Core.checkText(ui.checkInput || "");
    const stamp = nowISO().replace("T", " ");
    const detail = (ui.checkResult.violations || [])
      .map((v) => v.category + "｜" + v.word + " → " + v.suggestion)
      .join("\n");
    queueItem(
      "合规检测",
      todayKey() + "_检测记录_" + nowISO().slice(11).replace(":", "") + ".txt",
      "检测时间：" + stamp + "\n检测结果：" + (ui.checkResult.passed ? "通过" : "拦截 " + ui.checkResult.count + " 处") +
        "\n\n原文：\n" + (ui.checkInput || "") + "\n\n违规明细：\n" + (detail || "无")
    );
    render();
    toast(ui.checkResult.passed ? "检测通过" : "检测到 " + ui.checkResult.count + " 处违规");
  }

  function checkFix() {
    if (!ui.checkResult || ui.checkResult.passed) return;
    ui.checkInput = Core.replaceText(ui.checkInput, ui.checkResult.violations);
    ui.checkResult = Core.checkText(ui.checkInput);
    render();
    toast("已替换为合规版本");
  }

  window.App = {
    tab, go, back, render, toast,
    pickType, setMode, setSize, setTopic, setDraftText, toggleStyle, toggleMaterial,
    generate, polish, applyFix, copy, saveDraft, toMaterials, addToSchedule, openDraft,
    setTopicFilter, openTopicPicker, useTopic, topicToCompose, openTopicSheet, saveTopic,
    setTopicScope, editTopic, updateTopic, delTopic, confirmDelTopic, copyTopic,
    openSlotSheet, saveSlot, delSlot, confirmDelSlot, genSlotContent, editSlotContent, saveSlotContent,
    setMaterialTab, setMaterialCat, materialToCompose, copyMaterial, copyMaterialText,
    openMaterialAdd, saveMaterial, openImageSheet, generateImage, aiImagePreset,
    aiPreset, aiSaveSettings, aiTest, generateVideo, aiPresets: () => AI_PRESETS,
    previewImage, previewVideo, previewHistoryMedia,
    commitSchedule, doCommitSchedule, openSlotPicker, assignTopic, clearSlot,
    saveCloudCfg, cloudAuth, cloudSignOut, cloudPushNow, cloudPullNow, toggleCloudAuto,
    videoSrc: (id) => {
      const v = store.materials.videos.find((x) => x.id === id);
      return v ? (v.url || videoPreviewUrls[id] || "") : "";
    },
    saveImageToPhone, saveVideoToPhone, saveHistoryMedia,
    uploadImages, removeImage, retryImage,
    openCopyUpload, pickCopyFiles, saveCopyFiles,
    openVideoSheet, saveVideo, pickVideoFile, uploadVideos, removeVideo, retryVideo,
    editSection, saveSection, fillSlot, publishSlot,
    editName, saveName, editTagline, saveTagline, editPerspectives, savePerspectives,
    pickAvatar, onAvatarFile, removeAvatar,
    setHistoryTab, setLogsTab, setCheckInput, runCheck, checkFix,
    refreshRules: (force) => loadLiveRules(force),
    closeSheet, openSheet,
    syncNow: () => syncNow(), toggleAutoSync: (v) => { ui.sync.auto = v; persistSync(); toast(v ? "已开启自动归档" : "已关闭自动归档"); },
    flushSync: () => flushSync(),
    // 独立 App 专用
    nativeMode: () => !!(window.NativeApp && NativeApp.available()),
    exportArchive: () => exportArchive(),
    checkUpdate: () => checkUpdate(),
    saveUpdateUrl: () => saveUpdateUrl(),
    installUpdate: () => installUpdate(),
    currentVersion: () => currentVersion(),
    updateState: () => updateState(),
    nativeBack: () => {
      if (document.querySelector(".sheet-mask")) { closeSheet(); return "sheet"; }
      if (stack.length > 1) { back(); return "page"; }
      return "exit";
    },
    // 登录态相关
    authMe: () => Auth && Auth.current ? Auth.current : null,
    openChangePassword: () => {
      if (!Auth) return;
      openSheet(
        "<h3>修改登录密码</h3>" +
        '<div class="field"><label>原密码</label><input class="input" id="cpOld" type="password" /></div>' +
        '<div class="field"><label>新密码（数字 / 字母 / 符号自由组合，6-32 位）</label><input class="input" id="cpNew" type="password" oninput="App.pwdMeter(this.value)" /></div>' +
        '<div class="pw-wrap" style="margin:-4px 0 10px"><div class="pw-meter" id="cpMeter"><i></i><i></i><i></i><i></i></div><span class="pw-label" id="cpLabel">密码强度：未输入</span></div>' +
        '<div class="field"><label>再次输入新密码</label><input class="input" id="cpNew2" type="password" /></div>' +
        '<div class="sheet-actions"><button class="btn ghost" onclick="App.closeSheet()">取消</button>' +
        '<button class="btn primary" onclick="App.submitChangePassword()">确认修改</button></div>'
      );
    },
    pwdMeter: (v) => {
      if (!(window.Auth && Auth.strength)) return;
      const s = Auth.strength(v);
      const meter = document.getElementById("cpMeter");
      const label = document.getElementById("cpLabel");
      if (meter) meter.querySelectorAll("i").forEach((b, i) => { b.style.background = i < s.score ? s.color : "#E8EAEE"; });
      if (label) { label.textContent = "密码强度：" + s.label; label.style.color = s.color; }
    },
    submitChangePassword: async () => {
      const oldPwd = (document.getElementById("cpOld") || {}).value || "";
      const newPwd = (document.getElementById("cpNew") || {}).value || "";
      const newPwd2 = (document.getElementById("cpNew2") || {}).value || "";
      if (!oldPwd || !newPwd) { toast("请填写完整"); return; }
      if (newPwd !== newPwd2) { toast("两次新密码不一致"); return; }
      if (newPwd.length < 6) { toast("新密码至少 6 位"); return; }
      if (/\s/.test(newPwd)) { toast("密码不能包含空格"); return; }
      if (!Auth) return;
      const r = await Auth.changePassword(oldPwd, newPwd);
      if (r && r.ok) { closeSheet(); toast("密码已修改"); }
      else toast((r && r.error) || "修改失败");
    },
    logout: async () => {
      if (!Auth) return;
      openSheet(
        "<h3>退出登录？</h3>" +
        '<div class="muted" style="margin:8px 0 14px">退出后下次打开需重新登录。已生成的内容不会丢失。</div>' +
        '<div class="sheet-actions"><button class="btn primary ghost" onclick="App.closeSheet()">取消</button>' +
        '<button class="btn primary" onclick="App.confirmLogout()">确认退出</button></div>'
      );
    },
    confirmLogout: async () => {
      if (!Auth) return;
      const r = await Auth.logout();
      closeSheet();
      if (r && r.ok) {
        Auth.current = null;
        Auth.hideVip && Auth.hideVip();
        Auth.show();
        render();
      } else toast((r && r.error) || "退出失败");
    }
  };

  /* ---------- 本地归档（不上传任何服务器） ---------- */
  function queueItem(folder, name, content, encoding) {
    ui.sync.pending.push({ folder: folder, name: name, content: content, encoding: encoding || "utf8" });
    persistSync();
    if (ui.sync.auto) flushSync();
  }

  function syncHeader(kind) {
    const t = Core.typeById(kind.type);
    return "类型：" + (t ? t.name : "") + "\n模式：" + kind.mode + "\n时间：" + kind.time + "\n合规：" + (kind.status || "已通过") + "\n---\n";
  }

  function queueArtifact(c, item) {
    const t = Core.typeById(c.typeId);
    const modeFolder = c.mode === "ai" ? "AI 生成" : "自由创作";
    queueItem(
      "文案创作/" + t.name + "/" + modeFolder,
      todayKey() + "_" + item.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 20) + ".txt",
      syncHeader({ type: c.typeId, mode: item.mode, time: item.time, status: "已通过" }) + c.result
    );
    queueHistory(c);
  }

  function queueHistory(c) {
    const t = Core.typeById(c.typeId);
    const mode = c.mode === "ai" ? "AI 生成" : "自由创作";
    queueItem(
      "历史生成记录",
      todayKey() + "_" + (t ? t.name : "") + "_" + (c.check && c.check.passed ? "通过" : "拦截") + "_" + uid("").slice(1) + ".txt",
      syncHeader({ type: c.typeId, mode: mode, time: nowISO(), status: c.check && c.check.passed ? "已通过" : "已拦截" }) + c.result
    );
  }

  function scheduleText() {
    const lines = store.slots.map((s) => {
      const item = store.schedule.find((x) => x.slotId === s.id);
      return s.time + "（" + s.level + "）| " + s.scene + " | " + s.types.join("、") +
        (item ? " | 当前：" + item.status : " | 当前：未安排");
    });
    return "朋友圈 AI 助手 · 发布时间排期\n更新时间：" + nowISO() +
      "\n\n黄金时间段总览：\n" + lines.join("\n") +
      "\n\n内容黄金比例（4:3:2:1）：干货 40% / 生活人设 30% / 互动引导 20% / 促销转化 10%" +
      "\n发布频率：每天 2-4 条，间隔至少 2 小时，每周留 1 天轻发。";
  }

  function queueSchedule() {
    queueItem("发布时间排期", "每日发布排期表.txt", scheduleText());
  }

  function wordsText() {
    const byCat = {};
    store.words.forEach((w) => { (byCat[w.c] = byCat[w.c] || []).push(w.w + (w.s ? "→" + w.s : "")); });
    const rules = (store.rules && store.rules.length ? store.rules : (window.SEED.rules || []));
    return "朋友圈 AI 助手 · 合规词库与规则\n更新时间：" + nowISO() +
      "\n规则库版本：v" + (store.rulesVersion || window.SEED.rulesVersion || 1) +
      (store.rulesLiveVersion ? "\n在线规则版本：" + store.rulesLiveVersion + "（最近检查：" + (store.rulesCheckedAt || "-") + "）" : "") +
      "\n\n【检测依据】\n" + rules.map((r) => "· " + r.title + "（" + r.org + "）" +
        (r.updatedAt ? " 官方更新：" + r.updatedAt : "") +
        "\n  覆盖：" + r.scope + "\n  处置：" + r.action + "\n  链接：" + r.url).join("\n") +
      "\n\n【风险词库】\n" + Object.keys(byCat).map((c) => c + "：\n" + byCat[c].join("、")).join("\n\n") +
      "\n\n【检测规则】\n- 严格深度检测 + 强制拦截 + 一键替换\n- 命中风险词或手机号、站外链接即拦截\n- 未合规不可复制 / 保存 / 发布\n- 覆盖 AI 生成、自由创作、上传与素材库内容\n- 服务端每天 0 点联网同步微信官方规则与政策";
  }

  function buildAllItems() {
    const items = [];
    store.profileSections.forEach((s) => items.push({ folder: "个人资料库预设/" + s.folder, name: s.file, content: s.content }));
    store.topics.forEach((t) => items.push({ folder: "选题库", name: t.id + "_" + t.direction + ".txt", content: "方向：" + t.direction + "\n\n选题：" + t.title }));
    store.materials.copy.forEach((m) => items.push({ folder: "素材库/文案库/" + m.category, name: m.id + "_" + m.category + ".txt", content: m.text }));
    store.materials.images.forEach((m) => items.push({ folder: "素材库/图片库/" + m.source, name: m.id + "_图片说明.txt", content: "提示词：" + m.prompt + "\n图片地址：" + m.src + "\n时间：" + m.time }));
    store.materials.videos.forEach((v) => items.push({ folder: "素材库/视频库/" + v.source, name: v.id + "_视频说明.txt", content: "标题：" + v.title + "\n来源：" + v.source + "\n时间：" + v.time }));
    store.history.forEach((h) => items.push({ folder: "历史生成记录", name: h.id + "_" + (h.status === "已拦截" ? "拦截" : "通过") + ".txt", content: syncHeader({ type: h.type, mode: h.mode, time: h.time, status: h.status }) + h.text }));
    store.blocks.forEach((b) => items.push({ folder: "历史生成记录", name: "拦截记录_" + b.id + ".txt", content: "违规原因：" + b.reason + "\n违规内容：" + b.original + "\n替换内容：" + b.replaced + "\n时间：" + b.time }));
    items.push({ folder: "发布时间排期", name: "每日发布排期表.txt", content: scheduleText() });
    items.push({ folder: "合规检测", name: "合规词库与规则.txt", content: wordsText() });
    return items;
  }

  async function flushSync() {
    if (!ui.sync.pending.length || ui.sync.state === "busy") return;
    ui.sync.state = "busy";
    if (ui.page === "sync") render();
    try {
      if (!(window.NativeApp && NativeApp.available())) {
        ui.sync.state = "error";
        ui.sync.error = "本地归档只在 App 内可用，网页版无法写入手机存储。";
        persistSync();
        if (ui.page === "sync") render();
        return;
      }
      const nac = await NativeApp.sync(ui.sync.pending);
      if (!nac || !nac.ok) throw new Error((nac && nac.error) || "归档失败");
      ui.sync.pending = [];
      ui.sync.state = "ok";
      ui.sync.last = nowISO();
      ui.sync.synced = nac.synced || 0;
      ui.sync.error = "";
      toast("已归档 " + (nac.synced || 0) + " 个文件到本机");
    } catch (e) {
      ui.sync.state = "error";
      ui.sync.error = "归档失败：" + ((e && e.message) || "未知错误") + "，内容会留在待归档队列，可稍后重试。";
    }
    persistSync();
    if (ui.page === "sync") render();
  }

  async function syncNow() {
    if (ui.sync.state === "busy") return;
    if (!ui.sync.pending.length) ui.sync.pending = buildAllItems();
    await flushSync();
    if (ui.sync.state === "ok") {
      Core.logAudit("archive", "create", "本机归档", "已归档 " + (ui.sync.synced || 0) + " 个文件");
      render();
    }
  }

  function persistSync() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify({ pending: ui.sync.pending, auto: ui.sync.auto, last: ui.sync.last }));
    } catch (e) {}
  }

  function loadSync() {
    try {
      const d = JSON.parse(localStorage.getItem(SYNC_KEY) || "{}");
      if (d.pending) ui.sync.pending = d.pending;
      if (typeof d.auto === "boolean") ui.sync.auto = d.auto;
      if (d.last) ui.sync.last = d.last;
    } catch (e) {}
  }

  /* ---------- 在线合规规则库（服务端每天 0 点联网抓取官方规则） ---------- */
  async function loadLiveRules(force) {
    ui.rulesLoading = true;
    if (force && ui.page === "compliance") render();
    let changed = false;
    try {
      // 独立 App：规则库随安装包内置，无需联网拉取
      if (window.NativeApp && NativeApp.available()) {
        const live = NativeApp.builtinRules();
        if (!live || !live.version) throw new Error("内置规则库不可用");
        ui.rules = live;
        ui.rulesError = "";
        changed = Core.applyLiveRules(live);
        if (force) toast(changed ? "已应用内置规则库 " + live.version : "当前已是最新内置规则库（" + live.version + "）");
        ui.rulesLoading = false;
        if (ui.page === "compliance" || changed) render();
        return;
      }
      const res = force
        ? await fetch("/api/rules/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        : await fetch("/api/rules");
      const live = await res.json();
      if (!live || !live.version) throw new Error((live && live.error) || "规则接口不可用");
      ui.rules = live;
      ui.rulesError = "";
      changed = Core.applyLiveRules(live);
      if (force) toast(changed ? "规则库已更新到 " + live.version : "规则库已是最新（" + live.version + "）");
      if (changed && !force) toast("合规规则库已自动同步到 " + live.version);
    } catch (e) {
      // 无后端（file:// 直开单文件版）时降级使用内联规则库
      const builtin = window.__BUILTIN_RULES__;
      if (builtin && builtin.version && !force) {
        ui.rules = builtin;
        ui.rulesError = "";
        changed = Core.applyLiveRules(builtin);
        ui.rulesLoading = false;
        if (ui.page === "compliance" || changed) render();
        return;
      }
      ui.rulesError = (e && e.message) || "无法连接规则更新服务";
      if (force) toast("规则更新失败：" + ui.rulesError);
    }
    ui.rulesLoading = false;
    if (ui.page === "compliance" || changed) render();
  }

  /* ---------- 归档导出到手机公共目录 ---------- */
  function exportArchive() {
    const box = document.getElementById("exportResult");
    const show = (cls, html) => {
      if (!box) return;
      box.className = "server-test " + cls;
      box.innerHTML = html;
      box.style.display = "block";
    };
    if (!(window.NativeApp && NativeApp.available() && NativeApp.exportArchive)) {
      show("fail", "请在 App 内使用该功能");
      return;
    }
    show("busy", "正在导出，请稍候…");
    NativeApp.exportArchive().then((r) => {
      if (r && r.ok) {
        show("ok", "已导出 " + (r.exported || 0) + " 个文件到：" + escapeHtml(r.path || "") +
          "<br>用「文件管理」进入该目录即可查看" + (r.failed ? "（" + r.failed + " 个失败）" : ""));
        toast("归档已导出到 Documents/朋友圈AI助手");
      } else {
        show("fail", "导出失败：" + escapeHtml((r && r.error) || "未知错误"));
      }
    });
  }

  /* ---------- 检查更新 ---------- */

  // 更新源：内置源（打包时写进 meta）优先，用户在「检查更新」里填的永久源作为备用追加在末尾
  function updateManifestUrls() {
    const m = document.querySelector('meta[name="pyq-update"]');
    const raw = m ? String(m.getAttribute("content") || "") : "";
    let builtin = raw.split(",").map((s) => s.trim()).filter(Boolean);
    // 兜底：部分网页入口（cdn-assets/index.html）没有写 pyq-update meta，
    // 此时用 data.js 里的 versionJsonUrl，避免「当前版本未配置更新地址」
    if (!builtin.length && window.SEED && SEED.versionJsonUrl) builtin = [String(SEED.versionJsonUrl)];
    const custom = store.settings && store.settings.updateUrl ? String(store.settings.updateUrl).trim() : "";
    const extra = custom ? custom.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return builtin.concat(extra);
  }

  // 兼容两种格式：单条 JSON，或 NDJSON 多行（逐行从后往前找带 versionCode 的消息）
  function parseManifestText(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    const pick = (raw) => {
      try {
        const o = JSON.parse(raw);
        if (!o) return null;
        if (typeof o.message === "string") {
          try {
            const inner = JSON.parse(o.message);
            if (inner && inner.versionCode) return inner;
          } catch (e) {}
        }
        return Number(o.versionCode) ? o : null;
      } catch (e) {
        return null;
      }
    };
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 1) return pick(t);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = pick(lines[i]);
      if (m) return m;
    }
    return pick(t);
  }

  // 附加时间戳参数，绕过 CDN / 中间代理的陈旧缓存（jsDelivr 对 @main 缓存可达数小时）
  function withCacheBust(u) {
    const sep = u.indexOf("?") >= 0 ? "&" : "?";
    return u + sep + "_t=" + Date.now();
  }

  async function fetchManifest(url) {
    const target = withCacheBust(url);
    if (window.NativeApp && NativeApp.available() && NativeApp.checkUpdate) {
      const r = await NativeApp.checkUpdate(target);
      if (!r || !r.ok) throw new Error((r && r.error) || "检查更新失败");
      const m = parseManifestText(r.body);
      if (!m) throw new Error("版本清单格式不正确");
      return m;
    }
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) throw new Error("更新服务返回 HTTP " + res.status);
    const m = parseManifestText(await res.text());
    if (!m) throw new Error("版本清单格式不正确");
    return m;
  }

  function currentVersion() {
    if (window.NativeApp && NativeApp.available() && NativeApp.versionInfo) {
      const v = NativeApp.versionInfo() || {};
      if (v.versionCode) return { code: Number(v.versionCode), name: v.versionName || "" };
    }
    // 网页版：用构建号 + data.js 里的版本名
    const code = Number((window.SEED && SEED.APP_VERSION_CODE) || 0);
    return { code: code, name: (window.SEED && SEED.APP_VERSION_NAME) || "网页版" };
  }

  // 当前环境该比哪个字段：App 比 APK 版号，网页比 webBuild
  function isNativeApp() {
    return !!(window.NativeApp && NativeApp.available());
  }

  function manifestBuild(m) {
    return Number((isNativeApp() ? m.versionCode : (m.webBuild || m.versionCode)) || 0);
  }

  function updateState() {
    if (!ui.update) ui.update = { state: "idle" };
    return ui.update;
  }

  async function checkUpdate() {
    const s = updateState();
    if (s.state === "checking" || s.state === "install") return;
    s.state = "checking";
    s.error = "";
    if (ui.page === "update") render();
    const urls = updateManifestUrls();
    if (!urls.length) {
      s.state = "error";
      s.error = "当前版本未配置更新地址";
      if (ui.page === "update") render();
      return;
    }
    // 逐个拉取所有更新源，取 versionCode 最大的一份。
    // 不能「首个成功即停」：任一 CDN 缓存滞后都会返回旧清单，从而漏掉新版本。
    let best = null;
    const errs = [];
    for (const u of urls) {
      try {
        const got = await fetchManifest(u);
        if (!best || Number(got.versionCode) > Number(best.versionCode)) best = got;
      } catch (e) {
        errs.push((e && e.message) || "请求失败");
      }
    }
    const m = best;
    if (m) {
      const cur = currentVersion();
      s.latest = m;
      s.checkedAt = nowISO();
      s.hasNew = Number(m.versionCode) > cur.code;
      s.state = "done";
      toast(s.hasNew ? "发现新版本 v" + m.versionName : "已是最新版本 v" + cur.name);
    } else {
      s.state = "error";
      s.error = errs[0] || "无法连接更新服务";
    }
    if (ui.page === "update") render();
  }

  // 保存永久更新源（如 jsDelivr 上的 version.json），留空则用内置地址
  function saveUpdateUrl() {
    const el = document.getElementById("updSrc");
    const v = el ? el.value.trim() : "";
    if (!store.settings) store.settings = {};
    store.settings.updateUrl = v;
    save();
    const s = updateState();
    s.state = "idle";
    s.auto = true;
    s.latest = null;
    s.hasNew = false;
    toast(v ? "备用更新源已保存，正在重新检查…" : "已清空备用更新源，正在重新检查…");
    checkUpdate();
  }

  async function installUpdate() {
    const s = updateState();
    const m = s.latest || {};
    if (!m.url) { toast("版本清单里没有下载地址"); return; }
    if (!(window.NativeApp && NativeApp.available() && NativeApp.installUpdate)) {
      toast("请在 App 内更新，网页版无法安装");
      return;
    }
    s.state = "install";
    s.error = "";
    if (ui.page === "update") render();
    try {
      // 备用下载源：用户填的 APK 直链优先，其次用版本清单里的地址
      const custom = store.settings && store.settings.updateUrl ? String(store.settings.updateUrl).trim() : "";
      const direct = custom.split(",").map((s) => s.trim()).filter((u) => /\.apk(\?|$)/i.test(u));
      const r = await NativeApp.installUpdate(direct.length ? direct[0] : m.url);
      if (!r || !r.ok) throw new Error((r && r.error) || "下载失败");
      s.state = "done";
      toast("安装包已下载，请在系统弹窗中确认安装");
    } catch (e) {
      s.state = "done";
      s.error = (e && e.message) || "更新失败";
      toast(s.error);
    }
    if (ui.page === "update") render();
  }

  /* ---------- 云端同步（Supabase）：账号 + 数据 ---------- */
  function cloudCfgInputs() {
    const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    return { url: get("clUrl"), key: get("clKey"), account: get("clAccount"), pwd: get("clPwd") };
  }

  function saveCloudCfg() {
    const v = cloudCfgInputs();
    if (!store.settings) store.settings = {};
    if (!store.settings.cloud) store.settings.cloud = { url: "", key: "", account: "", auto: true };
    if (!v.url || !v.key) { toast("请先填写 Supabase 地址和 anon key"); return; }
    store.settings.cloud.url = v.url;
    store.settings.cloud.key = v.key;
    if (v.account) store.settings.cloud.account = v.account;
    save();
    toast("云端配置已保存");
    Cloud.init();
    render();
  }

  async function cloudAuth(mode) {
    const v = cloudCfgInputs();
    if (!window.Cloud) { toast("云同步模块未加载"); return; }
    if (!Cloud.configured() && (!v.url || !v.key)) { toast("请先填写 Supabase 地址和 anon key，并点「保存配置」"); return; }
    if (v.url && v.key) {
      store.settings.cloud.url = v.url;
      store.settings.cloud.key = v.key;
    }
    if (!v.account) { toast("请填写手机号或邮箱"); return; }
    if (!v.pwd) { toast("请填写密码"); return; }
    store.settings.cloud.account = v.account;
    save();
    toast(mode === "up" ? "正在注册…" : "正在登录…");
    const r = await (mode === "up" ? Cloud.signUp(v.account, v.pwd) : Cloud.signIn(v.account, v.pwd));
    if (!r || !r.ok) { toast(r.error || "操作失败"); render(); return; }
    Core.logAudit("account", mode === "up" ? "signup" : "login", v.account, mode === "up" ? "注册云账号" : "登录云账号");
    const rr = await Cloud.reconcile(false);
    render(true);
    toast(rr && rr.direction === "down" ? "已登录，内容已从云端恢复" : "已登录，本地内容已上传");
  }

  async function cloudSignOut() {
    if (!window.Cloud) return;
    await Cloud.signOut();
    toast("已退出云账号（本地内容保留）");
    render();
  }

  async function cloudPushNow() {
    if (!window.Cloud || !Cloud.hasSession()) { toast("请先登录云账号"); return; }
    const r = await Cloud.push(false);
    Core.logAudit("sync", "push", "云端", r && r.size ? Math.round(r.size / 1024) + " KB" : "");
    render();
    if (r && r.size) toast("已上传（" + Math.round(r.size / 1024) + " KB）");
  }

  async function cloudPullNow() {
    if (!window.Cloud || !Cloud.hasSession()) { toast("请先登录云账号"); return; }
    const r = await Cloud.pull(true);
    if (!r.ok) { toast(r.error || "拉取失败"); return; }
    Core.logAudit("sync", "pull", "云端", r.empty ? "云端无数据" : "已覆盖本地");
    if (r.empty) { toast("云端还没有数据，可先点上传"); return; }
    render(true);
    toast("已从云端覆盖本地内容");
  }

  function toggleCloudAuto(v) {
    if (!store.settings) store.settings = {};
    if (!store.settings.cloud) store.settings.cloud = { url: "", key: "", account: "", auto: true };
    store.settings.cloud.auto = !!v;
    save();
    toast(v ? "已开启自动同步" : "已关闭自动同步");
    render();
  }

  /* ---------- 启动 ---------- */
  function clock() {
    const d = Core.now();
    const el = document.getElementById("clock");
    if (el) el.textContent = d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  // 联网校时：从网络响应头取真实时间，校准本机时钟（不依赖用户配置）
  async function syncNetworkTime() {
    try {
      // 独立 App：交给原生发一个 HTTPS 请求取 Date 响应头，避开 WebView 跨域限制
      if (window.NativeApp && NativeApp.available() && NativeApp.serverTime) {
        const r = await NativeApp.serverTime();
        if (r && r.ok && r.date) {
          Core.syncServerTime(r.date);
          checkDateRollover();
          clock();
        }
        return;
      }
      const res = await fetch("/api/status", { cache: "no-store" });
      const dateHdr = res.headers.get("Date") || res.headers.get("date");
      if (dateHdr) {
        Core.syncServerTime(dateHdr);
        // 校时后若日期变化，重新生成今日选题与排期
        checkDateRollover();
        clock();
      }
    } catch (e) {
      // 无网络时退化为本地时间，不影响使用
    }
  }

  // 跨天检测：联网校时后的日期一变就重新生成今日选题与排期
  function checkDateRollover() {
    if (Core.store.dailyDate !== Core.todayKey()) {
      Core.ensureDaily();
      if (ui.page === "schedule" || ui.page === "topics" || ui.page === "more" || ui.page === "home") render(true);
    }
  }

  /* ---------- 网页版自动更新 ----------
   * 与 App 无关：拿远程 version.json 里的 webBuild 跟 data.js 里的 SEED.APP_VERSION_CODE 比。
   * 关键：刷新必须带新的查询串，否则 index.html 和 ?v=NN 的脚本会命中浏览器缓存，
   * 用户点"刷新"仍加载旧代码，横幅会一直重复弹。
   */
  let webUpdateShown = false;

  function webBuildCode() {
    return Number((window.SEED && window.SEED.APP_VERSION_CODE) || 0);
  }

  function forceReload() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("_r", String(Date.now()));
      window.location.replace(u.toString());
    } catch (e) {
      window.location.reload();
    }
  }
  window.__pyqReload = forceReload;

  function showUpdateBanner(remote, build) {
    if (webUpdateShown) return;
    webUpdateShown = true;
    const note = (remote.webNotes && remote.webNotes[0]) || (remote.notes && remote.notes[0]) || "";
    const banner = document.createElement("div");
    banner.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:#7A5AF8;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15)";
    const span = document.createElement("span");
    span.style.flex = "1";
    span.textContent = "发现新版本 " + (remote.webName || ("build " + build)) + (note ? "：" + note : "");
    const btn = document.createElement("button");
    btn.textContent = "刷新到最新版";
    btn.style.cssText = "background:#fff;color:#7A5AF8;border:none;padding:6px 12px;border-radius:16px;font-weight:600";
    btn.onclick = forceReload;
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.style.cssText = "background:transparent;border:none;color:rgba(255,255,255,.7);font-size:18px";
    close.onclick = () => { banner.style.display = "none"; };
    banner.appendChild(span);
    banner.appendChild(btn);
    banner.appendChild(close);
    document.body.appendChild(banner);
    toast("发现新版本，点顶部「刷新到最新版」即可更新");
  }

  async function checkWebUpdate() {
    if (window.NativeApp && NativeApp.available()) return; // App 内走 APK 更新，不看网页版本
    if (!window.fetch) return;
    const local = webBuildCode();
    if (!local) return;
    if (webUpdateShown) return;
    // 逐个拉取所有更新源，取 webBuild 最大的一份：
    // jsDelivr 对 @main 的缓存可达数小时，只用它一个源会漏更新
    const urls = updateManifestUrls().filter((u) => /^https?:/i.test(u) && !/\.apk(\?|$)/i.test(u));
    let best = 0;
    let remote = null;
    for (const url of urls) {
      try {
        const res = await fetch(withCacheBust(url), { cache: "no-store" });
        if (!res.ok) continue;
        const m = parseManifestText(await res.text());
        if (!m) continue;
        // webBuild 是新字段；老清单没有时就退回 versionCode
        const build = Number(m.webBuild || m.versionCode || 0);
        if (build > best) { best = build; remote = m; }
      } catch (e) { /* 单个源失败不影响其它源 */ }
    }
    if (remote && best > local) showUpdateBanner(remote, best);
  }

  function init() {
    loadSync();
    clock();
    setInterval(clock, 20000);
    // 先按本地时间生成一版，联网校时后再按真实日期刷新
    Core.ensureDaily();
    setInterval(checkDateRollover, 60000);
    document.addEventListener("visibilitychange", checkDateRollover);
    // 联网校时：启动时立即同步，之后每 5 分钟再对一次
    syncNetworkTime();
    setInterval(syncNetworkTime, 5 * 60 * 1000);
    render(true);
    if (ui.sync.pending.length && ui.sync.auto) setTimeout(flushSync, 800);
    // 每次打开自动对齐服务端规则库（服务端每天 0 点联网更新，这里按需拉取）
    loadLiveRules(false);
    // 网页版自动更新：启动即查一次，之后每 10 分钟 + 切回前台时再查
    // （用 webBuild 与 SEED.APP_VERSION_CODE 比对，刷新时强制绕过缓存）
    checkWebUpdate();
    setInterval(checkWebUpdate, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkWebUpdate();
    });
    // 云同步：已登录云账号时启动即对齐，之后每 3 分钟拉一次
    if (window.Cloud) {
      Cloud.init();
      setInterval(() => {
        if (Cloud.hasSession() && (store.settings.cloud || {}).auto !== false) {
          Cloud.reconcile(true).then(() => { if (ui.page === "sync" || ui.page === "schedule") render(); });
        }
      }, 3 * 60 * 1000);
    }

    // 必须先登录：未登录显示登录遮罩；登录后校验会员是否到期
    if (window.Auth) {
      window.__authChanged = (me) => {
        if (me && me.phone) Core.bindProfile(me.phone, me.name);
        render();
      };
      Auth.getMe().then((me) => {
        Auth.current = me;
        if (!me) Auth.show();
        else {
          Core.bindProfile(me.phone, me.name);
          Auth.gate(me);
        }
      });
      // 让 native-back 在登录 / 会员遮罩期间拦截返回
      if (Auth.bindBack) Auth.bindBack(App);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
