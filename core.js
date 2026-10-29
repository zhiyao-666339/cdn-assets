/* 核心：状态、合规引擎、生成引擎、工具函数 */
(function () {
  const KEY = "pyq_store_v1";
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const CATEGORY_REASON = {
    极限词: "违反《广告法》第九条及微信小店广告禁用词规则：不得使用“国家级/最高级/最佳”等绝对化用语",
    虚假宣传: "违反微信小店「违规使用广告禁用词」：虚假承诺、夸大功效，须有事实依据",
    虚假限时: "违反微信小店规则：虚假限时、虚假价格文案，实际无法兑现即属欺诈",
    权威背书: "违反微信小店规则：滥用国家机关/权威机构/大师背书，无法提供证明即违规",
    诱导分享: "违反《微信外部链接内容管理规范》2.1：诱导分享、集赞、助力、砍价",
    利益诱导: "违反《微信外部链接内容管理规范》2.1.2 / 2.6.1：利益诱导与虚假红包活动",
    迷信宣传: "违反《微信个人账号使用规范》2.3：宣扬封建迷信、改运消灾类内容",
    营销违规: "违反《微信个人账号使用规范》第8章与过度营销规则",
    违禁敏感: "违反《微信个人账号使用规范》第1/4/5/6章：法律法规禁止内容，存在封号风险",
    医疗健康: "违反《广告法》第十六条：医疗功效承诺与绝对化表述",
    金融违规: "违反《微信个人账号使用规范》8.3及外链规范2.7.2：收益承诺、多级分销、非法投资",
    导流信息: "违反《微信外部链接内容管理规范》2.9：站外/私域导流，易被折叠限流",
    侵权隐私: "违反《微信个人账号使用规范》7.2：侵犯他人隐私、肖像、知识产权",
    不实信息: "违反《微信个人账号使用规范》第2章：不实信息与谣言",
    联系方式: "违反《微信个人账号使用规范》7.2.2：疑似联系方式/隐私信息，朋友圈会限流",
    标题党: "违反《微信公众平台运营规范》3.1：标题夸张、误导、与内容不符，属标题党违规",
    诱导关注: "违反《微信公众平台运营规范》3.2：诱导关注/分享，强制或利益诱导用户关注",
    抄袭侵权: "违反《微信公众平台运营规范》4：抄袭、洗稿、未经授权转载他人内容",
    低俗: "违反《微信公众平台运营规范》5：低俗、违背公序良俗的表述"
  };

  // 旧版文案库分类 → 文案类型（原文保留在 legacyCategory）
  const LEGACY_COPY_TYPE = {
    灵感想法型: "观点认知型",
    感悟心得型: "读书感悟型",
    经典语录: "观点认知型",
    金句名言: "观点认知型",
    未加工文案: "生活日常型",
    成品文案: "经验分享型"
  };

  const PROFILE_VERSION = 2;

  function loadStore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.types && s.words) {
          // 老版本缓存迁移：示例图片来源改用本地资源
          if (s.materials && s.materials.images) {
            s.materials.images.forEach((img) => {
              const seed = window.SEED.materials.images.find((x) => x.id === img.id);
              if (seed) img.src = seed.src;
            });
          }
          // 清空内置人设：改为注册用户自行填写（每个账号独立资料）
          if (!s.profiles) s.profiles = {};
          if (!s.profileVersion || s.profileVersion < PROFILE_VERSION) {
            s.user = { name: "", avatar: "", tagline: "", perspectives: [] };
            s.profileSections = clone(window.SEED.profileSections);
            s.profileVersion = PROFILE_VERSION;
            s.currentPhone = "";
          }
          // 清空内置示例数据：历史 / 草稿 / 拦截 / 素材改为只保留用户自己产生的
          if (!s.seedCleaned) {
            const demoIds = { h1: 1, h2: 1, h3: 1, h4: 1, b1: 1, d1: 1, d2: 1 };
            s.history = (s.history || []).filter((x) => !demoIds[x.id]);
            s.drafts = (s.drafts || []).filter((x) => !demoIds[x.id]);
            s.blocks = (s.blocks || []).filter((x) => !demoIds[x.id]);
            if (s.materials) {
              s.materials.copy = (s.materials.copy || []).filter((x) => !/^m\d+$/.test(x.id || ""));
              s.materials.images = (s.materials.images || []).filter((x) => !/^img\d+$/.test(x.id || ""));
            }
            s.seedCleaned = true;
          }
          // 合规规则升级：同步最新官方词库与规则依据
          if (!s.rulesVersion || s.rulesVersion < window.SEED.rulesVersion) {
            s.words = clone(window.SEED.words);
            s.rules = clone(window.SEED.rules);
            s.rulesVersion = window.SEED.rulesVersion;
          }
          // 文案库：按文案类型归类（保留原分类，便于回溯）
          if (s.materials && s.materials.copy) {
            s.materials.copy.forEach((m) => {
              if (m.type) return;
              const mapped = LEGACY_COPY_TYPE[m.category] || m.category;
              if (mapped !== m.category) m.legacyCategory = m.category;
              m.type = mapped;
              m.category = mapped;
            });
          }
          // 生成设置默认值（AI 模型 / 图片接口 / 永久更新源 / 云同步）
          if (!s.settings) s.settings = {};
          if (!s.settings.ai || typeof s.settings.ai !== "object") s.settings.ai = {};
          const ai = s.settings.ai;
          if (!ai.text || typeof ai.text !== "object") ai.text = { base: "", key: "", model: "" };
          if (!ai.image || typeof ai.image !== "object") ai.image = { mode: "free", base: "", key: "", model: "gpt-image-1", size: "1024x1024" };
          if (!ai.video || typeof ai.video !== "object") ai.video = { base: "", key: "", model: "cogvideox-flash" };
          if (!ai.image.mode) ai.image.mode = "free";
          if (typeof ai.text.key !== "string") ai.text.key = "";
          if (typeof ai.text.base !== "string") ai.text.base = "";
          if (typeof ai.text.model !== "string") ai.text.model = "";
          if (typeof ai.image.base !== "string") ai.image.base = "";
          if (typeof ai.image.key !== "string") ai.image.key = "";
          if (typeof ai.image.model !== "string") ai.image.model = "";
          if (typeof ai.image.size !== "string" || !ai.image.size) ai.image.size = "1024x1024";
          if (typeof ai.video.base !== "string") ai.video.base = "";
          if (typeof ai.video.key !== "string") ai.video.key = "";
          if (typeof ai.video.model !== "string") ai.video.model = "";
          // 旧版图片接口配置迁移到 ai.image，用户已填过的设置不丢失
          if (!s.settings.imageApi) s.settings.imageApi = { base: "", key: "", model: "gpt-image-1", size: "1024x1024" };
          if (s.settings.imageApi.base && !ai.image.base) {
            ai.image.mode = "custom";
            ai.image.base = s.settings.imageApi.base;
            ai.image.key = s.settings.imageApi.key || "";
            ai.image.model = s.settings.imageApi.model || "gpt-image-1";
            ai.image.size = s.settings.imageApi.size || "1024x1024";
          }
          if (typeof s.settings.updateUrl !== "string") s.settings.updateUrl = "";
          if (!s.settings.cloud || typeof s.settings.cloud !== "object") {
            s.settings.cloud = { url: "", key: "", account: "", auto: true };
          }
          // 老用户升级：自动补上内置云端地址与 key（用户自己填过的不覆盖）
          const seedCloud = (window.SEED && SEED.settings && SEED.settings.cloud) || {};
          if (!s.settings.cloud.url && seedCloud.url) s.settings.cloud.url = seedCloud.url;
          if (!s.settings.cloud.key && seedCloud.key) s.settings.cloud.key = seedCloud.key;
          if (typeof s.settings.cloud.auto !== "boolean") s.settings.cloud.auto = true;
          if (s.materials) {
            // 清理旧版失效图片：接口已下线，预览必然失败
            s.materials.images = (s.materials.images || []).filter((img) => !/tool_text_to_image/.test(img.src || ""));
            s.materials.images.forEach((img) => { if (!img.kind) img.kind = "image"; });
            s.materials.videos.forEach((v) => { if (!v.kind) v.kind = "video"; });
          }
          // 历史 / 拦截记录区分文案、图片、视频
          (s.history || []).forEach((h) => { if (!h.kind) h.kind = "text"; });
          (s.blocks || []).forEach((b) => { if (!b.kind) b.kind = "text"; });
          // 排期条目补 topicId：区分「选题排期」与「文案加入排期」
          (s.schedule || []).forEach((x) => { if (typeof x.topicId !== "string") x.topicId = ""; });
          // 审计日志：选题 / 时段 / 素材 / 创作 / 排期 / 资料 / 账号 / 会员 / 同步 / 归档 的增删改记录
          if (!Array.isArray(s.auditLog)) s.auditLog = [];
          // 选题补 createdAt / custom 标记
          (s.topics || []).forEach((t) => { if (!t.createdAt) t.createdAt = nowISO(); if (t.custom === undefined) t.custom = false; });
          // 时段补 custom 标记
          (s.slots || []).forEach((sl) => { if (sl.custom === undefined) sl.custom = false; });
          return s;
        }
      }
    } catch (e) {}
    const seed = clone(window.SEED);
    seed.profiles = {};
    seed.profileVersion = PROFILE_VERSION;
    seed.currentPhone = "";
    return seed;
  }

  const store = loadStore();
  const ui = {
    page: "home",
    params: {},
    compose: null,
    materialsTab: "copy",
    historyTab: "gen",
    topicFilter: "全部",
    checkInput: "",
    checkResult: null,
    rules: null,
    rulesLoading: false,
    rulesError: "",
    sync: { state: "idle", last: "", pending: [], auto: true },
    generating: false
  };

  /* ---------- 合规检测 ---------- */
  function checkText(text) {
    const src = String(text || "");
    const lower = src.toLowerCase();
    const hits = [];

    store.words.forEach((item) => {
      const w = item.w;
      const needle = w.toLowerCase();
      if (!needle) return;
      let from = 0;
      while (from <= lower.length) {
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        hits.push({
          word: w,
          suggestion: item.s,
          category: item.c,
          index: idx,
          len: w.length,
          reason: CATEGORY_REASON[item.c] || "命中平台风险词"
        });
        from = idx + needle.length;
      }
    });

    const phone = /1[3-9]\d{9}/g;
    let m;
    while ((m = phone.exec(src))) {
      hits.push({
        word: m[0],
        suggestion: "（联系方式略）",
        category: "联系方式",
        index: m.index,
        len: m[0].length,
        reason: CATEGORY_REASON.联系方式
      });
    }

    // 站外链接：外链规范 2.9 过度营销 / 导流
    const url = /(?:https?:\/\/|www\.)[^\s，。；、）)】]+/gi;
    while ((m = url.exec(src))) {
      hits.push({
        word: m[0],
        suggestion: "（站外链接已移除）",
        category: "导流信息",
        index: m.index,
        len: m[0].length,
        reason: CATEGORY_REASON.导流信息
      });
    }

    hits.sort((a, b) => a.index - b.index || b.len - a.len);
    const kept = [];
    let lastEnd = -1;
    hits.forEach((h) => {
      if (h.index >= lastEnd) {
        kept.push(h);
        lastEnd = h.index + h.len;
      }
    });

    return { passed: kept.length === 0, violations: kept, count: kept.length };
  }

  function replaceText(text, violations) {
    const src = String(text || "");
    let out = "";
    let cursor = 0;
    violations
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((v) => {
        if (v.index < cursor) return;
        out += src.slice(cursor, v.index) + v.suggestion;
        cursor = v.index + v.len;
      });
    return out + src.slice(cursor);
  }

  function highlight(text, violations) {
    const src = escapeHtml(String(text || ""));
    if (!violations || !violations.length) return src;
    let out = "";
    let cursor = 0;
    // 原文已转义，位置基于原文，需按原字符串切片后再转义
    const raw = String(text || "");
    violations
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((v) => {
        if (v.index < cursor) return;
        out += escapeHtml(raw.slice(cursor, v.index));
        out += "<mark>" + escapeHtml(raw.slice(v.index, v.index + v.len)) + "</mark>";
        cursor = v.index + v.len;
      });
    out += escapeHtml(raw.slice(cursor));
    return out || src;
  }

  /* ---------- 媒体合规浅检测 ----------
   * 前端能做的：文件名/路径违禁词、尺寸、格式、文件大小、视频时长、
   * 图片 EXIF 作者/GPS 字段扫描、画布像素二维码识别（有限）。
   * 画面内容（违禁画面、人脸、未成年人、色情暴力、水印、二维码）
   * 必须依赖云端 AI 审核（腾讯云内容安全 / 阿里云绿网 / 智谱等），
   * 前端浏览器无法独立跑视觉大模型。用户可在「AI 模型接入」页配置
   * 云端审核接口（预留，后续接腾讯云/阿里云免费额度）。
   */

  // 图片合规浅检测（文件 File 或 {name, type, size, width, height, exif}）
  async function checkImage(file, desc) {
    const v = [];
    const name = file && file.name ? file.name : "";
    const size = file && typeof file.size === "number" ? file.size : 0;
    const type = file && file.type ? file.type.toLowerCase() : "";
    const words = [name, desc || ""].filter(Boolean).join(" ");

    // 1. 文件名 / 描述 违禁词
    const t0 = checkText(words);
    if (t0.violations && t0.violations.length) {
      t0.violations.forEach((vi) =>
        v.push({ word: vi.word, category: vi.category, reason: "文件名/描述命中：" + vi.reason, suggestion: vi.suggestion }));
    }

    // 2. 格式
    if (type && !/image\/(jpe?g|png|gif|webp)/i.test(type)) {
      v.push({ word: type, category: "格式风险", reason: "微信朋友圈仅支持 JPG / PNG / GIF / WebP，" + type.replace("image/","").toUpperCase() + " 会被拒绝或显示异常", suggestion: "转为 JPG 或 PNG" });
    }
    // 3. 文件大小（朋友圈单图上限约 10MB，超过会被服务器强压缩糊掉）
    const MB = 1024 * 1024;
    if (size && size > 10 * MB) {
      v.push({ word: (size / MB).toFixed(1) + "MB", category: "文件过大", reason: "朋友圈图片超过 10MB 会被强制压缩，发布后会糊", suggestion: "压缩到 5MB 内" });
    }
    if (size && size > 2 * MB && size <= 10 * MB) {
      v.push({ word: (size / MB).toFixed(1) + "MB", category: "文件较大", reason: "图片超过 2MB 仍会被压缩，建议 2MB 内更清晰", suggestion: "压缩到 2MB 内" });
    }

    // 4. 尺寸：最长边 ≤1600px 朋友圈展示最清晰（否则会被缩）
    // 如果传的是 File 浏览器版，可用 canvas 读出真实宽高
    let width = file && file.width ? file.width : 0;
    let height = file && file.height ? file.height : 0;
    if (file && file instanceof File && file.type && file.type.startsWith("image/")) {
      try {
        const url = URL.createObjectURL(file);
        const im = await new Promise((res, rej) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
        });
        width = im.naturalWidth; height = im.naturalHeight;
        URL.revokeObjectURL(url);
      } catch (e) { /* 跨域或解码失败，跳过 */ }
    }
    if (width && height) {
      const max = Math.max(width, height);
      if (max > 3000) {
        v.push({ word: width + "x" + height, category: "分辨率过高", reason: "分辨率超过 3000px，朋友圈会强压缩且可能被平台判作引流图", suggestion: "最长边缩到 1600px 内" });
      } else if (max > 1600) {
        v.push({ word: width + "x" + height, category: "分辨率较大", reason: "建议最长边 ≤1600px，朋友圈展示更清晰", suggestion: "最长边缩到 1600px 内" });
      }
    }

    // 5. 文件名可疑：带 .exe / .bat / 双后缀（xxx.jpg.exe）
    if (/\.(exe|bat|cmd|vbs|scr|com)\b/i.test(name)) {
      v.push({ word: name, category: "可执行文件", reason: "文件名带可执行后缀，朋友圈禁止传播", suggestion: "只允许图片后缀" });
    }
    if (/\.([a-z0-9]+)\.jpg$/i.test(name) || /\.([a-z0-9]+)\.png$/i.test(name)) {
      v.push({ word: name, category: "双后缀", reason: "文件名带双后缀（如 xxx.jpg.xxx），可疑文件", suggestion: "只保留真实后缀" });
    }

    // 6. EXIF 作者/软件/相机型号 / GPS（仅浏览器 File 版，Android 原生不支持 EXIF 解析）
    if (file && file instanceof File && file.type && file.type.startsWith("image/")) {
      try {
        const arrBuf = await file.slice(0, 65536).arrayBuffer();
        const exif = parseExifPreview(new Uint8Array(arrBuf));
        if (exif && exif.Software && /(微信|QQ|抖音|快手|微博|小红书|淘宝|拼多多)/i.test(exif.Software)) {
          v.push({ word: exif.Software, category: "多平台来源", reason: "EXIF 显示图片来自" + exif.Software + "，直接转发可能被朋友圈降权", suggestion: "导出重压缩后再发，或确认自己有使用权限" });
        }
        if (exif && exif.Artist && checkText(exif.Artist).violations.length) {
          v.push({ word: exif.Artist, category: "EXIF 作者违规", reason: "图片内置的作者字段含违规词", suggestion: "清除 EXIF 后再发" });
        }
      } catch (e) { /* 非 JPEG 没 EXIF，跳过 */ }
    }

    const pass = !v.some((x) => x.category === "可执行文件" || x.category === "双后缀");
    return { passed: pass, count: v.length, violations: v, media: { kind: "image", file: name, type, size, width, height } };
  }

  // 视频合规浅检测
  async function checkVideo(file, desc) {
    const v = [];
    const name = file && file.name ? file.name : "";
    const size = file && typeof file.size === "number" ? file.size : 0;
    const type = file && file.type ? file.type.toLowerCase() : "";
    const words = [name, desc || ""].filter(Boolean).join(" ");

    const t0 = checkText(words);
    if (t0.violations && t0.violations.length) {
      t0.violations.forEach((vi) =>
        v.push({ word: vi.word, category: vi.category, reason: "文件名/描述命中：" + vi.reason, suggestion: vi.suggestion }));
    }

    if (type && !/video\/(mp4|quicktime|webm|x-m4v)/i.test(type)) {
      v.push({ word: type, category: "格式风险", reason: "朋友圈仅支持 MP4，" + type.replace("video/","").toUpperCase() + " 不会被识别", suggestion: "转为 H.264 MP4" });
    }

    const MB = 1024 * 1024;
    if (size && size > 50 * MB) {
      v.push({ word: (size / MB).toFixed(1) + "MB", category: "文件过大", reason: "朋友圈视频上限约 50MB，超过会上传失败", suggestion: "压缩到 50MB 内" });
    }

    let duration = 0;
    if (file && file instanceof File && file.type && file.type.startsWith("video/")) {
      try {
        const url = URL.createObjectURL(file);
        const el = document.createElement("video");
        el.preload = "metadata";
        await new Promise((res, rej) => {
          el.onloadedmetadata = () => res();
          el.onerror = rej;
          el.src = url;
        });
        duration = isFinite(el.duration) ? el.duration : 0;
        URL.revokeObjectURL(url);
      } catch (e) { /* 跳过 */ }
    }
    if (duration > 30) {
      v.push({ word: Math.round(duration) + "s", category: "超时", reason: "朋友圈视频建议 ≤30 秒，超过会被平台降权甚至不推荐", suggestion: "剪到 30 秒内" });
    }
    if (duration > 60) {
      v.push({ word: Math.round(duration) + "s", category: "严重超时", reason: "视频超过 60 秒很可能上传失败或被折叠成链接", suggestion: "剪到 30 秒内" });
    }

    if (/\.(exe|bat|cmd|vbs|scr|com)\b/i.test(name)) {
      v.push({ word: name, category: "可执行文件", reason: "文件名带可执行后缀，朋友圈禁止传播", suggestion: "只允许视频后缀" });
    }

    const pass = !v.some((x) => /^严重超|可执行文件/i.test(x.category));
    return { passed: pass, count: v.length, violations: v, media: { kind: "video", file: name, type, size, duration } };
  }

  // 极简 EXIF 预览：只解析 JPEG SOI + APP1 里的 TIFF IFD 前几个常用字段
  function parseExifPreview(bytes) {
    try {
      if (bytes.length < 2) return null;
      // JPEG SOI marker
      if (!(bytes[0] === 0xFF && bytes[1] === 0xD8)) return null;
      // 找 APP1 marker (0xFFE1)
      let i = 2;
      while (i < bytes.length - 3) {
        if (bytes[i] === 0xFF && bytes[i + 1] === 0xE1) break;
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
      if (i >= bytes.length - 4) return null;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      const tiffStart = i + 8;
      if (bytes[tiffStart] !== 0x49 || bytes[tiffStart + 1] !== 0x49) return null; // 非 II little-endian
      const little = bytes[tiffStart] === 0x49;
      const u16 = (o) => little ? (bytes[o + 1] << 8 | bytes[o]) : (bytes[o] << 8 | bytes[o + 1]);
      const u32 = (o) => little ? (bytes[o + 3] << 24 | bytes[o + 2] << 16 | bytes[o + 1] << 8 | bytes[o])
                                : (bytes[o] << 24 | bytes[o + 1] << 16 | bytes[o + 2] << 8 | bytes[o + 3]);
      const firstIFD = u32(tiffStart + 4) + tiffStart;
      const count = u16(firstIFD);
      const out = {};
      for (let j = 0; j < count; j++) {
        const e = firstIFD + 2 + j * 12;
        const tag = u16(e);
        const type = u16(e + 2);
        if (type !== 2) continue; // 只处理 ASCII
        const num = u32(e + 4);
        const valOff = u32(e + 8);
        const strStart = num <= 4 ? e + 8 : (tiffStart + valOff);
        let s = "";
        for (let k = 0; k < num - 1 && (strStart + k) < bytes.length; k++) {
          const b = bytes[strStart + k];
          if (b === 0) break;
          s += String.fromCharCode(b);
        }
        if (tag === 0x010F) out.Make = s;
        else if (tag === 0x0110) out.Model = s;
        else if (tag === 0x0131) out.Software = s;
        else if (tag === 0x013B) out.Artist = s;
        else if (tag === 0x010E) out.ImageDescription = s;
      }
      return out;
    } catch (e) { return null; }
  }

  /* ---------- 防折叠 ---------- */
  function foldInfo(text) {
    const raw = String(text || "");
    const chars = [...raw.replace(/\s/g, "")].length;
    let lines = 0;
    raw.split("\n").forEach((p) => {
      lines += p.trim() ? Math.ceil([...p].length / 19) : 1;
    });
    const folded = lines > 6;
    return {
      chars,
      lines,
      folded,
      risk: lines > 8 ? "高" : folded ? "中" : "低",
      advice: folded
        ? "超过 6 行会被折叠，建议缩短到 6 行内，或把钩子放在前两行"
        : "预计完整展示，无需折叠处理"
    };
  }

  /* ---------- 文案生成 ---------- */
  const pick = (arr, v) => arr[Math.abs(v) % arr.length];

  const POOLS = {
    life: {
      detail: [
        "下楼买菜，摊主顺手多塞了一把小葱，说今天的特别嫩。",
        "早上六点自然醒，泡了杯咖啡，坐在窗边看天一点点亮起来。",
        "办完事顺路买了两根油条，边走边吃，像回到了小时候。"
      ],
      feel: [
        "那一刻突然觉得，所谓的好日子，不是什么大场面，就是这些乱七八糟又热气腾腾的瞬间。",
        "累是真累，但心里是踏实的。",
        "以前总想着等有空了再好好生活，现在才明白，生活就是被这些小事填满的。"
      ],
      close: ["你们今天，有什么值得记一笔的小事？", "记录一下，怕以后忘了。", "日子普通，但也挺好。"]
    },
    view: {
      trigger: [
        "这话我以前也信，直到自己用 AI 把一天的活压缩到两小时。",
        "上周有个学员问我，现在学 AI 是不是晚了，我愣了几秒。",
        "昨天翻自己一年前的朋友圈，发现当时笃定的很多事，现在都变了。"
      ],
      judge: [
        "我的判断是：机会不在工具本身，而在你愿不愿意把工具用进自己的活儿里。",
        "真正拉开差距的，从来不是谁会几个提示词，而是谁先把流程跑通。",
        "普通人最大的机会，是把自己那点具体的经验，用 AI 放大十倍。"
      ],
      reason: [
        "因为工具会越来越便宜，但你对一个行业的理解，别人抄不走。",
        "AI 能替你写，但替不了你判断什么值得写。",
        "我见过太多人卡在收藏教程，却从来没完整做过一个项目。"
      ],
      close: ["你最近用 AI，解决了哪件具体的小事？", "说说你的看法，我也想听听。", "共勉。"]
    },
    howto: {
      method: [
        "第一步，先把每天最重复的一件事写下来，别贪多。\n第二步，让 AI 出 3 个版本，你只负责挑和改。\n第三步，把跑通的流程存成模板，下次直接用。",
        "先明确你要解决的那一个小问题，再去找工具。\n然后把提示词写成固定格式：身份、目标、限制、输出样子。\n最后跑三遍，把稳定的那一版留下来。",
        "别急着学新工具，先把手头这件事拆成最小动作。\n能交给 AI 的交给 AI，需要判断的留给自己。\n每天只优化一个环节，一周就能看出差别。"
      ],
      case: [
        "我自己的朋友圈文案，以前一条憋一小时，现在十分钟能出三版。",
        "上周帮一个做读书社群的学员改流程，他从每天忙到凌晨，变成下午就能收工。",
        "我拿它整理过一整年的读书笔记，原来要两天，现在一个下午。"
      ],
      remind: ["提醒一句：工具只是放大器，前提是你得有东西可放大。", "别收藏一堆教程，先跑通一次完整的。", "如果只记一句话：先做完，再做漂亮。"]
    },
    review: {
      result: [
        "结果不算亮眼，但比上个月稳定：内容没断更，新增了几个主动来聊的朋友。",
        "没赚到什么大钱，最大的收获是把节奏找回来了，不再靠情绪更新。",
        "数据一般，但有两三条被老客户转发，这比点赞让我踏实。"
      ],
      problem: [
        "问题也很明显：写得太急，很多内容自己都不想看第二遍。",
        "卡点在于互动少，我一直在自说自话。",
        "最大的问题是贪多，想写的方向太多，结果每个都浅。"
      ],
      next: [
        "接下来的调整：每天只写一个点，写完放半小时再改一遍。",
        "下个月想把评论区聊起来，每条认真回三个人。",
        "先把内容比例调回 4:3:2:1，少一点硬输出，多一点真实生活。"
      ]
    },
    case: {
      before: [
        "上个月有个学员找我，朋友圈一天三条，全是产品，结果被好几个朋友屏蔽了。",
        "有个做读书社群的姐妹，文案写得很认真，但发出去基本没人回应。",
        "刚开始做自媒体那会儿，我也以为多发就有人看，结果越发越安静。"
      ],
      after: [
        "我们只改了一件事：把产品往后放，先写自己的真实进展。两周后，有人主动来问她在做什么。",
        "后来她把「今天读了什么」换成「这本书哪句话让我改了做法」，评论慢慢多了。",
        "我把日更改成一周三条，认真写过程和踩坑，反而开始有人找我聊合作。"
      ],
      why: [
        "变化不是因为写得更花哨，而是终于像个真人在说话。",
        "大家不是反感你分享，是反感你只分享结果。",
        "朋友圈不是货架，是先让人认识你，再让人相信你。"
      ],
      close: ["如果你也在纠结发什么，可以先从最近一次真实的改变写起。", "小变化，比大口号有用。", "慢慢来，别急。"]
    },
    product: {
      problem: [
        "很多人不是不会写，是每天打开输入框就卡住，最后干脆不发。",
        "朋友圈想坚持，但一想到要写文案就拖延，越拖越不想发。",
        "内容发了不少，却总是没人互动，也不知道问题出在哪。"
      ],
      value: [
        "我做的是一个轻量的陪跑：帮你定人设、搭选题、改文案，每条发之前过一遍合规。",
        "我会陪你把朋友圈从「想发什么」到「怎么发」跑一遍，包括选题、结构和复盘。",
        "不是给你一堆模板，而是按你的经历，把内容方向和个人表达一起理清楚。"
      ],
      who: [
        "适合刚开始做个人 IP、又不想发硬广的朋友。",
        "适合有产品但不知道怎么自然分享的人。",
        "适合想长期写，但一直断更、需要有人推一把的人。"
      ],
      join: [
        "如果你正在做这件事，可以在评论区说说你的情况，我看到会回。",
        "想了解具体怎么做的，评论区留一句「朋友圈」，我整理好发你。",
        "不着急报，先聊聊你现在卡在哪，合适再说。"
      ]
    },
    book: {
      insight: [
        "书里有一句话戳到我：真正的成长，不是知道更多，而是做到一件以前做不到的事。",
        "最打动我的不是方法论，而是那句「焦虑的本质，是想同时做很多事」。",
        "读到中间我突然明白，自己以前不是不努力，是努力得太散。"
      ],
      impact: [
        "对照自己，我就是那种收藏一堆课，却很少完整跑完的人。",
        "这两年做内容也是，方向换了好几个，根子上是没耐心。",
        "我一直以为自己缺方法，其实缺的是把一件事做透的决心。"
      ],
      action: [
        "所以这个月只做一件事：每天写 300 字，不发也算完成。\n先做满 30 天，再谈效果。",
        "从今天起，每天只留一个最重要的任务，做完再碰别的。\n先试一周，看看会不会轻松一点。",
        "我把手机里的学习群退了一半，只留一个在跟的。\n少一点输入，多一点消化。"
      ]
    },
    exp: {
      bg: [
        "做自媒体这一年，说不上成功，但坑是真踩了不少。",
        "一人公司跑了半年，最难的不是没客户，是什么都得自己扛。",
        "从打工到自己做，最大的变化不是自由，是没人给你兜底。"
      ],
      pit: [
        "第一个坑：什么都想做，结果什么都没做深。\n第二个坑：只顾输出，不记录数据。\n第三个坑：不好意思谈钱，白白耗掉很多时间。",
        "最先踩的坑是定价。\n总觉得自己不够专业，价格一压再压，最后累得不想做。\n后来才明白，低价吸引来的往往是最难服务的人。",
        "我最大的坑是闭门造车。\n闷头写了三个月，才想起来去看别人怎么做的。\n其实很多问题，早就有人踩过了。"
      ],
      summary: [
        "后来我给自己定了三条：一次只做一个项目；每周复盘一次数据；该收的钱大大方方收。",
        "现在的做法是：先定交付边界，再谈价格；做不了的直接说不。",
        "经验就一句：先活下来，再谈做大。别用战术上的勤奋，掩盖方向上的懒。"
      ],
      advice: [
        "如果你也刚起步，先别急着铺摊子，把一个小闭环跑通。",
        "给你的建议：先卖一次，再优化。市场比你更知道你要改什么。",
        "别等准备好了再开始，很多能力是做着做着长出来的。"
      ]
    }
  };

  const DEFAULTS = {
    life: "我普通的一天",
    view: "AI 时代，普通人还有机会吗",
    howto: "用 AI 10 分钟写完一条朋友圈",
    review: "这个月的一点小复盘",
    case: "一个小改变带来的真实反馈",
    product: "我为什么开始做现在这件事",
    book: "读完一本书的一点触动",
    exp: "这一年，我踩过的坑"
  };

  /* ---------- 篇幅：短文 / 长文 ---------- */
  const SIZE_LABEL = { short: "短文", long: "长文" };
  const SHORT_MAX = 118;   // 短文目标字数（朋友圈两行内不折叠）

  // 长文在每个类型的正文中插入一段补充细节，保证内容不是靠重复凑长
  const LONG_EXTRA = {
    life: [
      "中午在地垫上搭了会儿积木，最后一块留在桌上，像是给谁留的位置。",
      "晚上收拾完屋子，顺手把明天的待办写在便签上，心里踏实了不少。"
    ],
    view: [
      "这两年我把这套判断用在选项目上也一样：先问自己有没有别人抄不走的东西，再谈方法。",
      "换句话说，工具解决的是效率，判断解决的是方向，方向错了效率越高越远。"
    ],
    howto: [
      "这里有个容易被忽略的细节：每次跑完把提示词和结果存一份，一周后你能看出自己的判断在往哪走。",
      "另外别一次上三个新工具，先把一个用到顺手，再加第二个，不然流程永远跑不通。"
    ],
    review: [
      "复盘时我顺手翻了下后台，发现被收藏最多的一条，恰好是我写得最没把握的那条。",
      "这件事提醒我：我对自己内容的判断，和读者的判断经常不一样，所以数据要留痕。"
    ],
    case: [
      "中间她也有过反复，第三周连着发了两条硬广，互动立刻掉下去，我们又把比例调回来。",
      "这个过程没有捷径，靠的是一条条改，然后等反馈，慢但稳。"
    ],
    product: [
      "具体形式是每周一次线上聊，其余时间在群里改文案，遇到不确定的我就直接标出来。",
      "我不承诺爆款，也不做代写，我做的事情是让你自己能持续写下去。"
    ],
    book: [
      "书里还提到一个概念叫「舒适区边缘」，就是那个稍微费点劲、但还够得着的位置。",
      "我把这句话抄在便签上，贴在电脑边，每次想偷懒的时候看一眼。"
    ],
    exp: [
      "还有一件事我到现在才想明白：客户不是被说服的，是他自己刚好需要，我只是出现得及时。",
      "所以现在我不再追着成交跑，把交付做好，转介绍反而更稳定。"
    ]
  };

  function baseGenerate(typeId, topic, v) {
    const t = (topic || DEFAULTS[typeId] || "").replace(/[。！？]$/, "");
    const p = POOLS[typeId];
    if (typeId === "life") {
      return "关于「" + t + "」，记录一下。\n\n" + pick(p.detail, v) + "\n\n" + pick(p.feel, v) + "\n\n" + pick(p.close, v);
    }
    if (typeId === "view") {
      return t + "。\n\n" + pick(p.trigger, v) + "\n\n" + pick(p.judge, v) + "\n\n" + pick(p.reason, v) + "\n\n" + pick(p.close, v);
    }
    if (typeId === "howto") {
      const problem = pick([
        "很多人问我，「" + t + "」，到底该从哪下手。",
        "先说结论：「" + t + "」，关键不在多，而在顺序。",
        "如果你也在纠结「" + t + "」，我把自己的做法拆成 3 步。"
      ], v);
      return problem + "\n\n" + pick(p.method, v) + "\n\n" + pick(p.case, v) + "\n\n" + pick(p.remind, v);
    }
    if (typeId === "review") {
      return "这个月主要在忙「" + t + "」，到今天算是告一段落。\n\n" + pick(p.result, v) + "\n\n" + pick(p.problem, v) + "\n\n" + pick(p.next, v);
    }
    if (typeId === "case") {
      return "说个「" + t + "」的真实过程。\n\n" + pick(p.before, v) + "\n\n" + pick(p.after, v) + "\n\n" + pick(p.why, v) + "\n\n" + pick(p.close, v);
    }
    if (typeId === "product") {
      return t + "？先说清楚我为什么做这件事。\n\n" + pick(p.problem, v) + "\n\n" + pick(p.value, v) + "\n\n" + pick(p.who, v) + "\n\n" + pick(p.join, v);
    }
    if (typeId === "book") {
      return "关于「" + t + "」，想聊几句。\n\n" + pick(p.insight, v) + "\n\n" + pick(p.impact, v) + "\n\n" + pick(p.action, v);
    }
    if (typeId === "exp") {
      return "聊聊「" + t + "」。\n\n" + pick(p.bg, v) + "\n\n" + pick(p.pit, v) + "\n\n" + pick(p.summary, v) + "\n\n" + pick(p.advice, v);
    }
    return "聊聊「" + t + "」。\n\n" + pick(p.bg, v);
  }

  const CASUAL = {
    因此: "所以", 并且: "而且", 此外: "还有", 进行: "做", 已经: "都",
    非常: "特别", 然而: "不过", 例如: "比如", 如果: "要是", 是否: "是不是",
    应当: "该", 具备: "有", 从而: "这样", 基于: "按"
  };
  const DEAI = [
    ["不得不说，", ""], ["值得一提的是，", ""], ["综上所述，", ""],
    ["在这个快速发展的时代，", ""], ["让我们一起", "一起"], ["赋能", "帮上忙"],
    ["闭环", "跑通"], ["抓手", "办法"], ["底层逻辑", "根本原因"], ["首先，", ""],
    ["其次，", ""], ["最后，", ""], ["其实，", ""]
  ];
  const SOFT = [
    ["私信我", "评论区聊聊"], ["私聊我", "评论区留言"], ["加微信", "评论区聊"],
    ["下单", "了解"], ["报名", "了解"], ["购买", "看看"], ["限时抢购", "近期"],
    ["秒杀", "限时"], ["免费领取", "可以分享"], ["微信号", "评论区"]
  ];

  function applyStyles(text, styles) {
    let t = text;
    const has = (s) => styles.indexOf(s) >= 0;

    if (has("deai") || has("casual")) {
      DEAI.forEach(([a, b]) => { t = t.split(a).join(b); });
    }
    if (has("casual")) {
      Object.keys(CASUAL).forEach((k) => { t = t.split(k).join(CASUAL[k]); });
    }
    if (has("softsell")) {
      SOFT.forEach(([a, b]) => { t = t.split(a).join(b); });
    }
    if (has("real")) {
      t = t.replace(/\n\n([^\n]+)$/, "\n\n$1");
      t = t.replace(/\n\n([^\n]+)$/, "\n\n写完这段，窗外已经安静下来，屋里只剩台灯亮着。\n\n$1");
    }
    if (has("emotion")) {
      t = t.replace(/\n\n([^\n]+)$/, "\n\n说这些不是矫情，是真的很珍惜现在的生活。\n\n$1");
    }
    if (has("like")) {
      t = t.replace(/\n\n([^\n]+)$/, "\n\n都是我自己踩过的路，不一定对，但真实。\n\n$1");
    }
    t = t.replace(/\n{3,}/g, "\n\n").trim();
    return t;
  }

  function polish(text, size) {
    let t = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
    DEAI.forEach(([a, b]) => { t = t.split(a).join(b); });
    Object.keys(CASUAL).forEach((k) => { t = t.split(k).join(CASUAL[k]); });
    if (size === "short") {
      // 短文：合并空行，压缩行数，降低折叠概率
      t = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).join("\n");
    } else if (size === "long") {
      // 长文：长句按句号断行，方便手机上阅读
      t = t.split("\n").map((line) => wrapLine(line, 52)).join("\n");
    }
    return t;
  }

  function wrapLine(line, max) {
    const chars = [...line];
    if (chars.length <= max) return line;
    let out = "";
    let buf = "";
    chars.forEach((ch) => {
      buf += ch;
      if ([...buf].length >= max && /[。！？；]/.test(ch)) {
        out += buf + "\n";
        buf = "";
      }
    });
    return (out + buf).trim();
  }

  function shorten(text) {
    const paras = String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) return "";
    let out = paras.slice(0, 2).join("\n\n");
    if ([...out.replace(/\s/g, "")].length <= SHORT_MAX) return out;
    // 超长时按句号截断，保证语义完整
    const sentences = out.match(/[^。！？]*[。！？]/g) || [out];
    let acc = "";
    for (let i = 0; i < sentences.length; i++) {
      if ([...acc.concat(sentences[i]).replace(/\s/g, "")].length > SHORT_MAX) break;
      acc += sentences[i];
    }
    return (acc.trim() || sentences[0].trim());
  }

  function longify(typeId, text, v) {
    const extra = pick(LONG_EXTRA[typeId] || LONG_EXTRA.life, v);
    const paras = String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    paras.splice(Math.min(2, paras.length), 0, extra);
    return paras.join("\n\n");
  }

  function generate(typeId, topic, variant, styles, materialIds, size) {
    const p = persona();
    const st = (styles || []).slice();
    applyPersonaStyles(st, p);
    let text = baseGenerate(typeId, topic, variant);
    text = personalize(text, typeId, p);
    text = applyStyles(text, st);
    if (size === "long") text = longify(typeId, text, variant);
    if (size === "short") text = shorten(text);
    if (materialIds && materialIds.length) {
      materialIds.slice(0, 2).forEach((id) => {
        const m = store.materials.copy.find((x) => x.id === id);
        if (m) text += "\n\n「" + m.text + "」";
      });
    }
    return text;
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  const pad = (n) => (n < 10 ? "0" + n : "" + n);

  /* 联网校时：用服务端时间校准本地时间，避免手机时间不准导致日期/排期错乱 */
  let serverOffset = 0; // 服务端时间 - 本地时间（毫秒）
  function now() { return new Date(Date.now() + serverOffset); }
  function syncServerTime(dateHeader) {
    try {
      const t = Date.parse(dateHeader);
      if (!isNaN(t)) serverOffset = t - Date.now();
    } catch (e) {}
  }
  function nowISO() {
    const d = now();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function todayKey() { return nowISO().slice(0, 10); }

  /* ---------- 每日轮换：选题 / 排期（按手机本地日期，0 点自动刷新，跨天不重复） ---------- */
  function seededRand(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h += 0x6D2B79F5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 每天 0 点（或跨天首次打开）刷新：今日选题互不重复，且跨天尽量不复用近期用过的选题
  function ensureDaily() {
    const today = todayKey();
    if (store.dailyDate === today) return;
    const all = (store.topics || []).map((t) => t.id);
    if (!all.length) { store.dailyDate = today; return; }
    const recent = new Set(store.recentTopicIds || []);
    let fresh = all.filter((id) => !recent.has(id));
    const need = Math.min((store.slots || []).length, all.length);
    if (fresh.length < need) fresh = all.slice();

    const rnd = seededRand(today + "|" + (store.topicCycle || 0));
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
    }

    const todayIds = fresh.slice(0, need);
    store.todayTopics = todayIds;

    // 跨天去重：把今日选题计入近期使用；超过阈值才开始新一轮轮换
    store.recentTopicIds = (store.recentTopicIds || []).slice();
    todayIds.forEach((id) => {
      const idx = store.recentTopicIds.indexOf(id);
      if (idx >= 0) store.recentTopicIds.splice(idx, 1);
      store.recentTopicIds.push(id);
    });
    const cap = Math.max(all.length, Math.ceil(all.length * 0.7));
    if (store.recentTopicIds.length > cap) {
      store.recentTopicIds = store.recentTopicIds.slice(-cap);
      store.topicCycle = (store.topicCycle || 0) + 1;
    }

    // 今日排期：每个时段分配一条今日选题（当天内容互不重复），并生成可编辑的完整文案
    store.schedule = (store.slots || []).map((slot, i) => {
      const tid = todayIds[i % todayIds.length];
      const topic = store.topics.find((t) => t.id === tid);
      const typeName = (slot.types[0] || "").replace("（克制）", "");
      const type = store.types.find((x) => x.name === typeName) || store.types[0];
      const topicTitle = topic ? topic.title : type.defaultTopic;
      const typeId = topic ? topic.type : type.id;
      const text = generate(typeId, topicTitle, (i + 1) * 7 + todayIds.length, [], [], "short");
      return {
        slotId: slot.id,
        topicId: tid || "",
        status: "待发布",
        type: typeId,
        text: text.replace(/\n/g, " ").slice(0, 40),
        content: text,
        time: slot.time.split("-")[0]
      };
    });
    store.dailyDate = today;
    save();
  }

  function todayTopicList() {
    ensureDaily();
    const ids = store.todayTopics || [];
    return ids.map((id) => (store.topics || []).find((t) => t.id === id)).filter(Boolean);
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso.replace(/-/g, "/")).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 2) return "昨天 " + iso.slice(11, 16);
    return iso.slice(5, 10) + " " + iso.slice(11, 16);
  }
  function typeById(id) { return store.types.find((t) => t.id === id); }
  function topicById(id) { return (store.topics || []).find((t) => t.id === id); }
  function slotById(id) { return (store.slots || []).find((s) => s.id === id); }
  function uid(prefix) { return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5); }

  /* ---------- 审计日志：所有增删改留痕 ---------- */
  // type: topic/slot/material/compose/schedule/profile/account/member/sync/archive
  // action: create/edit/delete/copy/assign/clear/login/signup/renew/push/pull
  function logAudit(type, action, target, detail) {
    if (!Array.isArray(store.auditLog)) store.auditLog = [];
    const entry = {
      id: uid("a"),
      ts: nowISO(),
      type: type || "",
      action: action || "",
      target: target ? String(target).slice(0, 80) : "",
      detail: detail ? String(detail).slice(0, 200) : ""
    };
    store.auditLog.unshift(entry);
    // 只保留最近 500 条，避免无限增长
    if (store.auditLog.length > 500) store.auditLog = store.auditLog.slice(0, 500);
    return entry;
  }
  function auditList(filterType) {
    const list = Array.isArray(store.auditLog) ? store.auditLog : [];
    return filterType ? list.filter((x) => x.type === filterType) : list;
  }

  /* ---------- 选题 CRUD ---------- */
  function addTopic(direction, title, type) {
    const t = { id: uid("t"), direction: direction || "自定义", title: title, type: type || "life", createdAt: nowISO(), custom: true };
    (store.topics || (store.topics = [])).unshift(t);
    logAudit("topic", "create", title, "方向：" + t.direction);
    save();
    return t;
  }
  function updateTopic(id, patch) {
    const t = topicById(id);
    if (!t) return null;
    const before = t.title;
    Object.assign(t, patch || {});
    t.updatedAt = nowISO();
    logAudit("topic", "edit", t.title, before + " → " + t.title);
    save();
    return t;
  }
  function deleteTopic(id) {
    const t = topicById(id);
    if (!t) return false;
    (store.topics || []).splice((store.topics || []).indexOf(t), 1);
    // 从今日选题和排期中移除
    if (Array.isArray(store.todayTopics)) {
      store.todayTopics = store.todayTopics.filter((x) => x !== id);
    }
    (store.schedule || []).forEach((s) => { if (s.topicId === id) { s.topicId = ""; s.text = ""; s.type = ""; s.content = ""; s.status = "待排"; } });
    logAudit("topic", "delete", t.title, "方向：" + t.direction);
    save();
    return true;
  }
  function copyTopic(id) {
    const t = topicById(id);
    if (!t) return null;
    const nt = { id: uid("t"), direction: t.direction, title: t.title + "（副本）", type: t.type, createdAt: nowISO(), custom: true };
    (store.topics || (store.topics = [])).unshift(nt);
    logAudit("topic", "copy", nt.title, "复制自：" + t.title);
    save();
    return nt;
  }

  /* ---------- 时段 CRUD ---------- */
  function addSlot(time, level, title, scene, types) {
    const sl = {
      id: uid("s"),
      time: time || "00:00-01:00",
      level: level || "常规",
      title: title || "自定义时段",
      scene: scene || "",
      types: types || ["生活日常型"],
      custom: true,
      createdAt: nowISO()
    };
    (store.slots || (store.slots = [])).push(sl);
    logAudit("slot", "create", sl.time, sl.title);
    save();
    return sl;
  }
  function updateSlot(id, patch) {
    const sl = slotById(id);
    if (!sl) return null;
    const before = sl.time + " " + sl.title;
    Object.assign(sl, patch || {});
    logAudit("slot", "edit", sl.time, before + " → " + sl.time + " " + sl.title);
    save();
    return sl;
  }
  function deleteSlot(id) {
    const sl = slotById(id);
    if (!sl) return false;
    (store.slots || []).splice((store.slots || []).indexOf(sl), 1);
    (store.schedule || []).forEach((s) => { if (s.slotId === id) { s.topicId = ""; s.text = ""; s.type = ""; s.content = ""; s.status = "待排"; } });
    logAudit("slot", "delete", sl.time, sl.title);
    save();
    return true;
  }

  /* ---------- 排期内容生成：为时段生成可编辑的完整文案 ---------- */
  function generateScheduleContent(slotId) {
    const slot = slotById(slotId);
    if (!slot) return "";
    const item = (store.schedule || []).find((x) => x.slotId === slotId);
    if (!item) return "";
    const typeId = item.type || (slot.types[0] && store.types.find((t) => t.name === slot.types[0].replace("（克制）", "")) && store.types.find((t) => t.name === slot.types[0].replace("（克制）", "")).id) || "life";
    const topic = item.topicId ? (topicById(item.topicId) || {}).title : item.text || typeById(typeId).defaultTopic;
    const text = generate(typeId, topic, Date.now() % 997, [], [], "short");
    item.content = text;
    item.text = text.replace(/\n/g, " ").slice(0, 40);
    item.status = "待发布";
    logAudit("schedule", "generate", slot.time, topic);
    save();
    return text;
  }
  /* ---------- 个人资料（按账号隔离，注册后由用户填写） ---------- */
  function blankSections() {
    return clone(window.SEED.profileSections);
  }
  function summaryOf(content) {
    const t = String(content || "").replace(/\s+/g, " ").trim();
    if (!t) return "待填写";
    return t.length > 18 ? t.slice(0, 18) + "…" : t;
  }
  function syncSummaries() {
    (store.profileSections || []).forEach((s) => { s.summary = summaryOf(s.content); });
    if (!store.user) store.user = { name: "", avatar: "", tagline: "", perspectives: [] };
    if (!store.user.perspectives) store.user.perspectives = [];
  }

  function bindProfile(phone, nickname) {
    if (!phone) return;
    const p = (store.profiles && store.profiles[phone]) || null;
    if (p && p.sections) {
      const base = blankSections();
      store.profileSections = base.map((s) => {
        const old = (p.sections || []).find((x) => x.id === s.id) || {};
        return Object.assign({}, s, { content: String(old.content || "") });
      });
      store.user = Object.assign({ name: "", avatar: "", tagline: "", perspectives: [] }, p.user || {});
    } else {
      store.user = { name: nickname || "", avatar: "", tagline: "", perspectives: [] };
      store.profileSections = blankSections();
    }
    if (nickname) store.user.name = nickname;
    store.currentPhone = phone;
    syncSummaries();
    save();
  }

  function saveProfile() {
    syncSummaries();
    if (store.currentPhone) {
      if (!store.profiles) store.profiles = {};
      store.profiles[store.currentPhone] = {
        user: store.user,
        sections: store.profileSections.map((s) => ({ id: s.id, content: s.content }))
      };
    }
    save();
  }

  function hasProfile() {
    const u = store.user || {};
    return !!(u.name || u.tagline || (u.perspectives && u.perspectives.length) ||
      (store.profileSections || []).some((s) => s.content));
  }

  function persona() {
    const u = store.user || {};
    const map = {};
    (store.profileSections || []).forEach((s) => { map[s.id] = String(s.content || "").trim(); });
    const firstLine = (k) => (map[k] || "").split(/\n+/).map((x) => x.trim()).filter(Boolean)[0] || "";
    const persp = (u.perspectives || []).filter(Boolean);
    return {
      name: u.name || "",
      avatar: u.avatar || "",
      tagline: u.tagline || "",
      perspectives: persp,
      identity: persp[0] || firstLine("who") || u.tagline || "",
      who: map.who || "",
      client: firstLine("client"),
      product: firstLine("product"),
      style: map.style || "",
      avoid: map.avoid || "",
      samples: map.samples || "",
      manual: firstLine("manual"),
      sections: map
    };
  }

  /* 选题：有资料就用用户的身份/产品/客户生成，没有则回落到通用选题 */
  function topicFor(typeId) {
    const t = typeById(typeId) || { defaultTopic: "" };
    const p = persona();
    if (!hasProfile()) return t.defaultTopic;
    const tag = p.perspectives[0] || p.tagline || p.identity;
    const prod = String(p.product || "").replace(/^[·•\-–\d.、\s]+/, "").replace(/[（(].*?[)）]/g, "").trim();
    if (typeId === "life" && tag) return tag + "的普通一天";
    if (typeId === "view" && tag) return tag + "：我最近想明白的一件事";
    if (typeId === "howto" && tag) return "作为" + tag + "，我最常用的 3 个方法";
    if (typeId === "review" && tag) return tag + "这个月的复盘";
    if (typeId === "case" && prod) return "我用「" + prod.slice(0, 12) + "」的一个真实案例";
    if (typeId === "product" && prod) return "我的「" + prod.slice(0, 12) + "」到底适合谁";
    if (typeId === "exp" && tag) return tag + "踩过的 3 个坑";
    if (typeId === "book" && p.manual) return "从「" + p.manual.slice(0, 10) + "」说起";
    return t.defaultTopic;
  }

  const clampLine = (s, n) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  /* 把资料库内容注入文案：身份、产品、客户、标签 */
  function personalize(text, typeId, p) {
    const extra = [];
    const role = String(p.identity || "").replace(/^(我是一名|我是一个|我是|作为一名|作为一个|作为|一个)/, "").trim();
    if (typeId === "life" && role) {
      extra.push("作为一名" + clampLine(role, 22) + "，平时节奏不算慢，但这些小事是我给自己留的空白。");
    }
    if (typeId === "howto" && role) {
      extra.push("作为" + clampLine(role, 22) + "，这几条是我一直在用、也真的有效的办法。");
    }
    if (typeId === "review" && role) {
      extra.push("作为" + clampLine(role, 22) + "，这个月最大的变化不是数据，而是节奏。");
    }
    if (typeId === "book" && role) {
      extra.push("作为" + clampLine(role, 22) + "，这本书里有一句话，正好说中了我最近的状态。");
    }
    if ((typeId === "view" || typeId === "exp") && p.name && p.identity) {
      extra.push("我是" + p.name + "，" + clampLine(p.identity, 22) + "。");
    }
    if ((typeId === "product" || typeId === "case") && p.product) {
      extra.push("我在做的方向是：" + clampLine(p.product, 36) + "。");
    }
    if ((typeId === "product" || typeId === "case") && p.client) {
      extra.push("如果你也是" + clampLine(p.client, 26) + "，这条大概对你有用。");
    }
    if (!extra.length) return text;
    const parts = String(text || "").split(/\n{2,}/);
    const head = parts.shift() || "";
    return head + "\n\n" + extra.join("\n\n") + (parts.length ? "\n\n" + parts.join("\n\n") : "");
  }

  /* 表达风格 / 避坑偏好 → 自动调节文风 */
  function applyPersonaStyles(list, p) {
    const add = (s) => { if (list.indexOf(s) < 0) list.push(s); };
    const like = p.style || "";
    const avoid = p.avoid || "";
    if (/口语|接地气|通俗|直白/.test(like)) add("casual");
    if (/真实|情感|故事/.test(like)) add("real");
    if (/AI\s*味|AI味|机器味/.test(avoid)) add("deai");
    if (/硬广|广告|推销/.test(avoid)) add("softsell");
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) {
      return false;
    }
    // 本地保存成功后再通知云端做防抖推送（未配置/未登录时为空操作）
    try { if (window.Cloud && window.Cloud.markDirty) window.Cloud.markDirty(); } catch (e) {}
    return true;
  }

  /* ---------- 在线规则库（服务端每日 0 点抓取官方规则） ---------- */
  function applyLiveRules(live) {
    if (!live || !live.version) return false;
    if (live.version === store.rulesLiveVersion) return false;
    if (live.rules && live.rules.length) store.rules = live.rules;
    let added = 0;
    (live.newWords || []).forEach((nw) => {
      if (!nw || !nw.w) return;
      if (store.words.some((x) => x.w === nw.w)) return;
      store.words.push({ w: nw.w, c: nw.c || "虚假宣传", s: nw.s || "更稳妥的表述", auto: true });
      added++;
    });
    store.rulesLiveVersion = live.version;
    store.rulesCheckedAt = live.checkedAt || nowISO();
    store.rulesUpdatedAt = (live.sources || []).reduce((acc, s) => (s.updatedAt > acc ? s.updatedAt : acc), "");
    store.rulesAdded = (store.rulesAdded || 0) + added;
    save();
    return true;
  }

  window.Core = {
    store, ui, save, checkText, replaceText, highlight, foldInfo,
    checkImage, checkVideo,
    generate, polish, applyStyles, escapeHtml, nowISO, todayKey, now, syncServerTime,
    timeAgo, typeById, topicById, slotById, uid, DEFAULTS, SIZE_LABEL, SHORT_MAX, applyLiveRules,
    CATEGORY_REASON, LEGACY_COPY_TYPE,
    bindProfile, saveProfile, hasProfile, persona, topicFor, syncSummaries, blankSections,
    ensureDaily, todayTopicList,
    logAudit, auditList,
    addTopic, updateTopic, deleteTopic, copyTopic,
    addSlot, updateSlot, deleteSlot,
    generateScheduleContent
  };
})();
