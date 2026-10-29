/* 页面：选题库 + 素材库 */
(function () {
  const { store, ui } = Core;
  const icon = UI.icon;

  // 文案库按「文案类型」归档（与创作页的 8 种类型保持一致）
  function copyTypeNames() {
    return store.types.map((t) => t.name);
  }

  function renderTopics() {
    const scope = ui.topicScope || "all"; // all / today
    const all = store.topics || [];
    const todayList = Core.todayTopicList();
    const todaySet = new Set(todayList.map((t) => t.id));
    const list = scope === "today" ? todayList : all;
    const directions = ["全部"].concat([...new Set(all.map((t) => t.direction))]);
    const filter = ui.topicFilter || "全部";
    const shown = list.filter((t) => filter === "全部" || t.direction === filter);

    const chips = directions.map((d) =>
      '<button class="chip ' + (filter === d ? "active" : "") + '" onclick="App.setTopicFilter(\'' + d.replace(/'/g, "\\'") + '\')">' + d + "</button>"
    ).join("");

    const cards = shown.map((t, i) => {
      const type = Core.typeById(t.type);
      const item = (store.schedule || []).find((x) => x.topicId === t.id);
      const slot = item ? store.slots.find((s) => s.id === item.slotId) : null;
      return (
        '<div class="topic-card" onclick="App.topicToCompose(\'' + t.id + '\')">' +
          '<div class="topic-index">' + (i + 1 < 10 ? "0" : "") + (i + 1) + "</div>" +
          '<div class="topic-body">' +
            "<h3>" + Core.escapeHtml(t.title) + "</h3>" +
            '<div class="topic-meta">' +
              '<span class="tag blue">' + t.direction + "</span>" +
              (type ? '<span class="tag gray">' + type.name + "</span>" : "") +
              (slot ? '<span class="tag green">' + slot.time.split("-")[0] + "</span>" : (todaySet.has(t.id) ? '<span class="tag orange">今日</span>' : "")) +
            "</div>" +
          "</div>" +
          '<div class="topic-actions" onclick="event.stopPropagation()">' +
            '<button class="btn ghost small" onclick="App.openSlotPicker(\'' + t.id + '\')">' + (slot ? "改时段" : "排期") + "</button>" +
            '<button class="btn ghost small" onclick="App.editTopic(\'' + t.id + '\')">改</button>' +
            '<button class="btn ghost small" onclick="App.copyTopic(\'' + t.id + '\')">复制</button>' +
            '<button class="btn ghost small" style="color:#FA5151" onclick="App.delTopic(\'' + t.id + '\')">删</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="page">' +
        UI.head("选题库", "全部选题 · 可增删改复制", '<button class="icon-btn round" onclick="App.openTopicSheet()">' + icon("plus", 19) + "</button>") +
        '<div class="tabs" style="margin-top:12px">' +
          '<button class="' + (scope === "all" ? "active" : "") + '" onclick="App.setTopicScope(\'all\')">全部 ' + all.length + "</button>" +
          '<button class="' + (scope === "today" ? "active" : "") + '" onclick="App.setTopicScope(\'today\')">今日 ' + todayList.length + "</button>" +
        "</div>" +
        '<div class="notice" style="margin-top:12px">' + icon("bulb", 15) +
          "<span>选题库展示所有选题，每天 0 点从中轮换出今日选题；可随时新增、修改、复制、删除，所有操作自动留痕到历史记录。</span></div>" +
        '<div class="filter-scroll">' + chips + "</div>" +
        (cards || UI.empty("还没有选题，点右上角添加", "bulb")) +
        '<div class="hint">' + icon("bulb", 14) + "<span>点选题可带入创作；「排期」安排到今日时段；「改/复制/删」管理选题库。</span></div>" +
      "</div>"
    );
  }

  function renderMaterials() {
    const tab = ui.materialsTab || "copy";
    const headBtn = '<button class="icon-btn round" onclick="App.openMaterialAdd()">' + icon("plus", 19) + "</button>";
    let body = "";
    if (tab === "copy") body = copyLib();
    if (tab === "image") body = imageLib();
    if (tab === "video") body = videoLib();

    return (
      '<div class="page">' +
        UI.head("素材库", "文案 · 图片 · 视频", headBtn) +
        '<div class="tabs">' +
          tabBtn("copy", "文案库 " + store.materials.copy.length, tab) +
          tabBtn("image", "图片库 " + store.materials.images.length, tab) +
          tabBtn("video", "视频库 " + store.materials.videos.length, tab) +
        "</div>" +
        body +
      "</div>"
    );
  }

  function tabBtn(id, label, active) {
    return '<button class="' + (active === id ? "active" : "") + '" onclick="App.setMaterialTab(\'' + id + '\')">' + label + "</button>";
  }

  function copyLib() {
    const cat = ui.materialCat || "全部";
    const cats = ["全部"].concat(copyTypeNames());
    const chips = cats.map((c) =>
      '<button class="chip small ' + (cat === c ? "active" : "") + '" onclick="App.setMaterialCat(\'' + c + '\')">' + c + "</button>"
    ).join("");
    const list = store.materials.copy.filter((m) => cat === "全部" || (m.type || m.category) === cat);
    const rows = list.map((m) => {
      const t = m.type || m.category;
      return (
        '<div class="material-item">' +
          '<div class="mf" style="margin-bottom:6px"><span class="tag blue">' + t + "</span>" +
            (m.legacyCategory ? '<span class="muted" style="margin-left:8px">原分类：' + Core.escapeHtml(m.legacyCategory) + "</span>" : "") +
          "</div>" +
          '<div class="mt">' + Core.escapeHtml(m.text) + "</div>" +
          '<div class="mf">' +
            "<span>" + Core.timeAgo(m.time) + "</span>" +
            '<div style="display:flex;gap:10px">' +
              '<button class="link-btn" onclick="App.copyMaterial(\'' + m.id + '\')">复制</button>' +
              '<button class="link-btn" onclick="App.materialToCompose(\'' + m.id + '\')">去创作</button>' +
            "</div>" +
          "</div>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="filter-scroll" style="padding-bottom:10px">' + chips + "</div>" +
      '<div class="btn-row" style="margin-bottom:12px">' +
        '<button class="btn ghost small" onclick="App.openMaterialAdd()">新增文案</button>' +
        '<button class="btn ghost small" onclick="App.openCopyUpload()">上传文案文件</button>' +
      "</div>" +
      (rows || UI.empty("这个类型还没有文案素材", "doc")) +
      '<div class="hint">' + icon("cloud", 14) + "<span>文案按「文案类型」归档，保存后自动同步到云盘「素材库/文案库/类型」目录。</span></div>"
    );
  }

  function imageLib() {
    const cards = store.materials.images.map((m) => {
      const isHeic = /^data:image\/hei[cf]/.test(m.src || "");
      const hasMedia = !!(m.src || m.url);
      return (
      '<div class="img-card"' + (hasMedia ? ' onclick="App.previewImage(\'' + m.id + '\')"' : "") + ">" +
        (isHeic
          ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#f0f0f0;color:#999;font-size:11px">HEIC 图片<br>已存手机</div>'
          : (m.src
            ? '<img src="' + m.src + '" alt="' + Core.escapeHtml(m.prompt || "") + '" loading="lazy" />'
            : '<div class="img-miss">无预览</div>')) +
        '<span class="img-badge ' + (m.synced ? "ok" : "") + '">' + Core.escapeHtml(m.source || "图片") + "</span>" +
        '<div class="cap" style="display:flex;justify-content:space-between;align-items:end;gap:6px">' +
          "<span>" + Core.escapeHtml(m.prompt || m.source) + "</span>" +
          '<div style="display:flex;gap:8px;flex:0 0 auto">' +
            (hasMedia ? '<button class="link-btn" style="color:#fff;font-size:10.5px" onclick="event.stopPropagation();App.saveImageToPhone(\'' + m.id + '\')">保存</button>' : "") +
            (!m.synced && m.source === "图片上传" ? '<button class="link-btn" style="color:#fff;font-size:10.5px" onclick="event.stopPropagation();App.retryImage(\'' + m.id + '\')">重试</button>' : "") +
            '<button class="link-btn" style="color:#fff;font-size:10.5px" onclick="event.stopPropagation();App.removeImage(\'' + m.id + '\')">删除</button>' +
          "</div>" +
        "</div>" +
      "</div>"
      );
    }).join("");
    return (
      '<div class="img-grid">' +
        '<button class="img-add" onclick="App.openImageSheet()" style="font-family:inherit">' + icon("spark", 21) + "<span>AI 生成图片</span></button>" +
        '<label class="img-add">' + icon("cloud", 21) + "<span>上传图片</span>" +
          '<input class="file-cover" type="file" accept="image/*" multiple onchange="App.uploadImages(this)" />' +
        "</label>" +
        cards +
      "</div>" +
      '<div class="hint">' + icon("cloud", 14) + "<span>点任意图片可全屏预览并保存到手机相册；AI 生成的图片会自动保存到相册 / Pictures/朋友圈AI助手。</span></div>"
    );
  }

  function videoLib() {
    const cards = store.materials.videos.map((v) => {
      const playable = !!App.videoSrc(v.id);
      return (
        '<div class="video-card">' +
          '<div class="video-thumb' + (playable ? " play" : "") + '" onclick="App.previewVideo(\'' + v.id + '\')">' +
            icon("video", 22) + "</div>" +
          '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + Core.escapeHtml(v.title) + "</div>" +
            '<div class="muted">' + Core.escapeHtml(v.source || "") + " · " + Core.timeAgo(v.time) +
            (v.size ? " · " + (v.size >= 1024 ? (v.size / 1024).toFixed(1) + " MB" : v.size + " KB") : "") +
            "</div>" +
            (!playable
              ? '<div class="muted">未提供视频文件</div>'
              : v.local && !v.url
                ? '<div class="muted" style="color:#05803F">已保存到手机相册</div>'
                : '<div class="muted" style="color:#05803F">可播放</div>') +
            (v.error
              ? '<div class="muted" style="color:#C4281C">保存失败：' + Core.escapeHtml(v.error) + "</div>"
              : "") +
          "</div>" +
          '<div style="display:flex;flex-direction:column;gap:6px;flex:0 0 auto">' +
            (playable ? '<button class="link-btn" onclick="App.previewVideo(\'' + v.id + '\')">播放</button>' : "") +
            (/^https?:/i.test(v.url || "") ? '<button class="link-btn" onclick="App.saveVideoToPhone(\'' + v.id + '\')">保存</button>' : "") +
            (v.error ? '<button class="link-btn" onclick="App.retryVideo(\'' + v.id + '\')">重试</button>' : "") +
            '<button class="link-btn" onclick="App.removeVideo(\'' + v.id + '\')">删除</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");
    return (
      (cards || UI.empty("还没有视频素材<br>选本地视频或填写视频链接即可播放", "video")) +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn ghost small" onclick="App.openVideoSheet()">新增视频素材</button>' +
        '<label class="btn ghost small file-label">上传视频' +
          '<input class="file-cover" type="file" accept="video/*" multiple onchange="App.uploadVideos(this)" />' +
        "</label>" +
      "</div>" +
      '<div class="hint">' + icon("cloud", 14) + "<span>本地视频会自动保存到手机相册（Movies/朋友圈AI助手），本机播放只保留在当前打开期间；视频链接可直接在线播放。</span></div>"
    );
  }

  window.ViewsLibrary = { renderTopics, renderMaterials, copyTypeNames, copyLib };
})();
