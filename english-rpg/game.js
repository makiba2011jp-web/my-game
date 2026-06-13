"use strict";

// ===== 基本セットアップ =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = 480, H = 480;
const TILE = 32, MAP_N = 15;
ctx.imageSmoothingEnabled = false;

// ===== ゲーム状態 =====
const STATE = { TITLE: "title", FIELD: "field", TOWN: "town", BATTLE: "battle", MESSAGE: "message", QUIZ: "quiz", GAMEOVER: "gameover", CLEAR: "clear" };
let state = STATE.TITLE;

// プレイヤー
const player = {
  tx: 2, ty: 12, px: 2 * TILE, py: 12 * TILE,
  dir: "down", moving: false, anim: 0,
  level: 1, hp: 20, maxhp: 20, atk: 6, exp: 0, nextExp: 10,
  wins: 0,
};

let toeicLevel = 500;     // 選択された難易度
let stepsToEncounter = 0; // エンカウントまでの歩数

// マップ (T=木 W=水 G=草 O=町 C=城/魔王)
const MAP = [
  "TTTTTTTTTTTTTTT",
  "TGGGGGGGGGGGGGT",
  "TGGGTTTGGGGGGGT",
  "TGGGTGGGGGWWGGT",
  "TGGGGGGGGGWWGGT",
  "TGGOGGGGGGGGGGT",
  "TGGGGGGGTTGGGGT",
  "TGGGGGGGTGGGGGT",
  "TGGGGGGGGGGGGGT",
  "TGGWWGGGGGGGGGT",
  "TGGWWGGGGGTTGGT",
  "TGGGGGGGGGTGGGT",
  "TGGGGGGGGGGGGGT",
  "TGGGGGGGGGGGGCT",
  "TTTTTTTTTTTTTTT",
];
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_N || ty >= MAP_N) return "T";
  return MAP[ty][tx];
}
function walkable(tx, ty) {
  const t = tileAt(tx, ty);
  return t !== "T" && t !== "W";
}

// ===== 街(タウン)内部 =====
// #=壁 .=床 D=出口の扉
const TOWN_MAP = [
  "###############",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.....###.....#",
  "#.....#.#.....#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#......D......#",
  "###############",
];
// 街のNPC(位置とAI会話用のID)
const TOWN_NPCS = [
  { id: "innkeeper", name: "宿屋の女将 Marian", tx: 3, ty: 3, color: "#e0a060" },
  { id: "smith", name: "武器屋の店主 Borin", tx: 11, ty: 3, color: "#9098b0" },
  { id: "bard", name: "吟遊詩人 Lyra", tx: 7, ty: 5, color: "#6ab0e0" },
];
let savedOverworld = { tx: 2, ty: 12 }; // 街に入る前のフィールド座標
function tileAtTown(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_N || ty >= MAP_N) return "#";
  return TOWN_MAP[ty][tx];
}
function npcAt(tx, ty) {
  return TOWN_NPCS.find((n) => n.tx === tx && n.ty === ty) || null;
}
function townWalkable(tx, ty) {
  return tileAtTown(tx, ty) !== "#" && !npcAt(tx, ty);
}

// ===== メッセージ / バトル状態 =====
let messageLines = [];     // 表示中メッセージ
let messageAfter = null;   // メッセージ確定後に呼ぶ関数
let battle = null;         // 現在の戦闘オブジェクト
let menuSel = 0;           // 選択カーソル
let flash = 0;             // ダメージ点滅用
let messageSpeaker = null; // メッセージの話者名(カットシーン用)
let cutsceneDraw = null;   // カットシーン中の背景描画関数
let cutsceneSteps = null, cutsceneIndex = 0, cutsceneOnDone = null;
let quiz = null;           // チュートリアル等の選択クイズ
let gameTime = 0;          // 経過時間(コトハの浮遊などの演出用)

// ===== 敵テンプレート =====
const ENEMIES = [
  { name: "スライム",   hp: 12, atk: 3, exp: 5,  color: "#3fbf6f" },
  { name: "おおコウモリ", hp: 16, atk: 4, exp: 7,  color: "#7a5ad6" },
  { name: "ゴースト",   hp: 20, atk: 5, exp: 9,  color: "#9fd6e6" },
  { name: "アーマー兵", hp: 28, atk: 6, exp: 12, color: "#b0b0c0" },
];
const BOSS = { name: "まおう", hp: 60, atk: 9, exp: 0, color: "#c0392b", boss: true };

