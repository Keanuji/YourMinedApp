/* jackpot.sphere.js — Néobank Jackpot v4
 * Plugin YourMine — caisse commune, dons multi-devises, carte Mastercard virtuelle
 * Appels Striga directs depuis le navigateur (HMAC calculé côté client)
 * Logique jackpot via Worker Cloudflare
 */
(function () {
  'use strict';
  window.YM_S = window.YM_S || {};

  /* ─── CONFIG ─────────────────────────────────────────── */
  const WORKER_URL   = 'https://yourmine-worker.yourminedapp.workers.dev';
  const STRIGA_URL   = 'https://www.sandbox.striga.com/api/v1';
  const STRIGA_KEY   = 'znxN-EJK8Hq2eKCYg8FilQI5b_46sXyGssHJnKQrt1k=';
  const STRIGA_SEC   = 'Ir4RavCKBSfkDyYoQu0fUWpYon9bHAY8sGhyywei3kc=';
  const USER_KEY     = 'ym_jackpot_user_v1';
  const CYCLE_KEY    = 'ym_jackpot_cycle_v1';
  const RATES        = { EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.96, JPY: 162 };
  const BONUS_TABLE  = [
    { max: 1,  mult: 1.00 },
    { max: 2,  mult: 1.25 },
    { max: 4,  mult: 1.50 },
    { max: 99, mult: 2.00 },
  ];

  /* ─── STORAGE ─────────────────────────────────────────── */
  function loadUser()   { try { return JSON.parse(localStorage.getItem(USER_KEY)  || 'null'); } catch { return null; } }
  function saveUser(d)  { d === null ? localStorage.removeItem(USER_KEY)  : localStorage.setItem(USER_KEY,  JSON.stringify(d)); }
  function loadCycle()  { try { return JSON.parse(localStorage.getItem(CYCLE_KEY) || 'null'); } catch { return null; } }
  function saveCycle(d) { d === null ? localStorage.removeItem(CYCLE_KEY) : localStorage.setItem(CYCLE_KEY, JSON.stringify(d)); }

  function defaultCycle() {
    return {
      jackpotEur: 0, carryEur: 0, totalTickets: 0, participants: 0,
      uniqueDonors: 0, cycleEnd: Date.now() + 7 * 24 * 3600 * 1000,
      status: 'active', distributedAt: null,
      myTickets: 0, myDepositEur: 0, myReceivedEur: 0,
      wantsWithdraw: false, withdrawn: false, canWithdrawFunds: false,
      donHistory: [], myGifts: [], winners: [],
      walletBalance: 0,
    };
  }

  /* ─── HMAC STRIGA ─────────────────────────────────────── */
  // MD5 via blueimp-md5 (chargé dynamiquement une seule fois)
  // Formule : key=UTF8(secret), msg=ts+METHOD+endpoint+md5(JSON.stringify(body))
  let _md5Ready = null;
  function ensureMd5() {
    if (_md5Ready) return _md5Ready;
    _md5Ready = new Promise(function(resolve) {
      if (window.md5) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.19.0/js/md5.min.js';
      s.onload = resolve;
      s.onerror = resolve; // fallback silencieux
      document.head.appendChild(s);
    });
    return _md5Ready;
  }

  async function strigaHmac(method, endpoint, bodyObj) {
    await ensureMd5();
    const ts       = Date.now().toString();
    const bodyStr  = JSON.stringify(bodyObj);
    const bodyHash = window.md5 ? window.md5(bodyStr) : '';
    const message  = ts + method + endpoint + bodyHash;
    const keyBytes = new TextEncoder().encode(STRIGA_SEC);
    const key      = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const sigHex   = Array.from(new Uint8Array(sig)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    return 'HMAC ' + ts + ':' + sigHex;
  }



  /* ─── API STRIGA (appel direct navigateur) ────────────── */
  async function striga(method, endpoint, body = {}) {
    const auth    = await strigaHmac(method, endpoint, method === 'GET' ? {} : body);
    const options = {
      method,
      headers: {
        'Content-Type':  'application/json',
        'api-key':       STRIGA_KEY,
        'Authorization': auth,
      },
    };
    if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);
    const r = await fetch(STRIGA_URL + endpoint, options);
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error || 'Striga ' + r.status);
    return d;
  }

  /* ─── API WORKER (jackpot logic) ──────────────────────── */
  async function worker(route, body) {
    const isGet = body === undefined;
    const r = await fetch(WORKER_URL + route, {
      method:  isGet ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    isGet ? undefined : JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || d.message || 'Worker ' + r.status);
    return d;
  }

  /* ─── HELPERS ─────────────────────────────────────────── */
  function toEUR(amt, cur)  { return amt / (RATES[cur] || 1); }
  function getBonus(n)      { return (BONUS_TABLE.find(b => n <= b.max) || BONUS_TABLE[BONUS_TABLE.length - 1]).mult; }
  function eur(n)           { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n); }
  function num(n)           { return new Intl.NumberFormat('fr-FR').format(Math.round(n)); }
  function esc(s)           { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function copyText(t, btn) { navigator.clipboard?.writeText(t).catch(() => {}); const o = btn.textContent; btn.textContent = 'Copié !'; setTimeout(() => btn.textContent = o, 1500); }

  function timeLeft(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return 'Tirage en cours…';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d + 'j ' + h + 'h ' + m + 'm';
  }
  function cycleProgress(ts) {
    const total = 7 * 24 * 3600 * 1000, ms = ts - Date.now();
    return Math.min(Math.max((total - ms) / total, 0), 1);
  }

  /* ─── CSS ─────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('jk-css')) return;
    const s = document.createElement('style'); s.id = 'jk-css';
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=DM+Mono:wght@400;500&display=swap');
.jk{font-family:'DM Sans',system-ui,sans-serif;display:flex;flex-direction:column;height:100%;overflow:hidden;background:#07070e;color:#fff;-webkit-font-smoothing:antialiased}
.jk *{box-sizing:border-box}
.jk-nav{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid rgba(255,255,255,.06);background:#07070e;flex-shrink:0}
.jk-tab{padding:11px 0 9px;background:none;border:none;border-bottom:2px solid transparent;font-size:10px;font-weight:400;color:rgba(255,255,255,.3);cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s;-webkit-tap-highlight-color:transparent}
.jk-tab.on{color:#fff;border-bottom-color:#7c3aed;font-weight:500}
.jk-body{flex:1;overflow-y:auto;padding:18px 16px 40px;-webkit-overflow-scrolling:touch}
.jk-body::-webkit-scrollbar{width:2px}
.jk-body::-webkit-scrollbar-thumb{background:rgba(124,58,237,.3);border-radius:1px}
.jk-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:16px;margin-bottom:12px}
.jk-sec{font-size:10px;color:rgba(255,255,255,.22);letter-spacing:1px;text-transform:uppercase;margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.06)}
.jk-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.jk-row:last-child{border-bottom:none}
.jk-rl{font-size:13px;color:rgba(255,255,255,.4)}
.jk-rv{font-size:13px;font-weight:500;color:#fff}
.jk-badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:500}
.jk-bp{background:rgba(124,58,237,.15);color:#a78bfa;border:1px solid rgba(124,58,237,.25)}
.jk-bg{background:rgba(52,211,153,.1);color:#34d399;border:1px solid rgba(52,211,153,.2)}
.jk-ba{background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.2)}
.jk-br{background:rgba(239,68,68,.1);color:#f87171;border:1px solid rgba(239,68,68,.2)}
.jk-notice{padding:10px 13px;border-radius:12px;font-size:12px;line-height:1.5;margin-bottom:10px;display:flex;gap:8px;align-items:flex-start}
.jk-ni{background:rgba(124,58,237,.08);color:#a78bfa;border:1px solid rgba(124,58,237,.2)}
.jk-nw{background:rgba(251,191,36,.07);color:#fbbf24;border:1px solid rgba(251,191,36,.2)}
.jk-ns{background:rgba(52,211,153,.07);color:#34d399;border:1px solid rgba(52,211,153,.18)}
.jk-nr{background:rgba(239,68,68,.07);color:#f87171;border:1px solid rgba(239,68,68,.18)}
.jk-label{display:block;font-size:11px;color:rgba(255,255,255,.3);margin-bottom:5px;letter-spacing:.3px}
.jk-inp{width:100%;font-size:14px;padding:10px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;font-family:'DM Sans',sans-serif;outline:none;margin-bottom:11px;-webkit-appearance:none;transition:border-color .2s,background .2s}
.jk-inp:focus{border-color:rgba(124,58,237,.6);background:rgba(255,255,255,.06);box-shadow:0 0 0 3px rgba(124,58,237,.1)}
.jk-inp::placeholder{color:rgba(255,255,255,.18)}
.jk-sel{width:100%;font-size:14px;padding:10px 13px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;font-family:'DM Sans',sans-serif;outline:none;margin-bottom:11px;-webkit-appearance:none}
.jk-sel option{background:#1a1035;color:#fff}
.jk-cta{width:100%;padding:12px;border:none;border-radius:14px;font-size:14px;font-weight:500;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-family:'DM Sans',sans-serif;transition:all .18s;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px rgba(124,58,237,.22)}
.jk-cta:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(124,58,237,.35)}
.jk-cta:active{transform:scale(.98)}
.jk-cta:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.jk-btn{width:100%;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:14px;font-size:13px;cursor:pointer;background:rgba(255,255,255,.03);color:rgba(255,255,255,.5);font-family:'DM Sans',sans-serif;transition:all .15s;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px}
.jk-btn:hover{border-color:rgba(124,58,237,.4);color:#fff;background:rgba(124,58,237,.07)}
.jk-btn.red{border-color:rgba(239,68,68,.3);color:rgba(239,68,68,.7)}
.jk-btn.red:hover{background:rgba(239,68,68,.07);color:#f87171}
.jk-btn:disabled{opacity:.35;cursor:not-allowed}
.jk-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.06);margin:8px 0 3px;overflow:hidden}
.jk-bar-fill{height:100%;border-radius:3px;background:#7c3aed;transition:width .4s}
.jk-vcard{background:linear-gradient(135deg,#0a0020,#18004a,#2a1270);border-radius:22px;padding:20px;margin-bottom:12px;aspect-ratio:1.7;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;border:1px solid rgba(124,58,237,.25)}
.jk-vcard::before{content:'';position:absolute;top:-30px;right:-30px;width:160px;height:160px;border-radius:50%;background:rgba(124,58,237,.12);pointer-events:none}
.jk-mono{font-family:'DM Mono',monospace}
.jk-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
.jk-metric{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:13px}
.jk-metric-val{font-size:20px;font-weight:500;color:#fff}
.jk-metric-lbl{font-size:11px;color:rgba(255,255,255,.3);margin-top:2px}
.jk-uuid{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 13px;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.jk-uuid-val{font-family:'DM Mono',monospace;font-size:12px;color:rgba(255,255,255,.5)}
.jk-copy{background:none;border:none;cursor:pointer;font-size:12px;color:#a78bfa;font-family:'DM Sans',sans-serif;padding:0;white-space:nowrap}
.jk-chance{font-size:38px;font-weight:500;color:#7c3aed;letter-spacing:-1px;margin:8px 0 2px}
.jk-avatar{width:32px;height:32px;border-radius:50%;background:rgba(124,58,237,.15);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#a78bfa;flex-shrink:0}
.jk-hist-row{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.jk-hist-row:last-child{border-bottom:none}
.jk-pay-icon{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500;color:rgba(255,255,255,.5);flex-shrink:0}
.jk-faq-item{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer}
.jk-faq-item:last-child{border-bottom:none}
.jk-faq-q{font-size:13px;font-weight:500;display:flex;justify-content:space-between;align-items:center;color:#fff}
.jk-faq-a{font-size:12px;color:rgba(255,255,255,.4);margin-top:8px;line-height:1.6}
.jk-kyc-step{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.jk-kyc-step:last-child{border-bottom:none}
.jk-kyc-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;flex-shrink:0}
.jk-dot-done{background:rgba(52,211,153,.15);color:#34d399}
.jk-dot-pend{background:rgba(124,58,237,.15);color:#a78bfa}
.jk-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.1);border-top-color:#7c3aed;border-radius:50%;animation:jk-r .6s linear infinite;display:inline-block;flex-shrink:0}
.jk-locked-banner{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.2);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.jk-locked-title{font-size:12px;font-weight:500;color:#fbbf24;margin-bottom:4px}
.jk-locked-sub{font-size:11px;color:rgba(251,191,36,.6);line-height:1.5}
.jk-carry-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;background:rgba(52,211,153,.08);color:#34d399;border:1px solid rgba(52,211,153,.2);margin-left:6px}
@keyframes jk-r{to{transform:rotate(360deg)}}
@keyframes jk-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.jk-in{animation:jk-up .25s ease forwards}
`;
    document.head.appendChild(s);
  }

  /* ─── DOM HELPERS ─────────────────────────────────────── */
  function mkSpin() { const d = document.createElement('span'); d.className = 'jk-spin'; return d; }
  function mkNotice(msg, type) {
    type = type || 'info';
    const cls  = { info: 'jk-ni', warn: 'jk-nw', ok: 'jk-ns', err: 'jk-nr' }[type] || 'jk-ni';
    const icon = { info: 'i', warn: '!', ok: '✓', err: '✕' }[type] || 'i';
    const d = document.createElement('div');
    d.className = 'jk-notice ' + cls + ' jk-in';
    d.innerHTML = '<span>' + icon + '</span><span>' + esc(msg) + '</span>';
    return d;
  }
  function v(id) { return (document.getElementById(id) || {}).value && document.getElementById(id).value.trim() || ''; }

  /* ─── STATE ───────────────────────────────────────────── */
  let _tab     = 'jackpot';
  let _faqOpen = {};
  let _payments = [
    { merchant: 'Netflix',   amount: 15.99, currency: 'EUR', date: '06 avr', cat: 'Abonnement' },
    { merchant: 'Carrefour', amount: 43.20, currency: 'EUR', date: '05 avr', cat: 'Courses' },
    { merchant: 'Uber',      amount: 12.50, currency: 'EUR', date: '04 avr', cat: 'Transport' },
  ];

  /* ─── RENDER PANEL ────────────────────────────────────── */
  function renderPanel(container) {
    injectCSS();
    container.innerHTML = '';
    container.className = 'jk';
    const nav = document.createElement('div'); nav.className = 'jk-nav';
    [['jackpot','Jackpot'],['wallet','Wallet'],['dons','Dons'],['payments','Paiements'],['config','Config']].forEach(function(pair) {
      const id = pair[0], label = pair[1];
      const b = document.createElement('button');
      b.className = 'jk-tab' + (_tab === id ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', function() { _tab = id; renderPanel(container); });
      nav.appendChild(b);
    });
    container.appendChild(nav);
    const body = document.createElement('div'); body.className = 'jk-body'; container.appendChild(body);
    if      (_tab === 'jackpot')  tabJackpot(body, container);
    else if (_tab === 'wallet')   tabWallet(body, container);
    else if (_tab === 'dons')     tabDons(body, container);
    else if (_tab === 'payments') tabPayments(body, container);
    else                          tabConfig(body, container);
  }

  /* ─── TAB : JACKPOT ───────────────────────────────────── */
  function tabJackpot(body, root) {
    body.classList.add('jk-in');
    const user  = loadUser();
    const cycle = loadCycle() || defaultCycle();
    const pct   = cycle.myTickets / Math.max(cycle.totalTickets, 1);
    const circ  = 2 * Math.PI * 36;
    const offset = circ * (1 - cycleProgress(cycle.cycleEnd));
    const uuid  = user ? (user.id || user.userId || ('usr_' + (user.email || '').slice(0, 8))) : null;
    const jackpotTotal = (cycle.jackpotEur || 0) + (cycle.carryEur || 0);

    const hero = document.createElement('div'); hero.className = 'jk-card'; hero.style.padding = '20px 16px';
    hero.innerHTML = '<div style="font-size:10px;color:rgba(255,255,255,.3);letter-spacing:1px;margin-bottom:10px">JACKPOT EN COURS</div>' +
      '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px">' +
        '<div style="font-size:42px;font-weight:500;letter-spacing:-1.5px;line-height:1">' + eur(jackpotTotal) + '</div>' +
        (cycle.carryEur > 0 ? '<span class="jk-carry-pill">dont ' + eur(cycle.carryEur) + ' reporté</span>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:16px">' +
        num(cycle.participants) + ' participants · ' + num(cycle.totalTickets) + ' tickets · ' +
        '<span style="background:rgba(255,255,255,.06);border-radius:99px;padding:2px 8px;font-size:11px">multi-devises → EUR</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:16px">' +
        '<svg width="78" height="78" viewBox="0 0 78 78" style="flex-shrink:0;transform:rotate(-90deg)">' +
          '<circle cx="39" cy="39" r="36" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"/>' +
          '<circle cx="39" cy="39" r="36" fill="none" stroke="#7c3aed" stroke-width="4" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" stroke-linecap="round"/>' +
        '</svg>' +
        '<div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.3)">Tirage automatique dans</div>' +
          '<div style="font-size:20px;font-weight:500;margin:3px 0" id="jk-clock">' + timeLeft(cycle.cycleEnd) + '</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.3)">50% au gagnant · 50% reporté au cycle suivant</div>' +
        '</div>' +
      '</div>';
    body.appendChild(hero);

    const chanceCard = document.createElement('div'); chanceCard.className = 'jk-card';
    chanceCard.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:4px">Ma chance de gagner</div>' +
      '<div class="jk-chance">' + (pct * 100).toFixed(3) + '%</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:6px">' + num(cycle.myTickets) + ' tickets sur ' + num(cycle.totalTickets) + ' · 1 ticket = 1 €</div>' +
      '<div class="jk-bar"><div class="jk-bar-fill" style="width:' + Math.max(pct * 100, .3) + '%"></div></div>' +
      (cycle.myTickets === 0 ? '<div style="font-size:12px;color:rgba(255,255,255,.3);margin-top:6px">Fais un don pour obtenir des tickets.</div>' : '');
    body.appendChild(chanceCard);

    if (uuid) {
      const uuidWrap = document.createElement('div');
      uuidWrap.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:5px">Mon UUID — partage-le pour recevoir des dons</div>';
      const uuidBox = document.createElement('div'); uuidBox.className = 'jk-uuid';
      const uuidVal = document.createElement('span'); uuidVal.className = 'jk-uuid-val'; uuidVal.textContent = uuid;
      const copyBtn = document.createElement('button'); copyBtn.className = 'jk-copy'; copyBtn.textContent = 'Copier';
      copyBtn.addEventListener('click', function() { copyText(uuid, copyBtn); });
      uuidBox.appendChild(uuidVal); uuidBox.appendChild(copyBtn); uuidWrap.appendChild(uuidBox);
      body.appendChild(uuidWrap);
    } else {
      body.appendChild(mkNotice('Crée un compte (Config) pour obtenir ton UUID et participer.', 'info'));
    }

    const sec = document.createElement('div'); sec.className = 'jk-sec'; sec.textContent = 'GAGNANTS PRÉCÉDENTS'; body.appendChild(sec);
    const wCard = document.createElement('div'); wCard.className = 'jk-card'; wCard.style.padding = '12px 16px';
    const winners = (cycle.winners && cycle.winners.length) ? cycle.winners : [
      { name: 'J.M.', winnerAmount: 4160, totalJackpot: 8320, date: '31 mar', tickets: 412, currency: 'EUR' },
      { name: 'S.K.', winnerAmount: 3070, totalJackpot: 6140, date: '24 mar', tickets: 298, currency: 'GBP' },
      { name: 'A.L.', winnerAmount: 4935, totalJackpot: 9870, date: '17 mar', tickets: 503, currency: 'USD' },
    ];
    winners.forEach(function(w, i) {
      const row = document.createElement('div'); row.className = 'jk-hist-row'; if (i === 0) row.style.paddingTop = '0';
      row.innerHTML = '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="jk-avatar">' + esc(w.name.split('.')[0]) + '</div>' +
        '<div><div style="font-size:13px;font-weight:500">' + esc(w.name) + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,.3)">' + esc(w.date) + ' · ' + num(w.tickets) + ' tickets · reçu en ' + esc(w.currency || 'EUR') + '</div></div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-size:15px;font-weight:500;color:#34d399">' + eur(w.winnerAmount) + '</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,.3)">50% de ' + eur(w.totalJackpot) + '</div>' +
      '</div>';
      wCard.appendChild(row);
    });
    body.appendChild(wCard);

    setInterval(function() { const el = document.getElementById('jk-clock'); if (el) el.textContent = timeLeft(cycle.cycleEnd); }, 30000);
  }

  /* ─── TAB : WALLET ────────────────────────────────────── */
  function tabWallet(body, root) {
    body.classList.add('jk-in');
    const user  = loadUser();
    const cycle = loadCycle() || defaultCycle();
    if (!user) { body.appendChild(mkNotice('Crée un compte dans Config pour accéder au wallet.', 'info')); return; }

    const vcard = document.createElement('div'); vcard.className = 'jk-vcard';
    vcard.innerHTML = '<div style="position:relative;z-index:1"><div style="font-size:9px;color:rgba(255,255,255,.35);letter-spacing:2px" class="jk-mono">JACKPOT · STRIGA · MASTERCARD</div></div>' +
      '<div style="position:relative;z-index:1">' +
        '<div style="font-size:11px;color:rgba(255,255,255,.35);margin-bottom:4px" class="jk-mono">SOLDE DISPONIBLE</div>' +
        '<div style="font-size:32px;font-weight:500;color:#fff;letter-spacing:-1px;margin-bottom:14px" id="jk-wallet-bal">…</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-end">' +
          '<div><div style="font-size:9px;color:rgba(255,255,255,.35);letter-spacing:1px;margin-bottom:3px" class="jk-mono">TITULAIRE</div>' +
          '<div style="font-size:13px;color:#fff;font-weight:500">' + esc((user.firstName || '').toUpperCase()) + ' ' + esc((user.lastName || '').toUpperCase()) + '</div></div>' +
          '<div style="text-align:right"><div style="font-size:9px;color:rgba(255,255,255,.3);margin-bottom:2px" class="jk-mono">•••• •••• •••• 4291</div>' +
          '<div style="font-size:10px;color:rgba(255,255,255,.3)" class="jk-mono">MASTERCARD VIRTUAL</div></div>' +
        '</div>' +
      '</div>';
    body.appendChild(vcard);

    // Charger le vrai solde depuis Striga
    const userId = user.id || user.userId;
    if (userId) {
      striga('POST', '/wallets/get/all', { userId: userId, startDate: 0, endDate: Date.now(), page: 0 }).then(function(r) {
        const accounts = (r.wallets && r.wallets[0] && r.wallets[0].accounts) || {};
        const eurAcc   = accounts['EUR'];
        const bal      = eurAcc ? (parseInt(eurAcc.availableBalance || 0) / 100) : 0;
        const el = document.getElementById('jk-wallet-bal');
        if (el) el.textContent = eur(bal);
        cycle.walletBalance = bal;
        saveCycle(cycle);
      }).catch(function() {
        const el = document.getElementById('jk-wallet-bal');
        if (el) el.textContent = eur(cycle.walletBalance || 0);
      });
    }

    const g2 = document.createElement('div'); g2.className = 'jk-grid2';
    g2.innerHTML = '<div class="jk-metric"><div class="jk-metric-val">' + eur(cycle.myReceivedEur || 0) + '</div><div class="jk-metric-lbl">dons reçus ce cycle</div></div>' +
      '<div class="jk-metric"><div class="jk-metric-val">' + (cycle.uniqueDonors || 0) + '</div><div class="jk-metric-lbl">donateurs actifs</div></div>';
    body.appendChild(g2);

    const retSec = document.createElement('div'); retSec.className = 'jk-sec'; retSec.textContent = 'DONS REÇUS — CAISSE'; body.appendChild(retSec);
    const fb = document.createElement('div');

    if (cycle.wantsWithdraw && !cycle.withdrawn) {
      const locked = document.createElement('div'); locked.className = 'jk-locked-banner';
      locked.innerHTML = '<div class="jk-locked-title">Fonds en attente de déblocage</div>' +
        '<div class="jk-locked-sub">' + eur(cycle.myReceivedEur || 0) + ' bloqués jusqu\'à la fin de la distribution du jackpot.<br>Tes tickets ont été annulés.</div>';
      body.appendChild(locked);
      const unlockBtn = document.createElement('button'); unlockBtn.className = 'jk-cta';
      unlockBtn.textContent = cycle.canWithdrawFunds ? 'Récupérer mes fonds · ' + eur(cycle.myReceivedEur || 0) : 'Fonds disponibles après distribution';
      unlockBtn.disabled = !cycle.canWithdrawFunds;
      unlockBtn.addEventListener('click', async function() {
        unlockBtn.disabled = true; unlockBtn.innerHTML = ''; unlockBtn.appendChild(mkSpin()); unlockBtn.append(' Retrait…');
        try {
          await worker('/jackpot/retrait/effectif', { userId: user.id || user.userId, accountId: user.accountId });
          cycle.withdrawn = true; cycle.myReceivedEur = 0; saveCycle(cycle);
          fb.appendChild(mkNotice('Fonds disponibles dans ton wallet Striga.', 'ok'));
          tabWallet(body, root);
        } catch (e) {
          fb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
          unlockBtn.disabled = false; unlockBtn.textContent = 'Récupérer mes fonds';
        }
      });
      body.appendChild(unlockBtn);
    } else if (cycle.withdrawn) {
      body.appendChild(mkNotice('Fonds retirés ce cycle. Tu ne participes plus au jackpot.', 'info'));
    } else {
      body.appendChild(mkNotice('Quitter le jeu annule tes tickets immédiatement. Tes fonds seront disponibles après la distribution du jackpot.', 'warn'));
      const withdrawBtn = document.createElement('button'); withdrawBtn.className = 'jk-btn red';
      withdrawBtn.textContent = 'Quitter le jeu · ' + eur(cycle.myReceivedEur || 0);
      withdrawBtn.disabled = (cycle.myReceivedEur || 0) <= 0;
      withdrawBtn.addEventListener('click', async function() {
        if (!confirm('Quitter le jeu ? Tes tickets seront annulés immédiatement.')) return;
        withdrawBtn.disabled = true; withdrawBtn.innerHTML = ''; withdrawBtn.appendChild(mkSpin()); withdrawBtn.append(' Traitement…');
        try {
          const r = await worker('/jackpot/retrait/demande', { userId: user.id || user.userId });
          cycle.wantsWithdraw = true; cycle.myTickets = 0;
          cycle.canWithdrawFunds = r.retrait && r.retrait.fundsLockedUntil === null;
          saveCycle(cycle);
          fb.appendChild(mkNotice('Tickets annulés. Fonds disponibles après la distribution du jackpot.', 'ok'));
          tabWallet(body, root);
        } catch (e) {
          fb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
          withdrawBtn.disabled = false; withdrawBtn.textContent = 'Quitter le jeu · ' + eur(cycle.myReceivedEur || 0);
        }
      });
      body.appendChild(withdrawBtn);
    }
    body.appendChild(fb);

    // IBAN
    const ibanSec = document.createElement('div'); ibanSec.className = 'jk-sec'; ibanSec.textContent = 'IBAN'; body.appendChild(ibanSec);
    const ibanCard = document.createElement('div'); ibanCard.className = 'jk-card'; ibanCard.style.padding = '14px 16px';
    let ibanVisible = false;
    const ibanVal = user.iban || 'Non disponible — complétez le KYC';

    function renderIBAN() {
      ibanCard.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:12px;color:rgba(255,255,255,.35)">Virement entrant, salaire, remboursements…</span>' +
        '<button class="jk-copy" id="jk-toggle-iban">' + (ibanVisible ? 'Masquer' : 'Afficher') + '</button></div>' +
        '<div class="jk-mono" style="font-size:13px;color:rgba(255,255,255,.7);letter-spacing:1px;word-break:break-all">' +
          (ibanVisible ? esc(ibanVal) : 'FR76 •••• •••• •••• •••• •••• •••') + '</div>' +
        (ibanVisible ? '<div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:6px">BIC : STRIEU21XXX</div>' +
          '<button class="jk-copy" style="margin-top:8px;display:block" id="jk-copy-iban">Copier l\'IBAN</button>' : '');
      document.getElementById('jk-toggle-iban').addEventListener('click', function() { ibanVisible = !ibanVisible; renderIBAN(); });
      const copyIbanBtn = document.getElementById('jk-copy-iban');
      if (copyIbanBtn) copyIbanBtn.addEventListener('click', function(e) { copyText(ibanVal, e.target); });
    }
    renderIBAN(); body.appendChild(ibanCard);

    const donSec = document.createElement('div'); donSec.className = 'jk-sec'; donSec.textContent = 'DONS REÇUS CE CYCLE'; body.appendChild(donSec);
    const donCard = document.createElement('div'); donCard.className = 'jk-card'; donCard.style.padding = '12px 16px';
    const donHistory = (cycle.donHistory && cycle.donHistory.length) ? cycle.donHistory : [
      { from: 'A.M.', amount: 20,    currency: 'EUR', date: '07 avr', tickets: 25 },
      { from: 'S.K.', amount: 22.13, currency: 'USD', date: '06 avr', tickets: 18 },
      { from: 'L.R.', amount: 50,    currency: 'EUR', date: '05 avr', tickets: 75 },
    ];
    donHistory.forEach(function(d, i) {
      const row = document.createElement('div'); row.className = 'jk-hist-row'; if (i === 0) row.style.paddingTop = '0';
      row.innerHTML = '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="jk-avatar">' + esc(d.from.split('.')[0]) + '</div>' +
        '<div><div style="font-size:13px;font-weight:500">Don de ' + esc(d.from) + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,.3)">' + esc(d.date) + ' · en ' + esc(d.currency) + ' · +' + num(d.tickets) + ' tickets pour eux</div></div>' +
      '</div><span class="jk-badge jk-bg">+' + eur(toEUR(d.amount, d.currency)) + '</span>';
      donCard.appendChild(row);
    });
    body.appendChild(donCard);
  }

  /* ─── TAB : DONS ──────────────────────────────────────── */
  function tabDons(body, root) {
    body.classList.add('jk-in');
    const user  = loadUser();
    const cycle = loadCycle() || defaultCycle();
    if (!user) { body.appendChild(mkNotice('Crée un compte dans Config pour envoyer des dons.', 'info')); return; }
    if (cycle.wantsWithdraw || cycle.withdrawn) {
      body.appendChild(mkNotice('Tu as quitté le jeu ce cycle. Tu pourras participer au prochain cycle.', 'warn')); return;
    }

    body.appendChild(mkNotice('1 ticket = 1 EUR converti. Répartis vers plusieurs personnes pour augmenter ton multiplicateur (jusqu\'à ×2).', 'info'));

    const sec1 = document.createElement('div'); sec1.className = 'jk-sec'; sec1.textContent = 'ENVOYER UN DON'; body.appendChild(sec1);
    const formCard = document.createElement('div'); formCard.className = 'jk-card'; body.appendChild(formCard);

    const uuidLbl = document.createElement('label'); uuidLbl.className = 'jk-label'; uuidLbl.textContent = 'UUID ou email du destinataire'; formCard.appendChild(uuidLbl);
    const uuidInp = document.createElement('input'); uuidInp.className = 'jk-inp'; uuidInp.id = 'jk-don-uuid'; uuidInp.placeholder = 'usr_4f3a9b2c… ou ami@email.com'; formCard.appendChild(uuidInp);

    const row2 = document.createElement('div'); row2.style.cssText = 'display:flex;gap:8px'; formCard.appendChild(row2);
    const amtWrap = document.createElement('div'); amtWrap.style.flex = '1';
    const amtLbl = document.createElement('label'); amtLbl.className = 'jk-label'; amtLbl.textContent = 'Montant'; amtWrap.appendChild(amtLbl);
    const amtInp = document.createElement('input'); amtInp.className = 'jk-inp'; amtInp.id = 'jk-don-amt'; amtInp.type = 'number'; amtInp.placeholder = '50'; amtInp.min = '1'; amtInp.step = '1'; amtWrap.appendChild(amtInp);
    row2.appendChild(amtWrap);

    const curWrap = document.createElement('div'); curWrap.style.width = '90px';
    const curLbl = document.createElement('label'); curLbl.className = 'jk-label'; curLbl.textContent = 'Devise'; curWrap.appendChild(curLbl);
    const curSel = document.createElement('select'); curSel.className = 'jk-sel'; curSel.id = 'jk-don-cur';
    ['EUR','USD','GBP','CHF','JPY'].forEach(function(c) { const o = document.createElement('option'); o.value = c; o.textContent = c; curSel.appendChild(o); });
    curWrap.appendChild(curSel); row2.appendChild(curWrap);

    const prevDiv = document.createElement('div'); prevDiv.id = 'jk-don-prev'; prevDiv.style.display = 'none';
    prevDiv.style.cssText = 'background:rgba(255,255,255,.03);border-radius:12px;padding:12px;margin-bottom:12px;border:1px solid rgba(255,255,255,.06)';
    prevDiv.innerHTML = '<div class="jk-row" style="padding-top:0"><span class="jk-rl">Équivalent EUR</span><span class="jk-rv" id="jk-prev-eur">—</span></div>' +
      '<div class="jk-row"><span class="jk-rl">Destinataires uniques</span><span class="jk-rv" id="jk-prev-count">—</span></div>' +
      '<div class="jk-row"><span class="jk-rl">Multiplicateur</span><span class="jk-badge jk-bp" id="jk-prev-mult">×1.00</span></div>' +
      '<div class="jk-row"><span class="jk-rl">Tickets reçus</span><span class="jk-rv" id="jk-prev-tickets">—</span></div>';
    formCard.appendChild(prevDiv);

    function calcDon() {
      const uuid = uuidInp.value.trim(), amt = parseFloat(amtInp.value) || 0, cur = curSel.value;
      if (!uuid || amt <= 0) { prevDiv.style.display = 'none'; return null; }
      const amtEur     = toEUR(amt, cur);
      const myGifts    = cycle.myGifts || [];
      const uniqBefore = new Set(myGifts.map(function(g) { return g.toRaw; })).size;
      const isNew      = !myGifts.find(function(g) { return g.toRaw === uuid; });
      const uniq       = uniqBefore + (isNew ? 1 : 0);
      const mult       = getBonus(uniq);
      const tickets    = Math.floor(amtEur * mult);
      prevDiv.style.display = 'block';
      document.getElementById('jk-prev-eur').textContent   = eur(amtEur) + (cur !== 'EUR' ? ' (converti)' : '');
      document.getElementById('jk-prev-count').textContent = uniq + ' unique' + (uniq > 1 ? 's' : '');
      const me = document.getElementById('jk-prev-mult'); me.textContent = '×' + mult.toFixed(2);
      me.className = 'jk-badge ' + (mult >= 2 ? 'jk-bg' : mult >= 1.5 ? 'jk-ba' : 'jk-bp');
      document.getElementById('jk-prev-tickets').textContent = num(tickets) + ' tickets';
      return { uuid: uuid, amt: amt, cur: cur, amtEur: amtEur, mult: mult, tickets: tickets };
    }

    uuidInp.addEventListener('input', calcDon);
    amtInp.addEventListener('input', calcDon);
    curSel.addEventListener('change', calcDon);

    const donBtn = document.createElement('button'); donBtn.className = 'jk-cta'; donBtn.textContent = 'Envoyer le don'; formCard.appendChild(donBtn);
    const donFb  = document.createElement('div'); formCard.appendChild(donFb);

    donBtn.addEventListener('click', async function() {
      const res = calcDon(); donFb.innerHTML = '';
      if (!res) { donFb.appendChild(mkNotice('Renseigne un destinataire et un montant.', 'err')); return; }

      donBtn.disabled = true; donBtn.innerHTML = ''; donBtn.appendChild(mkSpin()); donBtn.append(' Envoi…');
      try {
        const userId = user.id || user.userId;

        // 1. Récupérer les wallets des deux utilisateurs via Striga
        const senderWallets = await striga('POST', '/wallets/get/all', { userId: userId, startDate: 0, endDate: Date.now(), page: 0 });
        const senderWallet  = senderWallets.wallets && senderWallets.wallets[0];
        if (!senderWallet) throw new Error('Wallet expéditeur introuvable');
        const senderEurEntries = Object.entries(senderWallet.accounts || {}).filter(function(e) { return e[0] === 'EUR'; });
        if (!senderEurEntries.length) throw new Error('Compte EUR expéditeur introuvable');
        const senderAccountId = senderEurEntries[0][1].accountId || senderEurEntries[0][1].id;

        // 2. Appel Worker pour enregistrer le don (calcul tickets, D1)
        await worker('/jackpot/don', {
          fromUserId:    userId,
          toUserId:      res.uuid,
          amountLocal:   res.amt,
          currency:      res.cur,
          fromAccountId: senderAccountId,
          toAccountId:   res.uuid, // le Worker résoudra l'accountId du destinataire
        });

        // 3. Mettre à jour le state local
        cycle.jackpotEur   = (cycle.jackpotEur || 0) + res.amtEur;
        cycle.totalTickets = (cycle.totalTickets || 0) + res.tickets;
        cycle.myTickets    = (cycle.myTickets || 0) + res.tickets;
        if (!cycle.myGifts) cycle.myGifts = [];
        cycle.myGifts.push({ to: res.uuid.slice(0, 10) + '…', toRaw: res.uuid, amount: res.amtEur, cur: res.cur, mult: res.mult, tickets: res.tickets, date: new Date().toLocaleDateString('fr-FR') });
        saveCycle(cycle);

        donFb.appendChild(mkNotice('Don de ' + res.amt + ' ' + res.cur + ' (' + eur(res.amtEur) + ') envoyé — +' + num(res.tickets) + ' tickets (×' + res.mult.toFixed(2) + ')', 'ok'));
        uuidInp.value = ''; amtInp.value = ''; prevDiv.style.display = 'none';
        donBtn.disabled = false; donBtn.textContent = 'Envoyer le don';
        renderGiftsList(giftsCard, cycle);
      } catch (e) {
        donFb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
        donBtn.disabled = false; donBtn.textContent = 'Envoyer le don';
      }
    });

    // QR code
    const qrSec = document.createElement('div'); qrSec.className = 'jk-sec'; qrSec.textContent = 'OU PAR QR CODE'; body.appendChild(qrSec);
    const qrCard = document.createElement('div'); qrCard.className = 'jk-card'; qrCard.style.cssText = 'text-align:center;padding:20px';
    qrCard.innerHTML = '<div style="width:72px;height:72px;background:rgba(255,255,255,.05);border-radius:14px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center">' +
      '<svg width="40" height="40" viewBox="0 0 40 40" fill="none">' +
        '<rect x="2" y="2" width="14" height="14" rx="2" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/><rect x="6" y="6" width="6" height="6" rx="1" fill="rgba(255,255,255,.3)"/>' +
        '<rect x="24" y="2" width="14" height="14" rx="2" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/><rect x="28" y="6" width="6" height="6" rx="1" fill="rgba(255,255,255,.3)"/>' +
        '<rect x="2" y="24" width="14" height="14" rx="2" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/><rect x="6" y="28" width="6" height="6" rx="1" fill="rgba(255,255,255,.3)"/>' +
        '<rect x="24" y="24" width="4" height="4" rx="1" fill="rgba(255,255,255,.3)"/><rect x="30" y="24" width="4" height="4" rx="1" fill="rgba(255,255,255,.3)"/>' +
        '<rect x="24" y="30" width="4" height="4" rx="1" fill="rgba(255,255,255,.3)"/><rect x="30" y="30" width="4" height="4" rx="1" fill="rgba(255,255,255,.3)"/>' +
      '</svg></div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:12px">Scanne le QR d\'un ami pour saisir son UUID automatiquement</div>';
    const scanBtn = document.createElement('button'); scanBtn.className = 'jk-btn'; scanBtn.style.cssText = 'width:auto;padding:8px 20px;display:inline-flex'; scanBtn.textContent = 'Scanner un QR code'; qrCard.appendChild(scanBtn);
    body.appendChild(qrCard);

    const statSec = document.createElement('div'); statSec.className = 'jk-sec'; statSec.textContent = 'STATISTIQUES DU CYCLE'; body.appendChild(statSec);
    const g2 = document.createElement('div'); g2.className = 'jk-grid2';
    g2.innerHTML = '<div class="jk-metric"><div class="jk-metric-val">' + (cycle.uniqueDonors || 0) + '</div><div class="jk-metric-lbl">personnes actives</div></div>' +
      '<div class="jk-metric"><div class="jk-metric-val">' + ((cycle.myGifts || []).length) + '</div><div class="jk-metric-lbl">mes dons envoyés</div></div>';
    body.appendChild(g2);

    const giftSec = document.createElement('div'); giftSec.className = 'jk-sec'; giftSec.textContent = 'MES DONS ENVOYÉS CE CYCLE'; body.appendChild(giftSec);
    const giftsCard = document.createElement('div'); giftsCard.className = 'jk-card'; giftsCard.style.padding = '12px 16px'; body.appendChild(giftsCard);
    renderGiftsList(giftsCard, cycle);
  }

  function renderGiftsList(container, cycle) {
    container.innerHTML = '';
    const gifts = cycle.myGifts || [];
    if (!gifts.length) {
      container.innerHTML = '<div style="text-align:center;padding:16px;font-size:13px;color:rgba(255,255,255,.3)">Aucun don envoyé</div>'; return;
    }
    gifts.forEach(function(g, i) {
      const row = document.createElement('div'); row.className = 'jk-hist-row'; if (i === 0) row.style.paddingTop = '0';
      row.innerHTML = '<div><div style="font-size:13px;font-weight:500">Don à ' + esc(g.to) + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,.3)">' + esc(g.date) + ' · +' + num(g.tickets) + ' tickets · ×' + g.mult.toFixed(2) + ' · ' + esc(g.cur) + '</div></div>' +
        '<span class="jk-badge jk-br">−' + eur(g.amount) + '</span>';
      container.appendChild(row);
    });
  }

  /* ─── TAB : PAIEMENTS ─────────────────────────────────── */
  function tabPayments(body, root) {
    body.classList.add('jk-in');
    const user  = loadUser();
    const cycle = loadCycle() || defaultCycle();
    if (!user) { body.appendChild(mkNotice('Crée un compte dans Config pour accéder aux paiements.', 'info')); return; }

    body.appendChild(mkNotice('Les paiements carte sont séparés des dons et n\'affectent pas tes tickets.', 'info'));

    const total = _payments.reduce(function(a, p) { return a + p.amount; }, 0);
    const g2 = document.createElement('div'); g2.className = 'jk-grid2';
    g2.innerHTML = '<div class="jk-metric"><div class="jk-metric-val" id="jk-pay-bal">…</div><div class="jk-metric-lbl">solde disponible</div></div>' +
      '<div class="jk-metric"><div class="jk-metric-val">' + eur(total) + '</div><div class="jk-metric-lbl">dépensé ce mois</div></div>';
    body.appendChild(g2);

    // Charger le vrai solde
    const userId = user.id || user.userId;
    if (userId) {
      striga('POST', '/wallets/get/all', { userId: userId, startDate: 0, endDate: Date.now(), page: 0 }).then(function(r) {
        const accounts = (r.wallets && r.wallets[0] && r.wallets[0].accounts) || {};
        const eurAcc   = accounts['EUR'];
        const bal      = eurAcc ? (parseInt(eurAcc.availableBalance || 0) / 100) : 0;
        const el = document.getElementById('jk-pay-bal');
        if (el) el.textContent = eur(bal);
      }).catch(function() {
        const el = document.getElementById('jk-pay-bal');
        if (el) el.textContent = eur(cycle.walletBalance || 0);
      });
    }

    const cardSec = document.createElement('div'); cardSec.className = 'jk-sec'; cardSec.textContent = 'CARTE VIRTUELLE'; body.appendChild(cardSec);
    const cardInfo = document.createElement('div'); cardInfo.className = 'jk-card'; cardInfo.style.padding = '12px 16px';
    cardInfo.innerHTML = '<div class="jk-row" style="padding-top:0"><span class="jk-rl">Numéro</span><span class="jk-mono" style="font-size:13px;color:rgba(255,255,255,.6)">•••• •••• •••• 4291</span></div>' +
      '<div class="jk-row"><span class="jk-rl">Expiration</span><span class="jk-mono jk-rv">09 / 28</span></div>' +
      '<div class="jk-row"><span class="jk-rl">CVV</span><span class="jk-mono" style="font-size:13px;color:rgba(255,255,255,.6)">•••</span></div>' +
      '<div class="jk-row"><span class="jk-rl">Statut</span><span class="jk-badge jk-bg">Active</span></div>';
    body.appendChild(cardInfo);

    const showBtn = document.createElement('button'); showBtn.className = 'jk-btn'; showBtn.textContent = 'Afficher les détails complets';
    showBtn.addEventListener('click', function() { showBtn.textContent = 'Débloqué via Face ID / PIN dans l\'app réelle'; showBtn.disabled = true; });
    body.appendChild(showBtn);

    const txSec = document.createElement('div'); txSec.className = 'jk-sec'; txSec.textContent = 'TRANSACTIONS RÉCENTES'; body.appendChild(txSec);
    const txCard = document.createElement('div'); txCard.className = 'jk-card'; txCard.style.padding = '12px 16px'; txCard.id = 'jk-tx-list'; body.appendChild(txCard);
    renderTxList(txCard);
  }

  function renderTxList(container) {
    if (!container) return; container.innerHTML = '';
    _payments.forEach(function(p, i) {
      const row = document.createElement('div'); row.className = 'jk-hist-row'; if (i === 0) row.style.paddingTop = '0';
      row.innerHTML = '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="jk-pay-icon">' + esc(p.merchant[0]) + '</div>' +
        '<div><div style="font-size:13px;font-weight:500">' + esc(p.merchant) + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,.3)">' + esc(p.date) + ' · ' + esc(p.cat) + '</div></div></div>' +
        '<span style="font-size:14px;font-weight:500;color:#fff">−' + eur(p.amount) + '</span>';
      container.appendChild(row);
    });
  }

  /* ─── TAB : CONFIG ────────────────────────────────────── */
  function tabConfig(body, root) {
    body.classList.add('jk-in');
    const user = loadUser();
    const fb   = document.createElement('div');

    const accSec = document.createElement('div'); accSec.className = 'jk-sec'; accSec.textContent = 'MON COMPTE'; body.appendChild(accSec);

    if (user) {
      const uuid = user.id || user.userId || ('usr_' + (user.email || '').slice(0, 8));
      const profCard = document.createElement('div'); profCard.className = 'jk-card'; profCard.style.padding = '14px 16px';
      const avt = document.createElement('div'); avt.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px';
      avt.innerHTML = '<div class="jk-avatar" style="width:44px;height:44px;font-size:16px">' + esc((user.firstName || '?')[0]) + esc((user.lastName || '?')[0]) + '</div>' +
        '<div style="flex:1"><div style="font-size:15px;font-weight:500">' + esc(user.firstName || '') + ' ' + esc(user.lastName || '') + '</div>' +
        '<div style="font-size:12px;color:rgba(255,255,255,.35)">' + esc(user.email || '') + '</div></div>' +
        '<span class="jk-badge ' + (user.kycStatus === 'APPROVED' ? 'jk-bg' : 'jk-ba') + '">' + (user.kycStatus === 'APPROVED' ? 'Vérifié' : 'En attente') + '</span>';
      profCard.appendChild(avt);
      const uuidLabel = document.createElement('div'); uuidLabel.style.cssText = 'font-size:11px;color:rgba(255,255,255,.3);margin-bottom:5px'; uuidLabel.textContent = 'Mon UUID';
      const uuidBox = document.createElement('div'); uuidBox.className = 'jk-uuid';
      const uuidVal = document.createElement('span'); uuidVal.className = 'jk-uuid-val'; uuidVal.textContent = uuid;
      const copyBtn = document.createElement('button'); copyBtn.className = 'jk-copy'; copyBtn.textContent = 'Copier';
      copyBtn.addEventListener('click', function() { copyText(uuid, copyBtn); });
      uuidBox.appendChild(uuidVal); uuidBox.appendChild(copyBtn);
      profCard.appendChild(uuidLabel); profCard.appendChild(uuidBox);
      body.appendChild(profCard);
    }

    const kycSec = document.createElement('div'); kycSec.className = 'jk-sec'; kycSec.textContent = 'KYC — VÉRIFICATION D\'IDENTITÉ'; body.appendChild(kycSec);

    if (!user) {
      body.appendChild(mkNotice('Crée ton compte pour accéder au wallet et à la carte Mastercard virtuelle.', 'info'));
      const form = document.createElement('div'); form.className = 'jk-card';
      [['jk-fn','Prénom','Jean'],['jk-ln','Nom','Dupont'],['jk-dob','Date de naissance (AAAA-MM-JJ)','1990-01-15'],['jk-nat','Nationalité (FR, DE…)','FR'],['jk-email','Email','jean@example.com'],['jk-cc','Indicatif pays (+33, +1…)','+33'],['jk-tel','Numéro (sans indicatif)','612345678'],['jk-addr','Adresse','12 rue de la Paix'],['jk-city','Ville','Paris'],['jk-postal','Code postal','75001'],['jk-country','Pays','FR']].forEach(function(arr) {
        const id = arr[0], label = arr[1], ph = arr[2];
        const lbl = document.createElement('label'); lbl.className = 'jk-label'; lbl.textContent = label; form.appendChild(lbl);
        const inp = document.createElement('input'); inp.className = 'jk-inp'; inp.id = id; inp.placeholder = ph;
        if (id === 'jk-email') inp.type = 'email';
        if (id === 'jk-tel')   inp.type = 'tel';
        form.appendChild(inp);
      });
      const createBtn = document.createElement('button'); createBtn.className = 'jk-cta'; createBtn.textContent = 'Créer mon compte'; form.appendChild(createBtn);
      form.appendChild(fb); body.appendChild(form);

      createBtn.addEventListener('click', async function() {
        createBtn.disabled = true; createBtn.innerHTML = ''; createBtn.appendChild(mkSpin()); createBtn.append(' Création en cours…');
        const dob = v('jk-dob').split('-');
        const payload = {
          firstName:   v('jk-fn').trim(),
          lastName:    v('jk-ln').trim(),
          dateOfBirth: {
            year:  parseInt(dob[0], 10) || 1990,
            month: parseInt(dob[1], 10) || 1,
            day:   parseInt(dob[2], 10) || 1,
          },
          email:       v('jk-email').trim().toLowerCase(),
          mobile: { countryCode: v('jk-cc').trim().startsWith('+') ? v('jk-cc').trim() : '+' + v('jk-cc').trim(), number: v('jk-tel').replace(/[\s\-\(\)]/g, '') },
          nationality: v('jk-nat').toUpperCase().slice(0, 2),
          address: {
            addressLine1: v('jk-addr').trim(),
            city:         v('jk-city').trim(),
            postalCode:   v('jk-postal').trim(),
            country:      v('jk-country').toUpperCase().slice(0, 2),
          },
        };
        try {
          const r = await striga('POST', '/user/create', payload);
          saveUser(Object.assign({}, r, { kycStatus: 'NOT_STARTED' }));
          window.YM_toast && window.YM_toast('Compte créé avec succès !', 'success');
          renderPanel(root);
        } catch (e) {
          fb.innerHTML = ''; fb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
          createBtn.disabled = false; createBtn.textContent = 'Créer mon compte';
        }
      });
    } else {
      const kycCard = document.createElement('div'); kycCard.className = 'jk-card'; kycCard.style.padding = '12px 16px';
      [
        { label: 'Compte créé',            sub: 'Nom, email, date de naissance',          done: true },
        { label: 'Identité vérifiée',       sub: 'Pièce d\'identité + selfie via Striga', done: user.kycStatus === 'APPROVED' },
        { label: 'Wallet et carte activés', sub: 'IBAN + Mastercard virtuelle',            done: user.kycStatus === 'APPROVED' },
      ].forEach(function(s) {
        const step = document.createElement('div'); step.className = 'jk-kyc-step';
        const dot  = document.createElement('div'); dot.className = 'jk-kyc-dot ' + (s.done ? 'jk-dot-done' : 'jk-dot-pend'); dot.textContent = s.done ? '✓' : '…';
        const txt  = document.createElement('div');
        txt.innerHTML = '<div style="font-size:13px;font-weight:500">' + esc(s.label) + '</div><div style="font-size:11px;color:rgba(255,255,255,.3)">' + esc(s.sub) + '</div>';
        step.appendChild(dot); step.appendChild(txt); kycCard.appendChild(step);
      });
      body.appendChild(kycCard); body.appendChild(fb);

      if (user.kycStatus !== 'APPROVED') {
        const kycBtn = document.createElement('button'); kycBtn.className = 'jk-cta'; kycBtn.textContent = 'Lancer la vérification d\'identité';
        kycBtn.addEventListener('click', async function() {
          kycBtn.disabled = true; kycBtn.innerHTML = ''; kycBtn.appendChild(mkSpin()); kycBtn.append(' Chargement…');
          try {
            const r = await striga('POST', '/user/kyc/start', { userId: user.id || user.userId });
            if (r.verificationLink) window.open(r.verificationLink, '_blank');
            fb.appendChild(mkNotice('Lien ouvert. Reviens ici une fois la vérification terminée.', 'info'));
            kycBtn.disabled = false; kycBtn.textContent = 'Lancer la vérification d\'identité';
          } catch (e) {
            fb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
            kycBtn.disabled = false; kycBtn.textContent = 'Lancer la vérification d\'identité';
          }
        });
        body.appendChild(kycBtn);

        const refreshBtn = document.createElement('button'); refreshBtn.className = 'jk-btn'; refreshBtn.textContent = '↻  Actualiser mon statut KYC';
        refreshBtn.addEventListener('click', async function() {
          refreshBtn.disabled = true; refreshBtn.innerHTML = ''; refreshBtn.appendChild(mkSpin()); refreshBtn.append(' Vérification…');
          try {
            const r = await striga('GET', '/user/' + (user.id || user.userId), {});
            saveUser(Object.assign({}, user, r));
            window.YM_toast && window.YM_toast(r.kycStatus === 'APPROVED' ? 'KYC approuvé ! 🎉' : 'Statut : ' + r.kycStatus, 'info');
            renderPanel(root);
          } catch (e) {
            fb.appendChild(mkNotice('Erreur : ' + e.message, 'err'));
            refreshBtn.disabled = false; refreshBtn.textContent = '↻  Actualiser mon statut KYC';
          }
        });
        body.appendChild(refreshBtn);
      }

      const delBtn = document.createElement('button'); delBtn.className = 'jk-btn red'; delBtn.textContent = 'Supprimer mon compte local';
      delBtn.addEventListener('click', function() {
        if (confirm('Supprimer les données locales ?')) { saveUser(null); saveCycle(null); window.YM_toast && window.YM_toast('Supprimé', 'info'); renderPanel(root); }
      });
      body.appendChild(delBtn);
    }

    const faqSec = document.createElement('div'); faqSec.className = 'jk-sec'; faqSec.textContent = 'COMMENT ÇA MARCHE'; body.appendChild(faqSec);
    const faqCard = document.createElement('div'); faqCard.className = 'jk-card'; faqCard.style.padding = '12px 16px'; body.appendChild(faqCard);
    [
      ['Qui détient la caisse ?', 'Personne. Chaque euro reste dans le wallet Striga de son propriétaire. Le Worker Cloudflare calcule le gagnant et déclenche les virements directement entre wallets, sans compte central.'],
      ['50% / 50% — comment ça marche ?', 'Le gagnant reçoit 50% du jackpot total. Les 50% restants sont reportés au cycle suivant comme mise de départ.'],
      ['Quitter le jeu — ce qui se passe', 'Tes tickets sont annulés immédiatement. Tes fonds restent bloqués jusqu\'à la fin de la distribution du jackpot. Ensuite tu peux les récupérer librement.'],
      ['Multi-devises ?', 'Chaque don est converti en EUR au taux live. 1 ticket = 1 EUR converti. Le virement au gagnant se fait dans sa devise locale via Striga FX.'],
      ['Bonus diversité ?', '1 destinataire : ×1.00 · 2 : ×1.25 · 3–4 : ×1.50 · 5+ : ×2.00.'],
      ['Comment le gagnant est désigné ?', 'Un hash est calculé à partir de toutes les transactions du cycle. On applique un modulo sur le total des tickets. Déterministe, vérifiable, non manipulable.'],
    ].forEach(function(pair, i) {
      const q = pair[0], a = pair[1];
      const item = document.createElement('div'); item.className = 'jk-faq-item';
      const qEl  = document.createElement('div'); qEl.className = 'jk-faq-q';
      qEl.innerHTML = '<span>' + esc(q) + '</span><span style="color:rgba(255,255,255,.3);font-weight:400">' + (_faqOpen[i] ? '−' : '+') + '</span>';
      const aEl  = document.createElement('div'); aEl.className = 'jk-faq-a'; aEl.style.display = _faqOpen[i] ? 'block' : 'none'; aEl.textContent = a;
      item.appendChild(qEl); item.appendChild(aEl);
      item.addEventListener('click', function() {
        _faqOpen[i] = !_faqOpen[i];
        aEl.style.display = _faqOpen[i] ? 'block' : 'none';
        qEl.querySelector('span:last-child').textContent = _faqOpen[i] ? '−' : '+';
      });
      faqCard.appendChild(item);
    });
  }

  /* ─── REGISTRATION ────────────────────────────────────── */
  window.YM_S['Tanobox.sphere.js'] = {
    name:        'Tanobox',
    icon:        '🎰',
    category:    'Finance',
    description: 'Caisse commune · dons multi-devises · 50/50 · tirage automatique · carte Mastercard virtuelle',
    emit: [], receive: [],
    activate:    function () { injectCSS(); },
    deactivate:  function () {},
    renderPanel: renderPanel,
    profileSection: function (container) {
      const user  = loadUser(); if (!user) return;
      const cycle = loadCycle() || defaultCycle();
      injectCSS();
      const pct  = cycle.myTickets / Math.max(cycle.totalTickets, 1);
      const jack = (cycle.jackpotEur || 0) + (cycle.carryEur || 0);
      const el   = document.createElement('div');
      el.style.fontFamily = "'DM Sans',system-ui,sans-serif";
      el.innerHTML = '<div style="display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#0f0527,#1a0845);border-radius:16px;padding:14px 16px">' +
        '<div style="width:44px;height:44px;border-radius:14px;background:rgba(124,58,237,.2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎰</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:500;color:#fff">' + esc(user.firstName || '') + ' ' + esc(user.lastName || '') + '</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.38);margin-top:2px">' + num(cycle.myTickets) + ' tickets · ' + (pct * 100).toFixed(3) + '% de chance</div>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:500;color:#a78bfa;flex-shrink:0">' + eur(jack) + '</div>' +
      '</div>';
      container.appendChild(el);
    },
  };
})();
