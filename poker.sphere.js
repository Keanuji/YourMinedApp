/* jshint esversion:11, browser:true */
// poker.sphere.js — YourMine Poker — Texas Hold'em P2P fullscreen
(function(){
'use strict';
window.YM_S = window.YM_S || {};

const SCORES_KEY='ym_poker_scores_v1';
const INVITES_KEY='ym_poker_invites';
let _ctx=null,_myUUID=null,_myName=null;
let _tables={};
let _activeTable=null;
let _fullscreenEl=null;

// ── UTILS ─────────────────────────────────────────────────────────────────────
function gid(){return 'pk'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function loadScores(){try{return JSON.parse(localStorage.getItem(SCORES_KEY)||'[]');}catch(e){return[];}}
function addScore(e){const s=loadScores();s.unshift(e);localStorage.setItem(SCORES_KEY,JSON.stringify(s.slice(0,50)));}
function loadInvites(){try{return JSON.parse(localStorage.getItem(INVITES_KEY)||'[]');}catch(e){return[];}}
function saveInvites(d){localStorage.setItem(INVITES_KEY,JSON.stringify(d));}
function getContacts(){try{return JSON.parse(localStorage.getItem('ym_contacts_v1')||'[]');}catch(e){return[];}}

// ── P2P ────────────────────────────────────────────────────────────────────────
function bc(type,data){try{window.YM_P2P?.broadcast({sphere:'poker.sphere.js',type,data});}catch(e){}}
function st(peerId,type,data){try{window.YM_P2P?.sendTo(peerId,{sphere:'poker.sphere.js',type,data});}catch(e){}}
// Résolution peerId — cherche dans tous les peers connus
function peerOf(uuid){
  const near=window.YM_Social?._nearUsers;
  if(near&&near.has(uuid))return near.get(uuid).peerId||null;
  // Fallback : cherche dans YM_P2P directement
  const peers=window.YM_P2P?.peers;
  if(peers){
    for(const[pid,info]of peers){
      if(info&&info.uuid===uuid)return pid;
    }
  }
  return null;
}

// ── DECK ───────────────────────────────────────────────────────────────────────
const SUITS=['♠','♥','♦','♣'];
const RANKS=['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_VAL={2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:11,Q:12,K:13,A:14};
function newDeck(){const d=[];SUITS.forEach(s=>RANKS.forEach(r=>d.push(r+s)));return d;}
function shuffle(d){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}return d;}

// ── HAND EVALUATOR ─────────────────────────────────────────────────────────────
function evalHand(cards){
  const c7=cards.filter(Boolean);
  if(c7.length<5)return{score:0,name:'—'};
  let best={score:-1,name:'—'};
  combo(c7,5).forEach(h=>{const s=eval5(h);if(s.score>best.score)best=s;});
  return best;
}
function combo(arr,k){if(k===0)return[[]];if(!arr.length)return[];const[h,...t]=arr;return[...combo(t,k-1).map(c=>[h,...c]),...combo(t,k)];}
function eval5(h){
  const ranks=h.map(c=>RANK_VAL[c[0]]).sort((a,b)=>b-a);
  const suits=h.map(c=>c[1]);
  const flush=suits.every(s=>s===suits[0]);
  const uniq=[...new Set(ranks)];
  const straight=uniq.length===5&&(uniq[0]-uniq[4]===4||(uniq[0]===14&&JSON.stringify(uniq.slice(1))==='[5,4,3,2]'));
  const cnt={};ranks.forEach(r=>{cnt[r]=(cnt[r]||0)+1;});
  const counts=Object.values(cnt).sort((a,b)=>b-a);
  const top=ranks[0];
  if(flush&&straight)return{score:8e7+top,name:'Straight Flush'};
  if(counts[0]===4)return{score:7e7+top,name:'Four of a Kind'};
  if(counts[0]===3&&counts[1]===2)return{score:6e7+top,name:'Full House'};
  if(flush)return{score:5e7+top,name:'Flush'};
  if(straight)return{score:4e7+top,name:'Straight'};
  if(counts[0]===3)return{score:3e7+top,name:'Three of a Kind'};
  if(counts[0]===2&&counts[1]===2)return{score:2e7+top,name:'Two Pair'};
  if(counts[0]===2)return{score:1e7+top,name:'One Pair'};
  return{score:top,name:'High Card'};
}

// ── TABLE STATE ─────────────────────────────────────────────────────────────────
function mkTable(opts){
  return{
    id:gid(),host:_myUUID,name:opts.name||'Table',
    players:[{uuid:_myUUID,name:_myName,chips:opts.chips||1000,bet:0,folded:false,allIn:false,hand:[],ready:true}],
    maxPlayers:opts.max||6,state:'waiting',
    deck:[],board:[],pot:0,roundBets:{},acted:{},
    cur:0,dealer:0,bb:opts.bb||20,sb:opts.sb||10,
    ts:Date.now()
  };
}

function tablePub(t){
  return{id:t.id,host:t.host,name:t.name,max:t.maxPlayers,state:t.state,
    bb:t.bb,sb:t.sb,ts:t.ts,players:t.players.map(p=>({uuid:p.uuid,name:p.name,chips:p.chips}))};
}

// ── VUE FILTRÉE (masque les mains adverses, y compris pour le host lui-même) ──
function _myView(t){
  if(!t) return t;
  if(t.revealed) return t; // showdown : tout le monde voit toutes les mains
  return {...t, players:(t.players||[]).map(p=>
    p.uuid===_myUUID ? p : {...p, hand:(p.hand||[]).map(()=>null)}
  )};
}

// ── GAME LOGIC (HOST ONLY) ─────────────────────────────────────────────────────
function startGame(tableId){
  const t=_tables[tableId];
  if(!t||t.host!==_myUUID)return;
  if(t.players.length<2){window.YM_toast?.('Need at least 2 players','warn');return;}

  t.state='preflop';
  t.deck=shuffle(newDeck());
  t.board=[];t.pot=0;t.roundBets={};t.acted={};
  t.players.forEach(p=>{p.folded=false;p.allIn=false;p.bet=0;p.hand=[t.deck.pop(),t.deck.pop()];});
  t.dealer=(t.dealer+1)%t.players.length;

  // Blinds
  const n=t.players.length;
  const sbIdx=(t.dealer+1)%n;
  const bbIdx=(t.dealer+2)%n;
  _doBlind(t,t.players[sbIdx],t.sb);
  _doBlind(t,t.players[bbIdx],t.bb);

  // Premier à parler = UTG (dealer+3)
  t.cur=(t.dealer+3)%n;
  t.cur=_nextActive(t,t.cur);
  pushState(t);
}

function _doBlind(t,p,amt){
  const a=Math.min(amt,p.chips);
  p.chips-=a;p.bet+=a;t.pot+=a;
  t.roundBets[p.uuid]=(t.roundBets[p.uuid]||0)+a;
  if(p.chips===0)p.allIn=true;
}

function _nextActive(t,from){
  const n=t.players.length;
  let idx=from%n;
  for(let i=0;i<n;i++){
    const p=t.players[idx];
    if(!p.folded&&!p.allIn)return idx;
    idx=(idx+1)%n;
  }
  return from%n; // tous all-in
}

function doAction(tableId,uuid,action,amount){
  const t=_tables[tableId];
  if(!t||t.host!==_myUUID)return;
  if(t.players[t.cur]?.uuid!==uuid){return;}
  t.acted=t.acted||{};

  const p=t.players[t.cur];
  const maxBetBefore=Math.max(0,...Object.values(t.roundBets).map(Number));
  const toCall=maxBetBefore-(t.roundBets[uuid]||0);
  let reopens=false;

  if(action==='fold'){
    p.folded=true;
  }else if(action==='check'){
    // ok
  }else if(action==='call'){
    const a=Math.min(toCall,p.chips);
    p.chips-=a;p.bet+=a;t.pot+=a;
    t.roundBets[uuid]=(t.roundBets[uuid]||0)+a;
    if(p.chips===0)p.allIn=true;
  }else if(action==='raise'||action==='bet'){
    const total=Math.min(Math.max(toCall+(amount||t.bb),t.bb),p.chips);
    p.chips-=total;p.bet+=total;t.pot+=total;
    t.roundBets[uuid]=(t.roundBets[uuid]||0)+total;
    if(p.chips===0)p.allIn=true;
    reopens=true; // une relance rouvre le tour de parole pour tout le monde
  }else if(action==='allin'){
    const a=p.chips;
    p.chips=0;p.bet+=a;t.pot+=a;
    t.roundBets[uuid]=(t.roundBets[uuid]||0)+a;
    p.allIn=true;
    const maxBetAfter=Math.max(0,...Object.values(t.roundBets).map(Number));
    if(maxBetAfter>maxBetBefore) reopens=true;
  }

  if(reopens) t.acted={};
  t.acted[uuid]=true;

  advanceGame(t);
}

function advanceGame(t){
  const active=t.players.filter(p=>!p.folded);

  // Un seul joueur restant → il gagne
  if(active.length===1){endRound(t,active);return;}

  const maxBet=Math.max(0,...Object.values(t.roundBets).map(Number));
  const canAct=t.players.filter(p=>!p.folded&&!p.allIn);

  // Plus personne ne peut agir (tous all-in ou foldés) → on abat le board automatiquement
  if(canAct.length===0){ _runOutBoard(t); return; }

  // Tout le monde doit avoir explicitement agi ET être à égalité de mise
  const allCalled = canAct.every(p => t.acted[p.uuid] && (t.roundBets[p.uuid]||0)>=maxBet);

  if(allCalled){
    // Passe à la street suivante
    if(t.state==='preflop'){t.state='flop';t.board.push(t.deck.pop(),t.deck.pop(),t.deck.pop());}
    else if(t.state==='flop'){t.state='turn';t.board.push(t.deck.pop());}
    else if(t.state==='turn'){t.state='river';t.board.push(t.deck.pop());}
    else{endRound(t,showdown(t));return;}
    t.roundBets={};t.acted={};
    t.cur=_nextActive(t,(t.dealer+1)%t.players.length);
  }else{
    t.cur=_nextActive(t,(t.cur+1)%t.players.length);
  }
  pushState(t);
}

// Quand plus personne ne peut miser (tous all-in) : révèle les streets restantes automatiquement
function _runOutBoard(t){
  const deal=()=>{
    if(t.state==='preflop'){t.state='flop';t.board.push(t.deck.pop(),t.deck.pop(),t.deck.pop());}
    else if(t.state==='flop'){t.state='turn';t.board.push(t.deck.pop());}
    else if(t.state==='turn'){t.state='river';t.board.push(t.deck.pop());}
    else{endRound(t,showdown(t));return;}
    pushState(t);
    setTimeout(deal,900);
  };
  deal();
}

function showdown(t){
  const active=t.players.filter(p=>!p.folded);
  let best=-1,winners=[];
  active.forEach(p=>{
    const s=evalHand([...p.hand,...t.board]).score;
    if(s>best){best=s;winners=[p];}else if(s===best)winners.push(p);
  });
  return winners;
}

function endRound(t,winners){
  t.state='showdown';
  const share=Math.floor(t.pot/winners.length);
  winners.forEach(w=>{w.chips+=share;});
  winners[0].chips+=t.pot-share*winners.length; // reste
  addScore({table:t.name,winners:winners.map(w=>w.name),pot:t.pot,ts:Date.now()});
  t.pot=0;
  // Révèle toutes les mains pour le showdown
  pushStateRevealed(t);
  // Nettoie les joueurs sans chips
  t.players=t.players.filter(p=>p.chips>0);
  if(t.players.length<2){
    setTimeout(()=>{t.state='finished';pushState(t);},3000);
  }else{
    setTimeout(()=>{
      t.state='waiting';t.board=[];t.roundBets={};t.acted={};
      t.players.forEach(p=>{p.bet=0;p.hand=[];p.folded=false;p.allIn=false;});
      pushState(t);
    },4000);
  }
}

// Push avec toutes les mains révélées (showdown)
function pushStateRevealed(t){
  const view={...t,deck:[],revealed:true};
  t.players.forEach(p=>{
    if(p.uuid===_myUUID){_tables[t.id]={...t,revealed:true};renderGame();}
    else{const pid=peerOf(p.uuid);if(pid)st(pid,'pk:state',{...view});}
  });
}

// Push normal — cache les mains des adversaires. Le host garde son état complet
// (nécessaire pour continuer les calculs de deck/mains) et l'affiche via _myView().
function pushState(t){
  t.players.forEach(p=>{
    if(p.uuid===_myUUID){
      _tables[t.id]=t; // état complet et réel — jamais masqué en mémoire
      renderGame();     // masqué uniquement à l'affichage, via _myView()
      return;
    }
    const view={
      ...t,
      deck:[], // ne jamais envoyer le deck
      revealed:false,
      players:t.players.map(pl=>({
        uuid:pl.uuid,name:pl.name,chips:pl.chips,bet:pl.bet,
        folded:pl.folded,allIn:pl.allIn,
        hand:pl.uuid===p.uuid?pl.hand:pl.hand.map(()=>null)
      }))
    };
    const pid=peerOf(p.uuid);if(pid)st(pid,'pk:state',view);
  });
}

function renderGame(){
  if(_activeTable&&_fullscreenEl)renderFullscreen(_fullscreenEl,_myView(_tables[_activeTable]));
}

// ── RECEIVE ────────────────────────────────────────────────────────────────────
let _refreshTables=null;
function onReceive(type,data,peerId){
  if(type==='pk:announce'){
    if(!_tables[data.id]||_tables[data.id]._remote){_tables[data.id]={...data,_remote:true};}
    _refreshTables&&_refreshTables();
  }
  else if(type==='pk:join-req'){
    const t=_tables[data.tableId];
    if(!t||t.host!==_myUUID){st(peerId,'pk:join-res',{ok:false,reason:'Table not found'});return;}
    if(t.state!=='waiting'){st(peerId,'pk:join-res',{ok:false,reason:'Game in progress'});return;}
    if(t.players.length>=t.maxPlayers){st(peerId,'pk:join-res',{ok:false,reason:'Table full'});return;}
    if(t.players.find(p=>p.uuid===data.uuid)){st(peerId,'pk:join-res',{ok:true,table:tablePub(t)});return;}
    t.players.push({uuid:data.uuid,name:data.name,chips:t.bb*50,bet:0,folded:false,allIn:false,hand:[]});
    st(peerId,'pk:join-res',{ok:true,table:t,fullState:true});
    bc('pk:announce',tablePub(t));
    // Envoie l'état complet à tous
    pushState(t);
  }
  else if(type==='pk:join-res'){
    if(!data.ok){window.YM_toast?.(data.reason||'Join failed','error');return;}
    const tableData=data.fullState?data.table:data.table;
    _tables[tableData.id]={...tableData,_remote:true};
    _activeTable=tableData.id;
    if(_fullscreenEl)renderFullscreen(_fullscreenEl,_myView(_tables[tableData.id]));
    else openFullscreen(tableData.id);
    _refreshTables&&_refreshTables();
  }
  else if(type==='pk:state'){
    _tables[data.id]={...data,_remote:true};
    if(_activeTable===data.id&&_fullscreenEl)renderFullscreen(_fullscreenEl,_myView(_tables[data.id]));
    _refreshTables&&_refreshTables();
  }
  else if(type==='pk:action'){
    doAction(data.tableId,data.uuid,data.action,data.amount||0);
  }
  else if(type==='pk:invite'){
    const invites=loadInvites();
    // Évite les doublons
    if(!invites.find(i=>i.tableId===data.tableId)){
      invites.unshift({...data,ts:Date.now()});
      saveInvites(invites.slice(0,10));
      window.YM_toast?.('♠ '+data.hostName+' invites you to "'+data.tableName+'"','info');
      _ctx?.setNotification(invites.length);
      _refreshTables&&_refreshTables();
    }
  }
}

// ── FULLSCREEN ─────────────────────────────────────────────────────────────────
function openFullscreen(tableId){
  if(_fullscreenEl){_fullscreenEl.remove();_fullscreenEl=null;}
  const el=document.createElement('div');
  el.id='pk-fullscreen';
  el.style.cssText='position:fixed;inset:0;z-index:9990;background:#0a1628;display:flex;flex-direction:column;overflow:hidden';
  document.body.appendChild(el);
  _fullscreenEl=el;_activeTable=tableId;
  renderFullscreen(el,_myView(_tables[tableId]));
}

function closeFullscreen(){
  _fullscreenEl?.remove();_fullscreenEl=null;_activeTable=null;
}

function renderFullscreen(el,t){
  el.innerHTML='';
  if(!t){el.innerHTML='<div style="color:var(--text3);padding:24px;text-align:center">Game not found</div>';return;}

  const myP=t.players?.find(p=>p.uuid===_myUUID);
  const isHost=t.host===_myUUID;

  // Header
  const hdr=document.createElement('div');
  hdr.style.cssText='flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,.5);border-bottom:1px solid rgba(255,255,255,.08)';
  hdr.innerHTML=
    '<button id="pk-close" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:22px;cursor:pointer;padding:0 6px;line-height:1">✕</button>'+
    '<span style="font-family:var(--font-d);font-size:12px;color:var(--accent);letter-spacing:2px">'+esc(t.name.toUpperCase())+'</span>'+
    '<span style="font-size:10px;color:var(--text3);margin-left:auto">'+t.state.toUpperCase()+'</span>'+
    '<div style="width:8px;height:8px;border-radius:50%;background:'+(['preflop','flop','turn','river'].includes(t.state)?'#30e880':'var(--text3)')+'"></div>';
  el.appendChild(hdr);
  hdr.querySelector('#pk-close').addEventListener('click',closeFullscreen);

  // Board
  const boardEl=document.createElement('div');
  boardEl.style.cssText='flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:14px;border-bottom:1px solid rgba(255,255,255,.06)';
  const cardsRow=document.createElement('div');
  cardsRow.style.cssText='display:flex;justify-content:center;margin-bottom:10px;min-height:64px;align-items:center;gap:3px';
  for(let i=0;i<5;i++){
    const c=t.board&&t.board[i];
    cardsRow.appendChild(cardEl(c,!c));
  }
  boardEl.appendChild(cardsRow);
  boardEl.innerHTML+=
    '<div style="display:flex;gap:16px;font-size:12px">'+
    '<span style="color:var(--text3)">POT</span><span style="color:var(--accent);font-weight:700">'+(t.pot||0)+'</span>'+
    '<span style="color:var(--text3)">BB</span><span style="color:var(--text2)">'+t.bb+'</span>'+
    '</div>';
  el.appendChild(boardEl);

  // Sièges
  const seatsEl=document.createElement('div');
  seatsEl.style.cssText='flex:1;overflow-y:auto;padding:10px;display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start';
  (t.players||[]).forEach((p,i)=>{
    const isMe=p.uuid===_myUUID;
    const isCur=!['waiting','showdown','finished'].includes(t.state)&&t.players[t.cur]?.uuid===p.uuid;
    const borderColor=isCur?'var(--accent)':isMe?'rgba(34,211,238,.5)':'rgba(255,255,255,.1)';
    const seat=document.createElement('div');
    seat.style.cssText='flex:1;min-width:120px;max-width:180px;background:rgba(255,255,255,.04);border:1px solid '+borderColor+';border-radius:10px;padding:10px;text-align:center;opacity:'+(p.folded?.5:1);
    // Mains
    const handHtml=(p.hand||[]).map(c=>{
      if(!c)return '<div style="width:26px;height:38px;border-radius:4px;background:rgba(255,255,255,.08);display:inline-block;margin:1px"></div>';
      const red=c[1]==='♥'||c[1]==='♦';
      return '<div style="width:26px;height:38px;border-radius:4px;background:#f5f5f0;color:'+(red?'#c0392b':'#1a1a2e')+';display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;margin:1px;line-height:1;flex-direction:column">'+c[0]+'<br>'+c[1]+'</div>';
    }).join('');
    seat.innerHTML=
      '<div style="font-size:12px;font-weight:600;color:'+(isMe?'var(--cyan)':'var(--text)')+';margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.name)+(isMe?' ★':'')+(i===t.dealer?' 🎯':'')+'</div>'+
      '<div style="font-size:15px;font-weight:700;color:var(--accent);margin-bottom:4px">'+p.chips+'</div>'+
      (p.bet?'<div style="font-size:10px;color:var(--text3);margin-bottom:4px">bet '+p.bet+'</div>':'')+
      '<div style="display:flex;justify-content:center;flex-wrap:wrap;min-height:20px;margin-bottom:4px">'+handHtml+'</div>'+
      (p.folded?'<div style="font-size:10px;color:#e84040">FOLD</div>':'')+(p.allIn?'<div style="font-size:10px;color:var(--accent)">ALL IN</div>':'')+
      (isCur?'<div style="font-size:10px;color:var(--accent);animation:ym-pulse 1s infinite">● TURN</div>':'');
    seatsEl.appendChild(seat);
  });
  el.appendChild(seatsEl);

  // Actions
  const actEl=document.createElement('div');
  actEl.style.cssText='flex-shrink:0;padding:10px 12px;background:rgba(0,0,0,.5);border-top:1px solid rgba(255,255,255,.08);display:flex;flex-wrap:wrap;gap:6px;justify-content:center';

  const isMyTurn=myP&&!myP.folded&&!myP.allIn&&
    t.players[t.cur]?.uuid===_myUUID&&
    ['preflop','flop','turn','river'].includes(t.state);

  if(t.state==='waiting'){
    if(isHost&&t.players.length>=2){
      const btn=document.createElement('button');btn.className='ym-btn ym-btn-accent';
      btn.style.cssText='font-size:14px;padding:10px 32px;width:100%';
      btn.textContent='▶ Start ('+t.players.length+' players)';
      btn.addEventListener('click',()=>startGame(t.id));
      actEl.appendChild(btn);
    }else{
      actEl.innerHTML='<div style="color:var(--text3);font-size:12px;width:100%;text-align:center">Waiting for host to start… ('+t.players.length+'/'+t.maxPlayers+')</div>';
    }
    // Bouton invite
    if(isHost){
      const inv=document.createElement('button');inv.className='ym-btn ym-btn-ghost';
      inv.style.cssText='font-size:11px;width:100%;margin-top:4px';inv.textContent='✉ Invite contacts';
      inv.addEventListener('click',()=>{
        const contacts=getContacts();let sent=0;
        contacts.forEach(c=>{
          const pid=peerOf(c.uuid);
          if(pid){st(pid,'pk:invite',{tableId:t.id,hostUUID:_myUUID,hostName:_myName,tableName:t.name});sent++;}
        });
        window.YM_toast?.(sent?sent+' invite(s) sent':'No nearby contacts','info');
      });
      actEl.appendChild(inv);
    }
  }else if(t.state==='showdown'){
    const winners=t.players.filter(p=>!p.folded);
    let winnerNames='';
    if(t.revealed){
      const best=winners.map(p=>({p,s:evalHand([...(p.hand||[]),...(t.board||[])]).score})).sort((a,b)=>b.s-a.s);
      winnerNames=best[0]?.p.name||'—';
    }else{winnerNames=winners.map(p=>p.name).join(' & ');}
    actEl.innerHTML='<div style="color:var(--accent);font-size:14px;font-weight:700;width:100%;text-align:center">🏆 '+esc(winnerNames)+'</div>';
  }else if(t.state==='finished'){
    const btn=document.createElement('button');btn.className='ym-btn ym-btn-ghost';
    btn.style.cssText='width:100%';btn.textContent='Close';
    btn.addEventListener('click',closeFullscreen);actEl.appendChild(btn);
  }else if(isMyTurn){
    const maxBet=Math.max(0,...Object.values(t.roundBets||{}).map(Number));
    const myBet=t.roundBets?.[_myUUID]||0;
    const toCall=maxBet-myBet;

    function send(action,amount){
      if(isHost){doAction(t.id,_myUUID,action,amount);}
      else{const pid=peerOf(t.host);if(pid)st(pid,'pk:action',{tableId:t.id,uuid:_myUUID,action,amount:amount||0});}
    }

    const foldBtn=document.createElement('button');foldBtn.className='ym-btn ym-btn-ghost';
    foldBtn.style.cssText='flex:1;color:#e84040;border-color:rgba(232,64,64,.3)';foldBtn.textContent='Fold';
    foldBtn.addEventListener('click',()=>send('fold'));actEl.appendChild(foldBtn);

    if(toCall===0){
      const chk=document.createElement('button');chk.className='ym-btn ym-btn-ghost';chk.style.cssText='flex:1';chk.textContent='Check';
      chk.addEventListener('click',()=>send('check'));actEl.appendChild(chk);
    }else{
      const call=document.createElement('button');call.className='ym-btn ym-btn-ghost';call.style.cssText='flex:1';call.textContent='Call '+toCall;
      call.addEventListener('click',()=>send('call'));actEl.appendChild(call);
    }

    const raiseRow=document.createElement('div');raiseRow.style.cssText='display:flex;gap:6px;width:100%';
    raiseRow.innerHTML=
      '<input type="number" id="pk-raise" class="ym-input" style="flex:1;font-size:12px" min="'+(t.bb)+'" step="'+t.bb+'" value="'+(t.bb*2)+'">'+
      '<button class="ym-btn ym-btn-accent" id="pk-do-raise" style="flex:1">Raise</button>'+
      '<button class="ym-btn ym-btn-ghost" id="pk-allin">All In</button>';
    raiseRow.querySelector('#pk-do-raise').addEventListener('click',()=>send('raise',parseInt(raiseRow.querySelector('#pk-raise').value)||t.bb*2));
    raiseRow.querySelector('#pk-allin').addEventListener('click',()=>send('allin'));
    actEl.appendChild(raiseRow);
  }else if(['preflop','flop','turn','river'].includes(t.state)){
    const cur=t.players[t.cur];
    actEl.innerHTML='<div style="color:var(--text3);font-size:11px;width:100%;text-align:center">Waiting for '+esc(cur?.name||'…')+'</div>';
  }

  el.appendChild(actEl);
}

function cardEl(c,back){
  const el=document.createElement('div');
  el.style.cssText='width:38px;height:56px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:1px solid rgba(255,255,255,.2);box-shadow:0 2px 8px rgba(0,0,0,.5);flex-shrink:0';
  if(back||!c){el.style.background='#1a1a3e';el.style.color='var(--accent)';el.textContent='🂠';}
  else{
    const red=c[1]==='♥'||c[1]==='♦';
    el.style.background='#f5f5f0';el.style.color=red?'#c0392b':'#1a1a2e';
    el.innerHTML='<span style="font-size:10px;line-height:1;text-align:center">'+c[0]+'<br>'+c[1]+'</span>';
  }
  return el;
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── PANEL ──────────────────────────────────────────────────────────────────────
function renderPanel(container){
  container.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';
  container.innerHTML='';
  if(!document.getElementById('pk-css')){
    const s=document.createElement('style');s.id='pk-css';
    s.textContent='@keyframes ym-pulse{0%,100%{opacity:1}50%{opacity:.4}}';
    document.head.appendChild(s);
  }

  const TABS=[['tables','♠ Tables'],['scores','🏆 Scores']];
  let curTab='tables';
  const track=document.createElement('div');
  track.style.cssText='flex:1;overflow:hidden;min-height:0;display:flex;flex-direction:column';
  container.appendChild(track);
  const tabs=document.createElement('div');
  tabs.className='ym-tabs';tabs.style.cssText='border-top:1px solid rgba(232,160,32,.12);margin:0;flex-shrink:0';
  TABS.forEach(([id,label])=>{
    const t=document.createElement('div');t.className='ym-tab'+(id==='tables'?' active':'');
    t.dataset.tab=id;t.textContent=label;
    t.addEventListener('click',()=>{
      curTab=id;tabs.querySelectorAll('.ym-tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));
      track.innerHTML='';
      if(id==='tables')renderTablesTab(track);else renderScoresTab(track);
    });
    tabs.appendChild(t);
  });
  container.appendChild(tabs);
  renderTablesTab(track);
  bc('pk:scan',{});
}

function renderTablesTab(container){
  container.innerHTML='';
  const hdr=document.createElement('div');
  hdr.style.cssText='flex-shrink:0;display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)';
  hdr.innerHTML=
    '<button id="pk-new" class="ym-btn ym-btn-accent" style="flex:1;font-size:12px">+ New Table</button>'+
    '<button id="pk-scan" class="ym-btn ym-btn-ghost" style="padding:6px 10px;font-size:16px" title="Scan">↺</button>';
  container.appendChild(hdr);

  // Invitations reçues
  const invites=loadInvites();
  if(invites.length){
    const invEl=document.createElement('div');
    invEl.style.cssText='padding:8px 14px;background:rgba(232,160,32,.06);border-bottom:1px solid var(--border)';
    invEl.innerHTML='<div style="font-size:10px;color:var(--accent);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Invitations ('+invites.length+')</div>';
    invites.forEach((inv,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:4px 0';
      row.innerHTML=
        '<span style="font-size:12px;flex:1">♠ <b>'+esc(inv.hostName)+'</b> — '+esc(inv.tableName)+'</span>'+
        '<button data-acc="'+i+'" class="ym-btn ym-btn-accent" style="font-size:11px;padding:3px 10px">Join</button>'+
        '<button data-dec="'+i+'" class="ym-btn ym-btn-ghost" style="font-size:11px;padding:3px 8px">✕</button>';
      row.querySelector('[data-acc]').addEventListener('click',()=>{
        const pid=peerOf(inv.hostUUID);
        if(!pid){window.YM_toast?.('Host not reachable','error');return;}
        st(pid,'pk:join-req',{tableId:inv.tableId,uuid:_myUUID,name:_myName});
        const arr=loadInvites();arr.splice(i,1);saveInvites(arr);
        _ctx?.setNotification(arr.length||0);
        renderTablesTab(container);
      });
      row.querySelector('[data-dec]').addEventListener('click',()=>{
        const arr=loadInvites();arr.splice(i,1);saveInvites(arr);
        _ctx?.setNotification(arr.length||0);
        renderTablesTab(container);
      });
      invEl.appendChild(row);
    });
    container.appendChild(invEl);
  }

  const list=document.createElement('div');
  list.style.cssText='flex:1;overflow-y:auto;padding:8px 14px';
  container.appendChild(list);
  _refreshTables=()=>renderTablesList(list);
  renderTablesList(list);

  hdr.querySelector('#pk-new').addEventListener('click',()=>{
    const name=prompt('Table name:','Table '+(Object.keys(_tables).length+1));
    if(name===null)return;
    const t=mkTable({name:name.trim()||'Table'});
    _tables[t.id]=t;bc('pk:announce',tablePub(t));
    renderTablesList(list);
    openFullscreen(t.id);
  });
  hdr.querySelector('#pk-scan').addEventListener('click',()=>{bc('pk:scan',{});renderTablesList(list);});
}

function renderTablesList(list){
  list.innerHTML='';
  const tables=Object.values(_tables).filter(t=>t.state!=='finished');
  if(!tables.length){
    list.innerHTML='<div style="color:var(--text3);font-size:12px;padding:16px;text-align:center">No tables.<br>Create one or wait for nearby players.</div>';
    return;
  }
  tables.sort((a,b)=>b.ts-a.ts).forEach(t=>{
    const isHost=t.host===_myUUID;
    const joined=t.players?.some(p=>p.uuid===_myUUID);
    const card=document.createElement('div');card.className='ym-card';card.style.cssText='margin-bottom:8px';
    card.innerHTML=
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
        '<b style="font-size:14px">♠ '+esc(t.name)+'</b>'+
        '<span style="font-size:11px;background:rgba(232,160,32,.15);padding:2px 8px;border-radius:999px;color:var(--accent)">'+(t.players?.length||0)+'/'+t.maxPlayers+'</span>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+t.state.toUpperCase()+' · BB '+t.bb+'</div>'+
      '<div style="display:flex;gap:6px">'+
        (joined?'<button data-open="'+t.id+'" class="ym-btn ym-btn-accent" style="flex:1;font-size:12px">▶ Open</button>':'')+
        (!joined&&t.state==='waiting'?'<button data-join="'+t.id+'" class="ym-btn ym-btn-ghost" style="flex:1;font-size:12px">Join</button>':'')+
      '</div>';
    card.querySelector('[data-open]')?.addEventListener('click',e=>{e.stopPropagation();openFullscreen(e.target.dataset.open);});
    card.querySelector('[data-join]')?.addEventListener('click',e=>{
      e.stopPropagation();
      const tbl=_tables[e.target.dataset.join];if(!tbl)return;
      const pid=peerOf(tbl.host);
      if(!pid){window.YM_toast?.('Host not reachable','error');return;}
      st(pid,'pk:join-req',{tableId:tbl.id,uuid:_myUUID,name:_myName});
    });
    list.appendChild(card);
  });
}

function renderScoresTab(container){
  container.style.cssText='flex:1;overflow-y:auto;padding:14px';
  container.innerHTML='';
  const scores=loadScores();
  if(!scores.length){container.innerHTML='<div style="color:var(--text3);font-size:12px">No games played yet.</div>';return;}
  scores.forEach(s=>{
    const el=document.createElement('div');
    el.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px';
    el.innerHTML=
      '<span style="flex:1">'+esc(s.table)+'</span>'+
      '<span style="color:var(--accent)">🏆 '+esc((s.winners||[]).join(' & '))+'</span>'+
      '<span style="background:rgba(232,160,32,.15);padding:1px 7px;border-radius:999px;color:var(--accent);font-size:11px">'+s.pot+'</span>'+
      '<span style="color:var(--text3);font-size:10px">'+new Date(s.ts).toLocaleDateString()+'</span>';
    container.appendChild(el);
  });
}

// ── SPHERE ─────────────────────────────────────────────────────────────────────
window.YM_S['poker.sphere.js']={
  name:'Poker',icon:'♠',category:'Games',
  description:'Texas Hold\'em P2P — invite nearby contacts, play fullscreen',
  emit:[],receive:[],

  activate(ctx){
    _ctx=ctx;
    _myUUID=ctx.loadProfile?.()?.uuid||gid();
    _myName=ctx.loadProfile?.()?.name||'Player';
    ctx.onReceive(onReceive);
    const inv=loadInvites();
    if(inv.length)ctx.setNotification(inv.length);
  },
  deactivate(){closeFullscreen();_ctx=null;_refreshTables=null;},
  renderPanel,

  profileSection(container){
    const myTables=Object.values(_tables).filter(t=>t.host===_myUUID&&t.state==='waiting');
    const el=document.createElement('div');
    el.style.cssText='display:flex;align-items:center;gap:8px';
    el.innerHTML=
      '<span style="font-size:16px">♠</span>'+
      '<div style="flex:1;font-size:12px;color:var(--text2)">'+
        (myTables.length?'Open: '+esc(myTables[0].name):'No open table')+
      '</div>'+
      '<button id="ps-pk-open" class="ym-btn ym-btn-ghost" style="font-size:11px">Open</button>';
    el.querySelector('#ps-pk-open').addEventListener('click',()=>window.YM?.openSpherePanel?.('poker.sphere.js'));
    container.appendChild(el);
  },

  peerSection(container,ctx){
    const uuid=ctx.uuid;
    const myTables=Object.values(_tables).filter(t=>t.host===_myUUID&&t.state==='waiting');
    if(myTables.length){
      const btn=document.createElement('button');btn.className='ym-btn ym-btn-accent';
      btn.style.cssText='width:100%;font-size:12px';
      btn.textContent='♠ Invite to '+esc(myTables[0].name);
      btn.addEventListener('click',()=>window.YM_Poker?.inviteContact(uuid));
      container.appendChild(btn);
    }else{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px';
      row.innerHTML='<span style="font-size:12px;color:var(--text3);flex:1">No open table</span>'+
        '<button id="ps-pk-create" class="ym-btn ym-btn-ghost" style="font-size:11px">Create & Invite</button>';
      row.querySelector('#ps-pk-create').addEventListener('click',()=>{
        const t=mkTable({name:_myName+"'s Table"});
        _tables[t.id]=t;bc('pk:announce',tablePub(t));
        window.YM_Poker?.inviteContact(uuid);
        window.YM?.openSpherePanel?.('poker.sphere.js');
        setTimeout(()=>openFullscreen(t.id),300);
      });
      container.appendChild(row);
    }
  }
};

window.YM_Poker={
  inviteContact(uuid){
    const myTables=Object.values(_tables).filter(t=>t.host===_myUUID&&t.state==='waiting');
    if(!myTables.length){window.YM_toast?.('Create a table first','warn');return;}
    const pid=peerOf(uuid);
    if(!pid){window.YM_toast?.('Player not reachable — must be nearby','error');return;}
    st(pid,'pk:invite',{tableId:myTables[0].id,hostUUID:_myUUID,hostName:_myName,tableName:myTables[0].name});
    window.YM_toast?.('Invite sent!','success');
  }
};
})();
