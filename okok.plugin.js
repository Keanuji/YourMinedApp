/**
 * YourMine Plugin — Tap Race v1.0
 * Duel de tap P2P : qui tapera le plus vite en 10 secondes ?
 * category: jeux
 * website: https://github.com/theodoreyong9/YourMinedApp
 */
const plugin = (() => {
  const ID = 'jeux.tap-race';
  const KEY = 'ym_taprace_';

  // ── State (in-memory) ──
  let game    = null;   // { peerId, peerName, myScore, theirScore, phase, startTs, timerTO, cdIV }
  let pending = null;   // { fromId, fromName }
  let _YM     = null;
  let _hubBound = false;

  function store(k, v) {
    if (v === undefined) return JSON.parse(localStorage.getItem(KEY + k) || 'null');
    localStorage.setItem(KEY + k, JSON.stringify(v));
  }

  function send(peerId, payload) {
    _YM.sendTo(peerId, { plugin: ID, ...payload });
  }

  function cleanGame() {
    if (game?.timerTO) clearTimeout(game.timerTO);
    if (game?.cdIV)    clearInterval(game.cdIV);
    game = null;
  }

  function peerName(peerId) {
    return _YM.peers.find(p => p.peerId === peerId)?.name || 'Pair';
  }

  // ── DM handler ──
  function onMsg(data) {
    if (data.plugin !== ID) return;
    const myUuid = _YM.profile.uuid;
    if (data.to && data.to !== myUuid) return;

    if (data.type === 'challenge') {
      if (game && game.phase !== 'result') {
        send(data.from, { type: 'decline', to: data.from, reason: 'busy' });
        return;
      }
      pending = { fromId: data.from, fromName: data.fromName || peerName(data.from) };
      _YM.notify(ID);
      _YM.toast('👆 Défi Tap Race de ' + pending.fromName + ' !');
      rerender();
      return;
    }

    if (data.type === 'accept') {
      if (!game || game.phase !== 'waiting') return;
      startCountdown();
      return;
    }

    if (data.type === 'decline') {
      if (game) {
        const n = game.peerName;
        cleanGame();
        _YM.toast('👆 ' + n + (data.reason === 'busy' ? ' est déjà en partie.' : ' a refusé.'));
        rerender();
      }
      return;
    }

    if (data.type === 'tap') {
      if (game?.phase === 'playing') {
        game.theirScore = data.score;
        const el = document.getElementById('tr-their-score');
        if (el) el.textContent = game.theirScore;
      }
      return;
    }

    if (data.type === 'result') {
      if (game?.phase === 'playing') {
        game.theirScore = data.score;
        endGame();
      }
      return;
    }
  }

  // ── Game logic ──
  function startCountdown() {
    if (!game) return;
    game.phase = 'countdown';
    game.countdownVal = 3;
    rerender();
    game.cdIV = setInterval(() => {
      if (!game) return;
      game.countdownVal--;
      rerender();
      if (game.countdownVal <= 0) {
        clearInterval(game.cdIV); game.cdIV = null;
        startPlaying();
      }
    }, 1000);
  }

  function startPlaying() {
    if (!game) return;
    game.phase = 'playing';
    game.myScore = 0; game.theirScore = 0;
    game.startTs = Date.now();
    rerender();
    game.timerTO = setTimeout(() => {
      if (!game || game.phase !== 'playing') return;
      send(game.peerId, { type: 'result', score: game.myScore, to: game.peerUuid });
      endGame();
    }, 10000);
  }

  function endGame() {
    if (!game) return;
    if (game.timerTO) { clearTimeout(game.timerTO); game.timerTO = null; }
    if (game.cdIV)    { clearInterval(game.cdIV); game.cdIV = null; }
    game.phase = 'result';
    const won  = game.myScore > game.theirScore;
    const draw = game.myScore === game.theirScore;
    const hist = store('history') || [];
    hist.unshift({ peerName: game.peerName, myScore: game.myScore, theirScore: game.theirScore,
                   result: draw ? 'draw' : (won ? 'win' : 'lose'), ts: Date.now() });
    if (hist.length > 30) hist.length = 30;
    store('history', hist);
    rerender();
  }

  // ── Rerender helper ──
  let _container = null;
  let _activeTab = 'game';
  function rerender() {
    if (_container) renderInto(_container);
  }

  // ── Render tabs ──
  function renderInto(container) {
    _container = container;
    container.innerHTML = '';

    // Tab bar
    const tabs = [['game', '👆 Jeu'], ['scores', '🏆 Scores']];
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;border-bottom:1px solid var(--border);margin-bottom:0';
    tabs.forEach(([id, label]) => {
      const btn = document.createElement('button');
      btn.style.cssText = `flex:1;padding:10px;font-size:.76rem;background:none;border:none;cursor:pointer;color:${_activeTab===id?'var(--accent)':'var(--text-2)'};border-bottom:2px solid ${_activeTab===id?'var(--accent)':'transparent'};font-weight:${_activeTab===id?'700':'400'}`;
      btn.textContent = label;
      btn.onclick = () => { _activeTab = id; rerender(); };
      tabBar.appendChild(btn);
    });
    container.appendChild(tabBar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:0';
    container.appendChild(body);

    if (_activeTab === 'game') renderGame(body);
    else renderScores(body);
  }

  function renderGame(c) {
    // Pending invite
    if (pending) {
      const w = document.createElement('div');
      w.style.cssText = 'padding:28px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px';
      const av = document.createElement('div');
      av.style.cssText = 'width:72px;height:72px;border-radius:50%;background:rgba(255,107,53,.15);border:3px solid rgba(255,107,53,.5);display:flex;align-items:center;justify-content:center;font-size:2rem;font-family:var(--font-mono);font-weight:700;color:#ff6b35';
      av.textContent = (pending.fromName[0] || '?').toUpperCase();
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:.9rem;color:var(--text-1);line-height:1.6';
      msg.innerHTML = `<strong style="color:#ff6b35">${pending.fromName}</strong> vous défie !<br><span style="font-size:.68rem;color:var(--text-2)">10 secondes · qui tapera le plus vite ?</span>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      const yes = document.createElement('button');
      yes.className = 'btn-accent'; yes.textContent = '✔ Accepter'; yes.style.flex = '1';
      yes.onclick = () => {
        const pid = pending.fromId; const pn = pending.fromName;
        game = { peerId: pid, peerName: pn, peerUuid: _YM.peers.find(p=>p.peerId===pid)?.uuid, myScore:0, theirScore:0, phase:'countdown', countdownVal:3, timerTO:null, cdIV:null };
        pending = null;
        send(pid, { type:'accept', to: game.peerUuid });
        startCountdown();
      };
      const no = document.createElement('button');
      no.className = 'btn-secondary'; no.textContent = '✕ Refuser'; no.style.flex = '1';
      no.onclick = () => {
        send(pending.fromId, { type:'decline', to: _YM.peers.find(p=>p.peerId===pending.fromId)?.uuid });
        pending = null; rerender();
      };
      row.appendChild(yes); row.appendChild(no);
      w.appendChild(av); w.appendChild(msg); w.appendChild(row);
      c.appendChild(w); return;
    }

    if (!game) {
      // Idle
      const w = document.createElement('div');
      w.style.cssText = 'text-align:center;padding:40px 20px;color:var(--text-2);font-size:.8rem;line-height:1.9';
      w.innerHTML = '<div style="font-size:2.8rem;margin-bottom:10px">👆</div>Visitez un profil et tapez sur<br><strong style="color:#ff6b35">👆 Tap Race</strong> pour défier !';
      c.appendChild(w); return;
    }

    if (game.phase === 'waiting') {
      const w = document.createElement('div');
      w.style.cssText = 'padding:32px 16px;text-align:center;color:var(--text-2);font-size:.8rem;line-height:1.8';
      w.innerHTML = `<div style="font-size:2rem;margin-bottom:10px">⏳</div>En attente que <strong style="color:var(--accent)">${game.peerName}</strong><br>accepte le défi…`;
      const cancel = document.createElement('button');
      cancel.className = 'btn-secondary'; cancel.style.cssText = 'margin-top:14px;font-size:.7rem';
      cancel.textContent = '✕ Annuler';
      cancel.onclick = () => {
        send(game.peerId, { type:'decline', to: game.peerUuid });
        cleanGame(); rerender();
      };
      w.appendChild(cancel); c.appendChild(w); return;
    }

    if (game.phase === 'countdown') {
      const w = document.createElement('div');
      w.style.cssText = 'padding:32px 16px;text-align:center';
      w.innerHTML = `<div style="font-size:6rem;font-family:var(--font-mono);font-weight:700;color:#ff6b35;line-height:1">${game.countdownVal}</div><div style="font-size:.76rem;color:var(--text-2);margin-top:10px">vs ${game.peerName} · Préparez-vous !</div>`;
      c.appendChild(w); return;
    }

    if (game.phase === 'playing') {
      const elapsed = Math.max(0, Math.min(1, (Date.now() - game.startTs) / 10000));
      const scores = document.createElement('div');
      scores.style.cssText = 'display:flex;justify-content:space-around;padding:14px 16px 6px;font-family:var(--font-mono)';
      scores.innerHTML = `<div style="text-align:center"><div style="font-size:.6rem;color:var(--accent);text-transform:uppercase;margin-bottom:2px">Vous</div><div id="tr-my-score" style="font-size:2.8rem;font-weight:700;color:var(--accent)">${game.myScore}</div></div><div style="align-self:center;color:var(--text-3);font-size:.85rem">vs</div><div style="text-align:center"><div style="font-size:.6rem;color:var(--accent-2,#7c4dff);text-transform:uppercase;margin-bottom:2px">${game.peerName}</div><div id="tr-their-score" style="font-size:2.8rem;font-weight:700;color:var(--accent-2,#7c4dff)">${game.theirScore}</div></div>`;
      c.appendChild(scores);

      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'margin:4px 16px 10px;height:5px;background:var(--border);border-radius:4px;overflow:hidden';
      const barFill = document.createElement('div');
      barFill.id = 'tr-timer-bar';
      barFill.style.cssText = `height:100%;width:${Math.round((1-elapsed)*100)}%;background:#ff6b35;border-radius:4px;transition:width .25s linear`;
      barWrap.appendChild(barFill); c.appendChild(barWrap);

      const barInterval = setInterval(() => {
        const b = document.getElementById('tr-timer-bar');
        if (!b || !game || game.phase !== 'playing') { clearInterval(barInterval); return; }
        const e2 = Math.max(0, Math.min(1, (Date.now() - game.startTs) / 10000));
        b.style.width = Math.round((1-e2)*100) + '%';
      }, 250);

      const tapArea = document.createElement('div');
      tapArea.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 16px 18px';
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:.62rem;color:var(--text-3);font-family:var(--font-mono)';
      hint.textContent = '↓ Tapez le cercle !';
      tapArea.appendChild(hint);

      const tapBtn = document.createElement('div');
      tapBtn.style.cssText = 'width:130px;height:130px;border-radius:50%;background:rgba(255,107,53,.12);border:4px solid #ff6b35;cursor:pointer;box-shadow:0 0 32px rgba(255,107,53,.4);display:flex;align-items:center;justify-content:center;font-size:2.5rem;user-select:none;-webkit-user-select:none;touch-action:manipulation;transition:transform .06s,box-shadow .06s';
      tapBtn.textContent = '👆';

      const doTap = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!game || game.phase !== 'playing') return;
        game.myScore++;
        const ms = document.getElementById('tr-my-score');
        if (ms) ms.textContent = game.myScore;
        tapBtn.style.transform = 'scale(.82)';
        tapBtn.style.boxShadow = '0 0 60px rgba(255,107,53,.9)';
        setTimeout(() => { if(tapBtn) { tapBtn.style.transform = ''; tapBtn.style.boxShadow = '0 0 32px rgba(255,107,53,.4)'; } }, 70);
        send(game.peerId, { type:'tap', score: game.myScore, to: game.peerUuid });
      };
      tapBtn.addEventListener('pointerdown', doTap);
      tapArea.appendChild(tapBtn);
      c.appendChild(tapArea);
      return;
    }

    if (game.phase === 'result') {
      const won  = game.myScore > game.theirScore;
      const draw = game.myScore === game.theirScore;
      const emoji = draw ? '🤝' : (won ? '🏆' : '😅');
      const label = draw ? 'ÉGALITÉ !' : (won ? 'VICTOIRE !' : 'DÉFAITE');
      const col   = draw ? 'var(--text-1)' : (won ? 'var(--accent)' : '#ff6b35');
      const savedPid = game.peerId; const savedName = game.peerName; const savedUuid = game.peerUuid;
      const w = document.createElement('div');
      w.style.cssText = 'padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:12px';
      w.innerHTML = `<div style="font-size:3.5rem">${emoji}</div><div style="font-size:1.1rem;font-weight:800;color:${col};font-family:var(--font-mono)">${label}</div><div style="display:flex;justify-content:space-around;width:100%;font-family:var(--font-mono)"><div style="text-align:center"><div style="font-size:.58rem;color:var(--accent);text-transform:uppercase">Vous</div><div style="font-size:2.2rem;font-weight:700;color:var(--accent)">${game.myScore}</div></div><div style="align-self:center;color:var(--text-3)">vs</div><div style="text-align:center"><div style="font-size:.58rem;color:var(--accent-2,#7c4dff);text-transform:uppercase">${game.peerName}</div><div style="font-size:2.2rem;font-weight:700;color:var(--accent-2,#7c4dff)">${game.theirScore}</div></div></div>`;
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px';
      const again = document.createElement('button');
      again.className = 'btn-accent'; again.textContent = '👆 Rejouer'; again.style.flex = '1';
      again.onclick = () => {
        game = { peerId: savedPid, peerName: savedName, peerUuid: savedUuid, myScore:0, theirScore:0, phase:'waiting', timerTO:null, cdIV:null };
        send(savedPid, { type:'challenge', fromName: _YM.profile.name, to: savedUuid });
        _YM.toast('👆 Nouveau défi envoyé !');
        rerender();
      };
      const close = document.createElement('button');
      close.className = 'btn-secondary'; close.textContent = 'Fermer'; close.style.flex = '1';
      close.onclick = () => { cleanGame(); rerender(); };
      btnRow.appendChild(again); btnRow.appendChild(close);
      w.appendChild(btnRow);
      c.appendChild(w);
    }
  }

  function renderScores(c) {
    const hist = store('history') || [];
    if (!hist.length) {
      c.innerHTML = '<div style="text-align:center;padding:36px 20px;color:var(--text-2);font-size:.8rem"><div style="font-size:2rem;opacity:.2;margin-bottom:8px">🏆</div>Aucune partie jouée.</div>';
      return;
    }
    const stats = hist.reduce((a,h) => { a[h.result]=(a[h.result]||0)+1; return a; }, {});
    const banner = document.createElement('div');
    banner.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--border)';
    [['🏆', stats.win||0, 'var(--accent)'], ['🤝', stats.draw||0, 'var(--text-2)'], ['😅', stats.lose||0, '#ff6b35']].forEach(([e,n,col],i) => {
      const cell = document.createElement('div');
      cell.style.cssText = `flex:1;text-align:center;padding:14px 4px;${i<2?'border-right:1px solid var(--border)':''}`;
      cell.innerHTML = `<div style="font-size:1rem">${e}</div><div style="font-size:1.5rem;font-weight:700;font-family:var(--font-mono);color:${col}">${n}</div>`;
      banner.appendChild(cell);
    });
    c.appendChild(banner);
    hist.slice(0,20).forEach(h => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid var(--border)';
      const col = h.result==='win'?'var(--accent)':h.result==='draw'?'var(--text-1)':'#ff6b35';
      row.innerHTML = `<span style="font-size:.9rem">${h.result==='win'?'🏆':h.result==='draw'?'🤝':'😅'}</span><span style="flex:1;font-size:.74rem;color:var(--text-1)">${h.peerName}</span><span style="font-family:var(--font-mono);font-size:.72rem;color:${col}">${h.myScore} – ${h.theirScore}</span><span style="font-size:.6rem;color:var(--text-3);margin-left:6px">${new Date(h.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span>`;
      c.appendChild(row);
    });
    const rst = document.createElement('button');
    rst.className = 'btn-secondary'; rst.style.cssText = 'font-size:.65rem;margin:10px 14px;width:calc(100% - 28px)';
    rst.textContent = '↺ Remettre à zéro';
    rst.onclick = () => { if (confirm('Remettre à zéro ?')) { localStorage.removeItem(KEY+'history'); rerender(); } };
    c.appendChild(rst);
  }

  return {
    name: 'jeux.tap-race',
    icon: '👆',
    description: 'Duel de tap P2P : tapez le plus vite en 10 secondes !',

    // Called at app startup to register background listener (receive challenges when sphere is closed)
    init(YM) {
      _YM = YM;
      if (YM.onData) YM.onData(ID, onMsg);
    },

    render(container, YM) {
      _YM = YM;
      if (!_hubBound) {
        YM.onHub(onMsg);
        _hubBound = true;
      }
      // Background listener: receive challenges even when sphere is closed
      if (YM.onData) YM.onData(ID, onMsg);
      _activeTab = 'game';
      renderInto(container);
    },

    couple(peerId, container, YM) {
      _YM = YM;
      if (!_hubBound) { YM.onHub(onMsg); _hubBound = true; }
      if (YM.onData) YM.onData(ID, onMsg);
      const peer = YM.peers.find(p => p.peerId === peerId);
      const peerUuid = peer?.uuid;
      const pn = peer?.name || 'Pair';

      const card = document.createElement('div');
      card.style.cssText = 'background:linear-gradient(135deg,rgba(255,107,53,.1),rgba(124,77,255,.07));border:1px solid rgba(255,107,53,.3);border-radius:12px;padding:14px 16px;text-align:center';
      card.innerHTML = `<div style="font-size:.62rem;color:#ff6b35;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">👆 TAP RACE</div><div style="font-size:.78rem;color:var(--text-2);margin-bottom:12px">10 secondes · qui tapera le plus vite ?</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn-accent'; btn.textContent = '👆 Défier ' + pn; btn.style.width = '100%';
      btn.onclick = () => {
        if (game && game.phase !== 'result') { _YM.toast('Tu as déjà une partie en cours !', 'error'); return; }
        game = { peerId, peerName: pn, peerUuid, myScore:0, theirScore:0, phase:'waiting', timerTO:null, cdIV:null };
        send(peerId, { type:'challenge', fromName: YM.profile.name, to: peerUuid });
        _YM.toast('👆 Défi envoyé à ' + pn + ' !');
        btn.textContent = '⏳ En attente…'; btn.disabled = true;
        // Ouvrir la sphere directement pour voir l'état en attente
        YM.openSphere(ID);
      };
      card.appendChild(btn);
      container.appendChild(card);
    },
  };
})();
