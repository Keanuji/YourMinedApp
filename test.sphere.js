(function() {
  const NAME = 'duel.sphere.js';
  window.YM_S = window.YM_S || {};
  window.YM_S[NAME] = {
    name: 'Neon Duel',
    icon: '⚔️',
    category: 'Games',
    description: 'A strategic P2P Connect 4 challenge for two players.',
    
    activate(ctx) {
      this.ctx = ctx;
      this.resetData();
      
      // Enregistrement automatique sur le bureau si l'API est là
      if (this.ctx.addIconToDesktop) {
        this.ctx.addIconToDesktop(NAME, this.icon, this.name);
      }
      
      this.ctx.onReceive((type, data, peerId) => {
        if (type === 'move') this.handleMove(data, peerId);
        if (type === 'challenge') this.handleChallenge(peerId);
        if (type === 'accept') this.handleAccept(peerId);
        if (type === 'reset') this.resetData();
      });
    },

    resetData() {
      this.board = Array(6).fill(null).map(() => Array(7).fill(null));
      this.turn = 'host'; // Le host (bleu) commence toujours
      this.role = null; 
      this.opponentId = null;
      this.winner = null;
      if (this.view) this.render();
    },

    handleChallenge(peerId) {
      this.opponentId = peerId;
      this.role = 'guest'; // On reçoit un défi, on devient l'invité (rose)
      this.ctx.toast('Match challenge received!', 'info');
      this.ctx.send('accept', {}, peerId);
      this.ctx.openPanel(); // On ouvre le jeu pour accepter le défi visuellement
      this.render();
    },

    handleAccept(peerId) {
      this.opponentId = peerId;
      this.role = 'host'; // Notre défi a été accepté, on est l'hôte (bleu)
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
      }
    },

    renderPanel(body) {
      this.view = body;
      this.render();
    },

    render() {
      if (!this.view) return;
      
      const isMyTurn = this.turn === this.role;
      let statusText = 'FIND AN OPPONENT';
      if (this.winner) {
          statusText = this.winner === this.role ? 'YOU WIN! 🏆' : 'YOU LOST 💀';
      } else if (this.opponentId) {
          statusText = isMyTurn ? 'YOUR TURN' : 'WAITING...';
      }

      this.view.innerHTML = `
        <style>
          .duel-container { font-family: sans-serif; display: flex; flex-direction: column; height: 100%; color: #e4e6f4; }
          .duel-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); margin: auto; }
          .duel-cell { aspect-ratio: 1; background: #06060e; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); position: relative; }
          .duel-cell:hover { background: rgba(255,255,255,0.02); }
          .duel-disc { width: 85%; height: 85%; border-radius: 50%; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
          .disc-host { background: #08e0f8; box-shadow: 0 0 15px rgba(8,224,248,0.5); }
          .disc-guest { background: #ff4560; box-shadow: 0 0 15px rgba(255,69,96,0.5); }
          .duel-header { text-align: center; margin-bottom: 20px; padding-top: 10px; }
          .duel-status { font-weight: 800; color: #f0a830; letter-spacing: 3px; text-transform: uppercase; font-size: 18px; }
          .duel-sub { font-size: 10px; opacity: 0.5; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
        </style>
        <div class="duel-container">
          <div class="duel-header">
            <div class="duel-status">${statusText}</div>
            <div class="duel-sub">${!this.opponentId ? 'Challenge a peer to start' : (this.role === 'host' ? 'Blue' : 'Pink')} Player</div>
          </div>
          <div class="duel-grid">
            ${this.board.map((row, ri) => row.map((cell, ci) => `
              <div class="duel-cell" onclick="window.YM_S['${NAME}'].tryMove(${ri}, ${ci})">
                ${cell ? `<div class="duel-disc disc-${cell}"></div>` : ''}
              </div>
            `).join('')).join('')}
          </div>
          <div style="padding: 20px;">
            <button class="ym-btn ym-btn-ghost" style="width:100%; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.05); color:white; padding:10px; border-radius:8px;" onclick="window.YM_S['${NAME}'].reset()">Reset Game</button>
          </div>
        </div>
      `;
    },

    tryMove(r, c) {
      if (this.winner || (this.opponentId && this.turn !== this.role)) return;
      if (!this.opponentId && !this.role) this.role = 'host';

      if (this.board[r][c] !== null) return;
      if (r < 5 && this.board[r+1][c] === null) return;

      this.board[r][c] = this.role;
      this.turn = this.role === 'host' ? 'guest' : 'host';
      if (this.opponentId) this.ctx.send('move', { row: r, col: c }, this.opponentId);
      this.checkWin(r, c);
      this.render();
    },

    reset() {
      this.resetData();
      if (this.opponentId) this.ctx.send('reset', {}, this.opponentId);
    },

    peerSection(container, peerCtx) {
      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="display:flex; align-items:center; gap:10px">
            <span style="font-size:20px">⚔️</span>
            <div>
                <div style="font-size:12px; font-weight:700">Neon Duel</div>
                <div style="font-size:9px; opacity:0.5">Classic strategic battle</div>
            </div>
          </div>
          <button class="ym-btn ym-btn-accent" style="padding:6px 12px; font-size:10px; background:#f0a830; color:black; border:none; border-radius:6px; font-weight:bold;">CHALLENGE</button>
        </div>
      `;
      container.querySelector('button').onclick = () => {
        this.resetData();
        // Résolution de l'ID : si on a accès à la sphère sociale, on cherche le peerId lié à cet UUID
        const targetId = window.YM_Social?._nearUsers?.get(peerCtx.uuid)?.peerId || peerCtx.uuid;
        this.opponentId = targetId;
        this.role = 'host';
        this.ctx.send('challenge', {}, targetId);
        this.ctx.toast('Challenge sent!', 'info');
        window.YM.closePanel();
        window.YM.openSpherePanel(NAME);
      };
    }
  };
})();
