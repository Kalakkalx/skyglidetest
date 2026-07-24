// ============ APP ============
// Screen/UI management and all event wiring — the DOM-facing half of the
// game (engine.js holds state/physics/Firebase and has no DOM dependencies
// of its own besides reading a couple of #ids).

const UI = {
  skinsReturnTo: "screen-opening", // where "BACK" on the Skins screen goes
  _pendingLeaderboardScore: 0,     // score awaiting a possible Top 20 save

  showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  },

  // ---------- Opening screen ----------
  goToOpening() {
    this.showScreen("screen-opening");
  },

  // ---------- Skins screen ----------
  goToSkins(returnTo) {
    this.skinsReturnTo = returnTo || "screen-opening";
    this.renderSkinsGrid();
    this.showScreen("screen-skins");
  },

  renderSkinsGrid() {
    const grid = document.getElementById("skins-grid");
    grid.innerHTML = "";
    document.getElementById("skins-coin-count").textContent = LocalState.getCoins();

    const unlocked = LocalState.getUnlockedSkins();
    const current = LocalState.getCurrentSkin();
    const coins = LocalState.getCoins();

    SKINS.forEach(skin => {
      const isUnlocked = skin.level <= unlocked;
      const isNext = skin.level === unlocked + 1;
      const isEquipped = skin.level === current;

      const card = document.createElement("div");
      card.className = `skin-card ${isUnlocked ? "" : "locked"}`;

      const img = document.createElement("img");
      img.src = skin.file;
      card.appendChild(img);

      const name = document.createElement("div");
      name.className = "skin-name";
      name.textContent = `Level ${skin.level}`;
      card.appendChild(name);

      const tier = document.createElement("div");
      tier.className = "skin-tier";
      tier.textContent = skin.tier;
      card.appendChild(tier);

      const btn = document.createElement("button");
      btn.className = "unlock-btn";

      if (isEquipped) {
        btn.textContent = "EQUIPPED";
        btn.classList.add("equipped");
        btn.disabled = true;
      } else if (isUnlocked) {
        btn.textContent = "EQUIP";
        btn.disabled = false;
        btn.onclick = () => {
          equipSkin(skin.level);
          this.renderSkinsGrid();
        };
      } else if (isNext) {
        btn.textContent = `UNLOCK (${skin.price})`;
        const canAfford = coins >= skin.price;
        if (canAfford) btn.classList.add("affordable");
        btn.disabled = !canAfford;
        btn.onclick = () => {
          const result = tryUnlockNextSkin();
          if (!result.success) alert(result.reason);
          this.renderSkinsGrid();
        };
      } else {
        btn.textContent = "LOCKED";
        btn.disabled = true;
      }

      card.appendChild(btn);
      grid.appendChild(card);
    });
  },

  // ---------- Game screen ----------
  startGame() {
    this.showScreen("screen-game");

    document.getElementById("hud-score").textContent = "0";

    Game.onScoreUpdate = (score) => {
      document.getElementById("hud-score").textContent = score;
    };

    Game.onGameOver = (finalScore, coinsEarned) => this.handleGameOver(finalScore, coinsEarned);

    const canvas = document.getElementById("game-canvas");
    if (!Game.canvas) {
      Game.init(canvas);
      // pointerdown unifies mouse clicks (laptop) and taps (phone/tablet)
      // in a single listener with no extra input lag.
      canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (Game.paused) return;
        Game.flap();
      });
    }
    Game.start(LocalState.getCurrentSkin());
  },

  // ---------- Pause ----------
  pauseGame() {
    Game.pause();
    document.getElementById("pause-overlay").classList.remove("hidden");
  },

  resumeGame() {
    document.getElementById("pause-overlay").classList.add("hidden");
    Game.resume();
  },

  quitToMenuFromPause() {
    Game.running = false;   // fully stop the run — no score/coins are awarded on a quit
    Game.paused = false;
    document.getElementById("pause-overlay").classList.add("hidden");
    this.goToOpening();
  },

  // ---------- Game over screen ----------
  async handleGameOver(finalScore, coinsEarnedThisRun) {
    document.getElementById("go-score").textContent = finalScore;

    const coins = LocalState.getCoins() + coinsEarnedThisRun;
    LocalState.setCoins(coins);
    
    // Check if it's a new personal record before overwriting it
    const isNewRecord = finalScore > LocalState.getHighScore();
    if (isNewRecord) {
      LocalState.setHighScore(finalScore);
    }
    
    const highScore = LocalState.getHighScore();

    document.getElementById("go-coins").textContent = coins;
    document.getElementById("go-highscore").textContent = highScore;

    this._resetLeaderboardPromptUI();
    this.showScreen("screen-gameover");

    this._pendingLeaderboardScore = finalScore;
    
    // ONLY check the leaderboard if they set a new personal record 
    // OR if they haven't picked a name yet
    const savedName = LocalState.getPlayerName();
    
    if (isNewRecord || (!savedName && finalScore > 0)) {
      try {
        const eligible = await checkLeaderboardEligibility(finalScore);

        if (eligible) {
          if (savedName) {
            // Auto-update their existing score in the background
            const result = await saveLeaderboardEntry(savedName, finalScore);

            const msg = document.getElementById("leaderboard-saved-msg");
            msg.textContent = result.rank 
                ? `Saved! You're rank #${result.rank} on the Top 20.` 
                : "Saved to the leaderboard!";
            msg.classList.remove("hidden");
          } else {
            // First time qualifying, ask for name
            this._showLeaderboardPrompt();
          }
        }
      } catch (err) {
        console.error("Leaderboard eligibility check failed:", err);
      }
    }
  },

  // ---------- Leaderboard ----------
  _resetLeaderboardPromptUI() {
    document.getElementById("leaderboard-prompt").classList.add("hidden");
    document.getElementById("leaderboard-saved-msg").classList.add("hidden");
    document.getElementById("leaderboard-name-input").value = "";
    document.getElementById("leaderboard-prompt-error").textContent = "";
  },

  _showLeaderboardPrompt() {
    document.getElementById("leaderboard-prompt").classList.remove("hidden");
    document.getElementById("leaderboard-name-input").focus();
  },

  async submitLeaderboardName() {
    const saveBtn = document.getElementById("btn-leaderboard-save");
    
    // PREVENT DOUBLE SUBMISSIONS (if button is already disabled, do nothing)
    if (saveBtn.disabled) return; 

    const input = document.getElementById("leaderboard-name-input");
    const errorEl = document.getElementById("leaderboard-prompt-error");
    const name = input.value.trim();

    errorEl.textContent = "";

    if (name.length < 3 || name.length > 10) {
      errorEl.textContent = "Name must be 3–10 characters.";
      return;
    }

    LocalState.setPlayerName(name);

    saveBtn.disabled = true;
    saveBtn.textContent = "...";

    try {
      const result = await saveLeaderboardEntry(name, this._pendingLeaderboardScore);

      document.getElementById("leaderboard-prompt").classList.add("hidden");
      const msg = document.getElementById("leaderboard-saved-msg");
      msg.textContent = (result && result.rank)
        ? `Saved! You're rank #${result.rank} on the Top 20.`
        : "Saved to the leaderboard!";
      msg.classList.remove("hidden");
    } catch (err) {
      console.error("Failed to save leaderboard entry:", err);
      errorEl.textContent = "Couldn't save right now. Please try again.";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "SAVE";
    }
  },

  async goToLeaderboard() {
    this.showScreen("screen-leaderboard");

    const tbody = document.getElementById("leaderboard-body");
    tbody.innerHTML = "<tr><td colspan='3'>Loading...</td></tr>";

    try {
      const entries = await fetchLeaderboard();

      if (!entries || entries.length === 0) {
        tbody.innerHTML = "<tr><td colspan='3'>No scores yet \u2014 be the first!</td></tr>";
        return;
      }

      tbody.innerHTML = "";
      entries.forEach((entry, i) => {
        const row = document.createElement("tr");

        const rankCell = document.createElement("td");
        rankCell.textContent = i + 1;

        const nameCell = document.createElement("td");
        nameCell.textContent = entry.name;

        const scoreCell = document.createElement("td");
        scoreCell.textContent = entry.score;

        row.appendChild(rankCell);
        row.appendChild(nameCell);
        row.appendChild(scoreCell);
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      tbody.innerHTML = "<tr><td colspan='3'>Could not load leaderboard. Please try again.</td></tr>";
    }
  }
};

// ---------- Event wiring ----------
document.addEventListener("DOMContentLoaded", () => {

  // Opening screen
  document.getElementById("btn-play").addEventListener("click", () => UI.startGame());
  document.getElementById("btn-skins").addEventListener("click", () => UI.goToSkins("screen-opening"));
  document.getElementById("btn-leaderboard").addEventListener("click", () => UI.goToLeaderboard());
  document.getElementById("btn-exit").addEventListener("click", () => {
    if (confirm("Exit the game?")) {
      window.close();
      // Most browsers block scripts from closing a tab they didn't open —
      // if we're still here a moment later, let the player know what to do.
      setTimeout(() => alert("You can close this tab now. Thanks for playing!"), 200);
    }
  });

  // Skins screen
  document.getElementById("btn-skins-back").addEventListener("click", () => UI.showScreen(UI.skinsReturnTo));

  // Game screen (pause)
  document.getElementById("btn-pause").addEventListener("click", () => UI.pauseGame());
  document.getElementById("btn-resume").addEventListener("click", () => UI.resumeGame());
  document.getElementById("btn-pause-quit").addEventListener("click", () => UI.quitToMenuFromPause());

  // Game over screen
  document.getElementById("btn-retry").addEventListener("click", () => UI.startGame());
  document.getElementById("btn-change-skin").addEventListener("click", () => UI.goToSkins("screen-gameover"));
  document.getElementById("btn-leaderboard-save").addEventListener("click", () => UI.submitLeaderboardName());
  document.getElementById("leaderboard-name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") UI.submitLeaderboardName();
  });

  // Leaderboard screen
  document.getElementById("btn-leaderboard-back").addEventListener("click", () => UI.goToOpening());

  UI.goToOpening();
});
