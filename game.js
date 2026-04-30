(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = 880;
  const GRAVITY = 0.25;
  const JUMP_VEL = -7.5;
  const MOVE_SPEED = 2.0;
  const FRICTION = 0.8;
  const WORLD_W = 5000;

  const STATE = {
    INTRO: "intro",
    PLAY: "play",
    DIALOG: "dialog",
    KISS: "kiss",
    WIN: "win",
    GAMEOVER: "gameover",
  };

  const game = {
    state: STATE.INTRO,
    camera: 0,
    cameraTargetLock: null,
    time: 0,
    shake: 0,
    flashHearts: [],
    pickedRoses: 0,
    pickedLetters: 0,
    readMemories: 0,
    triggeredDialogs: new Set(),
    kissTimer: 0,
    nearMonument: null,
    warnedNotEnoughMemories: false,
    zoom: 1,
    zoomTarget: 1,
    flyMode: false,
    cheatActive: false,
    cheatBuffer: "",
  };

  const keys = {};
  const KEY_LEFT  = ["ArrowLeft", "KeyA"];
  const KEY_RIGHT = ["ArrowRight", "KeyD"];
  const KEY_JUMP  = ["Space", "ArrowUp", "KeyW"];
  const KEY_CONFIRM = ["KeyX", "Enter"];

  function isDown(list) { return list.some(k => keys[k]); }

  addEventListener("keydown", (e) => {
    if (e.code === "Digit0" || e.code === "Numpad0") {
      game.cheatActive = true;
      game.cheatBuffer = "";
      return;
    }
    if (game.cheatActive && e.key && e.key.length === 1) {
      game.cheatBuffer += e.key.toLowerCase();
      if (game.cheatBuffer.endsWith("fly")) {
        game.flyMode = !game.flyMode;
        game.cheatActive = false;
        game.cheatBuffer = "";
        if (game.state === STATE.PLAY || game.state === STATE.DIALOG) {
          showDialog(
            "Cheat",
            game.flyMode
              ? "Modalità VOLO attivata. Spazio = sali, Shift = scendi. (digita 0+fly per disattivare)"
              : "Modalità VOLO disattivata. Le leggi della gravità tornano a valere."
          );
        }
        return;
      }
      if (game.cheatBuffer.length > 8) {
        game.cheatActive = false;
        game.cheatBuffer = "";
      }
      return;
    }

    if ([
      "ArrowLeft","ArrowRight","ArrowUp","ArrowDown",
      "Space","KeyA","KeyD","KeyW","KeyX","Enter","KeyE",
      "ShiftLeft","ShiftRight"
    ].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys[e.code]) keys[e.code + "_pressed"] = true;
    keys[e.code] = true;

    if (game.state === STATE.DIALOG && KEY_CONFIRM.includes(e.code)) {
      closeDialog();
    }
  });

  addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { audioCtx = null; }
    }
  }
  function beep(freq, dur = 0.08, type = "square", vol = 0.06) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur);
  }
  const SFX = {
    jump:    () => beep(520, 0.1, "square", 0.05),
    rose:    () => { beep(880, 0.06); setTimeout(() => beep(1320, 0.08), 60); },
    letter:  () => { beep(660, 0.08); setTimeout(() => beep(990, 0.1), 70); },
    hit:     () => beep(120, 0.18, "sawtooth", 0.08),
    stomp:   () => beep(220, 0.1, "triangle", 0.06),
    kiss:    () => {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => beep(f, 0.18, "triangle", 0.06), i * 120));
    },
  };

  const COL = {
    skyTop:    "#1a1230",
    skyMid:    "#3a1d40",
    skyLow:    "#a85070",
    moon:      "#fff4d0",
    moonShade: "#d8c890",
    starA:     "#fff4d0",
    starB:     "#d9a441",
    hillFar:   "#231a30",
    hillMid:   "#1a1428",
    grass:     "#3a5a2a",
    grassDark: "#2a4220",
    dirt:      "#5a3a22",
    dirtDark:  "#3a2618",
    stone:     "#7a6a58",
    stoneDark: "#3a3228",
    leaves:    "#2a4a26",
    leavesHi:  "#3a6a36",
    trunk:     "#3a2418",
  };

  const player = {
    x: 60, y: GROUND_Y - 44,
    w: 22, h: 44,
    vx: 0, vy: 0,
    onGround: false,
    facing: 1,
    walkFrame: 0,
    walkTimer: 0,
    hp: 3,
    invuln: 0,
    dead: false,
  };

  const platforms = [
    { x: 0,    y: GROUND_Y, w: 620,  h: 200, kind: "ground" },
    { x: 740,  y: GROUND_Y, w: 660,  h: 200, kind: "ground" },
    { x: 1500, y: GROUND_Y, w: 640,  h: 200, kind: "ground" },
    { x: 2240, y: GROUND_Y, w: 880,  h: 200, kind: "ground" },
    { x: 3220, y: GROUND_Y, w: 540,  h: 200, kind: "ground" },
    { x: 3860, y: GROUND_Y, w: 1140, h: 200, kind: "ground" },

    { x: 280,  y: GROUND_Y - 84,  w: 96,  h: 16, kind: "hedge" },
    { x: 460,  y: GROUND_Y - 148, w: 80,  h: 16, kind: "hedge" },
    { x: 820,  y: GROUND_Y - 96,  w: 112, h: 16, kind: "hedge" },
    { x: 1000, y: GROUND_Y - 186, w: 96,  h: 16, kind: "stone" },
    { x: 1200, y: GROUND_Y - 96,  w: 96,  h: 16, kind: "hedge" },
    { x: 1560, y: GROUND_Y - 110, w: 112, h: 16, kind: "hedge" },
    { x: 1740, y: GROUND_Y - 196, w: 96,  h: 16, kind: "stone" },
    { x: 1920, y: GROUND_Y - 100, w: 96,  h: 16, kind: "hedge" },
    { x: 2300, y: GROUND_Y - 96,  w: 112, h: 16, kind: "hedge" },
    { x: 2480, y: GROUND_Y - 176, w: 96,  h: 16, kind: "stone" },
    { x: 2680, y: GROUND_Y - 96,  w: 112, h: 16, kind: "hedge" },
    { x: 2880, y: GROUND_Y - 166, w: 96,  h: 16, kind: "stone" },
    { x: 3060, y: GROUND_Y - 96,  w: 96,  h: 16, kind: "hedge" },
    { x: 3300, y: GROUND_Y - 136, w: 96,  h: 16, kind: "hedge" },
    { x: 3480, y: GROUND_Y - 190, w: 96,  h: 16, kind: "stone" },
    { x: 3660, y: GROUND_Y - 105, w: 96,  h: 16, kind: "hedge" },
    { x: 3920, y: GROUND_Y - 105, w: 96,  h: 16, kind: "hedge" },
    { x: 4100, y: GROUND_Y - 140, w: 96,  h: 16, kind: "stone" },
    { x: 4260, y: GROUND_Y - 170,  w: 96,  h: 16, kind: "hedge" },
  ];

  const items = [
    { x: 320,  y: GROUND_Y - 100, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 490,  y: GROUND_Y - 164, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 870,  y: GROUND_Y - 112, w: 16, h: 16, kind: "letter", taken: false },
    { x: 1040, y: GROUND_Y - 202, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 1240, y: GROUND_Y - 112, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 1610, y: GROUND_Y - 132, w: 16, h: 16, kind: "letter", taken: false },
    { x: 1780, y: GROUND_Y - 212, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 1960, y: GROUND_Y - 132, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 2340, y: GROUND_Y - 112, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 2520, y: GROUND_Y - 192, w: 16, h: 16, kind: "letter", taken: false },
    { x: 2720, y: GROUND_Y - 112, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 2920, y: GROUND_Y - 182, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 3100, y: GROUND_Y - 112, w: 16, h: 16, kind: "letter", taken: false },
    { x: 3340, y: GROUND_Y - 152, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 3520, y: GROUND_Y - 222, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 3700, y: GROUND_Y - 132, w: 16, h: 16, kind: "letter", taken: false },
    { x: 3960, y: GROUND_Y - 130, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 4140, y: GROUND_Y - 160, w: 16, h: 16, kind: "rose",   taken: false },
    { x: 4300, y: GROUND_Y - 190, w: 16, h: 16, kind: "rose",   taken: false },
  ];

  const enemies = [
    { x: 1100, y: GROUND_Y - 36, w: 24, h: 36, vx: -0.6,
      minX: 940,  maxX: 1380, alive: true, stunTimer: 0,
      deathTimer: 0, deathVy: 0, deathVx: 0 },
    { x: 2400, y: GROUND_Y - 36, w: 24, h: 36, vx: -0.6,
      minX: 2260, maxX: 2820, alive: true, stunTimer: 0,
      deathTimer: 0, deathVy: 0, deathVx: 0 },
    { x: 4020, y: GROUND_Y - 36, w: 24, h: 36, vx: -0.7,
      minX: 3880, maxX: 4220, alive: true, stunTimer: 0,
      deathTimer: 0, deathVy: 0, deathVx: 0 },
  ];

  const teresa = {
    x: 4350, y: GROUND_Y - 46,
    w: 22, h: 46,
    swayFrame: 0,
  };

  const dialogs = [
    { x: 100,  name: "Jacopo",
      text: "Eccomi al cancello del giardino. Il cuore mi batte come quando da fanciullo entravo nel bosco di Vallombrosa." },
    { x: 1560, name: "Jacopo",
      text: "Odoardo… sempre tra noi. Egli ha la sua mano, ma non avrà mai la sua anima." },
    { x: 3400, name: "Jacopo",
      text: "I miei passi non temono più la notte. Ogni foglia, ogni stella, mi parla di lei." },
    { x: 4150, name: "Jacopo",
      text: "La vedo, là sotto il pergolato. Teresa…" },
  ];

  const monuments = [
    {
      x: 180, kind: "gate",
      title: "Il giardino dei Colli Euganei",
      text: "« Da que' colli onde Venere mira la dolce sera scendere, io penso a te. Quanti pensieri, quante immagini di lei! »",
      read: false,
    },
    {
      x: 560, kind: "rosebush",
      title: "Lettera, 14 maggio 1798 — l'orto",
      text: "« Eravamo nell'orto. Sua madre travagliava in non so che cucitura: io le stava sotto, leggendole in piedi la Chioma di Berenice del Callimaco. »",
      read: false,
    },
    {
      x: 1620, kind: "bench",
      title: "Sotto il vecchio tiglio",
      text: "« Ovunque io rivolga lo sguardo, m'incontro nelle sue tracce: questo Cielo, questi alberi, queste rose son l'imagine sua. »",
      read: false,
    },
    {
      x: 2100, kind: "statue",
      title: "La statua nel boschetto",
      text: "« Le farfalle volavano sussurrando intorno a noi: ed essa palpitava ancora del recente turbamento. Io non osava parlare. »",
      read: false,
    },
    {
      x: 2980, kind: "fountain",
      title: "La fontana — la mano tremante",
      text: "« Stesi la mano per cogliere quella di Teresa, ma ella ritrasse il braccio; ed io le presi la mano: era tremante; le nostre dita si strinsero. »",
      read: false,
    },
    {
      x: 3560, kind: "shrine",
      title: "Edicola — il bacio fugace",
      text: "« Tutto a un tratto Teresa si chinò, e mi diè un bacio. Mi sentii fremere tutta la persona; un fremito celeste mi si sparse per le ossa. »",
      read: false,
    },
    {
      x: 4260, kind: "wellhead",
      title: "Pozzo — l'addio inevitabile",
      text: "« Io non sono più degno di lei. Essa è promessa ad altri. Né l'amore può cancellare i giuramenti del padre. Teresa! ah, Teresa! »",
      read: false,
    },
  ];

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }

  function drawJacopo(x, y, frame, facing, hurt) {
    ctx.save();
    if (facing === -1) {
      ctx.translate(x + 22, y);
      ctx.scale(-1, 1);
      x = 0; y = 0;
    } else {
      ctx.translate(x, y);
      x = 0; y = 0;
    }

    if (hurt && Math.floor(game.time / 4) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    px(4, 0,  14, 4, "#0d0805");
    px(2, 2,  18, 4, "#1a1108");
    px(2, 4,  4,  6, "#1a1108");
    px(16,4,  4,  6, "#1a1108");
    px(6, 6,  10, 8, "#f4d4ae");
    px(6, 14, 10, 2, "#e6c098");
    px(8, 9,  2, 2, "#0a0604");
    px(13, 9, 2, 2, "#0a0604");
    px(10, 12, 4, 1, "#7a2418");
    px(7, 16, 8, 3, "#f8eed0");
    px(8, 19, 6, 2, "#e0d4a8");
    px(4, 19, 14, 12, "#3a1f15");
    px(3, 21, 2,  10, "#2a1510");
    px(17,21, 2,  10, "#2a1510");
    px(10, 22, 2, 2, "#c9a04a");
    px(10, 26, 2, 2, "#c9a04a");
    px(4, 30, 6, 4, "#2a1510");
    px(12,30, 6, 4, "#2a1510");
    const swing = (frame % 2 === 0) ? 0 : 2;
    px(6,  31, 4, 8 + swing, "#1f1812");
    px(12, 31, 4, 8 - swing, "#1f1812");
    px(5,  39 + swing, 6, 5, "#0a0604");
    px(11, 39 - swing, 6, 5, "#0a0604");

    ctx.restore();
  }

  function drawTeresa(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);
    const s = Math.sin(frame * 0.05) * 1;
    px(4 + s, 0, 14, 4, "#3a1810");
    px(2 + s, 2, 18, 8, "#5a2818");
    px(1 + s, 6, 4, 12, "#5a2818");
    px(17 + s, 6, 4, 12, "#5a2818");
    px(7 + s, 0, 4, 2, "#e87090");
    px(6 + s, 2, 6, 1, "#e87090");
    px(6 + s, 6, 10, 8, "#fae0c2");
    px(8 + s,  9, 2, 2, "#3a1810");
    px(13 + s, 9, 2, 2, "#3a1810");
    px(10 + s, 12, 4, 1, "#a83048");
    px(9, 14, 4, 2, "#fae0c2");
    px(3, 16, 16, 4, "#fef2d2");
    px(3, 20, 16, 1, "#e87090");
    px(2, 21, 18, 18, "#fef2d2");
    px(2, 21, 1, 18, "#e6d4a8");
    px(19,21, 1, 18, "#e6d4a8");
    px(1, 39, 20, 3, "#e6d4a8");
    px(1, 42, 20, 2, "#fef2d2");
    px(8, 44, 3, 2, "#fae0c2");
    px(11,44, 3, 2, "#fae0c2");

    ctx.restore();
  }

  function drawOdoardo(x, y, frame, facing, stunned, dying) {
    ctx.save();
    if (dying) {
      ctx.translate(x + 12, y + 20);
      const spin = (frame * 0.12) % (Math.PI * 2);
      ctx.rotate(Math.PI + Math.sin(spin) * 0.4);
      ctx.translate(-12, -20);
      x = 0; y = 0;
    } else if (facing === -1) {
      ctx.translate(x + 24, y);
      ctx.scale(-1, 1);
      x = 0; y = 0;
    } else {
      ctx.translate(x, y);
      x = 0; y = 0;
    }
    if (stunned && !dying) {
      ctx.translate(0, 8);
      ctx.scale(1, 0.8);
    }

    px(2, 0,  20, 3, "#0a0808");
    px(0, 3,  24, 3, "#0a0808");
    px(11, 1, 2,  2, "#c9a04a");
    px(6, 6,  12, 8, "#e0b890");
    px(8, 9,  2, 2, "#0a0604");
    px(14,9,  2, 2, "#0a0604");
    px(7, 8,  4, 1, "#3a1810");
    px(13,8,  4, 1, "#3a1810");
    px(8, 12, 8, 1, "#3a1810");
    px(7, 13, 2, 1, "#3a1810");
    px(15,13, 2, 1, "#3a1810");
    px(10,14, 4, 2, "#e0b890");
    px(3, 16, 18, 14, "#1a2840");
    px(2, 16, 4,  3, "#c9a04a");
    px(18,16, 4,  3, "#c9a04a");
    px(8,  18, 1, 1, "#c9a04a");
    px(15, 18, 1, 1, "#c9a04a");
    px(8,  21, 1, 1, "#c9a04a");
    px(15, 21, 1, 1, "#c9a04a");
    px(8,  24, 1, 1, "#c9a04a");
    px(15, 24, 1, 1, "#c9a04a");
    px(3, 22, 18, 2, "#9b2d20");
    px(3, 28, 18, 2, "#0a0604");
    px(11,28, 2,  2, "#c9a04a");
    const swing = (frame % 2 === 0) ? 0 : 2;
    px(5,  30, 5, 6 + swing, "#e6d4a8");
    px(13, 30, 5, 6 - swing, "#e6d4a8");
    px(4,  35 + swing, 7, 5, "#0a0604");
    px(12, 35 - swing, 7, 5, "#0a0604");

    if (stunned) {
      ctx.fillStyle = "#fff4d0";
      const t = game.time * 0.2;
      for (let i = 0; i < 3; i++) {
        const ang = t + i * 2.1;
        const sx = 12 + Math.cos(ang) * 6;
        const sy = -4 + Math.sin(ang) * 2;
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    ctx.restore();
  }

  function drawRose(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(frame * 0.08) * 1.2;
    ctx.translate(0, bob);
    px(7, 8, 2, 8, "#3a6a36");
    px(5, 11, 2, 2, "#3a6a36");
    px(9, 13, 2, 2, "#3a6a36");
    px(4, 2, 8, 6, "#9b2d20");
    px(3, 3, 1, 4, "#7a2018");
    px(12,3, 1, 4, "#7a2018");
    px(5, 1, 6, 1, "#c93a28");
    px(6, 4, 4, 2, "#e85040");
    ctx.fillStyle = "rgba(255,120,100,0.18)";
    ctx.fillRect(0, 0, 16, 16);
    ctx.restore();
  }

  function drawLetter(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(frame * 0.08 + 1.3) * 1.2;
    ctx.translate(0, bob);
    px(1, 3, 14, 11, "#fef2d2");
    px(1, 3, 14, 1,  "#e6d4a8");
    px(1, 13,14, 1,  "#c9b078");
    px(3, 6, 10, 1, "#3a2418");
    px(3, 8, 8,  1, "#3a2418");
    px(3, 10,9,  1, "#3a2418");
    px(6, 11, 4, 3, "#9b2d20");
    px(7, 12, 2, 1, "#c93a28");
    ctx.restore();
  }

  function drawHeart(x, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const s = size;
    ctx.fillStyle = "#ff4060";
    ctx.fillRect(x,         y + s,     s,     s);
    ctx.fillRect(x + s,     y + 2 * s, s,     s);
    ctx.fillRect(x + 2 * s, y + s,     s,     s);
    ctx.fillRect(x + s * 3, y,         s,     s * 2);
    ctx.fillRect(x + s * 4, y + s,     s,     s);
    ctx.fillRect(x + s * 5, y,         s,     s * 2);
    ctx.fillRect(x + s * 6, y + s,     s,     s);
    ctx.fillRect(x + s * 5, y + 2 * s, s,     s);
    ctx.fillRect(x + s * 4, y + 3 * s, s,     s);
    ctx.fillRect(x + s * 3, y + 4 * s, s,     s);
    ctx.fillRect(x + s * 2, y + 3 * s, s,     s);
    ctx.fillRect(x + s,     y + 2 * s, s,     s);
    ctx.fillStyle = "#ffb0c0";
    ctx.fillRect(x + s,     y + s,     s, s);
    ctx.fillRect(x + s * 2, y,         s, s);
    ctx.restore();
  }

  const stars = [];
  for (let i = 0; i < 220; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * (GROUND_Y - 200),
      tw: Math.random() * Math.PI * 2,
      bright: Math.random() > 0.7,
    });
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.skyTop);
    g.addColorStop(0.5, COL.skyMid);
    g.addColorStop(1, COL.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (const st of stars) {
      const t = Math.sin(game.time * 0.04 + st.tw);
      ctx.fillStyle = st.bright ? COL.starA : COL.starB;
      ctx.globalAlpha = 0.5 + 0.5 * Math.max(0, t);
      ctx.fillRect(st.x, st.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    const mx = 1560, my = 110, mr = 80;
    px(mx + 4, my,        mr - 8, mr,     COL.moon);
    px(mx,     my + 4,    mr,     mr - 8, COL.moon);
    px(mx + 16, my + 16, 8, 8, COL.moonShade);
    px(mx + 40, my + 28, 6, 6, COL.moonShade);
    px(mx + 24, my + 40, 7, 7, COL.moonShade);
    px(mx + 12, my + 44, 4, 4, COL.moonShade);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = COL.moon;
    ctx.beginPath();
    ctx.arc(mx + mr / 2, my + mr / 2, mr * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const cam = game.camera;
    drawTiledHill(hillFarTile, cam * 0.2);
    drawTiledHill(hillMidTile, cam * 0.4);
  }

  function makeOffscreen(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").imageSmoothingEnabled = false;
    return c;
  }

  function buildHillTile(period, baseY, amp, color) {
    const tw = period * 2;
    const tile = makeOffscreen(tw, H);
    const tctx = tile.getContext("2d");
    tctx.imageSmoothingEnabled = false;
    const f1 = (2 * Math.PI * 3) / tw;
    const f2 = (2 * Math.PI * 1) / tw;
    tctx.fillStyle = color;
    tctx.beginPath();
    tctx.moveTo(0, H);
    for (let x = 0; x <= tw; x += 4) {
      const y = baseY + Math.sin(x * f1) * amp * 0.4
              + Math.sin(x * f2) * amp * 0.6;
      tctx.lineTo(x, y);
    }
    tctx.lineTo(tw, H);
    tctx.closePath();
    tctx.fill();
    return tile;
  }

  const hillFarTile = buildHillTile(220, GROUND_Y - 180, 80, COL.hillFar);
  const hillMidTile = buildHillTile(180, GROUND_Y - 100, 100, COL.hillMid);

  function drawTiledHill(tile, offset) {
    const tw = tile.width;
    let x = -((offset % tw + tw) % tw);
    while (x < W) {
      ctx.drawImage(tile, Math.floor(x), 0);
      x += tw;
    }
  }

  const trees = [
    { x: 150 }, { x: 380 }, { x: 940 },
    { x: 1280 }, { x: 1880 },
    { x: 2360 }, { x: 2640 }, { x: 2900 }, { x: 3120 },
    { x: 3300 }, { x: 3580 }, { x: 4080 },
    { x: 4220 }, { x: 4500 }, { x: 4720 }, { x: 4900 },
  ];

  function drawTree(wx, frame) {
    const sx = wx - game.camera;
    if (sx < -80 || sx > W + 80) return;
    const sway = Math.sin(frame * 0.02 + wx) * 1;
    px(sx - 4, GROUND_Y - 60, 8, 60, COL.trunk);
    px(sx - 6, GROUND_Y - 4, 12, 8, COL.dirtDark);
    px(sx - 24 + sway, GROUND_Y - 90, 48, 30, COL.leaves);
    px(sx - 18 + sway, GROUND_Y - 100, 36, 20, COL.leavesHi);
    px(sx - 28 + sway, GROUND_Y - 78, 56, 16, COL.leaves);
    px(sx - 20 + sway, GROUND_Y - 96, 12, 6, "rgba(255,244,208,0.15)");
  }

  function drawMonument(m, frame) {
    const sx = m.x - game.camera;
    if (sx < -80 || sx > W + 80) return;
    switch (m.kind) {
      case "gate":     drawGate(sx); break;
      case "rosebush": drawRosebush(sx, frame); break;
      case "bench":    drawBench(sx); break;
      case "statue":   drawStatue(sx); break;
      case "fountain": drawFountain(sx, frame); break;
      case "shrine":   drawShrine(sx, frame); break;
      case "wellhead": drawWellhead(sx); break;
    }
    if (m.read) {
      ctx.fillStyle = "rgba(217,164,65,0.08)";
      ctx.fillRect(sx - 24, GROUND_Y - 70, 48, 70);
    }
    if (game.nearMonument === m && game.state === STATE.PLAY) {
      drawReadPrompt(sx, GROUND_Y - 90, frame);
    }
  }

  function drawReadPrompt(sx, sy, frame) {
    const bob = Math.sin(frame * 0.12) * 2;
    ctx.fillStyle = "rgba(10,8,12,0.85)";
    ctx.fillRect(sx - 18, sy + bob, 36, 22);
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(sx - 18, sy + bob, 36, 2);
    ctx.fillRect(sx - 18, sy + bob + 20, 36, 2);
    ctx.fillRect(sx - 18, sy + bob, 2, 22);
    ctx.fillRect(sx + 16, sy + bob, 2, 22);
    ctx.fillStyle = "#fef2d2";
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", sx, sy + bob + 12);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(sx - 2, sy + bob + 22, 4, 2);
    ctx.fillRect(sx - 1, sy + bob + 24, 2, 2);
  }

  function drawGate(sx) {
    const baseY = GROUND_Y;
    px(sx - 30, baseY - 80, 8, 80, "#5a4a3a");
    px(sx + 22, baseY - 80, 8, 80, "#5a4a3a");
    px(sx - 32, baseY - 84, 12, 4, "#7a6a58");
    px(sx + 20, baseY - 84, 12, 4, "#7a6a58");
    px(sx - 30, baseY - 90, 8, 6, "#3a3228");
    px(sx + 22, baseY - 90, 8, 6, "#3a3228");
    px(sx - 22, baseY - 70, 44, 70, "rgba(20,16,12,0.4)");
    for (let i = -22; i <= 18; i += 8) {
      px(sx + i, baseY - 70, 2, 70, "#1a1410");
    }
    px(sx - 22, baseY - 70, 44, 2, "#1a1410");
    px(sx - 22, baseY - 36, 44, 2, "#1a1410");
    px(sx - 14, baseY - 76, 28, 4, "#1a1410");
    px(sx - 6,  baseY - 80, 12, 4, "#1a1410");
  }

  function drawRosebush(sx, frame) {
    const baseY = GROUND_Y;
    px(sx - 22, baseY - 26, 44, 26, COL.leaves);
    px(sx - 18, baseY - 32, 36, 8,  COL.leaves);
    px(sx - 14, baseY - 36, 28, 6,  COL.leaves);
    px(sx - 16, baseY - 28, 6,  4,  COL.leavesHi);
    px(sx + 4,  baseY - 28, 6,  4,  COL.leavesHi);
    const roses = [[-16,-22],[-4,-30],[8,-22],[16,-14],[-12,-10],[2,-6]];
    for (const [dx, dy] of roses) {
      const bob = Math.sin(frame * 0.06 + dx) * 1;
      px(sx + dx, baseY + dy + bob, 4, 4, "#9b2d20");
      px(sx + dx + 1, baseY + dy + bob + 1, 2, 2, "#e85040");
    }
  }

  function drawBench(sx) {
    const baseY = GROUND_Y;
    px(sx - 22, baseY - 16, 6, 16, "#6a5848");
    px(sx + 16, baseY - 16, 6, 16, "#6a5848");
    px(sx - 28, baseY - 22, 56, 6, "#8a7868");
    px(sx - 28, baseY - 22, 56, 2, "#aa9888");
    px(sx - 28, baseY - 44, 56, 4, "#8a7868");
    px(sx - 26, baseY - 40, 4, 18, "#6a5848");
    px(sx + 22, baseY - 40, 4, 18, "#6a5848");
    px(sx - 6, baseY - 26, 14, 4, "#e6d4a8");
    px(sx - 5, baseY - 24, 6,  2, "#3a2418");
    px(sx + 1, baseY - 24, 6,  2, "#3a2418");
    px(sx,     baseY - 26, 1,  4, "#6a5234");
  }

  function drawStatue(sx) {
    const baseY = GROUND_Y;
    px(sx - 14, baseY - 10, 28, 10, "#6a5848");
    px(sx - 16, baseY - 14, 32, 4,  "#8a7868");
    px(sx - 12, baseY - 30, 24, 16, "#7a6858");
    px(sx - 14, baseY - 32, 28, 4,  "#8a7868");
    px(sx - 8,  baseY - 70, 16, 12, "#d4c8b0");
    px(sx - 6,  baseY - 66, 4,  2,  "#a89878");
    px(sx + 2,  baseY - 66, 4,  2,  "#a89878");
    px(sx - 10, baseY - 58, 20, 6,  "#d4c8b0");
    px(sx - 12, baseY - 52, 24, 22, "#d4c8b0");
    px(sx - 14, baseY - 44, 28, 14, "#cabea0");
    px(sx - 12, baseY - 12, 4, 4, COL.leaves);
    px(sx + 8,  baseY - 12, 4, 4, COL.leaves);
  }

  function drawFountain(sx, frame) {
    const baseY = GROUND_Y;
    px(sx - 32, baseY - 14, 64, 14, "#7a6a58");
    px(sx - 30, baseY - 12, 60, 4,  "#3a4858");
    px(sx - 28, baseY - 12, 56, 2,  "#5a7888");
    px(sx - 4,  baseY - 40, 8,  26, "#8a7868");
    px(sx - 8,  baseY - 44, 16, 4,  "#aa9888");
    px(sx - 12, baseY - 50, 24, 8,  "#8a7868");
    px(sx - 10, baseY - 48, 20, 2,  "#5a7888");
    const sp = Math.sin(frame * 0.1) * 2;
    px(sx - 1, baseY - 60 + sp, 2, 12, "#aac8d8");
    px(sx - 3, baseY - 56 + sp, 6, 2,  "#aac8d8");
    if (frame % 8 < 4) {
      px(sx - 8, baseY - 44, 1, 1, "#aac8d8");
      px(sx + 7, baseY - 44, 1, 1, "#aac8d8");
    }
  }

  function drawShrine(sx, frame) {
    const baseY = GROUND_Y;
    px(sx - 16, baseY - 6,  32, 6,  "#5a4a3a");
    px(sx - 14, baseY - 50, 28, 44, "#d4c8a0");
    px(sx - 14, baseY - 50, 28, 4,  "#a89878");
    px(sx - 16, baseY - 56, 32, 6,  "#7a3018");
    px(sx - 12, baseY - 62, 24, 6,  "#9b3818");
    px(sx - 8,  baseY - 66, 16, 4,  "#9b3818");
    px(sx - 8,  baseY - 42, 16, 24, "#2a1c16");
    px(sx - 1,  baseY - 30, 2,  10, "#fef2d2");
    const flicker = (Math.sin(frame * 0.4) + 1) * 0.5;
    px(sx - 1, baseY - 34 - Math.floor(flicker * 2), 2, 4, "#ffd060");
    px(sx,     baseY - 36 - Math.floor(flicker * 2), 1, 2, "#fff4d0");
    px(sx + 12, baseY - 30, 4, 16, COL.leaves);
    px(sx - 16, baseY - 24, 4, 12, COL.leaves);
  }

  function drawWellhead(sx) {
    const baseY = GROUND_Y;
    px(sx - 24, baseY - 18, 48, 18, "#7a6a58");
    px(sx - 22, baseY - 16, 44, 4,  "#1a1410");
    px(sx - 26, baseY - 22, 52, 4,  "#8a7868");
    for (let i = -22; i < 22; i += 8) {
      px(sx + i, baseY - 18, 1, 18, "#5a4a3a");
    }
    px(sx - 16, baseY - 50, 4, 32, "#5a3a22");
    px(sx + 12, baseY - 50, 4, 32, "#5a3a22");
    px(sx - 18, baseY - 54, 36, 4, "#5a3a22");
    px(sx - 1, baseY - 50, 1, 28, "#a89878");
    px(sx - 4, baseY - 22, 8, 4, "#3a2418");
    px(sx - 4, baseY - 22, 1, 4, "#1a1410");
    px(sx + 3, baseY - 22, 1, 4, "#1a1410");
  }

  function drawPlatforms() {
    for (const p of platforms) {
      const sx = p.x - game.camera;
      if (sx + p.w < -10 || sx > W + 10) continue;

      if (p.kind === "ground") {
        ctx.fillStyle = COL.grass;
        ctx.fillRect(sx, p.y, p.w, 8);
        ctx.fillStyle = COL.grassDark;
        for (let i = 0; i < p.w; i += 8) {
          ctx.fillRect(sx + i, p.y, 4, 4);
        }
        ctx.fillStyle = "#5a8a3a";
        for (let i = 4; i < p.w; i += 12) {
          ctx.fillRect(sx + i, p.y + 4, 2, 2);
        }
        ctx.fillStyle = COL.dirt;
        ctx.fillRect(sx, p.y + 8, p.w, p.h - 8);
        ctx.fillStyle = COL.dirtDark;
        for (let row = 0; row < (p.h - 8) / 16; row++) {
          for (let col = 0; col < p.w; col += 32) {
            const off = (row % 2) * 16;
            ctx.fillRect(sx + col + off, p.y + 8 + row * 16, 1, 16);
          }
          ctx.fillRect(sx, p.y + 8 + row * 16, p.w, 1);
        }
        ctx.fillStyle = "#7a5234";
        ctx.fillRect(sx + 20, p.y + 20, 3, 2);
        ctx.fillRect(sx + 60, p.y + 36, 2, 2);
      } else if (p.kind === "hedge") {
        ctx.fillStyle = COL.leaves;
        ctx.fillRect(sx, p.y, p.w, p.h);
        ctx.fillStyle = COL.leavesHi;
        for (let i = 0; i < p.w; i += 6) {
          ctx.fillRect(sx + i, p.y, 3, 3);
        }
        ctx.fillStyle = "#1a2a14";
        ctx.fillRect(sx, p.y + p.h - 2, p.w, 2);
      } else if (p.kind === "stone") {
        ctx.fillStyle = COL.stone;
        ctx.fillRect(sx, p.y, p.w, p.h);
        ctx.fillStyle = COL.stoneDark;
        for (let i = 0; i < p.w; i += 16) {
          ctx.fillRect(sx + i, p.y, 1, p.h);
        }
        ctx.fillRect(sx, p.y + p.h - 1, p.w, 1);
        ctx.fillStyle = "#9a8a78";
        ctx.fillRect(sx, p.y, p.w, 1);
      }
    }
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function moveAndCollide(ent) {
    ent.x += ent.vx;
    for (const p of platforms) {
      if (rectsOverlap(ent, p)) {
        if (ent.vx > 0) ent.x = p.x - ent.w;
        else if (ent.vx < 0) ent.x = p.x + p.w;
        ent.vx = 0;
      }
    }
    if (ent.x < 0) ent.x = 0;
    if (ent.x + ent.w > WORLD_W) ent.x = WORLD_W - ent.w;

    ent.y += ent.vy;
    ent.onGround = false;
    for (const p of platforms) {
      if (rectsOverlap(ent, p)) {
        if (ent.vy > 0) {
          ent.y = p.y - ent.h;
          ent.vy = 0;
          ent.onGround = true;
        } else if (ent.vy < 0) {
          ent.y = p.y + p.h;
          ent.vy = 0;
        }
      }
    }
  }

  function update() {
    game.time++;

    if (game.shake > 0) game.shake--;

    game.zoom += (game.zoomTarget - game.zoom) * 0.05;
    if (Math.abs(game.zoom - game.zoomTarget) < 0.005) game.zoom = game.zoomTarget;

    if (game.state === STATE.PLAY) {
      updatePlayer();
      updateEnemies();
      updateItems();
      updateCamera();
      findNearMonument();
      checkMonumentInteraction();
      checkDialogs();
      checkTeresa();
      if (player.invuln > 0) player.invuln--;
    } else if (game.state === STATE.KISS) {
      updateKissScene();
    }

    for (const k in keys) {
      if (k.endsWith("_pressed")) keys[k] = false;
    }
  }

  function updatePlayer() {
    let move = 0;
    if (isDown(KEY_LEFT))  move -= 1;
    if (isDown(KEY_RIGHT)) move += 1;

    const speedCap = game.flyMode ? MOVE_SPEED * 1.6 : MOVE_SPEED;
    const accel    = game.flyMode ? 1.0 : 0.7;
    if (move !== 0) {
      player.vx += move * accel;
      player.facing = move;
    }
    player.vx *= FRICTION;
    if (Math.abs(player.vx) > speedCap) player.vx = speedCap * Math.sign(player.vx);
    if (Math.abs(player.vx) < 0.05) player.vx = 0;

    if (game.flyMode) {
      const flySpeed = 5;
      let dy = 0;
      if (isDown(KEY_JUMP)) dy -= 1;
      if (keys.ShiftLeft || keys.ShiftRight) dy += 1;
      player.vy = dy * flySpeed;
      moveAndCollide(player);
      if (player.y > H - player.h) {
        player.y = H - player.h;
        player.vy = 0;
      }
      if (game.time % 4 === 0 && (player.vx !== 0 || player.vy !== 0)) {
        particles.push({
          x: player.x + player.w / 2,
          y: player.y + player.h - 4,
          vx: -player.vx * 0.3,
          vy: -player.vy * 0.2 + 0.5,
          life: 22, maxLife: 22,
          color: "#aac8d8", size: 2,
        });
      }
      player.walkFrame = (Math.floor(game.time / 6) % 2);
      return;
    }

    const jumpPressed = KEY_JUMP.some(k => keys[k + "_pressed"]);
    if (jumpPressed && player.onGround) {
      player.vy = JUMP_VEL;
      player.onGround = false;
      SFX.jump();
    }

    player.vy += GRAVITY;
    if (player.vy > 14) player.vy = 14;

    moveAndCollide(player);

    if (player.y > H + 80) {
      hurtPlayer(true);
    }

    if (player.onGround && Math.abs(player.vx) > 0.3) {
      player.walkTimer++;
      if (player.walkTimer > 7) {
        player.walkTimer = 0;
        player.walkFrame = (player.walkFrame + 1) % 2;
      }
    } else {
      player.walkFrame = 0;
    }
  }

  function updateEnemies() {
    for (const e of enemies) {
      if (!e.alive) {
        if (e.deathTimer > 0) {
          e.deathTimer--;
          e.deathVy += GRAVITY;
          e.x += e.deathVx;
          e.y += e.deathVy;
        }
        continue;
      }

      e.x += e.vx;
      if (e.x < e.minX) { e.x = e.minX; e.vx *= -1; }
      if (e.x + e.w > e.maxX) { e.x = e.maxX - e.w; e.vx *= -1; }

      e.y = GROUND_Y - e.h;

      if (player.invuln === 0 && rectsOverlap(player, e)) {
        const playerBottom = player.y + player.h;
        if (player.vy > 0 && playerBottom - e.y < 18) {
          killEnemy(e);
          player.vy = JUMP_VEL * 0.75;
        } else {
          hurtPlayer(false);
        }
      }
    }
  }

  function killEnemy(e) {
    e.alive = false;
    e.deathTimer = 90;
    e.deathVy = -8;
    e.deathVx = (Math.random() - 0.5) * 3;
    e.vx = 0;
    SFX.stomp();
    spawnPuff(e.x + e.w / 2, e.y + e.h / 2);
    game.flashHearts.push({
      x: e.x + e.w / 2 - 4,
      y: e.y - 6,
      vx: 0,
      vy: -1.2,
      life: 60,
      maxLife: 60,
      size: 1,
    });
  }

  function updateItems() {
    for (const it of items) {
      if (it.taken) continue;
      if (rectsOverlap(player, it)) {
        it.taken = true;
        if (it.kind === "rose") {
          game.pickedRoses++;
          SFX.rose();
        } else {
          game.pickedLetters++;
          SFX.letter();
        }
        spawnSparkle(it.x + it.w / 2, it.y + it.h / 2);
        updateHud();
      }
    }
  }

  function updateCamera() {
    if (game.cameraTargetLock !== null) {
      const dx = game.cameraTargetLock - game.camera;
      game.camera += dx * 0.06;
      return;
    }
    const target = player.x + player.w / 2 - W / 2;
    game.camera += (target - game.camera) * 0.12;
    if (game.camera < 0) game.camera = 0;
    if (game.camera > WORLD_W - W) game.camera = WORLD_W - W;
  }

  function checkDialogs() {
    for (let i = 0; i < dialogs.length; i++) {
      const d = dialogs[i];
      if (game.triggeredDialogs.has(i)) continue;
      if (Math.abs((player.x + player.w / 2) - d.x) < 20) {
        game.triggeredDialogs.add(i);
        showDialog(d.name, d.text);
      }
    }
  }

  function findNearMonument() {
    const cx = player.x + player.w / 2;
    let best = null;
    let bestDist = 36;
    for (const m of monuments) {
      const d = Math.abs(m.x - cx);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    game.nearMonument = best;
  }

  function checkMonumentInteraction() {
    if (!game.nearMonument) return;
    const pressed = keys["KeyE_pressed"] || keys["Enter_pressed"];
    if (!pressed) return;
    const m = game.nearMonument;
    if (!m.read) {
      m.read = true;
      game.readMemories++;
      updateHud();
    }
    showDialog(m.title, m.text, true);
    keys["KeyE_pressed"] = false;
    keys["Enter_pressed"] = false;
  }

  function checkTeresa() {
    const dx = (player.x + player.w / 2) - (teresa.x + teresa.w / 2);
    if (Math.abs(dx) < 36 && player.onGround) {
      if (game.readMemories < monuments.length) {
        if (!game.warnedNotEnoughMemories) {
          game.warnedNotEnoughMemories = true;
          const missing = monuments.length - game.readMemories;
          showDialog(
            "Teresa",
            `« Jacopo, non sei ancora pronto. Torna a me quando avrai raccolto ogni memoria del nostro giardino. ` +
            `Ti ${missing === 1 ? "manca" : "mancano"} ancora ${missing} ${missing === 1 ? "ricordo" : "ricordi"}. »`,
            true
          );
        }
        return;
      }
      startKissScene();
    } else if (Math.abs(dx) > 200) {
      game.warnedNotEnoughMemories = false;
    }
  }

  function startKissScene() {
    game.state = STATE.KISS;
    game.kissTimer = 0;
    player.x = teresa.x - 28;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    const center = (player.x + teresa.x) / 2;
    game.cameraTargetLock = center - W / 2 + 20;
    if (game.cameraTargetLock < 0) game.cameraTargetLock = 0;
    if (game.cameraTargetLock > WORLD_W - W) game.cameraTargetLock = WORLD_W - W;
    game.camera = game.cameraTargetLock;
    game.zoomTarget = 10;
    for (let i = 0; i < 6; i++) spawnHeart();
    SFX.kiss();
    if (game.cameraTargetLock < 0) game.cameraTargetLock = 0;
    if (game.cameraTargetLock > WORLD_W - W)
      game.cameraTargetLock = WORLD_W - W;
  }

  function updateKissScene() {
    game.kissTimer++;
    if (game.cameraTargetLock !== null) {
      game.camera += (game.cameraTargetLock - game.camera) * 0.06;
    }
    if (game.kissTimer % 14 === 0) spawnHeart();
    if (game.kissTimer === 180) {
      showKissOverlay();
    }
  }

  const particles = [];
  function spawnSparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        life: 30, maxLife: 30,
        color: Math.random() > 0.5 ? "#fff4d0" : "#d9a441",
        size: 2,
      });
    }
  }
  function spawnPuff(x, y) {
    for (let i = 0; i < 12; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 2 - 1,
        life: 24, maxLife: 24,
        color: "#9a8a78", size: 3,
      });
    }
  }
  function spawnHeart() {
    const cx = (player.x + teresa.x) / 2 + (Math.random() - 0.5) * 30;
    const cy = teresa.y + 10 + (Math.random() - 0.5) * 20;
    game.flashHearts.push({
      x: cx, y: cy,
      vy: -0.6 - Math.random() * 0.6,
      vx: (Math.random() - 0.5) * 0.6,
      life: 120, maxLife: 120,
      size: 1 + Math.floor(Math.random() * 2),
    });
  }

  function updateParticles() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life--;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (const h of game.flashHearts) {
      h.x += h.vx;
      h.y += h.vy;
      h.life--;
    }
    for (let i = game.flashHearts.length - 1; i >= 0; i--) {
      if (game.flashHearts[i].life <= 0) game.flashHearts.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - game.camera, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const h of game.flashHearts) {
      const a = Math.min(1, h.life / 60);
      drawHeart(h.x - game.camera, h.y, h.size, a);
    }
  }


  function hurtPlayer(fatal) {
    if (game.flyMode) return;
    if (player.invuln > 0 && !fatal) return;
    player.hp = fatal ? 0 : player.hp - 1;
    player.invuln = 90;
    player.vy = -7;
    player.vx = -player.facing * 4;
    SFX.hit();
    game.shake = 12;
    updateHud();
    if (player.hp <= 0) {
      gameOver();
    }
  }


  function render() {
    let shakeX = 0, shakeY = 0;
    if (game.shake > 0) {
      shakeX = (Math.random() - 0.5) * 6;
      shakeY = (Math.random() - 0.5) * 6;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawBackground();
    ctx.restore();

    ctx.save();
    ctx.translate(shakeX, shakeY);
    if (Math.abs(game.zoom - 1) > 0.001) {
      const focalScreenX = teresa.x -20 + teresa.w / 2 - game.camera;
      const focalScreenY = teresa.y + teresa.h / 2;
      ctx.translate(W / 2, H / 2);
      ctx.scale(game.zoom+1, game.zoom+1);
      ctx.translate(-focalScreenX, -focalScreenY);
    }

    for (const t of trees) drawTree(t.x, game.time);

    for (const m of monuments) drawMonument(m, game.time);

    if (game.state !== STATE.GAMEOVER) {
      drawTeresa(teresa.x - game.camera, teresa.y, game.time);
      drawPergola(teresa.x);
    }

    drawPlatforms();

    for (const it of items) {
      if (it.taken) continue;
      const sx = it.x - game.camera;
      if (sx < -20 || sx > W + 20) continue;
      if (it.kind === "rose") drawRose(sx, it.y, game.time);
      else drawLetter(sx, it.y, game.time);
    }

    for (const e of enemies) {
      if (!e.alive && e.deathTimer <= 0) continue;
      const sx = e.x - game.camera;
      if (sx < -60 || sx > W + 60) continue;
      const facing = e.vx < 0 ? -1 : 1;
      const dying = !e.alive;
      if (dying && e.deathTimer < 30) {
        ctx.save();
        ctx.globalAlpha = e.deathTimer / 30;
        drawOdoardo(sx, e.y, game.time, facing, false, true);
        ctx.restore();
      } else {
        drawOdoardo(sx, e.y, game.time, facing, e.stunTimer > 0, dying);
      }
    }

    if (game.state !== STATE.GAMEOVER) {
      drawJacopo(
        player.x - game.camera, player.y,
        player.walkFrame, player.facing,
        player.invuln > 0
      );
    }

    drawParticles();
    ctx.restore();

    drawVignette();
  }

  function drawPergola(wx) {
    const sx = wx - game.camera;
    if (sx < -120 || sx > W + 60) return;
    ctx.fillStyle = "#d4c8a0";
    ctx.fillRect(sx - 50, GROUND_Y - 110, 6, 110);
    ctx.fillRect(sx + 50, GROUND_Y - 110, 6, 110);
    ctx.fillStyle = "#a89878";
    ctx.fillRect(sx - 52, GROUND_Y - 110, 2, 110);
    ctx.fillRect(sx + 56, GROUND_Y - 110, 2, 110);
    ctx.fillStyle = "#d4c8a0";
    ctx.fillRect(sx - 60, GROUND_Y - 116, 124, 8);
    ctx.fillStyle = COL.leaves;
    for (let i = -56; i <= 56; i += 8) {
      ctx.fillRect(sx + i, GROUND_Y - 122, 6, 8);
    }
    ctx.fillStyle = COL.leavesHi;
    for (let i = -52; i <= 56; i += 12) {
      ctx.fillRect(sx + i, GROUND_Y - 124, 4, 4);
    }
    for (let i = -50; i <= 50; i += 16) {
      px(sx + i, GROUND_Y - 118, 4, 4, "#9b2d20");
      px(sx + i + 1, GROUND_Y - 117, 2, 2, "#e85040");
    }
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(W/2, H/2, H/3, W/2, H/2, H * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  const $ = (id) => document.getElementById(id);
  const introOverlay   = $("introOverlay");
  const kissOverlay    = $("kissOverlay");
  const endOverlay     = $("endOverlay");
  const gameOverOverlay = $("gameOverOverlay");
  const dialogBox      = $("dialogBox");
  const dialogName     = $("dialogName");
  const dialogText     = $("dialogText");

  function updateHud() {
    let hearts = "";
    for (let i = 0; i < 3; i++) {
      hearts += i < player.hp ? "♥ " : "♡ ";
    }
    $("hudHearts").textContent = hearts;
    $("hudRoses").textContent = game.pickedRoses;
    $("hudLetters").textContent = game.pickedLetters;
    const memEl = $("hudMemories");
    if (memEl) memEl.textContent = `${game.readMemories}/${monuments.length}`;
  }

  function showDialog(name, text, asQuote) {
    dialogName.textContent = name;
    dialogText.textContent = text;
    dialogText.classList.toggle("quote-text", !!asQuote);
    dialogBox.classList.remove("hidden");
    game.state = STATE.DIALOG;
  }
  function closeDialog() {
    dialogBox.classList.add("hidden");
    game.state = STATE.PLAY;
  }

  function showKissOverlay() {
    kissOverlay.classList.remove("hidden");
  }

  function showEndOverlay() {
    kissOverlay.classList.add("hidden");
    $("finalScore").textContent =
      `Hai raccolto ${game.pickedRoses} rose e ${game.pickedLetters} lettere.`;
    endOverlay.classList.remove("hidden");
    game.state = STATE.WIN;
  }

  function gameOver() {
    game.state = STATE.GAMEOVER;
    setTimeout(() => {
      gameOverOverlay.classList.remove("hidden");
    }, 600);
  }

  function startGame() {
    ensureAudio();
    introOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    kissOverlay.classList.add("hidden");
    dialogBox.classList.add("hidden");
    player.x = 60; player.y = GROUND_Y - 44;
    player.vx = 0; player.vy = 0;
    player.hp = 3; player.invuln = 0; player.facing = 1;
    game.camera = 0;
    game.cameraTargetLock = null;
    game.zoom = 1;
    game.zoomTarget = 1;
    game.pickedRoses = 0;
    game.pickedLetters = 0;
    game.readMemories = 0;
    game.nearMonument = null;
    game.warnedNotEnoughMemories = false;
    game.triggeredDialogs.clear();
    game.flashHearts.length = 0;
    particles.length = 0;
    items.forEach(i => i.taken = false);
    monuments.forEach(m => m.read = false);
    enemies.forEach(e => {
      e.alive = true;
      e.stunTimer = 0;
      e.deathTimer = 0;
      e.deathVy = 0;
      e.deathVx = 0;
      e.y = GROUND_Y - e.h;
    });
    enemies[0].x = 1100; enemies[0].vx = -0.6;
    enemies[1].x = 2400; enemies[1].vx = -0.6;
    enemies[2].x = 4020; enemies[2].vx = -0.7;
    updateHud();
    game.state = STATE.PLAY;
  }

  $("startBtn").addEventListener("click", startGame);
  $("retryBtn").addEventListener("click", startGame);
  $("replayBtn").addEventListener("click", startGame);
  $("endBtn").addEventListener("click", showEndOverlay);

  function loop() {
    update();
    updateParticles();
    render();
    requestAnimationFrame(loop);
  }

  updateHud();
  loop();
})();
