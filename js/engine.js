// =========================================================================
// 1. SKINS & CONFIGURATION
// =========================================================================
const SKINS = [
  { level: 1, tier: "Basic",  price: 0,   file: "skin1.png" },
  { level: 2, tier: "Star",   price: 50,  file: "skin2.png" },
  { level: 3, tier: "Master", price: 150, file: "skin3.png" },
  { level: 4, tier: "Elite",  price: 300, file: "skin4.png" }
];

function tierForSkin(level) {
  const skin = SKINS.find(s => s.level === level);
  return skin ? skin.tier : "Basic";
}

// =========================================================================
// 2. LOCAL STATE MANAGEMENT
// =========================================================================
const LocalState = {
  getCoins: () => parseInt(localStorage.getItem("coins") || "0", 10),
  setCoins: (coins) => localStorage.setItem("coins", coins.toString()),

  getUnlockedSkins: () => parseInt(localStorage.getItem("unlockedSkins") || "1", 10),
  setUnlockedSkins: (lvl) => localStorage.setItem("unlockedSkins", lvl.toString()),

  getCurrentSkin: () => parseInt(localStorage.getItem("currentSkin") || "1", 10),
  setCurrentSkin: (lvl) => localStorage.setItem("currentSkin", lvl.toString()),

  getHighScore: () => parseInt(localStorage.getItem("highScore") || "0", 10),
  setHighScore: (score) => localStorage.setItem("highScore", score.toString()),

  getPlayerName: () => localStorage.getItem("playerName") || "",
  setPlayerName: (name) => localStorage.setItem("playerName", name)
};

function equipSkin(level) {
  if (level <= LocalState.getUnlockedSkins()) {
    LocalState.setCurrentSkin(level);
  }
}

function tryUnlockNextSkin() {
  const unlocked = LocalState.getUnlockedSkins();
  const nextSkin = SKINS.find(s => s.level === unlocked + 1);
  if (!nextSkin) return { success: false, reason: "All skins unlocked!" };

  const coins = LocalState.getCoins();
  if (coins < nextSkin.price) return { success: false, reason: "Not enough coins!" };

  LocalState.setCoins(coins - nextSkin.price);
  LocalState.setUnlockedSkins(nextSkin.level);
  LocalState.setCurrentSkin(nextSkin.level);
  return { success: true };
}

// =========================================================================
// 3. LEADERBOARD API (LocalStorage / Backend Connector)
// =========================================================================
async function fetchLeaderboard() {
  try {
    const data = localStorage.getItem("game_leaderboard_entries");
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error("Failed to read leaderboard", err);
    return [];
  }
}

async function checkLeaderboardEligibility(score) {
  if (score <= 0) return false;
  const entries = await fetchLeaderboard();
  if (entries.length < 20) return true;
  return score > entries[entries.length - 1].score;
}

async function saveLeaderboardEntry(name, score) {
  let entries = await fetchLeaderboard();
  
  // Check if player already exists in leaderboard and update if higher
  const existingIndex = entries.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (existingIndex !== -1) {
    if (score > entries[existingIndex].score) {
      entries[existingIndex].score = score;
    }
  } else {
    entries.push({ name, score, date: Date.now() });
  }

  // Sort descending and keep Top 20
  entries.sort((a, b) => b.score - a.score);
  entries = entries.slice(0, 20);

  localStorage.setItem("game_leaderboard_entries", JSON.stringify(entries));

  const rank = entries.findIndex(e => e.name.toLowerCase() === name.toLowerCase()) + 1;
  return { rank: rank > 0 ? rank : null };
}

// =========================================================================
// 4. CINEMATIC TAPERED POLYGON COMET TRAIL SYSTEM
// =========================================================================
const TRAIL_CONFIG = {
  MIN_POINT_DISTANCE: 6,
  SPARKLE_SPAWN_INTERVAL: 2,
  MAX_SPARKLES: 30,
  TIER_SETTINGS: {
    Basic:  { maxPoints: 0,  baseLengthMult: 0.0, baseWidthMult: 0.0 },
    Star:   { maxPoints: 24, baseLengthMult: 1.2, baseWidthMult: 0.45 },
    Master: { maxPoints: 48, baseLengthMult: 2.0, baseWidthMult: 0.70 },
    Elite:  { maxPoints: 75, baseLengthMult: 3.2, baseWidthMult: 0.95 }
  }
};

