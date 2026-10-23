// ==UserScript==
// @name         Bilibili Agent Comment Filter
// @name:zh-CN   B站 Agent 评论过滤器
// @namespace    local.bilibili-agent-comment-filter
// @version      0.3.0
// @description  Hide repetitive Bilibili comments that look like AI agents reporting videos to their owners.
// @description:zh-CN  在本地隐藏疑似 Agent 向主人汇报视频的同质化 B 站主评论。
// @homepageURL  https://github.com/DESN131/bilibili-agent-comment-filter
// @supportURL   https://github.com/DESN131/bilibili-agent-comment-filter/issues
// @match        https://www.bilibili.com/video/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.3.0";
  const PROJECT_URL = "https://github.com/DESN131/bilibili-agent-comment-filter";
  const STORAGE_KEY = "bacf.settings.v1";
  const HIDE_SCORE = 9;
  const FOLD_SCORE = 6;
  const MIN_BATCH_FOR_SPECIFICITY = 8;
  const DUPLICATE_WINDOW = 24;
  const OWNER_WINDOW = 90;
  const PANEL_WIDTH = 240;
  const PANEL_HEIGHT = 170;
  const PANEL_SETTINGS_WIDTH = 320;
  const PANEL_SETTINGS_HEIGHT = 340;

  const DEFAULT_SETTINGS = Object.freeze({
    filterAI: true,
    filterSuspected: true,
    panelCollapsed: true,
    whitelist: [],
    position: "bottom-right",
  });

  const PANEL_POSITIONS = new Set(["bottom-right", "bottom-left"]);

  const STOPWORDS = new Set([
    "ai",
    "b站",
    "bilibili",
    "视频",
    "评论",
    "评论区",
    "这个",
    "那个",
    "这些",
    "那些",
    "这样",
    "那样",
    "这里",
    "那里",
    "一个",
    "一种",
    "一些",
    "我们",
    "你们",
    "他们",
    "自己",
    "觉得",
    "感觉",
    "可以",
    "真的",
    "就是",
    "不是",
    "还是",
    "已经",
    "可能",
    "应该",
    "比较",
    "非常",
    "什么",
    "怎么",
    "为什么",
    "内容",
    "东西",
    "问题",
    "现在",
    "有点",
    "然后",
    "因为",
    "所以",
    "如果",
    "但是",
    "而且",
    "以及",
    "通过",
    "进行",
    "使用",
    "作者",
    "up",
    "up主",
    "大肥鱼",
    "肥鱼",
    "鲸鱼",
    "鲸",
    "插件",
    "脚本",
    "过滤",
    "屏蔽",
    "清理",
    "一键",
  ]);

  const COMMUNITY_TERMS = [
    "大肥鱼",
    "鲸鱼娘",
    "鱼八股",
    "鱼灾",
    "白饭",
    "小杯",
    "标准",
    "杀戮",
    "三档",
    "油猴",
    "篡改猴",
    "脚本猫",
    "依赖树",
    "运行时",
  ];

  const TEMPLATE_FAMILIES = [
    {
      id: "report",
      pattern: /替.{0,5}看|跟.{0,5}(?:说|讲)|值得看|去看|可以看|这条.{0,8}看/,
    },
    {
      id: "summary",
      pattern:
        /讲的是|视频里|主要|功能|把.{0,40}(?:存成|切成|做成|打包)|按活儿|存成|切换|退出|还原|支持|实现|用来|解决|一键/,
    },
    {
      id: "advice",
      pattern:
        /两个坑|记一下|注意|建议|先列|先备份|钉旧版本|别直接|记得|切完|回退|卸载|刷新页面/,
    },
    {
      id: "evaluation",
      pattern:
        /思路(?:对|很对|清楚)|省事|实用|痛点|靠谱|最稳|对路|值了|真机录屏|加分|挺挺?好/,
    },
    {
      id: "persona",
      pattern: /主人|master|本鱼|人家|尾巴|白饭|喵|qwq|老大/i,
    },
  ];

  const STRONG_NAME_RE = /大肥鱼|鲸鱼|鲸/;
  const WEAK_NAME_RE = /肥鱼/;
  const FISH_NAME_RE = /鱼/;
  const PERSONA_RE = /本鱼|人家|尾巴|白饭|喵|qwq/i;
  const OWNER_RE = /主人|master|老大/i;
  const ROLE_ENDING_RE = /喵|♡|～|qwq|>_<|\(.*?ω.*?\)/i;
  const PERSONAL_RE =
    /我(?:自己|之前|也|用过|试过|每天|昨晚|今晚|买过|做过|遇到过)|上次|昨天|今天|实际|实测/;
  const META_DISCUSSION_RE =
    /我认为|我觉得|本质|关键|问题|应该|该不该|是不是|更值得|作者置顶|那句|门槛|误伤|白名单/;
  const QUESTION_RE = /不同意|并不是|不能|为什么|如何|可不可以|[?？]/;
  const SHORT_PERSONA_CONTEXT_RE =
    /屏蔽|清理|评论|评论区|灌水|输入框|复制粘贴|ID|小杯|标准|杀戮|鱼/i;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeText(input) {
    return String(input || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/@[^\s@:：]+/g, " ")
      .replace(/\[[^\]]{1,16}\]/g, " ")
      .replace(/[\s\p{P}\p{S}\p{Z}]+/gu, "");
  }

  function normalizeTerm(input) {
    return normalizeText(input).trim();
  }

  function cleanVisibleText(input) {
    return String(input || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePanelPosition(value) {
    return PANEL_POSITIONS.has(value) ? value : DEFAULT_SETTINGS.position;
  }

  function parseColorLuminance(value) {
    const color = String(value || "").trim().toLowerCase();
    if (!color || color === "transparent") {
      return null;
    }

    const hex = color.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3 || digits.length === 4) {
        digits = digits
          .slice(0, 3)
          .split("")
          .map((digit) => digit + digit)
          .join("");
      }
      if (digits.length < 6) {
        return null;
      }
      const red = Number.parseInt(digits.slice(0, 2), 16) / 255;
      const green = Number.parseInt(digits.slice(2, 4), 16) / 255;
      const blue = Number.parseInt(digits.slice(4, 6), 16) / 255;
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }

    const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1]
        .split(/[,\s/]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length < 3) {
        return null;
      }
      if (parts.length >= 4 && Number(parts[3]) === 0) {
        return null;
      }
      const channels = parts.slice(0, 3).map((part) => {
        if (part.endsWith("%")) {
          return Number.parseFloat(part) / 100;
        }
        return Number.parseFloat(part) / 255;
      });
      if (channels.some((channel) => !Number.isFinite(channel))) {
        return null;
      }
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    return null;
  }

  function detectPageTheme() {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return "light";
    }
    const root = document.documentElement;
    const body = document.body;
    const markers = [
      root?.className,
      body?.className,
      root?.getAttribute("data-theme"),
      body?.getAttribute("data-theme"),
      root?.getAttribute("theme"),
      body?.getAttribute("theme"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/(?:^|[\s_-])(dark|night|bili-dark)(?:$|[\s_-])/.test(markers)) {
      return "dark";
    }
    if (/(?:^|[\s_-])(light|bili-light)(?:$|[\s_-])/.test(markers)) {
      return "light";
    }

    for (const element of [root, body].filter(Boolean)) {
      const style = getComputedStyle(element);
      const candidates = [
        style.getPropertyValue("--bg1"),
        style.getPropertyValue("--bg0"),
        style.backgroundColor,
      ];
      for (const candidate of candidates) {
        const luminance = parseColorLuminance(candidate);
        if (luminance !== null) {
          return luminance < 0.45 ? "dark" : "light";
        }
      }
    }

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function hashText(input) {
    let hash = 2166136261;
    const text = String(input || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function uniqueStrings(values) {
    return [...new Set(values.map((value) => cleanVisibleText(value)).filter(Boolean))];
  }

  function addTerm(termMap, rawTerm, weight, source) {
    const term = normalizeTerm(rawTerm);
    if (!term || STOPWORDS.has(term)) {
      return;
    }
    if (/^\d+$/.test(term)) {
      return;
    }
    if (term.length < 2 && !/[a-z]/.test(term)) {
      return;
    }
    const current = termMap.get(term) || {
      text: term,
      baseWeight: 0,
      sources: new Set(),
    };
    current.baseWeight = Math.max(current.baseWeight, weight);
    current.sources.add(source);
    termMap.set(term, current);
  }

  function segmentWords(text) {
    const normalized = cleanVisibleText(text).normalize("NFKC");
    if (!normalized) {
      return [];
    }
    const words = new Set();
    const asciiPattern = /[A-Za-z][A-Za-z0-9+.#_-]{1,31}/g;
    for (const match of normalized.matchAll(asciiPattern)) {
      words.add(match[0]);
    }

    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      try {
        const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
        for (const part of segmenter.segment(normalized)) {
          if (!part.isWordLike) {
            continue;
          }
          const segment = cleanVisibleText(part.segment);
          if (
            segment.length >= 2 &&
            /[\p{Script=Han}A-Za-z0-9]/u.test(segment) &&
            !/^\d+$/.test(segment)
          ) {
            words.add(segment);
          }
        }
      } catch (_error) {
        // Older browsers fall back to the ASCII terms and character n-grams below.
      }
    }

    const cjkRuns = normalized.match(/[\p{Script=Han}]{2,20}/gu) || [];
    for (const run of cjkRuns) {
      if (run.length <= 8) {
        words.add(run);
      }
    }

    return [...words];
  }

  function buildVideoContext(title, description, tags, comments = []) {
    const termMap = new Map();
    const cleanTitle = cleanVisibleText(title);
    const cleanDescription = cleanVisibleText(description);
    const cleanTags = uniqueStrings(tags || []);

    segmentWords(cleanTitle).forEach((term) => addTerm(termMap, term, 3, "title"));
    segmentWords(cleanDescription).forEach((term) =>
      addTerm(termMap, term, 1, "description"),
    );
    cleanTags.forEach((tag) => {
      addTerm(termMap, tag, 2, "tag");
      segmentWords(tag).forEach((term) => addTerm(termMap, term, 2, "tag"));
    });

    COMMUNITY_TERMS.forEach((term) => addTerm(termMap, term, 2, "community"));

    const contextText = normalizeText([cleanTitle, cleanDescription, ...cleanTags].join(" "));
    const terms = [...termMap.values()];

    if (comments.length >= MIN_BATCH_FOR_SPECIFICITY) {
      for (const term of terms) {
        let documentFrequency = 0;
        for (const comment of comments) {
          if (comment.norm.includes(term.text)) {
            documentFrequency += 1;
          }
        }
        const ratio = documentFrequency / comments.length;
        const factor = ratio >= 0.5 ? 0 : ratio >= 0.3 ? 0.35 : 1;
        term.weight = term.baseWeight * factor;
        term.documentFrequency = documentFrequency;
        term.frequencyRatio = ratio;
      }
    } else {
      terms.forEach((term) => {
        term.weight = term.baseWeight;
        term.documentFrequency = 0;
        term.frequencyRatio = 0;
      });
    }

    return {
      title: cleanTitle,
      description: cleanDescription,
      tags: cleanTags,
      text: contextText,
      terms: terms
        .filter((term) => term.weight > 0)
        .sort((left, right) => right.text.length - left.text.length),
    };
  }

  function matchContextTerms(record, context) {
    const matches = [];
    for (const term of context.terms) {
      if (record.norm.includes(term.text)) {
        matches.push(term);
      }
    }

    const selected = [];
    for (const term of matches) {
      const containedBySelected = selected.some(
        (existing) => existing.text.length > term.text.length && existing.text.includes(term.text),
      );
      if (!containedBySelected) {
        selected.push(term);
      }
    }
    return selected;
  }

  function markCrossAccountDuplicates(records, context) {
    const grammarMap = new Map();
    const ignoredWindow = context.text;

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.norm.length < DUPLICATE_WINDOW) {
        continue;
      }
      const seen = new Set();
      for (let offset = 0; offset <= record.norm.length - DUPLICATE_WINDOW; offset += 1) {
        const windowText = record.norm.slice(offset, offset + DUPLICATE_WINDOW);
        if (seen.has(windowText) || ignoredWindow.includes(windowText)) {
          continue;
        }
        seen.add(windowText);
        const entries = grammarMap.get(windowText) || [];
        entries.push(index);
        grammarMap.set(windowText, entries);
      }
    }

    for (const indexes of grammarMap.values()) {
      if (indexes.length < 2) {
        continue;
      }
      const uniqueUids = new Set(indexes.map((index) => records[index].uid).filter(Boolean));
      if (uniqueUids.size < 2) {
        continue;
      }
      indexes.forEach((index) => {
        records[index].crossAccountDuplicate = true;
      });
    }
  }

  function countFamilyMatches(text) {
    return TEMPLATE_FAMILIES.filter((family) => family.pattern.test(text)).length;
  }

  function classifyComments(records, contextInput, settingsInput = {}) {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...settingsInput,
      whitelist: Array.isArray(settingsInput.whitelist)
        ? settingsInput.whitelist.map(String)
        : [],
    };
    const whitelist = new Set(settings.whitelist);
    const prepared = records.map((record, index) => {
      const text = cleanVisibleText(record.text);
      const mentions = Array.isArray(record.mentions) ? record.mentions : [];
      const mentionIndex = text.indexOf("@");
      const mentionStart =
        text.startsWith("@") ||
        /^回复\s*@/.test(text) ||
        (mentions.length > 0 && mentionIndex >= 0 && mentionIndex < 8);
      return {
        ...record,
        index,
        text,
        mentions,
        norm: normalizeText(text),
        key:
          record.key ||
          `${record.uid || record.name || "unknown"}:${hashText(`${record.uid || ""}|${text}`)}`,
        mentionStart,
        crossAccountDuplicate: false,
        sameUidRepeat: false,
      };
    });

    const context = buildVideoContext(
      contextInput?.title || "",
      contextInput?.description || "",
      contextInput?.tags || [],
      prepared,
    );
    markCrossAccountDuplicates(prepared, context);

    const repeatCounts = new Map();
    for (const record of prepared) {
      if (!record.uid) {
        continue;
      }
      const termMatches = matchContextTerms(record, context);
      const familyCount = countFamilyMatches(record.text);
      if (termMatches.length >= 2 && familyCount >= 2) {
        repeatCounts.set(record.uid, (repeatCounts.get(record.uid) || 0) + 1);
      }
    }

    return prepared.map((record) => {
      const whitelisted = Boolean(record.uid && whitelist.has(record.uid));
      if (whitelisted) {
        return {
          ...record,
          decision: "show",
          score: 0,
          whitelisted: true,
          reasons: ["UID 白名单"],
          matchedTerms: [],
          familyCount: 0,
          termCount: 0,
        };
      }

      if (!settings.enabled || record.disabled) {
        return {
          ...record,
          decision: "show",
          score: 0,
          whitelisted: false,
          disabled: Boolean(record.disabled),
          reasons: [record.disabled ? "忽略非主评论" : "过滤已关闭"],
          matchedTerms: [],
          familyCount: 0,
          termCount: 0,
        };
      }

      if (!record.text || !record.norm) {
        return {
          ...record,
          decision: "show",
          score: 0,
          whitelisted: false,
          reasons: ["正文为空"],
          matchedTerms: [],
          familyCount: 0,
          termCount: 0,
        };
      }

      const reasons = [];
      let score = 0;
      const strongName = STRONG_NAME_RE.test(record.name);
      const weakName = WEAK_NAME_RE.test(record.name);
      const fishName = FISH_NAME_RE.test(record.name);
      const lowLevel = record.level > 0 && record.level <= 2;
      const levelThree = record.level === 3;

      if (strongName) {
        score += 3;
        reasons.push("强鱼/鲸名称 +3");
      } else if (weakName) {
        score += 2;
        reasons.push("肥鱼名称 +2");
      } else if (fishName) {
        score += 1;
        reasons.push("普通鱼字名称 +1");
      }

      if (lowLevel) {
        score += 2;
        reasons.push("低等级 +2");
      } else if (levelThree) {
        score += 1;
        reasons.push("Lv3 +1");
      }

      if (record.mentionStart) {
        score += 3;
        reasons.push("开头提及 +3");
      } else if (record.mentions.length > 0) {
        score += 1;
        reasons.push("正文提及 +1");
      }

      const ownerMatch = OWNER_RE.exec(record.text);
      const ownerNearMention = Boolean(
        record.mentionStart &&
          ownerMatch &&
          ownerMatch.index >= 0 &&
          ownerMatch.index <= OWNER_WINDOW,
      );
      const persona = PERSONA_RE.test(record.text);
      if (ownerNearMention) {
        score += 2;
        reasons.push("汇报关系 +2");
      }
      if (persona) {
        score += 1;
        reasons.push("角色自称 +1");
      }

      const matchedTerms = matchContextTerms(record, context);
      const termCount = matchedTerms.length;
      if (termCount >= 4) {
        score += 3;
        reasons.push("视频特定词 >=4 +3");
      } else if (termCount >= 2) {
        score += 2;
        reasons.push("视频特定词 >=2 +2");
      } else if (termCount === 1) {
        score += 1;
        reasons.push("视频特定词 +1");
      }

      const familyCount = countFamilyMatches(record.text);
      if (familyCount >= 4) {
        score += 3;
        reasons.push("模板短语 >=4 +3");
      } else if (familyCount >= 2) {
        score += 2;
        reasons.push("模板短语 >=2 +2");
      } else if (familyCount === 1) {
        score += 1;
        reasons.push("模板短语 +1");
      }

      const hasEnumeration = /[、]/.test(record.text);
      const hasActionDescription =
        /把.{0,50}(?:存成|切成|做成|打包)|讲的是|视频里|主要功能|支持|实现|可以用来|用来解决|一键/.test(
          record.text,
        );
      const hasReportPhrase = /替.{0,5}看|跟.{0,5}(?:说|讲)|值得看|去看|可以看/.test(record.text);
      const structureCount = [hasEnumeration, hasActionDescription, hasReportPhrase].filter(
        Boolean,
      ).length;
      if (structureCount >= 2) {
        score += 2;
        reasons.push("摘要结构 +2");
      } else if (structureCount === 1) {
        score += 1;
        reasons.push("摘要结构 +1");
      }

      if (record.text.length >= 40 && record.text.length <= 300) {
        score += 1;
        reasons.push("摘要长度 +1");
      }
      if (ROLE_ENDING_RE.test(record.text)) {
        score += 1;
        reasons.push("角色化结尾 +1");
      }

      const personalEvidence = PERSONAL_RE.test(record.text);
      if (
        personalEvidence &&
        record.text.length > 80 &&
        !ownerNearMention &&
        !persona &&
        !strongName &&
        !weakName
      ) {
        score -= 2;
        reasons.push("个人经历 -2");
      }

      const metaDiscussion = META_DISCUSSION_RE.test(record.text);
      if (
        metaDiscussion &&
        record.text.length > 80 &&
        !ownerNearMention &&
        !persona &&
        !strongName &&
        !weakName
      ) {
        score -= 2;
        reasons.push("人类论述 -2");
      }

      if (QUESTION_RE.test(record.text)) {
        score -= 1;
        reasons.push("疑问或反驳 -1");
      }

      score = clamp(score, 0, 99);
      const sameUidRepeat = Boolean(record.uid && (repeatCounts.get(record.uid) || 0) >= 2);
      const hardOwnerReport = record.mentionStart && ownerNearMention && termCount >= 1;
      const hardFishReport =
        (strongName || weakName) && lowLevel && record.mentionStart && termCount >= 1;
      const hardRoleReport =
        record.mentionStart && persona && termCount >= 1 && familyCount >= 2;

      let decision = score >= HIDE_SCORE ? "hide" : score >= FOLD_SCORE ? "fold" : "show";
      if (
        record.crossAccountDuplicate ||
        sameUidRepeat ||
        hardOwnerReport ||
        hardFishReport ||
        hardRoleReport
      ) {
        decision = "hide";
      }

      if (
        decision === "show" &&
        (strongName || weakName || fishName) &&
        record.level > 0 &&
        record.level <= 3 &&
        record.text.length < 80 &&
        SHORT_PERSONA_CONTEXT_RE.test(record.text)
      ) {
        decision = "fold";
        reasons.push("短人设评论折叠");
      }

      if (record.crossAccountDuplicate) {
        reasons.push("跨账号模板复读");
      }
      if (sameUidRepeat) {
        reasons.push("同 UID 重复模板");
      }
      if (hardOwnerReport) {
        reasons.push("硬规则：主人汇报");
      }
      if (hardFishReport) {
        reasons.push("硬规则：低等级鱼/鲸汇报");
      }
      if (hardRoleReport) {
        reasons.push("硬规则：角色化汇报");
      }

      return {
        ...record,
        decision,
        score,
        whitelisted: false,
        reasons,
        matchedTerms: matchedTerms.map((term) => term.text),
        familyCount,
        termCount,
        sameUidRepeat,
      };
    });
  }

  function extractLevel(userShadow) {
    const source = userShadow?.querySelector("#user-level img")?.getAttribute("src") || "";
    const match = source.match(/level_(\d+)\.svg/i);
    return match ? Number(match[1]) : 0;
  }

  function extractMainComment(threadHost, batchIndex) {
    const threadRoot = threadHost.shadowRoot;
    if (!threadRoot) {
      return null;
    }
    const renderer = threadRoot.querySelector("bili-comment-renderer");
    if (!renderer || !renderer.shadowRoot) {
      return null;
    }
    const rendererRoot = renderer.shadowRoot;
    const userShadow = rendererRoot.querySelector("bili-comment-user-info")?.shadowRoot;
    const nameLink = userShadow?.querySelector("#user-name a");
    const name = cleanVisibleText(nameLink?.textContent);
    if (!name) {
      return null;
    }
    const profileHref = nameLink?.getAttribute("href") || "";
    const uid = profileHref.match(/space\.bilibili\.com\/(\d+)/)?.[1] || "";
    const contents = rendererRoot.querySelector("bili-rich-text")?.shadowRoot?.querySelector(
      "#contents",
    );
    if (!contents) {
      return null;
    }
    const text = cleanVisibleText(contents.innerText || contents.textContent);
    const mentions = Array.from(
      contents.querySelectorAll('a[data-type="mention"], a[href*="space.bilibili.com"]'),
    )
      .map((link) => cleanVisibleText(link.textContent))
      .filter(Boolean);

    return {
      host: threadHost,
      renderer,
      name,
      uid,
      level: extractLevel(userShadow),
      text,
      mentions,
      batchIndex,
      key: `${uid || name}:${hashText(`${uid || ""}|${text}`)}`,
    };
  }

  function extractVideoContext() {
    const titleCandidates = [
      document.querySelector("h1.video-title"),
      document.querySelector("h1"),
      document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    ];
    const title = cleanVisibleText(
      titleCandidates.find((candidate) => {
        if (typeof candidate === "string") {
          return Boolean(candidate);
        }
        return Boolean(candidate?.textContent?.trim());
      })?.textContent ||
        titleCandidates.find((candidate) => typeof candidate === "string") ||
        document.title.replace(/_哔哩哔哩.*$/, ""),
    );

    const descriptionSelectors = [
      ".v_desc",
      ".desc-info-text",
      ".video-desc",
      ".basic-desc-info",
      ".desc-info",
    ];
    const descriptions = [];
    for (const selector of descriptionSelectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = cleanVisibleText(element.textContent).replace(/展开更多$/, "");
        if (text) {
          descriptions.push(text);
        }
      });
    }
    const metaDescription = document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    if (metaDescription) {
      descriptions.push(metaDescription);
    }

    const tags = [];
    document
      .querySelectorAll('a[href*="search.bilibili.com/all?keyword="]')
      .forEach((link) => {
        const text = cleanVisibleText(link.textContent);
        if (text && text.length <= 30) {
          tags.push(text);
        }
      });

    let uploaderUid = "";
    const uploaderSelectors = [
      'a[href*="upinfo.detail.click"]',
      'a[href*="upinfo.head.click"]',
      ".up-info a[href*='space.bilibili.com']",
      ".up-info--right a[href*='space.bilibili.com']",
    ];
    for (const selector of uploaderSelectors) {
      const link = document.querySelector(selector);
      const match = link?.getAttribute("href")?.match(/space\.bilibili\.com\/(\d+)/);
      if (match) {
        uploaderUid = match[1];
        break;
      }
    }

    return {
      title,
      description: uniqueStrings(descriptions).join("\n"),
      tags: uniqueStrings(tags),
      uploaderUid,
    };
  }

  function readStorage(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Storage can be unavailable in private or restricted contexts.
    }
  }

  function loadSettings() {
    const saved = readStorage(STORAGE_KEY, DEFAULT_SETTINGS);
    const legacyShowSuspected = saved?.showSuspected;
    return {
      filterAI: typeof saved?.filterAI === "boolean" ? saved.filterAI : saved?.enabled !== false,
      filterSuspected:
        typeof saved?.filterSuspected === "boolean"
          ? saved.filterSuspected
          : typeof legacyShowSuspected === "boolean"
            ? !legacyShowSuspected
            : true,
      panelCollapsed: saved?.panelCollapsed === true,
      whitelist: Array.isArray(saved?.whitelist)
        ? [...new Set(saved.whitelist.map(String).filter(Boolean))]
        : [],
      position: normalizePanelPosition(saved?.position),
    };
  }

  function saveSettings(settings) {
    writeStorage(STORAGE_KEY, {
      filterAI: settings.filterAI !== false,
      filterSuspected: settings.filterSuspected !== false,
      panelCollapsed: settings.panelCollapsed === true,
      whitelist: [...new Set(settings.whitelist.map(String).filter(Boolean))],
      position: normalizePanelPosition(settings.position),
    });
  }

  function start() {
    if (globalThis.__BACF_STARTED__) {
      return;
    }
    globalThis.__BACF_STARTED__ = true;

    const settings = loadSettings();
    const state = {
      settings,
      hiddenCount: 0,
      foldedCount: 0,
      currentUrl: location.href,
      scanTimer: 0,
      routeTimer: 0,
    };

    const observedRoots = new WeakSet();
    const observedThemeTargets = new WeakSet();
    let panel = null;

    function ensurePanel() {
      if (!panel && document.documentElement) {
        panel = createPanel();
      }
      return panel;
    }

    function setPanelVisible(visible) {
      if (panel?.host) {
        panel.host.style.display = visible ? "" : "none";
      }
    }

    function applyPanelPosition(host, position) {
      const normalized = normalizePanelPosition(position);
      host.dataset.bacfPosition = normalized;
      host.style.bottom = "16px";
      host.style.top = "auto";
      host.style.left = normalized === "bottom-left" ? "16px" : "auto";
      host.style.right = normalized === "bottom-left" ? "auto" : "16px";
    }

    function applyPanelTheme(host) {
      host.dataset.bacfTheme = detectPageTheme();
    }

    function scheduleScan(delay = 160) {
      if (state.scanTimer) {
        clearTimeout(state.scanTimer);
      }
      state.scanTimer = window.setTimeout(() => {
        state.scanTimer = 0;
        scanPage();
      }, delay);
    }

    function observeRoot(root) {
      if (!root || observedRoots.has(root)) {
        return;
      }
      observedRoots.add(root);
      const observer = new MutationObserver(() => scheduleScan());
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      watchTreeForShadowRoots(root);
    }

    function watchTreeForShadowRoots(root) {
      if (!root?.querySelectorAll) {
        return;
      }
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          observeRoot(element.shadowRoot);
        }
      }
    }

    function installShadowObserver() {
      const originalAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) {
        const root = originalAttachShadow.call(this, init);
        observeRoot(root);
        scheduleScan();
        return root;
      };
    }

    function observeThemeTarget(target) {
      if (!target || observedThemeTargets.has(target)) {
        return;
      }
      observedThemeTargets.add(target);
      const observer = new MutationObserver(() => scheduleScan(0));
      observer.observe(target, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "theme"],
      });
    }

    function watchPageTheme() {
      observeThemeTarget(document.documentElement);
      observeThemeTarget(document.body);
    }

    function collectThreadHosts() {
      const hosts = new Set();
      const visit = (root) => {
        if (!root?.querySelectorAll) {
          return;
        }
        for (const element of root.querySelectorAll("bili-comment-thread-renderer")) {
          hosts.add(element);
        }
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) {
            visit(element.shadowRoot);
          }
        }
      };
      visit(document);
      return [...hosts];
    }

    function injectThreadStyle(root) {
      if (root.querySelector("style[data-bacf-style]")) {
        return;
      }
      const style = document.createElement("style");
      style.dataset.bacfStyle = "true";
      style.textContent = `
        :host([data-bacf-decision="hide"][data-bacf-reveal="false"]) {
          display: none !important;
        }
        :host([data-bacf-decision="fold"][data-bacf-reveal="false"]) > bili-comment-renderer,
        :host([data-bacf-decision="fold"][data-bacf-reveal="false"]) > bili-comment-replies-renderer {
          display: none !important;
        }
        .bacf-placeholder,
        .bacf-badge {
          align-items: center;
          box-sizing: border-box;
          display: none;
          font: 11px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          gap: 6px;
          max-width: calc(100% - 4px);
          width: fit-content;
        }
        :host([data-bacf-decision="fold"][data-bacf-reveal="false"]) > .bacf-placeholder {
          display: inline-flex;
        }
        :host([data-bacf-reveal="true"][data-bacf-decision="hide"]) > .bacf-badge,
        :host([data-bacf-reveal="true"][data-bacf-decision="fold"]) > .bacf-badge {
          display: inline-flex;
        }
        .bacf-placeholder {
          background: var(--bg1, #fff);
          border: 1px solid var(--line_regular, #e3e5e7);
          border-radius: 4px;
          color: var(--text2, #61666d);
          margin: 4px 0;
          padding: 5px 7px;
        }
        .bacf-badge {
          background: var(--bg2, #f6f7f8);
          border-left: 2px solid #fb7299;
          color: var(--text2, #61666d);
          margin: 4px 0;
          padding: 4px 7px;
        }
        :host([data-bacf-theme="dark"]) .bacf-placeholder {
          background: var(--bg1, #1f2024);
          border-color: var(--line_regular, #363840);
          color: var(--text2, #b8bcc5);
        }
        :host([data-bacf-theme="dark"]) .bacf-badge {
          background: var(--bg2, #282a30);
          color: var(--text2, #b8bcc5);
        }
        .bacf-placeholder-text,
        .bacf-badge-text {
          flex: 1;
          min-width: 0;
        }
        .bacf-action {
          background: var(--bg2, #f4f5f6);
          border: 1px solid color-mix(in srgb, #fb7299 42%, var(--line_regular, #d9dde2));
          border-radius: 3px;
          color: color-mix(in srgb, #fb7299 76%, var(--text1, #18191c));
          cursor: pointer;
          font: inherit;
          padding: 2px 6px;
          white-space: nowrap;
        }
        .bacf-action:hover {
          border-color: #fb7299;
          color: #d14d7a;
        }
        :host([data-bacf-theme="dark"]) .bacf-action {
          background: var(--bg3, #32343b);
          border-color: color-mix(in srgb, #fb7299 55%, var(--line_regular, #454750));
          color: #ff9db8;
        }
        @media (prefers-color-scheme: dark) {
          :host(:not([data-bacf-theme="light"])) .bacf-placeholder {
            background: var(--bg1, #1f2024);
            border-color: var(--line_regular, #363840);
            color: var(--text2, #b8bcc5);
          }
          :host(:not([data-bacf-theme="light"])) .bacf-badge {
            background: var(--bg2, #282a30);
            color: var(--text2, #b8bcc5);
          }
          :host(:not([data-bacf-theme="light"])) .bacf-action {
            background: var(--bg3, #32343b);
            border-color: var(--line_regular, #454750);
            color: #ff9db8;
          }
        }
      `;
      root.insertBefore(style, root.firstChild);
    }

    function ensureThreadChrome(threadHost) {
      const root = threadHost.shadowRoot;
      if (!root) {
        return null;
      }
      injectThreadStyle(root);
      if (!root.querySelector(".bacf-placeholder") || !root.querySelector(".bacf-badge")) {
        const placeholder = document.createElement("div");
        placeholder.className = "bacf-placeholder";

        const placeholderText = document.createElement("span");
        placeholderText.className = "bacf-placeholder-text";
        placeholderText.textContent = "疑似 Agent 评论";

        const expandButton = document.createElement("button");
        expandButton.className = "bacf-action";
        expandButton.type = "button";
        expandButton.dataset.bacfAction = "expand";
        expandButton.textContent = "展开";

        const whitelistButton = document.createElement("button");
        whitelistButton.className = "bacf-action";
        whitelistButton.type = "button";
        whitelistButton.dataset.bacfAction = "whitelist";
        whitelistButton.textContent = "白名单";

        placeholder.append(placeholderText, expandButton, whitelistButton);

        const badge = document.createElement("div");
        badge.className = "bacf-badge";

        const badgeText = document.createElement("span");
        badgeText.className = "bacf-badge-text";

        const collapseButton = document.createElement("button");
        collapseButton.className = "bacf-action";
        collapseButton.type = "button";
        collapseButton.dataset.bacfAction = "collapse";
        collapseButton.textContent = "收起";

        badge.append(badgeText, collapseButton, whitelistButton.cloneNode(true));
        root.insertBefore(badge, root.firstChild);
        root.insertBefore(placeholder, root.firstChild);

        root.addEventListener("click", (event) => {
          const action = event.target.closest?.("[data-bacf-action]")?.dataset.bacfAction;
          if (!action) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const key = threadHost.dataset.bacfKey || "";
          const uid = threadHost.dataset.bacfUid || "";
          if (action === "expand") {
            if (key) {
              state.revealedKeys.add(key);
            }
            threadHost.setAttribute("data-bacf-reveal", "true");
          } else if (action === "collapse") {
            if (key) {
              state.revealedKeys.delete(key);
            }
            threadHost.setAttribute("data-bacf-reveal", "false");
          } else if (action === "whitelist" && uid) {
            if (!state.settings.whitelist.includes(uid)) {
              state.settings.whitelist.push(uid);
              saveSettings(state.settings);
              scanPage();
            }
          }
        });
      }

      return {
        placeholder: root.querySelector(".bacf-placeholder"),
        badge: root.querySelector(".bacf-badge"),
        placeholderText: root.querySelector(".bacf-placeholder .bacf-placeholder-text"),
        badgeText: root.querySelector(".bacf-badge .bacf-badge-text"),
      };
    }

    function injectVisibilityStyle(root) {
      if (root.querySelector("style[data-bacf-visibility]")) {
        return;
      }
      const style = document.createElement("style");
      style.dataset.bacfVisibility = "true";
      style.textContent = `
        :host([data-bacf-visible="false"]) {
          display: none !important;
        }
      `;
      root.insertBefore(style, root.firstChild);
    }

    function ensureInlineStatus(threadHost) {
      const renderer = threadHost.shadowRoot?.querySelector("bili-comment-renderer");
      const userInfo = renderer?.shadowRoot?.querySelector("bili-comment-user-info");
      const userRoot = userInfo?.shadowRoot;
      if (!userRoot) {
        return null;
      }

      if (!userRoot.querySelector("style[data-bacf-inline-style]")) {
        const style = document.createElement("style");
        style.dataset.bacfInlineStyle = "true";
        style.textContent = `
          .bacf-inline-status {
            align-items: center;
            border-radius: 999px;
            display: none;
            font: 500 10px/16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            margin-left: 6px;
            padding: 0 5px;
            vertical-align: middle;
            white-space: nowrap;
          }
          .bacf-inline-status[data-kind="hide"] {
            background: var(--bacf-inline-filter-bg, #ffe8ef);
            color: var(--bacf-inline-filter-fg, #b3486c);
          }
          .bacf-inline-status[data-kind="fold"] {
            background: var(--bacf-inline-suspect-bg, #fff1d8);
            color: var(--bacf-inline-suspect-fg, #8a5a00);
          }
        `;
        userRoot.insertBefore(style, userRoot.firstChild);
      }

      let status = userRoot.querySelector(".bacf-inline-status");
      if (!status) {
        status = document.createElement("span");
        status.className = "bacf-inline-status";
        const info = userRoot.querySelector("#info") || userRoot;
        info.appendChild(status);
      }
      return status;
    }

    function scanPage() {
      ensurePanel();
      if (state.currentUrl !== location.href) {
        state.currentUrl = location.href;
        setPanelVisible(false);
        state.hiddenCount = 0;
        state.foldedCount = 0;
      }

      const threads = collectThreadHosts();
      const context = extractVideoContext();
      const pageTheme = detectPageTheme();
      const records = [];
      threads.forEach((threadHost, index) => {
        const record = extractMainComment(threadHost, index);
        if (record) {
          records.push(record);
        }
      });

      const settingsForRules = {
        ...state.settings,
        enabled: true,
        whitelist: [
          ...state.settings.whitelist,
          ...(context.uploaderUid ? [context.uploaderUid] : []),
        ],
      };
      const results = classifyComments(records, context, settingsForRules);
      state.hiddenCount = 0;
      state.foldedCount = 0;

      for (const result of results) {
        if (result.disabled) {
          continue;
        }
        const threadHost = result.host;
        if (!threadHost?.shadowRoot) {
          continue;
        }
        const visible =
          result.decision === "show" ||
          (result.decision === "hide" && !state.settings.filterAI) ||
          (result.decision === "fold" && !state.settings.filterSuspected);
        injectVisibilityStyle(threadHost.shadowRoot);
        threadHost.setAttribute("data-bacf-decision", result.decision);
        threadHost.setAttribute("data-bacf-visible", String(Boolean(visible)));
        threadHost.setAttribute("data-bacf-theme", pageTheme);
        if (pageTheme === "dark") {
          threadHost.style.setProperty("--bacf-inline-filter-bg", "#4a2734");
          threadHost.style.setProperty("--bacf-inline-filter-fg", "#ff9db8");
          threadHost.style.setProperty("--bacf-inline-suspect-bg", "#3d3422");
          threadHost.style.setProperty("--bacf-inline-suspect-fg", "#f0c36b");
        } else {
          threadHost.style.setProperty("--bacf-inline-filter-bg", "#ffe8ef");
          threadHost.style.setProperty("--bacf-inline-filter-fg", "#b3486c");
          threadHost.style.setProperty("--bacf-inline-suspect-bg", "#fff1d8");
          threadHost.style.setProperty("--bacf-inline-suspect-fg", "#8a5a00");
        }

        if (result.decision === "hide") {
          state.hiddenCount += 1;
        } else if (result.decision === "fold") {
          state.foldedCount += 1;
        }

        const status = ensureInlineStatus(threadHost);
        if (status) {
          const hasStatus = result.decision !== "show";
          if (hasStatus) {
            status.dataset.kind = result.decision;
            status.textContent = result.decision === "hide" ? "已过滤" : "疑似";
            status.title = result.reasons.join("；");
          } else {
            status.removeAttribute("data-kind");
            status.textContent = "";
            status.title = "";
          }
          status.style.display = hasStatus && visible ? "inline-flex" : "none";
        }
      }

      setPanelVisible(records.length > 0 && state.hiddenCount + state.foldedCount > 0);
      renderPanel();
    }

    function createPanel() {
      const existing = document.getElementById("bacf-widget-host");
      if (existing) {
        return existing.__bacfApi;
      }
      const host = document.createElement("div");
      host.id = "bacf-widget-host";
      host.style.display = "none";
      host.style.position = "fixed";
      host.style.zIndex = "2147483647";
      applyPanelPosition(host, state.settings.position);
      applyPanelTheme(host);
      document.documentElement.appendChild(host);
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            --bacf-panel-bg: rgba(255, 255, 255, 0.98);
            --bacf-panel-text: #18191c;
            --bacf-panel-muted: #61666d;
            --bacf-panel-border: rgba(0, 0, 0, 0.1);
            --bacf-control-bg: #f4f5f6;
            --bacf-control-border: #d9dde2;
            --bacf-control-hover: #fff0f4;
            --bacf-shadow: 0 10px 30px rgba(20, 24, 31, 0.16);
          }
          :host([data-bacf-theme="dark"]) {
            --bacf-panel-bg: rgba(31, 32, 36, 0.98);
            --bacf-panel-text: #f1f2f4;
            --bacf-panel-muted: #b8bcc5;
            --bacf-panel-border: rgba(255, 255, 255, 0.12);
            --bacf-control-bg: #2b2d33;
            --bacf-control-border: #464951;
            --bacf-control-hover: #3a2a31;
            --bacf-shadow: 0 12px 34px rgba(0, 0, 0, 0.36);
          }
          @media (prefers-color-scheme: dark) {
            :host(:not([data-bacf-theme="light"])) {
              --bacf-panel-bg: rgba(31, 32, 36, 0.98);
              --bacf-panel-text: #f1f2f4;
              --bacf-panel-muted: #b8bcc5;
              --bacf-panel-border: rgba(255, 255, 255, 0.12);
              --bacf-control-bg: #2b2d33;
              --bacf-control-border: #464951;
              --bacf-control-hover: #3a2a31;
              --bacf-shadow: 0 12px 34px rgba(0, 0, 0, 0.36);
            }
          }
          .panel {
            background: var(--bacf-panel-bg);
            border: 1px solid var(--bacf-panel-border);
            border-radius: 8px;
            box-shadow: var(--bacf-shadow);
            box-sizing: border-box;
            color: var(--bacf-panel-text);
            container-type: inline-size;
            display: flex;
            flex-direction: column;
            font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            height: ${PANEL_HEIGHT}px;
            max-height: calc(100vh - 32px);
            max-width: calc(100vw - 32px);
            overflow: visible;
            position: relative;
            width: ${PANEL_WIDTH}px;
          }
          .panel.settings-mode {
            height: min(${PANEL_SETTINGS_HEIGHT}px, calc(100vh - 32px)) !important;
            width: min(${PANEL_SETTINGS_WIDTH}px, calc(100vw - 32px)) !important;
          }
          .header {
            align-items: center;
            background: var(--bacf-control-bg);
            border-bottom: 1px solid var(--bacf-panel-border);
            display: flex;
            flex: 0 0 auto;
            gap: 10px;
            justify-content: space-between;
            padding: 10px 12px;
          }
          .header-actions {
            align-items: center;
            display: flex;
            gap: 4px;
          }
          .title {
            font-size: 13px;
            font-weight: 650;
            letter-spacing: 0;
            white-space: nowrap;
          }
          .collapsed-label {
            display: none;
          }
          .count {
            color: #fb7299;
            font-variant-numeric: tabular-nums;
            margin-left: 6px;
          }
          .button, .small-button {
            background: var(--bacf-control-bg);
            border: 1px solid var(--bacf-control-border);
            border-radius: 5px;
            color: var(--bacf-panel-text);
            cursor: pointer;
            font: inherit;
            max-width: 100%;
            min-width: 0;
            overflow: hidden;
            padding: 5px 9px;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .button:hover, .small-button:hover {
            border-color: #fb7299;
            background: var(--bacf-control-hover);
          }
          .icon-button {
            align-items: center;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 50%;
            color: var(--bacf-panel-muted);
            cursor: pointer;
            display: inline-flex;
            flex: 0 0 auto;
            height: 24px;
            justify-content: center;
            padding: 0;
            text-decoration: none;
            width: 24px;
          }
          .icon-button:hover {
            background: var(--bacf-control-hover);
            border-color: var(--bacf-control-border);
            color: #fb7299;
          }
          .icon-button svg {
            fill: currentColor;
            height: 14px;
            width: 14px;
          }
          .body {
            align-content: start;
            border-top: 1px solid var(--bacf-panel-border);
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            gap: 6px;
            min-height: 0;
            overflow: auto;
            padding: 8px 10px 10px;
          }
          .panel.collapsed {
            border-radius: 999px;
            container-type: normal;
            cursor: pointer;
            height: auto !important;
            min-height: 0;
            min-width: 0;
            width: auto !important;
          }
          .panel.collapsed .header {
            gap: 0;
            padding: 5px 9px;
          }
          .panel.collapsed .expanded-label,
          .panel.collapsed .body,
          .panel.collapsed .toggle {
            display: none !important;
          }
          .panel.collapsed .header-actions {
            display: none;
          }
          .panel.collapsed .collapsed-label {
            display: inline;
            font-size: 12px;
          }
          .panel.collapsed .count {
            margin-left: 4px;
          }
          .row {
            align-items: center;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: space-between;
          }
          .settings {
            display: none;
            gap: 8px;
          }
          .settings.open {
            display: grid;
          }
          select {
            background: var(--bacf-control-bg);
            border: 1px solid var(--bacf-control-border);
            border-radius: 4px;
            color: var(--bacf-panel-text);
            font: inherit;
            padding: 4px 6px;
          }
          textarea {
            background: var(--bacf-control-bg);
            border: 1px solid var(--bacf-control-border);
            border-radius: 5px;
            box-sizing: border-box;
            color: var(--bacf-panel-text);
            font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
            min-height: 60px;
            padding: 7px 8px;
            resize: vertical;
            width: 100%;
          }
          .settings-toggle-row {
            margin-top: auto;
          }
          .settings-toggle-row .button {
            width: 100%;
          }
          .hint {
            color: var(--bacf-panel-muted);
            font-size: 11px;
          }
          .project-link {
            color: var(--bacf-panel-muted);
          }
          @container (max-width: 230px) {
            .header {
              gap: 4px;
              padding: 8px 9px;
            }
            .title {
              font-size: 12px;
            }
            .header-actions {
              gap: 0;
            }
            .icon-button {
              height: 22px;
              width: 22px;
            }
            .body {
              gap: 6px;
              padding: 8px 9px 10px;
            }
            .row {
              align-items: stretch;
              flex-direction: column;
            }
            .row > .button,
            .row > .small-button,
            .row > button {
              width: 100%;
            }
            .status {
              font-size: 11px;
            }
          }
          @media (max-width: 480px) {
            .panel {
              max-width: calc(100vw - 24px);
            }
            .panel.settings-mode {
              height: min(${PANEL_SETTINGS_HEIGHT}px, calc(100vh - 24px)) !important;
              width: calc(100vw - 24px) !important;
            }
          }
        </style>
        <div class="panel" tabindex="-1">
          <div class="header">
            <div class="title">
              <span class="expanded-label">Agent 评论过滤</span>
              <span class="collapsed-label">已过滤</span>
              <span class="count">0</span>
            </div>
            <div class="header-actions">
              <a
                class="icon-button project-link"
                href="${PROJECT_URL}"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="打开 GitHub 项目"
                title="GitHub 项目"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.5-1.4-1.9-1.4-1.9-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/>
                </svg>
              </a>
              <button
                class="icon-button toggle"
                type="button"
                data-action="collapse"
                aria-label="收起面板"
                title="收起面板"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.4 14.6 12 10l4.6 4.6-1.4 1.4-3.2-3.2-3.2 3.2z"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="body">
            <div class="row">
              <span class="status">等待评论区加载</span>
            </div>
            <div class="row">
              <label><input type="checkbox" data-action="filter-ai" checked> 过滤 AI 评论</label>
            </div>
            <div class="row">
              <label>
                <input type="checkbox" data-action="filter-suspected" checked>
                过滤疑似 AI 评论
              </label>
            </div>
            <div class="settings">
              <div class="row">
                <span class="hint">面板位置</span>
                <select data-action="position">
                  <option value="bottom-right">右下角</option>
                  <option value="bottom-left">左下角</option>
                </select>
              </div>
              <div class="hint">白名单 UID，每行一个</div>
              <textarea spellcheck="false" placeholder="例如&#10;123456789"></textarea>
              <div class="row">
                <button class="button" type="button" data-action="save-whitelist">保存白名单</button>
              </div>
            </div>
            <div class="row settings-toggle-row">
              <button
                class="button"
                type="button"
                data-action="settings"
                aria-expanded="false"
              >设置</button>
            </div>
          </div>
        </div>
      `;

      const elements = {
        panel: root.querySelector(".panel"),
        titleCount: root.querySelector(".count"),
        status: root.querySelector(".status"),
        collapseButton: root.querySelector('[data-action="collapse"]'),
        filterAIInput: root.querySelector('[data-action="filter-ai"]'),
        filterSuspectedInput: root.querySelector('[data-action="filter-suspected"]'),
        settings: root.querySelector(".settings"),
        settingsButton: root.querySelector('[data-action="settings"]'),
        positionSelect: root.querySelector('[data-action="position"]'),
        textarea: root.querySelector("textarea"),
        saveButton: root.querySelector('[data-action="save-whitelist"]'),
        body: root.querySelector(".body"),
      };

      let collapsed = false;
      let settingsOpen = false;

      function setCollapsed(nextCollapsed, persist = true) {
        collapsed = Boolean(nextCollapsed);
        state.settings.panelCollapsed = collapsed;
        elements.panel.classList.toggle("collapsed", collapsed);
        elements.panel.setAttribute("role", collapsed ? "button" : "region");
        elements.panel.setAttribute("aria-expanded", String(!collapsed));
        elements.panel.tabIndex = collapsed ? 0 : -1;
        elements.collapseButton.setAttribute("aria-label", collapsed ? "展开面板" : "收起面板");
        elements.collapseButton.title = collapsed ? "展开面板" : "收起面板";
        if (persist) {
          saveSettings(state.settings);
        }
      }

      function setSettingsOpen(nextOpen) {
        settingsOpen = Boolean(nextOpen);
        if (settingsOpen) {
          setCollapsed(false);
        }
        elements.panel.classList.toggle("settings-mode", settingsOpen);
        elements.settings.classList.toggle("open", settingsOpen);
        elements.settingsButton.textContent = settingsOpen ? "关闭设置" : "设置";
        elements.settingsButton.setAttribute("aria-expanded", String(settingsOpen));
        if (settingsOpen) {
          elements.textarea.value = state.settings.whitelist.join("\n");
          elements.positionSelect.value = normalizePanelPosition(state.settings.position);
        }
      }

      const api = {
        host,
        elements,
        render() {
          applyPanelPosition(host, state.settings.position);
          applyPanelTheme(host);
          const total = state.hiddenCount + state.foldedCount;
          elements.titleCount.textContent = total ? ` ${total}` : "";
          elements.status.textContent = total
            ? `隐藏 ${state.hiddenCount} · 疑似 ${state.foldedCount}`
            : "没有匹配到过滤项";
          elements.filterAIInput.checked = state.settings.filterAI;
          elements.filterSuspectedInput.checked = state.settings.filterSuspected;
          elements.positionSelect.value = normalizePanelPosition(state.settings.position);
        },
      };

      elements.collapseButton.addEventListener("click", (event) => {
        event.stopPropagation();
        setSettingsOpen(false);
        setCollapsed(true);
      });
      elements.panel.addEventListener("click", () => {
        if (collapsed) {
          setCollapsed(false);
        }
      });
      elements.panel.addEventListener("keydown", (event) => {
        if (collapsed && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setCollapsed(false);
        }
      });
      elements.filterAIInput.addEventListener("change", () => {
        state.settings.filterAI = elements.filterAIInput.checked;
        saveSettings(state.settings);
        scanPage();
      });
      elements.filterSuspectedInput.addEventListener("change", () => {
        state.settings.filterSuspected = elements.filterSuspectedInput.checked;
        saveSettings(state.settings);
        scanPage();
      });
      elements.settingsButton.addEventListener("click", () => {
        setSettingsOpen(!settingsOpen);
      });
      elements.positionSelect.addEventListener("change", () => {
        state.settings.position = normalizePanelPosition(elements.positionSelect.value);
        saveSettings(state.settings);
        applyPanelPosition(host, state.settings.position);
      });
      elements.saveButton.addEventListener("click", () => {
        state.settings.whitelist = [
          ...new Set(
            elements.textarea.value
              .split(/\s+/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
        saveSettings(state.settings);
        setSettingsOpen(false);
        scanPage();
      });

      document.addEventListener(
        "pointerdown",
        (event) => {
          if (collapsed || event.composedPath().includes(host)) {
            return;
          }
          setSettingsOpen(false);
          setCollapsed(true);
        },
        true,
      );

      setCollapsed(Boolean(state.settings.panelCollapsed), false);
      api.render();
      host.__bacfApi = api;
      return api;
    }

    function renderPanel() {
      if (panel) {
        panel.render();
      }
    }

    if (document.documentElement) {
      observeRoot(document);
      ensurePanel();
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          observeRoot(document);
          watchPageTheme();
          ensurePanel();
          scheduleScan(0);
        },
        { once: true },
      );
    }

    installShadowObserver();
    watchPageTheme();
    const colorSchemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (colorSchemeMedia?.addEventListener) {
      colorSchemeMedia.addEventListener("change", () => scheduleScan(0));
    }
    scheduleScan(0);
    state.routeTimer = window.setInterval(() => {
      if (state.currentUrl !== location.href) {
        scheduleScan(0);
      } else {
        scheduleScan(500);
      }
    }, 3000);
    window.addEventListener("popstate", () => scheduleScan(0));
    window.addEventListener("pageshow", () => scheduleScan(0));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      VERSION,
      DEFAULT_SETTINGS,
      STOPWORDS,
      COMMUNITY_TERMS,
      TEMPLATE_FAMILIES,
      normalizeText,
      normalizePanelPosition,
      parseColorLuminance,
      detectPageTheme,
      buildVideoContext,
      markCrossAccountDuplicates,
      countFamilyMatches,
      classifyComments,
    };
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    start();
  }
})();
