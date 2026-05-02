(function() {
  const NAME = 'test.sphere.js';
  window.YM_S = window.YM_S || {};
  window.YM_S[NAME] = {
    name: 'Neon Duel',
    icon: '⚔️',
    category: 'Games',
    description: 'A strategic P2P Connect 4 challenge.',
    
    activate(ctx) {
      this.ctx = ctx;
      this.resetData();
      
      this.ctx.onReceive((type, data, peerId) => {
        if (type === 'move') this.handleMove(data, peerId);
        if (type === 'challenge') this.handleChallenge(peerId);
        if (type === 'accept') this.handleAccept(peerId);
        if (type === 'reset') this.resetData();
      });
    },

    resetData() {
      this.board = Array(6).fill(null).map(() => Array(7).fill(null));
      this.turn = 'host';
      this.role = null;
      this.opponentId = null;
      this.winner = null;
      if (this.view) this.render();
    },

    handleChallenge(peerId) {
      const p = window.YM.getProfile();
      this.opponentId = peerId;
      this.role = 'guest';
      this.ctx.toast('Challenge received!', 'info');
      this.ctx.send('accept', {}, peerId);
      this.render();
    },

    handleAccept(peerId) {
      this.opponentId = peerId;
      this.role = 'host';
      this.ctx.toast('Match started!', 'success');
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
          .duel-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
          .duel-cell { aspect-ratio: 1; background: #06060e; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); }
          .duel-disc { width: 85%; height: 85%; border-radius: 50%; transition: all 0.3s; }
          .disc-host { background: #08e0f8; box-shadow: 0 0 15px rgba(8,224,248,0.5); }
          .disc-guest { background: #ff4560; box-shadow: 0 0 15px rgba(255,69,96,0.5); }
          .duel-header { text-align: center; margin-bottom: 20px; }
          .duel-status { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 800; color: #f0a830; letter-spacing: 3px; text-transform: uppercase; }
        </style>
        <div class="duel-header">
          <div class="duel-status">${statusText}</div>
          ${!this.opponentId ? '<p style="font-size:10px; opacity:0.5; margin-top:8px">Challenge a peer to start</p>' : ''}
        </div>
        <div class="duel-grid">
          ${this.board.map((row, ri) => row.map((cell, ci) => `
            <div class="duel-cell" onclick="window.YM_S['${NAME}'].tryMove(${ri}, ${ci})">
              ${cell ? `<div class="duel-disc disc-${cell}"></div>` : ''}
            </div>
          `).join('')).join('')}
        </div>
        <button class="ym-btn ym-btn-ghost" style="width:100%; margin-top:20px" onclick="window.YM_S['${NAME}'].reset()">Reset Game</button>
      `;
    },

    tryMove(r, c) {
      if (this.winner || (this.opponentId && this.turn !== this.role)) return;
      
      // Local testing hack: if no opponent yet, we can move as host
      if (!this.opponentId) this.role = 'host';

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
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.03); border-radius:10px">
          <span style="font-size:12px; font-weight:600">Neon Duel</span>
          <button class="ym-btn ym-btn-accent" style="padding:4px 10px; font-size:10px">CHALLENGE</button>
        </div>
      `;
      container.querySelector('button').onclick = () => {
        this.resetData();
        this.opponentId = peerCtx.uuid;
        this.role = 'host';
        this.ctx.send('challenge', {}, peerCtx.uuid);
        this.ctx.toast('Challenge sent!', 'info');
        this.ctx.openPanel();
      };
    }
  };
})();
