// ============ ENGINE ============
// Local storage, skins, and core game physics/rendering — everything that
// is NOT screen/DOM management (that lives in app.js).

// ---------- Trail Length Settings ----------
const startrailsize = 25;    // Subtle sleek tail
const mastertrailsize = 55;  // Medium long comet
const elitetrailsize = 95;   // Extra long sweeping multi-strand tail

// ---------- Local storage ----------
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

// ---------- Skins & Smooth Pricing ----------
function tierForSkin(level) {
  if (level >= 10) return "Elite";
  if (level >= 7) return "Master";
  if (level >= 4) return "Star";
  return "Basic";
}

const SKINS = Array.from({ length: 12 }, (_, i) => {
  const level = i + 1;
  return {
    level,
    file: `images/Level${level}.png`,
    price: level === 1 ? 0 : 10 + (level - 2) * 14,
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

// ---------- Leaderboard (Firebase Firestore) ----------
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

async function fetchLeaderboard() {
  const snap = await leaderboardDocRef.get();
  if (!snap.exists) return [];
  const data = snap.data();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function checkLeaderboardEligibility(score) {
  const entries = await fetchLeaderboard();
  if (entries.length < LEADERBOARD_MAX) return true;
  const lowestScore = entries[entries.length - 1].score;
  return score > lowestScore;
}

async function saveLeaderboardEntry(name, score) {
  const entries = await fetchLeaderboard();
  const existingIndex = entries.findIndex(e => e.name === name);
  
  if (existingIndex >= 0) {
    if (score > entries[existingIndex].score) {
      entries[existingIndex].score = score;
      entries[existingIndex]._t = Date.now();
    }
  } else {
    entries.push({ name, score, _t: Date.now() });
  }

  entries.sort((a, b) => b.score - a.score || (a._t || 0) - (b._t || 0));

  const trimmedWithTiebreaker = entries.slice(0, LEADERBOARD_MAX);
  const rankIndex = trimmedWithTiebreaker.findIndex(e => e.name === name);
  const trimmed = trimmedWithTiebreaker.map(({ name, score }) => ({ name, score }));

  await leaderboardDocRef.set({ entries: trimmed });
  return { rank: rankIndex >= 0 ? rankIndex + 1 : null, entries: trimmed };
}

// ---------- Sleek Multi-Strand Comet Trail System ----------
class CometTrailSystem {
  constructor() {
    this.history = [];
    this.sparkles = [];
  }

  reset() {
    this.history = [];
    this.sparkles = [];
  }

  update(x, y, rotation, birdRadius, maxHistory, isFlapping) {
    if (maxHistory <= 0) {
      this.history = [];
      this.sparkles = [];
      return;
    }

    // Attach path slightly behind bird's tail end (no overlapping circle on body)
    const tailX = x - Math.cos(rotation) * (birdRadius * 0.85);
    const tailY = y - Math.sin(rotation) * (birdRadius * 0.85);

    this.history.unshift({ x: tailX, y: tailY });
    if (this.history.length > maxHistory) {
      this.history.pop();
    }

    // Spawn sprinkles drifting along the tail path
    const spawnCount = isFlapping ? 5 : 2;
    for (let i = 0; i < spawnCount; i++) {
      if (this.history.length < 3) break;
      const targetIdx = Math.floor(Math.random() * Math.min(25, this.history.length));
      const pos = this.history[targetIdx];
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 1.5;

      this.sparkles.push({
        x: pos.x + (Math.random() - 0.5) * 10,
        y: pos.y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed - 1.2,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 2.2 + 1.0,
        life: 1.0,
        decay: Math.random() * 0.03 + 0.015
      });
    }

    // Update sprinkles
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const p = this.sparkles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.size *= 0.97;
      if (p.life <= 0) this.sparkles.splice(i, 1);
    }
  }

  draw(ctx, birdRadius) {
    if (this.history.length < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // Additive laser cyan glow

    const total = this.history.length;

    // Helper to draw a single sleek tapered ribbon strand
    const drawStrand = (offsetY, strokeStyle, baseWidth) => {
      ctx.beginPath();
      for (let i = 0; i < total - 1; i++) {
        const p1 = this.history[i];
        const p2 = this.history[i + 1];
        const ratio = 1 - i / total; // Tapers down smoothly to tip

        // Slight wavy offset for multi-strand look
        const shiftY = Math.sin(i * 0.3) * offsetY * ratio;

        ctx.moveTo(p1.x, p1.y + shiftY);
        ctx.lineTo(p2.x, p2.y + shiftY);
        ctx.lineWidth = ratio * baseWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
      }
    };

    // --- Strand 1: Upper Sleek Cyan Ribbon ---
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawStrand(-3, "rgba(0, 212, 255, 0.6)", birdRadius * 0.30);

    // --- Strand 2: Center Intense Laser Core Ribbon ---
    drawStrand(0, "rgba(180, 245, 255, 0.95)", birdRadius * 0.42);

    // --- Strand 3: Lower Sleek Cyan Ribbon ---
    drawStrand(3, "rgba(0, 212, 255, 0.6)", birdRadius * 0.30);

    // --- Sprinkles / Sparkles ---
    this.sparkles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = "#80f0ff";
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fill();
    });

    ctx.restore();
  }
}

// ---------- Core Game Engine ----------
const Game = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,

  running: false,
  paused: false,
  dying: false,
  countingDown: false,
  _countdownInterval: null,
  score: 0,
  coinsThisRun: 0,

  bird: { x: 0, y: 0, vy: 0, radius: 0, rotation: 0 },
  pipes: [],
  
  cometTrail: new CometTrailSystem(),
  particles: [],
  currentSkinLevel: 1,

  _ratios: {
    birdRadius: 0.0519,
    gravity: 0.000463,
    flapStrength: -0.011481,
    maxFallSpeed: 0.014815,
    pipeGapY: 0.45,
    pipeWidth: 0.104167,
    basePipeGapX: 0.490,
    unitSpeed: 0.0020833
  },

  speedMultiplierMin: 1.4,
  speedMultiplierMax: 4.0,
  speedMultiplierStep: 0.25,
  speedMultiplierStepScore: 5,

  speed: 0,
  _unitSpeed: 0,
  basePipeGapXPx: 0,
  pipeGapY: 0,
  pipeWidth: 0,
  gravity: 0,
  flapStrength: 0,
  maxFallSpeed: 0,

  skinImage: null,

  onScoreUpdate: null,
  onGameOver: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    
    const s1 = document.getElementById("sfx-point");
    const s2 = document.getElementById("sfx-tap");
    if (s1) s1.volume = 0.7;
    if (s2) s2.volume = 0.7;
  },

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
    this.currentSkinLevel = skinLevel;
    const img = new Image();
    img.src = `images/Level${skinLevel}.png`;
    this.skinImage = img;
  },

  start(skinLevel) {
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }

    this.loadSkin(skinLevel);
    this._recalcConstants();

    this.score = 0;
    this.coinsThisRun = 0;
    this.speed = this._unitSpeed * this.speedMultiplierMin;
    this.pipes = [];
    this.cometTrail.reset();
    this.particles = [];

    this.bird = {
      x: this.width * 0.25,
      y: this.height / 2,
      vy: 0,
      radius: this.height * this._ratios.birdRadius,
      rotation: 0
    };

    this.running = true;
    this.paused = false;
    this.dying = false;
    this.countingDown = false;
    this._spawnInitialPipes();
    this._graceMs = 500;
    this._lastTimestamp = null;
    requestAnimationFrame((t) => this._loop(t));
  },

  togglePause() {
    if (!this.running || this.dying) return false;

    if (this.countingDown) {
      if (this._countdownInterval) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
      }
      this.countingDown = false;
      this.paused = true;
      return true;
    }

    if (!this.paused) {
      this.paused = true;
      return true;
    }
    return false;
  },

  unpauseWithCountdown(onTick, onComplete) {
    if (!this.paused || this.countingDown || this.dying) return;

    this.countingDown = true;
    let count = 3;
    onTick(count);

    if (this._countdownInterval) clearInterval(this._countdownInterval);

    this._countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        onTick(count);
      } else {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
        this.countingDown = false;
        this.paused = false;
        this._lastTimestamp = null;
        onComplete();
        requestAnimationFrame((t) => this._loop(t));
      }
    }, 700);
  },

  flap() {
    if (!this.running || this.paused || this.countingDown || this.dying) return;
    this.bird.vy = this.flapStrength;
    this._justFlapped = true;

    const tap = document.getElementById("sfx-tap");
    if (tap) {
      tap.volume = 0.7;
      tap.currentTime = 0;
      tap.play().catch(() => {});
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
    return this.basePipeGapXPx * mobileMultiplier;
  },
  
  _spawnPipe(x) {
    const margin = this.height * 0.074;
    const gapCenter = margin + Math.random() * (this.height - margin * 2 - this.pipeGapY) + this.pipeGapY / 2;
    this.pipes.push({ x, gapCenter, passed: false });
  },

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

    const dt = Math.min(Math.max(elapsedMs / (1000 / 60), 0), 3);

    this._update(dt, elapsedMs);
    this._render();
    requestAnimationFrame((t) => this._loop(t));
  },

  _update(dt, elapsedMs) {
    if (this.dying) {
      this.bird.vy += this.gravity * 1.8 * dt;
      this.bird.y += this.bird.vy * dt;
      this.bird.rotation = Math.min(Math.PI / 2, this.bird.rotation + 0.12 * dt);

      if (this.bird.y + this.bird.radius >= this.height) {
        this.bird.y = this.height - this.bird.radius;
        this._gameOver();
      }
      return;
    }

    this._updateDifficulty(dt);

    if (this._graceMs > 0) {
      this._graceMs -= elapsedMs;
      this.bird.vy *= 0.8;
    } else {
      this.bird.vy += this.gravity * dt;
      if (this.bird.vy > this.maxFallSpeed) this.bird.vy = this.maxFallSpeed;
    }
    this.bird.y += this.bird.vy * dt;

    const maxUpAngle = -0.32;
    const maxDownAngle = 1.2;
    if (this.bird.vy < 0) {
      this.bird.rotation = Math.max(maxUpAngle, this.bird.vy * 22);
    } else {
      this.bird.rotation = Math.min(maxDownAngle, this.bird.rotation + 0.04 * dt);
    }

    // Motion Trail Tracking per Tier
    const tier = tierForSkin(this.currentSkinLevel);
    let maxTrailLength = 0;
    if (tier === "Star") maxTrailLength = startrailsize;
    else if (tier === "Master") maxTrailLength = mastertrailsize;
    else if (tier === "Elite") maxTrailLength = elitetrailsize;

    this.cometTrail.update(this.bird.x, this.bird.y, this.bird.rotation, this.bird.radius, maxTrailLength, this._justFlapped);
    this._justFlapped = false;

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= 0.03 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Ground/Ceiling Boundary
    if (this.bird.y + this.bird.radius >= this.height || this.bird.y - this.bird.radius <= 0) {
      this._triggerCollision();
      return;
    }

    // Pipe Updates
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

    // Pipe Collisions
    for (const pipe of this.pipes) {
      const withinX = this.bird.x + this.bird.radius > pipe.x &&
                       this.bird.x - this.bird.radius < pipe.x + this.pipeWidth;
      const topEdge = pipe.gapCenter - this.pipeGapY / 2;
      const bottomEdge = pipe.gapCenter + this.pipeGapY / 2;
      const withinGap = this.bird.y - this.bird.radius > topEdge &&
                         this.bird.y + this.bird.radius < bottomEdge;

      if (withinX && !withinGap) {
        this._triggerCollision();
        return;
      }

      if (!pipe.passed && pipe.x + this.pipeWidth < this.bird.x - this.bird.radius) {
        pipe.passed = true;
        this._onScore();
      }
    }
  },

  _triggerCollision() {
    this.dying = true;
    this.bird.vy = Math.min(-this.flapStrength * 0.4, -0.003 * this.height);
  },

  _onScore() {
    this.score += 1;
    this.coinsThisRun += 1;
    this._spawnGoldenSparkles(this.bird.x, this.bird.y);

    const point = document.getElementById("sfx-point");
    if (point) {
      point.volume = 0.7;
      point.currentTime = 0;
      point.play().catch(() => {});
    }

    if (this.onScoreUpdate) this.onScoreUpdate(this.score);
  },

  _spawnGoldenSparkles(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 15,
        y: y + (Math.random() - 0.5) * 15,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1.0,
        type: "star",
        size: 3 + Math.random() * 4
      });
    }
    this.particles.push({
      x: x + 10,
      y: y - 10,
      vx: 0.5,
      vy: -1.2,
      life: 1.0,
      type: "text",
      text: "+1"
    });
  },

  _gameOver() {
    this.running = false;
    this.dying = false;

    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }

    const gameover = document.getElementById("sfx-gameover");
    if (gameover) {
      gameover.currentTime = 0;
      gameover.play().catch(() => {});
    }

    if (this.onGameOver) {
      this.onGameOver(this.score, this.coinsThisRun);
    }
  },

  _drawPipeSegment(ctx, x, segY, w, h, capAtBottom) {
    if (h <= 0) return;
    const capH = Math.max(18, h * 0.09);

    const bodyGrad = ctx.createLinearGradient(x, 0, x + w, 0);
    bodyGrad.addColorStop(0, "#152f3d");
    bodyGrad.addColorStop(0.5, "#2f6e7d");
    bodyGrad.addColorStop(1, "#152f3d");
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x, segY, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let ly = segY + 16; ly < segY + h - 4; ly += 30) {
      ctx.beginPath();
      ctx.moveTo(x + 4, ly);
      ctx.lineTo(x + w - 4, ly);
      ctx.stroke();
    }

    const capY = capAtBottom ? segY + h - capH : segY;
    const capGrad = ctx.createLinearGradient(x - w * 0.07, 0, x + w + w * 0.07, 0);
    capGrad.addColorStop(0, "#0e2530");
    capGrad.addColorStop(0.5, "#6fe0d0");
    capGrad.addColorStop(1, "#0e2530");
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - w * 0.07, capY, w * 1.14, capH);

    const glowY = capAtBottom ? capY + capH - 3 : capY;
    ctx.fillStyle = "rgba(190, 255, 245, 0.6)";
    ctx.fillRect(x - w * 0.07, glowY, w * 1.14, 3);
  },

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Pipes
    for (const pipe of this.pipes) {
      const topHeight = pipe.gapCenter - this.pipeGapY / 2;
      const bottomY = pipe.gapCenter + this.pipeGapY / 2;
      const bottomHeight = this.height - bottomY;

      this._drawPipeSegment(ctx, pipe.x, 0, this.pipeWidth, topHeight, true);
      this._drawPipeSegment(ctx, pipe.x, bottomY, this.pipeWidth, bottomHeight, false);
    }

    // 2. Draw Sleek Multi-Strand Comet Trail Behind Bird
    this.cometTrail.draw(ctx, this.bird.radius);

    // 3. Draw Bird Sprite (Clean, no background circle)
    const size = this.bird.radius * 4.2;
    ctx.save();
    ctx.translate(this.bird.x, this.bird.y);
    ctx.rotate(this.bird.rotation);

    if (this.skinImage && this.skinImage.complete) {
      ctx.drawImage(this.skinImage, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(0, 0, this.bird.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 4. Draw Score Sparkles & Floating Text
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      if (p.type === "star") {
        ctx.fillStyle = "#ffe600";
        ctx.shadowColor = "#ffaa00";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "text") {
        ctx.font = "bold 18px sans-serif";
        ctx.fillStyle = "#ffd700";
        ctx.shadowColor = "#000000";
        ctx.shadowBlur = 4;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.restore();
    }
  }
};

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") Game.flap();
});