// ===== 入力 =====
const keys = {};
window.addEventListener("keydown", (e) => {
  if (window.Chat && Chat.isOpen()) return; // 会話中はゲーム操作を止める(入力欄優先)
  const k = normalizeKey(e.key);
  if (["up", "down", "left", "right", "confirm"].includes(k)) e.preventDefault();
  if (!keys[k]) onInput(k);
  keys[k] = true;
});
window.addEventListener("keyup", (e) => { keys[normalizeKey(e.key)] = false; });
function normalizeKey(key) {
  switch (key) {
    case "ArrowUp": case "w": case "W": return "up";
    case "ArrowDown": case "s": case "S": return "down";
    case "ArrowLeft": case "a": case "A": return "left";
    case "ArrowRight": case "d": case "D": return "right";
    case "Enter": case " ": case "z": case "Z": return "confirm";
    case "x": case "X": case "Escape": return "cancel";
  }
  return key;
}

// 十字キー(モバイル)
document.querySelectorAll(".dbtn").forEach((b) => {
  b.addEventListener("touchstart", (e) => { e.preventDefault(); if (!Chat.isOpen()) onInput(b.dataset.dir); }, { passive: false });
  b.addEventListener("mousedown", (e) => { e.preventDefault(); if (!Chat.isOpen()) onInput(b.dataset.dir); });
});

// Canvasタップ: 状態に応じて確定/選択
canvas.addEventListener("pointerdown", (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  onTap(x, y);
});

// ===== 入力ハンドラ =====
function onInput(k) {
  if (state === STATE.TITLE) {
    if (k === "up") menuSel = (menuSel + 2) % 3;
    else if (k === "down") menuSel = (menuSel + 1) % 3;
    else if (k === "confirm") startGame([500, 700, 900][menuSel]);
    return;
  }
  if (state === STATE.FIELD) {
    if (["up", "down", "left", "right"].includes(k)) tryMove(k);
    return;
  }
  if (state === STATE.TOWN) {
    if (["up", "down", "left", "right"].includes(k)) tryMove(k);
    else if (k === "confirm") tryTalk();
    return;
  }
  if (state === STATE.MESSAGE) {
    if (k === "confirm" || k === "cancel") advanceMessage();
    return;
  }
  if (state === STATE.QUIZ && quiz) {
    if (k === "up") quiz.sel = (quiz.sel + 3) % 4;
    else if (k === "down") quiz.sel = (quiz.sel + 1) % 4;
    else if (k === "left" || k === "right") quiz.sel = (quiz.sel + 2) % 4;
    else if (k === "confirm") answerQuiz(quiz.sel);
    return;
  }
  if (state === STATE.BATTLE && battle.phase === "select") {
    if (k === "up") menuSel = (menuSel + 3) % 4;
    else if (k === "down") menuSel = (menuSel + 1) % 4;
    else if (k === "left") menuSel = (menuSel + 2) % 4;
    else if (k === "right") menuSel = (menuSel + 2) % 4;
    else if (k === "confirm") chooseAnswer(menuSel);
    return;
  }
  if (state === STATE.GAMEOVER || state === STATE.CLEAR) {
    if (k === "confirm") { state = STATE.TITLE; menuSel = 0; }
    return;
  }
}

function onTap(x, y) {
  if (Chat.isOpen()) return;
  if (state === STATE.TOWN) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const n = npcAt(tx, ty);
    if (n) talkToNPC(n);
    return;
  }
  if (state === STATE.TITLE) {
    // 3つのボタン領域
    for (let i = 0; i < 3; i++) {
      const by = 250 + i * 56;
      if (y >= by && y <= by + 46) { menuSel = i; startGame([500, 700, 900][i]); return; }
    }
    return;
  }
  if (state === STATE.MESSAGE) { advanceMessage(); return; }
  if (state === STATE.QUIZ && quiz) {
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const bx = 16 + col * 232, by = 312 + row * 76;
      if (x >= bx && x <= bx + 216 && y >= by && y <= by + 64) { answerQuiz(i); return; }
    }
    return;
  }
  if (state === STATE.BATTLE && battle.phase === "select") {
    // 4択ボタン領域(下半分2x2)
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const bx = 16 + col * 232, by = 312 + row * 76;
      if (x >= bx && x <= bx + 216 && y >= by && y <= by + 64) { chooseAnswer(i); return; }
    }
    return;
  }
  if (state === STATE.GAMEOVER || state === STATE.CLEAR) { state = STATE.TITLE; menuSel = 0; }
}

// ===== ゲーム開始 =====
function startGame(level) {
  toeicLevel = level;
  player.tx = 2; player.ty = 12; player.px = 2 * TILE; player.py = 12 * TILE;
  player.dir = "down"; player.moving = false;
  player.level = 1; player.maxhp = 20; player.hp = 20; player.atk = 6;
  player.exp = 0; player.nextExp = 10; player.wins = 0;
  resetEncounter();
  startOpening();
}

function resetEncounter() { stepsToEncounter = 4 + Math.floor(rnd() * 6); }

