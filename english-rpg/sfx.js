"use strict";
// =====================================================================
// 効果音(SFX)モジュール — 完全に独立。暫定のレトロ風合成音。
//   Web Audio API でその場生成(外部ファイル不要・キー不要・GitHub Pages可)。
//   ▼ 不要になったら: このファイルを消し、index.html の
//      <script src="sfx.js"></script> を1行消すだけでOK。
//      呼び出し側は window.Sfx && Sfx.play() でガードしてあるので無害。
// =====================================================================
const Sfx = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const supported = !!AC;
  let ctx = null, master = null;
  let enabled = localStorage.getItem("sfx") !== "off"; // 既定ON

  function ensure() {
    if (!supported) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32; // 全体音量(控えめ)
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }

  // 単音(周波数スイープ・エンベロープつき)
  function tone(freq, start, dur, type, vol, slideTo) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) { try { osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur); } catch (_) {} }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  // ノイズ(打撃・爆発感)
  function noise(start, dur, vol, hp) {
    const t0 = ctx.currentTime + start;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); // 減衰ノイズ
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 700;
    const g = ctx.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  }

  const SOUNDS = {
    select:    () => tone(660, 0, 0.05, "square", 0.2),
    confirm:   () => { tone(560, 0, 0.05, "square", 0.22); tone(840, 0.05, 0.08, "square", 0.22); },
    cancel:    () => tone(400, 0, 0.1, "square", 0.2, 240),
    // 戦闘
    hit:       () => { noise(0, 0.12, 0.32, 500); tone(180, 0, 0.1, "square", 0.25, 90); },
    crit:      () => { noise(0, 0.18, 0.4, 400); tone(150, 0, 0.18, "sawtooth", 0.32, 70); tone(400, 0.02, 0.12, "square", 0.2, 120); },
    hurt:      () => { tone(200, 0, 0.18, "sawtooth", 0.3, 80); noise(0, 0.1, 0.12, 300); },
    correct:   () => { tone(880, 0, 0.08, "square", 0.26); tone(1175, 0.08, 0.13, "square", 0.26); },
    wrong:     () => { tone(320, 0, 0.16, "square", 0.28, 170); tone(190, 0.12, 0.22, "square", 0.26, 120); },
    magic:     () => { tone(700, 0, 0.22, "sine", 0.22, 1500); tone(1050, 0.06, 0.2, "triangle", 0.16, 1900); },
    heal:      () => { tone(660, 0, 0.13, "sine", 0.2, 990); tone(880, 0.1, 0.16, "sine", 0.18, 1320); },
    guard:     () => { noise(0, 0.06, 0.12, 200); tone(260, 0, 0.13, "square", 0.18, 200); },
    special:   () => { tone(110, 0, 0.32, "sawtooth", 0.34, 640); noise(0.05, 0.22, 0.24, 500); tone(320, 0.26, 0.2, "square", 0.28, 960); },
    summon:    () => { tone(380, 0, 0.16, "sine", 0.2, 760); tone(560, 0.13, 0.16, "sine", 0.2, 1120); tone(880, 0.26, 0.22, "triangle", 0.22, 1500); },
    encounter: () => { tone(300, 0, 0.1, "square", 0.28); tone(300, 0.14, 0.1, "square", 0.28); tone(520, 0.3, 0.18, "square", 0.28); },
    win:       () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.15, "square", 0.26)); },
    lose:      () => { [440, 349, 262].forEach((f, i) => tone(f, i * 0.2, 0.34, "triangle", 0.28, f * 0.7)); },
    levelup:   () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.08, 0.13, "square", 0.24)); },
    // 町・UI
    coin:      () => { tone(988, 0, 0.05, "square", 0.24); tone(1319, 0.05, 0.12, "square", 0.24); },
    item:      () => { tone(784, 0, 0.06, "triangle", 0.22); tone(1046, 0.06, 0.1, "triangle", 0.22); },
  };

  function play(name) {
    if (!enabled || !supported) return;
    if (!ensure()) return;
    const f = SOUNDS[name]; if (f) { try { f(); } catch (_) {} }
  }
  function setEnabled(on) { enabled = !!on; localStorage.setItem("sfx", enabled ? "on" : "off"); }
  function toggle() { setEnabled(!enabled); return enabled; }

  // モバイル/自動再生対策: 最初のユーザー操作で AudioContext を起動
  if (supported) {
    const onFirst = () => { ensure(); };
    ["pointerdown", "touchend", "mousedown", "keydown"].forEach((ev) => window.addEventListener(ev, onFirst, { passive: true }));
  }

  return { play, supported, setEnabled, toggle, isEnabled: () => enabled };
})();
window.Sfx = Sfx;
