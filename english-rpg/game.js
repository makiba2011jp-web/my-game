"use strict";

// ===== 基本セットアップ =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = 480, H = 480;
const TILE = 32, MAP_N = 15;
ctx.imageSmoothingEnabled = false;

// ===== ゲーム状態 =====
const STATE = { TITLE: "title", NAME: "name", FIELD: "field", TOWN: "town", BATTLE: "battle", BOSSBATTLE: "bossbattle", MESSAGE: "message", QUIZ: "quiz", SHOP: "shop", NPCMENU: "npcmenu", BOARD: "board", QUESTLOG: "questlog", WORDLIST: "wordlist", STORAGE: "storage", EQUIP: "equip", GAMEOVER: "gameover", CLEAR: "clear" };
let state = STATE.TITLE;

// プレイヤー
const player = {
  name: "まきば", // オープニングで入力
  tx: 2, ty: 12, px: 2 * TILE, py: 12 * TILE,
  dir: "down", moving: false, anim: 0,
  level: 1, hp: 20, maxhp: 20, atk: 6, def: 0, exp: 0, nextExp: 10,
  baseAtk: 6, baseDef: 0, baseMaxhp: 20, // 素の値(レベルで上がる)。装備分は recomputeStats で加算
  gold: 0, wins: 0,
  guildLevel: 0, guildPoints: 0, // 0=未登録、1〜=ギルドランク
};
// 装備スロット(SHOP_ITEMSのindexを入れる。nullは未装備)
let equipped = { weapon: null, head: null, armor: null, shield: null, accessory: null };
const EQUIP_SLOTS = ["weapon", "head", "armor", "shield", "accessory"];
const SLOT_JA = { weapon: "武器", head: "頭", armor: "鎧", shield: "盾", accessory: "アクセ" };
// 装備の合計ボーナスを反映して player.atk/def/maxhp を再計算
function recomputeStats() {
  let a = 0, d = 0, h = 0;
  for (const s of EQUIP_SLOTS) {
    const i = equipped[s];
    if (i != null && SHOP_ITEMS[i]) { const it = SHOP_ITEMS[i]; a += it.atk || 0; d += it.def || 0; h += it.hp || 0; }
  }
  player.atk = player.baseAtk + a;
  player.def = player.baseDef + d;
  player.maxhp = player.baseMaxhp + h;
  if (player.hp > player.maxhp) player.hp = player.maxhp;
}

let toeicLevel = 500;     // 選択された難易度
let stepsToEncounter = 0; // エンカウントまでの歩数
let autoEncounter = false; // オート戦闘(フィールドで歩かず自動エンカウント)
let autoTimer = 0;         // 次の自動エンカウントまでの残り時間(ms)
let msgAutoTimer = 0;      // オート時のメッセージ自動送りタイマー(ms)
const AUTO_MSG_DELAY = 700; // メッセージ1枚あたりの自動送り間隔(ms)
let wordCorrect = {};     // 単語ごとの正解回数(en -> 回数)。出題ウェイト計算に使用
let npcAffection = {};    // NPCごとの好感度(id -> 0〜100)。良い英語の会話で上がる
let affectionRecent = {}; // NPCごとの直近発言(正規化)。単調/繰り返しの無効点判定用(会話ごとにリセット)
let metNPCs = new Set();  // 一度会話したNPCのid。次から名前で呼んでくれる
let ownedHome = null;     // 所有しているマイホームのid(null=未購入)
let ownedFridge = false;  // 冷蔵庫を購入してマイホームに設置済みか
let ownedTV = false;      // テレビを購入してマイホームに設置済みか
let fridge = {};          // 冷蔵庫に保管中の食料品(生) 名前->個数
let fridgeDishes = [];    // 冷蔵庫に保管中の料理 [{name,...}]
let whBag = {};           // 倉庫に保管中の持ち物 名前->個数
let whMat = {};           // 倉庫に保管中の素材 名前->個数
let storageUI = null;     // 収納UIの状態 { kind:"fridge"|"warehouse", sel, page }
const STORAGE_PER_PAGE = 10; // 1ページの表示件数
let tvChannel = "";       // テレビの現在チャンネル(演出用)
// 不動産屋で買える物件(安い順)。買うと町の「売り家」が「マイホーム」になる
const HOME_PROPERTIES = [
  { id: "cottage", name: "ボロ小屋",     en: "Old Cottage", price: 500,  decor: "home_cottage" },
  { id: "stone",   name: "石造りの家",   en: "Stone House", price: 2000, decor: "home_stone" },
  { id: "manor",   name: "大きな邸宅",   en: "Grand Manor", price: 8000, decor: "home_manor" },
];
// 大きな邸宅だけの設備: 召喚魔法陣＋召喚料理の大鍋
const HOME_SUMMON_DECOR = [{ tx: 3, ty: 6, kind: "summoncircle" }, { tx: 9, ty: 6, kind: "cauldron" }];
// 所有グレードに応じてマイホームの内装と表示名を更新
function refreshHome() {
  const p = ownedHome && HOME_PROPERTIES.find((x) => x.id === ownedHome);
  AREAS.home.name = p ? "My Home" : "For Sale";
  let decor = p ? (DECOR_TEMPLATES[p.decor] || []).concat(HOME_GARDEN_DECOR) : [];
  if (p) decor = decor.concat([{ tx: 7, ty: 7, kind: "warehouse" }]); // 全マイホームに倉庫
  if (p && p.id === "manor") decor = decor.concat(HOME_SUMMON_DECOR); // 邸宅のみ召喚設備
  if (p && ownedFridge) decor = decor.concat([{ tx: 2, ty: 3, kind: "fridge" }]); // 購入した家電を設置
  if (p && ownedTV) decor = decor.concat([{ tx: 5, ty: 3, kind: "tv" }]);
  AREAS.home.decor = decor;
}

// chat.js から参照: 主人公名 / NPCが面識ありか / 面識を記録
window.getPlayerName = () => player.name;
window.npcKnowsName = (id) => metNPCs.has(id);
window.markNPCMet = (id) => { if (id) metNPCs.add(id); };
const BATTLE_SPK = { x: 420, y: 258, w: 38, h: 38 }; // バトルの🔊読み上げボタン領域
const SAVE_KEY = "isekai_eigo_save_v1"; // セーブデータの保存先(localStorage)
let autoSaveTimer = 0;    // 自動セーブの間隔タイマー(ms)
let toastMsg = "", toastT = 0; // 画面に一瞬出す通知(セーブしました等)

// マップ (T=木 W=水 G=草 O=町 C=城/魔王 X=ダンジョン入口 Y=タワー入口 Z=氷の洞窟入口 F=炎の遺跡入口)
const MAP = [
  "TTTTTTTTTTTTTTT",
  "TGGGGGGGGGGYGGT",
  "TGGGTTTGGGGGGGT",
  "TGGGTGGGGGWWGGT",
  "TGGGGGGGGGWWGGT",
  "TGGOGGGGGXGGGGT",
  "TGGGGGGGTTGGGGT",
  "TGGGGGGGTGGGGGT",
  "TGGGGGGZGGGGGGT",
  "TGGWWGGGGGGGGGT",
  "TGGWWGGGGGTTGGT",
  "TGGGGGGGGGTGGGT",
  "TGGFGGGGGGGGGGT",
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
  inn:        { name: "Inn",          npc: { id: "innkeeper",  name: "宿屋の女将 Marian", color: "#e0a060" }, decor: "inn" },
  restaurant: { name: "Restaurant",   npc: { id: "restaurant", name: "料理人 Tom",        color: "#c08a3e" }, decor: "restaurant" },
  bar:        { name: "Bar",          npc: { id: "bar",        name: "バーの主人 Sal",    color: "#9a5a3a" }, decor: "bar" },
  bank:       { name: "Bank",         npc: { id: "bank",       name: "銀行員 Greta",      color: "#5a7a8a" }, decor: "bank" },
  school:     { name: "School",       npc: { id: "school",     name: "先生 Edwin",        color: "#7a8a5a" }, decor: "school" },
  hospital:   { name: "Hospital",     npc: { id: "hospital",   name: "医者 Hale",         color: "#cfd8dc" }, decor: "hospital" },
  church:     { name: "Church",       npc: { id: "church",     name: "シスター Clara",    color: "#d0d0e8" }, decor: "church" },
  weapon:     { name: "Weapon Shop",  npc: { id: "weaponshop", name: "武器屋 Dunn",       color: "#8fa0c0", shop: "weapon" }, decor: "weapon" },
  material:   { name: "Material Shop", npc: { id: "matshop",   name: "素材屋 Gil",        color: "#c08a3e", shop: "material" }, decor: "material" },
  smith:      { name: "Smithy",       npc: { id: "smith",      name: "鍛冶屋 Borin",      color: "#9098b0" }, decor: "smith" },
  salon:      { name: "Salon",        npc: { id: "salon",      name: "美容師 Coco",       color: "#d07ab0" }, decor: "salon" },
  police:     { name: "Police",       npc: { id: "police",     name: "警官 Bruno",        color: "#3a5a8a" }, decor: "police" },
  florist:    { name: "Flower Shop",  npc: { id: "florist",    name: "花屋 リリィ",       color: "#e57aa0" }, decor: "florist" },
  realestate: { name: "Real Estate",  npc: { id: "realestate", name: "不動産屋 Estelle",   color: "#b0884a" }, decor: "realestate" },
  appliance:  { name: "Appliance Shop", npc: { id: "appliance", name: "家電屋 デン",       color: "#5a8a8a", shop: "appliance" }, decor: "appliance" },
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
  florist:    [{ tx: 1, ty: 1, kind: "plant" }, { tx: 9, ty: 1, kind: "plant" }, { tx: 1, ty: 4, kind: "plant" }, { tx: 9, ty: 4, kind: "plant" }, { tx: 2, ty: 3, kind: "plant" }, { tx: 8, ty: 3, kind: "plant" }, { tx: 3, ty: 5, kind: "plant" }, { tx: 7, ty: 5, kind: "plant" }],
  realestate: [{ tx: 1, ty: 1, kind: "shelf" }, { tx: 9, ty: 1, kind: "shelf" }, { tx: 2, ty: 3, kind: "table" }, { tx: 8, ty: 3, kind: "counter" }, { tx: 1, ty: 5, kind: "board" }, { tx: 9, ty: 5, kind: "plant" }],
  appliance:  [{ tx: 1, ty: 1, kind: "fridge" }, { tx: 9, ty: 1, kind: "tv" }, { tx: 1, ty: 4, kind: "tv" }, { tx: 9, ty: 4, kind: "fridge" }, { tx: 2, ty: 5, kind: "crate" }, { tx: 8, ty: 5, kind: "crate" }],
  // マイホーム(購入グレード別の内装。マップは13×11のHOME_MAP)
  home_cottage: [{ tx: 1, ty: 5, kind: "bed" }, { tx: 1, ty: 7, kind: "barrel" }, { tx: 3, ty: 7, kind: "crate" }, { tx: 8, ty: 7, kind: "desk" }],
  home_stone:   [{ tx: 1, ty: 5, kind: "bed" }, { tx: 3, ty: 6, kind: "table" }, { tx: 1, ty: 7, kind: "shelf" }, { tx: 5, ty: 5, kind: "plant" }, { tx: 1, ty: 1, kind: "lamp" }, { tx: 5, ty: 1, kind: "lamp" }, { tx: 3, ty: 7, kind: "rug", solid: false }, { tx: 8, ty: 7, kind: "desk" }, { tx: 8, ty: 5, kind: "stove" }, { tx: 9, ty: 5, kind: "sink" }],
  home_manor:   [{ tx: 1, ty: 5, kind: "bed" }, { tx: 3, ty: 5, kind: "bed" }, { tx: 1, ty: 7, kind: "shelf" }, { tx: 3, ty: 7, kind: "table" }, { tx: 5, ty: 5, kind: "plant" }, { tx: 1, ty: 1, kind: "lamp" }, { tx: 5, ty: 1, kind: "lamp" }, { tx: 10, ty: 7, kind: "shelf" }, { tx: 9, ty: 7, kind: "table" }, { tx: 5, ty: 7, kind: "rug", solid: false }, { tx: 8, ty: 7, kind: "desk" }, { tx: 8, ty: 5, kind: "stove" }, { tx: 9, ty: 5, kind: "sink" }, { tx: 10, ty: 5, kind: "counter" }],
};
// 室内庭(右上の g マス)の花壇。全グレード共通で置く。歩いて入れる。
const HOME_GARDEN_DECOR = [
  { tx: 8, ty: 1, kind: "flower", solid: false }, { tx: 10, ty: 1, kind: "flower", solid: false },
  { tx: 9, ty: 2, kind: "flower", solid: false }, { tx: 11, ty: 2, kind: "flower", solid: false },
  { tx: 8, ty: 3, kind: "flower", solid: false }, { tx: 10, ty: 3, kind: "flower", solid: false },
  { tx: 9, ty: 4, kind: "flower", solid: false }, { tx: 11, ty: 4, kind: "flower", solid: false },
];

// 町の建物配置(col,row は建物ブロックの左上。w/h省略時は3×2。ギルドのみ5×3)
const TOWN_BUILDINGS = [
  { id: "inn", col: 2, row: 2 }, { id: "restaurant", col: 6, row: 2 }, { id: "bar", col: 10, row: 2 },
  { id: "bank", col: 14, row: 2 }, { id: "school", col: 18, row: 2 }, { id: "hospital", col: 22, row: 2 }, { id: "church", col: 26, row: 2 },
  { id: "weapon", col: 2, row: 6 }, { id: "material", col: 6, row: 6 }, { id: "smith", col: 10, row: 6 },
  { id: "guild", col: 14, row: 6, w: 5, h: 3 }, { id: "salon", col: 20, row: 6 }, { id: "police", col: 24, row: 6 },
  // 食料品店(大きめ): 中に魚屋・八百屋・肉屋＋食料品店員がいる
  { id: "market", col: 8, row: 10, w: 7, h: 3 }, { id: "florist", col: 24, row: 10 },
  { id: "realestate", col: 2, row: 10 }, { id: "appliance", col: 16, row: 10 },
  // マイホームは町の離れ(下部)に庭付きの大きな建物として配置(5×3)
  { id: "home", col: 3, row: 18, w: 5, h: 3 },
];
const TOWN_COLS = 30, TOWN_ROWS = 26;
const TOWN_TREES = [[5, 15], [20, 15], [26, 17], [12, 18], [1, 16], [28, 20]];
// マイホームの庭(離れの建物まわりの外構)。柵は通れない・花壇は通れる。
const HOME_YARD_DECOR = [
  { tx: 2, ty: 21, kind: "fence" }, { tx: 2, ty: 22, kind: "fence" }, { tx: 2, ty: 23, kind: "fence" },
  { tx: 8, ty: 21, kind: "fence" }, { tx: 8, ty: 22, kind: "fence" }, { tx: 8, ty: 23, kind: "fence" },
  { tx: 3, ty: 23, kind: "fence" }, { tx: 4, ty: 23, kind: "fence" }, { tx: 6, ty: 23, kind: "fence" }, { tx: 7, ty: 23, kind: "fence" },
  { tx: 3, ty: 21, kind: "flower", solid: false }, { tx: 4, ty: 21, kind: "flower", solid: false },
  { tx: 6, ty: 21, kind: "flower", solid: false }, { tx: 7, ty: 21, kind: "flower", solid: false },
  { tx: 3, ty: 22, kind: "flower", solid: false }, { tx: 4, ty: 22, kind: "flower", solid: false },
  { tx: 6, ty: 22, kind: "flower", solid: false }, { tx: 7, ty: 22, kind: "flower", solid: false },
];
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
    const spawn = b.id === "guild" ? { tx: 6, ty: 6 } : b.id === "home" ? { tx: 6, ty: 8 } : b.id === "market" ? { tx: 6, ty: 7 } : { tx: 5, ty: 5 };
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
    decor: [{ tx: TOILET.tx, ty: TOILET.ty, kind: "toilet" }, ...HOME_YARD_DECOR],
    doors: _town.doors.map((d) => ({ tx: d.tx, ty: d.ty, to: d.to, spawn: d.spawn })),
  },
  guild: {
    id: "guild", indoor: true, name: "Guild", map: GUILD_MAP, cols: 13, rows: 9,
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
// マイホーム内部(13×11の広め。右上に室内庭 g、下中央 D が玄関)
const HOME_MAP = [
  "#############",
  "#......#gggg#",
  "#......#gggg#",
  "#......#gggg#",
  "#.......gggg#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#.....D.....#",
  "#############",
];
// マイホーム(購入前は「売り家」。店員なし。内装は購入グレードで変わる)
AREAS.home = {
  id: "home", indoor: true, name: "For Sale", map: HOME_MAP, cols: 13, rows: 11,
  npcs: [], decor: [],
  doors: [{ tx: 6, ty: 9, to: "town", spawn: townReturnOf("home") }],
};
// 食料品店(13×10)。魚屋・八百屋・肉屋＋食料品店員が並ぶ。下中央 D が出入口。
const MARKET_MAP = [
  "#############",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#...........#",
  "#.....D.....#",
  "#############",
];
const MARKET_NPCS = [
  { id: "fish",    name: "魚屋 Finn",       tx: 2,  ty: 2, color: "#5a8ab0", shop: "fish" },
  { id: "green",   name: "八百屋 Vera",     tx: 5,  ty: 2, color: "#6aa84a", shop: "green" },
  { id: "meat",    name: "肉屋 Otto",       tx: 8,  ty: 2, color: "#b05a4a", shop: "meat" },
  { id: "grocery", name: "食料品店 マルコ", tx: 11, ty: 2, color: "#caa46a", shop: "grocery" },
];
const MARKET_DECOR = [
  { tx: 2, ty: 3, kind: "counter" }, { tx: 5, ty: 3, kind: "counter" }, { tx: 8, ty: 3, kind: "counter" }, { tx: 11, ty: 3, kind: "counter" },
  { tx: 1, ty: 1, kind: "crate" }, { tx: 11, ty: 1, kind: "crate" }, { tx: 1, ty: 7, kind: "barrel" }, { tx: 11, ty: 7, kind: "shelf" },
];
AREAS.market = {
  id: "market", indoor: true, name: "Food Market", map: MARKET_MAP, cols: 13, rows: 10,
  npcs: MARKET_NPCS, decor: MARKET_DECOR,
  doors: [{ tx: 6, ty: 8, to: "town", spawn: townReturnOf("market") }],
};
// ===== ダンジョン(フィールドの入口 X から入る) =====
// #=岩壁 .=床 D=出口。柱(##)を散らした開けた洞窟。歩くとエンカウント。
const DUNGEON_MAP = [
  "###############",
  "#.............#",
  "#.##.##.##.##.#",
  "#.............#",
  "#.##.##.##.##.#",
  "#.............#",
  "#.##.##.##.##.#",
  "#.............#",
  "#.##.##.##.##.#",
  "#.............#",
  "######.D.######",
];
const DUNGEON_START = { tx: 7, ty: 9 };
AREAS.dungeon = {
  id: "dungeon", dungeon: true, indoor: true, encounter: true, zone: "dungeon", name: "古代の遺跡",
  map: DUNGEON_MAP, cols: 15, rows: 11,
  npcs: [], decor: [],
  doors: [{ tx: 7, ty: 10, to: "field" }],
};
// ダンジョン専用の敵(フィールドより手強い)
const DUNGEON_ENEMIES = [
  { name: "どくグモ",     hp: 24, atk: 6,  exp: 14, color: "#6a8a3a", drop: "Spider Silk" },
  { name: "ヘドロ",       hp: 28, atk: 6,  exp: 16, color: "#5a6a3a", drop: "Sludge Ooze" },
  { name: "がいこつ兵",   hp: 32, atk: 7,  exp: 19, color: "#e8e0c8", drop: "Old Bone" },
  { name: "いわゴーレム", hp: 42, atk: 9,  exp: 27, color: "#8a7a6a", drop: "Mana Shard" },
  { name: "ドラゴンの子", hp: 52, atk: 11, exp: 35, color: "#b0402a", drop: "Dragon Flame" },
];

// ===== タワー(フィールドの入口 Y から入る。熟語が出る) =====
const TOWER_MAP = [
  "#############",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#####.D.#####",
];
const TOWER_START = { tx: 6, ty: 11 };
AREAS.tower = {
  id: "tower", tower: true, indoor: true, encounter: true, zone: "tower", name: "塔",
  map: TOWER_MAP, cols: 13, rows: 13,
  npcs: [], decor: [],
  doors: [{ tx: 6, ty: 12, to: "field" }],
};
// タワー専用の敵(魔法系・最も手強い)
const TOWER_ENEMIES = [
  { name: "まどうし",     hp: 30, atk: 8,  exp: 20, color: "#7a4ad6", drop: "Mana Powder" },
  { name: "ガーゴイル",   hp: 36, atk: 8,  exp: 24, color: "#9a9aa6", drop: "Demon Guts" },
  { name: "よろいの亡霊", hp: 44, atk: 10, exp: 30, color: "#c0c0d4", drop: "Wraith Eye" },
  { name: "キメラ",       hp: 50, atk: 11, exp: 38, color: "#c08a3a", drop: "Chimera Meat" },
  { name: "だいまどう",   hp: 62, atk: 13, exp: 48, color: "#5a2a8a", drop: "Archmage Soul" },
];

// ===== 魔王城(フィールドの C から入る。英文法問題が出る) =====
// B=玉座(魔王戦)。奥(上)の玉座に着くと魔王戦。
const CASTLE_MAP = [
  "#############",
  "#####.B.#####",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#.##.##.##..#",
  "#...........#",
  "#####.D.#####",
];
const CASTLE_START = { tx: 6, ty: 10 };
AREAS.castle = {
  id: "castle", castle: true, indoor: true, encounter: true, zone: "castle", name: "魔王城",
  map: CASTLE_MAP, cols: 13, rows: 12,
  npcs: [], decor: [],
  doors: [{ tx: 6, ty: 11, to: "field" }],
};
// 魔王城の敵(配下)。魔王(BOSS)は玉座Bで出現
const CASTLE_ENEMIES = [
  { name: "小悪魔",     hp: 34, atk: 8,  exp: 22, color: "#b04a6a", drop: "Devil Horn" },
  { name: "ダークナイト", hp: 46, atk: 10, exp: 30, color: "#3a3a5a", drop: "Dark Metal" },
  { name: "魔導兵",     hp: 40, atk: 11, exp: 32, color: "#6a3a8a", drop: "Arcane Powder" },
  { name: "デュラハン", hp: 54, atk: 12, exp: 40, color: "#4a5a6a", drop: "Dullahan Bone" },
];

// ===== ダンジョン2 / 氷の洞窟(フィールドの Z から入る。専用単語が出る) =====
const DUNGEON2_MAP = [
  "###############",
  "#.....#.#.....#",
  "#.###.#.#.###.#",
  "#.#.......#...#",
  "#.#.#####.#.#.#",
  "#...#...#...#.#",
  "###.#.#.#.###.#",
  "#...#.#.#...#.#",
  "#.###.#.###.#.#",
  "#.............#",
  "######.D.######",
];
const DUNGEON2_START = { tx: 7, ty: 9 };
AREAS.dungeon2 = {
  id: "dungeon2", dungeon2: true, indoor: true, encounter: true, zone: "dungeon2", name: "氷の遺跡",
  map: DUNGEON2_MAP, cols: 15, rows: 11,
  npcs: [], decor: [],
  doors: [{ tx: 7, ty: 10, to: "field" }],
};
// 氷の洞窟の敵
const DUNGEON2_ENEMIES = [
  { name: "こおりスライム", hp: 30, atk: 7,  exp: 18, color: "#7ad0e0", drop: "Ancient Ice" },
  { name: "フロストウルフ", hp: 38, atk: 9,  exp: 24, color: "#aab8d8", drop: "Frost Meat" },
  { name: "ゆきおんな",     hp: 44, atk: 10, exp: 30, color: "#dfeefc", drop: "Ice Soul" },
  { name: "アイスゴーレム", hp: 56, atk: 12, exp: 40, color: "#6aa0c0", drop: "Ice Shard" },
  { name: "ブリザードドラゴン", hp: 66, atk: 14, exp: 52, color: "#3a8ac0", drop: "Ice Dragon Heart" },
];

// ===== 炎の遺跡(フィールドの F から入る。専用単語が出る) =====
const FIRE_MAP = [
  "###############",
  "#....#....#...#",
  "#.##.#.##.#.#.#",
  "#.#....#....#.#",
  "#.#.##.#.###.##",
  "#...#..#.#....#",
  "##.##.##.#.##.#",
  "#....#....#..##",
  "#.##.###.###..#",
  "#.............#",
  "######.D.######",
];
const FIRE_START = { tx: 7, ty: 9 };
AREAS.fire = {
  id: "fire", fire: true, indoor: true, encounter: true, zone: "fire", name: "炎の遺跡",
  map: FIRE_MAP, cols: 15, rows: 11,
  npcs: [], decor: [],
  doors: [{ tx: 7, ty: 10, to: "field" }],
};
// 炎の遺跡の敵(氷の洞窟と同格〜やや上)
const FIRE_ENEMIES = [
  { name: "ヒートスライム",   hp: 34, atk: 8,  exp: 20, color: "#ff8a5a", drop: "Ember Ash" },
  { name: "マグマスライム",   hp: 40, atk: 10, exp: 26, color: "#e0552a", drop: "Cinder Shard" },
  { name: "サラマンダー",     hp: 48, atk: 11, exp: 33, color: "#d0402a", drop: "Salamander Scale" },
  { name: "フレイムゴーレム", hp: 60, atk: 13, exp: 44, color: "#b03828", drop: "Magma Core" },
  { name: "フェニックス",     hp: 70, atk: 15, exp: 56, color: "#ff6a30", drop: "Phoenix Feather" },
];

let zone = "";                          // "" | "dungeon" | "dungeon2" | "tower" | "castle" (敵/単語の出し分け用)

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
let fieldBoss = null;      // フィールドに出現中のエリアボス {tx,ty,boss,questId}
let bossBattle = null;     // ボス戦(コマンドバトル)の状態
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
  "Slime Ooze": 8, "Bat Wing": 10, "Ghost Soul": 14, "Rusty Metal": 18,
  // 炎の遺跡のドロップ
  "Ember Ash": 20, "Cinder Shard": 24, "Magma Core": 30, "Salamander Scale": 36, "Phoenix Feather": 48,
};
const SHOP_ITEMS = [
  { name: "Copper Sword", slot: "weapon", atk: 4, price: 30 },
  { name: "Steel Sword", slot: "weapon", atk: 10, price: 120 },
  { name: "Leather Cap", slot: "head", def: 2, hp: 5, price: 35 },
  { name: "Iron Helmet", slot: "head", def: 5, hp: 10, price: 110 },
  { name: "Traveler's Clothes", slot: "armor", hp: 15, price: 40 },
  { name: "Chain Mail", slot: "armor", def: 4, hp: 40, price: 150 },
  { name: "Wooden Shield", slot: "shield", def: 3, price: 25 },
  { name: "Iron Shield", slot: "shield", def: 8, price: 100 },
  { name: "Power Ring", slot: "accessory", atk: 3, price: 80 },
  { name: "Guard Amulet", slot: "accessory", def: 3, hp: 8, price: 80 },
];
// 家電屋の品(購入するとマイホームに設置)
const APPLIANCE_ITEMS = [
  { id: "fridge", name: "冷蔵庫", en: "Refrigerator", price: 300 },
  { id: "tv", name: "テレビ", en: "Television", price: 400 },
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
let bagOpen = false;         // もちもの一覧を展開表示しているか
let bagBoxRect = null;       // 「もちもの」ボックスのタップ判定用矩形
let bagPage = 0;             // もちもの一覧の表示ページ(8件/ページ)
let bagNavRects = null;      // もちもの一覧の前/次ページのタップ判定
let dishes = [];             // 作った料理 [{name,score,heal,atk,def}]
let dishRowRects = [];       // 料理パネルの各行タップ判定用
let mealBuff = { atk: 0, def: 0 }; // 料理を食べて得た「次の戦闘」バフ(保留中)
let battleBuff = { atk: 0, def: 0 }; // 現在の戦闘中に効いているバフ
let tributes = [];           // 召喚料理(貢物) [{name,quality}]
let summonCards = [];        // 召喚獣カード [{name,element,rarity,atk,turns}]
let pendingTribute = null;   // 召喚で捧げ中の貢物
// 召喚獣: レアリティ別の性能 / 属性の日本語
const SUMMON_ATK = { 1: 6, 2: 9, 3: 13, 4: 18, 5: 24 };
const SUMMON_TURNS = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4 };
const ELEMENT_JA = { fire: "炎", water: "水", wind: "風", earth: "土", light: "光", dark: "闇" };
let rateBoxRect = null;      // 「習得」バーのタップ判定用矩形
let wordList = null;         // 習得リスト表示中の状態 { page }
let wordListBack = STATE.FIELD; // 習得リストを閉じたあとに戻る状態
// 食料品店の品ぞろえ(買うと bag に入る)
const FOOD_SHOPS = {
  fish:    [{ name: "Tuna", price: 20 }, { name: "Sardine", price: 8 }, { name: "Salmon", price: 18 }, { name: "Shrimp", price: 14 }, { name: "Octopus", price: 12 }, { name: "Clam", price: 10 }],
  green:   [{ name: "Cabbage", price: 6 }, { name: "Tomato", price: 8 }, { name: "Carrot", price: 6 }, { name: "Onion", price: 6 }, { name: "Potato", price: 7 }, { name: "Eggplant", price: 8 }],
  meat:    [{ name: "Chicken", price: 14 }, { name: "Pork", price: 18 }, { name: "Beef", price: 26 }, { name: "Bacon", price: 16 }, { name: "Sausage", price: 14 }],
  grocery: [{ name: "Rice", price: 8 }, { name: "Noodles", price: 8 }, { name: "Bread", price: 7 }, { name: "Egg", price: 6 }, { name: "Oil", price: 8 }, { name: "Salt", price: 4 }, { name: "Soy Sauce", price: 8 }, { name: "Sugar", price: 6 }, { name: "Butter", price: 12 }],
};
const SHOP_TITLE = { material: "Material Shop", weapon: "Weapon Shop", fish: "Fish Shop", green: "Green Grocer", meat: "Butcher", grocery: "Grocery", home: "Real Estate 〜 Properties", appliance: "Appliance Shop" };
// 料理に使える食材(食材ショップの品)。台所の調理で消費する。
const INGREDIENT_NAMES = [].concat(...Object.values(FOOD_SHOPS).map((a) => a.map((x) => x.name)));
// ショップ表示用の日本語訳(英語表記の商品に併記)
const ITEM_JA = {
  // 魚屋
  "Tuna": "マグロ", "Sardine": "イワシ", "Salmon": "サーモン", "Shrimp": "エビ", "Octopus": "タコ", "Clam": "アサリ",
  // 八百屋
  "Cabbage": "キャベツ", "Tomato": "トマト", "Carrot": "にんじん", "Onion": "たまねぎ", "Potato": "じゃがいも", "Eggplant": "なす",
  // 肉屋
  "Chicken": "とり肉", "Pork": "ぶた肉", "Beef": "ぎゅう肉", "Bacon": "ベーコン", "Sausage": "ソーセージ",
  // 食料品店
  "Rice": "米", "Noodles": "めん", "Bread": "パン", "Egg": "たまご", "Oil": "油", "Salt": "塩", "Soy Sauce": "しょうゆ", "Sugar": "さとう", "Butter": "バター",
  // 武器・防具
  "Copper Sword": "銅の剣", "Steel Sword": "鋼の剣", "Leather Cap": "革の帽子", "Iron Helmet": "鉄のかぶと",
  "Traveler's Clothes": "旅人の服", "Chain Mail": "くさりかたびら", "Wooden Shield": "木の盾", "Iron Shield": "鉄の盾",
  "Power Ring": "力の指輪", "Guard Amulet": "守りの護符",
};
function jaName(name) { return ITEM_JA[name] || ""; }
// 英語名に日本語訳を「英名（訳）」で併記(訳がなければ英名のみ)
function nameWithJa(name) { const j = ITEM_JA[name]; return j ? `${name}（${j}）` : name; }
// 旧セーブの日本語食料名も「食料品」として扱う(冷蔵庫に保管・倉庫には入れない)
const LEGACY_FOOD = ["マグロ", "イワシ", "サーモン", "えび", "たこ", "あさり", "キャベツ", "トマト", "にんじん", "たまねぎ", "じゃがいも", "なす", "とり肉", "ぶた肉", "牛肉", "ベーコン", "ソーセージ", "ライス", "麺", "パン", "卵", "油", "塩", "しょうゆ", "さとう", "バター"];
function isFood(name) { return INGREDIENT_NAMES.includes(name) || LEGACY_FOOD.includes(name); }
const BAG_MAX_TYPES = 32; // もちものは32種類まで
const NO_STORE_ITEMS = ["迷いネコ", "氷のオーブ", "炎のオーブ"]; // 倉庫に預けられないクエスト用アイテム
function bagFull(name) { return bag[name] === undefined && Object.keys(bag).length >= BAG_MAX_TYPES; }
function buyItem(name) { if (bagFull(name)) return false; bag[name] = (bag[name] || 0) + 1; return true; }
function hasItem(name) { return (bag[name] || 0) > 0; }
function useItem(name) { if (bag[name] > 0) { bag[name]--; if (bag[name] <= 0) delete bag[name]; } }

