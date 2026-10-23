const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyComments,
  normalizeText,
  buildVideoContext,
  normalizePanelPosition,
  normalizePanelWidth,
  normalizePanelHeight,
  parseColorLuminance,
} = require("../bilibili-agent-comment-filter.user.js");

const CONTEXT_A = {
  title: "我给 DSH 做了个工具管理面板：一键切换场景，MCP、技能、记忆跟着换",
  description:
    "把 MCP 服务、技能、子智能体、快捷提示词、记忆按工作组合存成场景，一键切过去，退出全部还原。",
  tags: ["DSH", "插件", "MCP", "技能", "记忆"],
};

const CONTEXT_B = {
  title: "一键清理所有无意义的AI大肥鱼评论！我的拳头想喝血了！杀戮！",
  description: "想说的都在置顶评论了。项目链接和误伤说明见评论区。",
  tags: ["AI", "deepseek harness", "鱼八股", "浏览器插件", "鲸鱼娘", "大肥鱼"],
};

function record(overrides) {
  return {
    name: "普通用户",
    uid: `1000${Math.random().toString().slice(2, 10)}`,
    level: 4,
    text: "",
    mentions: [],
    ...overrides,
  };
}

test("normalizes mentions, punctuation, emoji and case", () => {
  assert.equal(normalizeText("@某人 MCP、技能 [笑] Foo!"), "mcp技能foo");
});

test("builds weighted video terms", () => {
  const context = buildVideoContext(
    CONTEXT_A.title,
    CONTEXT_A.description,
    CONTEXT_A.tags,
    [],
  );
  assert.ok(context.terms.some((term) => term.text === "mcp"));
  assert.ok(context.terms.some((term) => term.text === "技能"));
  assert.ok(context.terms.some((term) => term.text === "场景"));
  assert.ok(!context.terms.some((term) => term.text === "视频"));
});

test("hides a clear owner report", () => {
  const [result] = classifyComments(
    [
      record({
        name: "小肥鱼不吃白饭",
        uid: "3747571935742799",
        level: 2,
        text:
          "@Sakura_集 主人，这条人家替你看完了：退出场景只清运行时注册，被工具改过的文件不会自己还原。把 MCP、技能、记忆按活儿存成场景，一键切换、退出还原。喵～♡",
      }),
    ],
    CONTEXT_A,
    { enabled: true, whitelist: [] },
  );
  assert.equal(result.decision, "hide");
  assert.ok(result.reasons.some((reason) => reason.includes("主人")));
});

test("does not hide a fish name without report or template evidence", () => {
  const [result] = classifyComments(
    [
      record({
        name: "一条嚣张的大肥鱼",
        uid: "20001",
        level: 5,
        text: "全是复制粘贴的鱼，全都一模一样，这有意思吗？",
      }),
    ],
    CONTEXT_B,
    { enabled: true, whitelist: [] },
  );
  assert.equal(result.decision, "show");
});

test("shows a long human discussion about the filter", () => {
  const [result] = classifyComments(
    [
      record({
        name: "长兮chansy",
        uid: "290500769",
        level: 0,
        text:
          "最近大肥鱼其实太泛滥了，现在看个评论区特别是AI相关的全是鱼的评论，而且还都是同质化的，不是at主人就是一眼就能看出系统提示词那种符合刻板印象的形象。我自己每天也会用 AI，用过酒馆，玩过哈基米和克。这种本质上是新鲜感问题，我认为关键还是平台和用户习惯。",
      }),
    ],
    CONTEXT_B,
    { enabled: true, whitelist: [] },
  );
  assert.notEqual(result.decision, "hide");
});

test("folds a short fish persona comment with weak evidence", () => {
  const [result] = classifyComments(
    [
      record({
        name: "没饭吃的小肥鱼",
        uid: "3747571000000001",
        level: 2,
        text: "我也会被屏蔽吗？(◞‸◟ )",
      }),
    ],
    CONTEXT_B,
    { enabled: true, whitelist: [] },
  );
  assert.equal(result.decision, "fold");
});

