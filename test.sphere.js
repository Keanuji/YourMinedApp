(function() {
  const NAME = 'test.sphere.js';
  window.YM_S = window.YM_S || {};
  
  window.YM_S[NAME] = {
    name: 'Neon Duel',
    icon: '⚔️',
    category: 'Games',
    description: 'A strategic P2P Connect 4 challenge for two players.',
    
    activate(ctx) {
      this.ctx = ctx;
      this.resetData();
      
      // Auto-enregistrement sur le bureau via l'API YourMine
      if (this.ctx.addIconToDesktop) {
        this.ctx.addIconToDesktop(NAME, this.icon, this.name);
      }
      
      // Écoute des messages P2P
      this.ctx.onReceive((type, data, peerId) => {
        console.log('[Duel] received:', type, 'from', peerId);
        if (type === 'duel:challenge') this.handleChallenge(peerId);
        if (type === 'duel:accept') this.handleAccept(peerId);
        if (type === 'duel:move') this.handleMove(data, peerId);
        if (type === 'duel:reset') this.resetData();
      });
    },

    resetData() {
      this.board = Array(6).fill(null).map(() => Array(7).fill(null));
      this.turn = 'host'; // Le bleu commence
      this.role = null; 
      this.opponentId = null; // C'est le peerId (ID réseau)
      this.winner = null;
      if (this.view) this.render();
    },

    handleChallenge(peerId) {
      this.opponentId = peerId;
      this.role = 'guest'; 
      this.ctx.toast('Match challenge received!', 'info');
      this.ctx.send('duel:accept', {}, peerId);
      this.render();
    },

    handleAccept(peerId) {
      this.opponentId = peerId;
      this.role = 'host';
      this.ctx.toast('Challenge accepted!', 'success');
      this.render();
    },

    handleMove(data, peerId) {
      if (peerId !== this.opponentId) return;
      const { col, row } = data;
      this.board[row][col] = this.role === 'host' ? 'guest' : 'host';
      this.turn = this.role;
      this.checkWin(row, col);
      this.render();
    },

    checkWin(r, c) {
      const p = this.board[r][c];
      const check = (dr, dc) => {
        let count = 1;
        for (let i = 1; i < 4; i++) {
          let nr = r + dr * i, nc = c + dc * i;
          if (nr >= 0 && nr < 6 && nc >= 0 && nc < 7 && this.board[nr][nc] === p) count++;
          else break;
        }
        for (let i = 1; i < 4; i++) {
          let nr = r - dr * i, nc = c - dc * i;
          if (nr >= 0 && nr < 6 && nc >= 0 && nc < 7 && this.board[nr][nc] === p) count++;
          else break;
        }
        return count >= 4;
      };
      if (check(0, 1) || check(1, 0) || check(1, 1) || check(1, -1)) {
        this.winner = p;
        this.ctx.toast(p === this.role ? 'VICTORY!' : 'DEFEAT', p === this.role ? 'success' : 'error');
      }
    },

    renderPanel(body) {
      this.view = body;
      this.render();
    },

    render() {
      if (!this.view) return;
      
      const isMyTurn = this.turn === this.role;
      const statusText = this.winner 
        ? (this.winner === this.role ? 'YOU WIN! 🏆' : 'YOU LOST 💀')
        : (this.opponentId ? (isMyTurn ? 'YOUR TURN' : 'WAITING...') : 'FIND AN OPPONENT');

      this.view.innerHTML = `
        <style>
          .duel-container { font-family: sans-serif; display: flex; flex-direction: column; height: 100%; color: #e4e6f4; text-align: center; }
          .duel-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); margin: auto; }
          .duel-cell { aspect-ratio: 1; background: #06060e; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); position: relative; cursor: pointer; }
          .duel-disc { width: 85%; height: 85%; border-radius: 50%; }
          .disc-host { background: #08e0f8; box-shadow: 0 0 15px rgba(8,224,248,0.5); }
          .disc-guest { background: #ff4560; box-shadow: 0 0 15px rgba(255,69,96,0.5); }
          .duel-status { font-weight: 800; color: #f0a830; letter-spacing: 3px; text-transform: uppercase; font-size: 18px; margin-top: 10px; }
          .duel-sub { font-size: 10px; opacity: 0.5; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
        </style>
        <div class="duel-container">
          <div class="duel-status">${statusText}</div>
          <div class="duel-sub">${!this.opponentId ? 'Challenge a peer from their profile' : (this.role === 'host' ? 'Blue' : 'Pink')} Player</div>
          
          <div class="duel-grid">
            ${this.board.map((row, ri) => row.map((cell, ci) => `
              <div class="duel-cell" onclick="window.YM_S['${NAME}'].tryMove(${ri}, ${ci})">
                ${cell ? `<div class="duel-disc disc-${cell}"></div>` : ''}
              </div>
            `).join('')).join('')}
          </div>
          
          <div style="padding: 20px;">
            <button class="ym-btn ym-btn-ghost" style="width:100%; color: white; padding: 10px; border-radius: 8px; border:1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);" onclick="window.YM_S['${NAME}'].reset()">Reset Game</button>
          </div>
        </div>
      `;
    },

    tryMove(r, c) {
      if (this.winner || (this.opponentId && this.turn !== this.role)) return;
      if (!this.opponentId) return; // Pas de jeu en solo sans adversaire

      if (this.board[r][c] !== null) return;
      // Règle Connect 4 : on doit poser sur la ligne la plus basse
      if (r < 5 && this.board[r+1][c] === null) return;

      this.board[r][c] = this.role;
      this.turn = this.role === 'host' ? 'guest' : 'host';
      this.ctx.send('duel:move', { row: r, col: c }, this.opponentId);
      this.checkWin(r, c);
      this.render();
    },

    reset() {
      this.resetData();
      if (this.opponentId) this.ctx.send('duel:reset', {}, this.opponentId);
    },

    // Injecté dans le profil des autres pour lancer le défi
    peerSection(container, peerCtx) {
      // peerCtx.uuid est l'ID YourMine, on doit trouver le peerId (Nostr/Trystero)
      const near = window.YM_Social?._nearUsers?.get(peerCtx.uuid);
      const targetPeerId = near?.peerId;

      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="display:flex; align-items:center; gap:10px">
            <span style="font-size:20px">⚔️</span>
            <div style="text-align:left">
                <div style="font-size:12px; font-weight:700">Neon Duel</div>
                <div style="font-size:9px; opacity:0.5">${targetPeerId ? 'Online' : 'Peer not connected'}</div>
            </div>
          </div>
          <button class="ym-btn ym-btn-accent" style="padding:6px 12px; font-size:10px; background:#f0a830; color:black; border:none; border-radius:6px; font-weight:bold;" ${!targetPeerId ? 'disabled' : ''}>CHALLENGE</button>
        </div>
      `;

      container.querySelector('button').onclick = () => {
        if (!targetPeerId) return;
        this.resetData();
        this.opponentId = targetPeerId;
        this.role = 'host';
        this.ctx.send('duel:challenge', {}, targetPeerId);
        this.ctx.toast('Challenge sent!', 'info');
        // Fermer le profil et ouvrir le panel de jeu
        if (window.YM.closePanel) window.YM.closePanel();
        if (window.YM.openSpherePanel) window.YM.openSpherePanel(NAME);
      };
    }
  };
})();