function materialsValue() {
  let v = 0;
  for (const [n, c] of Object.entries(materials)) v += (MATERIAL_PRICE[n] || 5) * c;
  return v;
}
function effText(it) {
  const p = [];
  if (it.atk) p.push(`攻+${it.atk}`);
  if (it.def) p.push(`防+${it.def}`);
  if (it.hp) p.push(`HP+${it.hp}`);
  return `${SLOT_JA[it.slot] || ""} ${p.join(" ")}`;
}
function shopRows() {
  const rows = [];
  if (shop.type === "material") {
    const sv = materialsValue();
    rows.push({ kind: "sell", enabled: sv > 0, label: sv > 0 ? `素材を ぜんぶ売る（+${sv}G）` : "売る素材がない" });
  } else if (shop.type === "home") {
    HOME_PROPERTIES.forEach((p, i) => {
      const owned = ownedHome === p.id;
      const nm = `${p.en}（${p.name}）`;
      rows.push({
        kind: "buyhome", idx: i, enabled: !owned && player.gold >= p.price,
        label: owned ? `✓ ${nm} いま住んでいる` : `${nm} ${p.price}G`,
      });
    });
  } else if (shop.type === "appliance") {
    APPLIANCE_ITEMS.forEach((it, i) => {
      const owned = (it.id === "fridge" && ownedFridge) || (it.id === "tv" && ownedTV);
      const nm = `${it.en}（${it.name}）`;
      rows.push({
        kind: "buyappliance", idx: i, enabled: !owned && player.gold >= it.price,
        label: owned ? `✓ ${nm} 設置ずみ` : `${nm} ${it.price}G`,
      });
    });
  } else if (FOOD_SHOPS[shop.type]) {
    FOOD_SHOPS[shop.type].forEach((it, i) => {
      rows.push({ kind: "buyfood", idx: i, enabled: player.gold >= it.price, label: `${nameWithJa(it.name)}　${it.price}G` });
    });
  } else {
    SHOP_ITEMS.forEach((it, i) => {
      const owned = boughtItems.has(i);
      const ja = jaName(it.name);
      const inner = (ja ? ja + "・" : "") + effText(it);
      rows.push({
        kind: "buy", idx: i, enabled: !owned && player.gold >= it.price,
        label: owned ? `✓ ${it.name}（${inner}）購入ずみ` : `${it.name}（${inner}）${it.price}G`,
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
      : type === "appliance" ? "コトハ「マイホームに置く家電を買おう！」"
      : FOOD_SHOPS[type] ? "コトハ「ほしい食べ物を買おう！」"
      : "コトハ「武器や防具で強くなろう！」",
  };
  state = STATE.SHOP;
}
function shopSelect(row) {
  if (!row) return;
  if (row.kind === "exit") { sfx("cancel"); shop = null; state = STATE.TOWN; return; }
  if (row.kind === "prev" || row.kind === "next") { sfx("select"); }
  if (!row.enabled) { shop.msg = "コトハ「ゴールドが足りないみたい…」"; shop.msgT = 200; return; }
  if (["sell", "buy", "buyhome", "buyfood", "buyappliance"].includes(row.kind)) sfx(row.kind === "buy" ? "item" : "coin");
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
    if (equipped[it.slot] == null) { equipped[it.slot] = row.idx; recomputeStats(); shop.msg = `${it.name}を 買って そうびした！`; }
    else { shop.msg = `${it.name}を 買った！（🛡装備で着けかえできるよ）`; }
    shop.msgT = 260;
  } else if (row.kind === "buyhome") {
    const p = HOME_PROPERTIES[row.idx];
    player.gold -= p.price; ownedHome = p.id;
    refreshHome();
    shop.msg = `${p.en}（${p.name}）を 買った！ 町に「マイホーム」ができたよ。休んでセーブできるよ!`; shop.msgT = 360;
  } else if (row.kind === "buyfood") {
    const it = FOOD_SHOPS[shop.type][row.idx];
    if (bagFull(it.name)) { shop.msg = `もちものがいっぱい！（${BAG_MAX_TYPES}種類まで）冷蔵庫や倉庫にしまおう`; shop.msgT = 300; const rr = shopRows(); if (shop.sel >= rr.length) shop.sel = rr.length - 1; return; }
    player.gold -= it.price; buyItem(it.name);
    if (quest && quest.stage === 10 && it.name === "Tuna") {
      quest.stage = 11; // マグロ(Tuna)を手に入れた→迷いネコを捕まえに
      shop.msg = `Tuna（マグロ）を買った！ コトハ「これで迷いネコをおびき寄せよう」`; shop.msgT = 300;
    } else {
      shop.msg = `${it.name}を 買った！`; shop.msgT = 200;
    }
  } else if (row.kind === "buyappliance") {
    const it = APPLIANCE_ITEMS[row.idx];
    if (!ownedHome) { shop.msg = "先にマイホームが必要だよ（不動産屋で購入）"; shop.msgT = 320; }
    else {
      player.gold -= it.price;
      if (it.id === "fridge") ownedFridge = true; else if (it.id === "tv") ownedTV = true;
      refreshHome();
      shop.msg = `${it.en}（${it.name}）を 買った！ マイホームに設置したよ。`; shop.msgT = 320;
    }
  }
  const rows = shopRows();
  if (shop.sel >= rows.length) shop.sel = rows.length - 1;
}
// ショップ行のレイアウト(行数が多いと自動で詰める)
function shopRowLayout(n) {
  const top = 90, rh = Math.min(44, Math.floor((H - top - 36) / Math.max(1, n)));
  return { top, rh, h: rh - 4 };
}
function drawShop() {
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'MS Gothic', monospace";
  ctx.fillText(SHOP_TITLE[shop.type] || "店", W / 2, 44);
  ctx.fillStyle = "#ffe082"; ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillText(`所持金 ${player.gold}G`, W / 2, 72);
  const rows = shopRows();
  const { top, rh, h } = shopRowLayout(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const y = top + i * rh;
    drawWindow(40, y, 400, h, shop.sel === i);
    ctx.textAlign = "left";
    ctx.fillStyle = (rows[i].enabled || rows[i].kind === "exit") ? "#fff" : "#7a8aa8";
    ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 70, y + h - 13);
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
    const y = 86 + i * 34;
    drawWindow(30, y, 420, 30, board.sel === i);
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 48, y + 20);
  }
  // 選択中の依頼の詳細
  const sel = rows[board.sel];
  const yDetail = 86 + rows.length * 34 + 6;
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
// 英文を単語単位で折り返して中央寄せ描画(最大maxLines行)
function drawCenteredWrapped(text, cx, y, maxW, lineH, maxLines) {
  const words = String(text).split(" ");
  const lines = []; let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  const startY = y - (shown.length - 1) * lineH / 2;
  for (let i = 0; i < shown.length; i++) ctx.fillText(shown[i], cx, startY + i * lineH);
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
function setupFirstQuest() { quest = { stage: 0, kills: 0, goal: 3, shopRevealed: false }; }
function addMaterial(name) { materials[name] = (materials[name] || 0) + 1; }
function questLines() {
  if (!quest) return null;
  if (quest.stage === 0) return ["① 素材を3つ あつめる", `素材あつめ ${quest.kills}/${quest.goal}`];
  if (quest.stage === 1) return ["② 町(赤い屋根)へ向かう", "素材あつめ 達成！"];
  if (quest.stage === 2) return ["③ 素材屋の場所を町の人に聞く", '"Where is the material shop?"'];
  if (quest.stage === 3) return ["④ 素材屋で素材を売る"];
  if (quest.stage === 4) return ["⑤ 宿屋に泊まる"];
  if (quest.stage === 5) return ["⑥ ギルドに登録する", "町中央のギルドの受付へ"];
  if (quest.stage === 6) return ["⑦ ギルドの依頼を受ける", "ギルド受付に依頼を受けたいと伝えよう"];
  if (quest.stage === 7) return ["⑧ 美容院の人に話を聞く", "迷いネコの特徴を聞き出そう"];
  if (quest.stage === 8) return ["⑨ 町の人に迷いネコのことを聞く", "目撃情報をあつめよう"];
  if (quest.stage === 9) return ["⑩ 迷いネコをとらえる", "教会の裏にネコがいるみたい"];
  if (quest.stage === 10) return ["⑪ ネコの好きな食べ物を手に入れる", "食料品店の魚屋でTuna（マグロ）を買おう"];
  if (quest.stage === 11) return ["⑫ Tuna（マグロ）で迷いネコをとらえる", "教会の裏のネコに近づこう"];
  if (quest.stage === 12) return ["⑬ 迷いネコを美容院の人に届ける", "美容師Cocoに話しかけよう"];
  if (quest.stage === 13) return ["⑭ ギルドに報告する", "ギルド受付に達成を報告しよう"];
  if (quest.stage === 14) return ["⑮ ギルド依頼ボードが解放！", "依頼で力をつけよう"];
  if (quest.stage === 15) return ["⑯ ギルドランク2を目指す", `いまランク${player.guildLevel}／依頼をこなそう`];
  if (quest.stage === 16) return ["⑰ ギルドへ行く", "受付Fiaに話しかけよう"];
  if (quest.stage === 17) return ["⑱ 古代の遺跡の碑文を調査する", "遺跡の奥のエンシェントドラゴンを倒そう"];
  if (quest.stage === 18) return ["⑲ ギルドランク3を目指す", `いまランク${player.guildLevel}／依頼をこなそう`];
  if (quest.stage === 19) return ["⑳ ギルドへ行く", "受付Fiaに話しかけよう"];
  if (quest.stage === 20) return ["㉑ 氷の遺跡の碑文を調査する", "遺跡の奥の氷の女王の亡霊を倒そう"];
  if (quest.stage === 21) return ["㉒ ギルドランク4を目指す", `いまランク${player.guildLevel}／依頼をこなそう`];
  if (quest.stage === 22) return ["㉓ 炎の遺跡で手がかりを探す", "（つづきは準備中）"];
  return ["クエスト達成！ つづきは準備中…"];
}

// ===== 敵テンプレート =====
const ENEMIES = [
  { name: "スライム",   hp: 12, atk: 3, exp: 5,  color: "#3fbf6f", drop: "Slime Ooze" },
  { name: "おおコウモリ", hp: 16, atk: 4, exp: 7,  color: "#7a5ad6", drop: "Bat Wing" },
  { name: "ゴースト",   hp: 20, atk: 5, exp: 9,  color: "#9fd6e6", drop: "Ghost Soul" },
  { name: "アーマー兵", hp: 28, atk: 6, exp: 12, color: "#b0b0c0", drop: "Rusty Metal" },
];
const BOSS = { name: "まおう", hp: 60, atk: 9, exp: 0, color: "#c0392b", boss: true };

// ===== 入力 =====
const keys = {};
window.addEventListener("keydown", (e) => {
  if (window.Chat && Chat.isOpen()) return; // 会話中はゲーム操作を止める(入力欄優先)
  if (state === STATE.NAME) return;          // 名前入力中は入力欄に任せる
  if (e.key === "h" || e.key === "H") { e.preventDefault(); toggleControls(); return; } // 情報パネルの表示/非表示
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

// 難易度切替(ゲーム途中でも 500→700→900 と循環)
const levelBtn = document.getElementById("level-btn");
function updateLevelBtn() { if (levelBtn) levelBtn.textContent = "難易度: TOEIC " + toeicLevel; }
function cycleLevel() {
  const order = [500, 700, 900];
  toeicLevel = order[(order.indexOf(toeicLevel) + 1) % order.length];
  updateLevelBtn();
}
if (levelBtn) levelBtn.addEventListener("click", (e) => { e.preventDefault(); cycleLevel(); });
updateLevelBtn();

// セーブボタン(探索中のみ有効)
const saveBtn = document.getElementById("save-btn");
if (saveBtn) saveBtn.addEventListener("click", (e) => {
  e.preventDefault();
  showToast(saveGame() ? "💾 セーブしました" : "ここではセーブできません");
});

// 装備メニューを開く(探索中のみ)
const equipBtn = document.getElementById("equip-btn");
if (equipBtn) equipBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (state === STATE.FIELD || state === STATE.TOWN) openEquip();
});

// 効果音のショートカット(モジュールが無くても無害)
function sfx(name) { if (window.Sfx) Sfx.play(name); }
const sfxBtn = document.getElementById("sfx-btn");
function updateSfxBtn() { if (sfxBtn) sfxBtn.textContent = (window.Sfx && Sfx.isEnabled()) ? "🔔 効果音: ON" : "🔕 効果音: OFF"; }
if (sfxBtn) {
  updateSfxBtn();
  sfxBtn.addEventListener("click", (e) => { e.preventDefault(); if (window.Sfx) { const on = Sfx.toggle(); if (on) Sfx.play("confirm"); } updateSfxBtn(); });
}


// 画面上の情報パネル(Lv/HP・いまの目的・もちもの・ギルド依頼)の表示/非表示
// 初期は非表示にしてマップを見やすく。ボタン/Hキー/フィールドタップで表示。
let hudShown = false;
const ctrlToggleBtn = document.getElementById("ctrl-toggle");
function setHud(show) {
  hudShown = show;
  if (ctrlToggleBtn) ctrlToggleBtn.textContent = show ? "📊 情報パネルをかくす" : "📊 情報パネルを表示";
}
function toggleControls() { setHud(!hudShown); }
if (ctrlToggleBtn) ctrlToggleBtn.addEventListener("click", (e) => { e.preventDefault(); toggleControls(); });
setHud(false);

// 開発用: 目的ジャンプボタン(data-stage 付きのみ。モデル切替ボタンは chat.js 側で処理)
document.querySelectorAll("#dev-bar button[data-stage]").forEach((b) => {
  b.addEventListener("click", (e) => { e.preventDefault(); devJump(parseInt(b.dataset.stage, 10)); });
});

// 開発用: 所持金に10000G追加(マイホーム購入などのテスト用)
const devGoldBtn = document.getElementById("dev-gold");
if (devGoldBtn) devGoldBtn.addEventListener("click", (e) => {
  e.preventDefault();
  player.gold += 10000;
  showToast(`💰 +10000G（所持金 ${player.gold}G）`);
});
window.gold = (n) => { player.gold = n; showToast(`💰 所持金を ${player.gold}G に`); }; // コンソール用

// 開発用: ギルドポイント+120(ランクアップ→ストーリー進行の確認用)
const devGpBtn = document.getElementById("dev-gp");
if (devGpBtn) devGpBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (player.guildLevel < 1) { showToast("先にギルド登録が必要"); return; }
  const ups = addGuildPoints(120);
  const advanced = checkGuildStoryProgress().length > 0;
  showToast(`GP+120（ランク${player.guildLevel}）${ups ? " ランクUP!" : ""}${advanced ? " ▶ストーリー進行" : ""}`);
});

// 名前入力(オープニング)
const nameOkBtn = document.getElementById("name-ok");
if (nameOkBtn) nameOkBtn.addEventListener("click", (e) => { e.preventDefault(); confirmName(); });
const nameInputEl = document.getElementById("name-input");
if (nameInputEl) nameInputEl.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") { e.preventDefault(); confirmName(); }
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
    const n = titleMenu().length;
    if (k === "up") menuSel = (menuSel - 1 + n) % n;
    else if (k === "down") menuSel = (menuSel + 1) % n;
    else if (k === "confirm") selectTitle(menuSel);
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
  if (state === STATE.BOSSBATTLE && bossBattle) {
    const bb = bossBattle;
    if (bb.phase === "menu") {
      const n = 6; // たたかう/必殺技/しょうかん/道具/ぼうぎょ/にげる(2列×3)
      if (k === "up" && bb.sel - 2 >= 0) bb.sel -= 2;
      else if (k === "down" && bb.sel + 2 < n) bb.sel += 2;
      else if (k === "left" && bb.sel % 2 === 1) bb.sel--;
      else if (k === "right" && bb.sel % 2 === 0 && bb.sel + 1 < n) bb.sel++;
      else if (k === "confirm") bossCommand(["attack", "special", "summon", "item", "guard", "flee"][bb.sel]);
      return;
    }
    if (bb.phase === "item") {
      const n = Math.min(dishes.length, 6) + 1; // 料理(最大6)＋もどる
      if (k === "up") bb.itemSel = (bb.itemSel - 1 + n) % n;
      else if (k === "down") bb.itemSel = (bb.itemSel + 1) % n;
      else if (k === "confirm") { if (bb.itemSel >= Math.min(dishes.length, 6)) bossMenu(); else useDishInBattle(bb.itemSel); }
      else if (k === "cancel") bossMenu();
      return;
    }
    if (bb.phase === "summon") {
      const n = Math.min(summonCards.length, 6) + 1; // カード(最大6)＋もどる
      if (k === "up") bb.summonSel = (bb.summonSel - 1 + n) % n;
      else if (k === "down") bb.summonSel = (bb.summonSel + 1) % n;
      else if (k === "confirm") { if (bb.summonSel >= Math.min(summonCards.length, 6)) bossMenu(); else useSummonInBattle(bb.summonSel); }
      else if (k === "cancel") bossMenu();
      return;
    }
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
  if (state === STATE.NPCMENU && npcMenu) {
    const rows = npcMenuRows();
    if (k === "up") npcMenu.sel = (npcMenu.sel - 1 + rows.length) % rows.length;
    else if (k === "down") npcMenu.sel = (npcMenu.sel + 1) % rows.length;
    else if (k === "confirm") npcMenuSelect(rows[npcMenu.sel]);
    else if (k === "cancel") { sfx("cancel"); npcMenu = null; state = STATE.TOWN; }
    return;
  }
  if (state === STATE.STORAGE && storageUI) {
    const rows = storageRows();
    if (k === "up") storageUI.sel = (storageUI.sel - 1 + rows.length) % rows.length;
    else if (k === "down") storageUI.sel = (storageUI.sel + 1) % rows.length;
    else if (k === "confirm") storageSelect(rows[storageUI.sel]);
    else if (k === "cancel") { storageUI = null; state = STATE.TOWN; if (canSave()) saveGame(); }
    return;
  }
  if (state === STATE.EQUIP && equipUI) {
    const rows = equipRows();
    if (k === "up") equipUI.sel = (equipUI.sel - 1 + rows.length) % rows.length;
    else if (k === "down") equipUI.sel = (equipUI.sel + 1) % rows.length;
    else if (k === "confirm") equipSelect(rows[equipUI.sel]);
    else if (k === "cancel") { if (equipUI.view === "items") { equipUI.view = "slots"; equipUI.sel = 0; } else { equipUI = null; state = STATE.TOWN; if (canSave()) saveGame(); } }
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
    else if (k === "cancel") {
      if (questLog.confirm != null) { questLog.confirm = null; questLog.sel = 0; } // 確認→一覧へ戻る
      else { questLog = null; state = STATE.TOWN; }
    }
    return;
  }
  if (state === STATE.WORDLIST && wordList) {
    if (k === "left" || k === "up") wordList.page--;
    else if (k === "right" || k === "down") wordList.page++;
    else if (k === "cancel" || k === "confirm") closeWordList();
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
  // 探索中: HUD内のボックスのタップを先に判定
  if (state === STATE.TOWN || state === STATE.FIELD) {
    if (inRect(x, y, rateBoxRect)) { openWordList(); return; }          // 習得バー→ワードリスト
    if (bagOpen && bagNavRects) { // もちもの一覧のページ送り
      if (inRect(x, y, bagNavRects.prev)) { bagPage = Math.max(0, bagPage - 1); return; }
      if (inRect(x, y, bagNavRects.next)) { bagPage++; return; }
    }
    if (inRect(x, y, bagBoxRect)) { bagOpen = !bagOpen; bagPage = 0; return; } // もちもの開閉
    for (const r of dishRowRects) if (inRect(x, y, r)) { eatDish(r.idx); return; } // 料理を食べる
    if (inRect(x, y, sideQuestBoxRect)) { openQuestLog(); return; }     // ギルド依頼の詳細
  }
  // フィールドをタップ → 情報パネルの表示/非表示を切替
  if (state === STATE.FIELD) { toggleControls(); return; }
  if (state === STATE.TOWN) {
    const tx = Math.floor((x + camX) / TILE), ty = Math.floor((y + camY) / TILE);
    const n = npcAt(tx, ty);
    if (n) { interactNPC(n); return; }
    if (deskAt(tx, ty)) { startDeskStudy(); return; } // 勉強机タップ→英訳ドリル
    if (kitchenAt(tx, ty)) { startCooking(); return; } // 台所タップ→料理
    if (summonKitchenAt(tx, ty)) { startSummonCook(); return; } // 大鍋タップ→召喚料理
    if (summonCircleAt(tx, ty)) { startSummonCast(); return; } // 召喚魔法陣タップ→召喚
    if (fridgeAt(tx, ty)) { openStorage("fridge"); return; } // 冷蔵庫タップ→食料保管
    if (warehouseAt(tx, ty)) { openStorage("warehouse"); return; } // 倉庫タップ→持ち物保管
    if (tvAt(tx, ty)) { startTV(); return; }        // テレビタップ→AI放送
    if (!hudShown) { setHud(true); return; } // 何もない所をタップ → 情報パネルを表示
    return;
  }
  if (state === STATE.TITLE) {
    const n = titleMenu().length;
    for (let i = 0; i < n; i++) {
      const r = titleItemRect(i, n);
      if (y >= r.y && y <= r.y + r.h) { menuSel = i; selectTitle(i); return; }
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
    const { top, rh, h } = shopRowLayout(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const ry = top + i * rh;
      if (x >= 40 && x <= 440 && y >= ry && y <= ry + h) { shop.sel = i; shopSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.NPCMENU && npcMenu) {
    const rows = npcMenuRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = 196 + i * 52;
      if (x >= 80 && x <= 400 && y >= ry && y <= ry + 44) { npcMenu.sel = i; npcMenuSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.STORAGE && storageUI) {
    const rows = storageRows();
    const { top, rh, h } = shopRowLayout(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const ry = top + i * rh;
      if (x >= 40 && x <= 440 && y >= ry && y <= ry + h) { storageUI.sel = i; storageSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.EQUIP && equipUI) {
    const rows = equipRows();
    const { top, rh, h } = shopRowLayout(rows.length + 1);
    for (let i = 0; i < rows.length; i++) {
      const ry = top + i * rh;
      if (x >= 40 && x <= 440 && y >= ry && y <= ry + h) { equipUI.sel = i; equipSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.BOARD && board) {
    const rows = boardRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = 86 + i * 34;
      if (x >= 30 && x <= 450 && y >= ry && y <= ry + 30) { board.sel = i; boardSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.QUESTLOG && questLog) {
    const rows = questLogRows();
    for (let i = 0; i < rows.length; i++) {
      const ry = questLogRowY(i);
      if (x >= 30 && x <= 450 && y >= ry && y <= ry + 34) { questLog.sel = i; questLogSelect(rows[i]); return; }
    }
    return;
  }
  if (state === STATE.WORDLIST && wordList) {
    const fy = H - 36;
    if (y >= fy && y <= fy + 28) {
      if (x >= 16 && x <= 112) { wordList.page--; return; }
      if (x >= 120 && x <= 216) { wordList.page++; return; }
      if (x >= W - 116 && x <= W - 16) { closeWordList(); return; }
    }
    wlToggleAt(x, y); // 行タップで習得/未習得を切替
    return;
  }
  if (state === STATE.BOSSBATTLE && bossBattle) {
    const bb = bossBattle;
    if (bb.phase === "menu") {
      for (let i = 0; i < 6; i++) {
        const bx = 16 + (i % 2) * 232, by = 306 + ((i / 2) | 0) * 44;
        if (x >= bx && x <= bx + 216 && y >= by && y <= by + 38) { bb.sel = i; bossCommand(["attack", "special", "summon", "item", "guard", "flee"][i]); return; }
      }
      return;
    }
    if (bb.phase === "item") {
      const m = Math.min(dishes.length, 6);
      for (let i = 0; i <= m; i++) {
        const ry = 304 + i * 24;
        if (x >= 16 && x <= 464 && y >= ry && y <= ry + 22) { if (i >= m) bossMenu(); else useDishInBattle(i); return; }
      }
      return;
    }
    if (bb.phase === "summon") {
      const m = Math.min(summonCards.length, 6);
      for (let i = 0; i <= m; i++) {
        const ry = 304 + i * 24;
        if (x >= 16 && x <= 464 && y >= ry && y <= ry + 22) { if (i >= m) bossMenu(); else useSummonInBattle(i); return; }
      }
      return;
    }
    return;
  }
  if (state === STATE.BATTLE && battle.phase === "select") {
    // 🔊 単語読み上げボタン
    if (window.Voice && inRect(x, y, BATTLE_SPK)) { Voice.speak(battle.word.en, "en"); return; }
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
// ===== セーブ/ロード(localStorage) =====
function showToast(m) { toastMsg = m; toastT = 1600; }
function canSave() { return state === STATE.FIELD || state === STATE.TOWN; } // 探索中のみ
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function saveGame() {
  if (!canSave()) return false;
  const data = {
    v: 1, toeicLevel, state,
    areaId: (state === STATE.TOWN && curArea) ? curArea.id : "field",
    player: {
      name: player.name,
      tx: player.tx, ty: player.ty, dir: player.dir,
      level: player.level, maxhp: player.maxhp, hp: player.hp, atk: player.atk, def: player.def,
      baseAtk: player.baseAtk, baseDef: player.baseDef, baseMaxhp: player.baseMaxhp,
      exp: player.exp, nextExp: player.nextExp, wins: player.wins, gold: player.gold,
      guildLevel: player.guildLevel, guildPoints: player.guildPoints,
    },
    equipped: { ...equipped },
    quest: quest ? { ...quest } : null,
    materials: { ...materials }, bag: { ...bag }, boughtItems: [...boughtItems],
    sideQuests: sideQuests.map((q) => ({ ...q })), sideQuestId,
    wordCorrect: { ...wordCorrect }, npcAffection: { ...npcAffection }, metNPCs: [...metNPCs], ownedHome, kotoha: { ...kotoha },
    dishes: dishes.map((d) => ({ ...d })), mealBuff: { ...mealBuff }, fieldBoss: fieldBoss ? { ...fieldBoss } : null,
    tributes: tributes.map((t) => ({ ...t })), summonCards: summonCards.map((c) => ({ ...c })),
    ownedFridge, ownedTV, fridge: { ...fridge }, fridgeDishes: fridgeDishes.map((d) => ({ ...d })), whBag: { ...whBag }, whMat: { ...whMat },
    savedOverworld: { ...savedOverworld }, catSpot,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; }
  catch (e) { console.warn("save failed", e); return false; }
}
function loadGame() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
  if (!data) { showToast("セーブデータがありません"); return false; }
  toeicLevel = data.toeicLevel || 500; updateLevelBtn();
  Object.assign(player, data.player);
  player.px = player.tx * TILE; player.py = player.ty * TILE; player.moving = false;
  quest = data.quest || null;
  reconcileGuildStory(); // 旧セーブの互換＆ランク条件の即時反映
  materials = data.materials || {}; bag = data.bag || {};
  boughtItems = new Set(data.boughtItems || []);
  // 装備: 旧セーブ(base無し)は現ステータスを素の値として扱う(装備なし)
  equipped = data.equipped || { weapon: null, head: null, armor: null, shield: null, accessory: null };
  if (player.baseAtk == null) { player.baseAtk = player.atk; player.baseDef = player.def; player.baseMaxhp = player.maxhp; }
  recomputeStats();
  sideQuests = data.sideQuests || []; sideQuestId = data.sideQuestId || 0;
  wordCorrect = data.wordCorrect || {};
  npcAffection = data.npcAffection || {};
  kotoha = data.kotoha || { level: 1, exp: 0, nextExp: 12 };
  if (data.floristAffection) npcAffection.florist = data.floristAffection; // 旧セーブ互換
  affectionRecent = {};
  metNPCs = new Set(data.metNPCs || []);
  ownedHome = data.ownedHome || null;
  ownedFridge = !!data.ownedFridge; ownedTV = !!data.ownedTV; fridge = data.fridge || {}; fridgeDishes = data.fridgeDishes || [];
  whBag = data.whBag || {}; whMat = data.whMat || {}; storageUI = null;
  refreshHome();
  dishes = data.dishes || [];
  tributes = data.tributes || [];
  summonCards = data.summonCards || [];
  pendingTribute = null;
  mealBuff = data.mealBuff || { atk: 0, def: 0 };
  battleBuff = { atk: 0, def: 0 };
  fieldBoss = data.fieldBoss || null; bossBattle = null;
  savedOverworld = data.savedOverworld || { tx: 2, ty: 12 };
  catSpot = Math.min(data.catSpot || 0, CAT_SPOTS.length - 1);
  CAT.tx = CAT_SPOTS[catSpot][0]; CAT.ty = CAT_SPOTS[catSpot][1];
  // 一時状態をクリア
  battle = null; shop = null; board = null; boardCache = null; questLog = null;
  quiz = null; cutsceneDraw = null; cutsceneSteps = null; messageSpeaker = null;
  if (window.Chat && Chat.isOpen()) Chat.close();
  // エリア/状態を復元
  if (data.state === STATE.TOWN && data.areaId && AREAS[data.areaId]) {
    curArea = AREAS[data.areaId]; state = STATE.TOWN;
  } else {
    curArea = AREAS.town; state = STATE.FIELD;
  }
  zone = (AREAS[data.areaId] && AREAS[data.areaId].zone) ? AREAS[data.areaId].zone : ""; // 洞窟/塔/城内なら復元
  for (const k in keys) keys[k] = false;
  resetEncounter();
  showToast("つづきから再開！");
  return true;
}

function startGame(level) {
  toeicLevel = level;
  updateLevelBtn();
  deleteSave(); // 新規開始: 古いセーブは消す(以降の自動セーブで新たに作られる)
  player.tx = 2; player.ty = 12; player.px = 2 * TILE; player.py = 12 * TILE;
  player.dir = "down"; player.moving = false;
  player.level = 1; player.baseMaxhp = 20; player.baseAtk = 6; player.baseDef = 0; player.hp = 20;
  equipped = { weapon: null, head: null, armor: null, shield: null, accessory: null }; recomputeStats();
  player.exp = 0; player.nextExp = 10; player.wins = 0; player.gold = 0;
  player.guildLevel = 0; player.guildPoints = 0;
  materials = {}; quest = null; boughtItems = new Set();
  bag = {}; catSpot = 0; CAT.tx = CAT_SPOTS[0][0]; CAT.ty = CAT_SPOTS[0][1];
  board = null; boardCache = null; sideQuests = []; questLog = null;
  wordCorrect = {}; zone = ""; npcAffection = {}; affectionRecent = {}; metNPCs = new Set(); ownedHome = null; refreshHome();
  kotoha = { level: 1, exp: 0, nextExp: 12 };
  dishes = []; tributes = []; summonCards = []; pendingTribute = null; mealBuff = { atk: 0, def: 0 }; battleBuff = { atk: 0, def: 0 };
  ownedFridge = false; ownedTV = false; fridge = {}; fridgeDishes = []; whBag = {}; whMat = {}; storageUI = null; bagPage = 0;
  fieldBoss = null; bossBattle = null;
  resetEncounter();
  startOpening();
}

function resetEncounter() { stepsToEncounter = 4 + Math.floor(rnd() * 6); }

// ===== 開発用: 指定の目的(ステージ)から開始 =====
// stage 0=①最初 1=②町へ 2=③聞込 3=④売る 4=⑤宿 5=⑥ギルド登録 6=⑦後
function devJump(stage) {
  if (!toeicLevel) toeicLevel = 500;
  updateLevelBtn();
  if (window.Chat && Chat.isOpen()) Chat.close();
  battle = null; shop = null; quiz = null; cutsceneDraw = null; cutsceneSteps = null; messageSpeaker = null;
  // 目的③以降を試せる程度のステータス
  player.level = 3; player.baseMaxhp = 32; player.baseAtk = 10; player.baseDef = 0; player.hp = 32;
  equipped = { weapon: null, head: null, armor: null, shield: null, accessory: null }; recomputeStats();
  player.exp = 0; player.nextExp = 26; player.wins = 5;
  player.guildLevel = stage >= 22 ? 4 : stage >= 19 ? 3 : stage >= 16 ? 2 : stage >= 6 ? 1 : 0; player.guildPoints = 0;
  boughtItems = new Set();
  quest = { stage, kills: stage === 0 ? 0 : 3, goal: 3, shopRevealed: stage >= 3 };
  reconcileGuildStory(); // 新ステージ(⑯以降)でもランク整合をとる
  materials = (stage === 2 || stage === 3) ? { "Slime Ooze": 3, "Bat Wing": 1, "Ghost Soul": 1 } : {};
  player.gold = stage >= 4 ? 80 : 0;
  // 迷いネコクエストの持ち物・ネコ位置を段階に合わせて用意
  bag = {};
  if (stage === 11) bag["Tuna"] = 1;          // ⑫: Tuna(マグロ)所持済みで開始(捕獲を試せる)
  if (stage === 12) bag["迷いネコ"] = 1;        // ⑬: 捕獲済みのネコを所持(届けられる)
  catSpot = 0; CAT.tx = CAT_SPOTS[0][0]; CAT.ty = CAT_SPOTS[0][1];
  board = null; boardCache = null; sideQuests = []; questLog = null;
  wordCorrect = {}; metNPCs = new Set(); npcAffection = {}; affectionRecent = {}; ownedHome = null; refreshHome();
  kotoha = { level: 1, exp: 0, nextExp: 12 };
  dishes = []; tributes = []; summonCards = []; pendingTribute = null; mealBuff = { atk: 0, def: 0 }; battleBuff = { atk: 0, def: 0 };
  ownedFridge = false; ownedTV = false; fridge = {}; fridgeDishes = []; whBag = {}; whMat = {}; storageUI = null; bagPage = 0;
  fieldBoss = null; bossBattle = null;
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
  // フィールドのボスにぶつかる → ボス戦開始(マスには乗らない)
  if (state === STATE.FIELD && fieldBoss && nx === fieldBoss.tx && ny === fieldBoss.ty) { startBossBattle(); return; }
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
  if (n) { interactNPC(n); return; }
  if (deskAt(fx, fy)) { startDeskStudy(); return; } // マイホームの勉強机→英訳ドリル
  if (kitchenAt(fx, fy)) { startCooking(); return; } // マイホームの台所→料理
  if (summonKitchenAt(fx, fy)) { startSummonCook(); return; } // 邸宅の大鍋→召喚料理
  if (summonCircleAt(fx, fy)) { startSummonCast(); return; } // 邸宅の召喚魔法陣→召喚
  if (fridgeAt(fx, fy)) { openStorage("fridge"); return; } // 冷蔵庫→食料保管
  if (warehouseAt(fx, fy)) { openStorage("warehouse"); return; } // 倉庫→持ち物保管
  if (tvAt(fx, fy)) { startTV(); return; }        // テレビ→AI放送
}
// マイホームの勉強机が指定マスにあるか
function deskAt(tx, ty) {
  return curArea.id === "home" && (curArea.decor || []).some((d) => d.kind === "desk" && d.tx === tx && d.ty === ty);
}
// 勉強机: コトハと和文英訳の英語学習(出題→英訳→添削の繰り返し)
function startDeskStudy() {
  for (const k in keys) keys[k] = false;
  Chat.openStudy(toeicLevel, () => { /* 終了後は家に留まる */ });
}
// マイホームの台所(コンロ/流し/作業台)が指定マスにあるか
function kitchenAt(tx, ty) {
  return curArea.id === "home" && (curArea.decor || []).some((d) =>
    (d.kind === "stove" || d.kind === "sink" || d.kind === "counter") && d.tx === tx && d.ty === ty);
}
// 台所: コトハと料理。手持ち食材を渡して英語で調理→完成・採点→効果つき料理を入手
function startCooking() {
  for (const k in keys) keys[k] = false;
  // 手持ちの食材は全量を渡す(表示はプレイヤー向けに全部、AIプロンプトはchat.js側で上限要約)
  const ings = INGREDIENT_NAMES.filter((n) => bag[n] > 0).map((n) => `${n}×${bag[n]}`);
  Chat.openCooking(toeicLevel, ings, (name, score, used) => cookFinish(name, score, used));
}
// ===== 大きな邸宅の召喚設備(邸宅のみ) =====
function summonKitchenAt(tx, ty) {
  return curArea.id === "home" && ownedHome === "manor" && (curArea.decor || []).some((d) => d.kind === "cauldron" && d.tx === tx && d.ty === ty);
}
function summonCircleAt(tx, ty) {
  return curArea.id === "home" && ownedHome === "manor" && (curArea.decor || []).some((d) => d.kind === "summoncircle" && d.tx === tx && d.ty === ty);
}
// マイホームの家電・倉庫
function fridgeAt(tx, ty) { return curArea.id === "home" && (curArea.decor || []).some((d) => d.kind === "fridge" && d.tx === tx && d.ty === ty); }
function tvAt(tx, ty) { return curArea.id === "home" && (curArea.decor || []).some((d) => d.kind === "tv" && d.tx === tx && d.ty === ty); }
function warehouseAt(tx, ty) { return curArea.id === "home" && (curArea.decor || []).some((d) => d.kind === "warehouse" && d.tx === tx && d.ty === ty); }
// ===== 装備メニュー(武器/頭/鎧/盾/アクセを付け替え) =====
let equipUI = null; // { view:"slots"|"items", slotKey, sel }
function openEquip() { for (const k in keys) keys[k] = false; equipUI = { view: "slots", slotKey: null, sel: 0 }; state = STATE.EQUIP; sfx("select"); }
function ownedForSlot(slot) { return [...boughtItems].filter((i) => SHOP_ITEMS[i] && SHOP_ITEMS[i].slot === slot); }
function equipRows() {
  const rows = [];
  if (equipUI.view === "slots") {
    for (const s of EQUIP_SLOTS) {
      const it = equipped[s] != null ? SHOP_ITEMS[equipped[s]] : null;
      const inner = it ? ((jaName(it.name) ? jaName(it.name) + "・" : "") + effText(it).trim()) : "";
      rows.push({ kind: "slot", slot: s, label: `${SLOT_JA[s]}： ${it ? `${it.name}（${inner}）` : "なし"}` });
    }
    rows.push({ kind: "close", label: "とじる" });
  } else {
    const owned = ownedForSlot(equipUI.slotKey);
    owned.forEach((i) => {
      const eq = equipped[equipUI.slotKey] === i;
      const ja = jaName(SHOP_ITEMS[i].name);
      const inner = (ja ? ja + "・" : "") + effText(SHOP_ITEMS[i]).trim();
      rows.push({ kind: "equip", idx: i, label: `${eq ? "✓ " : ""}${SHOP_ITEMS[i].name}（${inner}）` });
    });
    if (!owned.length) rows.push({ kind: "none", label: "持っている装備がない（武器屋で買おう）" });
    if (equipped[equipUI.slotKey] != null) rows.push({ kind: "unequip", label: "🚫 はずす" });
    rows.push({ kind: "back", label: "← もどる" });
  }
  return rows;
}
function equipSelect(row) {
  if (!row || row.kind === "none") return;
  if (row.kind === "close") { equipUI = null; state = STATE.TOWN; if (canSave()) saveGame(); sfx("cancel"); return; }
  if (row.kind === "back") { equipUI.view = "slots"; equipUI.sel = 0; sfx("cancel"); return; }
  if (row.kind === "slot") { equipUI.view = "items"; equipUI.slotKey = row.slot; equipUI.sel = 0; sfx("select"); return; }
  if (row.kind === "equip") { equipped[equipUI.slotKey] = row.idx; recomputeStats(); sfx("item"); return; }
  if (row.kind === "unequip") { equipped[equipUI.slotKey] = null; recomputeStats(); sfx("cancel"); return; }
}
function drawEquip() {
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'MS Gothic', monospace";
  ctx.fillText("そうび", W / 2, 42);
  ctx.fillStyle = "#ffe082"; ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(`Lv${player.level}  こうげき ${player.atk}  ぼうぎょ ${player.def}  さいだいHP ${player.maxhp}`, W / 2, 66);
  const rows = equipRows();
  const { top, rh, h } = shopRowLayout(rows.length + 1);
  for (let i = 0; i < rows.length; i++) {
    const y = top + i * rh;
    drawWindow(40, y, 400, h, equipUI.sel === i);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = (rows[i].kind === "close" || rows[i].kind === "back") ? "#9fd6ff" : rows[i].kind === "none" ? "#7a8aa8" : "#fff";
    ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 60, y + h / 2 + 1);
  }
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
}
// ===== 収納(冷蔵庫=食料/料理・倉庫=持ち物/素材)。1ページ10件でページ送り =====
function openStorage(kind) { for (const k in keys) keys[k] = false; storageUI = { kind, sel: 0, page: 0 }; state = STATE.STORAGE; }
// しまう/取り出せる項目(ページ分割前の全アクション)
function storageActions(kind) {
  const a = [];
  if (kind === "fridge") {
    Object.keys(bag).filter((n) => isFood(n) && bag[n] > 0).forEach((n) => a.push({ act: "store", name: n, label: `しまう ▶ ${n} ×${bag[n]}` }));
    dishes.forEach((d, i) => a.push({ act: "storedish", di: i, label: `しまう ▶ 🍳${d.name}` }));
    Object.keys(fridge).filter((n) => fridge[n] > 0).forEach((n) => a.push({ act: "take", name: n, label: `◀ 取り出す ${n} ×${fridge[n]}` }));
    fridgeDishes.forEach((d, i) => a.push({ act: "takedish", di: i, label: `◀ 取り出す 🍳${d.name}` }));
  } else {
    // 倉庫は食料と一部のクエスト用アイテムは預けられない
    Object.keys(bag).filter((n) => !isFood(n) && !NO_STORE_ITEMS.includes(n)).forEach((n) => a.push({ act: "whstore", name: n, label: `しまう ▶ ${n} ×${bag[n]}` }));
    Object.keys(materials).forEach((n) => a.push({ act: "whstoremat", name: n, label: `しまう ▶ [素材]${n} ×${materials[n]}` }));
    Object.keys(whBag).forEach((n) => a.push({ act: "whtake", name: n, label: `◀ 取り出す ${n} ×${whBag[n]}` }));
    Object.keys(whMat).forEach((n) => a.push({ act: "whtakemat", name: n, label: `◀ 取り出す [素材]${n} ×${whMat[n]}` }));
  }
  return a;
}
// 現在ページの表示行(アクション最大10＋前/次＋とじる)
function storageRows() {
  const actions = storageActions(storageUI.kind);
  const pages = Math.max(1, Math.ceil(actions.length / STORAGE_PER_PAGE));
  if (storageUI.page >= pages) storageUI.page = pages - 1;
  if (storageUI.page < 0) storageUI.page = 0;
  const start = storageUI.page * STORAGE_PER_PAGE;
  const rows = actions.slice(start, start + STORAGE_PER_PAGE);
  if (!actions.length) rows.push({ kind: "empty", label: storageUI.kind === "fridge" ? "しまえる食料がないよ" : "しまえる持ち物がないよ" });
  if (pages > 1) {
    rows.push({ kind: "prev", label: "◀ 前のページ", dis: storageUI.page <= 0 });
    rows.push({ kind: "next", label: "次のページ ▶", dis: storageUI.page >= pages - 1 });
  }
  rows.push({ kind: "close", label: "とじる" });
  return rows;
}
function storageSelect(row) {
  if (!row || row.kind === "empty" || row.dis) return;
  const ui = storageUI;
  if (row.kind === "close") { storageUI = null; state = STATE.TOWN; if (canSave()) saveGame(); return; }
  if (row.kind === "prev") { ui.page = Math.max(0, ui.page - 1); ui.sel = 0; return; }
  if (row.kind === "next") { ui.page++; ui.sel = 0; return; }
  switch (row.act) {
    case "store": { const c = bag[row.name]; delete bag[row.name]; fridge[row.name] = (fridge[row.name] || 0) + c; break; }
    case "take": if (bagFull(row.name)) { showToast(`もちものがいっぱい（${BAG_MAX_TYPES}種類）`); return; } bag[row.name] = (bag[row.name] || 0) + fridge[row.name]; delete fridge[row.name]; break;
    case "storedish": { const d = dishes.splice(row.di, 1)[0]; if (d) fridgeDishes.push(d); break; }
    case "takedish": { const d = fridgeDishes.splice(row.di, 1)[0]; if (d) { dishes.push(d); if (dishes.length > 12) dishes.shift(); } break; }
    case "whstore": { const c = bag[row.name]; delete bag[row.name]; whBag[row.name] = (whBag[row.name] || 0) + c; break; }
    case "whstoremat": { const c = materials[row.name]; delete materials[row.name]; whMat[row.name] = (whMat[row.name] || 0) + c; break; }
    case "whtake": if (bagFull(row.name)) { showToast(`もちものがいっぱい（${BAG_MAX_TYPES}種類）`); return; } bag[row.name] = (bag[row.name] || 0) + whBag[row.name]; delete whBag[row.name]; break;
    case "whtakemat": materials[row.name] = (materials[row.name] || 0) + whMat[row.name]; delete whMat[row.name]; break;
  }
  const rows = storageRows();
  if (ui.sel >= rows.length) ui.sel = rows.length - 1;
}
function drawStorage() {
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  const kind = storageUI.kind;
  const actions = storageActions(kind);
  const pages = Math.max(1, Math.ceil(actions.length / STORAGE_PER_PAGE));
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'MS Gothic', monospace";
  ctx.fillText(kind === "fridge" ? "冷蔵庫" : "倉庫", W / 2, 42);
  ctx.fillStyle = "#9fd6ff"; ctx.font = "12px 'MS Gothic', monospace";
  ctx.fillText(`${kind === "fridge" ? "食料品・料理をしまう / 取り出す" : "持ち物・素材をしまう / 取り出す"}   ページ ${storageUI.page + 1}/${pages}`, W / 2, 64);
  const rows = storageRows();
  const { top, rh, h } = shopRowLayout(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const y = top + i * rh;
    drawWindow(40, y, 400, h, storageUI.sel === i);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = row_dim(rows[i]) ? "#5a6a80" : (rows[i].kind === "close" || rows[i].kind === "prev" || rows[i].kind === "next") ? "#9fd6ff" : "#fff";
    ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 60, y + h / 2 + 1);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
}
function row_dim(row) { return !!row.dis; }
// テレビ: AI放送(ニュース/アニメ/バラエティ)。見るだけ・チャンネル変更のみ。
function startTV() {
  for (const k in keys) keys[k] = false;
  Chat.openTV(toeicLevel);
}
// 召喚料理の大鍋: モンスター素材で貢物を作る
function startSummonCook() {
  for (const k in keys) keys[k] = false;
  const mats = Object.keys(materials).filter((n) => materials[n] > 0).map((n) => `${n}×${materials[n]}`);
  Chat.openSummonCook(toeicLevel, mats, (name, score, used) => summonCookFinish(name, score, used));
}
// 召喚料理 完成: 素材を消費し、出来栄えつきの貢物を得る
function summonCookFinish(name, quality, used) {
  quality = Math.max(0, Math.min(100, Math.round(quality || 0)));
  const consumed = [];
  for (const ing of (used || [])) {
    const key = Object.keys(materials).find((n) => ing && String(ing).indexOf(n) >= 0);
    if (key && materials[key] > 0) { materials[key]--; if (materials[key] <= 0) delete materials[key]; consumed.push(key); }
  }
  const dishName = name || "謎の貢物";
  tributes.push({ name: dishName, quality });
  if (tributes.length > 12) tributes.shift();
  if (canSave()) saveGame();
  return { lines: [
    consumed.length ? `使った素材: ${consumed.join("、")}（消費）` : "（素材は使わなかった）",
    `貢物「${dishName}」を手に入れた！（出来${quality}）召喚魔法陣で使えるよ。`,
  ] };
}
// 召喚魔法陣: 貢物を捧げて英語詠唱→召喚獣カード
function startSummonCast() {
  for (const k in keys) keys[k] = false;
  if (!tributes.length) {
    playTownCutscene([{ who: "コトハ", lines: ["召喚には『貢物(召喚料理)』が必要だよ。", "召喚料理の大鍋で、モンスターの素材から作ろう！"] }]);
    return;
  }
  pendingTribute = tributes[tributes.length - 1]; // 一番新しい貢物を捧げる
  Chat.openSummonCast(toeicLevel, pendingTribute.name, (bn, el, iq) => summonCastFinish(bn, el, iq));
}
// 出来栄え(貢物)＋詠唱の英語 の平均が高いほど高レアが出やすい
function rollRarity(avg) {
  const r = avg * 0.7 + rnd() * 50;
  if (r >= 95) return 5; if (r >= 78) return 4; if (r >= 58) return 3; if (r >= 35) return 2; return 1;
}
function summonCastFinish(beastName, element, iq) {
  const trib = pendingTribute; pendingTribute = null;
  const q = trib ? trib.quality : 40;
  const avg = (q + Math.max(0, Math.min(100, iq || 0))) / 2;
  const rarity = rollRarity(avg);
  if (trib) { const idx = tributes.indexOf(trib); if (idx >= 0) tributes.splice(idx, 1); } // 貢物を消費
  const el = ELEMENT_JA[element] ? element : "fire";
  const card = { name: beastName || "謎の召喚獣", element: el, rarity, atk: SUMMON_ATK[rarity], turns: SUMMON_TURNS[rarity] };
  summonCards.push(card);
  if (summonCards.length > 20) summonCards.shift();
  if (canSave()) saveGame();
  return { lines: [
    `✨ 召喚成功！ ${"★".repeat(rarity)} 【${ELEMENT_JA[el]}属性】${card.name}`,
    `攻撃${card.atk} ／ 味方でいる ${card.turns}ターン`,
    "召喚獣カードを手に入れた！（戦闘中に「しょうかん」で使えるよ）",
  ] };
}
// 料理完成: 使った食材を消費し、出来栄えに応じた効果の料理を作る。返り値 { lines }。
function cookFinish(name, score, used) {
  score = Math.max(0, Math.min(100, Math.round(score || 0)));
  let consumedNames = [];
  for (const ing of (used || [])) {
    const key = INGREDIENT_NAMES.find((n) => ing && String(ing).indexOf(n) >= 0); // 「Tuna×1」等の表記ゆれ吸収
    if (key && bag[key] > 0) { useItem(key); consumedNames.push(key); }
  }
  const consumed = consumedNames.length;
  const heal = 12 + Math.round(score * 0.4) + consumed * 6;
  let atk = 0, def = 0;
  if (score >= 85) { atk = 5; def = 3; } else if (score >= 70) { atk = 3; def = 1; } else if (score >= 50) { atk = 2; def = 0; }
  dishes.push({ name: name || "なぞの料理", score, heal, atk, def });
  if (dishes.length > 12) dishes.shift();
  const lines = [consumed ? `使った食材: ${consumedNames.join("、")}（消費）` : "（食材は使わなかった）"];
  let eff = `効果: HP+${heal}`;
  if (atk || def) eff += ` ／ 次の戦闘 ${atk ? `こうげき+${atk} ` : ""}${def ? `ぼうぎょ+${def}` : ""}`;
  lines.push(eff);
  if (canSave()) saveGame();
  return { lines };
}
// 料理を食べる(もちものからタップ)。HP回復＋次の戦闘バフを保留。
function eatDish(i) {
  const d = dishes[i]; if (!d) return;
  const back = state;
  const before = player.hp;
  player.hp = Math.min(player.maxhp, player.hp + d.heal);
  const healed = player.hp - before;
  mealBuff.atk += d.atk; mealBuff.def += d.def;
  dishes.splice(i, 1);
  if (canSave()) saveGame();
  const lines = [`${d.name}を 食べた！ HP+${healed}`];
  if (d.atk || d.def) lines.push(`次の戦闘で ${d.atk ? `こうげき+${d.atk} ` : ""}${d.def ? `ぼうぎょ+${d.def}` : ""}！`);
  showMessage(lines, () => { state = back; });
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
  if (quest && quest.stage === 2) {                            // 素材屋の場所を尋ねるイベント(町の全NPCに適用)
    if (Chat.aiReady()) talkAskDirections(n);
    else askDirections(n);
    return;
  }
  if (n.id === "innkeeper") { talkInn(n); return; }            // 宿屋: 泊まりたい→泊まる
  if (n.id === "guild_receptionist") { talkGuild(n); return; } // ギルド受付: 登録/依頼/報告
  if (n.id === "salon") { talkSalon(n); return; }              // 美容師Coco: 特徴を聞く/ネコを届ける
  if (n.id === "realestate") { talkRealEstate(n); return; }    // 不動産屋: 家を買う
  if (n.shop) { talkShop(n); return; }                         // 店: 売りたい/買いたい→メニュー
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
  // エリアボス討伐の報告(討伐済み=progress>=1)
  const doneBoss = sideQuests.find((q) => q.type === "areaboss" && q.status === "active" && q.progress >= 1);
  if (doneBoss) { reportAreaBoss(doneBoss); return; }
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
  // 目的⑰: ランク2到達後、受付から古代の遺跡の碑文調査を依頼される
  if (quest && quest.stage === 16) { giveInscriptionQuest(); return; }
  // 目的㉑: ランク3到達後、受付から氷の遺跡の碑文調査を依頼される
  if (quest && quest.stage === 19) { giveIceInscriptionQuest(); return; }
  // 登録済み & メイン依頼ステップでない → ギルドAI依頼ボード
  openBoard();
}
// 目的⑰達成→⑱: 古代の遺跡の碑文調査を依頼される
function giveInscriptionQuest() {
  if (!quest || quest.stage !== 16) return;
  quest.stage = 17;
  playTownCutscene([
    { who: "受付 Fia", lines: ["I have a special request for you."] },
    { who: "コトハ", lines: ["Fiaさんから特別な依頼だよ！", "『古代の遺跡の最奥にある“碑文”を調べてきてほしい』って。", "古代の遺跡は…最初に入ったあの遺跡のことだね。"] },
    { who: "コトハ", lines: ["でも碑文の前には強い魔物が待ってるらしい…気をつけよう。", "フィールドの洞窟(古代の遺跡)に入って、いちばん奥まで進もう！"] },
  ]);
}
// 目的⑳達成→㉑: 氷の遺跡の碑文調査を依頼される
function giveIceInscriptionQuest() {
  if (!quest || quest.stage !== 19) return;
  quest.stage = 20;
  playTownCutscene([
    { who: "受付 Fia", lines: ["Another request, only you can handle it."] },
    { who: "コトハ", lines: ["また特別な依頼だよ！", "『氷の遺跡の最奥にある“碑文”も調べてほしい』って。", "氷の遺跡は…フィールドの青い岩山(Z)から入る、あの氷の遺跡だね。"] },
    { who: "コトハ", lines: ["こんどの碑文の前には“氷の女王の亡霊”がいるらしい…かなり手強いよ。", "しっかり準備して、氷の遺跡のいちばん奥まで進もう！"] },
  ]);
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
  quest.stage = 15; // ⑮ボード解放 →(⑯)ギルドランク2を目指す
  const goldReward = 100, gpReward = 60;
  player.gold += goldReward;
  const ups = addGuildPoints(gpReward);
  const lines = [
    "依頼達成おめでとう、相棒！",
    `報酬として ${goldReward}ゴールド と ギルドポイント${gpReward} をもらったよ！`,
  ];
  if (ups > 0) lines.push(`やったね、ギルドランクが ${player.guildLevel} に上がったよ！`);
  lines.push("これでギルドの依頼ボードも自由に使えるよ。");
  lines.push("まずはいろんな依頼をこなして、ギルドランク2を目指そう！");
  playTownCutscene([{ who: "コトハ", lines }]);
}
// ギルドポイント獲得後に呼ぶ: ランク到達でストーリーを進める(返り値=追加で見せる行)
function checkGuildStoryProgress() {
  if (!quest) return [];
  // 旧セーブ互換: ⑮(stage14)は⑯(ランク2を目指す)フェーズと同じ扱い
  if (quest.stage === 14) quest.stage = 15;
  if (quest.stage === 15 && player.guildLevel >= 2) {
    quest.stage = 16;
    return ["ギルドランク2になった！ 一人前だね。", "コトハ「受付のFiaさんが話したいことがあるみたい。ギルドへ行ってみよう！」"];
  }
  if (quest.stage === 18 && player.guildLevel >= 3) {
    quest.stage = 19;
    return ["ギルドランク3になった！ ぐっと頼もしくなったね。", "コトハ「受付のFiaさんがまた話したいことがあるみたい。ギルドへ行ってみよう！」"];
  }
  if (quest.stage === 21 && player.guildLevel >= 4) {
    quest.stage = 22;
    return ["ギルドランク4になった！ もう立派なベテランだね。", "コトハ「よし、炎の遺跡へ手がかりを探しに行こう！（…の準備をしてるところ）」"];
  }
  return [];
}
// ロード時などに、クエスト段階を現在のギルドランクと整合させる(旧セーブ救済)
function reconcileGuildStory() {
  if (!quest) return;
  if (quest.stage === 14) quest.stage = 15;                                   // ⑮→⑯フェーズへ
  if (quest.stage === 15 && player.guildLevel >= 2) quest.stage = 16;         // ランク2到達済み→ギルドへ
  if (quest.stage === 18 && player.guildLevel >= 3) quest.stage = 19;         // ランク3到達済み→ギルドへ
  if (quest.stage === 21 && player.guildLevel >= 4) quest.stage = 22;         // ランク4到達済み→次章
}

// =====================================================================
// ギルドAI依頼ボード(サブクエスト): 討伐 / おつかい / 会話チャレンジ
// =====================================================================
// 報酬はバランスのためゲーム側で決める
function rewardFor(type, count) {
  const lv = toeicLevel === 900 ? 3 : toeicLevel === 700 ? 2 : 1;
  if (type === "areaboss") return { gold: 150 + 40 * lv, gp: 40 }; // ボス討伐は高報酬
  if (type === "hunt") return { gold: 30 + 15 * count + 10 * lv, gp: 12 + 4 * count };
  if (type === "fetch") return { gold: 50 + 10 * lv, gp: 14 };
  return { gold: 45 + 15 * lv, gp: 22 }; // talk: 英語チャレンジはGP高め
}
function buildTalkNote(goal) {
  return `the traveler successfully accomplishes the following in clear English during this conversation: ${goal}. Only when they clearly manage it in understandable English, warmly acknowledge it in character.`;
}
// 事前定義の依頼リスト(QUEST_POOL, quests.js)から依頼1件を実体化
function instantiateQuest(def) {
  const count = def.count || (def.type === "hunt" ? 3 : 1);
  const rw = rewardFor(def.type, count);
  const q = {
    id: ++sideQuestId, type: def.type, status: "active", progress: 0,
    title_ja: def.title_ja, desc_ja: def.desc_ja, flavor_en: def.flavor_en,
    gold: rw.gold, gp: rw.gp,
  };
  if (def.type === "hunt") { q.enemy = def.enemy; q.count = count; }
  else if (def.type === "fetch") { q.item = def.item; q.deliverTo = def.deliverTo; }
  else if (def.type === "talk") { q.npcId = def.npcId; q.goal_en = def.goal_en; q.goal_ja = def.goal_ja; q.note_en = buildTalkNote(def.goal_en); }
  else if (def.type === "areaboss") { q.boss = def.boss; q.zone = def.zone || "field"; q.bossName = (AREA_BOSSES[def.boss] || {}).name || "ボス"; }
  return q;
}
// 依頼の種類ごとの出現重み(会話を増やしても戦闘依頼が埋もれないよう調整)
const QUEST_TYPE_WEIGHTS = [
  { type: "areaboss", w: 10 },
  { type: "hunt",     w: 35 },
  { type: "talk",     w: 55 },
];
// 依頼プール(QUEST_POOL)からn件(重複なし)を、種類の重みに従って選んで実体化
function pickQuestsFromPool(n) {
  // 種類ごとに分類してシャッフル
  const byType = { areaboss: [], hunt: [], talk: [] };
  for (const q of (typeof QUEST_POOL !== "undefined" ? QUEST_POOL : [])) {
    if (byType[q.type]) byType[q.type].push(q);
  }
  for (const t in byType) {
    const a = byType[t];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  }
  const picked = [];
  for (let k = 0; k < n; k++) {
    const avail = QUEST_TYPE_WEIGHTS.filter((w) => byType[w.type].length > 0);
    if (!avail.length) break; // もう出せる依頼がない
    const total = avail.reduce((s, w) => s + w.w, 0);
    let r = rnd() * total, type = avail[avail.length - 1].type;
    for (const w of avail) { if (r < w.w) { type = w.type; break; } r -= w.w; }
    picked.push(byType[type].pop());
  }
  return picked.map(instantiateQuest);
}
// 依頼ボードを(再)生成: 種類の重みに従って5件出題
function refreshBoard() {
  if (!board) return;
  boardCache = pickQuestsFromPool(5);
  board.loading = false; board.sel = 0; board.msg = "";
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
function questIcon(type) { return type === "areaboss" ? "👹" : type === "hunt" ? "⚔" : type === "fetch" ? "📦" : "💬"; }
function boardSelect(row) {
  if (!row || board.loading) return;
  if (row.kind === "exit") { board = null; state = STATE.TOWN; return; }
  if (row.kind === "refresh") { refreshBoard(); return; }
  if (row.kind === "quest") {
    if (sideQuests.length >= 3) { board.msg = "受注中の依頼が多すぎるよ(最大3件)"; board.msgT = 220; return; }
    const q = boardCache[row.idx];
    if (q.type === "areaboss" && sideQuests.some((s) => s.type === "areaboss")) {
      board.msg = "討伐依頼は同時に1件までだよ"; board.msgT = 240; return;
    }
    boardCache.splice(row.idx, 1);
    sideQuests.push(q);
    if (q.type === "areaboss") { spawnFieldBoss(q); board.msg = `『${q.title_ja}』受注！ フィールドにボスが出現！`; }
    else board.msg = `依頼『${q.title_ja}』を受けた！`;
    board.msgT = 260;
    if (board.sel >= boardRows().length) board.sel = boardRows().length - 1;
  }
}
// 受注中の依頼の詳細を見る
function openQuestLog() {
  if (!sideQuests.length) return;
  for (const k in keys) keys[k] = false;
  questLog = { sel: 0, confirm: null };
  state = STATE.QUESTLOG;
}
// 受注ログの行の描画/タップ座標(通常時とキャンセル確認時で開始位置が変わる)
function questLogRowY(i) { return ((questLog && questLog.confirm != null) ? 150 : 64) + i * 38; }
function questLogRows() {
  if (questLog && questLog.confirm != null) {
    return [
      { kind: "cancelYes", label: "❌ はい、この依頼をやめる" },
      { kind: "cancelNo",  label: "もどる" },
    ];
  }
  const rows = sideQuests.map((q, i) => ({ kind: "q", idx: i, label: `${questIcon(q.type)} ${q.title_ja}` }));
  rows.push({ kind: "close", label: "とじる" });
  return rows;
}
// 受注中の依頼をキャンセル(報酬なし)。エリアボスならフィールドのボスも消す。
function cancelSideQuest(idx) {
  const q = sideQuests[idx];
  if (!q) { questLog.confirm = null; questLog.sel = 0; return; }
  if (q.type === "areaboss" && fieldBoss && fieldBoss.questId === q.id) fieldBoss = null;
  sideQuests.splice(idx, 1);
  sfx("cancel");
  questLog.confirm = null;
  questLog.sel = 0;
  if (!sideQuests.length) { questLog = null; state = STATE.TOWN; }
}
// 依頼1件の詳細テキスト行
function questDetailLines(q) {
  const lines = [q.desc_ja];
  if (q.type === "areaboss") lines.push(q.progress >= 1 ? "討伐完了！ ギルド受付に報告しよう" : `${q.bossName || "ボス"}がフィールドに出現中。会いに行ってたおそう！`);
  else if (q.type === "hunt") lines.push(`進行: ${q.enemy === "any" ? "モンスター" : q.enemy} ${q.progress}/${q.count} 体`);
  else if (q.type === "fetch") lines.push("※アイテムを持って対象の人に話しかけよう");
  else if (q.type === "talk") lines.push(`お題: ${q.goal_ja || "英語で話す"}（英語で伝えよう）`);
  lines.push(`報酬: ${q.gold}G ＋ ギルドポイント${q.gp}`);
  return lines;
}
function questLogSelect(row) {
  if (!row) return;
  if (row.kind === "close") { questLog = null; state = STATE.TOWN; return; }
  if (row.kind === "q") { questLog.confirm = row.idx; questLog.sel = 0; sfx("select"); return; } // キャンセル確認へ
  if (row.kind === "cancelYes") { cancelSideQuest(questLog.confirm); return; }
  if (row.kind === "cancelNo") { questLog.confirm = null; questLog.sel = 0; return; }
}
function drawQuestLog() {
  ctx.fillStyle = "#0a1630"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff"; ctx.font = "bold 20px 'MS Gothic', monospace";
  ctx.fillText("受注中のギルド依頼", W / 2, 38);
  const rows = questLogRows();
  // ── キャンセル確認モード ──
  if (questLog.confirm != null) {
    const q = sideQuests[questLog.confirm];
    ctx.textAlign = "center"; ctx.fillStyle = "#ffd24a"; ctx.font = "15px 'MS Gothic', monospace";
    ctx.fillText("この依頼をキャンセルする？", W / 2, 84);
    ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
    if (q) ctx.fillText(`${questIcon(q.type)} 『${q.title_ja}』`, W / 2, 112);
    ctx.fillStyle = "#ff9b9b"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText("※ キャンセルすると報酬はもらえません", W / 2, 134);
    for (let i = 0; i < rows.length; i++) {
      const y = questLogRowY(i);
      drawWindow(30, y, 420, 34, questLog.sel === i);
      ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
      ctx.fillText(rows[i].label, 48, y + 23);
    }
    ctx.textAlign = "center"; return;
  }
  // ── 通常モード(受注一覧＋詳細) ──
  for (let i = 0; i < rows.length; i++) {
    const y = questLogRowY(i);
    drawWindow(30, y, 420, 34, questLog.sel === i);
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "14px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 48, y + 23);
  }
  const sel = rows[questLog.sel];
  const yD = questLogRowY(rows.length) + 8;
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
    ctx.textAlign = "center"; ctx.fillStyle = "#9fb3d8"; ctx.font = "11px 'MS Gothic', monospace";
    ctx.fillText("決定でこの依頼をキャンセルできます", W / 2, yD + bh + 16);
  }
  ctx.textAlign = "center";
}

// ===== 達成率(今いるエリアの習得率を画面に常時表示) =====
// 「達成」= その項目を3回正解して以降出題されなくなった状態(wordCorrect>=3)
// 今いるエリアの単語/熟語/文法プールを返す
function currentPool() {
  if (zone === "dungeon" && typeof DUNGEON_WORD_DATA !== "undefined") return { name: "古代の遺跡", data: DUNGEON_WORD_DATA, key: (w) => w.en };
  if (zone === "dungeon2" && typeof DUNGEON2_WORD_DATA !== "undefined") return { name: "氷の遺跡", data: DUNGEON2_WORD_DATA, key: (w) => w.en };
  if (zone === "fire" && typeof FIRE_WORD_DATA !== "undefined") return { name: "炎の遺跡", data: FIRE_WORD_DATA, key: (w) => w.en };
  if (zone === "tower" && typeof TOWER_WORD_DATA !== "undefined") return { name: "タワー", data: TOWER_WORD_DATA, key: (w) => w.en };
  if (zone === "castle" && typeof GRAMMAR_DATA !== "undefined") return { name: "魔王城", data: GRAMMAR_DATA, key: (g) => g.q };
  return { name: "フィールド", data: WORD_DATA, key: (w) => w.en };
}
// 今いるエリア・今の難易度の達成率
function currentAreaRate() {
  const p = currentPool();
  const arr = (p.data && p.data[toeicLevel]) || [];
  let m = 0;
  for (const it of arr) if ((wordCorrect[p.key(it)] || 0) >= 3) m++;
  return { name: p.name, m, total: arr.length, pct: arr.length ? Math.round(m / arr.length * 100) : 0 };
}
// 画面左上の習得バー(情報パネル表示中・探索中のみ)。タップで習得リストを開く
function drawAreaRate() {
  if (!hudShown || (state !== STATE.FIELD && state !== STATE.TOWN)) { rateBoxRect = null; return; }
  const r = currentAreaRate();
  drawWindow(8, 8, 196, 24, false);
  rateBoxRect = { x: 8, y: 8, w: 196, h: 24 };
  ctx.textAlign = "left"; ctx.font = "11px 'MS Gothic', monospace";
  ctx.fillStyle = "#ffd24a";
  ctx.fillText(`🏅 ${r.name} 習得 ${r.pct}% (${r.m}/${r.total})`, 18, 24);
  ctx.textAlign = "right"; ctx.fillStyle = "#9fd6ff"; ctx.font = "9px 'MS Gothic', monospace";
  ctx.fillText("▶一覧", 8 + 196 - 6, 21);
  ctx.textAlign = "center";
}

// ===== 習得リスト(今いるエリア・今の難易度の語と正解回数。タップで習得↔未習得) =====
const WL_ROWS = 13;
function openWordList() {
  for (const k in keys) keys[k] = false;
  wordListBack = (state === STATE.TOWN) ? STATE.TOWN : STATE.FIELD;
  wordList = { page: 0 };
  state = STATE.WORDLIST;
}
function closeWordList() { wordList = null; state = wordListBack; }
function wlData() {
  const p = currentPool();
  return { name: p.name, key: p.key, arr: (p.data && p.data[toeicLevel]) || [] };
}
function wlPages(arr) { return Math.max(1, Math.ceil(arr.length / WL_ROWS)); }
function drawWordList() {
  ctx.fillStyle = "#0a1226"; ctx.fillRect(0, 0, W, H);
  const d = wlData(); const pages = wlPages(d.arr);
  if (wordList.page >= pages) wordList.page = pages - 1;
  if (wordList.page < 0) wordList.page = 0;
  let mastered = 0;
  for (const it of d.arr) if ((wordCorrect[d.key(it)] || 0) >= 3) mastered++;
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 16px 'MS Gothic', monospace";
  ctx.fillText(`習得リスト：${d.name} TOEIC${toeicLevel}`, W / 2, 26);
  ctx.fillStyle = "#9fb3d8"; ctx.font = "11px 'MS Gothic', monospace";
  ctx.fillText(`${mastered}/${d.arr.length} 習得  ・ ページ ${wordList.page + 1}/${pages}  ・ 行タップで正解数+1(3で習得・次で0)`, W / 2, 44);
  const start = wordList.page * WL_ROWS;
  const slice = d.arr.slice(start, start + WL_ROWS);
  for (let i = 0; i < slice.length; i++) {
    const it = slice[i]; const c = wordCorrect[d.key(it)] || 0; const done = c >= 3;
    const y = 54 + i * 28;
    drawWindow(16, y, W - 32, 25, false);
    ctx.textAlign = "left"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillStyle = done ? "#9fffcf" : "#fff";
    ctx.fillText(`${done ? "✓ " : "  "}${trimLabel(it.en || it.q, 24)}`, 26, y + 17);
    ctx.textAlign = "right"; ctx.font = "12px 'MS Gothic', monospace"; ctx.fillStyle = "#ffd24a";
    ctx.fillText("●".repeat(c) + "○".repeat(Math.max(0, 3 - c)) + `  正解${c}回`, W - 26, y + 17);
  }
  // フッタ(前/次/とじる)
  const fy = H - 36;
  drawWindow(16, fy, 96, 28, false); drawWindow(120, fy, 96, 28, false); drawWindow(W - 116, fy, 100, 28, false);
  ctx.textAlign = "center"; ctx.font = "14px 'MS Gothic', monospace"; ctx.fillStyle = "#fff";
  ctx.fillText("◀ 前", 64, fy + 19); ctx.fillText("次 ▶", 168, fy + 19); ctx.fillText("× とじる", W - 66, fy + 19);
}
function wlToggleAt(x, y) {
  const d = wlData();
  const start = wordList.page * WL_ROWS;
  const slice = d.arr.slice(start, start + WL_ROWS);
  for (let i = 0; i < slice.length; i++) {
    const ry = 54 + i * 28;
    if (x >= 16 && x <= W - 16 && y >= ry && y <= ry + 25) {
      const k = d.key(slice[i]);
      wordCorrect[k] = ((wordCorrect[k] || 0) + 1) % 4; // クリックごとに 0→1→2→3→0
      return true;
    }
  }
  return false;
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
  lines.push(...checkGuildStoryProgress());
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
// 花屋リリィ: 好感度つきのAI会話。自然・高度な英語ほど好感度が上がる
// ===== 全NPC共通の好感度システム(良い英語で会話すると上がり、口調が親しくなる) =====
// 2文の単語集合の類似度(Jaccard)。単調/繰り返しの無効点判定に使う。
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const sa = new Set(a.split(" ")), sb = new Set(b.split(" "));
  let inter = 0; sa.forEach((w) => { if (sb.has(w)) inter++; });
  const uni = new Set([...sa, ...sb]).size;
  return uni ? inter / uni : 0;
}
// 花屋リリィ専用の口調(内気な女の子が打ち解けていく)
function floristTone(aff) {
  if (aff >= 80) return "RELATIONSHIP: You and this traveler are very close, dear friends (affection 80+/100). Speak warmly and affectionately, openly delighted to see them, playful and relaxed, sharing little personal feelings.";
  if (aff >= 50) return "RELATIONSHIP: You and this traveler are good friends now (affection 50+/100). Speak cheerfully and warmly, clearly glad to talk with them.";
  if (aff >= 20) return "RELATIONSHIP: You are starting to get along with this traveler (affection 20+/100). Be friendly and a bit more relaxed and open than at first, though still a little shy.";
  return "RELATIONSHIP: You have only just met this traveler. Be polite, gentle and a little shy, warming up gradually.";
}
// 一般NPCの口調(よそよそしい→親しい)。初対面(20未満)は素のペルソナのままにしてトークン節約。
function genericTone(aff) {
  if (aff >= 80) return "RELATIONSHIP: You and this traveler are close friends now (affection 80+/100). Speak warmly and familiarly, openly happy to see them again, relaxed and friendly.";
  if (aff >= 50) return "RELATIONSHIP: You and this traveler are good friends (affection 50+/100). Speak cheerfully and warmly, glad to talk with them.";
  if (aff >= 20) return "RELATIONSHIP: You are starting to get along with this traveler (affection 20+/100). Be a bit friendlier and more relaxed than with a stranger.";
  return "";
}
// chat.js から: そのNPCの現在の好感度に応じた口調指示を返す
window.getAffectionTone = (id) => {
  const aff = npcAffection[id] || 0;
  return id === "florist" ? floristTone(aff) : genericTone(aff);
};
// chat.js から: 会話開始時に「単調判定」の直近履歴をリセット
window.affectionOpen = (id) => { if (id) affectionRecent[id] = []; };
// 節目(40/70/100)の演出。※報酬(40/70=小ごほうび・100=レアアイテム)は後でここに差し込む(フック)
function affectionMilestone(id, short, level) {
  // TODO(報酬): level===40/70 は小ごほうび、level===100 はレアアイテムをここで付与する
  if (level === 100) return [`🎉 ${short}と大の親友になった！（特別なごほうびは準備中…）`];
  if (level === 70) return [`✨ ${short}とすっかり仲良し！`];
  return [`😊 ${short}と打ち解けてきた！`];
}
// chat.js から毎ターン: 英語の質に応じて好感度を加算。文脈外/単調/短すぎは無効点。
// 返り値 { lines:[表示文...] } または null。
window.npcAffectionReply = (id, name, d, userText) => {
  if (!id) return null;
  let aff = npcAffection[id] || 0;
  if (aff >= 100) return null; // 既に最大
  const short = (name || "").split(" ").pop() || "この人";
  const norm = String(userText || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  const words = norm ? norm.split(" ") : [];
  const recent = affectionRecent[id] || (affectionRecent[id] = []);
  const tooShort = words.length < 3;                                   // 短すぎ＝単調
  const repetitive = recent.some((p) => textSimilarity(p, norm) >= 0.8); // 直近と酷似＝繰り返し
  const meaningful = !d || d.meaningful !== false;                     // AI判定: 会話の流れに合うか
  recent.push(norm); if (recent.length > 5) recent.shift();
  // 無効点(加算なし)
  if (tooShort || repetitive || !meaningful) {
    return { lines: [repetitive ? "🙅 さっきと似た文だよ。新しい表現で話そう！（好感度そのまま）"
      : !meaningful ? "🙅 会話の流れに合っていないみたい。（好感度そのまま）"
      : "🙅 ひとことだけじゃ伝わらないかも。文で話そう！（好感度そのまま）"] };
  }
  const natural = !!(d && d.correction && d.correction.natural);
  const fluent = !!(d && d.fluent === true); // 高度・流暢な英語
  let up = fluent && words.length >= 8 ? 5 : fluent ? 3 : natural ? 1 : 0;
  if (up <= 0) return null;
  const before = aff;
  aff = Math.min(100, aff + up); npcAffection[id] = aff;
  const lines = [`💗 ${short}との好感度 +${up}（${aff}/100）`];
  for (const t of [40, 70, 100]) if (before < t && aff >= t) lines.push(...affectionMilestone(id, short, t));
  return { lines };
};

function talkSalon(n) {
  for (const k in keys) keys[k] = false;
  // 目的⑬: 迷いネコを届ける
  if (quest && quest.stage === 12) { deliverCat(); return; }
  // 目的⑧: ネコの特徴を聞き出す
  if (quest && quest.stage === 7) {
    if (!Chat.aiReady()) { learnCatFeatures(); return; }
    Chat.setQuest({
      note: "the traveler asks about the lost cat — what it looks like, its features, or its favorite food (e.g. \"What does your cat look like?\", \"Can you describe the cat?\", \"What does it like to eat?\"). When they do, describe your cat: it has a black coat and blue eyes, it's a little old, and its favorite food is Tuna.",
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
      "・好きな食べ物は『Tuna（マグロ）』",
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
    if (hasItem("Tuna")) {
      useItem("Tuna");
      bag["迷いネコ"] = (bag["迷いネコ"] || 0) + 1;
      quest.stage = 12;
      playTownCutscene([{
        who: "コトハ",
        lines: [
          "Tuna（マグロ）のにおいにつられて、ネコが寄ってきた…！",
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
        "そうだ、ネコの好きな『Tuna（マグロ）』でおびき寄せてみよう！",
        "町に食料品店があるはず。中の魚屋でTunaを買おう！",
      ]
    : [
        "わっ、また逃げられちゃった！",
        "やっぱり好物の『Tuna（マグロ）』がないとダメみたい。",
        "食料品店の魚屋でTunaを買ってこよう！",
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
// 販売NPC: まず「会話する / 買い物する」を選ばせるメニュー
let npcMenu = null; // { npc, sel, buyLabel, onChat, onBuy }
function openNpcMenu(npc, buyLabel, onChat, onBuy) {
  for (const k in keys) keys[k] = false;
  npcMenu = { npc, sel: 0, buyLabel, onChat, onBuy };
  state = STATE.NPCMENU;
}
function npcMenuRows() {
  return [
    { kind: "chat", label: "💬 会話する（英語でおしゃべり）" },
    { kind: "buy", label: npcMenu.buyLabel },
    { kind: "cancel", label: "やめる" },
  ];
}
function npcMenuSelect(row) {
  if (!row) return;
  const m = npcMenu;
  if (row.kind === "cancel") { sfx("cancel"); npcMenu = null; state = STATE.TOWN; return; }
  sfx("select");
  npcMenu = null; state = STATE.TOWN;
  if (row.kind === "chat") m.onChat();
  else if (row.kind === "buy") m.onBuy();
}
function drawNpcMenu() {
  drawArea();
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'MS Gothic', monospace";
  ctx.fillText(npcMenu.npc.name, W / 2, 150);
  ctx.fillStyle = "#9fd6ff"; ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText("どうする？", W / 2, 176);
  const rows = npcMenuRows();
  for (let i = 0; i < rows.length; i++) {
    const y = 196 + i * 52;
    drawWindow(80, y, 320, 44, npcMenu.sel === i);
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "15px 'MS Gothic', monospace";
    ctx.fillText(rows[i].label, 104, y + 28);
  }
  ctx.textAlign = "center";
}
function talkShop(n) {
  for (const k in keys) keys[k] = false;
  const isMat = n.shop === "material";
  const buyLabel = isMat ? "🛒 素材を売る" : "🛒 買い物する";
  // AI会話が使えないなら従来どおり直接お店へ
  if (!Chat.aiReady()) { openShop(n.shop); return; }
  // まず「会話 / 買い物」を選択
  openNpcMenu(n, buyLabel, () => talkToNPC(n), () => openShop(n.shop));
  return;
}
// (旧)購入前にAIへ買い物意思を伝える会話。現在は未使用(メニューで直接お店へ)。
function talkShopBuyChat(n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { openShop(n.shop); return; }
  const isMat = n.shop === "material";
  const isFood = !!FOOD_SHOPS[n.shop];
  const isAppliance = n.shop === "appliance";
  let note, flagMessage;
  if (isMat) {
    note = "the traveler says they want to sell their materials or items (e.g. \"I want to sell some materials\", \"Can I sell these?\", \"I'd like to sell my stuff\"). When they do, happily agree to take a look at their goods.";
    flagMessage = "コトハ「売れるよ！ × でとじて売却画面へ」";
  } else if (isFood) {
    note = "the traveler says they want to buy food from your shop (e.g. \"I want to buy some tuna\", \"Can I buy fish?\", \"I'd like to buy food\"). When they do, happily agree to show them what you have for sale.";
    flagMessage = "コトハ「買えるよ！ × でとじて購入画面へ」";
  } else if (isAppliance) {
    note = "the traveler says they want to buy an appliance, or specifically a fridge/refrigerator or a TV/television (e.g. \"I want to buy a fridge\", \"Can I buy a TV?\", \"Show me your appliances\", \"I'd like to buy a refrigerator\"). When they do, happily agree to show your appliances.";
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

// 不動産屋: まず「会話 / 物件を見る」を選択(AI無しなら直接物件リスト)
function talkRealEstate(n) {
  for (const k in keys) keys[k] = false;
  if (!Chat.aiReady()) { openHomeShop(); return; }
  openNpcMenu(n, "🏠 物件を見る", () => talkToNPC(n), () => openHomeShop());
}
function openHomeShop() {
  shop = {
    type: "home", sel: 0, msgT: 280,
    msg: ownedHome ? "コトハ「もっといい家に住み替える?」" : "コトハ「どの家を買う? 自分の家ができるよ!」",
  };
  state = STATE.SHOP;
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
  // 目的①: 素材を3つ集めるまではどの建物にも入れない
  if (quest && quest.stage === 0 && d.to !== "town") {
    playTownCutscene([{ who: "コトハ", lines: ["まだ建物には入れないよ！", `まずはモンスターをたおして素材を${quest.goal}つ集めよう。（いま ${quest.kills}/${quest.goal}）`] }]);
    return;
  }
  if (d.to === "home") { enterHome(d.spawn); return; }
  enterArea(d.to, d.spawn);
}
// マイホーム: 未購入なら入れない。購入済みなら入ってHP全回復＋セーブ
function enterHome(spawn) {
  for (const k in keys) keys[k] = false;
  if (!ownedHome) {
    playTownCutscene([{ who: "コトハ", lines: ["ここは売りに出てる家だね。", "不動産屋さんで買えるみたい。自分の家、ほしいね!"] }]);
    return;
  }
  refreshHome();
  enterArea("home", spawn);
  player.hp = player.maxhp;
  const saved = canSave() && saveGame();
  playTownCutscene([{ who: "コトハ", lines: ["ただいま! 我が家はやっぱり落ち着くね。", `HPが全回復したよ!${saved ? " 冒険も記録(セーブ)しておいたね。" : ""}`] }]);
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
  // 目的①: 素材を3つ集めるまでは町に入れない(入口の手前で引き返す)
  if (quest && quest.stage === 0) {
    if (player.dir === "up") player.ty += 1;
    else if (player.dir === "down") player.ty -= 1;
    else if (player.dir === "left") player.tx += 1;
    else if (player.dir === "right") player.tx -= 1;
    player.px = player.tx * TILE; player.py = player.ty * TILE; player.moving = false;
    for (const k in keys) keys[k] = false;
    cutsceneDraw = drawField;
    playCutscene(
      [{ who: "コトハ", lines: ["まだ町に行くのは早いよ！", `まずはモンスターをたおして素材を${quest.goal}つ集めよう。（いま ${quest.kills}/${quest.goal}）`] }],
      () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.FIELD; }
    );
    return;
  }
  savedOverworld = { tx: player.tx, ty: player.ty };
  zone = "";
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
  zone = ""; // 洞窟/塔から出た場合も解除
  state = STATE.FIELD;
}

// ダンジョンに入る(フィールドの入口 X から)
function enterDungeon() {
  // 古代の遺跡はギルドランク2になり、碑文調査の依頼(⑱)を受けるまで入れない
  if (!(quest && quest.stage >= 17)) {
    if (player.dir === "up") player.ty += 1;
    else if (player.dir === "down") player.ty -= 1;
    else if (player.dir === "left") player.tx += 1;
    else if (player.dir === "right") player.tx -= 1;
    player.px = player.tx * TILE; player.py = player.ty * TILE; player.moving = false;
    for (const k in keys) keys[k] = false;
    cutsceneDraw = drawField;
    const line2 = (quest && quest.stage >= 16)
      ? "ギルドで碑文調査の依頼を受けてから来よう。"
      : "今はまだ入れないみたい…ギルドで一人前(ランク2)になれば、手がかりがつかめそう。";
    playCutscene(
      [{ who: "コトハ", lines: ["古代の遺跡だ…！ でも入口が固く封印されてる。", line2] }],
      () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.FIELD; }
    );
    return;
  }
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.dungeon;
  zone = "dungeon";
  player.tx = DUNGEON_START.tx; player.ty = DUNGEON_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  for (const k in keys) keys[k] = false;
  state = STATE.TOWN;
  resetEncounter();
  const lines = ["うわっ、洞窟だ…！ ここは『古代の遺跡』。外とは違うモンスターが出るみたい。", "知らない英単語も多いから、気を引きしめていこう！", "でぐち(下の扉)からいつでも外に戻れるよ。"];
  if (quest && quest.stage === 17 && !quest.ancientDefeated) {
    lines.push("依頼の碑文は、いちばん奥(上のほう)にあるみたい。目指して進もう！");
  }
  playTownCutscene([{ who: "コトハ", lines }]);
}

// 氷の洞窟(ダンジョン2)に入る(フィールドの入口 Z から)
function enterDungeon2() {
  // 氷の遺跡はギルドランク3になり、碑文調査の依頼(㉑)を受けるまで入れない
  if (!(quest && quest.stage >= 20)) {
    if (player.dir === "up") player.ty += 1;
    else if (player.dir === "down") player.ty -= 1;
    else if (player.dir === "left") player.tx += 1;
    else if (player.dir === "right") player.tx -= 1;
    player.px = player.tx * TILE; player.py = player.ty * TILE; player.moving = false;
    for (const k in keys) keys[k] = false;
    cutsceneDraw = drawField;
    const line2 = (quest && quest.stage >= 19)
      ? "ギルドで氷の遺跡の碑文調査の依頼を受けてから来よう。"
      : "今はまだ入れないみたい…ギルドランク3になれば、手がかりがつかめそう。";
    playCutscene(
      [{ who: "コトハ", lines: ["氷の遺跡だ…！ でも入口が固く凍りついて閉ざされてる。", line2] }],
      () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.FIELD; }
    );
    return;
  }
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.dungeon2;
  zone = "dungeon2";
  player.tx = DUNGEON2_START.tx; player.ty = DUNGEON2_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  for (const k in keys) keys[k] = false;
  state = STATE.TOWN;
  resetEncounter();
  const lines2 = ["ひんやり…ここは氷の遺跡だ！ 凍えるモンスターが出るよ。", "ここにも見たことのない英単語がたくさん。覚えていこう！", "でぐち(下の扉)からいつでも外に戻れるよ。"];
  if (quest && quest.stage === 20 && !quest.iceQueenDefeated) {
    lines2.push("依頼の碑文は、いちばん奥(上のほう)にあるみたい。目指して進もう！");
  }
  playTownCutscene([{ who: "コトハ", lines: lines2 }]);
}

// 炎の遺跡に入る(フィールドの入口 F から。専用単語が出る)
function enterFire() {
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.fire;
  zone = "fire";
  player.tx = FIRE_START.tx; player.ty = FIRE_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  for (const k in keys) keys[k] = false;
  state = STATE.TOWN;
  resetEncounter();
  playTownCutscene([{
    who: "コトハ",
    lines: ["あつっ…！ ここは炎の遺跡だ。 燃えるようなモンスターが出るよ。", "見たことのない英単語もたくさん。 覚えていこう！", "でぐち(下の扉)からいつでも外に戻れるよ。"],
  }]);
}

// タワーに入る(フィールドの入口 Y から。熟語が出る)
function enterTower() {
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.tower;
  zone = "tower";
  player.tx = TOWER_START.tx; player.ty = TOWER_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  for (const k in keys) keys[k] = false;
  state = STATE.TOWN;
  resetEncounter();
  playTownCutscene([{
    who: "コトハ",
    lines: ["高い塔だ…！ ここに出るのは魔法のモンスターたち。", "ここでは単語じゃなくて『熟語(イディオム)』が試されるみたい。", "でぐち(下の扉)からいつでも外に戻れるよ。"],
  }]);
}

// 魔王城に入る(フィールドの C から。英文法問題が出る)
function enterCastle() {
  savedOverworld = { tx: player.tx, ty: player.ty };
  curArea = AREAS.castle;
  zone = "castle";
  player.tx = CASTLE_START.tx; player.ty = CASTLE_START.ty;
  player.px = player.tx * TILE; player.py = player.ty * TILE;
  player.dir = "up"; player.moving = false;
  for (const k in keys) keys[k] = false;
  state = STATE.TOWN;
  resetEncounter();
  playTownCutscene([{
    who: "コトハ",
    lines: ["ここが魔王城…！ 中の敵は『英文法』で試してくるよ。", "正しい英文を選んで進もう。奥の玉座に魔王がいるはず。", "でぐち(下の扉)からいつでも外に戻れるよ。"],
  }]);
}

function onArrive() {
  player.tx = player.targetX; player.ty = player.targetY;
  if (state === STATE.TOWN) {
    const d = doorAt(player.tx, player.ty);
    if (d) { goThroughDoor(d); return; }
    // 古代の遺跡: 碑文の前でエンシェントドラゴンが待つ(⑱調査中・未討伐のとき)
    if (curArea.dungeon && quest && quest.stage >= 17 && !quest.ancientDefeated &&
        player.tx === ANCIENT_TILE.tx && player.ty === ANCIENT_TILE.ty) { startAncientBattle(); return; }
    // 氷の遺跡: 碑文の前で氷の女王の亡霊が待つ(㉑調査中・未討伐のとき)
    if (curArea.dungeon2 && quest && quest.stage >= 20 && !quest.iceQueenDefeated &&
        player.tx === ICE_TILE.tx && player.ty === ICE_TILE.ty) { startIceQueenBattle(); return; }
    // ダンジョン/タワー/城内は歩くとエンカウント
    if (curArea.encounter) {
      if (curArea.castle && tileAtArea(player.tx, player.ty) === "B") { startBattle(true); return; } // 玉座=魔王戦
      stepsToEncounter--;
      if (stepsToEncounter <= 0) { resetEncounter(); startBattle(false); }
    }
    return;
  }
  const t = tileAt(player.tx, player.ty);
  if (t === "O") { // 町に入る(イベント判定は enterTown 内)
    enterTown();
    return;
  }
  if (t === "X") { // ダンジョンに入る
    enterDungeon();
    return;
  }
  if (t === "Y") { // タワーに入る
    enterTower();
    return;
  }
  if (t === "Z") { // 氷の洞窟(ダンジョン2)に入る
    enterDungeon2();
    return;
  }
  if (t === "F") { // 炎の遺跡に入る
    enterFire();
    return;
  }
  if (t === "C") { // 魔王城に入る
    if (player.level < 3) {
      showMessage(["城の門は かたく とざされている。", "(レベル3以上で 入れる)"], () => { state = STATE.FIELD; });
    } else {
      enterCastle();
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
// 正解回数に応じた出題ウェイト(再出する確率)。
// 0回=100% / 1回=60% / 2回=30% / 3回以上=0%(以降もう出ない)
function wordWeight(en) {
  const c = wordCorrect[en] || 0;
  return c >= 3 ? 0 : c === 2 ? 0.3 : c === 1 ? 0.6 : 1;
}
// 出題ウェイトで1件選ぶ(en/qごとの正解回数で再出確率を下げる)。getKeyで重み付けキーを取る
function pickWeighted(pool, getKey) {
  let total = 0;
  for (const c of pool) total += wordWeight(getKey(c));
  if (total <= 0) return pool[Math.floor(rnd() * pool.length)];
  let r = rnd() * total, picked = null;
  for (const c of pool) { r -= wordWeight(getKey(c)); if (r < 0) { picked = c; break; } }
  return picked || pool[pool.length - 1];
}
function pickWord() {
  if (zone === "castle" && typeof GRAMMAR_DATA !== "undefined") return pickGrammar();
  // ダンジョン/タワーは専用の単語、それ以外は通常の単語
  let src = WORD_DATA;
  if (zone === "dungeon" && typeof DUNGEON_WORD_DATA !== "undefined") src = DUNGEON_WORD_DATA;
  else if (zone === "dungeon2" && typeof DUNGEON2_WORD_DATA !== "undefined") src = DUNGEON2_WORD_DATA;
  else if (zone === "fire" && typeof FIRE_WORD_DATA !== "undefined") src = FIRE_WORD_DATA;
  else if (zone === "tower" && typeof TOWER_WORD_DATA !== "undefined") src = TOWER_WORD_DATA;
  const w = pickWeighted(src[toeicLevel], (c) => c.en);
  const choices = shuffle([w.ja, ...w.wrong]);
  return { en: w.en, ja: w.ja, choices, answer: choices.indexOf(w.ja) };
}
// 城: 英文法問題を出題(選択肢は英文。正解位置はシャッフル)
function pickGrammar() {
  const g = pickWeighted(GRAMMAR_DATA[toeicLevel], (c) => c.q);
  const correct = g.choices[g.answer];
  const choices = shuffle(g.choices);
  return {
    grammar: true, en: g.q, q: g.q,
    full: g.q.replace("___", correct),
    choices, answer: choices.indexOf(correct),
    trans: g.ja, note: g.note,
  };
}

function startBattle(isBoss) {
  // 勝利数が増えるほど強い敵も出るように、出現範囲を広げる(ダンジョンは専用の敵)
  const list = zone === "tower" ? TOWER_ENEMIES : zone === "dungeon" ? DUNGEON_ENEMIES : zone === "dungeon2" ? DUNGEON2_ENEMIES : zone === "fire" ? FIRE_ENEMIES : zone === "castle" ? CASTLE_ENEMIES : ENEMIES;
  const range = Math.min(list.length, 2 + Math.floor(player.wins / 2));
  const src = isBoss ? BOSS : list[Math.floor(rnd() * range)];
  battle = {
    isBoss,
    name: src.name, color: src.color,
    ehp: src.hp, emaxhp: src.hp, eatk: src.atk, exp: src.exp,
    drop: isBoss ? null : src.drop,
    phase: "intro", word: null, log: "",
    shake: 0, ehurt: 0, phurt: 0,
  };
  menuSel = 0;
  sfx("encounter");
  // 料理で得た「次の戦闘」バフをこの戦闘に適用(1戦闘かぎり)
  battleBuff = { atk: mealBuff.atk, def: mealBuff.def };
  const buffLine = (mealBuff.atk || mealBuff.def)
    ? [`料理の効果！ ${mealBuff.atk ? `こうげき+${mealBuff.atk} ` : ""}${mealBuff.def ? `ぼうぎょ+${mealBuff.def}` : ""}`] : [];
  mealBuff = { atk: 0, def: 0 };
  showMessage([`${battle.name} が あらわれた！`, ...buffLine], () => { nextQuestion(); });
}

function nextQuestion() {
  battle.word = pickWord();
  battle.phase = "select";
  menuSel = 0;
  state = STATE.BATTLE;
  // 出題を読み上げ(自動ON時)。文法は出題時には読まない(解答後に読む)
  if (window.Voice && !battle.word.grammar) Voice.autoSpeak(battle.word.en, "en");
}

function chooseAnswer(idx) {
  if (battle.phase !== "select") return;
  battle.phase = "resolve";
  const w = battle.word;
  const correct = idx === w.answer;
  // 正解/不正解の説明行(文法は 完成文＋和訳＋解説、単語は意味)
  let okLines, ngLines;
  if (w.grammar) {
    okLines = [`せいかい！ ${w.full}`, `和訳: ${w.trans}`, `解説: ${w.note}`];
    ngLines = [`ざんねん… 正解は「${w.choices[w.answer]}」`, `${w.full}`, `和訳: ${w.trans}`, `解説: ${w.note}`];
    if (window.Voice) Voice.autoSpeak(w.full, "en"); // 解答後に完成文を読み上げ
  } else {
    okLines = [`せいかい！ "${w.en}" = ${w.ja}`];
    ngLines = [`ざんねん… "${w.en}" は ${w.ja}`];
  }
  if (correct) {
    wordCorrect[w.en] = (wordCorrect[w.en] || 0) + 1; // 正解→次回以降の出題確率を下げる
    const dmg = player.atk + battleBuff.atk + Math.floor(rnd() * 4);
    battle.ehp = Math.max(0, battle.ehp - dmg);
    battle.ehurt = 12; battle.shake = 8;
    sfx("correct"); sfx("hit");
    state = STATE.BATTLE;
    queueResolve([...okLines, `${battle.name}に ${dmg} のダメージ！`], () => {
      if (battle.ehp <= 0) return winBattle();
      enemyTurnOrNext();
    });
  } else {
    const dmg = Math.max(1, battle.eatk + Math.floor(rnd() * 3) - (player.def + battleBuff.def));
    player.hp = Math.max(0, player.hp - dmg);
    battle.phurt = 12;
    sfx("wrong"); sfx("hurt");
    state = STATE.BATTLE;
    queueResolve([...ngLines, `${battle.name}の こうげき！ ${dmg} のダメージ！`], () => {
      if (player.hp <= 0) return loseBattle();
      nextQuestion();
    });
  }
}

// 正解後、ときどき敵の反撃を挟む
function enemyTurnOrNext() {
  if (battle.isBoss && rnd() < 0.5) {
    const dmg = Math.max(1, battle.eatk + Math.floor(rnd() * 3) - (player.def + battleBuff.def));
    player.hp = Math.max(0, player.hp - dmg);
    battle.phurt = 12; sfx("hurt");
    queueResolve([`${battle.name}の はんげき！ ${dmg} のダメージ！`], () => {
      if (player.hp <= 0) return loseBattle();
      nextQuestion();
    });
  } else {
    nextQuestion();
  }
}

// 経験値を加算してレベルアップ判定(上がったぶんのメッセージ配列を返す)
function gainExp(amount) {
  player.exp += amount;
  const leveled = [];
  while (player.exp >= player.nextExp) {
    player.exp -= player.nextExp;
    player.level++;
    player.baseMaxhp += 6; player.baseAtk += 2; // 素の値を上げる
    recomputeStats(); player.hp = player.maxhp; // レベルアップで全回復
    player.nextExp = Math.floor(player.nextExp * 1.6);
    leveled.push(`レベル ${player.level} に あがった！ (HP/攻撃 アップ)`);
  }
  return leveled;
}
// コトハの経験値/レベル(勉強机の英訳ドリルでだけ上がる。上がると戦闘の魔法が強くなる)
let kotoha = { level: 1, exp: 0, nextExp: 12 };
function gainKotohaExp(amount) {
  kotoha.exp += amount;
  const leveled = [];
  while (kotoha.exp >= kotoha.nextExp) {
    kotoha.exp -= kotoha.nextExp;
    kotoha.level++;
    kotoha.nextExp = Math.floor(kotoha.nextExp * 1.6);
    leveled.push(`🎉 コトハが レベル ${kotoha.level} に あがった！（魔法が強くなった）`);
  }
  return leveled;
}
// コトハとの英訳学習で正解したときの報酬(難易度に応じた経験値)。※コトハの経験値になる。chat.js から呼ぶ。
const STUDY_EXP = { 500: 3, 700: 5, 900: 8 };
window.studyCorrectReward = () => {
  const exp = STUDY_EXP[toeicLevel] || 3;
  const leveled = gainKotohaExp(exp);
  if (canSave()) saveGame(); // 学習の成果を保存
  return { exp, leveled, kotohaLevel: kotoha.level };
};

function winBattle() {
  player.wins++;
  const lines = [`${battle.name}を たおした！`];
  if (!battle.isBoss) lines.push(`けいけんち ${battle.exp} を かくとく！`);
  // 素材ドロップ
  if (!battle.isBoss && battle.drop) {
    addMaterial(battle.drop);
    lines.push(`「${battle.drop}」を 手に入れた！`);
  }
  // クエスト①(素材あつめ)進行: 素材を1つ手に入れるごとにカウント
  if (!battle.isBoss && battle.drop && quest && quest.stage === 0) {
    quest.kills++;
    if (quest.kills >= quest.goal) {
      quest.stage = 1;
      lines.push(`コトハ「素材が${quest.goal}つ集まったね！`);
      lines.push(`　町(赤い屋根)へ向かって換金しよう！」`);
    } else {
      lines.push(`コトハ「素材あつめ ${quest.kills}/${quest.goal}」`);
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
  // 経験値とレベルアップ(ボスは経験値のみ加算してレベルは据え置き)
  let leveled = [];
  if (battle.isBoss) player.exp += battle.exp;
  else leveled = gainExp(battle.exp);
  sfx("win"); if (leveled.length) setTimeout(() => sfx("levelup"), 550);
  const wasBoss = battle.isBoss;
  showMessage([...lines, ...leveled], () => {
    battle = null;
    if (wasBoss) { state = STATE.CLEAR; }
    else if (autoEncounter) { startBattle(false); } // オート: 即・次の戦闘(フィールドでも洞窟/塔でも)
    else if (zone) { state = STATE.TOWN; } // 手動: 洞窟/塔に戻る
    else { state = STATE.FIELD; }
  });
}

function loseBattle() {
  sfx("lose");
  showMessage([`${battle.name}に やられてしまった…`], () => { battle = null; state = STATE.GAMEOVER; });
}

// ===== エリアボス(コマンド式ボスバトル。コトハが魔法使いとして参戦) =====
const AREA_BOSSES = {
  ogre:    { name: "オーガ将軍",       color: "#7a4a2a", hp: 120, atk: 15, exp: 40 },
  golem:   { name: "ストーンゴーレム", color: "#7a7a86", hp: 165, atk: 13, exp: 46 },
  wyvern:  { name: "ワイバーン",       color: "#3a7a4a", hp: 140, atk: 18, exp: 52 },
  ancient: { name: "エンシェントドラゴン", color: "#b03a2a", hp: 260, atk: 22, exp: 120 }, // 古代の遺跡の碑文を守るボス(ストーリー)
  icequeen: { name: "氷の女王の亡霊", color: "#8ac8e8", hp: 340, atk: 26, exp: 170 }, // 氷の遺跡の碑文を守るボス(ストーリー)
};
// 古代の遺跡(最初のダンジョン)の碑文の位置。ここにエンシェントドラゴンが待つ。
const ANCIENT_TILE = { tx: 7, ty: 1 };
// 氷の遺跡(ダンジョン2)の碑文の位置。ここに氷の女王の亡霊が待つ。
const ICE_TILE = { tx: 4, ty: 1 };
// 受注時: フィールドにボスを出現させる(草地の固定マス)
function spawnFieldBoss(q) { fieldBoss = { tx: 7, ty: 11, boss: q.boss, questId: q.id }; }
// 討伐済みをギルド受付に報告→達成
function reportAreaBoss(q) {
  for (const k in keys) keys[k] = false;
  const lines = grantSideReward(q);
  playTownCutscene([{ who: "コトハ", lines: ["ボス討伐の報告だね！", ...lines, "また依頼ボードを見てみよう！"] }]);
}
// ボス戦中の演出メッセージ(背景にボス戦シーンを出したまま送る)
function bossSay(lines, after) { showMessage(lines, after); }
function bossMenu() { bossBattle.phase = "menu"; bossBattle.sel = 0; state = STATE.BOSSBATTLE; }
// エリアボス戦(依頼)を開始
function startBossBattle() { beginBossBattle(fieldBoss.boss, { questId: fieldBoss.questId, returnState: STATE.FIELD }); }
// ボス戦の共通開始処理。opts: { questId, onWin(leveled), returnState }
function beginBossBattle(bossKey, opts) {
  opts = opts || {};
  const b = AREA_BOSSES[bossKey] || AREA_BOSSES.ogre;
  for (const k in keys) keys[k] = false;
  battleBuff = { atk: mealBuff.atk, def: mealBuff.def }; // 料理バフを適用
  const bl = (mealBuff.atk || mealBuff.def) ? [`料理の効果！ ${mealBuff.atk ? `こうげき+${mealBuff.atk} ` : ""}${mealBuff.def ? `ぼうぎょ+${mealBuff.def}` : ""}`] : [];
  mealBuff = { atk: 0, def: 0 };
  bossBattle = {
    name: b.name, color: b.color, ehp: b.hp, emaxhp: b.hp, eatk: b.atk, exp: b.exp,
    questId: opts.questId || null, onWin: opts.onWin || null, returnState: opts.returnState || STATE.FIELD,
    sel: 0, itemSel: 0, summonSel: 0, phase: "resolve", guard: false,
    sp: 0, spMax: 3, // 必殺技ゲージ(気合)
    beast: null, // 召喚中の召喚獣 {name,atk,turnsLeft,element}
    // コトハの戦闘ステータスはコトハのレベルで強化(勉強机でレベルUP)
    khp: 30 + (kotoha.level - 1) * 6, kmaxhp: 30 + (kotoha.level - 1) * 6, kmp: 14 + (kotoha.level - 1) * 3,
    klevel: kotoha.level, shake: 0, ehurt: 0, phurt: 0, khurt: 0,
  };
  cutsceneDraw = drawBossScene;
  sfx("encounter");
  bossSay([`${b.name} が あらわれた！`, "コトハ「私も魔法で戦うよ、相棒！」", ...bl], () => bossMenu());
}
// 古代の遺跡の碑文を守るエンシェントドラゴン戦(ストーリー)
function startAncientBattle() {
  beginBossBattle("ancient", { returnState: STATE.TOWN, onWin: onAncientDefeated });
}
// エンシェントドラゴン撃破 → 碑文を読む
function onAncientDefeated(leveled) {
  if (quest) { quest.ancientDefeated = true; if (quest.stage === 17) quest.stage = 18; }
  if (canSave()) saveGame();
  cutsceneDraw = drawArea; // 古代の遺跡(ダンジョン)を背景に
  playCutscene([
    { who: "コトハ", lines: ["エンシェントドラゴンを倒した！", ...(leveled || []), "…これで奥の碑文が読めるよ。"] },
    { who: null, lines: ["── 古代の碑文 ──", "『魔王城の最奥に、異世界へと通ずるゲートあり。』", "『されど、その道は固く閉ざされたり。』"] },
    { who: "コトハ", lines: ["異世界へのゲート…！ 帰るための手がかりだ！", "でも魔王城への道は閉ざされてる…今は行けないみたい。"] },
    { who: "コトハ", lines: ["とりあえず、ギルドランクを3まで上げてみよう。", "それと『氷の遺跡』にも手がかりがないか、探しに行こう！"] },
  ], () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.TOWN; });
}
// 氷の遺跡の碑文を守る氷の女王の亡霊戦(ストーリー)
function startIceQueenBattle() {
  beginBossBattle("icequeen", { returnState: STATE.TOWN, onWin: onIceQueenDefeated });
}
// 氷の女王の亡霊 撃破 → 碑文を読む → 氷のオーブ獲得
function onIceQueenDefeated(leveled) {
  if (quest) {
    quest.iceQueenDefeated = true;
    quest.iceOrb = true;            // 重要アイテム: 氷のオーブ 獲得フラグ
    if (quest.stage === 20) quest.stage = 21;
  }
  bag["氷のオーブ"] = 1;              // もちものにも表示(重要アイテム)
  if (canSave()) saveGame();
  cutsceneDraw = drawArea; // 氷の遺跡を背景に
  playCutscene([
    { who: "コトハ", lines: ["氷の女王の亡霊を倒した！", ...(leveled || []), "…これで奥の碑文が読めるよ。"] },
    { who: null, lines: ["── 氷の碑文 ──", "『天空の塔に、氷のオーブと炎のオーブを捧げよ。』", "『さすれば魔王城への道、開かれん。』"] },
    { who: null, lines: ["碑文が光り、足もとに『氷のオーブ』が現れた！", "＞ 氷のオーブ を手に入れた！（重要アイテム）"] },
    { who: "コトハ", lines: ["氷のオーブをゲット！ あとは炎のオーブだね。", "天空の塔＝あのタワーのことかな。"] },
    { who: "コトハ", lines: ["まずはギルドランクを4に上げてから、", "炎のオーブを探しに『炎の遺跡』へ行こう！"] },
  ], () => { cutsceneDraw = null; messageSpeaker = null; state = STATE.TOWN; });
}
function bossCommand(cmd) {
  if (!bossBattle || bossBattle.phase !== "menu") return;
  const bb = bossBattle;
  // 道具: 料理を選ぶサブメニューへ(ターンは消費しない)
  if (cmd === "item") {
    if (!dishes.length) { bb.phase = "resolve"; bossSay(["道具(料理)を持っていない！"], () => bossMenu()); return; }
    bb.phase = "item"; bb.itemSel = 0; return;
  }
  // しょうかん: 召喚獣カードを選ぶサブメニューへ(ターンは消費しない)
  if (cmd === "summon") {
    if (!summonCards.length) { bb.phase = "resolve"; bossSay(["召喚獣カードを持っていない！（邸宅の召喚魔法陣で手に入れよう）"], () => bossMenu()); return; }
    bb.phase = "summon"; bb.summonSel = 0; return;
  }
  // 必殺技: 気合が満タンのときだけ
  if (cmd === "special" && bb.sp < bb.spMax) {
    bb.phase = "resolve"; bossSay(["まだ必殺技は使えない！（気合をためよう）"], () => bossMenu()); return;
  }
  bb.phase = "resolve"; bb.guard = false;
  if (cmd === "flee") {
    if (rnd() < 0.5) { cutsceneDraw = null; bossBattle = null; battleBuff = { atk: 0, def: 0 }; showMessage([`${player.name}は うまく にげだした！`], () => { state = STATE.FIELD; }); return; }
    bossSay([`${player.name}は にげようとした… でも回りこまれた！`], () => bossBeastPhase());
    return;
  }
  if (cmd === "guard") { bb.sp = Math.min(bb.spMax, bb.sp + 1); bb.guard = true; sfx("guard"); bossSay([`${player.name}は 身をまもっている。`], () => bossBeastPhase()); return; }
  if (cmd === "special") {
    bb.sp = 0;
    const dmg = Math.floor((player.atk + battleBuff.atk) * 2.2) + 6 + Math.floor(rnd() * 6);
    bb.ehp = Math.max(0, bb.ehp - dmg); bb.ehurt = 12; bb.shake = 12; sfx("special");
    bossSay([`${player.name}の必殺技！ こんしんの一撃！`, `${bb.name}に ${dmg} の大ダメージ！`], () => { if (bb.ehp <= 0) return bossWin(); bossBeastPhase(); });
    return;
  }
  // たたかう
  bb.sp = Math.min(bb.spMax, bb.sp + 1);
  const dmg = player.atk + battleBuff.atk + Math.floor(rnd() * 4);
  bb.ehp = Math.max(0, bb.ehp - dmg); bb.ehurt = 12; bb.shake = 8; sfx("hit");
  bossSay([`${player.name}の こうげき！ ${bb.name}に ${dmg} のダメージ！`], () => { if (bb.ehp <= 0) return bossWin(); bossBeastPhase(); });
}
// 召喚獣カードを戦闘中に使う: 召喚獣が味方として登場(数ターン自動攻撃)
function useSummonInBattle(i) {
  const bb = bossBattle; if (!bb) return;
  const c = summonCards[i];
  if (!c) { bossMenu(); return; }
  bb.phase = "resolve";
  bb.beast = { name: c.name, atk: c.atk, turnsLeft: c.turns, element: c.element };
  summonCards.splice(i, 1);
  if (canSave()) saveGame();
  sfx("summon");
  bossSay([`召喚！ 【${ELEMENT_JA[c.element] || "無"}】${c.name}が あらわれた！（${c.turns}ターン味方）`], () => bossBeastPhase());
}
// 召喚獣のターン: 生きていれば自動でボスを攻撃し、残りターンを減らす
function bossBeastPhase() {
  const bb = bossBattle; if (!bb) return;
  const be = bb.beast;
  if (!be || be.turnsLeft <= 0) { return bossKotohaPhase(); }
  const dmg = be.atk + Math.floor(rnd() * 4);
  bb.ehp = Math.max(0, bb.ehp - dmg); bb.ehurt = 12; bb.shake = 6; sfx("hit");
  be.turnsLeft--;
  const gone = be.turnsLeft <= 0 ? [`${be.name}は 力を使い果たして 去っていった…`] : [];
  bossSay([`召喚獣 ${be.name}の こうげき！ ${bb.name}に ${dmg} のダメージ！`, ...gone], () => {
    if (be.turnsLeft <= 0) bb.beast = null;
    if (bb.ehp <= 0) return bossWin();
    bossKotohaPhase();
  });
}
// 道具(料理)を戦闘中に使う: HP回復＋この戦闘のバフを即適用
function useDishInBattle(i) {
  const bb = bossBattle; if (!bb) return;
  const d = dishes[i];
  if (!d) { bossMenu(); return; }
  bb.phase = "resolve";
  const before = player.hp;
  player.hp = Math.min(player.maxhp, player.hp + d.heal);
  const healed = player.hp - before;
  battleBuff.atk += d.atk; battleBuff.def += d.def;
  dishes.splice(i, 1);
  bb.sp = Math.min(bb.spMax, bb.sp + 1); sfx("heal");
  const buffLine = (d.atk || d.def) ? ` ${d.atk ? `こうげき+${d.atk} ` : ""}${d.def ? `ぼうぎょ+${d.def}` : ""}！` : "";
  bossSay([`${player.name}は ${d.name}を 食べた！ HP+${healed}${buffLine}`], () => bossBeastPhase());
}
function bossKotohaPhase() {
  const bb = bossBattle; if (!bb) return;
  if (bb.khp <= 0) { return bossEnemyPhase(); } // コトハ気絶中
  const lowPlayer = player.hp <= player.maxhp * 0.4;
  const lowKotoha = bb.khp <= bb.kmaxhp * 0.45;
  if ((lowPlayer || lowKotoha) && bb.kmp >= 4) {
    bb.kmp -= 4; const heal = 18 + (bb.klevel - 1) * 3 + Math.floor(rnd() * 8); sfx("heal");
    if (lowPlayer && player.hp <= bb.khp) { player.hp = Math.min(player.maxhp, player.hp + heal); bossSay([`コトハは ヒールを となえた！ ${player.name}の HPが ${heal} 回復！`], () => bossEnemyPhase()); }
    else { bb.khp = Math.min(bb.kmaxhp, bb.khp + heal); bossSay([`コトハは ヒールを となえた！ コトハの HPが ${heal} 回復！`], () => bossEnemyPhase()); }
    return;
  }
  if (bb.kmp >= 3) {
    bb.kmp -= 3; const dmg = 12 + (bb.klevel - 1) * 3 + Math.floor(rnd() * 8);
    bb.ehp = Math.max(0, bb.ehp - dmg); bb.ehurt = 12; bb.shake = 6; sfx("magic");
    bossSay([`コトハは フレイムを となえた！ ${bb.name}に ${dmg} のダメージ！`], () => { if (bb.ehp <= 0) return bossWin(); bossEnemyPhase(); });
    return;
  }
  const dmg = 4 + Math.floor(rnd() * 4); // MP切れ→杖でなぐる
  bb.ehp = Math.max(0, bb.ehp - dmg); bb.ehurt = 12;
  bossSay([`コトハは つえで たたいた！ ${bb.name}に ${dmg} のダメージ！`], () => { if (bb.ehp <= 0) return bossWin(); bossEnemyPhase(); });
}
function bossEnemyPhase() {
  const bb = bossBattle; if (!bb) return;
  const targetKotoha = bb.khp > 0 && rnd() < 0.4;
  let dmg = bb.eatk + Math.floor(rnd() * 5);
  sfx("hurt");
  if (targetKotoha) {
    dmg = Math.max(1, dmg - 2); bb.khp = Math.max(0, bb.khp - dmg); bb.khurt = 12;
    const ko = bb.khp <= 0 ? ["コトハは たおれてしまった…！"] : [];
    bossSay([`${bb.name}の こうげき！ コトハに ${dmg} のダメージ！`, ...ko], () => bossMenu());
  } else {
    dmg = Math.max(1, dmg - (player.def + battleBuff.def) - (bb.guard ? 6 : 0));
    player.hp = Math.max(0, player.hp - dmg); bb.phurt = 12;
    bossSay([`${bb.name}の こうげき！ ${player.name}に ${dmg} のダメージ！`], () => { if (player.hp <= 0) return bossLose(); bossMenu(); });
  }
}
function bossWin() {
  const bb = bossBattle; cutsceneDraw = null;
  const bname = bb.name, bexp = bb.exp, onWin = bb.onWin, rs = bb.returnState || STATE.FIELD;
  const leveled = gainExp(bexp);
  if (bb.questId) { const q = sideQuests.find((s) => s.id === bb.questId); if (q) q.progress = 1; } // 討伐済み(報告待ち)
  fieldBoss = null; bossBattle = null; battleBuff = { atk: 0, def: 0 };
  if (canSave()) saveGame();
  sfx("win"); if (leveled.length) setTimeout(() => sfx("levelup"), 550);
  if (onWin) { onWin(leveled); return; } // ストーリーボス(碑文など)は専用処理へ
  showMessage([`${bname}を 討伐した！`, `けいけんち ${bexp} を かくとく！`, ...leveled, "コトハ「やったね相棒！ ギルドに報告しよう。」"], () => { state = rs; });
}
function bossLose() {
  const bb = bossBattle; cutsceneDraw = null; bossBattle = null; battleBuff = { atk: 0, def: 0 };
  sfx("lose");
  showMessage([`${bb.name}に やられてしまった…`], () => { state = STATE.GAMEOVER; });
}
function drawBossScene() {
  ctx.fillStyle = "#0b2e13"; ctx.fillRect(0, 0, W, H / 2 + 20);
  ctx.fillStyle = "#06121f"; ctx.fillRect(0, H / 2 + 20, W, H / 2);
  const bb = bossBattle; if (!bb) return;
  const sx = (bb.shake > 0) ? (Math.floor(rnd() * 7) - 3) : 0;
  const flashE = bb.ehurt > 0 && Math.floor(bb.ehurt) % 2 === 0;
  drawEnemy(W / 2 + sx, 140, bb.color, true, flashE);
  drawWindow(120, 34, 240, 46, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "14px 'MS Gothic', monospace";
  ctx.fillText(bb.name, 134, 54); drawBar(134, 60, 212, 9, bb.ehp / bb.emaxhp, "#e74c3c");
  // 味方ステータス
  drawWindow(16, 236, 448, 56, false);
  ctx.fillStyle = "#fff"; ctx.font = "13px 'MS Gothic', monospace"; ctx.textAlign = "left";
  ctx.fillText(player.name, 30, 256); drawBar(30, 262, 150, 8, player.hp / player.maxhp, "#3fa05a");
  ctx.fillText(`HP ${player.hp}/${player.maxhp}`, 188, 259);
  ctx.fillStyle = "#ffd24a"; ctx.fillText(`気合 ${"★".repeat(bb.sp)}${"・".repeat(bb.spMax - bb.sp)}`, 320, 259);
  ctx.fillStyle = "#cfe0ff"; ctx.fillText(`コトハ Lv${bb.klevel}`, 30, 282);
  if (bb.khp > 0) { drawBar(30, 287, 150, 8, bb.khp / bb.kmaxhp, "#7be0d2"); ctx.fillStyle = "#fff"; ctx.fillText(`HP ${bb.khp}/${bb.kmaxhp} MP ${bb.kmp}`, 188, 284); }
  else { ctx.fillStyle = "#8aa"; ctx.fillText("たおれている…", 188, 284); }
  if (bb.beast) { ctx.fillStyle = "#d8b0ff"; ctx.fillText(`召喚 ${bb.beast.name}(残${bb.beast.turnsLeft})`, 300, 284); }
  ctx.textAlign = "center";
  if (bb.phurt > 0 && Math.floor(bb.phurt) % 2 === 0) { ctx.fillStyle = "rgba(200,0,0,0.22)"; ctx.fillRect(0, 0, W, H); }
}
const BOSS_CMDS = ["たたかう", "必殺技", "しょうかん", "道具", "ぼうぎょ", "にげる"]; // 6コマンド(2列×3)
function drawBossBattle() {
  drawBossScene();
  const bb = bossBattle;
  if (bb.phase === "item") { drawBossListMenu("item"); return; }
  if (bb.phase === "summon") { drawBossListMenu("summon"); return; }
  for (let i = 0; i < BOSS_CMDS.length; i++) {
    const bx = 16 + (i % 2) * 232, by = 306 + ((i / 2) | 0) * 44;
    drawWindow(bx, by, 216, 38, bb.sel === i);
    // 必殺技=気合満タン必要 / しょうかん=カード必要 / 道具=料理必要 のとき灰色
    const dim = (i === 1 && bb.sp < bb.spMax) || (i === 2 && !summonCards.length) || (i === 3 && !dishes.length);
    ctx.fillStyle = dim ? "#7a8aa8" : "#fff"; ctx.textAlign = "left"; ctx.font = "16px 'MS Gothic', monospace";
    ctx.fillText(BOSS_CMDS[i], bx + 20, by + 25);
  }
  ctx.textAlign = "center";
}
// 道具/しょうかん のサブメニュー(共通)
function drawBossListMenu(kind) {
  const bb = bossBattle;
  const isItem = kind === "item";
  const list = isItem ? dishes : summonCards;
  const sel = isItem ? bb.itemSel : bb.summonSel;
  const m = Math.min(list.length, 6);
  drawWindow(16, 298, 448, 24 + (m + 1) * 24, false);
  ctx.textAlign = "left"; ctx.font = "13px 'MS Gothic', monospace";
  for (let i = 0; i < m; i++) {
    const ry = 304 + i * 24; const it = list[i];
    if (sel === i) { ctx.fillStyle = "rgba(255,224,130,0.18)"; ctx.fillRect(20, ry, 440, 22); }
    ctx.fillStyle = "#fff";
    if (isItem) {
      const eff = `HP+${it.heal}${it.atk ? ` 攻+${it.atk}` : ""}${it.def ? ` 防+${it.def}` : ""}`;
      ctx.fillText(`🍳${it.name}（${eff}）`, 28, ry + 16);
    } else {
      ctx.fillText(`✨${"★".repeat(it.rarity)}【${ELEMENT_JA[it.element] || "無"}】${it.name}（攻${it.atk}/${it.turns}T）`, 28, ry + 16);
    }
  }
  const by = 304 + m * 24;
  if (sel >= m) { ctx.fillStyle = "rgba(255,224,130,0.18)"; ctx.fillRect(20, by, 440, 22); }
  ctx.fillStyle = "#9fd6ff"; ctx.fillText("← もどる", 28, by + 16);
  ctx.textAlign = "center";
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
  if (toastT > 0) toastT -= dt;
  // 自動セーブ(探索中、15秒ごと)
  if (state === STATE.FIELD || state === STATE.TOWN) {
    autoSaveTimer += dt;
    if (autoSaveTimer >= 15000) { autoSaveTimer = 0; saveGame(); }
  }
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
  // オート戦闘: フィールド/洞窟/塔にいる間、歩かなくても一定間隔で自動エンカウント
  const canAuto = state === STATE.FIELD || (state === STATE.TOWN && curArea.encounter);
  if (autoEncounter && canAuto && !battle && !Chat.isOpen()) {
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
  if (bossBattle) {
    if (bossBattle.shake > 0) bossBattle.shake -= dt * 0.05;
    if (bossBattle.ehurt > 0) bossBattle.ehurt -= dt * 0.05;
    if (bossBattle.phurt > 0) bossBattle.phurt -= dt * 0.05;
    if (bossBattle.khurt > 0) bossBattle.khurt -= dt * 0.05;
  }
}

// ===== 描画 =====
function render() {
  ctx.clearRect(0, 0, W, H);
  switch (state) {
    case STATE.TITLE: drawTitle(); break;
    case STATE.NAME: drawNameScene(); break;
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
    case STATE.NPCMENU: drawNpcMenu(); break;
    case STATE.BOARD: drawQuestBoard(); break;
    case STATE.QUESTLOG: drawQuestLog(); break;
    case STATE.WORDLIST: drawWordList(); break;
    case STATE.STORAGE: drawStorage(); break;
    case STATE.EQUIP: drawEquip(); break;
    case STATE.BATTLE: drawBattleScene(); drawBattleUI(); break;
    case STATE.BOSSBATTLE: drawBossBattle(); break;
    case STATE.GAMEOVER: drawEnd("ゲームオーバー", "#c0392b"); break;
    case STATE.CLEAR: drawEnd("魔王をたおした！ クリア！", "#f1c40f"); break;
  }
  drawAreaRate(); // 今いるエリアの達成率を常時表示(探索中のみ)
  // トースト通知(セーブしました 等)
  if (toastT > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, toastT / 400);
    ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fillRect(W / 2 - 120, H / 2 - 20, 240, 40);
    ctx.strokeStyle = "#9fffcf"; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - 120, H / 2 - 20, 240, 40);
    ctx.fillStyle = "#fff"; ctx.font = "15px 'MS Gothic', monospace"; ctx.textAlign = "center";
    ctx.fillText(toastMsg, W / 2, H / 2 + 6);
    ctx.restore();
    ctx.textAlign = "center";
  }
}

function drawTitle() {
  // 背景
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "bold 36px 'MS Gothic', monospace";
  ctx.fillText("異世界英語クエスト", W / 2, 110);
  ctx.font = "16px 'MS Gothic', monospace";
  ctx.fillStyle = "#9fd6ff";
  ctx.fillText("〜 王道ファンタジー英語学習RPG 〜", W / 2, 150);
  ctx.fillStyle = "#fff";
  ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillText(hasSave() ? "つづきから / 新しくはじめる" : "難易度(TOEICレベル)を えらんでね", W / 2, 212);
  const items = titleMenu();
  const n = items.length;
  if (menuSel >= n) menuSel = 0;
  for (let i = 0; i < n; i++) {
    const r = titleItemRect(i, n);
    drawWindow(70, r.y, 340, 46, menuSel === i);
    ctx.fillStyle = items[i].kind === "continue" ? "#9fffcf" : "#fff";
    ctx.font = "16px 'MS Gothic', monospace";
    ctx.fillText(items[i].label, W / 2, r.y + 29);
  }
  ctx.fillStyle = "#8aa";
  ctx.font = "12px 'MS Gothic', monospace";
  ctx.fillText("↑↓で選択 / Enter・タップで決定", W / 2, 452);
}
// タイトルのメニュー項目(セーブがあれば「つづきから」を先頭に)
function titleMenu() {
  const items = [];
  if (hasSave()) items.push({ label: "▶ つづきから", kind: "continue" });
  items.push({ label: "TOEIC 500  (中学〜やさしめ)", kind: "new", level: 500 });
  items.push({ label: "TOEIC 700  (ビジネス標準)", kind: "new", level: 700 });
  items.push({ label: "TOEIC 900  (上級)", kind: "new", level: 900 });
  return items;
}
function titleItemRect(i, n) { const startY = 244 - (n - 3) * 26; return { y: startY + i * 52, h: 46 }; }
function selectTitle(i) {
  const it = titleMenu()[i];
  if (!it) return;
  if (it.kind === "continue") { loadGame(); } else { openNameInput(it.level); }
}

let pendingLevel = 500; // 名前入力中に保持する難易度
// 新規開始: まず名前を入力してもらう
function openNameInput(level) {
  pendingLevel = level;
  state = STATE.NAME;
  const ov = document.getElementById("name-overlay");
  const inp = document.getElementById("name-input");
  if (ov) ov.style.display = "flex";
  if (inp) {
    inp.value = (player.name && player.name !== "まきば") ? player.name : "";
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }
}
// 名前を確定してゲーム開始
function confirmName() {
  if (state !== STATE.NAME) return;
  const inp = document.getElementById("name-input");
  let v = inp ? inp.value.trim() : "";
  if (v.length > 6) v = v.slice(0, 6);
  player.name = v || "まきば";
  const ov = document.getElementById("name-overlay");
  if (ov) ov.style.display = "none";
  startGame(pendingLevel);
}
function drawNameScene() {
  ctx.fillStyle = "#06122b"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "bold 30px 'MS Gothic', monospace";
  ctx.fillText("異世界英語クエスト", W / 2, 130);
  ctx.font = "15px 'MS Gothic', monospace";
  ctx.fillStyle = "#9fd6ff";
  ctx.fillText("〜 あたらしい たびのはじまり 〜", W / 2, 168);
}

function drawField() {
  camX = 0; camY = 0; // フィールドは15×15で画面ぴったり(スクロールなし)
  // タイル
  for (let y = 0; y < MAP_N; y++) {
    for (let x = 0; x < MAP_N; x++) {
      drawTile(MAP[y][x], x * TILE, y * TILE);
    }
  }
  // フィールドのボス(出現中)
  if (fieldBoss) drawFieldBossMarker(fieldBoss.tx * TILE, fieldBoss.ty * TILE);
  // プレイヤー
  drawHero(player.px - camX, player.py - camY, player.dir, player.anim);
  drawKotoha(player.px - camX + 30, player.py - camY + 8, 0.6); // 相棒コトハが隣を飛ぶ
  // HUD
  drawHud();
  drawCtrlHint();
}
// フィールド上のボス目印(角つきの威圧的なシルエット＋「ボス」ラベル)
function drawFieldBossMarker(px, py) {
  const b = AREA_BOSSES[fieldBoss.boss] || AREA_BOSSES.ogre;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px + 16, py + 28, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = b.color; ctx.beginPath(); ctx.ellipse(px + 16, py + 17, 12, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.moveTo(px + 6, py + 8); ctx.lineTo(px + 1, py - 3); ctx.lineTo(px + 11, py + 5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(px + 26, py + 8); ctx.lineTo(px + 31, py - 3); ctx.lineTo(px + 21, py + 5); ctx.fill();
  ctx.fillStyle = "#ff5050"; ctx.fillRect(px + 10, py + 14, 4, 4); ctx.fillRect(px + 18, py + 14, 4, 4);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(px - 2, py - 14, 36, 12);
  ctx.fillStyle = "#ff9b9b"; ctx.font = "9px 'MS Gothic', monospace"; ctx.textAlign = "center";
  ctx.fillText("ボス", px + 16, py - 5); ctx.textAlign = "center";
}

// 古代の遺跡の碑文(石板)。showDragon=true なら碑文を守るエンシェントドラゴンも描く。
function drawInscription(px, py, showBoss, opts) {
  opts = opts || {};
  const color = opts.color || AREA_BOSSES.ancient.color;
  const eye = opts.eye || "#ff4030";
  const label = opts.label || "古代竜";
  // 石板
  ctx.fillStyle = "#3a3a44"; ctx.fillRect(px + 5, py + 3, TILE - 10, TILE - 6);
  ctx.fillStyle = "#4c4c58"; ctx.fillRect(px + 7, py + 5, TILE - 14, TILE - 12);
  ctx.fillStyle = "#8a8aa0"; // 刻まれた文字っぽい線
  for (let i = 0; i < 3; i++) ctx.fillRect(px + 10, py + 9 + i * 5, TILE - 20, 2);
  if (showBoss) {
    // ボスのシルエット(角＋光る目)
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px + 16, py + 28, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(px + 16, py + 16, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.moveTo(px + 5, py + 7); ctx.lineTo(px - 1, py - 5); ctx.lineTo(px + 10, py + 4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px + 27, py + 7); ctx.lineTo(px + 33, py - 5); ctx.lineTo(px + 22, py + 4); ctx.fill();
    ctx.fillStyle = eye; ctx.fillRect(px + 9, py + 13, 4, 4); ctx.fillRect(px + 19, py + 13, 4, 4);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(px - 6, py - 16, 44, 12);
    ctx.fillStyle = "#ffd0d0"; ctx.font = "9px 'MS Gothic', monospace"; ctx.textAlign = "center";
    ctx.fillText(label, px + 16, py - 7);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(px - 4, py - 15, 40, 12);
    ctx.fillStyle = "#ffe082"; ctx.font = "9px 'MS Gothic', monospace"; ctx.textAlign = "center";
    ctx.fillText("碑文", px + 16, py - 6);
  }
  ctx.textAlign = "center";
}
// 情報パネルが隠れているときに出すヒント(下部)
function drawCtrlHint() {
  if (hudShown) return;
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(W / 2 - 135, H - 24, 270, 18);
  ctx.fillStyle = "#cfe0ff"; ctx.font = "11px 'MS Gothic', monospace"; ctx.textAlign = "center";
  ctx.fillText("📊 画面タップ / Hキー で情報パネル表示", W / 2, H - 11);
  ctx.textAlign = "center";
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
  } else if (t === "X") { // ダンジョン入口(岩山の洞窟)
    ctx.fillStyle = "#6d5a48"; ctx.beginPath(); ctx.moveTo(x + 4, y + 28); ctx.lineTo(x + 16, y + 4); ctx.lineTo(x + 28, y + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4a3c30"; ctx.fillRect(x + 6, y + 26, 20, 4);
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.moveTo(x + 11, y + 28); ctx.lineTo(x + 16, y + 15); ctx.lineTo(x + 21, y + 28); ctx.closePath(); ctx.fill();
  } else if (t === "Y") { // タワー入口(石の塔)
    ctx.fillStyle = "#9aa0b0"; ctx.fillRect(x + 9, y + 4, 14, 24);
    ctx.fillStyle = "#7a8090"; ctx.fillRect(x + 9, y + 4, 14, 3); ctx.fillRect(x + 9, y + 12, 14, 2); ctx.fillRect(x + 9, y + 20, 14, 2);
    ctx.fillStyle = "#7a8090"; ctx.fillRect(x + 8, y + 2, 4, 4); ctx.fillRect(x + 14, y + 2, 4, 4); ctx.fillRect(x + 20, y + 2, 4, 4); // 銃眼
    ctx.fillStyle = "#1a1a2a"; ctx.fillRect(x + 13, y + 20, 6, 8); // 入口
  } else if (t === "Z") { // 氷の洞窟入口(青い岩山)
    ctx.fillStyle = "#7aa6c8"; ctx.beginPath(); ctx.moveTo(x + 4, y + 28); ctx.lineTo(x + 16, y + 4); ctx.lineTo(x + 28, y + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#bfe4f5"; ctx.fillRect(x + 6, y + 24, 20, 4); // 雪の積もり
    ctx.fillStyle = "#0a2436"; ctx.beginPath(); ctx.moveTo(x + 11, y + 28); ctx.lineTo(x + 16, y + 15); ctx.lineTo(x + 21, y + 28); ctx.closePath(); ctx.fill();
  } else if (t === "F") { // 炎の遺跡入口(赤黒い岩山＋炎)
    ctx.fillStyle = "#6a3320"; ctx.beginPath(); ctx.moveTo(x + 4, y + 28); ctx.lineTo(x + 16, y + 4); ctx.lineTo(x + 28, y + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#2a1008"; ctx.beginPath(); ctx.moveTo(x + 11, y + 28); ctx.lineTo(x + 16, y + 14); ctx.lineTo(x + 21, y + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ff7a2a"; ctx.beginPath(); ctx.moveTo(x + 13, y + 26); ctx.lineTo(x + 16, y + 17); ctx.lineTo(x + 19, y + 26); ctx.closePath(); ctx.fill(); // 炎
    ctx.fillStyle = "#ffd24a"; ctx.fillRect(x + 15, y + 20, 2, 5);
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
  if (!hudShown) { sideQuestBoxRect = null; return; } // 情報パネル非表示時はボックスを描かない
  const reg = player.guildLevel > 0;
  const top = 36; // 達成率バー(8,8,24h)の下に配置
  drawWindow(8, top, 196, reg ? 96 : 76, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.font = "13px 'MS Gothic', monospace";
  ctx.fillText(`Lv ${player.level}   ${player.gold}G`, 20, top + 20);
  ctx.fillText(`HP ${player.hp}/${player.maxhp}`, 20, top + 40);
  ctx.fillText(`こうげき${player.atk}  ぼうぎょ${player.def}`, 20, top + 60);
  if (reg) {
    ctx.fillStyle = "#ffd24a";
    ctx.fillText(`ギルドLv${player.guildLevel}  GP${player.guildPoints}/${player.guildLevel * 100}`, 20, top + 80);
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
  const allItems = [...Object.entries(materials), ...Object.entries(bag)];
  if (allItems.length) {
    if (bagOpen) {
      // 展開: 品目一覧(8件/ページ・前後ページ移動)
      const per = 8;
      const pages = Math.max(1, Math.ceil(allItems.length / per));
      if (bagPage >= pages) bagPage = pages - 1; if (bagPage < 0) bagPage = 0;
      const items = allItems.slice(bagPage * per, bagPage * per + per);
      const hasNav = allItems.length > per;
      const bh = 24 + items.length * 16 + 6 + (hasNav ? 16 : 0);
      drawWindow(bx, y, bw, bh, false);
      bagBoxRect = { x: bx, y, w: bw, h: 22 }; // 見出し部だけ開閉トグル
      ctx.textAlign = "left";
      ctx.fillStyle = "#9fe0c0"; ctx.font = "12px 'MS Gothic', monospace";
      ctx.fillText(`● もちもの (${allItems.length}) ▼`, bx + 10, y + 19);
      ctx.fillStyle = "#fff"; ctx.font = "11px 'MS Gothic', monospace";
      for (let i = 0; i < items.length; i++) ctx.fillText(`${items[i][0]} ×${items[i][1]}`, bx + 10, y + 37 + i * 16);
      bagNavRects = null;
      if (hasNav) {
        const ny = y + 24 + items.length * 16 + 4;
        ctx.font = "11px 'MS Gothic', monospace";
        ctx.fillStyle = bagPage > 0 ? "#9fd6ff" : "#5a6a80"; ctx.textAlign = "left"; ctx.fillText("◀前", bx + 12, ny + 8);
        ctx.fillStyle = "#cfe0ff"; ctx.textAlign = "center"; ctx.fillText(`${bagPage + 1}/${pages}`, bx + bw / 2, ny + 8);
        ctx.fillStyle = bagPage < pages - 1 ? "#9fd6ff" : "#5a6a80"; ctx.textAlign = "right"; ctx.fillText("次▶", bx + bw - 12, ny + 8);
        ctx.textAlign = "left";
        bagNavRects = { prev: { x: bx, y: ny - 4, w: bw / 2, h: 16 }, next: { x: bx + bw / 2, y: ny - 4, w: bw / 2, h: 16 } };
      }
      y += bh + 6;
    } else {
      bagNavRects = null;
      // 折りたたみ: 見出しのみ(タップで展開)
      const bh = 26;
      drawWindow(bx, y, bw, bh, false);
      bagBoxRect = { x: bx, y, w: bw, h: bh };
      ctx.textAlign = "left";
      ctx.fillStyle = "#9fe0c0"; ctx.font = "12px 'MS Gothic', monospace";
      ctx.fillText(`● もちもの (${allItems.length})`, bx + 10, y + 18);
      ctx.fillStyle = "#9fd6ff"; ctx.font = "10px 'MS Gothic', monospace";
      ctx.textAlign = "right";
      ctx.fillText("▶タップ", bx + bw - 10, y + 18);
      y += bh + 6;
    }
  } else {
    bagBoxRect = null;
  }
  // 料理(タップで食べる)
  dishRowRects = [];
  if (dishes.length) {
    const ds = dishes.slice(0, 5);
    const bh = 24 + ds.length * 16 + 6;
    drawWindow(bx, y, bw, bh, false);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd24a"; ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText(`● 料理 (${dishes.length}) タップで食べる`, bx + 10, y + 19);
    ctx.font = "11px 'MS Gothic', monospace";
    for (let i = 0; i < ds.length; i++) {
      const ry = y + 28 + i * 16;
      const d = ds[i];
      const eff = `HP+${d.heal}${d.atk ? ` 攻+${d.atk}` : ""}${d.def ? ` 防+${d.def}` : ""}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(`🍳${d.name}（${eff}）`, bx + 10, ry + 9);
      dishRowRects.push({ x: bx, y: ry - 3, w: bw, h: 16, idx: i });
    }
    y += bh + 6;
  }
  // 召喚(貢物・召喚獣カード)の所持状況(読み取り専用)
  if (tributes.length || summonCards.length) {
    const bh = 26;
    drawWindow(bx, y, bw, bh, false);
    ctx.textAlign = "left";
    ctx.fillStyle = "#d8b0ff"; ctx.font = "11px 'MS Gothic', monospace";
    ctx.fillText(`🔮 召喚獣カード ${summonCards.length} ／ 貢物 ${tributes.length}`, bx + 10, y + 17);
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
  ctx.fillStyle = a.dungeon ? "#0a0a12" : a.dungeon2 ? "#08121e" : a.fire ? "#1a0a06" : a.tower ? "#12101e" : a.castle ? "#160a14" : a.indoor ? "#140d05" : "#2e5a28"; ctx.fillRect(0, 0, W, H);
  const c0 = Math.max(0, Math.floor(camX / TILE)), c1 = Math.min(a.cols - 1, Math.floor((camX + W) / TILE));
  const r0 = Math.max(0, Math.floor(camY / TILE)), r1 = Math.min(a.rows - 1, Math.floor((camY + H) / TILE));
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const px = x * TILE - camX, py = y * TILE - camY;
      if (a.dungeon) drawDungeonTile(a.map[y][x], px, py);
      else if (a.dungeon2) drawDungeon2Tile(a.map[y][x], px, py);
      else if (a.fire) drawFireTile(a.map[y][x], px, py);
      else if (a.tower) drawTowerTile(a.map[y][x], px, py);
      else if (a.castle) drawCastleTile(a.map[y][x], px, py);
      else if (a.indoor) drawInteriorTile(a.map[y][x], px, py);
      else drawTownTile(a.map[y][x], px, py);
    }
  }
  if (a.decor) for (const d of a.decor) drawDecor(d.kind, d.tx * TILE - camX, d.ty * TILE - camY);
  // 古代の遺跡: 碑文(と未討伐ならエンシェントドラゴン)を表示
  if (a.dungeon && quest && quest.stage >= 17) {
    drawInscription(ANCIENT_TILE.tx * TILE - camX, ANCIENT_TILE.ty * TILE - camY, !quest.ancientDefeated,
      { color: AREA_BOSSES.ancient.color, eye: "#ff4030", label: "古代竜" });
  }
  if (a.dungeon2 && quest && quest.stage >= 20) {
    drawInscription(ICE_TILE.tx * TILE - camX, ICE_TILE.ty * TILE - camY, !quest.iceQueenDefeated,
      { color: AREA_BOSSES.icequeen.color, eye: "#bfefff", label: "氷の女王" });
  }
  // 扉ラベル(でぐち／家の名前)
  ctx.textAlign = "center"; ctx.font = "11px 'MS Gothic', monospace";
  for (const d of a.doors) {
    const label = (d.to === "field" || d.to === "town") ? "EXIT" : (AREAS[d.to] ? AREAS[d.to].name : "");
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
  if (!hudShown) {
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(W / 2 - 150, H - 24, 300, 18);
    ctx.fillStyle = "#cfe0ff"; ctx.font = "11px 'MS Gothic', monospace"; ctx.textAlign = "center";
    ctx.fillText("📊 何もない所をタップ / Hキー で情報パネル表示", W / 2, H - 11);
    ctx.textAlign = "center";
  }
}

function drawInteriorTile(t, px, py) {
  if (t === "#") {
    ctx.fillStyle = "#5a4636"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#6b5340"; ctx.fillRect(px + 2, py + 2, TILE - 4, 8);
    ctx.fillStyle = "#4a382a"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    return;
  }
  if (t === "g") { // 室内の庭(芝生)
    ctx.fillStyle = "#3f7a34"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#46863a"; ctx.fillRect(px + 5, py + 7, 3, 3); ctx.fillRect(px + 20, py + 16, 3, 3); ctx.fillRect(px + 12, py + 24, 3, 3);
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

function drawDungeonTile(t, px, py) {
  if (t === "#") { // 岩壁
    ctx.fillStyle = "#3a3a46"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#4a4a58"; ctx.fillRect(px + 2, py + 2, TILE - 4, 9);
    ctx.fillStyle = "#2a2a34"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    ctx.fillStyle = "#33333e"; ctx.fillRect(px + 6, py + 13, 8, 6);
    return;
  }
  // 洞窟の床
  ctx.fillStyle = "#1c1c26"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#23232f"; ctx.fillRect(px + 5, py + 7, 4, 3); ctx.fillRect(px + 19, py + 16, 4, 3); ctx.fillRect(px + 12, py + 24, 3, 2);
  if (t === "D") { // 出口
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function drawDungeon2Tile(t, px, py) {
  if (t === "#") { // 氷壁
    ctx.fillStyle = "#274a60"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#356a86"; ctx.fillRect(px + 2, py + 2, TILE - 4, 9);
    ctx.fillStyle = "#1c3344"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    ctx.fillStyle = "#bfe4f5"; ctx.fillRect(px + 6, py + 4, 5, 3); // 氷の輝き
    return;
  }
  // 凍った床
  ctx.fillStyle = "#10222e"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#1a3340"; ctx.fillRect(px + 5, py + 7, 5, 3); ctx.fillRect(px + 19, py + 16, 5, 3); ctx.fillRect(px + 12, py + 24, 4, 2);
  if (t === "D") { // 出口
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function drawFireTile(t, px, py) {
  if (t === "#") { // 焦げた岩壁
    ctx.fillStyle = "#4a2418"; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "#6a3320"; ctx.fillRect(px + 2, py + 2, TILE - 4, 9);
    ctx.fillStyle = "#2a140c"; ctx.fillRect(px, py + TILE - 5, TILE, 5);
    ctx.fillStyle = "#ff7a3a"; ctx.fillRect(px + 6, py + 5, 4, 2); // 溶岩の輝き
    return;
  }
  // 熱い床
  ctx.fillStyle = "#2a1008"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#4a1c0c"; ctx.fillRect(px + 5, py + 7, 5, 3); ctx.fillRect(px + 19, py + 16, 5, 3); ctx.fillRect(px + 12, py + 24, 4, 2);
  ctx.fillStyle = "#c0401a"; ctx.fillRect(px + 14, py + 10, 3, 2); // 熾火
  if (t === "D") { // 出口
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function drawTowerTile(t, px, py) {
  if (t === "#") { // 石レンガの壁
    ctx.fillStyle = "#3a3650"; ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = "#2a2740"; ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, 9); ctx.strokeRect(px + 1, py + 11, TILE - 2, 9); ctx.strokeRect(px + 1, py + 21, TILE - 2, 9);
    ctx.fillStyle = "#46426a"; ctx.fillRect(px + 3, py + 3, 10, 5); ctx.fillRect(px + 17, py + 13, 10, 5);
    return;
  }
  // 塔の床(石畳)
  ctx.fillStyle = "#26233a"; ctx.fillRect(px, py, TILE, TILE);
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  if (t === "D") { // 出口
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  }
}

function drawCastleTile(t, px, py) {
  if (t === "#") { // 紫がかった石壁
    ctx.fillStyle = "#3a2a40"; ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = "#281c30"; ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, 9); ctx.strokeRect(px + 1, py + 11, TILE - 2, 9); ctx.strokeRect(px + 1, py + 21, TILE - 2, 9);
    ctx.fillStyle = "#4a3450"; ctx.fillRect(px + 3, py + 3, 10, 5); ctx.fillRect(px + 17, py + 13, 10, 5);
    return;
  }
  // 赤じゅうたんの床
  ctx.fillStyle = "#2a1622"; ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "#5a1a2a"; ctx.fillRect(px + 4, py, TILE - 8, TILE);
  ctx.fillStyle = "#7a2436"; ctx.fillRect(px + 4, py, 2, TILE); ctx.fillRect(px + TILE - 6, py, 2, TILE);
  if (t === "D") { // 出口
    ctx.fillStyle = "#3a5a8a"; ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
    ctx.fillStyle = "#5a7aaa"; ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
  } else if (t === "B") { // 玉座(魔王)
    ctx.fillStyle = "#caa23a"; ctx.fillRect(px + 8, py + 4, 16, 22);
    ctx.fillStyle = "#8a6a1a"; ctx.fillRect(px + 8, py + 4, 16, 4);
    ctx.fillStyle = "#c0392b"; ctx.fillRect(px + 11, py + 9, 10, 12);
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
    case "flower": drawFlower(x, y); break;
    case "fence": drawFence(x, y); break;
    case "desk": drawDesk(x, y); break;
    case "stove": drawStove(x, y); break;
    case "sink": drawSink(x, y); break;
    case "summoncircle": drawSummonCircle(x, y); break;
    case "cauldron": drawCauldron(x, y); break;
    case "fridge": drawFridgeIcon(x, y); break;
    case "tv": drawTV(x, y); break;
    case "warehouse": drawWarehouse(x, y); break;
  }
}
// 台所: コンロ(鍋つき)
function drawStove(x, y) {
  ctx.fillStyle = "#9aa3ad"; ctx.fillRect(x + 2, y + 8, 28, 22);       // 本体
  ctx.fillStyle = "#cfd6dd"; ctx.fillRect(x + 2, y + 8, 28, 4);        // 天板ふち
  ctx.fillStyle = "#2b2f36"; ctx.fillRect(x + 5, y + 12, 9, 7); ctx.fillRect(x + 18, y + 12, 9, 7); // 五徳(2口)
  ctx.fillStyle = "#3a3f47"; ctx.fillRect(x + 6, y + 22, 6, 5); ctx.fillRect(x + 20, y + 22, 6, 5); // 扉
  ctx.fillStyle = "#ffce54"; ctx.fillRect(x + 8, y + 24, 2, 1); ctx.fillRect(x + 22, y + 24, 2, 1); // 取っ手
  // 鍋
  ctx.fillStyle = "#5a5f66"; ctx.fillRect(x + 16, y + 9, 11, 5);
  ctx.fillStyle = "#7a818a"; ctx.fillRect(x + 14, y + 10, 2, 2); ctx.fillRect(x + 27, y + 10, 2, 2); // 取っ手
}
// 台所: 流し台(蛇口つき)
function drawSink(x, y) {
  ctx.fillStyle = "#8a939d"; ctx.fillRect(x + 2, y + 8, 28, 22);       // 本体
  ctx.fillStyle = "#cfd6dd"; ctx.fillRect(x + 2, y + 8, 28, 5);        // 天板
  ctx.fillStyle = "#5c6470"; ctx.fillRect(x + 7, y + 14, 18, 9);       // シンク(凹み)
  ctx.fillStyle = "#3c424c"; ctx.fillRect(x + 9, y + 16, 14, 5);
  // 蛇口
  ctx.fillStyle = "#cfd6dd"; ctx.fillRect(x + 15, y + 7, 3, 6); ctx.fillRect(x + 15, y + 7, 8, 2);
  ctx.fillStyle = "#3a3f47"; ctx.fillRect(x + 5, y + 24, 22, 4);       // 扉ライン
}
// 勉強机(本・本立て・ランプ付き)
function drawDesk(x, y) {
  ctx.fillStyle = "#7a5230"; ctx.fillRect(x + 2, y + 12, 28, 6);        // 天板
  ctx.fillStyle = "#5e3f22"; ctx.fillRect(x + 4, y + 18, 4, 12); ctx.fillRect(x + 24, y + 18, 4, 12); // 脚
  ctx.fillStyle = "#3f2c18"; ctx.fillRect(x + 4, y + 18, 24, 3);        // 引き出し
  // 開いた本
  ctx.fillStyle = "#f3ead4"; ctx.fillRect(x + 9, y + 7, 14, 6);
  ctx.fillStyle = "#c9b88f"; ctx.fillRect(x + 15, y + 7, 2, 6);
  ctx.strokeStyle = "#9a8a64"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 11, y + 9); ctx.lineTo(x + 14, y + 9); ctx.moveTo(x + 18, y + 9); ctx.lineTo(x + 21, y + 9); ctx.stroke();
  // 本立て(背表紙3冊)
  ctx.fillStyle = "#c0506a"; ctx.fillRect(x + 3, y + 3, 3, 9);
  ctx.fillStyle = "#4a80c0"; ctx.fillRect(x + 6, y + 4, 3, 8);
  ctx.fillStyle = "#5aa84a"; ctx.fillRect(x + 9, y + 5, 3, 7);
  // 卓上ランプ
  ctx.fillStyle = "#caa030"; ctx.fillRect(x + 25, y + 6, 2, 6);
  ctx.fillStyle = "#ffe082"; ctx.beginPath(); ctx.arc(x + 26, y + 5, 3, 0, Math.PI * 2); ctx.fill();
}
// 召喚魔法陣(床に光る紫の魔法陣)
function drawSummonCircle(x, y) {
  ctx.save();
  ctx.strokeStyle = "#b06adf"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + 16, y + 18, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "#7a3ab0"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x + 16, y + 18, 9, 0, Math.PI * 2); ctx.stroke();
  // 五芒星
  ctx.strokeStyle = "#e0a8ff"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
    const px2 = x + 16 + Math.cos(a) * 11, py2 = y + 18 + Math.sin(a) * 11;
    i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
  }
  ctx.closePath(); ctx.stroke();
  // ほのかな光
  ctx.fillStyle = "rgba(176,106,223,0.18)"; ctx.beginPath(); ctx.arc(x + 16, y + 18, 13, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// 冷蔵庫(2ドアの白い冷蔵庫)
function drawFridgeIcon(x, y) {
  ctx.fillStyle = "#e8eef2"; ctx.fillRect(x + 8, y + 3, 16, 27);
  ctx.strokeStyle = "#b6c2cc"; ctx.lineWidth = 1; ctx.strokeRect(x + 8, y + 3, 16, 27);
  ctx.strokeStyle = "#c9d3db"; ctx.beginPath(); ctx.moveTo(x + 8, y + 14); ctx.lineTo(x + 24, y + 14); ctx.stroke(); // 上下ドアの境
  ctx.fillStyle = "#8fa0ac"; ctx.fillRect(x + 20, y + 6, 2, 6); ctx.fillRect(x + 20, y + 16, 2, 8); // 取っ手
}
// 倉庫(木の大きな収納箱／チェスト)
function drawWarehouse(x, y) {
  ctx.fillStyle = "#8a6a3e"; ctx.fillRect(x + 3, y + 12, 26, 18);       // 箱本体
  ctx.fillStyle = "#6e5230"; ctx.fillRect(x + 3, y + 12, 26, 4);        // 上ぶち
  ctx.fillStyle = "#a5844e"; ctx.fillRect(x + 3, y + 6, 26, 8);         // フタ(丸みは省略)
  ctx.fillStyle = "#5a4326"; ctx.fillRect(x + 3, y + 13, 26, 2);        // フタの合わせ目
  ctx.fillStyle = "#c8a24a"; ctx.fillRect(x + 14, y + 12, 4, 6);        // 金具
  ctx.fillStyle = "#d8b24a"; ctx.fillRect(x + 15, y + 15, 2, 2);        // 錠前
  ctx.fillStyle = "#6e5230"; ctx.fillRect(x + 5, y + 20, 22, 2); ctx.fillRect(x + 5, y + 26, 22, 2); // 帯
}
// テレビ(薄型テレビ・画面が光る)
function drawTV(x, y) {
  ctx.fillStyle = "#2a2a30"; ctx.fillRect(x + 3, y + 6, 26, 18);          // 筐体
  ctx.fillStyle = "#5ad0ff"; ctx.fillRect(x + 5, y + 8, 22, 14);          // 画面
  ctx.fillStyle = "#bfeeff"; ctx.fillRect(x + 6, y + 9, 8, 5);           // 反射
  ctx.fillStyle = "#3a3a44"; ctx.fillRect(x + 13, y + 24, 6, 3);          // スタンド
  ctx.fillRect(x + 9, y + 27, 14, 2);
}
// 召喚料理の大鍋(紫の煮汁がぐつぐつ)
function drawCauldron(x, y) {
  ctx.fillStyle = "#3a3a44"; ctx.beginPath(); ctx.ellipse(x + 16, y + 22, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2a2a32"; ctx.fillRect(x + 3, y + 14, 26, 8);
  ctx.fillStyle = "#8a4ad0"; ctx.beginPath(); ctx.ellipse(x + 16, y + 15, 11, 4, 0, 0, Math.PI * 2); ctx.fill(); // 煮汁
  ctx.fillStyle = "#b06adf"; ctx.beginPath(); ctx.arc(x + 12, y + 14, 1.6, 0, Math.PI * 2); ctx.arc(x + 20, y + 15, 1.3, 0, Math.PI * 2); ctx.fill(); // 泡
  ctx.fillStyle = "#5a3a1e"; ctx.fillRect(x + 6, y + 28, 4, 4); ctx.fillRect(x + 22, y + 28, 4, 4); // 脚
  ctx.fillStyle = "#e0a020"; ctx.fillRect(x + 4, y + 30, 24, 2); // 炎の名残
}
// 花壇(歩ける飾り)。カラフルな花を数輪。
function drawFlower(x, y) {
  ctx.fillStyle = "#2e8a30"; ctx.fillRect(x + 6, y + 18, 3, 8); ctx.fillRect(x + 15, y + 16, 3, 10); ctx.fillRect(x + 23, y + 19, 3, 7);
  const blooms = [[7, 16, "#ff6f91"], [16, 13, "#ffd24a"], [24, 17, "#7aa0ff"]];
  for (const [bx, by, col] of blooms) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x + bx, y + by, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff8e0"; ctx.beginPath(); ctx.arc(x + bx, y + by, 1.5, 0, Math.PI * 2); ctx.fill();
  }
}
// 木の柵(通れない)
function drawFence(x, y) {
  ctx.fillStyle = "#8a6a3e"; ctx.fillRect(x + 3, y + 12, 26, 4); ctx.fillRect(x + 3, y + 20, 26, 4); // 横木
  ctx.fillStyle = "#6e5230";
  ctx.fillRect(x + 5, y + 8, 4, 20); ctx.fillRect(x + 14, y + 8, 4, 20); ctx.fillRect(x + 23, y + 8, 4, 20); // 杭
  ctx.fillStyle = "#9a784a"; ctx.fillRect(x + 5, y + 8, 4, 2); ctx.fillRect(x + 14, y + 8, 4, 2); ctx.fillRect(x + 23, y + 8, 4, 2);
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
  const w = battle.word;
  // 出題ウィンドウ
  drawWindow(16, 248, 448, 58, false);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  if (w.grammar) {
    ctx.font = "12px 'MS Gothic', monospace";
    ctx.fillText("空所( ___ )に入る正しいものは？", W / 2, 266);
    ctx.fillStyle = "#ffe082"; ctx.font = "15px 'MS Gothic', monospace";
    drawCenteredWrapped(w.q, W / 2, 287, 432, 17, 2);
  } else {
    ctx.font = "13px 'MS Gothic', monospace";
    ctx.fillText("この英単語の意味は？", W / 2, 270);
    ctx.font = "bold 26px 'MS Gothic', monospace";
    ctx.fillStyle = "#ffe082";
    ctx.fillText(w.en, W / 2, 297);
  }
  // 🔊 読み上げボタン(タップで聞き直し)
  if (window.Voice && Voice.supported) {
    drawWindow(BATTLE_SPK.x, BATTLE_SPK.y, BATTLE_SPK.w, BATTLE_SPK.h, false);
    ctx.fillStyle = "#fff"; ctx.font = "18px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("🔊", BATTLE_SPK.x + BATTLE_SPK.w / 2, BATTLE_SPK.y + BATTLE_SPK.h / 2 + 7);
  }
  // 4択
  ctx.font = (w.grammar ? "14px" : "16px") + " 'MS Gothic', monospace";
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const bx = 16 + col * 232, by = 312 + row * 76;
    drawWindow(bx, by, 216, 64, menuSel === i);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText(w.choices[i], bx + 108, by + 39);
  }
  // プレイヤーHP小表示
  ctx.textAlign = "left"; ctx.font = "13px 'MS Gothic', monospace"; ctx.fillStyle = "#fff";
  ctx.fillText(`${player.name} HP ${player.hp}/${player.maxhp}`, 20, 244);
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
    { who: "コトハ", lines: [`起きた、${player.name}！ キミ、転生しちゃったみたいだね。`, "私はコトハ、言葉の精霊！ これからよろしくね。"] },
    { who: "コトハ", lines: ["この世界の人は英語しか話さないの。", "でも大丈夫、私が相棒になるから。", "英語を覚えるほど、キミはどんどん強くなるよ。"] },
    { who: "コトハ", lines: ["元の世界に帰る手がかりも、きっと人との会話の中にあるはず。", "少しずつ、いっしょに言葉を覚えよう。"] },
    { who: "コトハ", lines: ["でもまずは旅の資金！ 宿屋に泊まるにもお金がいるの。", "モンスターをたおすと素材が手に入るから、それを町で換金しよう。"] },
    { who: "コトハ", lines: ["まずはモンスターをたおして素材を3つ集めよう！", "それから町(赤い屋根の建物)へ向かおう。さ、行くよ相棒！"] },
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
  // 主人公(右向き)・コトハ(主人公の右上に浮遊)
  drawActor(196, 150, () => drawHero(0, 0, "right", gameTime));
  drawKotoha(298, 138);
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
