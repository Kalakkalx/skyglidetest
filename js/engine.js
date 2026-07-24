// ============ ENGINE ============
// Local storage, skins, and core game physics/rendering — everything that
// is NOT screen/DOM management (that lives in app.js).

// ---------- Local storage (all game state lives here) ----------
const STORAGE_KEYS = {
  playerName: "playerName",
  coins: "coins",
  highScore: "highScore",
  unlockedSkins: "unlockedSkins",
  currentSkin: "currentSkin"
};

const LocalState = {
  getPlayerName() {
    return localStorage.getItem(STORAGE_KEYS.playerName) || "";
  },
  setPlayerName(name) {
    localStorage.setItem(STORAGE_KEYS.playerName, name);
  },
  getCoins() {
    return Number(localStorage.getItem(STORAGE_KEYS.coins)) || 0;
  },
  setCoins(value) {
    localStorage.setItem(STORAGE_KEYS.coins, String(value));
  },
  getHighScore() {
    return Number(localStorage.getItem(STORAGE_KEYS.highScore)) || 0;
  },
  setHighScore(value) {
    localStorage.setItem(STORAGE_KEYS.highScore, String(value));
  },
  getUnlockedSkins() {
    return Number(localStorage.getItem(STORAGE_KEYS.unlockedSkins)) || 1;
  },
  setUnlockedSkins(value) {
    localStorage.setItem(STORAGE_KEYS.unlockedSkins, String(value));
  },
  getCurrentSkin() {
    return Number(localStorage.getItem(STORAGE_KEYS.currentSkin)) || 1;
  },
  setCurrentSkin(value) {
    localStorage.setItem(STORAGE_KEYS.currentSkin, String(value));
  }
};

// ---------- Skins ----------
function tierForSkin(level) {
  if (level >= 10) return "Elite";
  if (level >= 7) return "Master";
  if (level >= 4) return "Star";
  return "Basic";
}

// Prices: Level1 free, Level2 = 10, Level3 = 20, ... Level12 = 110
const SKINS = Array.from({ length: 12 }, (_, i) => {
  const level = i + 1;
  return {
    level,
    file: `images/Level${level}.png`,
    price: level === 1 ? 0 : (level - 1) * 10,
    tier: tierForSkin(level)
  };
});

function tryUnlockNextSkin() {
  const unlocked = LocalState.getUnlockedSkins();
  const nextLevel = unlocked + 1;
  if (nextLevel > 12) return { success: false, reason: "All skins already unlocked" };

  const skin = SKINS[nextLevel - 1];
  const coins = LocalState.getCoins();
  if (coins < skin.price) return { success: false, reason: "Not enough coins" };

  LocalState.setCoins(coins - skin.price);
  LocalState.setUnlockedSkins(nextLevel);
  return { success: true, unlockedLevel: nextLevel };
}

function equipSkin(level) {
  if (level > LocalState.getUnlockedSkins()) return false;
  LocalState.setCurrentSkin(level);
  return true;
}

// ---------- Leaderboard (Firebase Firestore, no login) ----------
// The whole Top 20 lives in a single document so reads/sorts/truncation
// are all one round trip — no composite queries, no auth required. Write
// access is restricted to this one document path via Firestore security
// rules (see firestore.rules), not via any login flow.
const firebaseConfig = {
  apiKey: "AIzaSyDQHGHt9XeQ0HG70vfC0fu-qT5VtsISKFY",
  authDomain: "hollowboat1.firebaseapp.com",
  projectId: "hollowboat1",
  storageBucket: "hollowboat1.firebasestorage.app",
  messagingSenderId: "728130419053",
  appId: "1:728130419053:web:76d3030cc19133924e4264",
  measurementId: "G-J7HXBWHHKJ"
};

firebase.initializeApp(firebaseConfig);
const firestoreDb = firebase.firestore();

const LEADERBOARD_MAX = 20;
const leaderboardDocRef = firestoreDb.collection("leaderboard").doc("top20");

// Returns the current Top 20 as [{name, score}, ...] sorted highest first.
// Empty array if the leaderboard doesn't exist yet (first-ever score).
async function fetchLeaderboard() {
  const snap = await leaderboardDocRef.get();
  if (!snap.exists) return [];
  const data = snap.data();
  return Array.isArray(data.entries) ? data.entries : [];
}