class CometTrailSystem {
  constructor() {
    this.history = [];
    this.sparkles = [];
    this.frameCounter = 0;
    this.energyPulse = 0;
    this.currentVelocityFactor = 1.0;
  }

  reset() {
    this.history = [];
    this.sparkles = [];
    this.frameCounter = 0;
    this.energyPulse = 0;
    this.currentVelocityFactor = 1.0;
  }

  update(x, y, vy, rotation, birdRadius, tier) {
    const tierConfig = TRAIL_CONFIG.TIER_SETTINGS[tier] || TRAIL_CONFIG.TIER_SETTINGS.Basic;
    if (tierConfig.maxPoints <= 0) {
      this.history = [];
      this.sparkles = [];
      return;
    }

    const speed = Math.abs(vy);
    const targetVelFactor = Math.min(Math.max(1.0 + speed * 0.003, 0.9), 2.2);
    this.currentVelocityFactor += (targetVelFactor - this.currentVelocityFactor) * 0.15;

    this.energyPulse += 0.12;

    const attachX = x - Math.cos(rotation) * (birdRadius * 0.85);
    const attachY = y - Math.sin(rotation) * (birdRadius * 0.85);

    const dynamicMaxPoints = Math.round(tierConfig.maxPoints * (0.8 + this.currentVelocityFactor * 0.25));

    if (this.history.length === 0) {
      this.history.unshift({ x: attachX, y: attachY, time: Date.now() });
    } else {
      this.history[0] = { x: attachX, y: attachY, time: Date.now() };

      const prevPoint = this.history[1] || this.history[0];
      const dx = attachX - prevPoint.x;
      const dy = attachY - prevPoint.y;
      const distSq = dx * dx + dy * dy;

      if (distSq >= TRAIL_CONFIG.MIN_POINT_DISTANCE * TRAIL_CONFIG.MIN_POINT_DISTANCE) {
        this.history.splice(1, 0, { x: attachX, y: attachY, time: Date.now() });
      }
    }

    if (this.history.length > dynamicMaxPoints) {
      this.history.length = dynamicMaxPoints;
    }

    this.frameCounter++;
    const spawnRate = vy < -50 ? 1 : TRAIL_CONFIG.SPARKLE_SPAWN_INTERVAL;

    if (this.frameCounter % spawnRate === 0 && this.history.length > 5) {
      if (this.sparkles.length < TRAIL_CONFIG.MAX_SPARKLES) {
        const randIdx = Math.floor(Math.random() * Math.min(20, this.history.length));
        const p = this.history[randIdx];
        const spread = birdRadius * 0.35;
        this.sparkles.push({
          x: p.x + (Math.random() - 0.5) * spread,
          y: p.y + (Math.random() - 0.5) * spread,
          vx: (Math.random() - 0.5) * 1.5 - 1.2,
          vy: (Math.random() - 0.5) * 1.5,
          size: Math.random() * 2.5 + 1.0,
          alpha: 1.0,
          decay: Math.random() * 0.04 + 0.025
        });
      }
    }

    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.x += s.vx;
      s.y += s.vy;
      s.alpha -= s.decay;
      if (s.alpha <= 0) {
        this.sparkles.splice(i, 1);
      }
    }
  }

  _getSampledSplinePoints() {
    if (this.history.length < 3) return [];

    const samples = [];
    const pts = this.history;

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      if (i === 0) {
        samples.push({ x: p0.x, y: p0.y });
      }
      samples.push({ x: midX, y: midY });
    }
    samples.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });

    for (let i = 2; i < samples.length; i++) {
      const t = i / samples.length;
      const wave = Math.sin(this.energyPulse + i * 0.4) * (t * 2.2);
      samples[i].y += wave;
    }

    return samples;
  }

  _buildTaperedRibbonMesh(samples, maxHeadWidth) {
    if (samples.length < 2) return null;

    const leftSide = [];
    const rightSide = [];
    const total = samples.length;

    for (let i = 0; i < total; i++) {
      const current = samples[i];
      let dirX = 0;
      let dirY = 0;

      if (i < total - 1) {
        dirX = samples[i + 1].x - current.x;
        dirY = samples[i + 1].y - current.y;
      } else {
        dirX = current.x - samples[i - 1].x;
        dirY = current.y - samples[i - 1].y;
      }

      const len = Math.hypot(dirX, dirY) || 1;
      const nx = -dirY / len;
      const ny = dirX / len;

      const progress = i / (total - 1);
      const taperFactor = Math.pow(1 - progress, 1.2);
      const currentWidth = maxHeadWidth * taperFactor;

      leftSide.push({
        x: current.x + nx * (currentWidth / 2),
        y: current.y + ny * (currentWidth / 2)
      });
      rightSide.push({
        x: current.x - nx * (currentWidth / 2),
        y: current.y - ny * (currentWidth / 2)
      });
    }

    return { leftSide, rightSide, head: samples[0], tail: samples[samples.length - 1] };
  }

  _traceRibbonPolygon(ctx, mesh) {
    const { leftSide, rightSide } = mesh;
    ctx.beginPath();
    ctx.moveTo(leftSide[0].x, leftSide[0].y);
    for (let i = 1; i < leftSide.length; i++) {
      ctx.lineTo(leftSide[i].x, leftSide[i].y);
    }
    for (let i = rightSide.length - 1; i >= 0; i--) {
      ctx.lineTo(rightSide[i].x, rightSide[i].y);
    }
    ctx.closePath();
  }

  draw(ctx, birdRadius, tier) {
    if (this.history.length < 3) return;

    const tierConfig = TRAIL_CONFIG.TIER_SETTINGS[tier] || TRAIL_CONFIG.TIER_SETTINGS.Basic;
    if (tierConfig.baseWidthMult <= 0) return;

    const samples = this._getSampledSplinePoints();
    if (samples.length < 2) return;

    const baseHeadWidth = birdRadius * 1.25 * tierConfig.baseWidthMult * this.currentVelocityFactor;
    const outerMesh = this._buildTaperedRibbonMesh(samples, baseHeadWidth);
    const innerMesh = this._buildTaperedRibbonMesh(samples, baseHeadWidth * 0.45);
    const coreMesh  = this._buildTaperedRibbonMesh(samples, baseHeadWidth * 0.20);

    if (!outerMesh) return;

    const head = outerMesh.head;
    const tail = outerMesh.tail;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Glow Aura Pass
    const glowGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    glowGrad.addColorStop(0.0, "rgba(0, 212, 255, 0.75)");
    glowGrad.addColorStop(0.4, "rgba(0, 140, 255, 0.35)");
    glowGrad.addColorStop(1.0, "rgba(0, 40, 200, 0.0)");

    ctx.shadowBlur = birdRadius * 0.95;
    ctx.shadowColor = "#00d4ff";
    ctx.fillStyle = glowGrad;
    this._traceRibbonPolygon(ctx, outerMesh);
    ctx.fill();

    // Main Tapered Ribbon Pass
    ctx.shadowBlur = 0;
    const ribbonGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    ribbonGrad.addColorStop(0.0, "rgba(0, 240, 255, 0.95)");
    ribbonGrad.addColorStop(0.5, "rgba(0, 180, 255, 0.60)");
    ribbonGrad.addColorStop(1.0, "rgba(0, 100, 255, 0.0)");

    ctx.fillStyle = ribbonGrad;
    this._traceRibbonPolygon(ctx, innerMesh);
    ctx.fill();

    // Core Laser Pass
    const coreGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    coreGrad.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    coreGrad.addColorStop(0.3, "rgba(220, 250, 255, 0.85)");
    coreGrad.addColorStop(1.0, "rgba(0, 212, 255, 0.0)");

    ctx.fillStyle = coreGrad;
    this._traceRibbonPolygon(ctx, coreMesh);
    ctx.fill();

    // Sparkles Pass
    for (let i = 0; i < this.sparkles.length; i++) {
      const s = this.sparkles[i];
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = "#a6f5ff";
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.fill();
    }

    ctx.restore();
  }
}

