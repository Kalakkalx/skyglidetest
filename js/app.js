// ============ APP ============
// Screen/UI management and all event wiring — the DOM-facing half of the
// game (engine.js holds state/physics/Firebase and has no DOM dependencies
// of its own besides reading a couple of #ids).

const UI = {
  skinsReturnTo: "screen-opening", // where "BACK" on the Skins screen goes
  _pendingLeaderboardScore: 0,      // score awaiting a possible Top 20 save
  _leaderboardEntries: [],          // cached Top 20 entries for real-time HUD tracking
  _highScoreBannerShown: false,     // prevents duplicate high score popups during a run

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
    if (!grid) return;
    grid.innerHTML = "";
    
    const coinCountEl = document.getElementById("skins-coin-count");
    if (coinCountEl) coinCountEl.textContent = LocalState.getCoins();

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

    const hudScore = document.getElementById("hud-score");
    if (hudScore) hudScore.textContent = "0";

    const rankDisplay = document.getElementById("hud-next-rank");
    if (rankDisplay) rankDisplay.textContent = "";

    const hsBanner = document.getElementById("hud-highscore-banner");
    if (hsBanner) hsBanner.classList.add("hidden");

    // Reset high score banner trigger for this run
    this._highScoreBannerShown = false;
    const previousHighScore = LocalState.getHighScore();

    // Fetch leaderboard entries to display live "Points to Reach Rank X" goals
    this._leaderboardEntries = [];
    fetchLeaderboard().then(entries => {
      this._leaderboardEntries = entries;
      this._updateRankDisplay(0);
    }).catch(() => {});

    // Make sure pause overlay is hidden on start
    const overlay = document.getElementById("pause-overlay");
    if (overlay) overlay.classList.add("hidden");

    Game.onScoreUpdate = (score) => {
      if (hudScore) hudScore.textContent = score;

      // Check 1-second "NEW HIGH SCORE" popup banner
      if (previousHighScore > 0 && score >= previousHighScore && !this._highScoreBannerShown) {
        this._highScoreBannerShown = true;
        if (hsBanner) {
          hsBanner.classList.remove("hidden");
          setTimeout(() => {
            hsBanner.classList.add("hidden");
          }, 1000);
        }
      }

      // Live update target rank tracking display
      this._updateRankDisplay(score);
    };

    Game.onGameOver = (finalScore, coinsEarned) => this.handleGameOver(finalScore, coinsEarned);

    const canvas = document.getElementById("game-canvas");
    if (!Game.canvas && canvas) {
      Game.init(canvas);
      canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (Game.paused || Game.countingDown) return;
        Game.flap();
      });
    }
    Game.start(LocalState.getCurrentSkin());
  },

  _updateRankDisplay(score) {
    const el = document.getElementById("hud-next-rank");
    if (!el) return;

    if (!this._leaderboardEntries || this._leaderboardEntries.length === 0) {
      el.textContent = "";
      return;
    }

    // Find the closest leaderboard entry that has a higher score than the player's current score
    let targetIndex = -1;
    for (let i = this._leaderboardEntries.length - 1; i >= 0; i--) {
      if (this._leaderboardEntries[i].score > score) {
        targetIndex = i;
      }
    }

    if (targetIndex === -1) {
      el.textContent = "Rank 1 Achieved!";
    } else {
      const targetEntry = this._leaderboardEntries[targetIndex];
      const targetRank = targetIndex + 1;
      const pointsNeeded = (targetEntry.score + 1) - score;
      if (pointsNeeded > 0) {
        el.textContent = `${pointsNeeded} Points to Reach Rank ${targetRank}`;
      } else {
        el.textContent = `Rank ${targetRank} Reached!`;
      }
    }
  },

  // ---------- Pause & Resume ----------
  pauseGame() {
    const success = Game.togglePause();
    if (success) {
      const overlay = document.getElementById("pause-overlay");
      if (overlay) overlay.classList.remove("hidden");

      const resumeBtn = document.getElementById("btn-resume");
      if (resumeBtn) {
        resumeBtn.textContent = "RESUME";
        resumeBtn.disabled = false;
      }
    }
  },

  resumeGame() {
    const resumeBtn = document.getElementById("btn-resume");

    Game.unpauseWithCountdown(
      (count) => {
        if (resumeBtn) {
          resumeBtn.textContent = `RESUMING IN ${count}...`;
          resumeBtn.disabled = true;
        }
      },
      () => {
        const overlay = document.getElementById("pause-overlay");
        if (overlay) overlay.classList.add("hidden");

        if (resumeBtn) {
          resumeBtn.textContent = "RESUME";
          resumeBtn.disabled = false;
        }
      }
    );
  },

  quitToMenuFromPause() {
    Game.running = false;   
    Game.paused = false;
    Game.countingDown = false;

    const overlay = document.getElementById("pause-overlay");
    if (overlay) overlay.classList.add("hidden");

    const resumeBtn = document.getElementById("btn-resume");
    if (resumeBtn) {
      resumeBtn.textContent = "RESUME";
      resumeBtn.disabled = false;
    }

    this.goToOpening();
  },

  // ---------- Game over screen ----------
  async handleGameOver(finalScore, coinsEarnedThisRun) {
    const goScore = document.getElementById("go-score");
    if (goScore) goScore.textContent = finalScore;

    const coins = LocalState.getCoins() + coinsEarnedThisRun;
    LocalState.setCoins(coins);
    
    // Check if it's a new personal record before overwriting it
    const isNewRecord = finalScore > LocalState.getHighScore();
    if (isNewRecord) {
      LocalState.setHighScore(finalScore);
    }
    
    const highScore = LocalState.getHighScore();

    const goCoins = document.getElementById("go-coins");
    if (goCoins) goCoins.textContent = coins;
    
    const goHighscore = document.getElementById("go-highscore");
    if (goHighscore) goHighscore.textContent = highScore;

    this._resetLeaderboardPromptUI();
    this.showScreen("screen-gameover");

    this._pendingLeaderboardScore = finalScore;
    
    // Check the leaderboard if new personal record OR if name isn't set yet
    const savedName = LocalState.getPlayerName();
    
    if (isNewRecord || (!savedName && finalScore > 0)) {
      try {
        const eligible = await checkLeaderboardEligibility(finalScore);

        if (eligible) {
          if (savedName) {
            // Auto-update score on leaderboard
            const result = await saveLeaderboardEntry(savedName, finalScore);

            const msg = document.getElementById("leaderboard-saved-msg");
            if (msg) {
              msg.textContent = result.rank 
                ? `Saved! You're rank #${result.rank} on the Top 20.` 
                : "Saved to the leaderboard!";
              msg.classList.remove("hidden");
              msg.style.display = "";
            }
          } else {
            // Prompt user for name entry
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
    const prompt = document.getElementById("leaderboard-prompt");
    if (prompt) { prompt.classList.add("hidden"); prompt.style.display = "none"; }

    const msg = document.getElementById("leaderboard-saved-msg");
    if (msg) { msg.classList.add("hidden"); msg.style.display = "none"; }

    const input = document.getElementById("leaderboard-name-input");
    if (input) { 
      input.classList.add("hidden"); 
      input.style.display = "none"; 
      input.value = ""; 
    }

    const btn = document.getElementById("btn-leaderboard-save");
    if (btn) { btn.classList.add("hidden"); btn.style.display = "none"; }

    const errorEl = document.getElementById("leaderboard-prompt-error");
    if (errorEl) { errorEl.textContent = ""; }
  },

  _showLeaderboardPrompt() {
    const prompt = document.getElementById("leaderboard-prompt");
    if (prompt) { prompt.classList.remove("hidden"); prompt.style.display = ""; }

    const input = document.getElementById("leaderboard-name-input");
    if (input) { 
      input.classList.remove("hidden"); 
      input.style.display = ""; 
      input.focus(); 
    }

    const btn = document.getElementById("btn-leaderboard-save");
    if (btn) { btn.classList.remove("hidden"); btn.style.display = ""; }
  },

  async submitLeaderboardName() {
    const saveBtn = document.getElementById("btn-leaderboard-save");
    
    if (saveBtn && saveBtn.disabled) return; 

    const input = document.getElementById("leaderboard-name-input");
    const errorEl = document.getElementById("leaderboard-prompt-error");
    const name = input ? input.value.trim() : "";

    if (errorEl) errorEl.textContent = "";

    if (name.length < 3 || name.length > 10) {
      if (errorEl) errorEl.textContent = "Name must be 3–10 characters.";
      return;
    }

    LocalState.setPlayerName(name);

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "...";
    }

    try {
      const result = await saveLeaderboardEntry(name, this._pendingLeaderboardScore);

      const prompt = document.getElementById("leaderboard-prompt");
      if (prompt) { prompt.classList.add("hidden"); prompt.style.display = "none"; }

      if (input) { input.classList.add("hidden"); input.style.display = "none"; }
      if (saveBtn) { saveBtn.classList.add("hidden"); saveBtn.style.display = "none"; }

      const msg = document.getElementById("leaderboard-saved-msg");
      if (msg) {
        msg.textContent = (result && result.rank)
          ? `Saved! You're rank #${result.rank} on the Top 20.`
          : "Saved to the leaderboard!";
        msg.classList.remove("hidden");
        msg.style.display = "";
      }
    } catch (err) {
      console.error("Failed to save leaderboard entry:", err);
      if (errorEl) errorEl.textContent = "Couldn't save right now. Please try again.";
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "SAVE";
      }
    }
  },

  async goToLeaderboard() {
    this.showScreen("screen-leaderboard");

    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;
    
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
  const safeBind = (id, event, callback) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, callback);
  };

  // Opening screen
  safeBind("btn-play", "click", () => UI.startGame());
  safeBind("btn-skins", "click", () => UI.goToSkins("screen-opening"));
  safeBind("btn-leaderboard", "click", () => UI.goToLeaderboard());
  safeBind("btn-exit", "click", () => {
    if (confirm("Exit the game?")) {
      window.close();
      setTimeout(() => alert("You can close this tab now. Thanks for playing!"), 200);
    }
  });

  // Skins screen
  safeBind("btn-skins-back", "click", () => UI.showScreen(UI.skinsReturnTo));

  // Game screen (pause)
  safeBind("btn-pause", "click", () => UI.pauseGame());
  safeBind("btn-resume", "click", () => UI.resumeGame());
  safeBind("btn-pause-quit", "click", () => UI.quitToMenuFromPause());

  // Game over screen
  safeBind("btn-retry", "click", () => UI.startGame());
  safeBind("btn-change-skin", "click", () => UI.goToSkins("screen-gameover"));
  safeBind("btn-leaderboard-save", "click", () => UI.submitLeaderboardName());
  
  const nameInput = document.getElementById("leaderboard-name-input");
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") UI.submitLeaderboardName();
    });
  }

  // Leaderboard screen
  safeBind("btn-leaderboard-back", "click", () => UI.goToOpening());

  UI.goToOpening();
});
