"use strict";

// ===== 基本セットアップ =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = 480, H = 480;
const TILE = 32, MAP_N = 15;
ctx.imageSmoothingEnabled = false;

// ===== ゲーム状態 =====
const STATE = { TITLE: "title", FIELD: "field", TOWN: "town", BATTLE: "battle", MESSAGE: "message", QUIZ: "quiz", SHOP: "shop", BOARD: "board", QUESTLOG: "questlog", GAMEOVER: "gameover", CLEAR: "clear" };
let state = STATE.TITLE;

// プレイヤー
const player = {
  tx: 2, ty: 12, px: 2 * TILE, py: 12 * TILE,
  dir: "down", moving: false, anim: 0,
  level: 1, hp: 20, maxhp: 20, atk: 6, def: 0, exp: 0, nextExp: 10,
  gold: 0, wins: 0,
  guildLevel: 0, guildPoints: 0, // 0=未登録、1〜=ギルドランク
};

let toeicLevel = 500;     // 選択された難易度
let stepsToEncounter = 0; // エンカウントまでの歩数
let autoEncounter = false; // オート戦闘(フィールドで歩かず自動エンカウント)
let autoTimer = 0;         // 次の自動エンカウントまでの残り時間(ms)
let msgAutoTimer = 0;      // オート時のメッセージ自動送りタイマー(ms)
const AUTO_MSG_DELAY = 700; // メッセージ1枚あたりの自動送り間隔(ms)

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

// ===== エリア(町＆家の中) =====
// 家の中の共通レイアウト(11×8): 店主(5,2)、出口D(5,6)、入場(5,5)
const INTERIOR_MAP = [
  "###########",
  "#.........#",
  "#.........#",
  "#.........#",
  "#.........#",
  "#.........#",
  "#....D....#",
  "###########",
];
// ギルド(大きい建物)の内部 13×9
const GUILD_MAP = [
  "#############",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#.....D.....#",
  "#############",
];
const GUILD_NPCS = [
  { id: "guild_receptionist", name: "受付嬢 Fia", tx: 6, ty: 2, color: "#e07ab0" },
  { id: "adv_rex", name: "冒険者 Rex", tx: 2, ty: 5, color: "#b05a3a" },
  { id: "adv_mina", name: "冒険者 Mina", tx: 10, ty: 5, color: "#5a6ab0" },
  { id: "adv_pip", name: "冒険者 Pip", tx: 8, ty: 6, color: "#5aa060" },
];
const GUILD_DECOR = [
  { tx: 4, ty: 3, kind: "counter" }, { tx: 5, ty: 3, kind: "counter" },
  { tx: 7, ty: 3, kind: "counter" }, { tx: 8, ty: 3, kind: "counter" },
  { tx: 1, ty: 1, kind: "board" },
  { tx: 2, ty: 6, kind: "table" }, { tx: 10, ty: 6, kind: "table" },
  { tx: 11, ty: 1, kind: "barrel" },
];

// 各建物の店主NPCと内装テンプレ名(ギルドは別定義)
const BUILDING_DEFS = {
  inn:        { name: "宿屋",   npc: { id: "innkeeper",  name: "宿屋の女将 Marian", color: "#e0a060" }, decor: "inn" },
  restaurant: { name: "飲食店", npc: { id: "restaurant", name: "料理人 Tom",        color: "#c08a3e" }, decor: "restaurant" },
  bar:        { name: "バー",   npc: { id: "bar",        name: "バーの主人 Sal",    color: "#9a5a3a" }, decor: "bar" },
  bank:       { name: "銀行",   npc: { id: "bank",       name: "銀行員 Greta",      color: "#5a7a8a" }, decor: "bank" },
  school:     { name: "学校",   npc: { id: "school",     name: "先生 Edwin",        color: "#7a8a5a" }, decor: "school" },
  hospital:   { name: "病院",   npc: { id: "hospital",   name: "医者 Hale",         color: "#cfd8dc" }, decor: "hospital" },
  church:     { name: "教会",   npc: { id: "church",     name: "シスター Clara",    color: "#d0d0e8" }, decor: "church" },
  weapon:     { name: "武器屋", npc: { id: "weaponshop", name: "武器屋",            color: "#8fa0c0", shop: "weapon" }, decor: "weapon" },
  material:   { name: "素材屋", npc: { id: "matshop",    name: "素材屋",            color: "#c08a3e", shop: "material" }, decor: "material" },
  smith:      { name: "鍛冶屋", npc: { id: "smith",      name: "鍛冶屋 Borin",      color: "#9098b0" }, decor: "smith" },
  salon:      { name: "美容院", npc: { id: "salon",      name: "美容師 Coco",       color: "#d07ab0" }, decor: "salon" },
  police:     { name: "警察署", npc: { id: "police",     name: "警官 Bruno",        color: "#3a5a8a" }, decor: "police" },
  fish:       { name: "魚屋",   npc: { id: "fish",       name: "魚屋 Finn",         color: "#5a8ab0", shop: "fish" }, decor: "fish" },
  green:      { name: "八百屋", npc: { id: "green",      name: "八百屋 Vera",       color: "#6aa84a", shop: "green" }, decor: "green" },
  meat:       { name: "肉屋",   npc: { id: "meat",       name: "肉屋 Otto",         color: "#b05a4a", shop: "meat" }, decor: "meat" },
};
// 内装(家具)テンプレ。中央列(列5の通路と店主(5,2))は空ける。
const DECOR_TEMPLATES = {
  inn:        [{ tx: 8, ty: 2, kind: "bed" }, { tx: 8, ty: 4, kind: "bed" }, { tx: 2, ty: 2, kind: "table" }, { tx: 2, ty: 4, kind: "plant" }, { tx: 1, ty: 1, kind: "lamp" }, { tx: 9, ty: 1, kind: "lamp" }, { tx: 5, ty: 4, kind: "rug", solid: false }],
  smith:      [{ tx: 1, ty: 1, kind: "forge" }, { tx: 2, ty: 3, kind: "anvil" }, { tx: 2, ty: 5, kind: "barrel" }, { tx: 8, ty: 2, kind: "weaponrack" }, { tx: 8, ty: 4, kind: "weaponrack" }],
  weapon:     [{ tx: 1, ty: 2, kind: "weaponrack" }, { tx: 1, ty: 4, kind: "weaponrack" }, { tx: 9, ty: 2, kind: "weaponrack" }, { tx: 9, ty: 4, kind: "weaponrack" }, { tx: 2, ty: 5, kind: "armorstand" }, { tx: 8, ty: 5, kind: "armorstand" }],
  material:   [{ tx: 1, ty: 1, kind: "shelf" }, { tx: 9, ty: 1, kind: "shelf" }, { tx: 2, ty: 3, kind: "crate" }, { tx: 8, ty: 3, kind: "crate" }, { tx: 2, ty: 5, kind: "barrel" }, { tx: 8, ty: 5, kind: "barrel" }],
  restaurant: [{ tx: 2, ty: 2, kind: "table" }, { tx: 8, ty: 2, kind: "table" }, { tx: 2, ty: 5, kind: "table" }, { tx: 8, ty: 5, kind: "counter" }, { tx: 1, ty: 1, kind: "plant" }],
  bar:        [{ tx: 1, ty: 3, kind: "counter" }, { tx: 2, ty: 3, kind: "counter" }, { tx: 8, ty: 2, kind: "shelf" }, { tx: 8, ty: 5, kind: "barrel" }, { tx: 2, ty: 5, kind: "barrel" }, { tx: 9, ty: 1, kind: "lamp" }],
  bank:       [{ tx: 3, ty: 3, kind: "counter" }, { tx: 4, ty: 3, kind: "counter" }, { tx: 7, ty: 3, kind: "counter" }, { tx: 8, ty: 3, kind: "counter" }, { tx: 1, ty: 1, kind: "barrel" }, { tx: 9, ty: 1, kind: "barrel" }, { tx: 9, ty: 5, kind: "crate" }],
  school:     [{ tx: 1, ty: 1, kind: "board" }, { tx: 2, ty: 4, kind: "table" }, { tx: 8, ty: 4, kind: "table" }, { tx: 2, ty: 6, kind: "table" }, { tx: 8, ty: 6, kind: "table" }, { tx: 9, ty: 1, kind: "plant" }],
  hospital:   [{ tx: 1, ty: 2, kind: "bed" }, { tx: 9, ty: 2, kind: "bed" }, { tx: 1, ty: 5, kind: "bed" }, { tx: 9, ty: 5, kind: "shelf" }, { tx: 5, ty: 4, kind: "rug", solid: false }],
  church:     [{ tx: 1, ty: 1, kind: "lamp" }, { tx: 9, ty: 1, kind: "lamp" }, { tx: 2, ty: 4, kind: "table" }, { tx: 8, ty: 4, kind: "table" }, { tx: 5, ty: 4, kind: "rug", solid: false }],
  salon:      [{ tx: 1, ty: 2, kind: "plant" }, { tx: 9, ty: 2, kind: "plant" }, { tx: 2, ty: 4, kind: "table" }, { tx: 8, ty: 4, kind: "table" }, { tx: 9, ty: 5, kind: "lamp" }],
  police:     [{ tx: 1, ty: 1, kind: "shelf" }, { tx: 9, ty: 1, kind: "shelf" }, { tx: 2, ty: 4, kind: "table" }, { tx: 8, ty: 5, kind: "barrel" }, { tx: 2, ty: 6, kind: "crate" }],
  fish:       [{ tx: 3, ty: 3, kind: "counter" }, { tx: 4, ty: 3, kind: "counter" }, { tx: 7, ty: 3, kind: "counter" }, { tx: 8, ty: 3, kind: "counter" }, { tx: 1, ty: 1, kind: "barrel" }, { tx: 9, ty: 1, kind: "crate" }, { tx: 9, ty: 5, kind: "barrel" }],
  green:      [{ tx: 1, ty: 1, kind: "crate" }, { tx: 9, ty: 1, kind: "crate" }, { tx: 2, ty: 3, kind: "crate" }, { tx: 8, ty: 3, kind: "crate" }, { tx: 2, ty: 5, kind: "barrel" }, { tx: 8, ty: 5, kind: "plant" }],
  meat:       [{ tx: 3, ty: 3, kind: "counter" }, { tx: 4, ty: 3, kind: "counter" }, { tx: 7, ty: 3, kind: "counter" }, { tx: 8, ty: 3, kind: "counter" }, { tx: 1, ty: 1, kind: "shelf" }, { tx: 9, ty: 1, kind: "barrel" }],
};

// 町の建物配置(col,row は建物ブロックの左上。w/h省略時は3×2。ギルドのみ5×3)
const TOWN_BUILDINGS = [
  { id: "inn", col: 2, row: 2 }, { id: "restaurant", col: 6, row: 2 }, { id: "bar", col: 10, row: 2 },
  { id: "bank", col: 14, row: 2 }, { id: "school", col: 18, row: 2 }, { id: "hospital", col: 22, row: 2 }, { id: "church", col: 26, row: 2 },
  { id: "weapon", col: 2, row: 6 }, { id: "material", col: 6, row: 6 }, { id: "smith", col: 10, row: 6 },
  { id: "guild", col: 14, row: 6, w: 5, h: 3 }, { id: "salon", col: 20, row: 6 }, { id: "police", col: 24, row: 6 },
  { id: "fish", col: 6, row: 10 }, { id: "green", col: 12, row: 10 }, { id: "meat", col: 18, row: 10 },
];
const TOWN_COLS = 30, TOWN_ROWS = 22;
const TOWN_TREES = [[5, 15], [11, 16], [20, 15], [26, 17], [3, 18]];
// 迷いネコ(教会の裏に出現)。逃げ先の候補。
const CAT = { id: "cat", name: "黒ネコ", tx: 27, ty: 1, color: "#1a1a1a" };
const CAT_SPOTS = [[27, 1], [23, 1], [19, 1]];
let catSpot = 0;

