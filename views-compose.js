/* 页面：创作工作区（AI 生成 / 自由创作 + 合规拦截 + 朋友圈预览） */
(function () {
  const { store, ui } = Core;
  const icon = UI.icon;

  const AI_STYLES = [
    { id: "deai", label: "去 AI 味" },
    { id: "like", label: "更像我本人" },
    { id: "real", label: "有真人感" },
    { id: "softsell", label: "营销感弱一点" },
    { id: "emotion", label: "更有情感故事感" },
    { id: "casual", label: "专业弱一点、口语化" }
  ];
  const FREE_STYLES = [
    { id: "softsell", label: "营销感弱一点" },
    { id: "emotion", label: "更有情感故事感" },
    { id: "casual", label: "专业化弱一点、口语化" }
  ];

  function renderCompose() {
    const c = ui.compose;
    if (!c) return "";
    const t = Core.typeById(c.typeId) || store.types[0];
    const isAI = c.mode === "ai";
    const styles = isAI ? AI_STYLES : FREE_STYLES;
    const size = c.size || "short";

    // 文风选项缩小显示
    const styleChips = styles.map((s) =>
      '<button class="chip small ' + (c.styles.indexOf(s.id) >= 0 ? "active" : "") + '" onclick="App.toggleStyle(\'' + s.id + '\')">' + s.label + "</button>"
    ).join("");

    return (
      '<div class="page compose-page">' +
        UI.head(t.name, t.structure, '<span class="tag ' + (c.check && !c.check.passed ? "red" : "green") + '">' +
          (c.check ? (c.check.passed ? "合规通过" : "已拦截") : "待检测") + "</span>", true) +

        // 文案结构 + 写作提示
        '<div class="tip-card">' +
          '<div class="tip-row"><span class="tip-label">结构</span><span class="tip-val">' + t.structure + "</span></div>" +
          '<div class="tip-row"><span class="tip-label">提示</span><span class="tip-val"><b>' + t.instruction + "</b></span></div>" +
          '<div class="tip-row"><span class="tip-label">方向</span><span class="tip-val">' + t.direction + "</span></div>" +
        "</div>" +

        '<div class="seg">' +
          '<button class="' + (isAI ? "active" : "") + '" onclick="App.setMode(\'ai\')">AI 生成</button>' +
          '<button class="' + (!isAI ? "active" : "") + '" onclick="App.setMode(\'free\')">自由创作</button>' +
        "</div>" +

        '<div class="seg mini size-seg">' +
          '<button class="' + (size === "short" ? "active" : "") + '" onclick="App.setSize(\'short\')">短文</button>' +
          '<button class="' + (size === "long" ? "active" : "") + '" onclick="App.setSize(\'long\')">长文</button>' +
        "</div>" +
        '<div class="size-hint">' + (size === "short"
          ? "短文 ≈ 3 行 / " + Core.SHORT_MAX + " 字内，适合快速刷屏，不易被折叠"
          : "长文 4-8 段，适合讲故事、做案例，注意前两行放钩子") + "</div>" +

        (isAI ? aiForm(c, styleChips) : freeForm(c, styleChips)) +
        resultBlock(c, t) +
      "</div>"
    );
  }

  function aiForm(c, styleChips) {
    return (
      // AI 生成：大输入框
      '<div class="field">' +
        '<textarea class="textarea" id="composeInput" rows="6" placeholder="写下这次的选题 / 想写的事，例如：我普通的一天" oninput="App.setTopic(this.value)">' + Core.escapeHtml(c.topic) + "</textarea>" +
      "</div>" +

      // 文风调节（缩小，放在输入框下方）
      '<div class="chips">' + styleChips + "</div>" +

      '<button class="btn primary block" onclick="App.generate()">' +
        icon("spark", 17) + (c.result ? "重新生成" : "生成文案") + "</button>" +
      '<div class="hint">' + icon("shield", 13) + "<span>生成后自动检测，命中违规会立即拦截，并给出可替换版本。</span></div>"
    );
  }

  function freeForm(c, styleChips) {
    const len = [...c.text].length;
    const short = (c.size || "short") === "short";
    const judge = short
      ? (len > Core.SHORT_MAX ? "偏长，建议切「长文」" : "长度合适")
      : (len < 200 ? "偏短，长文建议 300 字以上" : "长度合适");
    return (
      // 自由创作：大输入框
      '<div class="field">' +
        '<textarea class="textarea" id="composeInput" rows="7" placeholder="' + (short ? "想到什么就写什么，一两句也行…" : "想到什么就写什么，长文可以分几段…") + '" oninput="App.setDraftText(this.value)">' + Core.escapeHtml(c.text) + "</textarea>" +
        '<div style="display:flex;justify-content:space-between;margin-top:6px">' +
          '<span class="muted" id="charCount">' + len + " 字 · " + (short ? "目标 ≤ " + Core.SHORT_MAX : "目标 300+") + "</span>" +
          '<span class="muted">' + judge + "</span>" +
        "</div>" +
      "</div>" +

      // 文风调节（缩小，放在输入框下方）
      '<div class="chips">' + styleChips + "</div>" +

      '<button class="btn primary block" onclick="App.polish()">' + icon("spark", 17) + "AI 润色并检测</button>" +
      '<div class="hint">' + icon("shield", 13) + "<span>润色不会改变你的原意，只调整语气、结构和营销感。</span></div>"
    );
  }

  function resultBlock(c, t) {
    if (c.loading) {
      return '<div class="card result"><div class="gen-loading"><i></i><i></i><i></i><i></i></div><div class="muted" style="text-align:center">正在按「' + t.name + '」结构生成…</div></div>';
    }
    if (!c.result) return "";

    const check = c.check || Core.checkText(c.result);
    const fold = Core.foldInfo(c.result);
    const highlightHtml = Core.highlight(c.result, check.violations);
    const violationsHtml = check.violations.slice(0, 5).map((v) =>
      '<div class="vio">' +
        '<div class="vio-head"><span class="tag red">' + v.category + "</span><span class=\"vio-word\">" + Core.escapeHtml(v.word) + "</span></div>" +
        '<div class="vio-reason">' + v.reason + "</div>" +
        '<div class="vio-fix">建议替换为「' + Core.escapeHtml(v.suggestion) + "」</div>" +
      "</div>"
    ).join("");

    return (
      '<div class="card result">' +
        '<div class="result-head"><h3>生成结果</h3>' +
          '<span class="tag ' + (check.passed ? "green" : "red") + '">' + (check.passed ? "合规可发布" : "强制拦截") + "</span>" +
        "</div>" +
        '<div class="meta">' +
          '<span class="tag gray" style="margin-right:2px">' + (c.size === "long" ? "长文" : "短文") + "</span>" +
          "<span>" + fold.chars + " 字</span>" +
          "<span>预计 " + fold.lines + " 行</span>" +
          '<span class="' + (fold.folded ? "warn" : "ok") + '">折叠风险 ' + fold.risk + "</span>" +
        "</div>" +
        '<div class="copy-text">' + highlightHtml + "</div>" +

        '<div class="compliance ' + (check.passed ? "pass" : "fail") + '">' +
          '<div class="comp-head">' + icon(check.passed ? "shield" : "alert", 16) +
            (check.passed ? "合规检测通过" : "检测到 " + check.count + " 处违规，已拦截") +
          "</div>" +
          '<div class="comp-desc">' + (check.passed
            ? "未命中违禁词 / 敏感词 / 极限词 / 营销违规，可以复制发布。"
            : "未替换为安全版本前，不可复制、保存或发布。") + "</div>" +
          violationsHtml +
        "</div>" +

        (c.replaced
          ? '<div class="muted" style="margin-top:12px;margin-bottom:5px">已替换为安全合规版本</div><div class="replaced">' + Core.escapeHtml(c.fixedText) + "</div>"
          : "") +

        '<div class="hint" style="margin-top:12px">' + icon("clock", 13) + "<span>防折叠：" + fold.advice + "</span></div>" +
        moment(c.result, check) +
        actions(c, check) +
      "</div>"
    );
  }

  function moment(text, check) {
    const fold = Core.foldInfo(text);
    const u = store.user || {};
    const name = u.name || "我";
    const avatar = u.avatar
      ? '<div class="moment-avatar" style="padding:0;overflow:hidden"><img src="' + Core.escapeHtml(u.avatar) + '" alt="头像" /></div>'
      : '<div class="moment-avatar">' + Core.escapeHtml([...name][0] || "我") + "</div>";
    return (
      '<div class="moment-preview">' +
        '<div class="moment-head">' + avatar +
          "<div><div class=\"moment-name\">" + Core.escapeHtml(name) + "</div>" +
          '<div style="font-size:11px;color:#B2B6BC;margin-top:2px">刚刚 · 朋友圈预览</div></div>' +
        "</div>" +
        '<div class="moment-text' + (fold.folded ? " moment-fold" : "") + '">' + Core.escapeHtml(text) + "</div>" +
        (fold.folded ? '<div class="moment-more">全文</div>' : "") +
        '<div class="moment-foot"><span>' + (fold.lines > 6 ? "会被折叠为「全文」" : "完整展示，不会被折叠") + "</span>" +
          '<div class="fold-meter"><i class="on"></i><i class="' + (fold.lines > 2 ? "on" : "") + '"></i><i class="' + (fold.lines > 4 ? (fold.folded ? "warn" : "on") : "") + '"></i></div>' +
        "</div>" +
      "</div>"
    );
  }

  function actions(c, check) {
    if (!check.passed && !c.replaced) {
      return '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn danger" onclick="App.applyFix()">一键替换</button>' +
        '<button class="btn ghost" onclick="App.generate()">重新生成</button>' +
      "</div>";
    }
    return '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn primary" onclick="App.copy()">' + icon("copy", 16) + "复制全文</button>" +
        '<button class="btn ghost" onclick="App.saveDraft()">' + icon("save", 16) + "保存并归档</button>" +
      "</div>" +
      '<div class="btn-row" style="margin-top:8px">' +
        '<button class="btn soft small" onclick="App.toMaterials()">存入素材库</button>' +
        '<button class="btn soft small" onclick="App.addToSchedule()">加入今日排期</button>' +
      "</div>";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  window.ViewsCompose = { renderCompose, copyText };
})();