// ===== フィールド移動 =====
function tryMove(dir) {
  if (player.moving) return;
  player.dir = dir;
  let nx = player.tx, ny = player.ty;
  if (dir === "up") ny--; else if (dir === "down") ny++;
  else if (dir === "left") nx--; else if (dir === "right") nx++;
  const ok = state === STATE.TOWN ? townWalkable(nx, ny) : walkable(nx, ny);
  if (!ok) return;
  player.moving = true;
  player.targetX = nx; player.targetY = ny;
}

// 街内で正面のNPCに話しかける
function tryTalk() {
  let fx = player.tx, fy = player.ty;
  if (player.dir === "up") fy--; else if (player.dir === "down") fy++;
  else if (player.dir === "left") fx--; else if (player.dir === "right") fx++;
  const n = npcAt(fx, fy);
  if (n) talkToNPC(n);
}

function talkToNPC(npc) {
  for (const k in keys) keys[k] = false; // 移動キーが残らないように
  Chat.open(npc, toeicLevel, () => { /* 会話終了後は街に留まる */ });
}

function enterTown() {
  savedOverworld = { tx: player.tx, ty: player.ty };
  player.tx = 7; player.ty = 12; player.px = 7 * TILE; player.py = 12 * TILE;
  player.dir = "up"; player.moving = false;
  state = STATE.TOWN;
}

function leaveTown() {
  player.tx = savedOverworld.tx; player.ty = savedOverworld.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "down"; player.moving = false;
  player.hp = player.maxhp; // 宿で休んで全回復
  showMessage(["宿屋でやすんだ。", "HPが ぜんかい した！"], () => { state = STATE.FIELD; });
}

function onArrive() {
  player.tx = player.targetX; player.ty = player.targetY;
  if (state === STATE.TOWN) {
    if (tileAtTown(player.tx, player.ty) === "D") leaveTown();
    return;
  }
  const t = tileAt(player.tx, player.ty);
  if (t === "O") { // 町に入る
    enterTown();
    return;
  }
  if (t === "C") { // 城: 魔王戦
    if (player.level < 3) {
      showMessage(["城の門は かたく とざされている。", "(レベル3以上で 魔王に いどめる)"], () => { state = STATE.FIELD; });
    } else {
      startBattle(true);
    }
    return;
  }
  // 草むらエンカウント
  if (t === "G") {
    stepsToEncounter--;
    if (stepsToEncounter <= 0) { resetEncounter(); startBattle(false); }
  }
}

// ===== バトル =====
function pickWord() {
  const pool = WORD_DATA[toeicLevel];
  const w = pool[Math.floor(rnd() * pool.length)];
  const choices = shuffle([w.ja, ...w.wrong]);
  return { en: w.en, ja: w.ja, choices, answer: choices.indexOf(w.ja) };
}

function startBattle(isBoss) {
  // 勝利数が増えるほど強い敵も出るように、出現範囲を広げる
  const range = Math.min(ENEMIES.length, 2 + Math.floor(player.wins / 2));
  const src = isBoss ? BOSS : ENEMIES[Math.floor(rnd() * range)];
  battle = {
    isBoss,
    name: src.name, color: src.color,
    ehp: src.hp, emaxhp: src.hp, eatk: src.atk, exp: src.exp,
    phase: "intro", word: null, log: "",
    shake: 0, ehurt: 0, phurt: 0,
  };
  menuSel = 0;
  showMessage([`${battle.name} が あらわれた！`], () => { nextQuestion(); });
}

function nextQuestion() {
  battle.word = pickWord();
  battle.phase = "select";
  menuSel = 0;
  state = STATE.BATTLE;
}

function chooseAnswer(idx) {
  if (battle.phase !== "select") return;
  battle.phase = "resolve";
  const correct = idx === battle.word.answer;
  if (correct) {
    const dmg = player.atk + Math.floor(rnd() * 4);
    battle.ehp = Math.max(0, battle.ehp - dmg);
    battle.ehurt = 12; battle.shake = 8;
    state = STATE.BATTLE;
    queueResolve([`せいかい！ "${battle.word.en}" = ${battle.word.ja}`, `${battle.name}に ${dmg} のダメージ！`], () => {
      if (battle.ehp <= 0) return winBattle();
      enemyTurnOrNext();
    });
  } else {
    const dmg = battle.eatk + Math.floor(rnd() * 3);
    player.hp = Math.max(0, player.hp - dmg);
    battle.phurt = 12;
    state = STATE.BATTLE;
    queueResolve([`ざんねん… "${battle.word.en}" は ${battle.word.ja}`, `${battle.name}の こうげき！ ${dmg} のダメージ！`], () => {
      if (player.hp <= 0) return loseBattle();
      nextQuestion();
    });
  }
}