// 町マップ＆扉を建物リストから自動生成
const _town = (function buildTown() {
  const g = [];
  for (let y = 0; y < TOWN_ROWS; y++) {
    const row = [];
    for (let x = 0; x < TOWN_COLS; x++) row.push((y === 0 || y === TOWN_ROWS - 1 || x === 0 || x === TOWN_COLS - 1) ? "#" : ".");
    g.push(row);
  }
  const doors = [];
  for (const b of TOWN_BUILDINGS) {
    const w = b.w || 3, h = b.h || 2;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) g[b.row + dy][b.col + dx] = "#";
    const doorX = b.col + (w >> 1), doorY = b.row + h - 1;
    g[doorY][doorX] = "D";
    const spawn = b.id === "guild" ? { tx: 6, ty: 6 } : { tx: 5, ty: 5 };
    doors.push({ tx: doorX, ty: doorY, to: b.id, spawn, ret: { tx: doorX, ty: doorY + 1 } });
  }
  const exX = TOWN_COLS >> 1, exY = TOWN_ROWS - 2;
  g[exY][exX] = "D";
  doors.push({ tx: exX, ty: exY, to: "field" });
  for (const [tx, ty] of TOWN_TREES) if (g[ty][tx] === ".") g[ty][tx] = "T";
  return { map: g.map((r) => r.join("")), doors, start: { tx: exX, ty: exY - 1 } };
})();
const TOWN_MAP = _town.map;
const TOWN_START = _town.start;
const TOILET = { tx: 9, ty: 9 }; // 素材屋の家のそば(飾り)
function townReturnOf(id) {
  const d = _town.doors.find((x) => x.to === id);
  return d && d.ret ? d.ret : { tx: TOWN_START.tx, ty: TOWN_START.ty };
}

const AREAS = {
  town: {
    id: "town", indoor: false, map: TOWN_MAP, cols: TOWN_COLS, rows: TOWN_ROWS,
    npcs: [{ id: "bard", name: "吟遊詩人 Lyra", tx: 15, ty: 14, color: "#6ab0e0" }, CAT],
    decor: [{ tx: TOILET.tx, ty: TOILET.ty, kind: "toilet" }],
    doors: _town.doors.map((d) => ({ tx: d.tx, ty: d.ty, to: d.to, spawn: d.spawn })),
  },
  guild: {
    id: "guild", indoor: true, name: "ギルド", map: GUILD_MAP, cols: 13, rows: 9,
    npcs: GUILD_NPCS, decor: GUILD_DECOR,
    doors: [{ tx: 6, ty: 7, to: "town", spawn: townReturnOf("guild") }],
  },
};
for (const [id, def] of Object.entries(BUILDING_DEFS)) {
  AREAS[id] = {
    id, indoor: true, name: def.name, map: INTERIOR_MAP, cols: 11, rows: 8,
    npcs: [{ ...def.npc, tx: 5, ty: 2 }],
    decor: DECOR_TEMPLATES[def.decor] || [],
    doors: [{ tx: 5, ty: 6, to: "town", spawn: townReturnOf(id) }],
  };
}
let curArea = AREAS.town;               // 現在のエリア(町 or 家の中)
let savedOverworld = { tx: 2, ty: 12 }; // 街に入る前のフィールド座標

function tileAtArea(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= curArea.cols || ty >= curArea.rows) return "#";
  return curArea.map[ty][tx];
}
// 素材屋は「トイレから出てくる」まで非表示。黒ネコは捜索中(目的⑩〜⑫)だけ出現。
function npcVisible(n) {
  if (n.id === "matshop") return !!(quest && quest.shopRevealed);
  if (n.id === "cat") return !!(quest && quest.stage >= 9 && quest.stage <= 11);
  return true;
}
function npcAt(tx, ty) {
  return curArea.npcs.find((n) => n.tx === tx && n.ty === ty && npcVisible(n)) || null;
}
function decorSolidAt(tx, ty) {
  return (curArea.decor || []).some((d) => d.tx === tx && d.ty === ty && d.solid !== false);
}
function areaWalkable(tx, ty) {
  const t = tileAtArea(tx, ty);
  if (t === "#" || t === "T") return false;
  if (decorSolidAt(tx, ty)) return false;
  return !npcAt(tx, ty);
}
function doorAt(tx, ty) {
  return curArea.doors.find((d) => d.tx === tx && d.ty === ty) || null;
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
let quest = null;          // 現在の目的 { stage, kills, goal }
let materials = {};         // 集めた素材 名前->個数
let camX = 0, camY = 0;     // カメラ(ビューポート左上のワールド座標)

// プレイヤーを中心にカメラを合わせる(マップ端でクランプ)
function updateCamera(cols, rows) {
  const mapW = cols * TILE, mapH = rows * TILE;
  // 画面より小さいマップ(家の中など)は中央寄せ、大きければプレイヤー追従
  if (mapW <= W) camX = -Math.round((W - mapW) / 2);
  else camX = Math.max(0, Math.min(Math.round(player.px + TILE / 2 - W / 2), mapW - W));
  if (mapH <= H) camY = -Math.round((H - mapH) / 2);
  else camY = Math.max(0, Math.min(Math.round(player.py + TILE / 2 - H / 2), mapH - H));
}

// ===== 素材の売値 / ショップの品ぞろえ =====
const MATERIAL_PRICE = {
  "スライムのゼリー": 8, "こうもりの羽": 10, "れいきのかけら": 14, "こわれた鎧の破片": 18,
};
const SHOP_ITEMS = [
  { name: "どうの剣", kind: "atk", value: 4, price: 30 },
  { name: "はがねの剣", kind: "atk", value: 10, price: 120 },
  { name: "木の盾", kind: "def", value: 3, price: 25 },
  { name: "鉄の盾", kind: "def", value: 8, price: 100 },
  { name: "たびびとの服", kind: "hp", value: 15, price: 40 },
  { name: "くさりかたびら", kind: "hp", value: 40, price: 150 },
];
let shop = null;             // { sel, msg, msgT }
let boughtItems = new Set(); // 購入済み装備のindex
let bag = {};                // 買った持ち物(食べ物など) 名前->個数
// ギルドAI依頼ボード(メインクエストとは別のサブクエスト)
let board = null;            // { sel, msg, msgT, loading } ボード表示中の状態
let boardCache = null;       // 受注前の依頼一覧(生成結果をキャッシュ)
let sideQuests = [];         // 受注中のサブクエスト
let sideQuestId = 0;
let questLog = null;         // { sel } 受注依頼の詳細表示中の状態
let sideQuestBoxRect = null; // HUDの「ギルド依頼」ボックスのタップ判定用矩形
// 食料品店の品ぞろえ(買うと bag に入る)
const FOOD_SHOPS = {
  fish:  [{ name: "マグロ", price: 20 }, { name: "イワシ", price: 8 }],
  green: [{ name: "キャベツ", price: 6 }, { name: "トマト", price: 8 }],
  meat:  [{ name: "とり肉", price: 14 }, { name: "ぶた肉", price: 18 }],
};
const SHOP_TITLE = { material: "素材屋", weapon: "武器屋", fish: "魚屋", green: "八百屋", meat: "肉屋" };
function buyItem(name) { bag[name] = (bag[name] || 0) + 1; }
function hasItem(name) { return (bag[name] || 0) > 0; }
function useItem(name) { if (bag[name] > 0) { bag[name]--; if (bag[name] <= 0) delete bag[name]; } }

function materialsValue() {
  let v = 0;
  for (const [n, c] of Object.entries(materials)) v += (MATERIAL_PRICE[n] || 5) * c;
  return v;
}
function effText(it) {
  return it.kind === "atk" ? `こうげき+${it.value}` : it.kind === "def" ? `ぼうぎょ+${it.value}` : `さいだいHP+${it.value}`;
}
function shopRows() {
  const rows = [];
  if (shop.type === "material") {
    const sv = materialsValue();
    rows.push({ kind: "sell", enabled: sv > 0, label: sv > 0 ? `素材を ぜんぶ売る（+${sv}G）` : "売る素材がない" });
  } else if (FOOD_SHOPS[shop.type]) {
    FOOD_SHOPS[shop.type].forEach((it, i) => {
      rows.push({ kind: "buyfood", idx: i, enabled: player.gold >= it.price, label: `${it.name}（${it.price}G）` });
    });
  } else {
    SHOP_ITEMS.forEach((it, i) => {
      const owned = boughtItems.has(i);
      rows.push({
        kind: "buy", idx: i, enabled: !owned && player.gold >= it.price,
        label: owned ? `✓ ${it.name}（${effText(it)}）購入ずみ` : `${it.name}（${effText(it)}）${it.price}G`,
      });
    });
  }
  rows.push({ kind: "exit", enabled: true, label: "店を出る" });
  return rows;
}
function openShop(type) {
  shop = {
    type, sel: 0, msgT: 260,
    msg: type === "material" ? "コトハ「集めた素材をお金に換えよう！」"
      : FOOD_SHOPS[type] ? "コトハ「ほしい食べ物を買おう！」"
      : "コトハ「武器や防具で強くなろう！」",
  };
  state = STATE.SHOP;
}
function shopSelect(row) {
  if (!row) return;
  if (row.kind === "exit") { shop = null; state = STATE.TOWN; return; }
  if (!row.enabled) { shop.msg = "コトハ「ゴールドが足りないみたい…」"; shop.msgT = 200; return; }
  if (row.kind === "sell") {
    const v = materialsValue();
    player.gold += v; materials = {};
    if (quest && quest.stage === 3) {
      quest.stage = 4; // 素材を売った→次は宿屋に泊まる
      shop.msg = `素材を売って ${v}G！ コトハ「次は宿屋に泊まって休もう」`; shop.msgT = 300;
    } else {
      shop.msg = `素材を売って ${v}G 手に入れた！`; shop.msgT = 220;
    }
  } else if (row.kind === "buy") {
    const it = SHOP_ITEMS[row.idx];
    player.gold -= it.price; boughtItems.add(row.idx);
    if (it.kind === "atk") player.atk += it.value;
    else if (it.kind === "def") player.def += it.value;
    else { player.maxhp += it.value; player.hp += it.value; }
    shop.msg = `${it.name}を そうびした！`; shop.msgT = 220;
  } else if (row.kind === "buyfood") {
    const it = FOOD_SHOPS[shop.type][row.idx];
    player.gold -= it.price; buyItem(it.name);
    if (quest && quest.stage === 10 && it.name === "マグロ") {
      quest.stage = 11; // マグロを手に入れた→迷いネコを捕まえに
      shop.msg = `マグロを買った！ コトハ「これで迷いネコをおびき寄せよう」`; shop.msgT = 300;
    } else {
      shop.msg = `${it.name}を 買った！`; shop.msgT = 200;
    }
  }
  const rows = shopRows();
  if (shop.sel >= rows.length) shop.sel = rows.length - 1;
}
function drawShop() {
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'MS Gothic', monospace";
  ctx.fillText(SHOP_TITLE[shop.type] || "店", W / 2, 44);
  ctx.fillStyle = "#ffe082"; ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillText(`所持金 ${player.gold}G`, W / 2, 72);
  const rows = shopRows();
  for (let i = 0; i < rows.length; i++) {
    const y = 92 + i * 44;
    drawWindow(40, y, 400, 40, shop.sel === i);
    ctx.textAlign = "left";
    ctx.fillStyle = (rows[i].enabled || rows[i].kind === "exit") ? "#fff" : "#7a8aa8";
    ctx.font = "15px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 70, y + 26);
  }
  if (shop.msgT > 0) {
    ctx.textAlign = "center"; ctx.fillStyle = "#9fe0c0"; ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText(shop.msg, W / 2, H - 22);
  }
  ctx.textAlign = "center";
}

// ギルド依頼ボード描画
function drawQuestBoard() {
  ctx.fillStyle = "#0a1630"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'MS Gothic', monospace";
  ctx.fillText("ギルド依頼ボード", W / 2, 40);
  ctx.fillStyle = "#ffd24a"; ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(`ランク${player.guildLevel}  受注中 ${sideQuests.length}/3  所持金 ${player.gold}G`, W / 2, 64);
  if (board.loading) {
    ctx.fillStyle = "#9fd6ff"; ctx.font = "16px 'MS Gothic', monospace";
    ctx.fillText("依頼を生成中…", W / 2, 220);
    ctx.textAlign = "center"; return;
  }
  const rows = boardRows();
  for (let i = 0; i < rows.length; i++) {
    const y = 92 + i * 40;
    drawWindow(30, y, 420, 36, board.sel === i);
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 48, y + 24);
  }
  // 選択中の依頼の詳細
  const sel = rows[board.sel];
  const yDetail = 92 + rows.length * 40 + 8;
  if (sel && sel.kind === "quest" && boardCache[sel.idx]) {
    const q = boardCache[sel.idx];
    drawWindow(30, yDetail, 420, 96, false);
    ctx.textAlign = "left"; ctx.fillStyle = "#9fe0c0"; ctx.font = "12px 'MS Gothic', monospace";
    wrapText(q.desc_ja, 46, yDetail + 22, 392, 16);
    ctx.fillStyle = "#cdddff"; ctx.font = "italic 11px 'MS Gothic', monospace";
    ctx.fillText(`Fia: “${q.flavor_en}”`, 46, yDetail + 80);
  }
  if (board.msgT > 0) {
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe082"; ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText(board.msg, W / 2, H - 18);
  }
  ctx.textAlign = "center";
}
// 簡易テキスト折り返し(日本語向け: 文字数ベース)
function wrapText(text, x, y, maxW, lineH) {
  const perLine = Math.max(6, Math.floor(maxW / 13));
  let line = "", ly = y;
  for (const ch of text) {
    line += ch;
    if (line.length >= perLine) { ctx.fillText(line, x, ly); line = ""; ly += lineH; }
  }
  if (line) ctx.fillText(line, x, ly);
}

