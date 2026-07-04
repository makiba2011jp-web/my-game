"use strict";
// =====================================================================
// 音声読み上げ(TTS)モジュール — 完全に独立。
//   ブラウザ標準 Web Speech API(speechSynthesis)を使用。無料・キー不要。
//   ▼ 不要になったら: このファイルを消し、index.html の
//      <script src="voice.js"></script> を1行消すだけでOK。
//      呼び出し側は window.Voice && Voice.xxx() でガードしてあるので、
//      消し忘れても無害(自動的に何もしない)。
// =====================================================================
const Voice = (() => {
  const synth = window.speechSynthesis;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance !== "undefined";
  const AUTO_KEY = "voice_auto";
  let autoOn = localStorage.getItem(AUTO_KEY) !== "off"; // 既定ON(明示的にoffの時だけ無効)
  let voices = [];

  function loadVoices() { try { voices = synth.getVoices() || []; } catch (_) { voices = []; } }
  if (supported) {
    loadVoices();
    if ("onvoiceschanged" in synth) synth.onvoiceschanged = loadVoices; // 非同期で揃うことがある
  }
  function pickVoice(lang) {
    const pref = lang === "ja" ? ["ja-jp", "ja"] : ["en-us", "en-gb", "en-au", "en"];
    for (const p of pref) {
      const v = voices.find((vc) => vc.lang && vc.lang.toLowerCase().startsWith(p));
      if (v) return v;
    }
    return null;
  }
  function cancel() { if (supported) try { synth.cancel(); } catch (_) {} }
  function speak(text, lang) {
    if (!supported || !text) return;
    cancel(); // 前の発声を止めてから
    try { synth.resume(); } catch (_) {} // モバイルで一時停止状態になることがある
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang === "ja" ? "ja-JP" : "en-US";
    const v = pickVoice(lang); if (v) u.voice = v;
    u.rate = lang === "ja" ? 1.0 : 0.95; // 英語は少しゆっくり(学習者向け)
    u.pitch = 1.0; u.volume = 1.0;
    try { synth.speak(u); } catch (_) {}
  }
  function autoSpeak(text, lang) { if (autoOn) speak(text, lang); } // 自動ONの時だけ

  // ===== モバイル対策: 最初のユーザー操作の中で無音発話して音声を「解錠」 =====
  //   スマホ(特にiOS/Chrome)は、ユーザー操作外の speechSynthesis.speak を鳴らさない。
  //   初回タップ時に空発話しておくと、以降の自動読み上げ/ボタンが鳴るようになる。
  let unlocked = false;
  function unlock() {
    if (unlocked || !supported) return;
    try {
      loadVoices();
      synth.resume();
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; // 無音でウォームアップ
      synth.speak(u);
      unlocked = true; // 成功したら以後は解錠済み
    } catch (_) {}
  }
  if (supported) {
    const onFirst = () => { unlock(); };
    // 一度解錠すれば十分だが、失敗しても次の操作で再試行できるよう複数種を購読
    ["pointerdown", "touchend", "mousedown", "keydown"].forEach((ev) =>
      window.addEventListener(ev, onFirst, { passive: true }));
  }

  // ===== チャットヘッダの自動読み上げトグル =====
  let toggleBtn = null;
  function updateToggle() {
    if (!toggleBtn) return;
    toggleBtn.textContent = autoOn ? "🔊自動" : "🔇自動";
    toggleBtn.style.background = autoOn ? "#1c5d54" : "#4a2a2a";
  }
  function setAuto(on) { autoOn = !!on; localStorage.setItem(AUTO_KEY, autoOn ? "on" : "off"); updateToggle(); if (!autoOn) cancel(); }
  function toggleAuto() { setAuto(!autoOn); }
  function injectToggle() {
    if (!supported || toggleBtn) return;
    const host = document.querySelector(".chat-head-btns");
    if (!host) return;
    toggleBtn = document.createElement("button");
    toggleBtn.id = "chat-voice-toggle";
    toggleBtn.title = "NPCの英語を自動で読み上げ";
    toggleBtn.style.cssText = "font-size:13px;color:#fff;border:1px solid #fff;border-radius:6px;padding:4px 8px;cursor:pointer;";
    toggleBtn.addEventListener("click", (e) => { e.preventDefault(); toggleAuto(); });
    host.insertBefore(toggleBtn, document.getElementById("chat-close") || null);
    updateToggle();
  }
  if (supported) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectToggle);
    else injectToggle();
  }

  // 吹き出しに「🔊聞く」ボタンを足す(明示再生。モバイルの自動再生制限の保険にもなる)
  function attachSpeakButton(container, text, lang) {
    if (!supported || !container) return null;
    const b = document.createElement("button");
    b.className = "tr-btn voice-btn";
    b.textContent = "🔊 聞く";
    b.addEventListener("click", (e) => { e.preventDefault(); speak(text, lang || "en"); });
    container.appendChild(b);
    return b;
  }

  return { supported, speak, autoSpeak, cancel, toggleAuto, setAuto, isAuto: () => autoOn, attachSpeakButton };
})();
window.Voice = Voice;