// 正解後、ときどき敵の反撃を挟む
function enemyTurnOrNext() {
  if (battle.isBoss && rnd() < 0.5) {
    const dmg = battle.eatk + Math.floor(rnd() * 3);
    player.hp = Math.max(0, player.hp - dmg);
    battle.phurt = 12;
    queueResolve([`${battle.name}の はんげき！ ${dmg} のダメージ！`], () => {
      if (player.hp <= 0) return loseBattle();
      nextQuestion();
    });
  } else {
    nextQuestion();
  }
}

function winBattle() {
  player.wins++;
  player.exp += battle.exp;
  const lines = [`${battle.name}を たおした！`];
  if (!battle.isBoss) lines.push(`けいけんち ${battle.exp} を かくとく！`);
  // レベルアップ判定
  let leveled = [];
  while (player.exp >= player.nextExp && !battle.isBoss) {
    player.exp -= player.nextExp;
    player.level++;
    player.maxhp += 6; player.hp = player.maxhp; player.atk += 2;
    player.nextExp = Math.floor(player.nextExp * 1.6);
    leveled.push(`レベル ${player.level} に あがった！ (HP/攻撃 アップ)`);
  }
  const wasBoss = battle.isBoss;
  showMessage([...lines, ...leveled], () => {
    battle = null;
    if (wasBoss) { state = STATE.CLEAR; }
    else { state = STATE.FIELD; }
  });
}

function loseBattle() {
  showMessage([`${battle.name}に やられてしまった…`], () => { battle = null; state = STATE.GAMEOVER; });
}

// resolve用: メッセージ後にコールバック
function queueResolve(lines, after) { showMessage(lines, after); }

// ===== メッセージ表示 =====
let msgQueue = [];
function showMessage(lines, after, speaker) {
  msgQueue = lines.slice();
  messageLines = [msgQueue.shift()];
  messageAfter = after;
  messageSpeaker = speaker || null;
  state = STATE.MESSAGE;
}
function advanceMessage() {
  if (msgQueue.length > 0) { messageLines.push(msgQueue.shift()); if (messageLines.length > 3) messageLines.shift(); return; }
  const after = messageAfter; messageAfter = null;
  if (after) after();
}