// ===== クエスト(目的)管理 =====
function setupFirstQuest() { quest = { stage: 0, kills: 0, goal: 5, shopRevealed: false }; }
function addMaterial(name) { materials[name] = (materials[name] || 0) + 1; }
function questLines() {
  if (!quest) return null;
  if (quest.stage === 0) return ["① モンスターを5匹たおす", `素材あつめ ${quest.kills}/${quest.goal}`];
  if (quest.stage === 1) return ["② 町(赤い屋根)へ向かう", "素材あつめ 達成！"];
  if (quest.stage === 2) return ["③ 素材屋の場所を町の人に聞く", '"Where is the material shop?"'];
  if (quest.stage === 3) return ["④ 素材屋で素材を売る"];
  if (quest.stage === 4) return ["⑤ 宿屋に泊まる"];
  if (quest.stage === 5) return ["⑥ ギルドに登録する", "町中央のギルドの受付へ"];
  if (quest.stage === 6) return ["⑦ ギルドの依頼を受ける", "ギルド受付に依頼を受けたいと伝えよう"];
  if (quest.stage === 7) return ["⑧ 美容院の人に話を聞く", "迷いネコの特徴を聞き出そう"];
  if (quest.stage === 8) return ["⑨ 町の人に迷いネコのことを聞く", "目撃情報をあつめよう"];
  if (quest.stage === 9) return ["⑩ 迷いネコをとらえる", "教会の裏にネコがいるみたい"];
  if (quest.stage === 10) return ["⑪ ネコの好きな食べ物を手に入れる", "魚屋でマグロを買おう"];
  if (quest.stage === 11) return ["⑫ マグロで迷いネコをとらえる", "教会の裏のネコに近づこう"];
  if (quest.stage === 12) return ["⑬ 迷いネコを美容院の人に届ける", "美容師Cocoに話しかけよう"];
  if (quest.stage === 13) return ["⑭ ギルドに報告する", "ギルド受付に達成を報告しよう"];
  return ["クエスト達成！ つづきは準備中…"];
}

// ===== 敵テンプレート =====
const ENEMIES = [
  { name: "スライム",   hp: 12, atk: 3, exp: 5,  color: "#3fbf6f", drop: "スライムのゼリー" },
  { name: "おおコウモリ", hp: 16, atk: 4, exp: 7,  color: "#7a5ad6", drop: "こうもりの羽" },
  { name: "ゴースト",   hp: 20, atk: 5, exp: 9,  color: "#9fd6e6", drop: "れいきのかけら" },
  { name: "アーマー兵", hp: 28, atk: 6, exp: 12, color: "#b0b0c0", drop: "こわれた鎧の破片" },
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
    case "c": case "C": return "kotoha";
  }
  return key;
}

// 十字キー(モバイル)
document.querySelectorAll(".dbtn").forEach((b) => {
  b.addEventListener("touchstart", (e) => { e.preventDefault(); if (!Chat.isOpen()) onInput(b.dataset.dir); }, { passive: false });
  b.addEventListener("mousedown", (e) => { e.preventDefault(); if (!Chat.isOpen()) onInput(b.dataset.dir); });
});

// 「コトハにきく」コマンド(ボタン)
const kotohaBtn = document.getElementById("kotoha-btn");
if (kotohaBtn) kotohaBtn.addEventListener("click", (e) => { e.preventDefault(); openKotohaChat(); });

// オート戦闘トグル(フィールドで歩かず自動エンカウント)
const autoBtn = document.getElementById("auto-btn");
function updateAutoBtn() { if (autoBtn) autoBtn.textContent = autoEncounter ? "⚔ オート戦闘: ON" : "⚔ オート戦闘: OFF"; }
function toggleAutoEncounter() { autoEncounter = !autoEncounter; autoTimer = 600; updateAutoBtn(); }
if (autoBtn) autoBtn.addEventListener("click", (e) => { e.preventDefault(); toggleAutoEncounter(); });
updateAutoBtn();

// 開発用: 目的ジャンプボタン(data-stage 付きのみ。モデル切替ボタンは chat.js 側で処理)
document.querySelectorAll("#dev-bar button[data-stage]").forEach((b) => {
  b.addEventListener("click", (e) => { e.preventDefault(); devJump(parseInt(b.dataset.stage, 10)); });
});