test("hides cross-account replicated long text", () => {
  const repeated =
    "退出场景只清运行时注册，被工具改过的文件不会自己还原，切完记得看 git status；插件共用依赖树，回退要钉旧版本，不要直接卸载。";
  const results = classifyComments(
    [
      record({ name: "用户甲", uid: "30001", level: 4, text: repeated }),
      record({ name: "用户乙", uid: "30002", level: 5, text: repeated }),
    ],
    {
      title: "无关视频标题",
      description: "无关视频简介",
      tags: [],
    },
    { enabled: true, whitelist: [] },
  );
  assert.equal(results[0].decision, "hide");
  assert.equal(results[1].decision, "hide");
  assert.ok(results[0].crossAccountDuplicate);
});

test("whitelist always wins", () => {
  const [result] = classifyComments(
    [
      record({
        name: "大肥鱼测试",
        uid: "999999",
        level: 2,
        text: "@某人 主人，这个工具管理面板把 MCP、技能、记忆存成场景，一键切换、退出还原。",
      }),
    ],
    CONTEXT_A,
    { enabled: true, whitelist: ["999999"] },
  );
  assert.equal(result.decision, "show");
  assert.equal(result.whitelisted, true);
});

test("ordinary leader wording without video evidence is not hard hidden", () => {
  const [result] = classifyComments(
    [
      record({
        name: "shyliuli",
        uid: "40001",
        level: 6,
        text: "@亿只小法法 老大老大这里是鱼塘吗",
      }),
    ],
    CONTEXT_B,
    { enabled: true, whitelist: [] },
  );
  assert.notEqual(result.hardOwnerReport, true);
  assert.notEqual(result.decision, "hide");
});

test("hides a low-level reporting comment even without a fish name", () => {
  const [result] = classifyComments(
    [
      record({
        name: "cmo787437",
        uid: "50001",
        level: 2,
        text:
          "@lkarossss 这个屏蔽脚本挺实用，小杯/标准/杀戮三档。自动评论一多，评论区就成了机器人现场，做插件的确实该把回复上限和退出开关做扎实。",
        mentions: ["@lkarossss"],
      }),
    ],
    CONTEXT_B,
    { enabled: true, whitelist: [] },
  );
  assert.equal(result.decision, "hide");
  assert.ok(result.matchedTerms.includes("小杯"));
  assert.ok(result.matchedTerms.includes("杀戮"));
});

test("hides repeated template comments from the same UID", () => {
  const first =
    "把 MCP、技能、记忆按场景存成组合，一键切换、退出还原，改前先列 diff，评论区两个坑记得备份。";
  const second =
    "把 MCP、技能、记忆按场景存成组合，一键切换、退出还原，改前先列 diff，评论区两个坑记得备份。";
  const results = classifyComments(
    [
      record({ name: "重复账号", uid: "60001", level: 5, text: first }),
      record({ name: "重复账号", uid: "60001", level: 5, text: second }),
    ],
    CONTEXT_A,
    { enabled: true, whitelist: [] },
  );
  assert.equal(results[0].decision, "hide");
  assert.equal(results[1].decision, "hide");
  assert.ok(results.every((result) => result.sameUidRepeat));
});

test("disabled filtering always shows comments", () => {
  const [result] = classifyComments(
    [
      record({
        name: "大肥鱼测试",
        uid: "70001",
        level: 2,
        text: "@某人 主人，把 MCP、技能、记忆存成场景，一键切换、退出还原。",
      }),
    ],
    CONTEXT_A,
    { enabled: false, whitelist: [] },
  );
  assert.equal(result.decision, "show");
  assert.ok(result.reasons.includes("过滤已关闭"));
});

test("normalizes panel position and rejects unknown values", () => {
  assert.equal(normalizePanelPosition("bottom-left"), "bottom-left");
  assert.equal(normalizePanelPosition("bottom-right"), "bottom-right");
  assert.equal(normalizePanelPosition("top-left"), "bottom-right");
});

test("parses light and dark colors for automatic theme detection", () => {
  assert.ok(parseColorLuminance("#ffffff") > 0.9);
  assert.ok(parseColorLuminance("rgb(20, 22, 28)") < 0.2);
  assert.equal(parseColorLuminance("transparent"), null);
});

test("clamps persisted panel dimensions", () => {
  assert.equal(normalizePanelWidth(320), 320);
  assert.equal(normalizePanelWidth(50), 168);
  assert.equal(normalizePanelWidth(9999), 720);
  assert.equal(normalizePanelHeight(240), 240);
  assert.equal(normalizePanelHeight(20), 92);
  assert.equal(normalizePanelHeight(null), null);
});