// ===== 乱数(軽い擬似乱数, Date.now非依存) =====
let _seed = (Date.now() & 0x7fffffff) || 123456789;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== 更新ループ =====
let last = 0;
function loop(t) {
  const dt = Math.min(40, t - last); last = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
function update(dt) {
  gameTime += dt;
  if (quiz && quiz.wrong > 0) quiz.wrong -= dt * 0.05;
  if (state === STATE.FIELD || state === STATE.TOWN || (player.moving)) {
    if (player.moving) {
      const speed = 0.18 * dt;
      const dx = player.targetX * TILE - player.px;
      const dy = player.targetY * TILE - player.py;
      const dist = Math.hypot(dx, dy);
      if (dist <= speed) {
        player.px = player.targetX * TILE; player.py = player.targetY * TILE;
        player.moving = false; onArrive();
      } else {
        player.px += (dx / dist) * speed; player.py += (dy / dist) * speed;
        player.anim += dt;
      }
    }
    // 押しっぱなしで連続移動
    if ((state === STATE.FIELD || state === STATE.TOWN) && !player.moving && !Chat.isOpen()) {
      if (keys.up) tryMove("up"); else if (keys.down) tryMove("down");
      else if (keys.left) tryMove("left"); else if (keys.right) tryMove("right");
    }
  }
  if (battle) {
    if (battle.shake > 0) battle.shake -= dt * 0.05;
    if (battle.ehurt > 0) battle.ehurt -= dt * 0.05;
    if (battle.phurt > 0) battle.phurt -= dt * 0.05;
  }
}

// ===== 描画 =====
function render() {
  ctx.clearRect(0, 0, W, H);
  switch (state) {
    case STATE.TITLE: drawTitle(); break;
    case STATE.FIELD: drawField(); break;
    case STATE.TOWN: drawTown(); break;
    case STATE.MESSAGE:
      if (cutsceneDraw) cutsceneDraw(); else if (battle) drawBattleScene(); else drawField();
      drawMessageWindow();
      break;
    case STATE.QUIZ:
      if (cutsceneDraw) cutsceneDraw(); else drawField();
      drawQuizUI();
      break;
    case STATE.BATTLE: drawBattleScene(); drawBattleUI(); break;
    case STATE.GAMEOVER: drawEnd("ゲームオーバー", "#c0392b"); break;
    case STATE.CLEAR: drawEnd("魔王をたおした！ クリア！", "#f1c40f"); break;
  }
}

function drawTitle() {
  // 背景
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "bold 42px 'MS Gothic', monospace";
  ctx.fillText("英単語クエスト", W / 2, 110);
  ctx.font = "16px 'MS Gothic', monospace";
  ctx.fillStyle = "#9fd6ff";
  ctx.fillText("〜 ドラクエ風 英語学習RPG 〜", W / 2, 150);
  ctx.fillStyle = "#fff";
  ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillText("難易度(TOEICレベル)を えらんでね", W / 2, 215);
  const labels = ["TOEIC 500  (中学〜やさしめ)", "TOEIC 700  (ビジネス標準)", "TOEIC 900  (上級)"];
  for (let i = 0; i < 3; i++) {
    const by = 250 + i * 56;
    drawWindow(70, by, 340, 46, menuSel === i);
    ctx.fillStyle = "#fff";
    ctx.font = "16px 'MS Gothic', monospace";
    ctx.fillText(labels[i], W / 2, by + 29);
  }
  ctx.fillStyle = "#8aa";
  ctx.font = "12px 'MS Gothic', monospace";
  ctx.fillText("↑↓で選択 / Enter・タップで決定", W / 2, 445);
}

function drawField() {
  // タイル
  for (let y = 0; y < MAP_N; y++) {
    for (let x = 0; x < MAP_N; x++) {
      drawTile(MAP[y][x], x * TILE, y * TILE);
    }
  }
  // プレイヤー
  drawHero(player.px, player.py, player.dir, player.anim);
  // HUD
  drawHud();
}

function drawTile(t, x, y) {
  // 草ベース
  ctx.fillStyle = "#2e7d32"; ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#338a37";
  ctx.fillRect(x + 4, y + 6, 3, 3); ctx.fillRect(x + 20, y + 14, 3, 3); ctx.fillRect(x + 12, y + 24, 3, 3);
  if (t === "T") { // 木
    ctx.fillStyle = "#1b5e20"; ctx.fillRect(x + 6, y + 4, 20, 18);
    ctx.fillStyle = "#2e7d32"; ctx.fillRect(x + 9, y + 7, 14, 10);
    ctx.fillStyle = "#5d4037"; ctx.fillRect(x + 13, y + 20, 6, 8);
  } else if (t === "W") { // 水
    ctx.fillStyle = "#1565c0"; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#42a5f5"; ctx.fillRect(x + 4, y + 8, 8, 3); ctx.fillRect(x + 18, y + 18, 8, 3);
  } else if (t === "O") { // 町
    ctx.fillStyle = "#8d6e63"; ctx.fillRect(x + 5, y + 12, 22, 16);
    ctx.fillStyle = "#d32f2f"; ctx.fillRect(x + 3, y + 6, 26, 8);
    ctx.fillStyle = "#ffca28"; ctx.fillRect(x + 13, y + 18, 6, 10);
  } else if (t === "C") { // 城/魔王
    ctx.fillStyle = "#4a148c"; ctx.fillRect(x + 3, y + 8, 26, 20);
    ctx.fillStyle = "#7b1fa2"; ctx.fillRect(x + 3, y + 4, 5, 6); ctx.fillRect(x + 13, y + 2, 5, 8); ctx.fillRect(x + 24, y + 4, 5, 6);
    ctx.fillStyle = "#000"; ctx.fillRect(x + 13, y + 18, 6, 10);
  }
}

function drawHero(px, py, dir, anim) {
  const x = px, y = py;
  const bob = player.moving && (Math.floor(anim / 120) % 2 === 0) ? 1 : 0;
  // 体(マント青)
  ctx.fillStyle = "#1e3a8a"; ctx.fillRect(x + 8, y + 14 + bob, 16, 12);
  // 頭(肌)
  ctx.fillStyle = "#f5c98a"; ctx.fillRect(x + 10, y + 6 + bob, 12, 10);
  // 髪
  ctx.fillStyle = "#5d4037"; ctx.fillRect(x + 9, y + 4 + bob, 14, 4);
  // 足
  ctx.fillStyle = "#3e2723"; ctx.fillRect(x + 10, y + 26 + bob, 5, 4); ctx.fillRect(x + 17, y + 26 + bob, 5, 4);
  // 向き(目印)
  ctx.fillStyle = "#fff";
  if (dir === "down") { ctx.fillRect(x + 12, y + 11 + bob, 2, 2); ctx.fillRect(x + 18, y + 11 + bob, 2, 2); }
  else if (dir === "up") { ctx.fillStyle = "#5d4037"; ctx.fillRect(x + 10, y + 6 + bob, 12, 6); }
  else if (dir === "left") { ctx.fillRect(x + 11, y + 11 + bob, 2, 2); }
  else if (dir === "right") { ctx.fillRect(x + 19, y + 11 + bob, 2, 2); }
}

function drawHud() {
  drawWindow(8, 8, 180, 60, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(`Lv ${player.level}   TOEIC${toeicLevel}`, 20, 30);
  ctx.fillText(`HP ${player.hp}/${player.maxhp}`, 20, 50);
  ctx.textAlign = "center";
}

// ===== 街の描画 =====
function drawTown() {
  for (let y = 0; y < MAP_N; y++) {
    for (let x = 0; x < MAP_N; x++) {
      const t = TOWN_MAP[y][x];
      const px = x * TILE, py = y * TILE;
      if (t === "#") {
        ctx.fillStyle = "#5a4636"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "#6b5340"; ctx.fillRect(px + 2, py + 2, TILE - 4, 6);
      } else if (t === "D") {
        ctx.fillStyle = "#caa46a"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "#7a4a22"; ctx.fillRect(px + 8, py + 4, 16, 24);
        ctx.fillStyle = "#ffd24a"; ctx.fillRect(px + 19, py + 16, 3, 3);
      } else {
        ctx.fillStyle = "#caa46a"; ctx.fillRect(px, py, TILE, TILE); // 床(木目)
        ctx.fillStyle = "#bd965d"; ctx.fillRect(px, py + TILE - 4, TILE, 4);
      }
    }
  }
  // 出口の案内
  ctx.fillStyle = "#7a4a22"; ctx.textAlign = "center";
  ctx.font = "11px 'MS Gothic', monospace";
  ctx.fillText("でぐち", 7 * TILE + TILE / 2, 13 * TILE - 2);

  // NPC
  for (const n of TOWN_NPCS) drawNPC(n);
  // プレイヤー
  drawHero(player.px, player.py, player.dir, player.anim);

  drawHud();
  // 操作ヒント
  drawWindow(60, 430, 360, 42, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "12px 'MS Gothic', monospace";
  ctx.fillText("人に近づいて Z / 人をタップ で英会話", W / 2, 456);
}

function drawNPC(n) {
  const x = n.tx * TILE, y = n.ty * TILE;
  // 体
  ctx.fillStyle = n.color; ctx.fillRect(x + 8, y + 14, 16, 14);
  // 頭
  ctx.fillStyle = "#f5c98a"; ctx.fillRect(x + 10, y + 6, 12, 10);
  // 髪
  ctx.fillStyle = "#3a2a1a"; ctx.fillRect(x + 9, y + 4, 14, 4);
  // 目
  ctx.fillStyle = "#000"; ctx.fillRect(x + 12, y + 10, 2, 2); ctx.fillRect(x + 18, y + 10, 2, 2);
  // 会話マーク
  ctx.fillStyle = "#fff"; ctx.fillRect(x + 22, y - 4, 10, 8);
  ctx.fillStyle = "#1a3a6b"; ctx.font = "8px 'MS Gothic', monospace"; ctx.textAlign = "center";
  ctx.fillText("!", x + 27, y + 2);
  ctx.textAlign = "center";
}

function drawBattleScene() {
  // 背景(暗い草原)
  ctx.fillStyle = "#0b2e13"; ctx.fillRect(0, 0, W, H / 2 + 20);
  ctx.fillStyle = "#06121f"; ctx.fillRect(0, H / 2 + 20, W, H / 2);
  // 敵
  const sx = (battle.shake > 0) ? (Math.floor(rnd() * 7) - 3) : 0;
  const ex = W / 2 + sx;
  const flashEnemy = battle.ehurt > 0 && (Math.floor(battle.ehurt) % 2 === 0);
  drawEnemy(ex, 150, battle.color, battle.isBoss, flashEnemy);
  // 敵HPバー
  drawWindow(120, 40, 240, 50, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillText(battle.name, 134, 62);
  drawBar(134, 70, 212, 10, battle.ehp / battle.emaxhp, "#e74c3c");
  ctx.textAlign = "center";
  // プレイヤーHUD(被弾点滅)
  if (battle.phurt > 0 && Math.floor(battle.phurt) % 2 === 0) { ctx.fillStyle = "rgba(200,0,0,0.25)"; ctx.fillRect(0, 0, W, H); }
}

function drawBattleUI() {
  // 出題ウィンドウ
  drawWindow(16, 250, 448, 54, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText("この英単語の意味は？", W / 2, 270);
  ctx.font = "bold 26px 'MS Gothic', monospace";
  ctx.fillStyle = "#ffe082";
  ctx.fillText(battle.word.en, W / 2, 297);
  // 4択
  ctx.font = "16px 'MS Gothic', monospace";
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const bx = 16 + col * 232, by = 312 + row * 76;
    drawWindow(bx, by, 216, 64, menuSel === i);
    ctx.fillStyle = "#fff";
    ctx.fillText(battle.word.choices[i], bx + 108, by + 39);
  }
  // プレイヤーHP小表示
  ctx.textAlign = "left"; ctx.font = "13px 'MS Gothic', monospace"; ctx.fillStyle = "#fff";
  ctx.fillText(`勇者 HP ${player.hp}/${player.maxhp}`, 20, 244);
  ctx.textAlign = "center";
}

function drawEnemy(cx, cy, color, isBoss, flash) {
  const s = isBoss ? 1.7 : 1.0;
  const w = 70 * s, h = 60 * s;
  ctx.save();
  if (flash) ctx.globalAlpha = 0.4;
  // 体
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx - 16 * s, cy - 8 * s, 10 * s, 12 * s);
  ctx.fillRect(cx + 6 * s, cy - 8 * s, 10 * s, 12 * s);
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - 12 * s, cy - 4 * s, 5 * s, 6 * s);
  ctx.fillRect(cx + 9 * s, cy - 4 * s, 5 * s, 6 * s);
  if (isBoss) { // 角
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.moveTo(cx - w / 2, cy - h / 2 + 6); ctx.lineTo(cx - w / 2 - 14, cy - h / 2 - 18); ctx.lineTo(cx - w / 2 + 12, cy - h / 2 - 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + w / 2, cy - h / 2 + 6); ctx.lineTo(cx + w / 2 + 14, cy - h / 2 - 18); ctx.lineTo(cx + w / 2 - 12, cy - h / 2 - 6); ctx.fill();
  }
  ctx.restore();
}

function drawMessageWindow() {
  if (messageSpeaker) {
    ctx.font = "14px 'MS Gothic', monospace";
    const w = ctx.measureText(messageSpeaker).width + 28;
    drawWindow(16, 330, w, 28, false);
    ctx.fillStyle = "#ffe082"; ctx.textAlign = "left";
    ctx.fillText(messageSpeaker, 30, 349);
    ctx.textAlign = "center";
  }
  drawWindow(16, 360, 448, 104, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.font = "16px 'MS Gothic', monospace";
  for (let i = 0; i < messageLines.length; i++) {
    ctx.fillText(messageLines[i], 36, 392 + i * 26);
  }
  // 続き▼
  ctx.fillStyle = "#ffe082"; ctx.textAlign = "right";
  ctx.font = "14px 'MS Gothic', monospace";
  ctx.fillText("▼ (Enter/タップ)", 452, 456);
  ctx.textAlign = "center";
}

// ===== カットシーン(会話劇) =====
function playCutscene(steps, onDone) {
  cutsceneSteps = steps; cutsceneIndex = 0; cutsceneOnDone = onDone || null;
  advanceCutscene();
}
function advanceCutscene() {
  if (!cutsceneSteps || cutsceneIndex >= cutsceneSteps.length) {
    cutsceneSteps = null;
    const d = cutsceneOnDone; cutsceneOnDone = null;
    if (d) d();
    return;
  }
  const step = cutsceneSteps[cutsceneIndex++];
  if (step.action) step.action();
  if (step.quiz) {
    askQuiz(step.quiz, advanceCutscene);
  } else {
    showMessage(step.lines, advanceCutscene, step.who);
  }
}

// ===== クイズ(チュートリアル等の選択) =====
function askQuiz(q, onCorrect) {
  quiz = { en: q.en, question: q.q, choices: q.choices, answer: q.answer, sel: 0, wrong: 0, onCorrect };
  state = STATE.QUIZ;
}
function answerQuiz(idx) {
  if (!quiz) return;
  if (idx === quiz.answer) {
    const cb = quiz.onCorrect; quiz = null;
    if (cb) cb();
  } else {
    quiz.sel = idx; quiz.wrong = 14; // 不正解: フラッシュして再挑戦(チュートリアルなので減点なし)
  }
}
function drawQuizUI() {
  drawWindow(16, 250, 448, 54, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(quiz.question, W / 2, 270);
  ctx.font = "bold 26px 'MS Gothic', monospace"; ctx.fillStyle = "#ffe082";
  ctx.fillText(quiz.en, W / 2, 297);
  ctx.font = "15px 'MS Gothic', monospace";
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const bx = 16 + col * 232, by = 312 + row * 76;
    drawWindow(bx, by, 216, 64, quiz.sel === i);
    ctx.fillStyle = "#fff";
    ctx.fillText(quiz.choices[i], bx + 108, by + 39);
  }
  if (quiz.wrong > 0) {
    ctx.fillStyle = "#ff9a9a"; ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText("コトハ「ちがうみたい。もう一度！」", W / 2, 466);
  }
}

// ===== オープニング(転生→コトハ→チュートリアル) =====
function startOpening() {
  cutsceneDraw = drawIntroScene;
  playCutscene([
    { who: null, lines: ["……ん？ ここ、どこ？", "さっきまで家にいたはずなのに…？"] },
    { who: "村人？", lines: ["Help! My dog is lost!"] },
    { who: null, lines: ["(ぜんぜん分からない…！ 何語…？)"] },
    { who: "コトハ", lines: ["やっと起きた！ キミ、転生しちゃったみたいだね。", "私はコトハ、言葉の精霊！", "安心して、私が通訳するから！"] },
    { who: "コトハ", lines: ["この世界の人は英語しか話さないの。", "でも大丈夫、いっしょに少しずつ覚えよう。", "まずは大事な単語をひとつ！"] },
    { quiz: { en: "lost", q: "コトハ「\"lost\" ってどういう意味だと思う？」", choices: ["なくした・いなくなった", "見つけた", "食べた", "ねむった"], answer: 0 } },
    { who: "コトハ", lines: ["正解！ \"lost\" は『なくした・いなくなった』。", "じゃあ、さっきの村人の言葉をもう一度…"] },
    { who: "コトハ", lines: ["『助けて！ 犬がいなくなったの！』だって。", "ね？ 言葉が分かると世界が広がるでしょ？"] },
    { who: "コトハ", lines: ["元の世界に帰る手がかりも、きっと人との会話の中にある。", "さ、冒険のはじまり！ 行こう、相棒！"] },
  ], () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.FIELD; });
}

function drawActor(x, y, fn) {
  ctx.save(); ctx.translate(x, y); ctx.scale(2, 2); fn(); ctx.restore();
}
function drawPerson(body, hair) {
  ctx.fillStyle = body; ctx.fillRect(8, 14, 16, 14);
  ctx.fillStyle = "#f5c98a"; ctx.fillRect(10, 6, 12, 10);
  ctx.fillStyle = hair || "#5d4037"; ctx.fillRect(9, 4, 14, 4);
  ctx.fillStyle = "#000"; ctx.fillRect(12, 11, 2, 2); ctx.fillRect(18, 11, 2, 2);
  ctx.fillStyle = "#3e2723"; ctx.fillRect(10, 28, 5, 4); ctx.fillRect(17, 28, 5, 4);
}
function drawKotoha(cx, cy) {
  const y = cy + Math.sin(gameTime / 300) * 5;
  ctx.fillStyle = "rgba(123,224,210,0.28)"; ctx.beginPath(); ctx.arc(cx, y, 27, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#7be0d2"; ctx.beginPath(); ctx.arc(cx, y, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#bff5ec"; ctx.beginPath(); ctx.arc(cx - 5, y - 5, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a4a44"; ctx.fillRect(cx - 7, y - 2, 3, 4); ctx.fillRect(cx + 4, y - 2, 3, 4);
  ctx.fillStyle = "rgba(255,140,140,0.55)"; ctx.fillRect(cx - 11, y + 3, 4, 3); ctx.fillRect(cx + 7, y + 3, 4, 3);
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx + 19, y - 15, 2, 2); ctx.fillRect(cx - 22, y + 9, 2, 2); ctx.fillRect(cx + 12, y + 18, 2, 2);
}
function drawIntroScene() {
  for (let y = 0; y < MAP_N; y++) {
    for (let x = 0; x < MAP_N; x++) {
      drawTile(y === 0 || y === MAP_N - 1 ? "T" : "G", x * TILE, y * TILE);
    }
  }
  // 主人公(右向き)・村人(右)・コトハ(主人公の右上に浮遊)
  drawActor(150, 150, () => drawHero(0, 0, "right", gameTime));
  drawActor(296, 150, () => drawPerson("#8d6e63", "#4a342a"));
  drawKotoha(252, 138);
}

function drawEnd(text, color) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color; ctx.textAlign = "center";
  ctx.font = "bold 30px 'MS Gothic', monospace";
  ctx.fillText(text, W / 2, H / 2 - 10);
  ctx.fillStyle = "#fff"; ctx.font = "16px 'MS Gothic', monospace";
  ctx.fillText(`Lv ${player.level}  たおした数 ${player.wins}`, W / 2, H / 2 + 30);
  ctx.fillStyle = "#8aa"; ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText("Enter・タップでタイトルへ", W / 2, H / 2 + 70);
}

// 共通: DQ風ウィンドウ
function drawWindow(x, y, w, h, selected) {
  ctx.fillStyle = "#0a1a3f"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = selected ? "#ffe082" : "#fff";
  ctx.lineWidth = selected ? 4 : 3;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  if (selected) { // 選択カーソル
    ctx.fillStyle = "#ffe082"; ctx.textAlign = "left";
    ctx.font = "16px 'MS Gothic', monospace";
    ctx.fillText("▶", x + 8, y + h / 2 + 6);
    ctx.textAlign = "center";
  }
}

function drawBar(x, y, w, h, ratio, color) {
  ctx.fillStyle = "#222"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, w * ratio), h);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
}

// ===== 起動 =====
requestAnimationFrame(loop);
