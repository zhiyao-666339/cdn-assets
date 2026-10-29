/* 图标与通用渲染片段 */
(function () {
  const S = (paths, size) =>
    '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";

  const Icons = {
    sun: S('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>'),
    bulb: S('<path d="M9.2 18h5.6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6V16h5.6v-.6c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z"/>'),
    tool: S('<path d="M14.5 6.5a3.9 3.9 0 0 0 5.1 5.1l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>'),
    chart: S('<path d="M4 20V9M10 20V4M16 20v-7M22 20H2"/>'),
    spark: S('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'),
    bag: S('<path d="M4.5 8.5h15l-1 11.5h-13z"/><path d="M8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5"/>'),
    book: S('<path d="M4 4.5h6a2 2 0 0 1 2 2V20a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a2.5 2.5 0 0 1 2.5-2.5H20z"/>'),
    flag: S('<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 3.8L17 12H6"/>'),
    cloud: S('<path d="M7.5 18.5a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.6 10a4.25 4.25 0 0 1-.6 8.5z"/>'),
    shield: S('<path d="M12 3l7 2.8v5.4c0 4.6-3 7.9-7 9.8-4-1.9-7-5.2-7-9.8V5.8z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
    copy: S('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4"/><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5"/>'),
    check: S('<path d="m4.5 12.5 5 5L19.5 7"/>'),
    alert: S('<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
    right: S('<path d="m9 5 7 7-7 7"/>'),
    left: S('<path d="m15 5-7 7 7 7"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
    clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.3 2"/>'),
    image: S('<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6"/><circle cx="8.6" cy="9.4" r="1.6"/><path d="m4.4 17.4 4.8-4.6a1.6 1.6 0 0 1 2.2 0l2.3 2.2 1.8-1.7a1.6 1.6 0 0 1 2.2 0l2.3 2.2"/>'),
    video: S('<rect x="3" y="5.5" width="13" height="13" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>'),
    doc: S('<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5V9h5M9 13h6M9 16.5h6"/>'),
    calendar: S('<rect x="3.5" y="5" width="17" height="16" rx="2.4"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    user: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.2c.6-3.5 3.6-5.6 7.4-5.6s6.8 2.1 7.4 5.6"/>'),
    folder: S('<path d="M3.5 6.5h6l2 2.5h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    refresh: S('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
    save: S('<path d="M5 3.5h11L20.5 8v12.5H5z"/><path d="M8.5 3.5V9H16M8.5 20.5V14h7v6.5"/>'),
    send: S('<path d="m3.5 12 17-8-6 17-3-6z"/><path d="m11.2 10.8 9.3-6.8"/>'),
    star: S('<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
    trash: S('<path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7M6.5 6.5l.8 13.2h9.4l.8-13.2"/>')
  };

  function icon(name, size) { return Icons[name] || Icons.doc; }

  function head(title, sub, rightHtml, back) {
    return (
      '<div class="page-head">' +
        (back
          ? '<button class="icon-btn" onclick="App.back()" aria-label="返回">' + icon("left", 21) + "</button>"
          : '<div style="width:4px"></div>') +
        '<div style="flex:1;min-width:0">' +
          '<h1 style="font-size:' + (back ? 17 : 21) + 'px;text-align:left">' + title + "</h1>" +
          (sub ? '<div class="sub">' + sub + "</div>" : "") +
        "</div>" +
        (rightHtml || "") +
      "</div>"
    );
  }

  function empty(text, ic) {
    return '<div class="empty"><div class="e-icon">' + icon(ic || "doc", 22) + "</div>" + text + "</div>";
  }

  window.Icons = Icons;
  window.UI = { icon, head, empty };
})();
