/* Android App 桥接层：在独立安装的 App 内替代本地服务端
 * - 未配置服务器地址时：图片/视频直接保存到手机相册，文本归档写入 App 私有目录
 * - 配置了服务器地址时：沿用现有 /api/upload 与 /api/sync 上传飞书云盘
 */
(function () {
  const B = window.AndroidBridge;
  if (!B || typeof B.isNative !== "function") {
    window.NativeApp = { available: () => false };
    return;
  }

  let seq = 0;
  const waiters = {};

  function resolveCallback(id, payload) {
    const fn = waiters[id];
    if (!fn) return;
    delete waiters[id];
    let data = payload;
    if (typeof payload === "string") {
      try {
        data = JSON.parse(payload);
      } catch (e) {
        data = { ok: false, error: "原生返回解析失败" };
      }
    }
    fn(data || { ok: false, error: "未知错误" });
  }

  function call(method, args) {
    return new Promise((resolve) => {
      const cid = "n" + (++seq);
      waiters[cid] = resolve;
      try {
        if (method === "uploadPicked") B.uploadPicked(args[0], args[1], args[2], cid);
        else if (method === "uploadBytes") B.uploadBytes(args[0], args[1], args[2], cid);
        else if (method === "syncText") B.syncText(args[0], cid);
        else if (method === "exportArchive") B.exportArchive(cid);
        else if (method === "serverTime") B.serverTime(cid);
        else if (method === "checkUpdate") B.checkUpdate(args[0], cid);
        else if (method === "installUpdate") B.installUpdate(args[0], cid);
        else if (method === "genImage") B.genImage(args[0], args[1], args[2], args[3], args[4], cid);
        else if (method === "aiChat") B.aiChat(args[0], args[1], args[2], args[3], cid);
        else if (method === "genVideo") B.genVideo(args[0], args[1], args[2], args[3], cid);
        else if (method === "saveMediaUrl") B.saveMediaUrl(args[0], args[1], !!args[2], cid);
        else resolve({ ok: false, error: "未知原生方法：" + method });
      } catch (e) {
        delete waiters[cid];
        resolve({ ok: false, error: "原生调用失败：" + ((e && e.message) || e) });
      }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || "").split(",")[1] || "");
      fr.onerror = () => reject(new Error("读取文件失败"));
      fr.readAsDataURL(blob);
    });
  }

  function serverUrl() {
    try {
      return (B.getServer() || "").trim().replace(/\/+$/, "");
    } catch (e) {
      return "";
    }
  }

  function pickFail(r) {
    return r && r.code === "not_found";
  }

  /* 上传：优先用文件选择时已缓存到原生的原文件（视频零拷贝），否则走 base64 */
  async function upload(folder, name, blob, onProgress) {
    const notify = (p) => { if (onProgress) onProgress(p); };
    notify(5);

    if (blob && blob.name) {
      const r = await call("uploadPicked", [folder, name, blob.name]);
      if (!pickFail(r)) {
        notify(100);
        return r;
      }
    }
    const b64 = await blobToBase64(blob);
    notify(55);
    const r = await call("uploadBytes", [folder, name, b64]);
    notify(100);
    return r;
  }

  /* 文本归档同步：本地模式下写入 App 私有目录；有服务器则走原生 HTTP */
  async function sync(items) {
    const list = (items || []).filter((it) => !/图片库|视频库/.test(it.folder || ""));
    if (!list.length) return { ok: true, synced: 0, failed: 0, local: !serverUrl() };
    return call("syncText", [JSON.stringify(list)]);
  }

  function builtinRules() {
    try {
      const raw = B.builtinRules();
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  window.NativeApp = {
    available: () => true,
    hasServer: () => !!serverUrl(),
    serverUrl: serverUrl,
    setServer: (v) => {
      try {
        B.setServer(String(v || "").trim());
        return true;
      } catch (e) {
        return false;
      }
    },
    upload,
    sync,
    // 联网校时：原生发 HTTPS 请求取 Date 响应头
    serverTime: () => call("serverTime", []),
    // 归档导出：把私有目录的文案复制到公共 Documents
    exportArchive: () => call("exportArchive", []),
    // 检查更新：拉取远程版本清单 / 下载并拉起安装器
    versionInfo: () => {
      try {
        return JSON.parse(B.versionInfo() || "{}");
      } catch (e) {
        return {};
      }
    },
    checkUpdate: (manifestUrl) => call("checkUpdate", [manifestUrl]),
    installUpdate: (apkUrl) => call("installUpdate", [apkUrl]),
    // AI 生成图片：走用户自己配置的接口，生成后直接存入相册
    genImage: (base, key, model, prompt, size) => call("genImage", [base, key, model, prompt, size]),
    // AI 文案：OpenAI 兼容 chat/completions
    aiChat: (base, key, model, messagesJson) => call("aiChat", [base, key, model, messagesJson]),
    // AI 视频：智谱 CogVideoX 异步任务（创建 + 轮询）
    genVideo: (base, key, model, prompt) => call("genVideo", [base, key, model, prompt]),
    // 把网络图片/视频保存到手机相册
    saveMediaUrl: (url, name, isVideo) => call("saveMediaUrl", [url, name, !!isVideo]),
    builtinRules,
    toast: (msg) => { try { B.toast(String(msg)); } catch (e) {} },
    __cb: resolveCallback,
    __progress: () => {}
  };

  // 原生回调统一入口（原生通过 evaluateJavascript 调用）
  window.__nativeResolve = (id, payload) => resolveCallback(id, payload);

  // 系统状态栏由 Android 绘制，隐藏页面自绘的状态栏
  document.documentElement.classList.add("native-app");
})();
