"use strict";

// =====================================================================
// AI接続設定
//   mode "browser": ブラウザから直接 Anthropic API を呼ぶ（開発・テスト用）
//                   APIキーは localStorage に保存し、Anthropicへのリクエストにのみ使用。
//   mode "proxy"  : 本公開用。Cloudflare Worker などのプロキシ経由（キーはサーバー側）。
//                   proxyUrl に Worker のURLを入れて mode を "proxy" にするだけ。
// =====================================================================
const AI_CONFIG = {
  mode: "browser",            // "browser" | "proxy"
  proxyUrl: "",               // 例: "https://english-rpg.xxxx.workers.dev"
  model: "claude-opus-4-8",
  apiVersion: "2023-06-01",
  maxTokens: 600,
};
const API_KEY_STORE = "anthropic_api_key";
const getApiKey = () => localStorage.getItem(API_KEY_STORE) || "";
const setApiKey = (k) => localStorage.setItem(API_KEY_STORE, k);

// クエスト連動: 会話中に特定の条件を満たすと quest_flag が立つ
// { note: 英語の条件文, onFlag: 立ったとき呼ぶ関数 }
let questHook = null;
function aiReady() {
  return AI_CONFIG.mode === "proxy" ? !!AI_CONFIG.proxyUrl : !!getApiKey();
}

// ===== NPCペルソナ / 難易度 / 出力スキーマ（プロンプトはブラウザ側で構築）=====
const NPC_PERSONA = {
  innkeeper: "You are Marian, the warm and chatty innkeeper of a small fantasy town. You enjoy talking about food, cozy rooms, and the stories of travelers who pass through.",
  smith: "You are Borin, a gruff but kind-hearted blacksmith. You talk about weapons, armor, and slaying monsters. You respect brave adventurers.",
  bard: "You are Lyra, a cheerful traveling bard. You love rumors, songs, and tales about the distant Demon King the hero must defeat.",
};
const LEVEL_GUIDE = {
  500: "Use very simple words and short sentences (around CEFR A2 / TOEIC 500). Avoid difficult vocabulary and complex grammar.",
  700: "Use clear everyday and light business English (around CEFR B1-B2 / TOEIC 700).",
  900: "You may use rich vocabulary, idioms, and natural phrasing (around CEFR C1 / TOEIC 900).",
};
const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    reply_ja: { type: "string" },
    correction: {
      type: "object",
      properties: {
        natural: { type: "boolean" },
        corrected: { type: "string" },
        note_ja: { type: "string" },
      },
      required: ["natural", "corrected", "note_ja"],
      additionalProperties: false,
    },
    quest_flag: { type: "boolean" },
  },
  required: ["reply", "reply_ja", "correction", "quest_flag"],
  additionalProperties: false,
};
function buildSystem(npc, level, questNote) {
  const persona = NPC_PERSONA[npc.id] || NPC_PERSONA.innkeeper;
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[500];
  const shortName = npc.name.split(" ").pop();
  const questLine = questNote
    ? `Set "quest_flag" to true ONLY if ${questNote} In that case, your "reply" should follow that situation. In every other case, set "quest_flag" to false.`
    : `Always set "quest_flag" to false.`;
  return `${persona}

You are an NPC in a Dragon-Quest-style fantasy town. The person you are talking to is a Japanese learner practicing English conversation with you.

Behavior rules:
- Stay fully in character as ${shortName}. Never break character or mention that you are an AI.
- ${guide}
- Keep every reply to 1-2 short sentences, and usually end by asking the traveler a question so the conversation keeps going.
- If the traveler's message is a stage direction inside parentheses or asterisks (e.g. "(The traveler approaches you.)"), treat it as narration: just greet or react in character, and report the correction as natural with an empty note.
- IMPORTANT: you ONLY understand English. If the traveler's message is NOT in English (for example, it is in Japanese), you genuinely cannot understand it. Your "reply" must, in character and in ENGLISH, politely show that you don't understand and ask them to say it in English — do NOT answer, follow, or translate the content of a non-English message.
- If the message IS in English, gently check it for unnatural or incorrect parts and help them improve.

You MUST answer using the required JSON structure:
- "reply": your in-character response, in ENGLISH only.
- "reply_ja": a natural Japanese translation of your "reply".
- "correction.natural": true if the traveler wrote natural, correct English; false if their English was off OR if they did not write in English at all.
- "correction.corrected": the most natural English way to say what the traveler meant (use this to show them the English even when they wrote in Japanese). If their English was already natural, repeat their sentence as-is.
- "correction.note_ja": a short Japanese explanation (in Japanese). If they wrote in Japanese instead of English, explain that the people of this world only understand English and encourage them to try the English line in "corrected". If their English was just unnatural, explain what to fix. If it was already natural, give brief Japanese praise.
- "quest_flag": ${questLine}
Always write "reply_ja" and "note_ja" in Japanese.`;
}

