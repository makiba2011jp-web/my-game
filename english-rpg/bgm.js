"use strict";
// =====================================================================
// BGMモジュール — BGM/*.mp3 をループ再生。完全に独立。
//   ▼ 不要になったら: このファイルを消し、index.html の
//      <script src="bgm.js"></script> を1行消すだけでOK。
//      呼び出し側は window.Bgm && Bgm.play() でガードしてあるので無害。
//   ▼ 曲を足したいとき: BGM/ に置いて TRACKS にキーとファイル名を追加するだけ。
//      （FALLBACK に同じキーがあれば、そちらより TRACKS が優先されます）
// =====================================================================
const Bgm = (() => {
  const BASE = "BGM/";
  // キー → ファイル名(BGM/ 以下)
  const TRACKS = {
    // 画面
    title:  "タイトル画面.mp3",
    ending: "エンディング.mp3",
    // 探索エリア
    field:    "フィールド草原.mp3",
    town:     "フィールド街.mp3",
    dungeon:  "フィールド古代の遺跡.mp3",
    dungeon2: "フィールド氷の遺跡.mp3",
    castle:   "フィールド魔王城.mp3",
    // 通常バトル(英単語/英文法)
    battle_field:    "バトルフィールド単語.mp3",
    battle_dungeon:  "バトル古代の遺跡単語.mp3",
    battle_dungeon2: "バトル氷の遺跡単語.mp3",
    battle_fire:     "バトル炎の遺跡単語.mp3",
    // ギルド討伐依頼のエリアボス(コマンド式)
    areaboss_field:    "バトルフィールド大討伐ボス.mp3",
    areaboss_dungeon:  "バトル古代の遺跡大討伐ボス.mp3",
    areaboss_dungeon2: "バトル氷の遺跡大討伐ボス.mp3",
    areaboss_fire:     "バトル炎の遺跡大討伐ボス.mp3",
    // ストーリーボス
    story_ancient:     "バトル古代の遺跡ストーリーボス.mp3",
    story_icequeen:    "バトル氷の遺跡ストーリーボス.mp3",
    story_fireemperor: "バトル炎の遺跡ストーリーボス.mp3",
  };
  // まだ専用曲が無いキーの代替先(曲が用意できたら TRACKS に足すだけで自動的にそちらが使われる)
  const FALLBACK = {
    fire: "dungeon", tower: "dungeon",
    battle_tower: "battle_field", battle_castle: "battle_field",
    areaboss_tower: "areaboss_field", areaboss_castle: "areaboss_field", areaboss_fire2: "areaboss_field",
    story_wraith: "story_icequeen",
    story_maou: "story_fireemperor", story_shinmaou: "story_fireemperor",
  };
  // キーを実在する曲まで解決(無ければ null)
  function resolve(key) {
    let k = key, guard = 0;
    while (k && !TRACKS[k] && guard++ < 8) k = FALLBACK[k];
    return (k && TRACKS[k]) ? k : null;
  }

  let enabled = localStorage.getItem("bgm") !== "off"; // 既定ON
  const DEFAULT_VOL = 0.16; // BGMは控えめ(効果音や読み上げの邪魔をしない音量)
  let volume = parseFloat(localStorage.getItem("bgmvol") || String(DEFAULT_VOL));
  if (!(volume >= 0 && volume <= 1)) volume = DEFAULT_VOL;
  let curKey = null;    // いま鳴らしたい曲(解決済みキー)
  let audio = null;     // 再生中の Audio
  let unlocked = false; // 初回ユーザー操作で解錠(ブラウザの自動再生制限)
  const cache = {};

  function el(key) {
    if (!cache[key]) {
      const a = new Audio(BASE + encodeURIComponent(TRACKS[key]));
      a.loop = true; a.preload = "none";
      cache[key] = a;
    }
    return cache[key];
  }
  // curKey/enabled/unlocked に合わせて再生状態を整える
  function apply() {
    if (!enabled || !curKey || !unlocked) { if (audio) audio.pause(); return; }
    const a = el(curKey);
    if (audio && audio !== a) { audio.pause(); try { audio.currentTime = 0; } catch (_) {} }
    audio = a; a.volume = volume;
    if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
  }
  // 曲を切り替える(同じ曲なら何もしない=毎フレーム呼んでOK)
  function play(key) {
    const k = resolve(key);
    if (k === curKey) { apply(); return; }
    if (audio) { audio.pause(); try { audio.currentTime = 0; } catch (_) {} }
    curKey = k; audio = null;
    apply();
  }
  function stop() {
    curKey = null;
    if (audio) { audio.pause(); try { audio.currentTime = 0; } catch (_) {} }
    audio = null;
  }
  function setEnabled(on) {
    enabled = !!on; localStorage.setItem("bgm", enabled ? "on" : "off");
    if (!enabled) { if (audio) audio.pause(); } else apply();
  }
  function toggle() { setEnabled(!enabled); return enabled; }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem("bgmvol", String(volume));
    if (audio) audio.volume = volume;
  }

  // モバイル/自動再生対策: 最初のユーザー操作で解錠して再生開始
  const onFirst = () => { if (!unlocked) { unlocked = true; apply(); } };
  ["pointerdown", "touchend", "mousedown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, onFirst, { passive: true }));

  return { play, stop, setEnabled, toggle, setVolume, isEnabled: () => enabled, getVolume: () => volume };
})();
window.Bgm = Bgm;
