/* views-diary.js — 我的日记：写 / 看 / 删，AI 学习日记内容让文案更像本人 */
(function () {
  const MOODS = ["开心", "平静", "感动", "疲惫", "焦虑", "期待", "感恩", "失落"];
  const WEATHERS = ["晴", "多云", "阴", "小雨", "大雨", "雪", "风", "雾"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------- 写日记 ---------- */
  function renderWrite(editId) {
    const store = Core.store;
    if (!store.diaries) store.diaries = [];
    const editing = editId ? store.diaries.find((d) => d.id === editId) : null;
    const today = editing ? editing.date : todayStr();
    const mood = editing ? editing.mood : "";
    const weather = editing ? editing.weather : "";
    const content = editing ? editing.content : "";

    return (
      '<div class="page pad">' +
        UI.head(editing ? "编辑日记" : "写日记", "AI 会参考日记，让文案更像你", "", true) +
        '<div class="card" style="margin-bottom:12px">' +
          '<div class="muted" style="margin-bottom:10px">记录今天的生活、心情、想法。<br><b>AI 写文案时会参考你的日记</b>，让文案更像你的口吻。</div>' +
          '<label class="muted">日期</label>' +
          '<input class="input" id="diaryDate" type="date" value="' + esc(today) + '" />' +
          '<label class="muted" style="margin-top:10px">心情（可选）</label>' +
          '<div class="diary-tags" id="diaryMoods">' +
            MOODS.map((m) => '<button type="button" class="diary-tag' + (mood === m ? " on" : "") + '" data-v="' + m + '">' + m + "</button>").join("") +
          "</div>" +
          '<label class="muted" style="margin-top:10px">天气（可选）</label>' +
          '<div class="diary-tags" id="diaryWeathers">' +
            WEATHERS.map((w) => '<button type="button" class="diary-tag' + (weather === w ? " on" : "") + '" data-v="' + w + '">' + w + "</button>").join("") +
          "</div>" +
          '<label class="muted" style="margin-top:10px">今天想说点什么</label>' +
          '<textarea class="input" id="diaryContent" rows="8" placeholder="比如：今天试了一家新餐厅，招牌菜真的绝了，姐妹们冲…">' + esc(content) + "</textarea>" +
          '<div style="display:flex;gap:8px;margin-top:12px">' +
            '<button class="btn primary flex1" onclick="App.saveDiary(\'' + (editId || "") + '\')">' + (editing ? "保存修改" : "保存日记") + "</button>" +
            (editing ? '<button class="btn ghost" onclick="App.delDiary(\'' + editId + '\')">删除</button>' : "") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  /* ---------- 日记列表 ---------- */
  function renderList() {
    const store = Core.store;
    const list = (store.diaries || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const cards = list.map((d) => {
      const preview = String(d.content || "").replace(/\s+/g, " ").slice(0, 80);
      return (
        '<div class="card diary-item" onclick="App.editDiary(\'' + d.id + '\')">' +
          '<div class="diary-item-head">' +
            '<span class="diary-date">' + esc(d.date || "") + "</span>" +
            (d.mood ? '<span class="diary-pill">' + esc(d.mood) + "</span>" : "") +
            (d.weather ? '<span class="diary-pill weather">' + esc(d.weather) + "</span>" : "") +
          "</div>" +
          '<div class="diary-preview">' + esc(preview) + (String(d.content || "").length > 80 ? "…" : "") + "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="page pad">' +
        UI.head("我的日记", "记录生活 · AI 学习参考", "", true) +
        '<button class="btn primary" style="width:100%;margin-bottom:12px" onclick="App.go(\'diary-write\')">✍️ 写一篇日记</button>' +
        (list.length === 0
          ? '<div class="empty-state"><div class="muted">还没有日记，点上方按钮写第一篇</div><div class="muted" style="margin-top:6px;font-size:12px">AI 会参考你的日记，让文案更像你</div></div>'
          : cards) +
      "</div>"
    );
  }

  window.ViewsDiary = {
    renderList,
    renderWrite
  };
})();