// ===== Claude 呼び出し（mode により接続先を切り替え）=====
// 低レベル: 接続先を切り替えて Anthropic にPOSTし、生レスポンスを返す
async function postClaude(body) {
  let url, headers;
  if (AI_CONFIG.mode === "proxy") {
    if (!AI_CONFIG.proxyUrl) throw { code: "no_proxy" };
    url = AI_CONFIG.proxyUrl;
    headers = { "content-type": "application/json" };
  } else {
    const key = getApiKey();
    if (!key) throw { code: "no_key" };
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": AI_CONFIG.apiVersion,
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    throw { code: "http_" + r.status, status: r.status, detail };
  }
  return r.json();
}

// 町人との英会話(構造化出力: reply/添削/和訳/quest_flag)
async function callClaude(npc, level, messages) {
  const data = await postClaude({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: buildSystem(npc, level, questHook && questHook.note),
    messages,
  });
  if (data.stop_reason === "refusal") {
    return { reply: "...", reply_ja: "（うまく答えられないようだ）", correction: { natural: true, corrected: "", note_ja: "" }, quest_flag: false };
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// 相棒コトハに相談(日本語で回答する素のテキスト)
function buildKotohaSystem(level, context) {
  const lv = level === 900 ? "上級" : level === 700 ? "中級" : "初級";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公(日本語話者・英語学習中／レベルは${lv})の相棒です。
この世界の住人は英語しか話さない異世界。主人公だけがあなたを見て、日本語で話せます。

性格と話し方:
- 明るく元気で面倒見がいい。幼いけれどちょっとお姉さんぶる。語学にとても詳しい。
- 返事は必ず日本語。幼い女の子らしい親しみやすいタメ口で、簡潔に(2〜5文ほど)。相手を決して責めず励ます。

あなたの役割(相談に答える):
1. 「英語でどう言えばいい?」→ 自然な英語表現を教える。英語フレーズは "..." で囲み、意味や使い方を日本語で添える。
2. 町の人の英語や単語の意味を、やさしく解説する。
3. 冒険で困ったとき→ 世界観に沿ってヒントを出す(答えを全部は言わず、背中を押す)。
${context ? `\n参考: 主人公のいまの目的は「${context}」。これに沿ってヒントを出してね。` : ""}`;
}
async function callKotoha(level, context, messages) {
  const data = await postClaude({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: "low" },
    system: buildKotohaSystem(level, context),
    messages,
  });
  if (data.stop_reason === "refusal") return "（…うまく答えられないみたい。ごめんね）";
  const block = (data.content || []).find((b) => b.type === "text");
  return block ? block.text : "（うまく聞こえなかったみたい）";
}

// =====================================================================
// 会話オーバーレイ
// =====================================================================
const Chat = (() => {
  let opened = false;
  let npc = null, level = 500, onCloseCb = null;
  let history = [];
  let busy = false;
  let pendingStart = false; // キー入力待ちで開始を保留中か
  let convMode = "npc";     // "npc"(町人と英会話) | "kotoha"(コトハに相談)
  let kotohaContext = null; // コトハに渡す現在の目的など
  let sendLabel = "話す";
  let suspended = null;     // NPC会話を退避してコトハに切替えた時の保存先

  const overlay = document.getElementById("chat-overlay");
  const logEl = document.getElementById("chat-log");
  const nameEl = document.getElementById("chat-npc-name");
  const inputEl = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const closeBtn = document.getElementById("chat-close");
  const keyBtn = document.getElementById("chat-key");
  const helpBtn = document.getElementById("chat-help");
  const inputBar = document.getElementById("chat-inputbar");
  const keyPanel = document.getElementById("chat-apikey");
  const keyInput = document.getElementById("apikey-input");
  const keySave = document.getElementById("apikey-save");
  const keyCancel = document.getElementById("apikey-cancel");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function scrollBottom() { logEl.scrollTop = logEl.scrollHeight; }

  function addNpcLine(reply, replyJa) {
    const row = el("div", "chat-row npc");
    const bubble = el("div", "bubble npc-bubble");
    bubble.appendChild(el("span", "bubble-text", reply));

    const ja = el("div", "ja-text", replyJa);
    ja.style.display = "none";
    const exp = el("div", "exp-text");
    exp.style.display = "none";

    const btns = el("div", "bubble-btns");
    // 訳ボタン
    const trBtn = el("button", "tr-btn", "🔍 コトハに訳を聞く");
    trBtn.addEventListener("click", () => {
      const show = ja.style.display === "none";
      ja.style.display = show ? "block" : "none";
      trBtn.textContent = show ? "🔼 訳をかくす" : "🔍 コトハに訳を聞く";
    });
    // 解説ボタン(押すとコトハが詳しく解説)
    let expLoaded = false, expLoading = false;
    const exBtn = el("button", "tr-btn exp-btn", "📖 コトハに解説してもらう");
    exBtn.addEventListener("click", async () => {
      if (expLoading) return;
      if (expLoaded) {
        const show = exp.style.display === "none";
        exp.style.display = show ? "block" : "none";
        exBtn.textContent = show ? "🔼 解説をかくす" : "📖 コトハに解説してもらう";
        return;
      }
      expLoading = true; exBtn.textContent = "📖 コトハが考え中…";
      try {
        exp.textContent = await callExplain(reply);
        exp.style.display = "block";
        expLoaded = true; exBtn.textContent = "🔼 解説をかくす";
      } catch (err) {
        exp.textContent = "⚠ " + errorMessage(err);
        exp.style.display = "block";
        exBtn.textContent = "📖 もう一度解説";
      } finally { expLoading = false; scrollBottom(); }
    });
    btns.appendChild(trBtn); btns.appendChild(exBtn);
    bubble.appendChild(btns);

    row.appendChild(bubble);
    row.appendChild(ja);
    row.appendChild(exp);
    logEl.appendChild(row);
    scrollBottom();
  }

  // コトハに英文を詳しく解説してもらう(その文専用の単発リクエスト)
  async function callExplain(en) {
    return callKotoha(level, null, [{
      role: "user",
      content: `次の英文を、英語初心者の私にやさしく詳しく解説して。意味・使われている単語・文法のポイント・どんな場面で使うかも教えてね。読みやすく改行してOKだけど、** などの記号装飾は使わないでね：\n"${en}"`,
    }]);
  }
  function addPlayerLine(text) {
    const row = el("div", "chat-row me");
    row.appendChild(el("div", "bubble me-bubble", text));
    logEl.appendChild(row);
    scrollBottom();
  }
  function addCorrection(c) {
    if (!c) return;
    if (c.natural) {
      const box = el("div", "correction ok");
      box.appendChild(el("div", "corr-title", "✓ コトハ：自然な英語！"));
      if (c.note_ja) box.appendChild(el("div", "corr-note", c.note_ja));
      logEl.appendChild(box);
    } else {
      const box = el("div", "correction fix");
      box.appendChild(el("div", "corr-title", "✏️ コトハの添削"));
      if (c.corrected) {
        const line = el("div", "corr-fixed");
        line.appendChild(el("span", "corr-label", "→ "));
        line.appendChild(el("span", "corr-eng", c.corrected));
        box.appendChild(line);
      }
      if (c.note_ja) box.appendChild(el("div", "corr-note", c.note_ja));
      logEl.appendChild(box);
    }
    scrollBottom();
  }
  function addInfo(text) { logEl.appendChild(el("div", "chat-info", text)); scrollBottom(); }

  // コトハの返事(日本語の素テキスト。和訳ボタンなし)
  function addKotohaLine(text) {
    const row = el("div", "chat-row npc");
    const bubble = el("div", "bubble npc-bubble");
    bubble.appendChild(el("span", "bubble-text", text));
    row.appendChild(bubble);
    logEl.appendChild(row);
    scrollBottom();
  }

  function setBusy(b) {
    busy = b;
    inputEl.disabled = b;
    sendBtn.disabled = b;
    sendBtn.textContent = b ? "..." : sendLabel;
  }

  // ---- APIキー入力パネル ----
  function showKeyPanel() {
    keyInput.value = getApiKey();
    keyPanel.style.display = "block";
    logEl.style.display = "none";
    inputBar.style.display = "none";
    keyInput.focus();
  }
  function hideKeyPanel() {
    keyPanel.style.display = "none";
    logEl.style.display = "flex";
    inputBar.style.display = "flex";
  }
  keySave.addEventListener("click", () => {
    const k = keyInput.value.trim();
    if (!k) { keyInput.focus(); return; }
    setApiKey(k);
    if (window.refreshKeyBar) window.refreshKeyBar();
    hideKeyPanel();
    if (pendingStart) { pendingStart = false; startGreeting(); }
    inputEl.focus();
  });
  keyCancel.addEventListener("click", () => {
    hideKeyPanel();
    if (pendingStart) { pendingStart = false; addInfo("APIキーを入力すると会話できます（⚙ から設定）。"); }
  });
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); keySave.click(); }
    e.stopPropagation();
  });
  keyBtn.addEventListener("click", showKeyPanel);

  // ---- 「コトハにきく」⇄「会話にもどる」(NPC会話を保持したまま切替) ----
  function updateHelpBtn() {
    if (!helpBtn) return;
    if (suspended) { helpBtn.style.display = ""; helpBtn.textContent = "← もどる"; }
    else if (convMode === "npc") { helpBtn.style.display = ""; helpBtn.textContent = "🧚 コトハ"; }
    else { helpBtn.style.display = "none"; }
  }
  function suspendAndOpenKotoha() {
    // 今のNPC会話のログDOMを退避(添削や和訳ボタンごと保持)
    const frag = document.createDocumentFragment();
    while (logEl.firstChild) frag.appendChild(logEl.firstChild);
    suspended = { convMode, npc, history, frag, placeholder: inputEl.placeholder, sendLabel, name: nameEl.textContent, questHook };
    questHook = null;
    // コトハのサブ会話を開始
    convMode = "kotoha"; npc = { id: "kotoha", name: "コトハ" }; history = [];
    kotohaContext = (window.getKotohaContext && window.getKotohaContext()) || null;
    sendLabel = "きく";
    inputEl.placeholder = "コトハにきく…（日本語でOK）";
    nameEl.textContent = "コトハ"; inputEl.value = "";
    startGreeting();
    updateHelpBtn();
    inputEl.focus();
  }
  function resumeSuspended() {
    const s = suspended; suspended = null;
    convMode = s.convMode; npc = s.npc; history = s.history; sendLabel = s.sendLabel;
    questHook = s.questHook; kotohaContext = null;
    inputEl.placeholder = s.placeholder; nameEl.textContent = s.name;
    logEl.innerHTML = ""; logEl.appendChild(s.frag);
    updateHelpBtn(); scrollBottom();
    inputEl.value = ""; inputEl.focus();
  }
  if (helpBtn) helpBtn.addEventListener("click", () => {
    if (busy) return;
    if (suspended) resumeSuspended();
    else if (convMode === "npc") suspendAndOpenKotoha();
  });

  // ---- エラーを分かりやすい文言に ----
  function errorMessage(err) {
    const code = err && err.code;
    if (code === "no_key") { showKeyPanel(); return "APIキーが未設定です。⚙ から入力してください。"; }
    if (code === "no_proxy") return "プロキシURLが未設定です（本公開用のmode=proxy）。";
    if (code === "http_401") { showKeyPanel(); return "APIキーが無効です。⚙ から入力し直してください。"; }
    if (code === "http_429") return "混雑しています。少し待ってからもう一度送ってください。";
    if (code === "http_400") return "リクエストエラーが起きました（履歴をリセットするには ×とじる → もう一度話しかけてください）。";
    if (typeof code === "string" && code.startsWith("http_")) return "サーバーエラー（" + err.status + "）。少し待って再送してください。";
    if (code === "no_text") return "応答の解析に失敗しました。もう一度送ってください。";
    return "通信に失敗しました。ネット接続を確認してもう一度お試しください。";
  }

  async function turn(isOpening) {
    setBusy(true);
    const typing = el("div", "chat-info", `${npc.name.split(" ").pop()} は考えている…`);
    logEl.appendChild(typing); scrollBottom();
    try {
      if (convMode === "kotoha") {
        const reply = await callKotoha(level, kotohaContext, history);
        typing.remove();
        if (!reply || reply.trim() === "") throw { code: "no_text" };
        addKotohaLine(reply);
        history.push({ role: "assistant", content: reply });
      } else {
        const data = await callClaude(npc, level, history);
        typing.remove();
        if (!data || typeof data.reply !== "string" || data.reply.trim() === "") throw { code: "no_text" };
        if (!isOpening) addCorrection(data.correction);
        addNpcLine(data.reply, data.reply_ja || "");
        history.push({ role: "assistant", content: data.reply });
        // クエストフラグ判定(会話の中で条件を満たしたら発火)
        if (questHook && data.quest_flag === true) {
          const h = questHook; questHook = null;
          addInfo("コトハ「やった！ 素材屋さんがトイレから出てきたよ。話しかけて売ろう！」");
          if (h.onFlag) h.onFlag();
        }
      }
    } catch (err) {
      typing.remove();
      addInfo("⚠ " + errorMessage(err));
      // 失敗したユーザー発言は履歴から戻す（再送できるように。履歴を汚さない）
      if (!isOpening && history.length && history[history.length - 1].role === "user") history.pop();
    } finally {
      setBusy(false);
      if (opened && keyPanel.style.display === "none") inputEl.focus();
    }
  }

  function startGreeting() {
    if (convMode === "kotoha") {
      addKotohaLine("どうしたの、相棒？ 英語で何て言えばいいか、町の人の言葉の意味、冒険で困ったこと…なんでも聞いて！");
      return;
    }
    addInfo("コトハ「英語で話しかけてみて！ 変なところは私が直すから！」");
    history.push({ role: "user", content: "(The traveler walks up and greets you.)" });
    turn(true);
  }

  function sendUser() {
    if (busy) return;
    if (AI_CONFIG.mode === "browser" && !getApiKey()) { showKeyPanel(); return; }
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addPlayerLine(text);
    history.push({ role: "user", content: text });
    turn(false);
  }

  sendBtn.addEventListener("click", sendUser);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendUser(); }
    e.stopPropagation();
  });
  closeBtn.addEventListener("click", close);

  function open(npcObj, toeicLevel, onClose) {
    convMode = "npc"; kotohaContext = null; sendLabel = "話す";
    npc = npcObj; level = toeicLevel; onCloseCb = onClose || null;
    inputEl.placeholder = "英語で話す… (Enterで送信)";
    beginSession(npcObj.name);
  }

  // コトハに相談(日本語で答えてくれる)
  function openKotoha(toeicLevel, context, onClose) {
    convMode = "kotoha"; kotohaContext = context || null; sendLabel = "きく";
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = onClose || null;
    inputEl.placeholder = "コトハにきく…（日本語でOK・Enterで送信）";
    beginSession("コトハ");
  }

  function beginSession(title) {
    suspended = null;
    history = [];
    logEl.innerHTML = "";
    nameEl.textContent = title;
    overlay.style.display = "flex";
    opened = true;
    inputEl.value = "";
    hideKeyPanel();
    updateHelpBtn();
    if (AI_CONFIG.mode === "browser" && !getApiKey()) {
      pendingStart = true;
      showKeyPanel();
    } else {
      startGreeting();
    }
  }

  function close() {
    overlay.style.display = "none";
    opened = false;
    pendingStart = false;
    questHook = null;
    suspended = null;
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
  }

  return { open, openKotoha, close, isOpen: () => opened, aiReady, setQuest: (h) => { questHook = h; } };
})();

window.Chat = Chat;

// =====================================================================
// 画面上部のAPIキー入力バー（常時表示・localStorageに即保存）
// =====================================================================
(function initKeyBar() {
  const field = document.getElementById("apikey-field");
  const status = document.getElementById("apikey-status");
  const clearBtn = document.getElementById("apikey-clear");
  if (!field || !status) return;

  function refresh() {
    const has = getApiKey().trim().length > 0;
    if (has) {
      status.textContent = "🔑 マイキー使用中 — 自分のAnthropic APIキーでNPCとAI英会話できます。";
      status.className = "key-on";
    } else {
      status.textContent = "未設定 — 自分のAnthropic APIキーを入れるとNPCと英会話できます（キーはこの端末にのみ保存）。";
      status.className = "key-off";
    }
  }

  field.value = getApiKey();
  field.addEventListener("input", () => { setApiKey(field.value.trim()); refresh(); });
  field.addEventListener("keydown", (e) => e.stopPropagation()); // ゲーム操作にキーを奪われない
  clearBtn.addEventListener("click", () => {
    field.value = "";
    setApiKey("");
    refresh();
    field.focus();
  });

  // チャット内パネルなど他所から保存されたとき同期できるよう公開
  window.refreshKeyBar = () => { field.value = getApiKey(); refresh(); };
  refresh();
})();