// Silent check — fetches the current list and compares against the lowest
// qualifying score. Always eligible if the board isn't full yet.
async function checkLeaderboardEligibility(score) {
  const entries = await fetchLeaderboard();
  if (entries.length < LEADERBOARD_MAX) return true;
  const lowestScore = entries[entries.length - 1].score; // entries are kept sorted descending
  return score > lowestScore;
}

// Re-fetches fresh, checks if the player already exists, updates their score 
// only if it's higher, sorts descending, and keeps only the top 20.
async function saveLeaderboardEntry(name, score) {
  const entries = await fetchLeaderboard();

  // 1. Check if this player is already on the leaderboard
  const existingIndex = entries.findIndex(e => e.name === name);
  
  if (existingIndex >= 0) {
    // Player exists! Only update them if this is a new high score
    if (score > entries[existingIndex].score) {
      entries[existingIndex].score = score;
      entries[existingIndex]._t = Date.now(); // update tiebreaker time
    }
  } else {
    // 2. Player is new, add them to the array
    entries.push({ name, score, _t: Date.now() });
  }

  // 3. Sort descending
  entries.sort((a, b) => b.score - a.score || (a._t || 0) - (b._t || 0));

  // 4. Trim to Top 20 and find their new rank
  const trimmedWithTiebreaker = entries.slice(0, LEADERBOARD_MAX);
  const rankIndex = trimmedWithTiebreaker.findIndex(e => e.name === name); // match by name now
  
  const trimmed = trimmedWithTiebreaker.map(({ name, score }) => ({ name, score }));

  // 5. Save back to Firestore
  await leaderboardDocRef.set({ entries: trimmed });

  return { rank: rankIndex >= 0 ? rankIndex + 1 : null, entries: trimmed };
}