// コトハに相談(日本語で何でも教えてくれる)。探索中のみ。
function openKotohaChat() {
  if (Chat.isOpen()) return;
  if (state !== STATE.FIELD && state !== STATE.TOWN) return;
  for (const k in keys) keys[k] = false;
  Chat.openKotoha(toeicLevel, getKotohaContext(), () => {});
}
// コトハに渡す文脈(現在の目的)。NPC会話中にコトハへ切替えたときも使う。
function getKotohaContext() {
  const ql = quest ? questLines() : null;
  return ql ? ql[0] : null;
}
window.getKotohaContext = getKotohaContext;

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
    else if (k === "kotoha") openKotohaChat();
    return;
  }
  if (state === STATE.TOWN) {
    if (["up", "down", "left", "right"].includes(k)) tryMove(k);
    else if (k === "confirm") tryTalk();
    else if (k === "kotoha") openKotohaChat();
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
  if (state === STATE.SHOP && shop) {
    const rows = shopRows();
    if (k === "up") shop.sel = (shop.sel - 1 + rows.length) % rows.length;
    else if (k === "down") shop.sel = (shop.sel + 1) % rows.length;
    else if (k === "confirm") shopSelect(rows[shop.sel]);
    else if (k === "cancel") { shop = null; state = STATE.TOWN; }
    return;
  }
  if (state === STATE.BOARD && board) {
    const rows = boardRows();
    if (k === "up") board.sel = (board.sel - 1 + rows.length) % rows.length;
    else if (k === "down") board.sel = (board.sel + 1) % rows.length;
    else if (k === "confirm") boardSelect(rows[board.sel]);
    else if (k === "cancel") { board = null; state = STATE.TOWN; }
    return;
  }
  if (state === STATE.QUESTLOG && questLog) {
    const rows = questLogRows();
    if (k === "up") questLog.sel = (questLog.sel - 1 + rows.length) % rows.length;
    else if (k === "down") questLog.sel = (questLog.sel + 1) % rows.length;
    else if (k === "confirm") questLogSelect(rows[questLog.sel]);
    else if (k === "cancel") { questLog = null; state = STATE.TOWN; }
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

function inRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

function onTap(x, y) {
  if (Chat.isOpen()) return;
  // 探索中にHUDの「ギルド依頼」ボックスをタップ → 詳細を開く
  if ((state === STATE.TOWN || state === STATE.FIELD) && inRect(x, y, sideQuestBoxRect)) { openQuestLog(); return; }
  if (state === STATE.TOWN) {
    const tx = Math.floor((x + camX) / TILE), ty = Math.floor((y + camY) / TILE);
    const n = npcAt(tx, ty);
    if (n) interactNPC(n);
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
  if (state === STATE.SHOP && shop) {
    const rows = shopRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = 92 + i * 44;
      if (x >= 40 && x <= 440 && y >= ry && y <= ry + 40) { shop.sel = i; shopSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.BOARD && board) {
    const rows = boardRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = 92 + i * 40;
      if (x >= 30 && x <= 450 && y >= ry && y <= ry + 36) { board.sel = i; boardSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.QUESTLOG && questLog) {
    const rows = questLogRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = 64 + i * 38;
      if (x >= 30 && x <= 450 && y >= ry && y <= ry + 34) { questLog.sel = i; questLogSelect(rows[i]); return; }
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
  player.level = 1; player.maxhp = 20; player.hp = 20; player.atk = 6; player.def = 0;
  player.exp = 0; player.nextExp = 10; player.wins = 0; player.gold = 0;
  player.guildLevel = 0; player.guildPoints = 0;
  materials = {}; quest = null; boughtItems = new Set();
  bag = {}; catSpot = 0; CAT.tx = CAT_SPOTS[0][0]; CAT.ty = CAT_SPOTS[0][1];
  board = null; boardCache = null; sideQuests = []; questLog = null;
  resetEncounter();
  startOpening();
}

function resetEncounter() { stepsToEncounter = 4 + Math.floor(rnd() * 6); }

// ===== 開発用: 指定の目的(ステージ)から開始 =====
// stage 0=①最初 1=②町へ 2=③聞込 3=④売る 4=⑤宿 5=⑥ギルド登録 6=⑦後
function devJump(stage) {
  if (!toeicLevel) toeicLevel = 500;
  if (window.Chat && Chat.isOpen()) Chat.close();
  battle = null; shop = null; quiz = null; cutsceneDraw = null; cutsceneSteps = null; messageSpeaker = null;
  // 目的③以降を試せる程度のステータス
  player.level = 3; player.maxhp = 32; player.hp = 32; player.atk = 10; player.def = 0;
  player.exp = 0; player.nextExp = 26; player.wins = 5;
  player.guildLevel = stage >= 6 ? 1 : 0; player.guildPoints = 0;
  boughtItems = new Set();
  quest = { stage, kills: stage === 0 ? 0 : 5, goal: 5, shopRevealed: stage >= 3 };
  materials = (stage === 2 || stage === 3) ? { "スライムのゼリー": 3, "こうもりの羽": 1, "れいきのかけら": 1 } : {};
  player.gold = stage >= 4 ? 80 : 0;
  // 迷いネコクエストの持ち物・ネコ位置を段階に合わせて用意
  bag = {};
  if (stage === 11) bag["マグロ"] = 1;          // ⑫: マグロ所持済みで開始(捕獲を試せる)
  if (stage === 12) bag["迷いネコ"] = 1;        // ⑬: 捕獲済みのネコを所持(届けられる)
  catSpot = 0; CAT.tx = CAT_SPOTS[0][0]; CAT.ty = CAT_SPOTS[0][1];
  board = null; boardCache = null; sideQuests = []; questLog = null;
  resetEncounter();
  if (stage <= 1) {
    curArea = AREAS.town;
    player.tx = 2; player.ty = 12; player.px = player.tx * TILE; player.py = player.ty * TILE;
    player.dir = "down"; player.moving = false;
    state = STATE.FIELD;
  } else {
    curArea = AREAS.town;
    player.tx = TOWN_START.tx; player.ty = TOWN_START.ty;
    player.px = player.tx * TILE; player.py = player.ty * TILE;
    player.dir = "up"; player.moving = false;
    state = STATE.TOWN;
  }
}
window.dev = devJump; // コンソールから dev(4) などでも呼べる

// ===== フィールド移動 =====
function tryMove(dir) {
  if (player.moving) return;
  player.dir = dir;
  let nx = player.tx, ny = player.ty;
  if (dir === "up") ny--; else if (dir === "down") ny++;
  else if (dir === "left") nx--; else if (dir === "right") nx++;
  const ok = state === STATE.TOWN ? areaWalkable(nx, ny) : walkable(nx, ny);
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
  if (n) interactNPC(n);
}

// 宿屋に泊まる(HP全回復＋クエスト進行)。泊まったらコトハがギルド登録を提案。
function restAtInn() {
  player.hp = player.maxhp;
  for (const k in keys) keys[k] = false;
  const advanced = quest && quest.stage === 4;
  if (advanced) quest.stage = 5;
  playTownCutscene([{
    who: "コトハ",
    lines: advanced
      ? ["ぐっすり眠った…。HPが全回復したよ！", "ねぇ相棒、もっとお金を稼ぐなら『ギルド』に登録しよう！", "町の中央の大きい建物がギルド。受付で登録できるよ。"]
      : ["ぐっすり眠った…。HPが全回復したよ！"],
  }]);
}

// ギルドに登録する
function registerGuild() {
  if (player.guildLevel > 0) return;
  player.guildLevel = 1; player.guildPoints = 0;
  if (quest && quest.stage === 5) quest.stage = 6; // 目的⑥達成
  playTownCutscene([{
    who: "コトハ",
    lines: [
      "ギルドに登録できたね！ これでギルドランク1の冒険者だよ。",
      "依頼をこなすとギルドポイントとお金がもらえるの。",
      "ポイントが貯まるとランクが上がって、行ける場所も増えるよ！",
      "さっそく依頼を受けてみよう！ もう一度ギルド受付に話しかけて、依頼を受けたいと伝えてね。",
    ],
  }]);
}
// 依頼などでギルドポイントを加算(貯まるとランクアップ)。返り値=上がったランク数
function addGuildPoints(gp) {
  if (player.guildLevel < 1) return 0;
  player.guildPoints += gp;
  let ups = 0;
  while (player.guildPoints >= player.guildLevel * 100) {
    player.guildPoints -= player.guildLevel * 100;
    player.guildLevel++; ups++;
  }
  return ups;
}
window.gp = addGuildPoints; // 開発用: コンソールから gp(120) などでポイント加算テスト

// NPCに話しかけたときの分岐
function interactNPC(n) {
  if (n.id === "cat") { catInteract(); return; }               // 迷いネコ: 近づく→逃げる/捕獲
  // サブクエスト: 配達(アイテム所持時) / 会話チャレンジ
  const sf = sideQuests.find((q) => q.status === "active" && q.type === "fetch" && q.deliverTo === n.id);
  if (sf && hasItem(sf.item)) { deliverSideFetch(sf, n); return; }
  const st = sideQuests.find((q) => q.status === "active" && q.type === "talk" && q.npcId === n.id);
  if (st) { talkSideChallenge(st, n); return; }
  if (n.id === "innkeeper") { talkInn(n); return; }            // 宿屋: 泊まりたい→泊まる
  if (n.id === "guild_receptionist") { talkGuild(n); return; } // ギルド受付: 登録/依頼/報告
  if (n.id === "salon") { talkSalon(n); return; }              // 美容師Coco: 特徴を聞く/ネコを届ける
  if (n.shop) { talkShop(n); return; }                         // 店: 売りたい/買いたい→メニュー
  if (quest && quest.stage === 2) {                            // 素材屋の場所を尋ねるイベント
    if (Chat.aiReady()) talkAskDirections(n);
    else askDirections(n);
    return;
  }
  if (quest && quest.stage === 8) { talkCatInfo(n); return; }  // 町の人に迷いネコの聞き込み
  talkToNPC(n);
}

// ギルド受付: 未登録なら登録、依頼受注(⑦)、達成報告(⑭)を扱う
function talkGuild(n) {
  for (const k in keys) keys[k] = false;
  // 未登録 → 登録フロー
  if (player.guildLevel === 0) {
    if (!Chat.aiReady()) { registerGuild(); return; }
    Chat.setQuest({
      note: "the traveler asks to register, join, or sign up as an adventurer at the guild (e.g. \"I want to register\", \"I'd like to join the guild\", \"Can I sign up as an adventurer?\"). When they do, warmly welcome them as a new guild member.",
      flagMessage: "コトハ「登録できるって！ × でとじて登録しよう」",
      onClose: () => registerGuild(),
    });
    Chat.open(n, toeicLevel, () => {});
    return;
  }
  // 目的⑦: 依頼を受ける
  if (quest && quest.stage === 6) {
    if (!Chat.aiReady()) { proposeRequest(); return; }
    Chat.setQuest({
      note: "the traveler asks to take on a job, quest, or request from the guild (e.g. \"I want to take a request\", \"Do you have any jobs?\", \"I'd like to accept a quest\"). When they do, happily tell them you have a perfect request for them.",
      flagMessage: "コトハ「依頼を受けられるって！ × でとじて話を聞こう」",
      onClose: () => proposeRequest(),
    });
    Chat.open(n, toeicLevel, () => {});
    return;
  }
  // 目的⑭: 達成を報告する
  if (quest && quest.stage === 13) {
    if (!Chat.aiReady()) { completeRequest(); return; }
    Chat.setQuest({
      note: "the traveler reports that they completed the request and found the lost cat (e.g. \"I found the cat\", \"The request is done\", \"I completed the quest\"). When they do, congratulate them warmly and tell them their reward is ready.",
      flagMessage: "コトハ「報告できたね！ × でとじて報酬を受け取ろう」",
      onClose: () => completeRequest(),
    });
    Chat.open(n, toeicLevel, () => {});
    return;
  }
  // 登録済み & メイン依頼ステップでない → ギルドAI依頼ボード
  openBoard();
}

// 目的⑦達成→⑧: 最初の依頼(迷いネコ捜索)を提案される
function proposeRequest() {
  if (!quest || quest.stage !== 6) return;
  quest.stage = 7;
  playTownCutscene([{
    who: "コトハ",
    lines: [
      "受付のFiaさんが依頼書をくれたよ！",
      "『美容院の人の飼いネコが迷子になったから探してほしい』だって。",
      "まずは依頼主の美容師Cocoさんに話を聞きに行こう！",
      "ネコの特徴を教えてもらえるはずだよ。",
    ],
  }]);
}

// 目的⑭達成: 報酬(ゴールド＋GP)を受け取りクエスト完了
function completeRequest() {
  if (!quest || quest.stage !== 13) return;
  quest.stage = 14;
  const goldReward = 100, gpReward = 60;
  player.gold += goldReward;
  const ups = addGuildPoints(gpReward);
  const lines = [
    "依頼達成おめでとう、相棒！",
    `報酬として ${goldReward}ゴールド と ギルドポイント${gpReward} をもらったよ！`,
  ];
  if (ups > 0) lines.push(`やったね、ギルドランクが ${player.guildLevel} に上がったよ！`);
  lines.push("こうやって依頼をこなして、強くなっていこう！");
  playTownCutscene([{ who: "コトハ", lines }]);
}

// =====================================================================
// ギルドAI依頼ボード(サブクエスト): 討伐 / おつかい / 会話チャレンジ
// =====================================================================
// 依頼の対象に使える「町の人」一覧(店主・宿屋・美容師・受付は除外。会話/配達向け)
function questableNpcs() {
  const list = [{ id: "bard", name: "吟遊詩人 Lyra", area: "町" }];
  const skip = new Set(["innkeeper", "salon"]); // 特別な専用処理があるNPCは除外
  for (const [, def] of Object.entries(BUILDING_DEFS)) {
    if (def.npc.shop || skip.has(def.npc.id)) continue;
    list.push({ id: def.npc.id, name: def.npc.name, area: def.name });
  }
  for (const g of GUILD_NPCS) if (g.id !== "guild_receptionist") list.push({ id: g.id, name: g.name, area: "ギルド" });
  return list;
}
function npcInfo(id) { return questableNpcs().find((n) => n.id === id) || null; }
// AIに渡す「使ってよい素材」一覧
function buildQuestGenContext() {
  return {
    guildLevel: player.guildLevel,
    enemies: ENEMIES.map((e) => e.name),
    shops: Object.keys(FOOD_SHOPS).map((t) => ({ type: t, name: SHOP_TITLE[t], items: FOOD_SHOPS[t].map((i) => i.name) })),
    npcs: questableNpcs(),
  };
}
function shopOfItem(name) {
  for (const t of Object.keys(FOOD_SHOPS)) if (FOOD_SHOPS[t].some((i) => i.name === name)) return { type: t, name: SHOP_TITLE[t] };
  return null;
}
function clampInt(v, lo, hi, dflt) { v = parseInt(v, 10); if (isNaN(v)) return dflt; return Math.max(lo, Math.min(hi, v)); }
// 報酬はバランスのためゲーム側で決める(AIには決めさせない)
function rewardFor(type, count) {
  const lv = toeicLevel === 900 ? 3 : toeicLevel === 700 ? 2 : 1;
  if (type === "hunt") return { gold: 30 + 15 * count + 10 * lv, gp: 12 + 4 * count };
  if (type === "fetch") return { gold: 50 + 10 * lv, gp: 14 };
  return { gold: 45 + 15 * lv, gp: 22 }; // talk: 英語チャレンジはGP高め
}
function buildTalkNote(goal) {
  return `the traveler successfully accomplishes the following in clear English during this conversation: ${goal}. Only when they clearly manage it in understandable English, warmly acknowledge it in character.`;
}
// AI出力(またはnull)を検証して、討伐/おつかい/会話の3件に正規化
function normalizeQuests(raw, ctx) {
  const pick = (type) => (Array.isArray(raw) ? raw.find((q) => q && q.type === type) : null);
  const rndOf = (arr) => arr[Math.floor(rnd() * arr.length)];
  const out = [];
  // 討伐
  {
    const r = pick("hunt");
    const enemy = r && ctx.enemies.includes(r.target) ? r.target : rndOf(ctx.enemies);
    const count = r && r.count ? clampInt(r.count, 1, 5, 3) : Math.min(5, 2 + Math.floor(player.guildLevel / 2));
    const rw = rewardFor("hunt", count);
    out.push({
      id: ++sideQuestId, type: "hunt", status: "active", progress: 0,
      enemy, count,
      title_ja: (r && r.title_ja) || `${enemy}を${count}体たおす`,
      desc_ja: (r && r.desc_ja) || `フィールドで${enemy}を${count}体たおそう。`,
      flavor_en: (r && r.flavor_en) || `The roads are dangerous. Could you defeat ${count} of them?`,
      gold: rw.gold, gp: rw.gp,
    });
  }
  // おつかい(配達)
  {
    const r = pick("fetch");
    let item = r && shopOfItem(r.target) ? r.target : null;
    if (!item) { const s = rndOf(ctx.shops); item = rndOf(s.items); }
    const sh = shopOfItem(item);
    let npc = (r && npcInfo(r.deliver_to)) || rndOf(ctx.npcs);
    const rw = rewardFor("fetch", 1);
    out.push({
      id: ++sideQuestId, type: "fetch", status: "active", progress: 0,
      item, deliverTo: npc.id,
      title_ja: (r && r.title_ja) || `${item}を${npc.name}に届ける`,
      desc_ja: (r && r.desc_ja) || `${sh ? sh.name : "お店"}で「${item}」を買って、${npc.area}の${npc.name}に届けよう。`,
      flavor_en: (r && r.flavor_en) || `Someone needs ${item}. Can you deliver it?`,
      gold: rw.gold, gp: rw.gp,
    });
  }
  // 会話チャレンジ
  {
    const r = pick("talk");
    let npc = (r && npcInfo(r.deliver_to)) || rndOf(ctx.npcs);
    const goal = (r && r.goal_en) || "greet them politely and ask how they are doing today";
    const goalJa = (r && r.goal_ja) || "あいさつをして、調子をたずねる";
    const rw = rewardFor("talk", 1);
    out.push({
      id: ++sideQuestId, type: "talk", status: "active", progress: 0,
      npcId: npc.id, goal_en: goal, goal_ja: goalJa, note_en: buildTalkNote(goal),
      title_ja: (r && r.title_ja) || `${npc.name}と英語で話す`,
      desc_ja: (r && r.desc_ja) || `${npc.area}の${npc.name}に英語で話しかけて「${goalJa}」を達成しよう。`,
      flavor_en: (r && r.flavor_en) || `Go and have a chat — your English is your weapon!`,
      gold: rw.gold, gp: rw.gp,
    });
  }
  return out;
}
// 依頼ボードを(再)生成。AIが使えれば生成、ダメならテンプレにフォールバック
async function refreshBoard() {
  if (!board) return;
  board.loading = true; board.msg = ""; board.sel = 0;
  const genCtx = buildQuestGenContext();
  let raw = null;
  try {
    if (Chat.aiReady() && Chat.generateQuests) {
      // 生成が長引いても固まらないよう20秒でフォールバック
      const timeout = new Promise((res) => setTimeout(() => res(null), 20000));
      raw = await Promise.race([Chat.generateQuests(toeicLevel, genCtx), timeout]);
    }
  } catch (e) { console.warn("quest gen failed:", e); raw = null; }
  try { boardCache = normalizeQuests(raw, genCtx); }
  catch (e) { console.warn("normalize failed:", e); boardCache = normalizeQuests(null, genCtx); }
  if (board) { board.loading = false; board.sel = 0; }
}
function openBoard() {
  for (const k in keys) keys[k] = false;
  board = { sel: 0, msg: "", msgT: 0, loading: false };
  state = STATE.BOARD;
  if (!boardCache) refreshBoard();
}
function boardRows() {
  const rows = [];
  if (boardCache) boardCache.forEach((q, i) => rows.push({ kind: "quest", idx: i, label: `${questIcon(q.type)} ${q.title_ja}（+${q.gold}G/GP${q.gp}）` }));
  rows.push({ kind: "refresh", label: "🔄 新しい依頼をさがす" });
  rows.push({ kind: "exit", label: "ボードを閉じる" });
  return rows;
}
function questIcon(type) { return type === "hunt" ? "⚔" : type === "fetch" ? "📦" : "💬"; }
function boardSelect(row) {
  if (!row || board.loading) return;
  if (row.kind === "exit") { board = null; state = STATE.TOWN; return; }
  if (row.kind === "refresh") { refreshBoard(); return; }
  if (row.kind === "quest") {
    if (sideQuests.length >= 3) { board.msg = "受注中の依頼が多すぎるよ(最大3件)"; board.msgT = 220; return; }
    const q = boardCache[row.idx];
    boardCache.splice(row.idx, 1);
    sideQuests.push(q);
    board.msg = `依頼『${q.title_ja}』を受けた！`; board.msgT = 240;
    if (board.sel >= boardRows().length) board.sel = boardRows().length - 1;
  }
}
// 受注中の依頼の詳細を見る
function openQuestLog() {
  if (!sideQuests.length) return;
  for (const k in keys) keys[k] = false;
  questLog = { sel: 0 };
  state = STATE.QUESTLOG;
}
function questLogRows() {
  const rows = sideQuests.map((q, i) => ({ kind: "q", idx: i, label: `${questIcon(q.type)} ${q.title_ja}` }));
  rows.push({ kind: "close", label: "とじる" });
  return rows;
}
// 依頼1件の詳細テキスト行
function questDetailLines(q) {
  const lines = [q.desc_ja];
  if (q.type === "hunt") lines.push(`進行: ${q.enemy} ${q.progress}/${q.count} 体`);
  else if (q.type === "fetch") lines.push("※アイテムを持って対象の人に話しかけよう");
  else if (q.type === "talk") lines.push(`お題: ${q.goal_ja || "英語で話す"}（英語で伝えよう）`);
  lines.push(`報酬: ${q.gold}G ＋ ギルドポイント${q.gp}`);
  return lines;
}
function questLogSelect(row) {
  if (!row) return;
  if (row.kind === "close") { questLog = null; state = STATE.TOWN; return; }
  // 依頼行はそのまま選択(詳細は常時表示)
}
function drawQuestLog() {
  ctx.fillStyle = "#0a1630"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.font = "bold 20px 'MS Gothic', monospace";
  ctx.fillText("受注中のギルド依頼", W / 2, 38);
  const rows = questLogRows();
  for (let i = 0; i < rows.length; i++) {
    const y = 64 + i * 38;
    drawWindow(30, y, 420, 34, questLog.sel === i);
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 48, y + 23);
  }
  const sel = rows[questLog.sel];
  const yD = 64 + rows.length * 38 + 8;
  if (sel && sel.kind === "q" && sideQuests[sel.idx]) {
    const q = sideQuests[sel.idx];
    const lines = questDetailLines(q);
    const bh = 16 + lines.length * 20 + 8;
    drawWindow(30, yD, 420, bh, false);
    ctx.textAlign = "left"; ctx.font = "12px 'MS Gothic', monospace";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? "#9fe0c0" : "#fff";
      wrapText(lines[i], 46, yD + 24 + i * 20, 392, 16);
    }
  }
  ctx.textAlign = "center";
}

// 達成時の報酬付与(共通)。表示用の行を返す
function grantSideReward(q) {
  if (q.status === "done") return [];
  q.status = "done";
  sideQuests = sideQuests.filter((x) => x !== q);
  player.gold += q.gold;
  const ups = addGuildPoints(q.gp);
  const lines = [`依頼『${q.title_ja}』達成！ ＋${q.gold}G ＋GP${q.gp}`];
  if (ups > 0) lines.push(`ギルドランクが ${player.guildLevel} に上がったよ！`);
  return lines;
}
// 町中での達成(おつかい/会話)。コトハがお祝い
function completeSideQuest(q) {
  const lines = grantSideReward(q);
  if (!lines.length) return;
  playTownCutscene([{ who: "コトハ", lines: ["やったね、相棒！", ...lines, "またギルドの依頼ボードを見てみよう！"] }]);
}
// おつかい配達: 対象NPCにアイテムを持って話す
function deliverSideFetch(q, n) {
  for (const k in keys) keys[k] = false;
  useItem(q.item);
  const short = n.name.split(" ").pop();
  const lines = grantSideReward(q);
  playTownCutscene([
    { who: short, lines: [`Oh, the ${q.item}! Thank you so much!`] },
    { who: "コトハ", lines: ["無事に届けられたね！", ...lines] },
  ]);
}
// 会話チャレンジ: 対象NPCと英語で話し、目標を達成するとクリア
function talkSideChallenge(q, n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { completeSideQuest(q); return; }
  Chat.setQuest({
    note: q.note_en,
    intro: `コトハ「依頼ミッション：${q.goal_ja || "この人と英語で話す"}　英語で伝えてみよう！」`,
    flagMessage: "コトハ「依頼を達成できそう！ × でとじよう」",
    onClose: () => completeSideQuest(q),
  });
  Chat.open(n, toeicLevel, () => {});
}

// 美容師Coco: 目的⑧で特徴を聞き出す / 目的⑬でネコを届ける
function talkSalon(n) {
  for (const k in keys) keys[k] = false;
  // 目的⑬: 迷いネコを届ける
  if (quest && quest.stage === 12) { deliverCat(); return; }
  // 目的⑧: ネコの特徴を聞き出す
  if (quest && quest.stage === 7) {
    if (!Chat.aiReady()) { learnCatFeatures(); return; }
    Chat.setQuest({
      note: "the traveler asks about the lost cat — what it looks like, its features, or its favorite food (e.g. \"What does your cat look like?\", \"Can you describe the cat?\", \"What does it like to eat?\"). When they do, describe your cat: it has a black coat and blue eyes, it's a little old, and its favorite food is tuna (マグロ).",
      flagMessage: "コトハ「ネコの特徴がわかったよ！ × でとじよう」",
      onClose: () => learnCatFeatures(),
    });
    Chat.open(n, toeicLevel, () => {});
    return;
  }
  talkToNPC(n);
}

// 目的⑧達成→⑨: 特徴を聞き出した
function learnCatFeatures() {
  if (!quest || quest.stage !== 7) return;
  quest.stage = 8;
  playTownCutscene([{
    who: "コトハ",
    lines: [
      "ネコの特徴を聞き出せたね！ メモしておくよ。",
      "・黒の毛並み　・青い瞳　・少し年老いている",
      "・好きな食べ物は『マグロ』",
      "次は町の人に聞き込みして、ネコの目撃情報をあつめよう！",
    ],
  }]);
}

// 目的⑬達成→⑭: ネコを美容師に届ける(スクリプト演出)
function deliverCat() {
  if (!quest || quest.stage !== 12) return;
  quest.stage = 13;
  useItem("迷いネコ");
  playTownCutscene([
    { who: "Coco", lines: ["Oh, my cat! You found my little one!", "Thank you so much, traveler!"] },
    { who: "コトハ", lines: [
      "Cocoさん、すっごく喜んでるよ！『私のネコ！見つけてくれてありがとう！』だって。",
      "無事に飼い主のところに帰れてよかったね。",
      "さあ、ギルドに戻って依頼達成を報告しよう！",
    ] },
  ]);
}

// 目的⑨: 町の人に迷いネコのことを聞き込み → 教会の裏で目撃証言
function talkCatInfo(n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { catTestimony(n); return; }
  Chat.setQuest({
    note: "the traveler asks if anyone has seen a lost black cat (e.g. \"Have you seen a black cat?\", \"I'm looking for a lost cat\", \"Did you see a cat around here?\"). When they do, tell them you saw a black cat behind the church (\"behind the church\").",
    flagMessage: "コトハ「目撃情報ゲット！ × でとじよう」",
    onClose: () => catTestimony(n),
  });
  Chat.open(n, toeicLevel, () => {});
}

// 目的⑨達成→⑩: 目撃証言を得た
function catTestimony(n) {
  if (!quest || quest.stage !== 8) return;
  quest.stage = 9;
  const who = n && n.name ? n.name.split(" ").pop() : "町の人";
  playTownCutscene([
    { who: who, lines: ["A black cat? Yes...", "I saw it behind the church!"] },
    { who: "コトハ", lines: [
      "『黒いネコなら教会の裏で見かけたよ』だって！",
      "さっそく教会の裏に行ってみよう。ネコがいるかも！",
    ] },
  ]);
}

// 迷いネコに近づいたとき: 目的⑩は逃げる / 目的⑫はマグロで捕獲
function catInteract() {
  for (const k in keys) keys[k] = false;
  // 目的⑫: マグロを持っていれば捕獲
  if (quest && quest.stage === 11) {
    if (hasItem("マグロ")) {
      useItem("マグロ");
      bag["迷いネコ"] = (bag["迷いネコ"] || 0) + 1;
      quest.stage = 12;
      playTownCutscene([{
        who: "コトハ",
        lines: [
          "マグロのにおいにつられて、ネコが寄ってきた…！",
          "そーっと…つかまえた！ 迷いネコを保護したよ！",
          "美容師のCocoさんのところに届けてあげよう。",
        ],
      }]);
    } else {
      // マグロ未所持: 逃げる
      catFleeCutscene(false);
    }
    return;
  }
  // 目的⑩: 近づくと逃げる(初回はコトハがおびき寄せを提案)
  if (quest && quest.stage === 9) {
    catFleeCutscene(true);
    return;
  }
  // それ以外は逃げる
  catFleeCutscene(false);
}

// ネコが逃げる演出。firstはコトハが食べ物作戦を提案(目的⑩→⑪)
function catFleeCutscene(first) {
  catSpot = (catSpot + 1) % CAT_SPOTS.length;
  CAT.tx = CAT_SPOTS[catSpot][0]; CAT.ty = CAT_SPOTS[catSpot][1];
  const lines = first
    ? [
        "あっ、ネコが逃げちゃった！ すばしっこいね…。",
        "このままじゃ捕まえられないよ。",
        "そうだ、ネコの好きな『マグロ』でおびき寄せてみよう！",
        "町に魚屋があるはず。マグロを買いに行こう！",
      ]
    : [
        "わっ、また逃げられちゃった！",
        "やっぱり好物の『マグロ』がないとダメみたい。",
        "魚屋でマグロを買ってこよう！",
      ];
  if (first && quest) quest.stage = 10;
  playTownCutscene([{ who: "コトハ", lines }]);
}

// 宿屋: AI会話で「泊まりたい」と伝えると泊まれる(AI無しなら直接泊まる)
function talkInn(n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { restAtInn(); return; }
  Chat.setQuest({
    note: "the traveler asks to stay the night, sleep, rest, or rent a room at the inn (e.g. \"I want to stay the night\", \"Can I rent a room?\", \"I'd like to rest here\"). When they do, warmly welcome them and tell them to sleep well.",
    flagMessage: "コトハ「泊めてくれるって！ × でとじてやすもう」",
    onClose: () => restAtInn(),
  });
  Chat.open(n, toeicLevel, () => {});
}

// 店: AI会話で「売りたい/買いたい」と伝えるとメニューが開く(AI無しなら直接メニュー)
function talkShop(n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { openShop(n.shop); return; }
  const isMat = n.shop === "material";
  const isFood = !!FOOD_SHOPS[n.shop];
  let note, flagMessage;
  if (isMat) {
    note = "the traveler says they want to sell their materials or items (e.g. \"I want to sell some materials\", \"Can I sell these?\", \"I'd like to sell my stuff\"). When they do, happily agree to take a look at their goods.";
    flagMessage = "コトハ「売れるよ！ × でとじて売却画面へ」";
  } else if (isFood) {
    note = "the traveler says they want to buy food from your shop (e.g. \"I want to buy some tuna\", \"Can I buy fish?\", \"I'd like to buy food\"). When they do, happily agree to show them what you have for sale.";
    flagMessage = "コトハ「買えるよ！ × でとじて購入画面へ」";
  } else {
    note = "the traveler says they want to buy a weapon, armor, or equipment (e.g. \"I want to buy a sword\", \"Show me your weapons\", \"I'd like to buy some armor\"). When they do, happily agree to show your wares.";
    flagMessage = "コトハ「買えるよ！ × でとじて購入画面へ」";
  }
  Chat.setQuest({ note, flagMessage, onClose: () => openShop(n.shop) });
  Chat.open(n, toeicLevel, () => {});
}

function talkToNPC(npc) {
  for (const k in keys) keys[k] = false; // 移動キーが残らないように
  Chat.setQuest(null);
  Chat.open(npc, toeicLevel, () => { /* 会話終了後は街に留まる */ });
}

// AI会話版: "Where is the material shop?" 等を聞けたら素材屋が出てくる
function talkAskDirections(npc) {
  for (const k in keys) keys[k] = false;
  Chat.setQuest({
    note: "the traveler asks where the material shop (素材屋) is, or how to find/reach it. In that situation your reply must tell them, in character and in English, that the material shop's owner is in the toilet right now.",
    flagMessage: "コトハ「やった！ 素材屋さんがトイレから出てきたよ。素材屋の家に入ってみよう！」",
    onFlag: () => revealMaterialShop(),
  });
  Chat.open(npc, toeicLevel, () => { /* 会話終了後は街に留まる */ });
}

function revealMaterialShop() {
  if (!quest) return;
  quest.shopRevealed = true;
  if (quest.stage === 2) quest.stage = 3;
}

// 町の人に素材屋の場所を尋ねる → 素材屋がトイレから出てくる
function askDirections(npc) {
  const who = npc.name.split(" ").pop();
  playTownCutscene([
    { who: "コトハ", lines: ["いいね！ \"Where is the material shop?\" って聞いてみよう！"] },
    { who: who, lines: ["The material shop? Hmm...", "The owner is in the toilet right now!"] },
    { who: "コトハ", lines: ["『素材屋の店主なら、今トイレに行ってるよ』だって。", "なるほど、それで見つからなかったんだ！"] },
    { action: () => { quest.shopRevealed = true; }, who: "コトハ", lines: ["あっ、トイレから出てきた！ あの人が素材屋さんだよ。", "話しかけて素材を売ろう！"] },
  ], () => { quest.stage = 3; });
}

// 町/家の中を背景にしたカットシーン
function playTownCutscene(steps, onDone) {
  for (const k in keys) keys[k] = false;
  cutsceneDraw = drawArea;
  playCutscene(steps, () => {
    cutsceneDraw = null; messageSpeaker = null; state = STATE.TOWN;
    if (onDone) onDone();
  });
}

// 扉を通る(家の中へ／町へ／フィールドへ)
function goThroughDoor(d) {
  if (d.to === "field") { leaveTown(); return; }
  enterArea(d.to, d.spawn);
}
function enterArea(id, spawn) {
  curArea = AREAS[id];
  player.tx = spawn.tx; player.ty = spawn.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = curArea.indoor ? "up" : "down";
  player.moving = false;
  for (const k in keys) keys[k] = false;
  // 素材屋がまだいない(リビール前)演出
  if (id === "material" && !(quest && quest.shopRevealed)) {
    playTownCutscene([{ who: "コトハ", lines: ["あれ？ 素材屋さん、お店にいないね…。", "どこに行ったんだろ？ 町の人に聞いてみよう。"] }]);
  }
}

function enterTown() {
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.town;
  player.tx = TOWN_START.tx; player.ty = TOWN_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  state = STATE.TOWN;
  // 素材を集めて初めて町に来たら、コトハが素材屋探しを提案
  if (quest && quest.stage === 1) {
    quest.stage = 2;
    playTownCutscene([
      { who: "コトハ", lines: ["ここが町だね！ 素材を売れる「素材屋」を探そう。"] },
      { who: "コトハ", lines: ["…でも見当たらないなぁ。町の人に場所を聞いてみよう！", "英語で \"Where is the material shop?\" って聞くんだよ。"] },
      { who: "コトハ", lines: ["（material shop ＝ 素材屋、Where is 〜? ＝ 〜はどこ？）", "だれかに話しかけてみて！"] },
    ]);
  }
}

function leaveTown() {
  player.tx = savedOverworld.tx; player.ty = savedOverworld.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "down"; player.moving = false;
  state = STATE.FIELD;
}

function onArrive() {
  player.tx = player.targetX; player.ty = player.targetY;
  if (state === STATE.TOWN) {
    const d = doorAt(player.tx, player.ty);
    if (d) goThroughDoor(d);
    return;
  }
  const t = tileAt(player.tx, player.ty);
  if (t === "O") { // 町に入る(イベント判定は enterTown 内)
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
    drop: isBoss ? null : src.drop,
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
    const dmg = Math.max(1, battle.eatk + Math.floor(rnd() * 3) - player.def);
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
    const dmg = Math.max(1, battle.eatk + Math.floor(rnd() * 3) - player.def);
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
  // 素材ドロップ
  if (!battle.isBoss && battle.drop) {
    addMaterial(battle.drop);
    lines.push(`「${battle.drop}」を 手に入れた！`);
  }
  // クエスト(討伐数)進行
  if (!battle.isBoss && quest && quest.stage === 0) {
    quest.kills++;
    if (quest.kills >= quest.goal) {
      quest.stage = 1;
      lines.push(`コトハ「5匹たおした！ 素材も集まったね。`);
      lines.push(`　町(赤い屋根)へ向かって換金しよう！」`);
    }
  }
  // ギルド討伐依頼(サブクエスト)の進行
  if (!battle.isBoss) {
    for (const q of [...sideQuests]) {
      if (q.type !== "hunt" || q.status !== "active") continue;
      if (q.enemy !== "any" && q.enemy !== battle.name) continue;
      q.progress++;
      if (q.progress >= q.count) lines.push(...grantSideReward(q));
      else lines.push(`ギルド依頼『${q.title_ja}』 ${q.progress}/${q.count}`);
    }
  }
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
    else if (autoEncounter) { startBattle(false); } // オート: フィールドに戻らず即・次の戦闘
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
  msgAutoTimer = AUTO_MSG_DELAY; // オート時の自動送り用
}
function advanceMessage() {
  msgAutoTimer = AUTO_MSG_DELAY; // 次の行/次メッセージも自動送りの間隔をリセット
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
  try { update(dt); render(); }
  catch (e) { drawFatal(e); }
  requestAnimationFrame(loop); // 例外が出ても次フレームは必ず予約(固まり防止)
}
// 想定外エラーを画面に表示(真っ暗で固まらないように)
function drawFatal(e) {
  try {
    ctx.fillStyle = "#330d0d"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "13px monospace";
    ctx.fillText("⚠ エラーが発生しました", 14, 36);
    ctx.font = "11px monospace"; ctx.fillStyle = "#ffd24a";
    ctx.fillText(((e && e.message) || String(e)).slice(0, 56), 14, 60);
    ctx.fillStyle = "#bbb";
    ((e && e.stack) || "").split("\n").slice(1, 7).forEach((l, i) => ctx.fillText(l.trim().slice(0, 58), 14, 86 + i * 16));
  } catch (_) {}
}
function update(dt) {
  gameTime += dt;
  if (quiz && quiz.wrong > 0) quiz.wrong -= dt * 0.05;
  if (shop && shop.msgT > 0) shop.msgT -= dt;
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
  // オート戦闘: フィールドにいる間、歩かなくても一定間隔で自動エンカウント
  if (autoEncounter && state === STATE.FIELD && !battle && !Chat.isOpen()) {
    autoTimer -= dt;
    if (autoTimer <= 0) { autoTimer = 900; startBattle(false); }
  }
  // オート戦闘中は戦闘ナレーション(出現/ダメージ/攻撃/経験値/入手など)を自動送り
  // ※4択の回答は手動のまま(STATE.BATTLE は対象外)
  if (autoEncounter && state === STATE.MESSAGE && battle && !Chat.isOpen()) {
    msgAutoTimer -= dt;
    if (msgAutoTimer <= 0) advanceMessage();
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
    case STATE.TOWN: drawArea(); break;
    case STATE.MESSAGE:
      if (cutsceneDraw) cutsceneDraw(); else if (battle) drawBattleScene(); else drawField();
      drawMessageWindow();
      break;
    case STATE.QUIZ:
      if (cutsceneDraw) cutsceneDraw(); else drawField();
      drawQuizUI();
      break;
    case STATE.SHOP: drawShop(); break;
    case STATE.BOARD: drawQuestBoard(); break;
    case STATE.QUESTLOG: drawQuestLog(); break;
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
  camX = 0; camY = 0; // フィールドは15×15で画面ぴったり(スクロールなし)
  // タイル
  for (let y = 0; y < MAP_N; y++) {
    for (let x = 0; x < MAP_N; x++) {
      drawTile(MAP[y][x], x * TILE, y * TILE);
    }
  }
  // プレイヤー
  drawHero(player.px - camX, player.py - camY, player.dir, player.anim);
  drawKotoha(player.px - camX + 30, player.py - camY + 8, 0.6); // 相棒コトハが隣を飛ぶ
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
  const reg = player.guildLevel > 0;
  drawWindow(8, 8, 196, reg ? 96 : 76, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(`Lv ${player.level}   ${player.gold}G`, 20, 28);
  ctx.fillText(`HP ${player.hp}/${player.maxhp}`, 20, 48);
  ctx.fillText(`こうげき${player.atk}  ぼうぎょ${player.def}`, 20, 68);
  if (reg) {
    ctx.fillStyle = "#ffd24a";
    ctx.fillText(`ギルドLv${player.guildLevel}  GP${player.guildPoints}/${player.guildLevel * 100}`, 20, 88);
  }
  ctx.textAlign = "center";
  drawRightPanel();
}

// 画面右上: いまの目的＋集めた素材
function drawRightPanel() {
  const bx = W - 196, bw = 188;
  let y = 8;
  const ql = questLines();
  if (ql) {
    const bh = 26 + ql.length * 18 + 4;
    drawWindow(bx, y, bw, bh, false);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffe082"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText("● いまの目的", bx + 10, y + 20);
    ctx.fillStyle = "#fff";
    for (let i = 0; i < ql.length; i++) ctx.fillText(ql[i], bx + 10, y + 40 + i * 18);
    y += bh + 6;
  }
  const items = [...Object.entries(materials), ...Object.entries(bag)].slice(0, 6);
  if (items.length) {
    const bh = 24 + items.length * 16 + 4;
    drawWindow(bx, y, bw, bh, false);
    ctx.textAlign = "left";
    ctx.fillStyle = "#9fe0c0"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText("● もちもの", bx + 10, y + 19);
    ctx.fillStyle = "#fff"; ctx.font = "11px 'MS Gothic', monospace";
    for (let i = 0; i < items.length; i++) ctx.fillText(`${items[i][0]} ×${items[i][1]}`, bx + 10, y + 37 + i * 16);
    y += bh + 6;
  }
  // ギルド依頼(受注中サブクエスト)
  if (sideQuests.length) {
    const sq = sideQuests.slice(0, 3);
    const bh = 24 + sq.length * 16 + 16;
    drawWindow(bx, y, bw, bh, false);
    sideQuestBoxRect = { x: bx, y, w: bw, h: bh }; // タップで詳細を開く
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd24a"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText("● ギルド依頼", bx + 10, y + 19);
    ctx.fillStyle = "#fff"; ctx.font = "11px 'MS Gothic', monospace";
    for (let i = 0; i < sq.length; i++) {
      const q = sq[i];
      const prog = q.type === "hunt" ? ` ${q.progress}/${q.count}` : "";
      ctx.fillText(`${questIcon(q.type)} ${trimLabel(q.title_ja, 11)}${prog}`, bx + 10, y + 37 + i * 16);
    }
    ctx.fillStyle = "#9fd6ff"; ctx.font = "10px 'MS Gothic', monospace";
    ctx.fillText("▶ タップで詳細", bx + 10, y + 37 + sq.length * 16);
  } else {
    sideQuestBoxRect = null;
  }
  ctx.textAlign = "center";
}
function trimLabel(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

// ===== エリア描画 (町＆家の中・カメラ追従) =====
function drawArea() {
  const a = curArea;
  updateCamera(a.cols, a.rows);
  ctx.fillStyle = a.indoor ? "#140d05" : "#2e5a28"; ctx.fillRect(0, 0, W, H);
  const c0 = Math.max(0, Math.floor(camX / TILE)), c1 = Math.min(a.cols - 1, Math.floor((camX + W) / TILE));
  const r0 = Math.max(0, Math.floor(camY / TILE)), r1 = Math.min(a.rows - 1, Math.floor((camY + H) / TILE));
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const px = x * TILE - camX, py = y * TILE - camY;
      if (a.indoor) drawInteriorTile(a.map[y][x], px, py);
      else drawTownTile(a.map[y][x], px, py);
    }
  }
  if (a.decor) for (const d of a.decor) drawDecor(d.kind, d.tx * TILE - camX, d.ty * TILE - camY);
  // 扉ラベル(でぐち／家の名前)
  ctx.textAlign = "center"; ctx.font = "11px 'MS Gothic', monospace";
  for (const d of a.doors) {
    const label = (d.to === "field" || d.to === "town") ? "でぐち" : (AREAS[d.to] ? AREAS[d.to].name : "");
    if (!label) continue;
    const lx = d.tx * TILE + TILE / 2 - camX, ly = d.ty * TILE - 3 - camY;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(lx - w / 2, ly - 11, w, 13);
    ctx.fillStyle = "#ffe082"; ctx.fillText(label, lx, ly);
  }
  for (const n of a.npcs) if (npcVisible(n)) drawNPC(n);
  drawHero(player.px - camX, player.py - camY, player.dir, player.anim);
  drawKotoha(player.px - camX + 30, player.py - camY + 8, 0.6);

  drawHud();
}

function drawInteriorTile(t, px, py) {
  if (t === "#") {
    ctx.fillStyle = "#5a4636"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#6b5340"; ctx.fillRect(px + 2, py + 2, TILE - 4, 8);
    ctx.fillStyle = "#4a382a"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    return;
  }
  // 木の床
  ctx.fillStyle = "#b58a52"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#a87c46"; ctx.fillRect(px, py + TILE - 3, TILE, 3);
  ctx.strokeStyle = "rgba(0,0,0,0.07)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py + 0.5); ctx.lineTo(px + TILE, py + 0.5); ctx.stroke();
  if (t === "D") { // 玄関マット(出口)
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function drawTownTile(t, px, py) {
  if (t === "#") {
    ctx.fillStyle = "#7a5a3a"; ctx.fillRect(px, py, TILE, TILE);          // 建物
    ctx.fillStyle = "#8a6a44"; ctx.fillRect(px + 2, py + 2, TILE - 4, 8);
    ctx.fillStyle = "#5a4028"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    return;
  }
  // 地面(草)
  ctx.fillStyle = "#3f7a34"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#46863a"; ctx.fillRect(px + 5, py + 7, 3, 3); ctx.fillRect(px + 20, py + 16, 3, 3); ctx.fillRect(px + 12, py + 24, 3, 3);
  if (t === "T") {
    ctx.fillStyle = "#5d4037"; ctx.fillRect(px + 14, py + 18, 5, 10);
    ctx.fillStyle = "#1f7a25"; ctx.beginPath(); ctx.arc(px + 16, py + 12, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2e9a32"; ctx.beginPath(); ctx.arc(px + 13, py + 10, 6, 0, Math.PI * 2); ctx.fill();
  } else if (t === "D") {
    ctx.fillStyle = "#caa46a"; ctx.fillRect(px + 4, py, TILE - 8, TILE);
    ctx.fillStyle = "#7a4a22"; ctx.fillRect(px + 9, py + 2, 14, 22);
    ctx.fillStyle = "#ffd24a"; ctx.fillRect(px + 19, py + 13, 3, 3);
  }
}

// ===== 内装(家具)の描画 =====
function drawDecor(kind, x, y) {
  switch (kind) {
    case "toilet": drawToilet(x, y); break;
    case "bed": drawBed(x, y); break;
    case "table": drawTable(x, y); break;
    case "plant": drawPlant(x, y); break;
    case "lamp": drawLamp(x, y); break;
    case "rug": drawRug(x, y); break;
    case "shelf": drawShelf(x, y); break;
    case "barrel": drawBarrel(x, y); break;
    case "crate": drawCrate(x, y); break;
    case "weaponrack": drawWeaponRack(x, y); break;
    case "armorstand": drawArmorStand(x, y); break;
    case "anvil": drawAnvil(x, y); break;
    case "forge": drawForge(x, y); break;
    case "counter": drawCounter(x, y); break;
    case "board": drawBoard(x, y); break;
  }
}

function drawBed(x, y) {
  ctx.fillStyle = "#6a4a2a"; ctx.fillRect(x + 3, y + 1, 26, 30);
  ctx.fillStyle = "#efe7d6"; ctx.fillRect(x + 5, y + 3, 22, 26);
  ctx.fillStyle = "#fff"; ctx.fillRect(x + 6, y + 4, 20, 7);
  ctx.fillStyle = "#c0506a"; ctx.fillRect(x + 5, y + 14, 22, 15);
  ctx.fillStyle = "#a83a54"; ctx.fillRect(x + 5, y + 25, 22, 4);
  ctx.fillStyle = "#5a3a1e"; ctx.fillRect(x + 3, y + 28, 4, 4); ctx.fillRect(x + 25, y + 28, 4, 4);
}
function drawToilet(x, y) {
  ctx.fillStyle = "#cfd8dc"; ctx.fillRect(x + 3, y + 6, 26, 24);
  ctx.fillStyle = "#455a64"; ctx.fillRect(x + 2, y + 2, 28, 6);
  ctx.fillStyle = "#5d4037"; ctx.fillRect(x + 11, y + 14, 10, 16);
  ctx.fillStyle = "#1565c0"; ctx.font = "8px 'MS Gothic', monospace"; ctx.textAlign = "center";
  ctx.fillText("WC", x + 16, y + 13);
  ctx.textAlign = "center";
}
function drawTable(x, y) {
  ctx.fillStyle = "#8a5a2e"; ctx.fillRect(x + 4, y + 12, 24, 6);   // 天板
  ctx.fillStyle = "#6a4422"; ctx.fillRect(x + 6, y + 18, 4, 12); ctx.fillRect(x + 22, y + 18, 4, 12); // 脚
  ctx.fillStyle = "#caa46a"; ctx.fillRect(x + 8, y + 7, 6, 6);     // パン
  ctx.fillStyle = "#c0506a"; ctx.beginPath(); ctx.arc(x + 21, y + 9, 4, 0, Math.PI * 2); ctx.fill(); // りんご
}
function drawPlant(x, y) {
  ctx.fillStyle = "#7a4a28"; ctx.fillRect(x + 9, y + 20, 14, 10);  // 鉢
  ctx.fillStyle = "#5a3418"; ctx.fillRect(x + 9, y + 20, 14, 3);
  ctx.fillStyle = "#2e8a30"; ctx.beginPath(); ctx.arc(x + 16, y + 12, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3aa83a"; ctx.beginPath(); ctx.arc(x + 12, y + 9, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 20, y + 10, 5, 0, Math.PI * 2); ctx.fill();
}
function drawLamp(x, y) {
  ctx.fillStyle = "#5a4028"; ctx.fillRect(x + 14, y + 12, 4, 18);  // 柱
  ctx.fillStyle = "#caa050"; ctx.beginPath(); ctx.moveTo(x + 9, y + 12); ctx.lineTo(x + 23, y + 12); ctx.lineTo(x + 19, y + 4); ctx.lineTo(x + 13, y + 4); ctx.fill();
  ctx.fillStyle = "rgba(255,220,120,0.5)"; ctx.beginPath(); ctx.arc(x + 16, y + 10, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff6c8"; ctx.beginPath(); ctx.arc(x + 16, y + 9, 3, 0, Math.PI * 2); ctx.fill();
}
function drawRug(x, y) {
  ctx.fillStyle = "#7a3a3a"; ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8);
  ctx.strokeStyle = "#caa050"; ctx.lineWidth = 2; ctx.strokeRect(x + 5, y + 7, TILE - 10, TILE - 14);
  ctx.fillStyle = "#caa050"; ctx.fillRect(x + 14, y + 13, 4, 6);
}
function drawShelf(x, y) {
  ctx.fillStyle = "#6a4a28"; ctx.fillRect(x + 2, y + 2, 28, 28);
  ctx.fillStyle = "#4a3018"; ctx.fillRect(x + 2, y + 11, 28, 3); ctx.fillRect(x + 2, y + 20, 28, 3);
  ctx.fillStyle = "#c0506a"; ctx.fillRect(x + 5, y + 5, 5, 5);    // 小瓶など
  ctx.fillStyle = "#5588ff"; ctx.fillRect(x + 13, y + 5, 5, 5);
  ctx.fillStyle = "#5aa84a"; ctx.fillRect(x + 21, y + 5, 5, 5);
  ctx.fillStyle = "#caa46a"; ctx.fillRect(x + 6, y + 15, 7, 4); ctx.fillRect(x + 18, y + 15, 7, 4);
  ctx.fillStyle = "#9a7a4a"; ctx.fillRect(x + 6, y + 24, 18, 4);
}
function drawBarrel(x, y) {
  ctx.fillStyle = "#8a5a2e"; ctx.fillRect(x + 7, y + 6, 18, 24);
  ctx.fillStyle = "#6a4422"; ctx.fillRect(x + 5, y + 10, 22, 3); ctx.fillRect(x + 5, y + 22, 22, 3);
  ctx.fillStyle = "#a87844"; ctx.fillRect(x + 7, y + 6, 18, 3);
  ctx.fillStyle = "#5a3a1e"; ctx.beginPath(); ctx.ellipse(x + 16, y + 7, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
}
function drawCrate(x, y) {
  ctx.fillStyle = "#9a6a36"; ctx.fillRect(x + 5, y + 8, 22, 22);
  ctx.strokeStyle = "#6a4422"; ctx.lineWidth = 2; ctx.strokeRect(x + 5, y + 8, 22, 22);
  ctx.beginPath(); ctx.moveTo(x + 5, y + 8); ctx.lineTo(x + 27, y + 30); ctx.moveTo(x + 27, y + 8); ctx.lineTo(x + 5, y + 30); ctx.stroke();
}
function drawWeaponRack(x, y) {
  ctx.fillStyle = "#5a4028"; ctx.fillRect(x + 3, y + 4, 26, 4); ctx.fillRect(x + 3, y + 26, 26, 4); // 棚
  // 剣
  ctx.strokeStyle = "#cfd8e0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 9, y + 6); ctx.lineTo(x + 9, y + 26); ctx.stroke();
  ctx.fillStyle = "#caa050"; ctx.fillRect(x + 6, y + 22, 6, 3);
  // 盾
  ctx.fillStyle = "#3a6aa0"; ctx.beginPath(); ctx.arc(x + 21, y + 16, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#cfd8e0"; ctx.beginPath(); ctx.arc(x + 21, y + 16, 3, 0, Math.PI * 2); ctx.fill();
}
function drawArmorStand(x, y) {
  ctx.fillStyle = "#5a4028"; ctx.fillRect(x + 14, y + 20, 4, 10);
  ctx.fillStyle = "#9098b0"; ctx.fillRect(x + 8, y + 8, 16, 14);  // 胴
  ctx.fillStyle = "#b0b8d0"; ctx.fillRect(x + 8, y + 8, 16, 4);
  ctx.fillStyle = "#7a82a0"; ctx.fillRect(x + 14, y + 12, 4, 8);  // 中央線
}
function drawAnvil(x, y) {
  ctx.fillStyle = "#3a3a42"; ctx.fillRect(x + 8, y + 22, 16, 8);   // 台
  ctx.fillStyle = "#55555f"; ctx.fillRect(x + 6, y + 14, 20, 6);   // 上面
  ctx.fillStyle = "#55555f"; ctx.beginPath(); ctx.moveTo(x + 26, y + 14); ctx.lineTo(x + 30, y + 16); ctx.lineTo(x + 26, y + 20); ctx.fill(); // 角
  ctx.fillStyle = "#6a6a74"; ctx.fillRect(x + 6, y + 14, 20, 2);
}
function drawCounter(x, y) {
  ctx.fillStyle = "#7a5226"; ctx.fillRect(x + 1, y + 12, 30, 18);  // 本体
  ctx.fillStyle = "#9a6a36"; ctx.fillRect(x, y + 9, 32, 5);        // 天板
  ctx.fillStyle = "#5a3a1a"; ctx.fillRect(x + 1, y + 26, 30, 3);
}
function drawBoard(x, y) {
  ctx.fillStyle = "#5a3a1a"; ctx.fillRect(x + 5, y + 24, 4, 6); ctx.fillRect(x + 23, y + 24, 4, 6); // 脚
  ctx.fillStyle = "#8a6038"; ctx.fillRect(x + 2, y + 3, 28, 22);   // 板
  ctx.strokeStyle = "#5a3a1a"; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 3, 28, 22);
  ctx.fillStyle = "#efe7d0"; ctx.fillRect(x + 6, y + 7, 7, 8); ctx.fillRect(x + 17, y + 6, 8, 7); ctx.fillRect(x + 9, y + 16, 9, 6); // 貼り紙
  ctx.fillStyle = "#b03030"; ctx.beginPath(); ctx.arc(x + 9, y + 8, 1.5, 0, Math.PI * 2); ctx.fill(); // 画びょう
}
function drawForge(x, y) {
  ctx.fillStyle = "#4a4036"; ctx.fillRect(x + 4, y + 6, 24, 24);   // 炉
  ctx.fillStyle = "#2a2420"; ctx.fillRect(x + 9, y + 12, 14, 14);  // 焚き口
  const f = 1 + Math.sin(gameTime / 120) * 0.3;
  ctx.fillStyle = "#ff7a1a"; ctx.beginPath(); ctx.arc(x + 16, y + 22, 6 * f, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(x + 16, y + 23, 3 * f, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6a5a4a"; ctx.fillRect(x + 4, y + 4, 24, 3);
}

function drawNPC(n) {
  const x = n.tx * TILE - camX, y = n.ty * TILE - camY;
  if (n.id === "cat") { drawCat(x, y); return; }
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

function drawCat(x, y) {
  const b = Math.sin(gameTime / 250) * 1.5;
  // しっぽ
  ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 7, y + 24); ctx.quadraticCurveTo(x + 1, y + 20, x + 4, y + 14); ctx.stroke();
  // 体
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(x + 8, y + 16, 16, 11);
  ctx.beginPath(); ctx.ellipse(x + 16, y + 16, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  // 頭
  ctx.beginPath(); ctx.arc(x + 21, y + 13 + b, 7, 0, Math.PI * 2); ctx.fill();
  // 耳
  ctx.beginPath(); ctx.moveTo(x + 16, y + 8 + b); ctx.lineTo(x + 18, y + 2 + b); ctx.lineTo(x + 21, y + 8 + b); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 22, y + 8 + b); ctx.lineTo(x + 25, y + 2 + b); ctx.lineTo(x + 27, y + 8 + b); ctx.fill();
  // 目(青)
  ctx.fillStyle = "#4ab0ff"; ctx.fillRect(x + 18, y + 12 + b, 2, 3); ctx.fillRect(x + 23, y + 12 + b, 2, 3);
  // 足
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(x + 9, y + 26, 4, 4); ctx.fillRect(x + 19, y + 26, 4, 4);
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
    { who: "コトハ", lines: ["元の世界に帰る手がかりも、きっと人との会話の中にあるはず。"] },
    { who: "コトハ", lines: ["でもまずは旅の資金！ 宿屋に泊まるにもお金がいるの。", "モンスターをたおすと素材が手に入るから、それを町で換金しよう。"] },
    { who: "コトハ", lines: ["まずはモンスターを5匹たおして素材集め！", "それから町(赤い屋根の建物)へ向かおう。さ、行くよ相棒！"] },
  ], () => { setupFirstQuest(); cutsceneDraw = null; messageSpeaker = null; state = STATE.FIELD; });
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
// コトハ: 空を飛ぶ幼い女の子の精霊
function drawKotoha(cx, cy, scale) {
  const s = scale || 1;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
  const y = cy + Math.sin(gameTime / 300) * 5;
  // 精霊の光
  ctx.fillStyle = "rgba(123,224,210,0.22)";
  ctx.beginPath(); ctx.arc(cx, y, 20, 0, Math.PI * 2); ctx.fill();
  // 羽(半透明)
  ctx.fillStyle = "rgba(190,245,236,0.65)";
  ctx.beginPath(); ctx.ellipse(cx - 10, y + 1, 6, 10, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 10, y + 1, 6, 10, -0.5, 0, Math.PI * 2); ctx.fill();
  // ドレス(白×ティール)
  ctx.fillStyle = "#eafffb";
  ctx.beginPath(); ctx.moveTo(cx - 8, y + 13); ctx.lineTo(cx + 8, y + 13); ctx.lineTo(cx + 5, y + 1); ctx.lineTo(cx - 5, y + 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#7be0d2"; ctx.fillRect(cx - 8, y + 11, 16, 3);
  // 手足(肌)
  ctx.fillStyle = "#f7d3a0"; ctx.fillRect(cx - 4, y + 13, 3, 4); ctx.fillRect(cx + 1, y + 13, 3, 4);
  // 頭(肌)
  ctx.fillStyle = "#f7d3a0"; ctx.beginPath(); ctx.arc(cx, y - 5, 7, 0, Math.PI * 2); ctx.fill();
  // 髪(ミント・ツインテール)
  ctx.fillStyle = "#8fe6d6";
  ctx.beginPath(); ctx.arc(cx, y - 7, 7, Math.PI, 0); ctx.fill();
  ctx.fillRect(cx - 7, y - 8, 3, 7); ctx.fillRect(cx + 4, y - 8, 3, 7);
  ctx.beginPath(); ctx.arc(cx - 8, y - 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 8, y - 2, 3, 0, Math.PI * 2); ctx.fill();
  // 目(大きめ)・ほっぺ
  ctx.fillStyle = "#27424a"; ctx.fillRect(cx - 4, y - 6, 2, 3); ctx.fillRect(cx + 2, y - 6, 2, 3);
  ctx.fillStyle = "#fff"; ctx.fillRect(cx - 4, y - 6, 1, 1); ctx.fillRect(cx + 2, y - 6, 1, 1);
  ctx.fillStyle = "rgba(255,140,150,0.6)"; ctx.fillRect(cx - 6, y - 3, 2, 2); ctx.fillRect(cx + 4, y - 3, 2, 2);
  // きらきら
  ctx.fillStyle = "#fff";
  ctx.fillRect(cx + 15, y - 13, 2, 2); ctx.fillRect(cx - 17, y + 7, 2, 2);
  ctx.restore();
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
