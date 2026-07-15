(function() {
  const NAME = 'test.sphere.js';
  const GRID_W = 40;
  const GRID_H = 40;
  const TICK_MS = 120;
  const INITIAL_LENGTH = 4;
  const GIF = 'https://media.giphy.com/media/RPAoaeulF8mGBg3vwy/giphy.gif';

  const COLORS = {
    0: { stroke: '#08e0f8', glow: 'rgba(8,224,248,0.5)'  },
    1: { stroke: '#ff4560', glow: 'rgba(255,69,96,0.5)'  },
    2: { stroke: '#a855f7', glow: 'rgba(168,85,247,0.5)' },
    3: { stroke: '#22c55e', glow: 'rgba(34,197,94,0.5)'  },
  };

  const STARTS = [
    { x: 8,           y: GRID_H/2, dir: 'right' },
    { x: GRID_W-9,   y: GRID_H/2, dir: 'left'  },
    { x: GRID_W/2,   y: 8,        dir: 'down'  },
    { x: GRID_W/2,   y: GRID_H-9, dir: 'up'    },
  ];

  // Résolution peerId — cherche dans tous les peers connus (même logique que poker.sphere.js)
  function peerOf(uuid){
    const near=window.YM_Social?._nearUsers;
    if(near&&near.has(uuid))return near.get(uuid).peerId||null;
    const peers=window.YM_P2P?.peers;
    if(peers){
      for(const[pid,info]of peers){
        if(info&&info.uuid===uuid)return pid;
      }
    }
    return null;
  }

  window.YM_S = window.YM_S || {};
  window.YM_S[NAME] = {
    name: 'Neon Duel',
    icon: 'https://media.giphy.com/media/RPAoaeulF8mGBg3vwy/giphy.gif',
    category: 'Games',
    description: 'Neon Snake Battle — solo or up to 4 players P2P.',
    fullscreen: true,
    cardGif: 'https://media.giphy.com/media/RPAoaeulF8mGBg3vwy/giphy.gif',
    desktopGif: 'https://media.giphy.com/media/RPAoaeulF8mGBg3vwy/giphy.gif',

    broadcastData() {
      const mySnake = this.snakes[this.mySlot];
      if(!mySnake) return {};
      return { snake_score: mySnake.score, snake_best: this._bestScore || 0 };
    },

    activate(ctx) {
      this.ctx = ctx;
      this._hardReset();
      if (ctx.addIconToDesktop) ctx.addIconToDesktop(NAME, this.desktopGif || this.icon, this.name);
      ctx.onReceive((type, data, peerId) => {
        if (type === 'sn:invited')  this._onInvited(data, peerId);
        if (type === 'sn:joined')   this._onJoined(data, peerId);
        if (type === 'sn:lobby')    this._onLobbySync(data, peerId);
        if (type === 'sn:ready')    this._onReady(data, peerId);
        if (type === 'sn:start')    this._onStart(data, peerId);
        if (type === 'sn:dir')      this._onDir(data, peerId);
        if (type === 'sn:tick')     this._onTick(data);
        if (type === 'sn:reset')    this._onRemoteReset();
      });
      setTimeout(() => {
        const p = window.YM_PendingChallenges?.[NAME];
        if (p) { this._onInvited(p.data, p.peerId); delete window.YM_PendingChallenges[NAME]; }
      }, 500);
    },

    _hardReset() {
      clearInterval(this._ticker);
      this._ticker = null;
      this.phase = 'menu';
      this.isSolo = false;
      this.isHost = false;
      this.mySlot = -1;
      this.lobby = [];
      this.snakes = {};
      this.foods = [];
      this.winner = null;
      this._pendingDirs = {};
      this._lastSentDir = null;
      if (this.view) this._render();
    },

    _startSolo() {
      this.isSolo = true;
      this.isHost = false;
      this.mySlot = 0;
      this.phase = 'playing';
      this._initSnake(0, null);
      this.foods = [this._spawnFood()];
      this._pendingDirs = {};
      this._lastSentDir = null;
      this._render();
      this._ticker = setInterval(() => this._tick(), TICK_MS);
    },

    _createLobby() {
      this.isHost = true;
      this.mySlot = 0;
      this.phase = 'lobby';
      this.lobby = [{ slot: 0, peerId: null, name: 'You (host)', ready: false }];
      this._render();
    },

    _invite(peerId, peerName) {
      if (!this.isHost || this.phase !== 'lobby') return;
      if (this.lobby.length >= 4) { this.ctx.toast('Lobby full', 'warn'); return; }
      if (this.lobby.some(p => p.peerId === peerId)) { this.ctx.toast('Already invited', 'info'); return; }
      const slot = this.lobby.length;
      this.lobby.push({ slot, peerId, name: peerName || 'Player '+(slot+1), ready: false });
      this.ctx.send('sn:invited', { slot, snapshot: this._snap() }, peerId);
      this._broadcastLobby();
      this._render();
    },

    // Invite tous les contacts joignables d'un coup (comme poker.sphere.js)
    _getContacts() {
      try { return JSON.parse(localStorage.getItem('ym_contacts_v1') || '[]'); }
      catch(e) { return []; }
    },
    _inviteAllContacts() {
      if (!this.isHost || this.phase !== 'lobby') return;
      let sent = 0;
      this._getContacts().forEach(c => {
        if (this.lobby.length >= 4) return;
        const pid = peerOf(c.uuid);
        if (pid && !this.lobby.some(p => p.peerId === pid)) {
          this._invite(pid, c.nickname || (c.profile && c.profile.name) || 'Player');
          sent++;
        }
      });
      this.ctx.toast(sent ? sent+' invite(s) sent' : 'No nearby contacts', 'info');
    },

    _snap() { return this.lobby.map(p => ({ slot: p.slot, name: p.name, ready: p.ready })); },

    _broadcastLobby() {
      this.lobby.forEach(p => {
        if (p.peerId) this.ctx.send('sn:lobby', { snapshot: this._snap() }, p.peerId);
      });
    },

    _onInvited(data, peerId) {
      if (this.phase !== 'menu') return;
      this.isHost = false;
      this.mySlot = data.slot;
      this.phase = 'lobby';
      this.lobby = (data.snapshot||[]).map(s => ({...s, peerId: s.slot === 0 ? peerId : null}));
      this.ctx.send('sn:joined', { slot: this.mySlot, name: 'Player '+(this.mySlot+1) }, peerId);
      this.ctx.toast('Invited to Snake Battle!', 'info');
      this.ctx.openPanel();
      this._render();
    },

    _onJoined(data, peerId) {
      const e = this.lobby.find(p => p.slot === data.slot);
      if (e) e.name = data.name || e.name;
      this._broadcastLobby();
      this._render();
    },

    _onLobbySync(data, peerId) {
      if (!this.isHost) {
        this.lobby = data.snapshot.map(s => ({...s, peerId: this.lobby.find(l => l.slot === s.slot)?.peerId || null}));
        this._render();
      }
    },

    _setReady() {
      const me = this.lobby.find(p => p.slot === this.mySlot);
      if (me) me.ready = true;
      if (this.isHost) { this._broadcastLobby(); this._checkAllReady(); }
      else {
        const host = this.lobby.find(p => p.slot === 0);
        if (host?.peerId) this.ctx.send('sn:ready', { slot: this.mySlot }, host.peerId);
      }
      this._render();
    },

    _onReady(data, peerId) {
      if (!this.isHost) return;
      const e = this.lobby.find(p => p.slot === data.slot);
      if (e) e.ready = true;
      this._broadcastLobby();
      this._checkAllReady();
      this._render();
    },

    _checkAllReady() {
      if (!this.isHost || this.lobby.length < 2) return;
      if (this.lobby.every(p => p.ready)) this._launch();
    },

    _launch() {
      const snapshot = this._snap();
      this.foods = [];
      for (let i = 0; i < this.lobby.length; i++) this.foods.push(this._spawnFood());
      snapshot.forEach(p => this._initSnake(p.slot, this.lobby.find(l=>l.slot===p.slot)?.peerId||null));
      this.lobby.forEach(p => {
        if (p.peerId) this.ctx.send('sn:start', { snapshot, foods: this.foods }, p.peerId);
      });
      this.phase = 'playing';
      this._pendingDirs = {};
      this._countdown(3);
    },

    _onStart(data, peerId) {
      this.foods = data.foods || [];
      data.snapshot.forEach(p => {
        this._initSnake(p.slot, this.lobby.find(l=>l.slot===p.slot)?.peerId||null);
      });
      this.phase = 'playing';
      this._pendingDirs = {};
      this._lastSentDir = null;
      this._countdown(3);
    },

    _initSnake(slot, peerId) {
      const sp = STARTS[slot];
      const cells = [];
      for (let i = 0; i < INITIAL_LENGTH; i++) {
        cells.push({ x: sp.x - this._dx(sp.dir)*i, y: sp.y - this._dy(sp.dir)*i });
      }
      this.snakes[slot] = { cells, dir: sp.dir, alive: true, peerId, score: 0 };
    },

    _dx(dir){ return dir==='right'?1:dir==='left'?-1:0; },
    _dy(dir){ return dir==='down'?1:dir==='up'?-1:0; },
    _opposite(dir){ return {up:'down',down:'up',left:'right',right:'left'}[dir]; },

    _countdown(n) {
      this._render(n);
      if (n === 0) {
        // Seuls le host (multi) et le solo simulent le jeu ; les invités attendent les sn:tick
        if (this.isHost || this.isSolo) this._startTicker();
        return;
      }
      setTimeout(() => this._countdown(n-1), 1000);
    },

    _startTicker() {
      this._render();
      this._ticker = setInterval(() => this._tick(), TICK_MS);
    },

    // ── Envoi de la direction voulue ──────────────────────────────────────────
    // Host/solo : appliquée directement au prochain tick.
    // Invité : envoyée au host, qui est seul à simuler la partie.
    _setDir(dir) {
      if (this.isHost || this.isSolo) {
        this._pendingDirs = this._pendingDirs || {};
        this._pendingDirs[this.mySlot] = dir;
      } else {
        if (this._lastSentDir === dir) return;
        this._lastSentDir = dir;
        const host = this.lobby.find(p => p.slot === 0);
        if (host && host.peerId) this.ctx.send('sn:dir', { slot: this.mySlot, dir }, host.peerId);
      }
    },

    // Le host reçoit la direction voulue d'un invité
    _onDir(data, peerId) {
      if (!this.isHost) return;
      const snake = this.snakes[data.slot];
      if (!snake || snake.peerId !== peerId) return; // seul le propriétaire du slot peut l'influencer
      this._pendingDirs = this._pendingDirs || {};
      this._pendingDirs[data.slot] = data.dir;
    },

    // ── Boucle de jeu — ne tourne que côté host (multi) ou solo ──────────────
    _tick() {
      if (this.phase !== 'playing') return;
      if (!this.isHost && !this.isSolo) return; // sécurité : un invité ne doit jamais simuler

      this._pendingDirs = this._pendingDirs || {};
      const nextHeads = {};
      Object.entries(this.snakes).forEach(([slot, s]) => {
        if (!s.alive) return;
        const wanted = this._pendingDirs[slot];
        if (wanted && !this._isOpposite(s.dir, wanted)) s.dir = wanted;
        delete this._pendingDirs[slot];
        nextHeads[slot] = this._nextPos(s.cells[0].x, s.cells[0].y, s.dir);
      });

      // Détecte les collisions frontales (deux têtes visent la même case)
      const headCounts = {};
      Object.values(nextHeads).forEach(h => {
        const k = h.x + ',' + h.y;
        headCounts[k] = (headCounts[k] || 0) + 1;
      });

      const dead = new Set();
      const ateFood = {};
      Object.entries(nextHeads).forEach(([slot, next]) => {
        const key = next.x + ',' + next.y;
        let isDead = next.x<0||next.x>=GRID_W||next.y<0||next.y>=GRID_H;
        if (!isDead && headCounts[key] > 1) isDead = true;
        if (!isDead) {
          for (const other of Object.values(this.snakes)) {
            if (other.cells.some(c => c.x===next.x && c.y===next.y)) { isDead = true; break; }
          }
        }
        if (isDead) dead.add(slot);
        else {
          const fi = this.foods.findIndex(f => f.x===next.x && f.y===next.y);
          if (fi !== -1) ateFood[slot] = fi;
        }
      });

      Object.entries(nextHeads).forEach(([slot, next]) => {
        const s = this.snakes[slot];
        if (dead.has(slot)) { s.alive = false; return; }
        s.cells.unshift({ x: next.x, y: next.y });
        if (ateFood[slot] !== undefined) {
          s.score++;
          const scoreEl = document.getElementById('sn-score-'+slot);
          if (scoreEl) scoreEl.textContent = s.score;
          this.foods[ateFood[slot]] = this._spawnFood();
        } else {
          s.cells.pop();
        }
      });

      this._checkOver();
      this._syncGuests();
      this._drawCanvas();
    },

    // Diffuse l'état officiel du jeu à chaque invité (topologie en étoile)
    _syncGuests() {
      if (!this.isHost) return;
      const payload = {
        phase: this.phase,
        winner: this.winner,
        snakes: Object.fromEntries(Object.entries(this.snakes).map(([slot,s]) =>
          [slot, { cells: s.cells, dir: s.dir, alive: s.alive, score: s.score }]
        )),
        foods: this.foods,
      };
      this.lobby.forEach(p => { if (p.peerId) this.ctx.send('sn:tick', payload, p.peerId); });
    },

    // Un invité applique l'état reçu du host — il ne simule jamais lui-même
    _onTick(data) {
      if (this.isHost || this.isSolo) return;
      Object.entries(data.snakes).forEach(([slot, s]) => {
        this.snakes[slot] = Object.assign(this.snakes[slot] || {}, s);
      });
      this.foods = data.foods;
      const wasPlaying = this.phase === 'playing';
      this.phase = data.phase;
      this.winner = data.winner;
      if (wasPlaying && data.phase !== 'playing') this._render();
      else this._drawCanvas();
    },

    _checkOver() {
      const alive = Object.entries(this.snakes).filter(([,s])=>s.alive);
      if (this.isSolo) {
        if (alive.length === 0) {
          const score = this.snakes[0]?.score || 0;
          this._bestScore = Math.max(score, this._bestScore || 0);
          this._saveHistory(score);
          this.phase = 'over';
          clearInterval(this._ticker);
          this._render();
        }
      } else {
        if (alive.length <= 1) {
          this.winner = alive.length===1 ? parseInt(alive[0][0]) : null;
          const myScore = this.snakes[this.mySlot]?.score || 0;
          this._bestScore = Math.max(myScore, this._bestScore || 0);
          this._saveHistory(myScore);
          this.phase = 'over';
          clearInterval(this._ticker);
          this._render();
        }
      }
    },

    _saveHistory(score) {
      try {
        const key = 'snake_history';
        const hist = JSON.parse(this.ctx.storage.get(key) || '[]');
        hist.unshift({ score, date: Date.now(), solo: this.isSolo });
        if(hist.length > 20) hist.length = 20;
        this.ctx.storage.set(key, JSON.stringify(hist));
        if(score > (parseInt(this.ctx.storage.get('snake_best') || '0'))) {
          this.ctx.storage.set('snake_best', String(score));
        }
      } catch(e) {}
    },

    _getHistory() {
      try { return JSON.parse(this.ctx.storage.get('snake_history') || '[]'); }
      catch(e) { return []; }
    },

    _spawnFood() {
      let f, tries = 0;
      do {
        f = { x: Math.floor(Math.random()*GRID_W), y: Math.floor(Math.random()*GRID_H) };
        tries++;
      } while (tries < 100 && (
        this.foods.some(e => e.x===f.x && e.y===f.y) ||
        Object.values(this.snakes).some(s => s.cells.some(c => c.x===f.x && c.y===f.y))
      ));
      return f;
    },

    _resetGame() {
      this.lobby.forEach(p => {
        if (p.peerId) this.ctx.send('sn:reset', {}, p.peerId);
      });
      this._onRemoteReset();
    },

    _onRemoteReset() {
      const savedLobby = this.lobby.map(p => ({ ...p, ready: false }));
      const mySlot = this.mySlot;
      const isHost = this.isHost;
      this._hardReset();
      this.phase = 'lobby';
      this.isHost = isHost;
      this.mySlot = mySlot;
      this.lobby = savedLobby;
      this._render();
    },

    _nextPos(x, y, dir) { return { x: x+this._dx(dir), y: y+this._dy(dir) }; },
    _isOpposite(a, b) {
      return (a==='up'&&b==='down')||(a==='down'&&b==='up')||
             (a==='left'&&b==='right')||(a==='right'&&b==='left');
    },

    _drawCanvas() {
      const cw = this._cw, ch = this._ch, cell = this._cell;
      if (!cw) return;
      requestAnimationFrame(() => {
        const cv = document.getElementById('sn-cv');
        if (!cv) return;
        const c = cv.getContext('2d');
        c.fillStyle = '#02020a';
        c.fillRect(0,0,cw,ch);
        c.strokeStyle = 'rgba(8,224,248,0.03)';
        c.lineWidth = 0.5;
        for (let x=0;x<=GRID_W;x++){c.beginPath();c.moveTo(x*cell,0);c.lineTo(x*cell,ch);c.stroke();}
        for (let y=0;y<=GRID_H;y++){c.beginPath();c.moveTo(0,y*cell);c.lineTo(cw,y*cell);c.stroke();}
        Object.entries(this.snakes).forEach(([slot,s]) => {
          if(!s.cells.length) return;
          const col = COLORS[slot]||COLORS[0];
          c.globalAlpha = s.alive ? 1 : 0.2;
          c.strokeStyle = col.stroke;
          c.lineWidth = cell * 0.7;
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.shadowColor = col.glow;
          c.shadowBlur = cell * 1.2;
          c.beginPath();
          s.cells.forEach((pt, i) => {
            const px = (pt.x + 0.5) * cell, py = (pt.y + 0.5) * cell;
            if(i === 0) c.moveTo(px, py); else c.lineTo(px, py);
          });
          c.stroke();
          if(s.alive) {
            const h = s.cells[0];
            c.fillStyle = '#ffffff';
            c.shadowColor = col.glow;
            c.shadowBlur = cell * 2;
            c.beginPath();
            c.arc((h.x+0.5)*cell, (h.y+0.5)*cell, cell*0.45, 0, Math.PI*2);
            c.fill();
          }
          c.globalAlpha = 1;
          c.shadowBlur = 0;
        });
        this.foods.forEach(f => {
          c.fillStyle = '#f0a830';
          c.shadowColor = 'rgba(240,168,48,.9)';
          c.shadowBlur = 10;
          c.beginPath();
          c.arc((f.x+.5)*cell, (f.y+.5)*cell, cell*.42, 0, Math.PI*2);
          c.fill();
          c.shadowBlur = 0;
        });
      });
    },

    _wireTap() {
      if(this._tapWired) return;
      this._tapWired = true;
      const panel = this.view;
      if(!panel) return;
      const handleTap = (ex, ey) => {
        const cv = document.getElementById('sn-cv');
        if(!cv) return;
        const rect = cv.getBoundingClientRect();
        if(!rect.width) return;
        const tapGX = (ex - rect.left) / rect.width * GRID_W;
        const tapGY = (ey - rect.top) / rect.height * GRID_H;
        const S = window.YM_S[NAME];
        const slot = S.isSolo ? 0 : S.mySlot;
        const snake = S.snakes[slot];
        if(!snake || !snake.cells[0]) return;
        const head = snake.cells[0];
        const curDir = snake.dir;
        const dx = tapGX - head.x, dy = tapGY - head.y;
        const hDir = dx > 0 ? 'right' : 'left';
        const vDir = dy > 0 ? 'down' : 'up';
        const hOk = !S._isOpposite(curDir, hDir);
        const vOk = !S._isOpposite(curDir, vDir);
        let dir;
        if(hOk && vOk) { dir = Math.abs(dx) > Math.abs(dy) ? hDir : vDir; }
        else if(hOk) { dir = hDir; }
        else if(vOk) { dir = vDir; }
        else { return; }
        S._setDir(dir);
      };
      panel.addEventListener('touchstart', e => {
        if(window.YM_S[NAME].phase !== 'playing') return;
        e.preventDefault();
        handleTap(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
      panel.addEventListener('pointerdown', e => {
        if(window.YM_S[NAME].phase !== 'playing') return;
        if(e.target.closest('button')) return;
        handleTap(e.clientX, e.clientY);
      });
    },

    renderPanel(body) {
      this.view = body;
      this._setupKeys();
      this._wireTap();
      this._render();
    },

    _setupKeys() {
      if (this._keysWired) return;
      this._keysWired = true;
      document.addEventListener('keydown', e => {
        const map = { ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right' };
        if (map[e.key]) { e.preventDefault(); this._setDir(map[e.key]); }
      });
    },

    _render(countdown) {
      if (!this.view) return;
      const size = Math.min(this.view.clientWidth||window.innerWidth||320, window.innerWidth||360);
      const cell = Math.floor(size/GRID_W);
      const cw = cell*GRID_W, ch = cell*GRID_H;
      this._cell = cell; this._cw = cw; this._ch = ch;

      const css = `<style>
        .sn{display:flex;flex-direction:column;align-items:center;padding:12px;gap:10px;height:100%;font-family:'JetBrains Mono',monospace;color:#e4e6f4;overflow-y:auto;box-sizing:border-box}
        .sn h1{font-size:20px;letter-spacing:.3em;color:#08e0f8;text-shadow:0 0 20px rgba(8,224,248,.5);margin:0}
        .sn-status{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);text-align:center}
        .sn-btn{padding:11px 20px;border-radius:8px;font-size:11px;font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;border:none;font-weight:700;transition:all .15s;text-align:center}
        .sn-btn.cyan{background:rgba(8,224,248,.12);color:#08e0f8;border:1px solid rgba(8,224,248,.3)}
        .sn-btn.ghost{background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.1)}
        .sn-btn.green{background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.3)}
        .sn-btn:active{opacity:.7}
        .sn-row{display:flex;gap:8px;width:100%}
        .sn-row .sn-btn{flex:1}
        .sn-cv{border:1px solid rgba(8,224,248,.18);border-radius:4px;background:#02020a;display:block;box-shadow:0 0 20px rgba(8,224,248,.06);max-width:100%}
        .sn-scores{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
        .sn-score{font-size:10px;display:flex;align-items:center;gap:5px}
        .sn-dot{width:8px;height:8px;border-radius:50%}
        .sn-lobby{width:100%;display:flex;flex-direction:column;gap:6px}
        .sn-player{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid rgba(255,255,255,.06)}
        .sn-badge{font-size:9px;padding:2px 8px;border-radius:10px;letter-spacing:.08em}
        .sn-badge.ready{background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.25)}
        .sn-badge.wait{background:rgba(255,255,255,.04);color:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.08)}
      </style>`;

      let b = `${css}<div class="sn">`;

      if (this.phase === 'menu') {
        b += `<h1>⚔️ NEON DUEL</h1>
          <div class="sn-status">Choose your mode</div>
          <div class="sn-row">
            <button class="sn-btn cyan" onclick="window.YM_S['${NAME}']._startSolo()">🐍 Solo</button>
            <button class="sn-btn ghost" onclick="window.YM_S['${NAME}']._createLobby()">⚔️ Battle</button>
          </div>`;
      }
      else if (this.phase === 'lobby') {
        const me = this.lobby.find(p => p.slot === this.mySlot);
        const iAmReady = me?.ready;
        const allReady = this.lobby.length >= 2 && this.lobby.every(p => p.ready);
        b += `<h1>LOBBY</h1><div class="sn-lobby">`;
        this.lobby.forEach(p => {
          const col = COLORS[p.slot]?.stroke || '#fff';
          b += `<div class="sn-player"><div class="sn-dot" style="background:${col};box-shadow:0 0 5px ${col}"></div><div style="flex:1;font-size:12px">${p.name}${p.slot===this.mySlot?' <span style="opacity:.4">(you)</span>':''}</div><div class="sn-badge ${p.ready?'ready':'wait'}">${p.ready?'READY':'WAITING'}</div></div>`;
        });
        b += `</div>`;
        if (this.isHost && this.lobby.length < 4) {
          b += `<div class="sn-status" style="font-size:9px;opacity:.35">${this.lobby.length}/4 — invite from peer profiles</div>`;
          b += `<button class="sn-btn ghost" style="width:100%;font-size:11px" onclick="window.YM_S['${NAME}']._inviteAllContacts()">✉ Invite contacts</button>`;
        }
        b += `<div class="sn-row">`;
        if (!iAmReady) b += `<button class="sn-btn green" onclick="window.YM_S['${NAME}']._setReady()">✓ I'm Ready</button>`;
        else b += `<div class="sn-btn ghost" style="opacity:.35;pointer-events:none">✓ Ready</div>`;
        b += `<button class="sn-btn ghost" onclick="window.YM_S['${NAME}']._hardReset()">← Back</button></div>`;
        if (this.isHost && allReady) b += `<button class="sn-btn cyan" style="width:100%" onclick="window.YM_S['${NAME}']._launch()">🚀 LAUNCH</button>`;
      }
      else {
        if (Object.keys(this.snakes).length) {
          b += `<div class="sn-scores">`;
          Object.entries(this.snakes).forEach(([slot, s]) => {
            const col = COLORS[slot]?.stroke || '#fff';
            const label = parseInt(slot)===this.mySlot ? 'You' : (this.lobby.find(p=>p.slot===parseInt(slot))?.name||'P'+(parseInt(slot)+1));
            b += `<div class="sn-score"><div class="sn-dot" style="background:${col};${!s.alive?'opacity:.3':''}"></div><span id="sn-score-${slot}" style="${!s.alive?'opacity:.3':''}">${label}: ${s.score}${!s.alive?' 💀':''}</span></div>`;
          });
          b += `</div>`;
        }
        if (this.phase === 'over') {
          if (this.isSolo) {
            b += `<div class="sn-status" style="font-size:16px;color:#ff4560">💀 GAME OVER — Score: ${this.snakes[0]?.score||0}</div>`;
          } else {
            const isWin = this.winner === this.mySlot;
            b += `<div class="sn-status" style="font-size:16px;color:${isWin?'#08e0f8':'#ff4560'}">${isWin?'🏆 YOU WIN':'💀 YOU LOST'}</div>`;
          }
          const hist = this._getHistory().slice(0,5);
          const best = this.ctx.storage?.get('snake_best') || '0';
          if(hist.length) {
            b += `<div style="width:100%;background:rgba(255,255,255,.03);border-radius:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.06)">`;
            b += `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.1em">RECENT SCORES</span><span style="font-size:9px;color:#08e0f8;font-family:monospace">BEST: ${best}</span></div>`;
            hist.forEach((h,i) => {
              const d = new Date(h.date);
              const ds = d.toLocaleDateString('fr',{month:'short',day:'numeric'});
              b += `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.4)">${ds} · ${h.solo?'solo':'multi'}</span><span style="color:${i===0?'#08e0f8':'rgba(255,255,255,.5)'};font-family:monospace">${h.score}</span></div>`;
            });
            b += `</div>`;
          }
        } else if (countdown !== undefined && countdown > 0) {
          b += `<div class="sn-status" style="font-size:36px;color:#f0a830;text-shadow:0 0 20px rgba(240,168,48,.6)">${countdown}</div>`;
        }
        b += `<canvas id="sn-cv" class="sn-cv" width="${cw}" height="${ch}" style="width:${cw}px;height:${ch}px;touch-action:none;cursor:pointer"></canvas>`;
        if (this.phase === 'over') {
          b += `<div class="sn-row">
            <button class="sn-btn cyan" onclick="window.YM_S['${NAME}']._startSolo()">Solo</button>
            <button class="sn-btn ghost" onclick="${this.isSolo?`window.YM_S['${NAME}']._hardReset()`:`window.YM_S['${NAME}']._resetGame()`}">${this.isSolo?'Menu':'Lobby'}</button>
          </div>`;
        }
      }
      b += `</div>`;
      this.view.innerHTML = b;

      requestAnimationFrame(() => {
        const cv = document.getElementById('sn-cv');
        if (!cv) return;
        const c = cv.getContext('2d');
        c.fillStyle = '#02020a';
        c.fillRect(0,0,cw,ch);
        c.strokeStyle = 'rgba(8,224,248,0.03)';
        c.lineWidth = 0.5;
        for (let x=0;x<=GRID_W;x++){c.beginPath();c.moveTo(x*cell,0);c.lineTo(x*cell,ch);c.stroke();}
        for (let y=0;y<=GRID_H;y++){c.beginPath();c.moveTo(0,y*cell);c.lineTo(cw,y*cell);c.stroke();}
        Object.entries(this.snakes).forEach(([slot,s]) => {
          if(!s.cells.length) return;
          const col = COLORS[slot]||COLORS[0];
          c.globalAlpha = s.alive ? 1 : 0.2;
          c.strokeStyle = col.stroke; c.lineWidth = cell * 0.7;
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.shadowColor = col.glow; c.shadowBlur = cell * 1.2;
          c.beginPath();
          s.cells.forEach((pt, i) => {
            const px=(pt.x+0.5)*cell, py=(pt.y+0.5)*cell;
            if(i===0) c.moveTo(px,py); else c.lineTo(px,py);
          });
          c.stroke();
          if(s.alive) {
            const h=s.cells[0];
            c.fillStyle='#ffffff'; c.shadowColor=col.glow; c.shadowBlur=cell*2;
            c.beginPath(); c.arc((h.x+0.5)*cell,(h.y+0.5)*cell,cell*0.45,0,Math.PI*2); c.fill();
          }
          c.globalAlpha=1; c.shadowBlur=0;
        });
        this.foods.forEach(f => {
          c.fillStyle='#f0a830'; c.shadowColor='rgba(240,168,48,.9)'; c.shadowBlur=10;
          c.beginPath(); c.arc((f.x+.5)*cell,(f.y+.5)*cell,cell*.42,0,Math.PI*2); c.fill();
          c.shadowBlur=0;
        });
        if (countdown !== undefined && countdown > 0) {
          c.fillStyle='rgba(0,0,0,.65)'; c.fillRect(0,0,cw,ch);
          c.fillStyle='#f0a830'; c.font=`bold ${Math.floor(cw/4)}px monospace`;
          c.textAlign='center'; c.textBaseline='middle';
          c.shadowColor='rgba(240,168,48,.8)'; c.shadowBlur=24;
          c.fillText(String(countdown),cw/2,ch/2); c.shadowBlur=0;
        }
      });
    },

    profileSection(container) {
      const best = this.ctx.storage?.get('snake_best') || '0';
      const hist = this._getHistory().slice(0, 10);
      const nears = [];
      try {
        const nearMap = window.YM_Social?._nearUsers;
        if(nearMap) nearMap.forEach((peer) => {
          const bd = peer.broadcastData;
          if(bd?.snake_score !== undefined) {
            nears.push({ name: peer.profile?.name || '?', score: bd.snake_score, best: bd.snake_best || 0 });
          }
        });
        nears.sort((a,b) => b.best - a.best);
      } catch(e) {}
      let html = `<div style="padding:14px;display:flex;flex-direction:column;gap:12px">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:22px">⚔️</span><div style="text-align:right"><div style="font-size:20px;font-weight:700;color:#08e0f8;font-family:monospace">${best}</div><div style="font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.1em">BEST SCORE</div></div></div>`;
      if(nears.length) {
        html += `<div style="background:rgba(255,255,255,.03);border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,.06)"><div style="font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.1em;margin-bottom:8px">NEAR & CONTACTS</div>`;
        nears.forEach(n => { html += `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.5)">${n.name}</span><span style="font-family:monospace;color:#a855f7">${n.best}</span></div>`; });
        html += `</div>`;
      }
      if(hist.length) {
        html += `<div style="background:rgba(255,255,255,.03);border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,.06)"><div style="font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.1em;margin-bottom:8px">HISTORY</div>`;
        hist.forEach((h,i) => {
          const d = new Date(h.date);
          const ds = d.toLocaleDateString('fr',{month:'short',day:'numeric'});
          html += `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.4)">${ds} · ${h.solo?'solo':'multi'}</span><span style="font-family:monospace;color:${i===0?'#08e0f8':'rgba(255,255,255,.5)'}">${h.score}</span></div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
      container.innerHTML = html;
    },

    peerSection(container, peerCtx) {
      const self = this;
      const canInvite = self.isHost && self.phase === 'lobby' && self.lobby.length < 4;
      container.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(255,255,255,.05)"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:22px">🐍</span><div><div style="font-size:12px;font-weight:700;color:#fff">Neon Duel</div><div style="font-size:9px;opacity:.5;margin-top:1px">${canInvite?'Invite to your lobby':(self.isHost?'Lobby full or already started':'Host a battle to invite')}</div></div></div><button id="sn-inv-btn" style="padding:6px 14px;font-size:10px;letter-spacing:.08em;font-weight:700;font-family:monospace;cursor:${canInvite?'pointer':'default'};border-radius:6px;background:${canInvite?'rgba(8,224,248,.12)':'rgba(255,255,255,.04)'};color:${canInvite?'#08e0f8':'rgba(255,255,255,.25)'};border:1px solid ${canInvite?'rgba(8,224,248,.3)':'rgba(255,255,255,.08)'}">INVITE</button></div>`;
      if (canInvite) {
        container.querySelector('#sn-inv-btn').addEventListener('click', () => {
          const peerId = peerOf(peerCtx.uuid);
          const name = (peerCtx.profile && peerCtx.profile.name) || 'Player';
          if (!peerId) { self.ctx.toast('Player not reachable — must be nearby', 'error'); return; }
          self._invite(peerId, name);
          self.ctx.toast('Invite sent!', 'success');
        });
      }
    },
  };
})();