// ---------- Core game (physics, collision, rendering) ----------
const Game = {
  canvas: null,
  ctx: null,
  width: 0,   // logical (CSS-pixel) canvas width — varies per device/orientation
  height: 0,  // logical (CSS-pixel) canvas height

  running: false,
  score: 0,
  coinsThisRun: 0,

  bird: { x: 0, y: 0, vy: 0, radius: 0 },
  pipes: [],

  // All of these are RATIOS, not raw pixels — the canvas can be a wide
  // 16:9 desktop frame or a tall phone screen, so every gameplay constant
  // is derived from the actual canvas size each time it's (re)sized. The
  // ratios below were reverse-engineered from values already tuned to
  // feel right at 960x540, so the feel is preserved everywhere.
  _ratios: {
    birdRadius: 0.0519,     // relative to height
    gravity: 0.000463,      // relative to height, applied per 60fps-equivalent frame
    flapStrength: -0.011481,// relative to height
    maxFallSpeed: 0.014815, // relative to height
    pipeGapY: 0.45,       // relative to height
    pipeWidth: 0.104167,    // relative to width
    basePipeGapX: 0.490,   // relative to width, at speed multiplier 1.0
    unitSpeed: 0.0020833    // relative to width, pipe speed AT multiplier 1.0
  },

  // Speed multiplier progression: adjusted for smooth playability
  speedMultiplierMin: 1.0,
  speedMultiplierMax: 2.5,       // Max 2.5x speed cap
  speedMultiplierStep: 0.25,     // Increases smoothly by 15% every 5 points
  speedMultiplierStepScore: 5,  // bump the step every N points

  speed: 0,        // current pipe speed, in real px/frame-equivalent (derived, not a ratio)
  _unitSpeed: 0,    // px/frame-equivalent at multiplier 1.0 for the current canvas size
  basePipeGapXPx: 0,
  pipeGapY: 0,
  pipeWidth: 0,
  gravity: 0,
  flapStrength: 0,
  maxFallSpeed: 0,

  skinImage: null,

  onScoreUpdate: null,   // callback(score) — drives HUD score display
  onGameOver: null,      // callback(finalScore, coinsEarned)

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  },

  // Sizes the canvas to whatever CSS gives it (full-bleed on mobile,
  // letterboxed 16:9 frame on desktop) and recalculates every gameplay
  // constant from that actual size. Also handles device pixel ratio so
  // it's crisp on high-DPI phone screens.
  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
    const cssHeight = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;

    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._recalcConstants();
  },

  _recalcConstants() {
    const r = this._ratios;
    this.bird.radius = this.height * r.birdRadius;
    this.gravity = this.height * r.gravity;
    this.flapStrength = this.height * r.flapStrength;
    this.maxFallSpeed = this.height * r.maxFallSpeed;
    this.pipeGapY = this.height * r.pipeGapY;
    this.pipeWidth = this.width * r.pipeWidth;
    this.basePipeGapXPx = this.width * r.basePipeGapX;
    this._unitSpeed = this.width * r.unitSpeed;
  },

  loadSkin(skinLevel) {
    const img = new Image();
    img.src = `images/Level${skinLevel}.png`;
    this.skinImage = img;
  },

  start(skinLevel) {
    this.loadSkin(skinLevel);
    this._recalcConstants();

    this.score = 0;
    this.coinsThisRun = 0;
    this.speed = this._unitSpeed * this.speedMultiplierMin;
    this.pipes = [];

    this.bird = {
      x: this.width * 0.25,
      y: this.height / 2,
      vy: 0,
      radius: this.height * this._ratios.birdRadius
    };

    this.running = true;
    this.paused = false;
    this._spawnInitialPipes();
    // Grace period in real milliseconds (not frame count) so it lasts the
    // same amount of real time regardless of screen refresh rate.
    this._graceMs = 500;
    this._lastTimestamp = null;
    requestAnimationFrame((t) => this._loop(t));
  },

  // Pausing stops the loop entirely (no wasted rAF calls) rather than just
  // skipping updates — the canvas simply freezes on its last rendered frame.
  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
  },

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Reset the timestamp so the first frame back doesn't see a huge
    // elapsed-time gap (which the dt clamp would otherwise have to eat).
    this._lastTimestamp = null;
    requestAnimationFrame((t) => this._loop(t));
  },

  flap() {
    if (!this.running || this.paused) return;
    this.bird.vy = this.flapStrength;

    const tap = document.getElementById("sfx-tap");
    if (tap) {
      tap.currentTime = 0;
      tap.play().catch(() => {}); // ignore autoplay-policy rejections
    }
  },

  _spawnInitialPipes() {
    let x = this.width + this.width * 0.27;
    for (let i = 0; i < 4; i++) {
      this._spawnPipe(x);
      x += this._currentPipeGapX();
    }
  },

  _currentPipeGapX() {
    const mobileMultiplier = this.width < 700 ? 1.5 : 1.0;
    // Returns a fixed physical distance, completely ignoring the current speed
    return this.basePipeGapXPx * mobileMultiplier;
  },
  
  _spawnPipe(x) {
    const margin = this.height * 0.074;
    const gapCenter = margin + Math.random() * (this.height - margin * 2 - this.pipeGapY) + this.pipeGapY / 2;
    this.pipes.push({ x, gapCenter, passed: false });
  },

  // Speed steps up gradually without breaking the pipe distance mechanics
  _updateDifficulty(dt) {
    const steps = Math.floor(this.score / this.speedMultiplierStepScore);
    let targetMultiplier = this.speedMultiplierMin + steps * this.speedMultiplierStep;
    if (targetMultiplier > this.speedMultiplierMax) targetMultiplier = this.speedMultiplierMax;

    const targetSpeed = this._unitSpeed * targetMultiplier;
    this.speed += (targetSpeed - this.speed) * 0.03 * dt;
  },

  _loop(timestamp) {
    if (!this.running || this.paused) return;

    if (this._lastTimestamp === null) this._lastTimestamp = timestamp;
    const elapsedMs = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    // dt = 1.0 at a perfect 60fps frame. Clamped so a dropped/backgrounded
    // tab resuming doesn't cause the bird to teleport through a pipe.
    const dt = Math.min(Math.max(elapsedMs / (1000 / 60), 0), 3);

    this._update(dt, elapsedMs);
    this._render();
    requestAnimationFrame((t) => this._loop(t));
  },

  _update(dt, elapsedMs) {
    this._updateDifficulty(dt);

    if (this._graceMs > 0) {
      this._graceMs -= elapsedMs;
      this.bird.vy *= 0.8;
    } else {
      this.bird.vy += this.gravity * dt;
      if (this.bird.vy > this.maxFallSpeed) this.bird.vy = this.maxFallSpeed;
    }
    this.bird.y += this.bird.vy * dt;

    if (this.bird.y + this.bird.radius >= this.height || this.bird.y - this.bird.radius <= 0) {
      this._gameOver();
      return;
    }

    for (const pipe of this.pipes) {
      pipe.x -= this.speed * dt;
    }

    if (this.pipes.length && this.pipes[0].x < -this.pipeWidth) {
      this.pipes.shift();
    }
    const rightmost = this.pipes[this.pipes.length - 1];
    if (rightmost && rightmost.x < this.width + this.width * 0.06 - this._currentPipeGapX()) {
      this._spawnPipe(rightmost.x + this._currentPipeGapX());
    }

    for (const pipe of this.pipes) {
      const withinX = this.bird.x + this.bird.radius > pipe.x &&
                       this.bird.x - this.bird.radius < pipe.x + this.pipeWidth;
      const topEdge = pipe.gapCenter - this.pipeGapY / 2;
      const bottomEdge = pipe.gapCenter + this.pipeGapY / 2;
      const withinGap = this.bird.y - this.bird.radius > topEdge &&
                         this.bird.y + this.bird.radius < bottomEdge;

      if (withinX && !withinGap) {
        this._gameOver();
        return;
      }

      if (!pipe.passed && pipe.x + this.pipeWidth < this.bird.x - this.bird.radius) {
        pipe.passed = true;
        this._onScore();
      }
    }
  },

  _onScore() {
    this.score += 1;
    this.coinsThisRun += 1;

    const point = document.getElementById("sfx-point");
    if (point) {
      point.currentTime = 0;
      point.play().catch(() => {}); // ignore autoplay-policy rejections
    }

    if (this.onScoreUpdate) this.onScoreUpdate(this.score);
  },

  _gameOver() {
    this.running = false;

    // Play game over sound
    const gameover = document.getElementById("sfx-gameover");
    if (gameover) {
        gameover.currentTime = 0;
        gameover.play().catch(() => {});
    }

    if (this.onGameOver) {
        this.onGameOver(this.score, this.coinsThisRun);
    }
  },

  // ---- Procedural pipe art (jade/stone pillar, no image file needed) ----
  _drawPipeSegment(ctx, x, segY, w, h, capAtBottom) {
    if (h <= 0) return;
    const capH = Math.max(18, h * 0.09);

    // Stone body
    const bodyGrad = ctx.createLinearGradient(x, 0, x + w, 0);
    bodyGrad.addColorStop(0, "#152f3d");
    bodyGrad.addColorStop(0.5, "#2f6e7d");
    bodyGrad.addColorStop(1, "#152f3d");
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x, segY, w, h);

    // Faint horizontal stone-block seams
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let ly = segY + 16; ly < segY + h - 4; ly += 30) {
      ctx.beginPath();
      ctx.moveTo(x + 4, ly);
      ctx.lineTo(x + w - 4, ly);
      ctx.stroke();
    }

    // Jade rim at the open end (the end facing the gap)
    const capY = capAtBottom ? segY + h - capH : segY;
    const capGrad = ctx.createLinearGradient(x - w * 0.07, 0, x + w + w * 0.07, 0);
    capGrad.addColorStop(0, "#0e2530");
    capGrad.addColorStop(0.5, "#6fe0d0");
    capGrad.addColorStop(1, "#0e2530");
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - w * 0.07, capY, w * 1.14, capH);

    // Soft glowing edge right at the gap boundary
    const glowY = capAtBottom ? capY + capH - 3 : capY;
    ctx.fillStyle = "rgba(190, 255, 245, 0.6)";
    ctx.fillRect(x - w * 0.07, glowY, w * 1.14, 3);
  },

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Pipes
    for (const pipe of this.pipes) {
      const topHeight = pipe.gapCenter - this.pipeGapY / 2;
      const bottomY = pipe.gapCenter + this.pipeGapY / 2;
      const bottomHeight = this.height - bottomY;

      this._drawPipeSegment(ctx, pipe.x, 0, this.pipeWidth, topHeight, true);
      this._drawPipeSegment(ctx, pipe.x, bottomY, this.pipeWidth, bottomHeight, false);
    }

    // Bird
    if (this.skinImage && this.skinImage.complete) {
      const size = this.bird.radius * 4.2;
      ctx.drawImage(this.skinImage, this.bird.x - size / 2, this.bird.y - size / 2, size, size);
    } else {
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(this.bird.x, this.bird.y, this.bird.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") Game.flap();
});
