// =========================================================================
// CINEMATIC TAPERED POLYGON & VELOCITY-REACTIVE COMET TRAIL SYSTEM
// =========================================================================
const TRAIL_CONFIG = {
  MIN_POINT_DISTANCE: 6,       // Minimum px bird moves before dropping a point
  SPARKLE_SPAWN_INTERVAL: 2,   // Throttled sparkle emission
  MAX_SPARKLES: 30,            // Strict particle cap for mobile performance
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

  /**
   * Updates trail position, calculates velocity dynamics, and spawns particles.
   */
  update(x, y, vy, rotation, birdRadius, tier) {
    const tierConfig = TRAIL_CONFIG.TIER_SETTINGS[tier] || TRAIL_CONFIG.TIER_SETTINGS.Basic;
    if (tierConfig.maxPoints <= 0) {
      this.history = [];
      this.sparkles = [];
      return;
    }

    // 1. Calculate Velocity & Flap Boost Dynamics
    // Fast downward movement or upward flaps stretch the tail and boost glow width
    const speed = Math.abs(vy);
    const targetVelFactor = Math.min(Math.max(1.0 + speed * 45, 0.9), 2.2);
    this.currentVelocityFactor += (targetVelFactor - this.currentVelocityFactor) * 0.15;

    // Organic plasma pulse cycle
    this.energyPulse += 0.12;

    // 2. Attachment Point (Rear Feathers)
    const attachX = x - Math.cos(rotation) * (birdRadius * 0.85);
    const attachY = y - Math.sin(rotation) * (birdRadius * 0.85);

    // 3. Distance-Based Sampling with Velocity-Scaled Point Cap
    const dynamicMaxPoints = Math.round(tierConfig.maxPoints * (0.8 + this.currentVelocityFactor * 0.25));

    if (this.history.length === 0) {
      this.history.unshift({ x: attachX, y: attachY, time: Date.now() });
    } else {
      // Keep position 0 locked flush to the bird
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

    // 4. Sparkle Particle Emitter (Throttled & Velocity Boosted)
    this.frameCounter++;
    const spawnRate = vy < -0.002 ? 1 : TRAIL_CONFIG.SPARKLE_SPAWN_INTERVAL; // Spawn faster on flap
    
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

    // Update Sparkle Lifespans
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

  /**
   * Generates smooth curve samples from history points using Quadratic Bézier Splines.
   */
  _getSampledSplinePoints() {
    if (this.history.length < 3) return [];

    const samples = [];
    const pts = this.history;

    // Interpolate history points into finely spaced smooth curve points
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      // Add midpoint samples
      if (i === 0) {
        samples.push({ x: p0.x, y: p0.y });
      }
      samples.push({ x: midX, y: midY });
    }
    samples.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });

    // Apply subtle energy waviness (plasma oscillation) to tail points
    for (let i = 2; i < samples.length; i++) {
      const t = i / samples.length;
      const wave = Math.sin(this.energyPulse + i * 0.4) * (t * 2.2);
      samples[i].y += wave;
    }

    return samples;
  }

  /**
   * Builds left and right boundary vertices for a true variable-width tapered polygon ribbon.
   */
  _buildTaperedRibbonMesh(samples, maxHeadWidth) {
    if (samples.length < 2) return null;

    const leftSide = [];
    const rightSide = [];
    const total = samples.length;

    for (let i = 0; i < total; i++) {
      const current = samples[i];
      let dirX = 0;
      let dirY = 0;

      // Compute tangent vector along curve
      if (i < total - 1) {
        dirX = samples[i + 1].x - current.x;
        dirY = samples[i + 1].y - current.y;
      } else {
        dirX = current.x - samples[i - 1].x;
        dirY = current.y - samples[i - 1].y;
      }

      const len = Math.hypot(dirX, dirY) || 1;
      // Perpendicular normal vector (-dy, dx)
      const nx = -dirY / len;
      const ny = dirX / len;

      // Non-linear power taper: Thick head -> Smooth cone tapering to sharp point at tip
      const progress = i / (total - 1); // 0.0 at bird head, 1.0 at tail tip
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

  /**
   * Trace the continuous closed polygon path into canvas context.
   */
  _traceRibbonPolygon(ctx, mesh) {
    const { leftSide, rightSide } = mesh;
    ctx.beginPath();
    
    // Trace down the left side (head -> tail)
    ctx.moveTo(leftSide[0].x, leftSide[0].y);
    for (let i = 1; i < leftSide.length; i++) {
      ctx.lineTo(leftSide[i].x, leftSide[i].y);
    }

    // Trace back up the right side (tail -> head)
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

    // Calculate dynamic head widths based on bird size and velocity
    const baseHeadWidth = birdRadius * 1.25 * tierConfig.baseWidthMult * this.currentVelocityFactor;
    const outerMesh = this._buildTaperedRibbonMesh(samples, baseHeadWidth);
    const innerMesh = this._buildTaperedRibbonMesh(samples, baseHeadWidth * 0.45);
    const coreMesh  = this._buildTaperedRibbonMesh(samples, baseHeadWidth * 0.20);

    if (!outerMesh) return;

    const head = outerMesh.head;
    const tail = outerMesh.tail;

    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // Additive energy bloom mode

    // -----------------------------------------------------------------
    // PASS 1: AMBIENT GLOW & NEON AURA (Wide Bloom + ShadowBlur)
    // -----------------------------------------------------------------
    const glowGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    glowGrad.addColorStop(0.0, "rgba(0, 212, 255, 0.75)");
    glowGrad.addColorStop(0.4, "rgba(0, 140, 255, 0.35)");
    glowGrad.addColorStop(1.0, "rgba(0, 40, 200, 0.0)");

    ctx.shadowBlur = birdRadius * 0.95;
    ctx.shadowColor = "#00d4ff";
    ctx.fillStyle = glowGrad;

    this._traceRibbonPolygon(ctx, outerMesh);
    ctx.fill();

    // -----------------------------------------------------------------
    // PASS 2: MAIN NEON CYAN TAPERED ENERGY RIBBON
    // -----------------------------------------------------------------
    ctx.shadowBlur = 0; // Turn off shadow blur for crisp inner layers
    const ribbonGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    ribbonGrad.addColorStop(0.0, "rgba(0, 240, 255, 0.95)");
    ribbonGrad.addColorStop(0.5, "rgba(0, 180, 255, 0.60)");
    ribbonGrad.addColorStop(1.0, "rgba(0, 100, 255, 0.0)");

    ctx.fillStyle = ribbonGrad;
    this._traceRibbonPolygon(ctx, innerMesh);
    ctx.fill();

    // -----------------------------------------------------------------
    // PASS 3: HOT WHITE LASER CORE
    // -----------------------------------------------------------------
    const coreGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    coreGrad.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    coreGrad.addColorStop(0.3, "rgba(220, 250, 255, 0.85)");
    coreGrad.addColorStop(1.0, "rgba(0, 212, 255, 0.0)");

    ctx.fillStyle = coreGrad;
    this._traceRibbonPolygon(ctx, coreMesh);
    ctx.fill();

    // -----------------------------------------------------------------
    // PASS 4: STARDUST SPARKLES
    // -----------------------------------------------------------------
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