// =========================================================================
// 5. MAIN GAME ENGINE OBJECT
// =========================================================================
const Game = {
  canvas: null,
  ctx: null,
  running: false,
  paused: false,
  countingDown: false,
  score: 0,
  coinsEarnedThisRun: 0,
  currentSkinLevel: 1,
  lastTime: 0,

  bird: {
    x: 80,
    y: 200,
    vy: 0,
    radius: 18,
    rotation: 0,
    gravity: 1100,
    jump: -350
  },

  pipes: [],
  coins: [],
  pipeTimer: 0,
  pipeInterval: 1.6,
  pipeSpeed: 180,
  pipeGap: 140,
  groundHeight: 60,

  skinImages: {},
  cometTrail: null,

  onScoreUpdate: null,
  onGameOver: null,

  init(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext("2d");
    this.cometTrail = new CometTrailSystem();
    this.preloadSkinImages();
  },

  preloadSkinImages() {
    SKINS.forEach(skin => {
      const img = new Image();
      img.src = skin.file;
      this.skinImages[skin.level] = img;
    });
  },

  start(skinLevel) {
    this.currentSkinLevel = skinLevel || 1;
    this.running = true;
    this.paused = false;
    this.countingDown = false;
    this.score = 0;
    this.coinsEarnedThisRun = 0;

    // Center bird vertically
    this.bird.x = Math.round((this.canvas.width || 400) * 0.25);
    this.bird.y = Math.round((this.canvas.height || 600) / 2);
    this.bird.vy = 0;
    this.bird.rotation = 0;

    this.pipes = [];
    this.coins = [];
    this.pipeTimer = 0;

    if (this.cometTrail) {
      this.cometTrail.reset();
    }

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  flap() {
    if (!this.running || this.paused || this.countingDown) return;
    this.bird.vy = this.bird.jump;
  },

  togglePause() {
    if (!this.running || this.countingDown) return false;
    this.paused = !this.paused;
    if (!this.paused) {
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }
    return true;
  },

  unpauseWithCountdown(onTick, onComplete) {
    this.countingDown = true;
    let count = 3;
    onTick(count);

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        onTick(count);
      } else {
        clearInterval(timer);
        this.countingDown = false;
        this.paused = false;
        onComplete();
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
      }
    }, 1000);
  },

  loop(now) {
    if (!this.running || this.paused) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.update(dt);
    this.render();

    if (this.running && !this.paused) {
      requestAnimationFrame((t) => this.loop(t));
    }
  },

  update(dt) {
    // Bird gravity physics
    this.bird.vy += this.bird.gravity * dt;
    this.bird.y += this.bird.vy * dt;

    // Smooth tilt rotation
    this.bird.rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, this.bird.vy * 0.002));

    // Floor collision
    const floorY = this.canvas.height - this.groundHeight;
    if (this.bird.y + this.bird.radius >= floorY) {
      this.bird.y = floorY - this.bird.radius;
      this.triggerGameOver();
      return;
    }

    // Ceiling collision
    if (this.bird.y - this.bird.radius <= 0) {
      this.bird.y = this.bird.radius;
      this.bird.vy = 0;
    }

    // Motion Trail Update
    const tier = tierForSkin(this.currentSkinLevel);
    this.cometTrail.update(
      this.bird.x,
      this.bird.y,
      this.bird.vy,
      this.bird.rotation,
      this.bird.radius,
      tier
    );

    // Pipe Spawning
    this.pipeTimer += dt;
    if (this.pipeTimer >= this.pipeInterval) {
      this.pipeTimer = 0;
      this.spawnPipe();
    }

    // Pipe & Coin Collision Updates
    this.updatePipesAndCoins(dt);
  },

  spawnPipe() {
    const minHeight = 50;
    const maxHeight = this.canvas.height - this.groundHeight - this.pipeGap - minHeight;
    const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
    const pipeWidth = 54;
    const pipeX = this.canvas.width;

    this.pipes.push({
      x: pipeX,
      topHeight: topHeight,
      bottomY: topHeight + this.pipeGap,
      width: pipeWidth,
      passed: false
    });

    // Spawn coin inside gap with 60% probability
    if (Math.random() < 0.6) {
      this.coins.push({
        x: pipeX + pipeWidth / 2,
        y: topHeight + this.pipeGap / 2,
        radius: 10,
        collected: false
      });
    }
  },

  updatePipesAndCoins(dt) {
    // Process Pipes
    for (let i = this.pipes.length - 1; i >= 0; i--) {
      const p = this.pipes[i];
      p.x -= this.pipeSpeed * dt;

      // Score Tracking
      if (!p.passed && p.x + p.width < this.bird.x) {
        p.passed = true;
        this.score++;
        if (this.onScoreUpdate) this.onScoreUpdate(this.score);
      }

      // Pipe Collisions
      if (
        this.bird.x + this.bird.radius > p.x &&
        this.bird.x - this.bird.radius < p.x + p.width
      ) {
        if (
          this.bird.y - this.bird.radius < p.topHeight ||
          this.bird.y + this.bird.radius > p.bottomY
        ) {
          this.triggerGameOver();
          return;
        }
      }

      // Cleanup off-screen pipes
      if (p.x + p.width < -20) {
        this.pipes.splice(i, 1);
      }
    }

    // Process Coins
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.x -= this.pipeSpeed * dt;

      if (!c.collected) {
        const dx = this.bird.x - c.x;
        const dy = this.bird.y - c.y;
        if (Math.hypot(dx, dy) < this.bird.radius + c.radius) {
          c.collected = true;
          this.coinsEarnedThisRun++;
        }
      }

      if (c.x + c.radius < -20 || c.collected) {
        this.coins.splice(i, 1);
      }
    }
  },

  triggerGameOver() {
    this.running = false;
    if (this.onGameOver) {
      this.onGameOver(this.score, this.coinsEarnedThisRun);
    }
  },

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. World Background
    this.ctx.fillStyle = "#111827";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. Draw Pipes
    this.ctx.fillStyle = "#10b981";
    this.ctx.strokeStyle = "#047857";
    this.ctx.lineWidth = 3;

    this.pipes.forEach(p => {
      // Top pipe
      this.ctx.fillRect(p.x, 0, p.width, p.topHeight);
      this.ctx.strokeRect(p.x, 0, p.width, p.topHeight);

      // Bottom pipe
      const bHeight = this.canvas.height - this.groundHeight - p.bottomY;
      this.ctx.fillRect(p.x, p.bottomY, p.width, bHeight);
      this.ctx.strokeRect(p.x, p.bottomY, p.width, bHeight);
    });

    // 3. Draw Collectible Coins
    this.coins.forEach(c => {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = "#fbbf24";
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "#f59e0b";
      this.ctx.fill();
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.stroke();
      this.ctx.restore();
    });

    // 4. Ground
    this.ctx.fillStyle = "#1f2937";
    this.ctx.fillRect(0, this.canvas.height - this.groundHeight, this.canvas.width, this.groundHeight);
    this.ctx.fillStyle = "#10b981";
    this.ctx.fillRect(0, this.canvas.height - this.groundHeight, this.canvas.width, 8);

    // 5. Draw Tapered Comet Trail (Behind Bird)
    const tier = tierForSkin(this.currentSkinLevel);
    this.cometTrail.draw(this.ctx, this.bird.radius, tier);

    // 6. Draw Bird / Active Skin
    this.ctx.save();
    this.ctx.translate(this.bird.x, this.bird.y);
    this.ctx.rotate(this.bird.rotation);

    const skinImg = this.skinImages[this.currentSkinLevel];
    if (skinImg && skinImg.complete && skinImg.naturalWidth !== 0) {
      const size = this.bird.radius * 2.5;
      this.ctx.drawImage(skinImg, -size / 2, -size / 2, size, size);
    } else {
      // Fallback Bird Circle
      this.ctx.beginPath();
      this.ctx.arc(0, 0, this.bird.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = "#00d4ff";
      this.ctx.fill();
      this.ctx.lineWidth = 2.5;
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.stroke();
    }

    this.ctx.restore();
  }
};
