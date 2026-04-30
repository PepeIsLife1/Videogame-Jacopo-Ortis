(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = 880;
  const GRAVITY = 0.2;
  const JUMP_VEL = -8.5;
  const MOVE_SPEED = 2.0;
  const FRICTION = 0.8;
  const WORLD_W = 6000;

  const STATE = {
    INTRO:     "intro",
    PLAY:      "play",
    DIALOG:    "dialog",
    ENCOUNTER: "encounter",
    WIN:       "win",
    GAMEOVER:  "gameover",
  };

  const game = {
    state: STATE.INTRO,
    camera: 0,
    cameraTargetLock: null,
    time: 0,
    shake: 0,
    pickedCoins: 0,
    pickedScrolls: 0,
    readMemories: 0,
    triggeredDialogs: new Set(),
    nearMonument: null,
    warnedNotEnoughMemories: false,
    zoom: 1,
    zoomTarget: 1,
    inEncounter: false,
    encounterStep: 0,
    flyMode: false,
    cheatActive: false,
    cheatBuffer: "",
  };

  const keys = {};
  const KEY_LEFT    = ["ArrowLeft", "KeyA"];
  const KEY_RIGHT   = ["ArrowRight", "KeyD"];
  const KEY_JUMP    = ["Space", "ArrowUp", "KeyW"];
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
              ? "Modalità VOLO attivata. Spazio = sali, Shift = scendi."
              : "Modalità VOLO disattivata."
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
      "Space","KeyA","KeyD","KeyW","KeyX","Enter",
      "ShiftLeft","ShiftRight","KeyE"
    ].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys[e.code]) keys[e.code + "_pressed"] = true;
    keys[e.code] = true;

    if (KEY_CONFIRM.includes(e.code) && !dialogBox.classList.contains("hidden")) {
      closeDialog();
    }
  });

  addEventListener("keyup", (e) => { keys[e.code] = false; });

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { audioCtx = null; }
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
    coin:    () => { beep(1200, 0.05); setTimeout(() => beep(1600, 0.08), 50); },
    scroll:  () => { beep(660, 0.08); setTimeout(() => beep(880, 0.1), 70); },
    hit:     () => beep(120, 0.18, "sawtooth", 0.08),
    stomp:   () => beep(220, 0.1, "triangle", 0.06),
    parini:  () => {
      [392, 466, 587].forEach((f, i) =>
        setTimeout(() => beep(f, 0.22, "sine", 0.05), i * 180));
    },
  };

  const COL = {
    skyTop:    "#08091e",
    skyMid:    "#1a1838",
    skyLow:    "#3a2c50",
    moon:      "#e8e0c0",
    moonShade: "#a09878",
    starA:     "#fef2d2",
    starB:     "#aac8d8",
    snow:      "#f8f4ee",
    snowSoft:  "rgba(248,244,238,0.65)",
    hillFar:   "#0e1028",
    hillMid:   "#06081c",
    cobble:    "#5a525c",
    cobbleDk:  "#2a2228",
    brick:     "#6a3828",
    brickDk:   "#3a1810",
    roof:      "#5a3030",
    roofDk:    "#2a1010",
    leaves:    "#1a3018",
    leavesHi:  "#2a4828",
    trunk:     "#3a2418",
    lampGlow:  "rgba(255,210,140,0.16)",
    lampLight: "#ffd680",
    bldgFar:   "#10122a",
    bldgFarHi: "#1a1c34",
    duomo:     "#0a0c20",
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
  };

  const platforms = [
    { x: 0,    y: GROUND_Y, w: 720,  h: 200, kind: "ground" },
    { x: 820,  y: GROUND_Y, w: 700,  h: 200, kind: "ground" },
    { x: 1620, y: GROUND_Y, w: 880,  h: 200, kind: "ground" },
    { x: 2600, y: GROUND_Y, w: 600,  h: 200, kind: "ground" },
    { x: 3300, y: GROUND_Y, w: 720,  h: 200, kind: "ground" },
    { x: 4120, y: GROUND_Y, w: 580,  h: 200, kind: "ground" },
    { x: 4800, y: GROUND_Y, w: 1200, h: 200, kind: "ground" },

    { x: 280,  y: GROUND_Y - 100, w: 96,  h: 14, kind: "balcony" },
    { x: 480,  y: GROUND_Y - 130, w: 80,  h: 14, kind: "balcony" },
    { x: 920,  y: GROUND_Y - 110, w: 112, h: 14, kind: "balcony" },
    { x: 1340, y: GROUND_Y - 110, w: 96,  h: 14, kind: "balcony" },
    { x: 1740, y: GROUND_Y - 130, w: 112, h: 14, kind: "balcony" },
    { x: 1980, y: GROUND_Y - 100, w: 96,  h: 14, kind: "balcony" },
    { x: 2280, y: GROUND_Y - 130, w: 96,  h: 14, kind: "balcony" },
    { x: 2740, y: GROUND_Y - 110, w: 112, h: 14, kind: "balcony" },
    { x: 2960, y: GROUND_Y - 130, w: 96,  h: 14, kind: "balcony" },
    { x: 3380, y: GROUND_Y - 110, w: 96,  h: 14, kind: "balcony" },
    { x: 3580, y: GROUND_Y - 130, w: 112, h: 14, kind: "balcony" },
    { x: 3820, y: GROUND_Y - 100, w: 96,  h: 14, kind: "balcony" },
    { x: 4220, y: GROUND_Y - 130, w: 112, h: 14, kind: "balcony" },
    { x: 4480, y: GROUND_Y - 100, w: 96,  h: 14, kind: "balcony" },
    { x: 4920, y: GROUND_Y - 130, w: 96,  h: 14, kind: "balcony" },
    { x: 5180, y: GROUND_Y - 110, w: 112, h: 14, kind: "balcony" },

    { x: 360,  y: GROUND_Y - 220, w: 160, h: 18, kind: "roof" },
    { x: 700,  y: GROUND_Y - 240, w: 180, h: 18, kind: "roof" },
    { x: 1080, y: GROUND_Y - 220, w: 160, h: 18, kind: "roof" },
    { x: 1440, y: GROUND_Y - 250, w: 180, h: 18, kind: "roof" },
    { x: 1820, y: GROUND_Y - 230, w: 160, h: 18, kind: "roof" },
    { x: 2120, y: GROUND_Y - 260, w: 180, h: 18, kind: "roof" },
    { x: 2520, y: GROUND_Y - 230, w: 160, h: 18, kind: "roof" },
    { x: 2840, y: GROUND_Y - 260, w: 180, h: 18, kind: "roof" },
    { x: 3160, y: GROUND_Y - 240, w: 160, h: 18, kind: "roof" },
    { x: 3500, y: GROUND_Y - 260, w: 180, h: 18, kind: "roof" },
    { x: 3920, y: GROUND_Y - 240, w: 160, h: 18, kind: "roof" },
    { x: 4280, y: GROUND_Y - 270, w: 180, h: 18, kind: "roof" },
    { x: 4640, y: GROUND_Y - 240, w: 160, h: 18, kind: "roof" },
    { x: 5000, y: GROUND_Y - 260, w: 180, h: 18, kind: "roof" },
    { x: 5360, y: GROUND_Y - 240, w: 160, h: 18, kind: "roof" },
  ];

  const items = [
    { x: 120,  y: GROUND_Y - 28,  w: 16, h: 16, kind: "coin",   taken: false },
    { x: 320,  y: GROUND_Y - 116, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 510,  y: GROUND_Y - 146, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 950,  y: GROUND_Y - 126, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 1370, y: GROUND_Y - 126, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 1770, y: GROUND_Y - 146, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 2010, y: GROUND_Y - 116, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 2310, y: GROUND_Y - 146, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 2780, y: GROUND_Y - 126, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 2990, y: GROUND_Y - 146, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 3420, y: GROUND_Y - 126, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 3620, y: GROUND_Y - 146, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 3850, y: GROUND_Y - 116, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 4260, y: GROUND_Y - 146, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 4520, y: GROUND_Y - 116, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 4960, y: GROUND_Y - 146, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 5210, y: GROUND_Y - 126, w: 16, h: 16, kind: "scroll", taken: false },

    { x: 420,  y: GROUND_Y - 240, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 770,  y: GROUND_Y - 260, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 1140, y: GROUND_Y - 240, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 1500, y: GROUND_Y - 270, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 1880, y: GROUND_Y - 250, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 2200, y: GROUND_Y - 280, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 2580, y: GROUND_Y - 250, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 2920, y: GROUND_Y - 280, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 3220, y: GROUND_Y - 260, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 3580, y: GROUND_Y - 280, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 4000, y: GROUND_Y - 260, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 4360, y: GROUND_Y - 290, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 4720, y: GROUND_Y - 260, w: 16, h: 16, kind: "coin",   taken: false },
    { x: 5080, y: GROUND_Y - 280, w: 16, h: 16, kind: "scroll", taken: false },
    { x: 5440, y: GROUND_Y - 260, w: 16, h: 16, kind: "coin",   taken: false },
  ];

  const enemies = [
    { x: 1200, y: GROUND_Y - 40, w: 24, h: 40, vx:  0.6,
      minX: 940,  maxX: 1500, alive: true, deathTimer: 0, deathVy: 0, deathVx: 0 },
    { x: 2200, y: GROUND_Y - 40, w: 24, h: 40, vx: -0.7,
      minX: 1700, maxX: 2440, alive: true, deathTimer: 0, deathVy: 0, deathVx: 0 },
    { x: 3500, y: GROUND_Y - 40, w: 24, h: 40, vx:  0.7,
      minX: 3360, maxX: 3960, alive: true, deathTimer: 0, deathVy: 0, deathVx: 0 },
    { x: 4400, y: GROUND_Y - 40, w: 24, h: 40, vx: -0.6,
      minX: 4200, maxX: 4660, alive: true, deathTimer: 0, deathVy: 0, deathVx: 0 },
  ];

  const parini = {
    x: 5700, y: GROUND_Y - 56,
    w: 24, h: 56,
  };

  const dialogs = [
    { x: 100,  name: "Jacopo",
      text: "Ecco Milano. La neve cade sulla città degli stranieri. Devo trovare il vecchio Parini, l'ultimo che ricorda l'Italia libera." },
    { x: 1620, name: "Jacopo",
      text: "Le guardie tedesche pattugliano le piazze. Ridono nella nostra lingua, ma non l'amano." },
    { x: 3300, name: "Jacopo",
      text: "Eccolo, il Naviglio ghiacciato. Quanti versi sono nati su queste sponde?" },
    { x: 5400, name: "Jacopo",
      text: "Ecco la sua casa. La candela arde ancora dietro i vetri. Il poeta veglia." },
  ];

  const monuments = [
    {
      x: 200, kind: "porta",
      title: "Porta della città — Milano",
      text: "« La mia patria è dov'è Teresa: ora che la patria mi è tolta, anche l'amore è tolto. Cammino in città straniera dentro la mia città. »",
      read: false,
    },
    {
      x: 600, kind: "beggar",
      title: "Il mendicante sotto il portico",
      text: "« Il popolo ha fame, e i nuovi padroni recitano editti scritti in lingua straniera. Tutti i governi sono uguali per chi non ha pane. »",
      read: false,
    },
    {
      x: 1500, kind: "edict",
      title: "Editto austriaco affisso al muro",
      text: "« Ci hanno venduti come greggi al congresso di Campoformio. La Repubblica di Venezia, antica di mille anni, è stata cancellata con un tratto di penna. »",
      read: false,
    },
    {
      x: 2200, kind: "statue",
      title: "Statua di antico romano (mutilata)",
      text: "« I sepolti gridano dalle loro tombe; ma la patria è muta, e i vivi non sanno più ascoltare. Chi mai potrebbe smuovere questa gente? »",
      read: false,
    },
    {
      x: 2900, kind: "fountain",
      title: "Fontana di piazza, ghiacciata",
      text: "« Voi mi parlate di libertà, mio caro: ma il giorno della libertà è ancora lontano. Le menti son fiacche; anche le menti grandi son fiacche. »",
      read: false,
    },
    {
      x: 3500, kind: "bridge",
      title: "Ponte sul Naviglio",
      text: "« Italia mia! quanti tradimenti, quante viltà, quanti silenzi. Eppure i tuoi morti illustri continuano a parlarmi: ed io li ascolto, e fremo. »",
      read: false,
    },
    {
      x: 4000, kind: "playbill",
      title: "Locandina di teatro chiuso",
      text: "« Ci hanno tolto persino i teatri, perché la commedia non insulti il padrone. La poesia, l'ultima nostra patria, va in esilio dentro i nostri cuori. »",
      read: false,
    },
    {
      x: 4500, kind: "tomb",
      title: "Lapide di un patriota anonimo",
      text: "« Mi pare di morire ogni giorno, e di non morire mai. Beati i sepolti: a loro i vincitori non possono più togliere nulla. »",
      read: false,
    },
    {
      x: 5100, kind: "shrine",
      title: "Edicola sacra all'angolo",
      text: "« L'esempio non potrà mai giovare a una nazione corrotta. Né potranno gl'Italiani risorgere se non quando i Romani non risorgano per ammaestrarli. »",
      read: false,
    },
    {
      x: 5550, kind: "doorPlate",
      title: "Targa: « Casa del Parini »",
      text: "« Il vecchio poeta abita qui. Una candela, un libro aperto, un bastone accanto alla porta. È più povero di me, e infinitamente più libero. »",
      read: false,
    },
  ];

  const encounterDialogs = [
    { name: "Parini",
      text: "« Voi siete dunque il giovine Ortis. Avete gli occhi che ebbi io, mezzo secolo fa, sotto un altro padrone. »" },
    { name: "Parini",
      text: "« Sedete, sedete. Non vi vedo, ma vi sento: tremate ancora di indignazione. Bel segno: significa che siete vivo. »" },
    { name: "Parini",
      text: "« Voi mi parlate di libertà. Voi sognate, mio caro Jacopo. Il giorno della libertà è lontano: forse i nostri nipoti lo vedranno, forse no. »" },
    { name: "Parini",
      text: "« I governi si succedono, ma il popolo resta schiavo: schiavo perché ha perduto il senso dell'onore, e l'onore non si compera col danaro. »" },
    { name: "Parini",
      text: "« L'Italia non risorgerà se non risorgono i suoi morti illustri. Voi siete soli, voi giovani: e chi è solo nella verità, è il più libero degli uomini. »" },
    { name: "Parini",
      text: "« Andate, mio giovine. Siate giusto, intrepido, infelice. Solo gli infelici amano davvero la verità. Andate. La candela mi si spegne. »" },
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
    px(6, 6,  10, 8, "#e8c898");
    px(6, 14, 10, 2, "#c8a878");
    px(8, 9,  2, 2, "#0a0604");
    px(13, 9, 2, 2, "#0a0604");
    px(10, 12, 4, 1, "#7a2418");
    px(5, 16, 12, 4, "#9b2d20");
    px(5, 20, 5,  3, "#7a2018");
    px(2, 19, 18, 14, "#1a2848");
    px(0, 21, 2,  12, "#0a1428");
    px(20,21, 2,  12, "#0a1428");
    px(10, 23, 2, 2, "#c9a04a");
    px(10, 27, 2, 2, "#c9a04a");
    px(1, 30, 4, 6, "#0a1428");
    px(17,30, 4, 6, "#0a1428");
    const swing = (frame % 2 === 0) ? 0 : 2;
    px(6,  31, 4, 8 + swing, "#1f1812");
    px(12, 31, 4, 8 - swing, "#1f1812");
    px(5,  39 + swing, 6, 5, "#0a0604");
    px(11, 39 - swing, 6, 5, "#0a0604");

    ctx.restore();
  }

  function drawParini(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);

    const sway = Math.sin(frame * 0.04) * 1;

    px(4 + sway, 0,  16, 4, "#f4f0e8");
    px(2 + sway, 4,  20, 4, "#f4f0e8");
    px(0 + sway, 8,  4,  14, "#f4f0e8");
    px(20 + sway,8,  4,  14, "#f4f0e8");
    px(2 + sway, 8,  20, 2, "#d8d0c0");
    px(0 + sway, 18, 4,  4, "#d8d0c0");
    px(20 + sway,18, 4,  4, "#d8d0c0");

    px(5 + sway, 8,  14, 12, "#e6c8a8");
    px(7 + sway, 12, 4, 1, "#3a2418");
    px(13+ sway, 12, 4, 1, "#3a2418");
    px(7 + sway, 13, 4, 1, "#c8a888");
    px(13+ sway, 13, 4, 1, "#c8a888");
    px(11+ sway, 13, 2, 4, "#c8a888");
    px(9 + sway, 18, 6, 1, "#7a3030");
    px(6 + sway, 10, 1, 1, "#c8a888");
    px(17+ sway, 10, 1, 1, "#c8a888");
    px(6 + sway, 16, 2, 1, "#c8a888");
    px(16+ sway, 16, 2, 1, "#c8a888");

    px(8, 20, 8, 6, "#fef2d2");
    px(6, 22, 12, 4, "#fef2d2");
    px(8, 26, 8, 2, "#d8d0c0");

    px(3, 26, 18, 18, "#1a1820");
    px(1, 28, 2, 14,  "#0a0810");
    px(21,28, 2, 14,  "#0a0810");
    px(11, 30, 1, 1, "#d4d4dc");
    px(11, 33, 1, 1, "#d4d4dc");
    px(11, 36, 1, 1, "#d4d4dc");
    px(11, 39, 1, 1, "#d4d4dc");
    px(2, 40, 8, 8, "#0a0810");
    px(14,40, 8, 8, "#0a0810");

    px(6, 44, 4, 4, "#5a5260");
    px(14,44, 4, 4, "#5a5260");
    px(6, 48, 4, 4, "#fef2d2");
    px(14,48, 4, 4, "#fef2d2");
    px(4, 52, 7, 4, "#0a0604");
    px(13,52, 7, 4, "#0a0604");
    px(7, 53, 2, 1, "#c9a04a");
    px(16,53, 2, 1, "#c9a04a");

    const stickX = -2;
    px(stickX,    24, 2, 32, "#7a4a28");
    px(stickX-1,  22, 4, 4,  "#c9a04a");
    px(stickX,    56, 4, 2,  "#3a2418");

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffd680";
    ctx.fillRect(-10, 10, 44, 50);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawGuard(x, y, frame, facing, dying) {
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

    px(2, 0,  20, 3, "#0a0604");
    px(0, 3,  24, 4, "#e8e4dc");
    px(2, 6,  20, 1, "#a8a49c");
    px(11, 1, 2, 2, "#c9a04a");
    px(11, 3, 2, 2, "#0a0604");

    px(6, 7,  12, 8, "#e0a890");
    px(8, 10, 2, 2, "#0a0604");
    px(14,10, 2, 2, "#0a0604");
    px(7, 13, 10, 1, "#3a1810");
    px(6, 14, 2,  1, "#3a1810");
    px(16,14, 2,  1, "#3a1810");
    px(10,15, 4, 1, "#a86850");
    px(10,16, 4, 2, "#e0a890");

    px(3, 18, 18, 12, "#fef2d2");
    px(2, 18, 4,  10, "#9b2d20");
    px(18,18, 4,  10, "#9b2d20");
    px(8, 20, 1, 1, "#c9a04a");
    px(15,20, 1, 1, "#c9a04a");
    px(8, 23, 1, 1, "#c9a04a");
    px(15,23, 1, 1, "#c9a04a");
    px(8, 26, 1, 1, "#c9a04a");
    px(15,26, 1, 1, "#c9a04a");
    px(3, 29, 18, 2, "#0a0604");
    px(11,29, 2,  2, "#c9a04a");
    px(3, 18, 1, 14, "#fef2d2");
    px(20,18, 1, 14, "#fef2d2");

    const swing = (frame % 2 === 0) ? 0 : 2;
    px(5, 31, 5, 6 + swing, "#fef2d2");
    px(13,31, 5, 6 - swing, "#fef2d2");
    px(4, 36 + swing, 7, 5, "#0a0604");
    px(12,36 - swing, 7, 5, "#0a0604");

    if (!dying) {
      px(20, 24, 1, 12, "#a0a0a8");
    }

    ctx.restore();
  }

  function drawCoin(x, y, frame) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(frame * 0.08) * 1.5;
    ctx.translate(0, bob);
    px(3, 4, 10, 10, "#c9a04a");
    px(4, 3, 8, 1,   "#c9a04a");
    px(4, 14,8, 1,   "#c9a04a");
    px(4, 4, 8, 1,   "#e8c870");
    px(3, 5, 1, 8,   "#e8c870");
    px(12,5, 1, 8,   "#8a6818");
    px(4, 13,8, 1,   "#8a6818");
    px(7, 6, 1, 6, "#8a6818");
    px(9, 6, 1, 6, "#8a6818");
    ctx.fillStyle = "rgba(255,215,100,0.18)";
    ctx.fillRect(0, 0, 16, 16);
    ctx.restore();
  }

  function drawScroll(x, y, frame) {
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
    px(6, 11, 4, 3, "#2a5a30");
    px(7, 12, 2, 1, "#3a8040");
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

  const snowflakes = [];
  for (let i = 0; i < 180; i++) {
    snowflakes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: -0.3 + (Math.random() - 0.5) * 0.4,
      vy: 0.4 + Math.random() * 1.0,
      size: 1 + Math.floor(Math.random() * 2),
      sw: Math.random() * Math.PI * 2,
    });
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").imageSmoothingEnabled = false;
    return c;
  }

  const skylineTileW = 1600;
  const skylineTileH = 360;
  const skylineCanvas = makeCanvas(skylineTileW, skylineTileH);
  (function buildSkyline() {
    const sctx = skylineCanvas.getContext("2d");
    sctx.imageSmoothingEnabled = false;
    const period = 200;
    for (let i = 0; i < skylineTileW / period + 1; i++) {
      const wx = i * period;
      const seed = Math.abs(Math.floor(i * 73 + 11));
      const h = 160 + (seed % 100);
      sctx.fillStyle = COL.bldgFar;
      sctx.fillRect(wx, skylineTileH - h - 4, period - 8, h);
      sctx.fillStyle = COL.bldgFarHi;
      sctx.fillRect(wx, skylineTileH - h - 4, period - 8, 4);
      for (let r = 1; r < h / 30; r++) {
        for (let c = 0; c < 3; c++) {
          const lit = ((seed + r + c) % 4 === 0);
          sctx.fillStyle = lit ? "#ffd680" : "#0a0418";
          sctx.fillRect(wx + 16 + c * 56, skylineTileH - h - 4 + 16 + r * 28, 14, 14);
        }
      }
    }
  })();

  const duomoCanvas = makeCanvas(420, 380);
  (function buildDuomo() {
    const dctx = duomoCanvas.getContext("2d");
    dctx.imageSmoothingEnabled = false;
    const baseY = 80;
    dctx.fillStyle = COL.duomo;
    dctx.fillRect(0, baseY, 380, 300);
    dctx.beginPath();
    dctx.moveTo(0, baseY);
    dctx.lineTo(380, baseY);
    dctx.lineTo(320, baseY - 50);
    dctx.lineTo(60,  baseY - 50);
    dctx.closePath();
    dctx.fill();
    const spires = [40, 90, 150, 200, 260, 310, 360];
    for (const s of spires) {
      dctx.beginPath();
      dctx.moveTo(s, baseY - 50);
      dctx.lineTo(s + 8, baseY - 90);
      dctx.lineTo(s + 16, baseY - 50);
      dctx.closePath();
      dctx.fill();
    }
    dctx.beginPath();
    dctx.moveTo(180, baseY - 50);
    dctx.lineTo(192, baseY - 140);
    dctx.lineTo(204, baseY - 50);
    dctx.closePath();
    dctx.fill();
    dctx.fillStyle = "#c9a04a";
    dctx.fillRect(191, baseY - 144, 2, 4);
    dctx.fillStyle = "#1a1c30";
    dctx.beginPath();
    dctx.arc(192, baseY + 80, 26, 0, Math.PI * 2);
    dctx.fill();
    dctx.fillStyle = "#06081a";
    dctx.fillRect(170, baseY + 140, 44, 100);
    dctx.fillRect(100, baseY + 160, 32, 80);
    dctx.fillRect(248, baseY + 160, 32, 80);
  })();

  const buildingDefs = [
    { x: 240,  w: 200 }, { x: 460, w: 220 },
    { x: 880,  w: 240 }, { x: 1320, w: 200 },
    { x: 1720, w: 220 }, { x: 1960, w: 220 },
    { x: 2260, w: 200 }, { x: 2720, w: 240 },
    { x: 2940, w: 220 }, { x: 3360, w: 220 },
    { x: 3560, w: 240 }, { x: 3800, w: 200 },
    { x: 4200, w: 240 }, { x: 4460, w: 200 },
    { x: 4900, w: 220 }, { x: 5160, w: 220 },
    { x: 5580, w: 220 },
  ];
  const buildingHeight = 440;
  for (const b of buildingDefs) {
    b.canvas = makeCanvas(b.w + 8, buildingHeight + 8);
    const bctx = b.canvas.getContext("2d");
    bctx.imageSmoothingEnabled = false;
    const yOff = 8;
    bctx.fillStyle = "#3a2820";
    bctx.fillRect(0, yOff, b.w, buildingHeight - yOff);
    bctx.fillStyle = "#2a1810";
    for (let row = 0; row < buildingHeight / 14; row++) {
      bctx.fillRect(0, yOff + row * 14, b.w, 1);
    }
    const cols = Math.floor(b.w / 60);
    const rows = Math.floor((buildingHeight - yOff) / 70) - 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = 14 + c * 60;
        const wy = yOff + 30 + r * 70;
        bctx.fillStyle = "#5a4838";
        bctx.fillRect(wx - 2, wy + 26, 32, 4);
        const lit = ((b.x + r * 7 + c * 13) % 5) === 0;
        bctx.fillStyle = lit ? "#ffd680" : "#0a0e1a";
        bctx.fillRect(wx, wy, 28, 26);
        bctx.fillStyle = "#1a1410";
        bctx.fillRect(wx + 13, wy, 2, 26);
        bctx.fillRect(wx, wy + 12, 28, 2);
        bctx.fillStyle = "#5a4838";
        bctx.fillRect(wx - 2, wy - 4, 32, 4);
      }
    }
    bctx.fillStyle = "#5a4838";
    bctx.fillRect(0, yOff - 8, b.w, 6);
    bctx.fillStyle = COL.snow;
    bctx.fillRect(0, yOff - 10, b.w, 2);
  }


  function updateSnow() {
    for (const s of snowflakes) {
      s.x += s.vx + Math.sin(s.sw) * 0.3;
      s.y += s.vy;
      s.sw += 0.04;
      if (s.y > H) { s.y = -4; s.x = Math.random() * W; }
      if (s.x < -10) s.x = W + 10;
      if (s.x > W + 10) s.x = -10;
    }
  }
  function drawSnow() {
    ctx.fillStyle = COL.snow;
    for (const s of snowflakes) {
      if (s.size > 1) ctx.fillRect(s.x, s.y, 2, 2);
    }
    ctx.fillStyle = COL.snowSoft;
    for (const s of snowflakes) {
      if (s.size <= 1) ctx.fillRect(s.x, s.y, 1, 1);
    }
  }

  const skyCanvas = makeCanvas(W, H);
  (function buildSky() {
    const sctx = skyCanvas.getContext("2d");
    const g = sctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,   COL.skyTop);
    g.addColorStop(0.6, COL.skyMid);
    g.addColorStop(1,   COL.skyLow);
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, W, H);
  })();

  function buildHillTile(period, baseY, amp, color) {
    const tw = period * 2;
    const tile = makeCanvas(tw, H);
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
  const hillFarTile = buildHillTile(260, GROUND_Y - 110, 50, COL.hillFar);
  const hillMidTile = buildHillTile(200, GROUND_Y -  60, 40, COL.hillMid);

  function drawTiled(tile, offset, y) {
    const tw = tile.width;
    let x = -((offset % tw + tw) % tw);
    while (x < W) {
      ctx.drawImage(tile, Math.floor(x), Math.floor(y));
      x += tw;
    }
  }

  function drawBackground() {
    ctx.drawImage(skyCanvas, 0, 0);

    for (const st of stars) {
      const t = Math.sin(game.time * 0.04 + st.tw);
      ctx.fillStyle = st.bright ? COL.starA : COL.starB;
      ctx.globalAlpha = 0.4 + 0.5 * Math.max(0, t);
      ctx.fillRect(st.x, st.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    const mx = 1480, my = 130, mr = 72;
    px(mx + 4, my,         mr - 8, mr,     COL.moon);
    px(mx,     my + 4,     mr,     mr - 8, COL.moon);
    px(mx + 16, my + 18,   10, 10, COL.moonShade);
    px(mx + 46, my + 30,   8,  8,  COL.moonShade);
    px(mx + 28, my + 46,   9,  9,  COL.moonShade);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#aac8d8";
    ctx.fillRect(mx - 24, my + 22, 124, 8);
    ctx.fillRect(mx - 36, my + 32, 144, 6);
    ctx.globalAlpha = 1;
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = COL.moon;
    ctx.beginPath();
    ctx.arc(mx + mr/2, my + mr/2, mr * 1.5, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const cam = game.camera;

    drawTiled(skylineCanvas, cam * 0.15, GROUND_Y - skylineTileH - 60);

    const duomoX = 1800 - cam * 0.3;
    if (duomoX > -duomoCanvas.width && duomoX < W) {
      ctx.drawImage(duomoCanvas, Math.floor(duomoX), Math.floor(GROUND_Y - duomoCanvas.height + 20));
    }

    drawTiled(hillFarTile, cam * 0.4,  0);
    drawTiled(hillMidTile, cam * 0.55, 0);
  }

  const trees = [
    { x: 230 }, { x: 580 }, { x: 880 }, { x: 1340 },
    { x: 1900 }, { x: 2380 }, { x: 2700 }, { x: 3060 },
    { x: 3700 }, { x: 4080 }, { x: 4540 }, { x: 4980 },
    { x: 5400 }, { x: 5800 },
  ];

  function drawWinterTree(wx, frame) {
    const sx = wx - game.camera;
    if (sx < -80 || sx > W + 80) return;
    const sway = Math.sin(frame * 0.02 + wx) * 1;
    px(sx - 3, GROUND_Y - 80, 6, 80, COL.trunk);
    ctx.strokeStyle = COL.trunk;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y - 80);
    ctx.lineTo(sx - 28 + sway, GROUND_Y - 110);
    ctx.moveTo(sx, GROUND_Y - 70);
    ctx.lineTo(sx + 24 + sway, GROUND_Y - 100);
    ctx.moveTo(sx, GROUND_Y - 55);
    ctx.lineTo(sx - 22 + sway, GROUND_Y - 80);
    ctx.moveTo(sx, GROUND_Y - 40);
    ctx.lineTo(sx + 18 + sway, GROUND_Y - 70);
    ctx.stroke();
    px(sx - 28 + sway, GROUND_Y - 112, 6, 2, COL.snow);
    px(sx + 22 + sway, GROUND_Y - 102, 6, 2, COL.snow);
  }

  const lamps = [
    { x: 380 }, { x: 760 }, { x: 1280 }, { x: 1680 },
    { x: 2080 }, { x: 2620 }, { x: 3120 }, { x: 3640 },
    { x: 4040 }, { x: 4500 }, { x: 4980 }, { x: 5360 },
  ];

  function drawLamp(wx, frame) {
    const sx = wx - game.camera;
    if (sx < -40 || sx > W + 40) return;
    const flicker = 0.5 + 0.5 * Math.sin(frame * 0.18 + wx);
    ctx.globalAlpha = 0.18 + flicker * 0.06;
    ctx.fillStyle = COL.lampLight;
    ctx.beginPath();
    ctx.arc(sx, GROUND_Y - 90, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    px(sx - 1, GROUND_Y - 80, 2, 80, "#1a1410");
    px(sx - 4, GROUND_Y - 4,  8, 4,  "#1a1410");
    px(sx - 6, GROUND_Y - 84, 12, 2, "#1a1410");
    px(sx - 5, GROUND_Y - 100, 10, 14, "#1a1410");
    px(sx - 7, GROUND_Y - 102, 14, 4,  "#1a1410");
    px(sx - 7, GROUND_Y - 86,  14, 2,  "#1a1410");
    px(sx - 3, GROUND_Y - 96, 6, 8, COL.lampLight);
    px(sx - 2, GROUND_Y - 94, 4, 4, "#fff4d0");
  }


  const cobbleTile = makeCanvas(200, 200);
  (function buildCobble() {
    const c = cobbleTile.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.fillStyle = COL.snow;
    c.fillRect(0, 0, 200, 4);
    c.fillStyle = COL.snowSoft;
    for (let i = 0; i < 200; i += 8) c.fillRect(i, 4, 4, 2);
    c.fillStyle = COL.cobble;
    c.fillRect(0, 6, 200, 194);
    c.fillStyle = COL.cobbleDk;
    const rows = Math.ceil((200 - 6) / 14);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < 200; col += 28) {
        const off = (r % 2) * 14;
        c.fillRect(col + off, 6 + r * 14, 1, 14);
      }
      c.fillRect(0, 6 + r * 14, 200, 1);
    }
    c.fillStyle = "#7a7280";
    c.fillRect(30, 24, 2, 2);
    c.fillRect(82, 56, 3, 2);
    c.fillRect(140, 88, 2, 2);
    c.fillRect(180, 40, 2, 2);
    c.fillRect(58, 132, 2, 2);
    c.fillRect(112, 168, 3, 2);
    c.fillRect(160, 150, 2, 2);
    c.fillStyle = COL.cobbleDk;
    c.fillRect(0, 175, 200, 25);
    c.fillStyle = "#3a3038";
    for (let i = 0; i < 200; i += 6) c.fillRect(i, 178, 3, 2);
  })();

  const roofTile = makeCanvas(180, 18);
  (function buildRoof() {
    const c = roofTile.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.fillStyle = COL.snow;
    c.fillRect(0, 0, 180, 4);
    c.fillStyle = COL.roof;
    c.fillRect(0, 4, 180, 14);
    c.fillStyle = COL.roofDk;
    for (let i = 0; i < 180; i += 10) c.fillRect(i, 4, 1, 14);
    c.fillRect(0, 17, 180, 1);
    c.fillStyle = "#7a4040";
    c.fillRect(0, 4, 180, 2);
  })();

  function drawTiledRect(tile, sx, sy, w, h) {
    const tw = tile.width, th = tile.height;
    let yy = sy;
    while (yy < sy + h) {
      const drawH = Math.min(th, sy + h - yy);
      let xx = sx;
      while (xx < sx + w) {
        const drawW = Math.min(tw, sx + w - xx);
        ctx.drawImage(tile, 0, 0, drawW, drawH,
          Math.floor(xx), Math.floor(yy), drawW, drawH);
        xx += tw;
      }
      yy += th;
    }
  }

  function drawPlatforms() {
    for (const p of platforms) {
      const sx = p.x - game.camera;
      if (sx + p.w < -10 || sx > W + 10) continue;

      if (p.kind === "ground") {
        drawTiledRect(cobbleTile, sx, p.y, p.w, p.h);
      } else if (p.kind === "balcony") {
        ctx.fillStyle = COL.snow;
        ctx.fillRect(sx, p.y, p.w, 3);
        ctx.fillStyle = "#8a8290";
        ctx.fillRect(sx, p.y + 3, p.w, p.h - 3);
        ctx.fillStyle = "#5a525c";
        ctx.fillRect(sx, p.y + p.h - 2, p.w, 2);
        ctx.fillStyle = "#1a1410";
        for (let i = 4; i < p.w - 4; i += 6) {
          ctx.fillRect(sx + i, p.y - 6, 1, 6);
        }
        ctx.fillRect(sx + 2, p.y - 7, p.w - 4, 1);
      } else if (p.kind === "roof") {
        drawTiledRect(roofTile, sx, p.y, p.w, p.h);
      }
    }
  }

  function drawBuildings() {
    for (const b of buildingDefs) {
      const sx = b.x - game.camera;
      if (sx + b.w < -10 || sx > W + 10) continue;
      ctx.drawImage(b.canvas, Math.floor(sx), Math.floor(GROUND_Y - buildingHeight));
    }
  }

  function drawMonument(m, frame) {
    const sx = m.x - game.camera;
    if (sx < -80 || sx > W + 80) return;
    switch (m.kind) {
      case "porta":     drawPorta(sx); break;
      case "beggar":    drawBeggar(sx, frame); break;
      case "edict":     drawEdict(sx); break;
      case "statue":    drawRomanStatue(sx); break;
      case "fountain":  drawFountainFrozen(sx); break;
      case "bridge":    drawBridge(sx); break;
      case "playbill":  drawPlaybill(sx); break;
      case "tomb":      drawTomb(sx); break;
      case "shrine":    drawShrine(sx, frame); break;
      case "doorPlate": drawDoorPlate(sx); break;
    }
    if (m.read) {
      ctx.fillStyle = "rgba(217,164,65,0.08)";
      ctx.fillRect(sx - 24, GROUND_Y - 80, 48, 80);
    }
    if (game.nearMonument === m && game.state === STATE.PLAY) {
      drawReadPrompt(sx, GROUND_Y - 100, frame);
    }
  }

  function drawReadPrompt(sx, sy, frame) {
    const bob = Math.sin(frame * 0.12) * 2;
    ctx.fillStyle = "rgba(8,10,24,0.9)";
    ctx.fillRect(sx - 18, sy + bob, 36, 22);
    ctx.fillStyle = "#e8e0c0";
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
    ctx.fillStyle = "#e8e0c0";
    ctx.fillRect(sx - 2, sy + bob + 22, 4, 2);
    ctx.fillRect(sx - 1, sy + bob + 24, 2, 2);
  }

  function drawPorta(sx) {
    const baseY = GROUND_Y;
    px(sx - 36, baseY - 100, 8, 100, "#5a525c");
    px(sx + 28, baseY - 100, 8, 100, "#5a525c");
    px(sx - 40, baseY - 110, 80, 10, "#7a7280");
    px(sx - 36, baseY - 116, 72, 6, "#5a525c");
    px(sx - 28, baseY - 100, 56, 6, "#7a7280");
    px(sx - 20, baseY - 96, 40, 4, "#5a525c");
    px(sx - 6, baseY - 110, 12, 8, "#9b2d20");
    px(sx - 4, baseY - 108, 8, 4, "#c93a28");
    px(sx - 40, baseY - 118, 80, 2, COL.snow);
  }

  function drawBeggar(sx, frame) {
    const baseY = GROUND_Y;
    const breathe = Math.sin(frame * 0.05) * 1;
    px(sx - 12, baseY - 26, 24, 26, "#3a2818");
    px(sx - 8,  baseY - 30, 16, 6,  "#5a4030");
    px(sx - 4,  baseY - 26 + breathe, 8, 4, "#e0a890");
    px(sx - 3,  baseY - 24, 1, 1, "#0a0604");
    px(sx + 1,  baseY - 24, 1, 1, "#0a0604");
    px(sx + 8, baseY - 14, 10, 6, "#3a2818");
    px(sx + 9, baseY - 14, 8, 1, "#1a1410");
    px(sx + 12, baseY - 13, 2, 2, "#c9a04a");
    px(sx - 16, baseY - 30, 2, 30, "#5a3a22");
  }

  function drawEdict(sx) {
    const baseY = GROUND_Y;
    px(sx - 18, baseY - 80, 36, 50, "#fef2d2");
    px(sx - 18, baseY - 80, 36, 4,  "#e6d4a8");
    px(sx - 18, baseY - 32, 36, 2,  "#c9b078");
    for (let i = 0; i < 7; i++) {
      px(sx - 14, baseY - 72 + i * 6, 28, 1, "#3a2418");
    }
    px(sx - 6, baseY - 78, 12, 4, "#9b2d20");
    px(sx - 4, baseY - 76, 8,  2, "#c93a28");
    px(sx - 16, baseY - 78, 2, 2, "#1a1410");
    px(sx + 14, baseY - 78, 2, 2, "#1a1410");
    px(sx - 16, baseY - 36, 2, 2, "#1a1410");
    px(sx + 14, baseY - 36, 2, 2, "#1a1410");
  }

  function drawRomanStatue(sx) {
    const baseY = GROUND_Y;
    px(sx - 16, baseY - 12, 32, 12, "#6a5848");
    px(sx - 18, baseY - 16, 36, 4,  "#8a7868");
    px(sx - 14, baseY - 32, 28, 16, "#7a6858");
    px(sx - 10, baseY - 60, 20, 28, "#cabea0");
    px(sx - 12, baseY - 50, 24, 4,  "#aa9c80");
    px(sx + 10, baseY - 56, 4, 6, "#aa9c80");
    px(sx - 6, baseY - 76, 10, 14, "#cabea0");
    px(sx - 4, baseY - 70, 2, 2, "#7a6858");
    px(sx + 2, baseY - 70, 2, 2, "#7a6858");
    ctx.strokeStyle = "#3a3028";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 6, baseY - 70);
    ctx.lineTo(sx + 4, baseY - 30);
    ctx.stroke();
    px(sx - 14, baseY - 14, 4, 4, COL.leaves);
    px(sx + 10, baseY - 14, 4, 4, COL.leaves);
    px(sx - 6, baseY - 78, 10, 2, COL.snow);
  }

  function drawFountainFrozen(sx) {
    const baseY = GROUND_Y;
    px(sx - 32, baseY - 16, 64, 16, "#7a7280");
    px(sx - 30, baseY - 14, 60, 6,  "#aac8d8");
    px(sx - 28, baseY - 14, 56, 2,  "#e8f4f8");
    px(sx - 4, baseY - 44, 8, 28, "#8a8290");
    px(sx - 8, baseY - 48, 16, 4, "#aaa298");
    px(sx - 12, baseY - 56, 24, 8, "#8a8290");
    px(sx - 10, baseY - 54, 20, 2, "#aac8d8");
    px(sx - 10, baseY - 48, 1, 6, "#e8f4f8");
    px(sx - 6,  baseY - 48, 1, 8, "#e8f4f8");
    px(sx + 5,  baseY - 48, 1, 6, "#e8f4f8");
    px(sx + 9,  baseY - 48, 1, 8, "#e8f4f8");
    px(sx - 12, baseY - 58, 24, 2, COL.snow);
  }

  function drawBridge(sx) {
    const baseY = GROUND_Y;
    px(sx - 30, baseY - 24, 60, 6, "#5a525c");
    px(sx - 30, baseY - 30, 60, 2, "#7a7280");
    for (let i = -28; i <= 28; i += 8) {
      px(sx + i, baseY - 18, 4, 12, "#7a7280");
    }
    px(sx - 30, baseY - 32, 60, 2, COL.snow);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffd680";
    ctx.fillRect(sx - 4, baseY - 60, 8, 4);
    ctx.globalAlpha = 1;
    px(sx - 2, baseY - 56, 4, 4, "#1a1410");
    px(sx - 1, baseY - 70, 2, 14, "#1a1410");
  }

  function drawPlaybill(sx) {
    const baseY = GROUND_Y;
    px(sx - 20, baseY - 80, 40, 60, "#9b2d20");
    px(sx - 20, baseY - 80, 40, 4,  "#c93a28");
    px(sx - 20, baseY - 24, 40, 4,  "#7a2018");
    px(sx - 14, baseY - 70, 28, 4,  "#fef2d2");
    px(sx - 14, baseY - 60, 28, 2,  "#fef2d2");
    px(sx - 12, baseY - 54, 24, 1,  "#fef2d2");
    ctx.strokeStyle = "#0a0604";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx - 18, baseY - 78);
    ctx.lineTo(sx + 18, baseY - 26);
    ctx.moveTo(sx + 18, baseY - 78);
    ctx.lineTo(sx - 18, baseY - 26);
    ctx.stroke();
    px(sx - 22, baseY - 80, 2, 80, "#3a2418");
    px(sx + 20, baseY - 80, 2, 80, "#3a2418");
  }

  function drawTomb(sx) {
    const baseY = GROUND_Y;
    px(sx - 14, baseY - 50, 28, 50, "#7a7280");
    px(sx - 16, baseY - 54, 32, 4,  "#5a525c");
    px(sx - 10, baseY - 56, 20, 6,  "#7a7280");
    px(sx - 6,  baseY - 60, 12, 4,  "#7a7280");
    for (let i = 0; i < 4; i++) {
      px(sx - 10, baseY - 42 + i * 8, 20, 2, "#3a2418");
    }
    px(sx - 1, baseY - 8, 2, 4, "#3a2418");
    px(sx - 3, baseY - 6, 6, 1, "#3a2418");
    px(sx + 8, baseY - 6, 2, 4, "#3a2418");
    px(sx + 7, baseY - 8, 4, 2, "#5a3030");
    px(sx - 8, baseY - 62, 16, 2, COL.snow);
  }

  function drawShrine(sx, frame) {
    const baseY = GROUND_Y;
    px(sx - 16, baseY - 6,  32, 6,  "#5a4a3a");
    px(sx - 14, baseY - 50, 28, 44, "#d4c8a0");
    px(sx - 14, baseY - 50, 28, 4,  "#a89878");
    px(sx - 16, baseY - 56, 32, 6,  "#7a3018");
    px(sx - 12, baseY - 62, 24, 6,  "#9b3818");
    px(sx - 8,  baseY - 42, 16, 24, "#2a1c16");
    px(sx - 1,  baseY - 30, 2,  10, "#fef2d2");
    const flicker = (Math.sin(frame * 0.4) + 1) * 0.5;
    px(sx - 1, baseY - 34 - Math.floor(flicker * 2), 2, 4, "#ffd060");
    px(sx,     baseY - 36 - Math.floor(flicker * 2), 1, 2, "#fff4d0");
    px(sx - 16, baseY - 64, 32, 2, COL.snow);
  }

  function drawDoorPlate(sx) {
    const baseY = GROUND_Y;
    px(sx - 18, baseY - 100, 36, 100, "#3a2820");
    px(sx - 14, baseY - 96,  28, 76,  "#5a3828");
    px(sx - 12, baseY - 90, 24, 70, "#3a2418");
    px(sx - 12, baseY - 90, 24, 2,  "#1a1410");
    px(sx - 12, baseY - 22, 24, 2,  "#1a1410");
    px(sx - 1,  baseY - 90, 2,  68, "#1a1410");
    px(sx + 6, baseY - 60, 4, 4, "#c9a04a");
    px(sx - 14, baseY - 116, 28, 14, "#e8e0c0");
    px(sx - 14, baseY - 116, 28, 2,  "#a89c80");
    px(sx - 14, baseY - 104, 28, 2,  "#a89c80");
    for (let i = 0; i < 3; i++) {
      px(sx - 10, baseY - 113 + i * 4, 20, 1, "#3a2418");
    }
    px(sx - 5, baseY - 86, 10, 6, "#0a0604");
    px(sx - 1, baseY - 84, 2, 4, "#ffd680");
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#ffd680";
    ctx.beginPath();
    ctx.arc(sx, baseY - 84, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    px(sx - 14, baseY - 102, 28, 2, COL.snow);
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

    updateSnow();

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
      checkParini();
      if (player.invuln > 0) player.invuln--;
    } else if (game.state === STATE.ENCOUNTER) {
      if (game.cameraTargetLock !== null) {
        game.camera += (game.cameraTargetLock - game.camera) * 0.06;
      }
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

    if (player.y > H + 80) hurtPlayer(true);

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
  }

  function updateItems() {
    for (const it of items) {
      if (it.taken) continue;
      if (rectsOverlap(player, it)) {
        it.taken = true;
        if (it.kind === "coin") {
          game.pickedCoins++;
          SFX.coin();
        } else {
          game.pickedScrolls++;
          SFX.scroll();
        }
        spawnSparkle(it.x + it.w / 2, it.y + it.h / 2);
        updateHud();
      }
    }
  }

  function updateCamera() {
    if (game.cameraTargetLock !== null) {
      game.camera += (game.cameraTargetLock - game.camera) * 0.06;
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
    keys["KeyX_pressed"] = false;
    keys["Enter_pressed"] = false;
  }

  function checkParini() {
    const dx = (player.x + player.w / 2) - (parini.x + parini.w / 2);
    if (Math.abs(dx) < 40 && player.onGround) {
      if (game.readMemories < monuments.length) {
        if (!game.warnedNotEnoughMemories) {
          game.warnedNotEnoughMemories = true;
          const missing = monuments.length - game.readMemories;
          showDialog(
            "Parini",
            `« Andate, mio giovine, e tornate quando avrete ascoltato ogni voce di questa città. ` +
            `${missing === 1 ? "Vi manca ancora una memoria" : `Vi mancano ancora ${missing} memorie`} ` +
            `da raccogliere. Le pietre parlano: ascoltatele tutte. »`,
            true
          );
        }
        return;
      }
      startEncounter();
    } else if (Math.abs(dx) > 200) {
      game.warnedNotEnoughMemories = false;
    }
  }

  function startEncounter() {
    game.state = STATE.ENCOUNTER;
    game.inEncounter = true;
    game.encounterStep = 0;
    player.x = parini.x - 60;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    const center = (player.x + parini.x) / 2;
    game.cameraTargetLock = center - W / 2 + 30;
    if (game.cameraTargetLock < 0) game.cameraTargetLock = 0;
    if (game.cameraTargetLock > WORLD_W - W) game.cameraTargetLock = WORLD_W - W;
    game.camera = game.cameraTargetLock;
    game.zoomTarget = 1.8;
    SFX.parini();
    setTimeout(advanceEncounter, 1400);
  }

  function advanceEncounter() {
    if (game.encounterStep >= encounterDialogs.length) {
      game.inEncounter = false;
      showEncounterOverlay();
      return;
    }
    const d = encounterDialogs[game.encounterStep];
    game.encounterStep++;
    showDialog(d.name, d.text, true);
  }

  const particles = [];
  function spawnSparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 1,
        life: 30, maxLife: 30,
        color: Math.random() > 0.5 ? "#fff4d0" : "#c9a04a",
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
  }

  function drawParticles() {
    for (const p of particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - game.camera, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
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
    if (player.hp <= 0) gameOver();
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
      const fx = parini.x + - 10 + parini.w / 2 - game.camera;
      const fy = parini.y + parini.h / 2;
      ctx.translate(fx, fy);
      ctx.scale(game.zoom+5, game.zoom+5);
      ctx.translate(-fx, -fy);
    }

    drawBuildings();

    for (const t of trees) drawWinterTree(t.x, game.time);
    for (const l of lamps) drawLamp(l.x, game.time);

    for (const m of monuments) drawMonument(m, game.time);

    if (game.state !== STATE.GAMEOVER) {
      drawParini(parini.x - game.camera, parini.y, game.time);
    }

    drawPlatforms();

    for (const it of items) {
      if (it.taken) continue;
      const sx = it.x - game.camera;
      if (sx < -20 || sx > W + 20) continue;
      if (it.kind === "coin") drawCoin(sx, it.y, game.time);
      else drawScroll(sx, it.y, game.time);
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
        drawGuard(sx, e.y, game.time, facing, true);
        ctx.restore();
      } else {
        drawGuard(sx, e.y, game.time, facing, dying);
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

    drawSnow();
    drawVignette();
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(W/2, H/2, H/3, W/2, H/2, H * 0.75);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  const $ = (id) => document.getElementById(id);
  const introOverlay     = $("introOverlay");
  const encounterOverlay = $("encounterOverlay");
  const endOverlay       = $("endOverlay");
  const gameOverOverlay  = $("gameOverOverlay");
  const dialogBox        = $("dialogBox");
  const dialogName       = $("dialogName");
  const dialogText       = $("dialogText");

  function updateHud() {
    let hearts = "";
    for (let i = 0; i < 3; i++) {
      hearts += i < player.hp ? "♥ " : "♡ ";
    }
    $("hudHearts").textContent = hearts;
    $("hudCoins").textContent = game.pickedCoins;
    $("hudScrolls").textContent = game.pickedScrolls;
    const memEl = $("hudMemories");
    if (memEl) memEl.textContent = `${game.readMemories}/${monuments.length}`;
  }

  function showDialog(name, text, asQuote) {
    dialogName.textContent = name;
    dialogText.textContent = text;
    dialogText.classList.toggle("quote-text", !!asQuote);
    dialogBox.classList.remove("hidden");
    if (game.state !== STATE.ENCOUNTER) {
      game.state = STATE.DIALOG;
    }
  }

  function closeDialog() {
    dialogBox.classList.add("hidden");
    if (game.inEncounter) {
      setTimeout(advanceEncounter, 200);
    } else {
      game.state = STATE.PLAY;
    }
  }

  function showEncounterOverlay() {
    encounterOverlay.classList.remove("hidden");
  }

  function showEndOverlay() {
    encounterOverlay.classList.add("hidden");
    $("finalScore").textContent =
      `Hai raccolto ${game.pickedCoins} monete, ${game.pickedScrolls} pergamene, e letto ${game.readMemories} memorie su ${monuments.length}.`;
    endOverlay.classList.remove("hidden");
    game.state = STATE.WIN;
  }

  function gameOver() {
    game.state = STATE.GAMEOVER;
    setTimeout(() => gameOverOverlay.classList.remove("hidden"), 600);
  }

  function startGame() {
    ensureAudio();
    introOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    encounterOverlay.classList.add("hidden");
    dialogBox.classList.add("hidden");
    player.x = 60; player.y = GROUND_Y - 44;
    player.vx = 0; player.vy = 0;
    player.hp = 3; player.invuln = 0; player.facing = 1;
    game.camera = 0;
    game.cameraTargetLock = null;
    game.zoom = 1;
    game.zoomTarget = 1;
    game.pickedCoins = 0;
    game.pickedScrolls = 0;
    game.readMemories = 0;
    game.nearMonument = null;
    game.warnedNotEnoughMemories = false;
    game.inEncounter = false;
    game.encounterStep = 0;
    game.triggeredDialogs.clear();
    particles.length = 0;
    items.forEach(i => i.taken = false);
    monuments.forEach(m => m.read = false);
    enemies.forEach(e => {
      e.alive = true;
      e.deathTimer = 0;
      e.deathVy = 0;
      e.deathVx = 0;
      e.y = GROUND_Y - e.h;
    });
    enemies[0].x = 1200; enemies[0].vx =  0.6;
    enemies[1].x = 2200; enemies[1].vx = -0.7;
    enemies[2].x = 3500; enemies[2].vx =  0.7;
    enemies[3].x = 4400; enemies[3].vx = -0.6;
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
