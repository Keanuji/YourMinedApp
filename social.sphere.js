// social.sphere.js — YourMine Social Sphere
//
// FIXES:
//  - broadcastPresence: log explicite si YM_P2P absent + retry automatique
//    quand P2P devient disponible (via ym:p2p-ready event ou polling)
//  - handlePresence: logs détaillés pour chaque packet reçu
//  - startHeartbeat: log de chaque battement
//  - activate: log complet du cycle de vie
//  - _p2pReadyWatcher: attend que YM_P2P soit dispo avant le 1er heartbeat
(function(){
'use strict';
window.YM_S = window.YM_S || {};

const GOSSIP_TTL          = 15 * 60 * 1000;
const GOSSIP2_TTL         = 30 * 60 * 1000;
const NEAR_RADIUS         = 100;
const HEARTBEAT_INTERVAL  = 5000;
const NEAR_TIMEOUT        = 15000;
const SOCIAL_KEY          = 'ym_social_v1';
const CONTACTS_KEY        = 'ym_contacts_v1';
const GOSSIP_STORAGE_KEY  = 'ym_gossip_cache_v1';
const GOSSIP_MAX_ENTRIES  = 200;

// ── Logger interne ─────────────────────────────────────────────────────────
const _L  = (...a) => console.log ('[Social]', ...a);
const _W  = (...a) => console.warn('[Social]', ...a);
const _E  = (...a) => console.error('[Social]', ...a);

// ── STATE ──────────────────────────────────────────────────────────────────
let _ctx = null;
let _nearUsers   = new Map();
let _gossipCache = new Map();
let _watchId     = null;
let _myCoords    = null;
let _heartbeatTimer = null;
let _cleanTimer     = null;
let _refreshNear    = null;
// FIX: watcher qui attend que YM_P2P soit prêt
let _p2pReadyInterval = null;
// Compteur de broadcasts pour le log
let _broadcastCount = 0;
let _receiveCount   = 0;

// ── STORAGE ────────────────────────────────────────────────────────────────
function loadState(){try{return JSON.parse(localStorage.getItem(SOCIAL_KEY)||'{}');}catch{return{};}}
function saveState(d){localStorage.setItem(SOCIAL_KEY,JSON.stringify({...loadState(),...d}));}
function loadContacts(){try{return JSON.parse(localStorage.getItem(CONTACTS_KEY)||'[]');}catch{return[];}}
function saveContacts(c){localStorage.setItem(CONTACTS_KEY,JSON.stringify(c));}
function getContact(uuid){return loadContacts().find(c=>c.uuid===uuid);}
function addContact(profile){
  const contacts=loadContacts();
  if(!contacts.find(c=>c.uuid===profile.uuid)){
    contacts.push({uuid:profile.uuid,name:profile.name||'',nickname:'',addedAt:Date.now(),profile});
    saveContacts(contacts);
  }
}
function updateNickname(uuid,nickname){
  const contacts=loadContacts();
  const c=contacts.find(c=>c.uuid===uuid);
  if(c){c.nickname=nickname;saveContacts(contacts);}
}

// ── GOSSIP PERSISTENCE ─────────────────────────────────────────────────────
function _persistGossip(){
  const entries=[];
  _gossipCache.forEach((v,k)=>entries.push([k,v]));
  entries.sort((a,b)=>b[1].ts-a[1].ts);
  const trimmed=entries.slice(0,GOSSIP_MAX_ENTRIES);
  try{localStorage.setItem(GOSSIP_STORAGE_KEY,JSON.stringify(trimmed));}catch(e){}
}
function _loadGossipFromStorage(){
  try{
    const raw=JSON.parse(localStorage.getItem(GOSSIP_STORAGE_KEY)||'[]');
    const now=Date.now();
    let loaded=0;
    raw.forEach(([uuid,entry])=>{
      if(now-entry.ts<GOSSIP2_TTL){_gossipCache.set(uuid,entry);loaded++;}
    });
    _L(`gossip loaded from storage: ${loaded} entries`);
  }catch(e){_W('gossip load error:', e.message);}
}

// ── GEO ────────────────────────────────────────────────────────────────────
function startGeo(){
  if(!navigator.geolocation){_W('geolocation not available');return;}
  _watchId=navigator.geolocation.watchPosition(
    pos=>{
      _myCoords={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:pos.coords.accuracy};
      _L(`geo update: lat=${_myCoords.lat.toFixed(5)} lng=${_myCoords.lng.toFixed(5)} acc=${_myCoords.acc.toFixed(0)}m`);
    },
    err=>{_W('geo error:', err.code, err.message);},
    {enableHighAccuracy:true,maximumAge:5000,timeout:10000}
  );
  _L('geo watch started');
}
function stopGeo(){
  if(_watchId!==null){navigator.geolocation.clearWatch(_watchId);_watchId=null;_L('geo watch stopped');}
}
function haversine(lat1,lng1,lat2,lng2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── PROFILE PACKET ─────────────────────────────────────────────────────────
function buildProfilePacket(){
  const p=_ctx?.loadProfile?.()?? {};
  const state=loadState();
  const contactUUIDs=loadContacts().map(c=>c.uuid);

  const extraData={};
  if(window.YM_sphereRegistry){
    window.YM_sphereRegistry.forEach((sphere)=>{
      if(typeof sphere.broadcastData==='function'){
        try{const d=sphere.broadcastData();if(d)Object.assign(extraData,{[sphere._sphereId||'']:d});}catch(e){}
      }
    });
  }

  const gossipSnapshot=[];
  const now=Date.now();
  _gossipCache.forEach((entry,uuid)=>{
    if(entry.source==='direct'&&now-entry.ts<GOSSIP_TTL){
      gossipSnapshot.push({
        uuid,
        ts:entry.ts,
        name:entry.profile.name||'',
        spheres:entry.profile.spheres||[],
        broadcastData:entry.profile.broadcastData||null,
      });
    }
  });

  return {
    uuid:     p.uuid,
    name:     p.name,
    bio:      p.bio,
    avatar:   p.avatar,
    site:     p.site,
    spheres:  p.spheres||[],
    pubkey:   p.pubkey,
    lat:      _myCoords?.lat,
    lng:      _myCoords?.lng,
    networks: (state.networks||[]).map(n=>({id:n.id,handle:n.handle})),
    contacts: contactUUIDs,
    broadcastData: Object.keys(extraData).length?extraData:undefined,
    _gossip:  gossipSnapshot.slice(0,20),
    ts:       Date.now(),
  };
}

// ── HEARTBEAT ──────────────────────────────────────────────────────────────
function broadcastPresence(){
  if(!_ctx){
    _W('broadcastPresence — no ctx, skip');
    return;
  }
  // FIX: vérification explicite de YM_P2P avec log
  if(!window.YM_P2P){
    _W('broadcastPresence — YM_P2P not ready yet (P2P connecting…)');
    return;
  }
  const packet = buildProfilePacket();
  _broadcastCount++;
  _L(`broadcast #${_broadcastCount} | uuid=${packet.uuid?.slice(0,8)} | near=${_nearUsers.size} | gossip=${_gossipCache.size} | geo=${_myCoords?'✓':'✗'}`);
  _ctx.send('social:presence', packet);
}

function startHeartbeat(){
  stopHeartbeat();
  _L('heartbeat start — interval', HEARTBEAT_INTERVAL, 'ms');
  broadcastPresence(); // ping immédiat
  _heartbeatTimer=setInterval(()=>{
    broadcastPresence();
  }, HEARTBEAT_INTERVAL);
}
function stopHeartbeat(){
  if(_heartbeatTimer){clearInterval(_heartbeatTimer);_heartbeatTimer=null;_L('heartbeat stopped');}
}

// ── FIX: watcher YM_P2P — attend que P2P soit prêt avant de démarrer le heartbeat ──
function _startP2PReadyWatcher(){
  if(_p2pReadyInterval) return; // déjà en cours
  _L('waiting for YM_P2P to become available…');

  // Écoute l'event custom si app.js en dispatche un (optionnel)
  const onReady = () => {
    _L('ym:p2p-ready event received');
    _stopP2PReadyWatcher();
    startHeartbeat();
  };
  window.addEventListener('ym:p2p-ready', onReady, {once:true});

  // Polling de secours toutes les 500ms pendant max 30s
  let _elapsed = 0;
  _p2pReadyInterval = setInterval(()=>{
    _elapsed += 500;
    if(window.YM_P2P){
      _L(`YM_P2P detected after ${_elapsed}ms — starting heartbeat`);
      _stopP2PReadyWatcher();
      window.removeEventListener('ym:p2p-ready', onReady);
      startHeartbeat();
      return;
    }
    if(_elapsed >= 30000){
      _W('YM_P2P not available after 30s — heartbeat will retry on next peer-join');
      _stopP2PReadyWatcher();
      window.removeEventListener('ym:p2p-ready', onReady);
    }
  }, 500);
}
function _stopP2PReadyWatcher(){
  if(_p2pReadyInterval){clearInterval(_p2pReadyInterval);_p2pReadyInterval=null;}
}

// ── PRESENCE HANDLER ───────────────────────────────────────────────────────
function handlePresence(data,peerId){
  if(!data?.uuid){
    _W('handlePresence — packet without uuid, ignore');
    return;
  }
  const myUUID=_ctx?.loadProfile?.()?.uuid;
  if(data.uuid===myUUID){
    // Loopback normal (on reçoit notre propre broadcast via relay)
    return;
  }

  _receiveCount++;
  const ts=Date.now();

  // ── Calcul de la proximité ──────────────────────────────────────────────
  let isNear=false;
  let distStr='P2P-room';
  if(_myCoords&&data.lat&&data.lng){
    const dist=haversine(_myCoords.lat,_myCoords.lng,data.lat,data.lng);
    isNear=dist<=NEAR_RADIUS;
    distStr=`${dist.toFixed(0)}m`;
    _L(`presence #${_receiveCount} from ${data.name||data.uuid?.slice(0,8)} | dist=${distStr} | near=${isNear} | peerId=${peerId?.slice(0,8)}`);
  }else{
    // Pas de coords → même room P2P = "near" par défaut
    isNear=true;
    _L(`presence #${_receiveCount} from ${data.name||data.uuid?.slice(0,8)} | no geo → near=true (P2P room) | peerId=${peerId?.slice(0,8)}`);
  }

  // ── Gossip2 : intégrer le résumé de ses peers ──────────────────────────
  if(Array.isArray(data._gossip)){
    let gossip2Added=0;
    data._gossip.forEach(g=>{
      if(!g.uuid||g.uuid===myUUID)return;
      const existing=_gossipCache.get(g.uuid);
      if(existing&&existing.source==='direct')return;
      if(existing&&existing.ts>g.ts)return;
      if(_nearUsers.has(g.uuid))return;
      _gossipCache.set(g.uuid,{
        profile:{uuid:g.uuid,name:g.name,spheres:g.spheres||[],broadcastData:g.broadcastData||null,_partial:true},
        ts:g.ts,source:'relay',relayedBy:data.uuid,
      });
      gossip2Added++;
    });
    if(gossip2Added>0) _L(`gossip2 from ${data.name||data.uuid?.slice(0,8)}: +${gossip2Added} relay entries`);
  }

  if(isNear){
    const wasNew=!_nearUsers.has(data.uuid);
    const enrichedProfile=Object.assign({},data);
    if(data.broadcastData)enrichedProfile.broadcastData=data.broadcastData;

    _nearUsers.set(data.uuid,{profile:enrichedProfile,ts,peerId});

    // Gossip direct — profil complet
    _gossipCache.set(data.uuid,{profile:enrichedProfile,ts,source:'direct',relayedBy:null});

    if(wasNew){
      _L(`new near user: ${data.name||data.uuid?.slice(0,8)} (total near: ${_nearUsers.size})`);
      if(_ctx)_ctx.setNotification?.(_nearUsers.size);
      _incTabBadge('Near');
    }
    _refreshNear?.();

    // Mettre à jour le contact stocké
    const contact=getContact(data.uuid);
    if(contact){
      const contacts=loadContacts();
      const c=contacts.find(x=>x.uuid===data.uuid);
      if(c){c.profile=enrichedProfile;saveContacts(contacts);}
    }
    return;
  }

  // Pas nearby mais dans la room : gossip direct quand même
  if(!_nearUsers.has(data.uuid)){
    _gossipCache.set(data.uuid,{
      profile:Object.assign({},data,{broadcastData:data.broadcastData||null}),
      ts,source:'direct',relayedBy:null
    });
    _L(`direct gossip (not near): ${data.name||data.uuid?.slice(0,8)} | dist=${distStr}`);
  }
}

// ── API PUBLIQUE POUR ACCÈS AU GOSSIP ──────────────────────────────────────
function getEnrichedProfile(uuid){
  const near=_nearUsers.get(uuid);
  if(near)return near.profile;
  const contact=getContact(uuid);
  const gossip=_gossipCache.get(uuid);
  if(!gossip&&!contact)return null;
  const base=contact?.profile||{};
  const fresh=gossip?.profile||{};
  const merged=Object.assign({},base,fresh);
  if(fresh.broadcastData)merged.broadcastData=fresh.broadcastData;
  else if(base.broadcastData)merged.broadcastData=base.broadcastData;
  return merged;
}

// ── CLEANUP ────────────────────────────────────────────────────────────────
function cleanGossip(){
  const now=Date.now();
  let gossipChanged=false;
  for(const [uuid,entry] of _gossipCache){
    const ttl=entry.source==='relay'?GOSSIP2_TTL:GOSSIP_TTL;
    if(now-entry.ts>ttl){_gossipCache.delete(uuid);gossipChanged=true;}
  }
  if(_gossipCache.size>GOSSIP_MAX_ENTRIES){
    const sorted=[..._gossipCache.entries()].sort((a,b)=>b[1].ts-a[1].ts);
    _gossipCache=new Map(sorted.slice(0,GOSSIP_MAX_ENTRIES));
    gossipChanged=true;
  }
  if(gossipChanged)_persistGossip();

  let nearChanged=false;
  let expired=[];
  for(const [uuid,entry] of _nearUsers){
    if(now-entry.ts>NEAR_TIMEOUT){
      _nearUsers.delete(uuid);
      nearChanged=true;
      expired.push(uuid);
    }
  }
  if(expired.length) _L(`near timeout — removed: ${expired.map(u=>u.slice(0,8)).join(', ')} | remaining near: ${_nearUsers.size}`);
  if(nearChanged){
    if(_ctx)_ctx.setNotification?.(_nearUsers.size||0);
    _refreshNear?.();
  }
}

// ── VOICE CALLS ────────────────────────────────────────────────────────────
function _getPeerId(uuid){return _nearUsers.get(uuid)?.peerId||null;}

function isReciprocal(uuid){
  if(!getContact(uuid))return false;
  const myUUID=_ctx?.loadProfile?.()?.uuid;
  if(!myUUID)return false;
  const theirContacts=_nearUsers.get(uuid)?.profile?.contacts||[];
  return theirContacts.includes(myUUID);
}

// ── INTERACTION QUEUE ──────────────────────────────────────────────────────
const _interactionQueue=[];
let _interactionActive=false;

function _pushInteraction(opts){
  _interactionQueue.push(opts);
  if(!_interactionActive)_nextInteraction();
}
function _nextInteraction(){
  if(!_interactionQueue.length){_interactionActive=false;return;}
  _interactionActive=true;
  const opts=_interactionQueue[0];
  _showInteractionUI(opts,
    ()=>{_interactionQueue.shift();_interactionActive=false;opts.onAccept?.();_nextInteraction();},
    ()=>{_interactionQueue.shift();_interactionActive=false;opts.onDecline?.();_nextInteraction();}
  );
}
function _showInteractionUI(opts,onAccept,onDecline){
  document.getElementById('ym-interaction-ui')?.remove();
  const profile=opts.profile||{};
  const av=profile.avatar
    ?`<img src="${profile.avatar}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-bottom:8px">`
    :`<div style="width:48px;height:48px;border-radius:50%;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:20px;margin:0 auto 8px">${profile.name?.charAt(0)||'👤'}</div>`;
  const queueLen=_interactionQueue.length;
  const ui=document.createElement('div');
  ui.id='ym-interaction-ui';
  ui.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--surface2);border:1px solid var(--accent);border-radius:var(--r);padding:16px 20px;min-width:260px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.7);text-align:center';
  ui.innerHTML=`
    ${queueLen>1?`<div style="font-size:9px;color:var(--text3);margin-bottom:8px">${queueLen} pending interactions</div>`:''}
    ${av}
    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${profile.name||'Unknown'}</div>
    <div style="font-size:13px;color:var(--accent);margin-bottom:4px">${opts.icon||''} ${opts.label||''}</div>
    ${opts.sublabel?`<div style="font-size:11px;color:var(--text3);margin-bottom:12px">${opts.sublabel}</div>`:'<div style="height:12px"></div>'}
    <div style="display:flex;gap:10px;justify-content:center">
      <button id="int-decline" style="width:52px;height:52px;border-radius:50%;background:#e84040;border:none;font-size:22px;cursor:pointer">✕</button>
      <button id="int-accept" style="width:52px;height:52px;border-radius:50%;background:#30e880;border:none;font-size:22px;cursor:pointer">✓</button>
    </div>`;
  document.body.appendChild(ui);
  ui.querySelector('#int-accept').addEventListener('click',onAccept);
  ui.querySelector('#int-decline').addEventListener('click',onDecline);
}

// ── QR ─────────────────────────────────────────────────────────────────────
function generateQR(uuid,container){
  if(!window.QRCode)return;
  container.innerHTML='';
  new window.QRCode(container,{text:'yourmine://contact/'+uuid,width:120,height:120,correctLevel:QRCode.CorrectLevel.M});
}
function startQRScanner(container,onResult){
  container.innerHTML=`<div style="position:relative;width:100%;max-width:260px;margin:0 auto">
    <video id="qr-video" style="width:100%;border-radius:var(--r-sm)" autoplay playsinline muted></video>
    <canvas id="qr-canvas" style="display:none"></canvas>
    <div style="font-size:10px;color:var(--text3);text-align:center;margin-top:4px">Point your camera at a YourMine QR code</div>
    <button class="ym-btn ym-btn-ghost" id="qr-cancel" style="width:100%;margin-top:6px;font-size:11px">Cancel</button>
  </div>`;
  let stream=null,animFrame=null;
  container.querySelector('#qr-cancel').addEventListener('click',()=>{stop();onResult(null);});
  function stop(){if(animFrame)cancelAnimationFrame(animFrame);stream?.getTracks().forEach(t=>t.stop());stream=null;}
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(s=>{
    stream=s;
    const video=container.querySelector('#qr-video');
    const canvas=container.querySelector('#qr-canvas');
    video.srcObject=s;video.play();
    if('BarcodeDetector' in window){
      const detector=new BarcodeDetector({formats:['qr_code']});
      async function detect(){
        if(video.readyState===video.HAVE_ENOUGH_DATA){
          try{const codes=await detector.detect(video);if(codes.length){stop();onResult(codes[0].rawValue);return;}}catch{}
        }
        animFrame=requestAnimationFrame(detect);
      }
      animFrame=requestAnimationFrame(detect);
    }else{
      const script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js';
      script.onload=()=>{
        const ctx=canvas.getContext('2d');
        function scan(){
          if(video.readyState===video.HAVE_ENOUGH_DATA){
            canvas.width=video.videoWidth;canvas.height=video.videoHeight;
            ctx.drawImage(video,0,0,canvas.width,canvas.height);
            const img=ctx.getImageData(0,0,canvas.width,canvas.height);
            const code=window.jsQR?.(img.data,img.width,img.height);
            if(code){stop();onResult(code.data);return;}
          }
          animFrame=requestAnimationFrame(scan);
        }
        animFrame=requestAnimationFrame(scan);
      };
      document.head.appendChild(script);
    }
  }).catch(()=>{container.innerHTML=`<div class="ym-notice error">Camera access denied</div>`;onResult(null);});
}

// ── RÉSEAUX SOCIAUX ────────────────────────────────────────────────────────
const FEED_NETWORKS=[
  {id:'mastodon',label:'Mastodon',hint:'@user@instance.social'},
  {id:'bluesky',label:'Bluesky',hint:'@handle.bsky.social'},
  {id:'github',label:'GitHub',hint:'@username'},
  {id:'paragraph',label:'Paragraph.xyz',hint:'paragraph.xyz/@handle'},
  {id:'medium',label:'Medium',hint:'@username'},
  {id:'reddit',label:'Reddit',hint:'u/username'},
  {id:'substack',label:'Substack',hint:'username.substack.com'},
  {id:'devto',label:'Dev.to',hint:'@username'},
  {id:'hashnode',label:'Hashnode',hint:'@username'},
];
const PROFILE_ONLY_NETWORKS=[
  {id:'x',label:'X',hint:'@username'},
  {id:'linkedin',label:'LinkedIn',hint:'linkedin.com/in/handle'},
  {id:'instagram',label:'Instagram',hint:'@username'},
  {id:'youtube',label:'YouTube',hint:'@channel'},
  {id:'twitch',label:'Twitch',hint:'@username'},
  {id:'tiktok',label:'TikTok',hint:'@username'},
];
const ALL_NETWORKS=[...FEED_NETWORKS,...PROFILE_ONLY_NETWORKS];

function extractImage(html){if(!html)return null;const m=html.match(/<img[^>]+src=["']([^"']+)["']/i);return m?m[1]:null;}
function extractText(html){return html?html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():'';}

async function fetchFeedItems(networks){
  const items=[];
  for(const n of networks.filter(n=>FEED_NETWORKS.find(f=>f.id===n.id))){
    try{
      if(n.id==='mastodon'&&n.handle){
        const [user,instance]=n.handle.replace('@','').split('@');
        if(instance){
          const acc=await(await fetch(`https://${instance}/api/v1/accounts/lookup?acct=${user}`)).json();
          const posts=await(await fetch(`https://${instance}/api/v1/accounts/${acc.id}/statuses?limit=5`)).json();
          posts.forEach(p=>{
            const img=p.media_attachments?.find(a=>a.type==='image')?.url||extractImage(p.content);
            items.push({network:'Mastodon',author:acc.display_name||acc.username,title:'',text:extractText(p.content),image:img,ts:new Date(p.created_at).getTime(),url:p.url});
          });
        }
      }
      if(n.id==='bluesky'&&n.handle){
        const handle=n.handle.replace('@','');
        const data=await(await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=5`)).json();
        (data.feed||[]).forEach(f=>{
          const post=f.post?.record;
          const img=f.post?.embed?.images?.[0]?.thumb||f.post?.embed?.thumbnail;
          if(post?.text)items.push({network:'Bluesky',author:handle,title:'',text:post.text,image:img||null,ts:new Date(post.createdAt).getTime(),url:`https://bsky.app/profile/${handle}`});
        });
      }
      if(n.id==='github'&&n.handle){
        const user=n.handle.replace('@','');
        const events=await(await fetch(`https://api.github.com/users/${user}/events/public?per_page=5`)).json();
        events.filter(e=>e.type==='PushEvent').forEach(e=>{
          const msg=e.payload?.commits?.[0]?.message||'pushed';
          items.push({network:'GitHub',author:user,title:'',text:msg,image:null,ts:new Date(e.created_at).getTime(),url:`https://github.com/${user}`});
        });
      }
      if(n.id==='medium'&&n.handle){
        const user=n.handle.replace('@','');
        try{
          const r=await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://medium.com/feed/@'+user)}`);
          if(!r.ok)throw new Error('skip');
          const d=await r.json();
          if(d.status==='ok')(d.items||[]).slice(0,5).forEach(p=>items.push({network:'Medium',author:user,title:p.title,text:extractText(p.content||p.description||''),image:p.thumbnail||extractImage(p.content)||extractImage(p.description),ts:new Date(p.pubDate).getTime(),url:p.link}));
        }catch{}
      }
      if(n.id==='substack'&&n.handle){
        const host=n.handle.includes('.')?n.handle:`${n.handle}.substack.com`;
        try{
          const r=await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://'+host+'/feed')}`);
          if(!r.ok)throw new Error('skip');
          const d=await r.json();
          if(d.status==='ok')(d.items||[]).slice(0,5).forEach(p=>items.push({network:'Substack',author:host,title:p.title,text:extractText(p.content||p.description||''),image:p.thumbnail||extractImage(p.content)||extractImage(p.description),ts:new Date(p.pubDate).getTime(),url:p.link}));
        }catch{}
      }
      if(n.id==='paragraph'&&n.handle){
        const handle=n.handle.replace('paragraph.xyz/','').replace('@','');
        try{
          const r=await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://paragraph.xyz/@'+handle+'/rss')}`);
          if(!r.ok)throw new Error('skip');
          const d=await r.json();
          if(d.status==='ok'&&d.items?.length)d.items.slice(0,5).forEach(p=>items.push({network:'Paragraph',author:handle,title:p.title,text:extractText(p.content||p.description||''),image:p.thumbnail||extractImage(p.content)||extractImage(p.description),ts:new Date(p.pubDate).getTime(),url:p.link}));
        }catch{}
      }
      if(n.id==='devto'&&n.handle){
        const user=n.handle.replace('@','');
        const posts=await(await fetch(`https://dev.to/api/articles?username=${user}&per_page=5`)).json();
        if(Array.isArray(posts))posts.forEach(p=>items.push({network:'Dev.to',author:user,title:p.title,text:p.description||'',image:p.cover_image||p.social_image||null,ts:new Date(p.published_at).getTime(),url:p.url}));
      }
      if(n.id==='hashnode'&&n.handle){
        const user=n.handle.replace('@','');
        const r=await fetch('https://gql.hashnode.com/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`{user(username:"${user}"){posts(page:1,pageSize:5){nodes{title,url,publishedAt,brief,coverImage{url}}}}}`})});
        const d=await r.json();
        (d.data?.user?.posts?.nodes||[]).forEach(p=>items.push({network:'Hashnode',author:user,title:p.title,text:p.brief||'',image:p.coverImage?.url||null,ts:new Date(p.publishedAt).getTime(),url:p.url}));
      }
      if(n.id==='reddit'&&n.handle){
        const user=n.handle.replace('u/','').replace('@','');
        const r=await fetch(`https://www.reddit.com/user/${user}/submitted.json?limit=5`);
        const d=await r.json();
        (d.data?.children||[]).forEach(c=>{
          const post=c.data;
          const img=post.thumbnail&&post.thumbnail.startsWith('http')?post.thumbnail:null;
          items.push({network:'Reddit',author:user,title:post.title,text:post.selftext?.slice(0,200)||'',image:img,ts:post.created_utc*1000,url:`https://reddit.com${post.permalink}`});
        });
      }
    }catch(e){_W('feed fetch error for', n.id, ':', e.message);}
  }
  return items.sort((a,b)=>b.ts-a.ts);
}

// ── SPHERE ─────────────────────────────────────────────────────────────────
let _onPeerJoin=null;
let _onVisibility=null;

window.YM_S['social.sphere.js']={
  name:'Social',
  icon:'🌐',
  category:'Communication',
  description:'Near discovery, contacts, social feeds, voice calls',
  author:'theodoreyong9',
  cardBackground:'https://raw.githubusercontent.com/theodoreyong9/YourMinedApp/main/assets/social-bg.jpg',
  emit:['social:presence'],
  receive:['social:presence'],
  statuses:['online','away','busy'],

  async activate(ctx){
    _L('activate — start');
    _ctx=ctx;
    _refreshNear=()=>{
      const panel=_getSocialPanel();
      if(!panel)return;
      const content=panel.querySelector('#social-tab-content');
      if(!content)return;
      const tab=panel.querySelector('.ym-tab.active')?.dataset?.tab;
      if(tab==='Near')renderNearTab(content);
    };

    _loadGossipFromStorage();
    startGeo();

    // FIX: ne pas démarrer le heartbeat immédiatement si P2P pas prêt
    if(window.YM_P2P){
      _L('activate — YM_P2P already available, starting heartbeat immediately');
      startHeartbeat();
    } else {
      _L('activate — YM_P2P not yet available, starting watcher');
      _startP2PReadyWatcher();
    }

    // FIX: si un peer rejoint ET qu'on n'avait pas encore de heartbeat, démarrer
    _onPeerJoin=(e)=>{
      _L('peer-join event received:', e.detail?.peerId?.slice(0,8));
      // Si heartbeat pas actif (P2P venait de devenir dispo), démarrer
      if(!_heartbeatTimer){
        if(window.YM_P2P){
          _L('peer-join triggered heartbeat start');
          startHeartbeat();
        }
      } else {
        // Juste un broadcast de présence pour le nouveau peer
        setTimeout(broadcastPresence, 300);
      }
    };
    window.addEventListener('ym:peer-join',_onPeerJoin);

    ctx.onReceive(async(type,data,peerId)=>{
      _L(`onReceive: type=${type} | from peerId=${peerId?.slice(0,8)}`);
      if(type==='social:presence') handlePresence(data,peerId);
      else if(type==='social:presence-req'){
        _L('presence-req received — broadcasting back');
        broadcastPresence();
      }
    });

    _cleanTimer=setInterval(()=>{cleanGossip();_persistGossip();},5000);

    _onVisibility=()=>{
      if(!document.hidden){
        _L('page visible — broadcasting presence');
        if(window.YM_P2P){
          startHeartbeat(); // relance aussi le timer
          broadcastPresence();
        }
      }
    };
    document.addEventListener('visibilitychange',_onVisibility);

    _L('activate — complete');
  },

  deactivate(){
    _L('deactivate');
    stopGeo();
    stopHeartbeat();
    _stopP2PReadyWatcher();
    if(_cleanTimer){clearInterval(_cleanTimer);_cleanTimer=null;}
    if(_onPeerJoin){window.removeEventListener('ym:peer-join',_onPeerJoin);_onPeerJoin=null;}
    if(_onVisibility){document.removeEventListener('visibilitychange',_onVisibility);_onVisibility=null;}
    window.YM_Call?.hangUp();
    _persistGossip();
    _nearUsers.clear();_gossipCache.clear();
    _broadcastCount=0;_receiveCount=0;
    _ctx=null;
    _L('deactivate — done');
  },

  renderPanel(container){
    _panelHistory.length=0;
    container.style.cssText='display:flex;flex-direction:column;height:100%';
    container.innerHTML='';

    const TABS=['Near','Feed','Search'];
    let curIdx=0;

    const slider=document.createElement('div');
    slider.id='social-tab-content';
    slider.style.cssText='flex:1;overflow:hidden;position:relative';

    const track=document.createElement('div');
    track.style.cssText='display:flex;height:100%;transition:transform .25s ease;will-change:transform';
    slider.appendChild(track);

    TABS.forEach(()=>{
      const pane=document.createElement('div');
      pane.style.cssText='flex:0 0 100%;width:100%;height:100%;overflow-y:auto;padding:14px';
      track.appendChild(pane);
    });

    const tabs=document.createElement('div');tabs.className='ym-tabs';
    tabs.style.cssText='border-top:1px solid rgba(232,160,32,.12);border-bottom:none;margin:0;flex-shrink:0';

    function goTab(idx,animate=true){
      curIdx=idx;
      track.style.transition=animate?'transform .25s ease':'none';
      track.style.transform='translateX(-'+idx*100+'%)';
      tabs.querySelectorAll('.ym-tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
      const pane=track.children[idx];
      pane.innerHTML='';
      if(idx===0){_ctx?.setNotification?.(0);renderNearTab(pane);}
      else if(idx===1)renderFeedTab(pane);
      else if(idx===2)renderSearchTab(pane);
    }

    let sx=0,sy=0,sw=false;
    slider.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;sw=true;},{passive:true});
    slider.addEventListener('pointerup',e=>{
      if(!sw)return;sw=false;
      const dx=e.clientX-sx,dy=e.clientY-sy;
      if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.2){
        const next=dx<0?Math.min(curIdx+1,TABS.length-1):Math.max(curIdx-1,0);
        if(next!==curIdx)goTab(next);
      }
    },{passive:true});
    slider.addEventListener('pointercancel',()=>{sw=false;});

    TABS.forEach((t,i)=>{
      const tab=document.createElement('div');
      tab.className='ym-tab'+(i===0?' active':'');
      tab.dataset.tab=t;tab.textContent=t;
      tab.addEventListener('click',()=>goTab(i));
      tabs.appendChild(tab);
    });

    _refreshNear=()=>{
      if(curIdx===0){const pane=track.children[0];renderNearTab(pane);}
    };

    // FIX: affiche l'état P2P dans l'UI Near pour diagnostic
    container.appendChild(slider);
    container.appendChild(tabs);
    if(_ctx)_ctx.setNotification?.(0);
    goTab(0,false);
  },

  profileSection(container){
    const state=loadState();
    const networks=state.networks||[];

    const netTitle=document.createElement('div');
    netTitle.style.cssText='font-family:var(--font-d,monospace);font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);margin-bottom:8px;margin-top:4px';
    netTitle.textContent='Social Networks';
    container.appendChild(netTitle);

    ALL_NETWORKS.forEach(n=>{
      const saved=networks.find(x=>x.id===n.id);
      const hasFeed=!!FEED_NETWORKS.find(f=>f.id===n.id);
      const row=document.createElement('div');
      row.style.cssText='border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:6px;overflow:hidden';
      const header=document.createElement('div');
      header.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:rgba(255,255,255,.02)';
      header.innerHTML=`
        <span style="font-size:11px;color:${saved?.handle?'var(--accent)':'var(--text2)'};flex:1">${n.label}${saved?.handle?' · <span style="color:var(--text3);font-size:10px">'+saved.handle+'</span>':''}</span>
        ${hasFeed?'<span style="font-size:9px;color:var(--green)">feed</span>':''}
        <span style="font-size:10px;color:var(--text3)">${saved?.handle?'✓':'+'}</span>`;
      row.appendChild(header);
      const body=document.createElement('div');
      body.style.cssText='display:none;padding:8px 10px;border-top:1px solid var(--border)';
      const inp=document.createElement('input');
      inp.className='ym-input';inp.placeholder=n.hint;inp.value=saved?.handle||'';inp.style.fontSize='11px';
      body.appendChild(inp);row.appendChild(body);
      header.addEventListener('click',()=>{
        const open=body.style.display!=='none';
        body.style.display=open?'none':'block';
        if(!open)inp.focus();
      });
      inp.addEventListener('change',()=>{
        const cur=loadState().networks||[];
        const idx=cur.findIndex(x=>x.id===n.id);
        if(inp.value.trim()){if(idx>=0)cur[idx].handle=inp.value.trim();else cur.push({id:n.id,handle:inp.value.trim()});}
        else{if(idx>=0)cur.splice(idx,1);}
        saveState({networks:cur});broadcastPresence();
        header.querySelector('span').innerHTML=`${n.label}${inp.value.trim()?' · <span style="color:var(--text3);font-size:10px">'+inp.value.trim()+'</span>':''}`;
        header.querySelector('span:last-child').textContent=inp.value.trim()?'✓':'+';
        header.querySelector('span:first-child').style.color=inp.value.trim()?'var(--accent)':'var(--text2)';
        body.style.display='none';
      });
      container.appendChild(row);
    });
  },

  getTabBadges(){return{Near:_nearUsers.size,Feed:0,Search:0};},

  peerSection(container,ctx){
    const{uuid,isNear,isReciproc}=ctx;
    const hasCall=!!(window.YM_sphereRegistry&&window.YM_sphereRegistry.has('call.sphere.js'));
    const hasMsg=!!(window.YM_sphereRegistry&&window.YM_sphereRegistry.has('messenger.sphere.js'));

    if(isNear&&isReciproc&&hasCall){
      const btn=document.createElement('button');
      btn.className='ym-btn ym-btn-ghost';
      btn.style.cssText='width:100%;font-size:12px;color:var(--cyan);border-color:rgba(34,211,238,.3);margin-bottom:6px';
      btn.textContent='📞 Voice Call';
      btn.addEventListener('click',()=>window.YM_Call?.startVoiceCall(uuid));
      container.appendChild(btn);
    }
    if(isNear&&isReciproc&&hasMsg){
      const btn=document.createElement('button');
      btn.className='ym-btn ym-btn-ghost';
      btn.style.cssText='width:100%;font-size:12px;margin-bottom:6px';
      btn.textContent='💬 Message';
      btn.addEventListener('click',()=>{
        if(window.YM_Messenger?.openConv)window.YM_Messenger.openConv(uuid);
        if(window.YM?.openSpherePanel)window.YM.openSpherePanel('messenger.sphere.js');
      });
      container.appendChild(btn);
    }
    if(!hasCall&&!hasMsg&&(!isNear||!isReciproc)){
      const info=document.createElement('div');
      info.style.cssText='font-size:11px;color:var(--text3);text-align:center;padding:4px';
      info.textContent=isNear?'Add each other as contacts to interact':'Not nearby';
      container.appendChild(info);
    }
  },
};

// ── BADGES ─────────────────────────────────────────────────────────────────
const _tabBadges={Near:0,Feed:0,Search:0};
function _getSocialPanel(){
  const body=document.getElementById('panel-sphere-body');
  if(!body)return null;
  return body.querySelector('#social-tab-content')?body:null;
}
function _incTabBadge(tab){_tabBadges[tab]=(_tabBadges[tab]||0)+1;_updateTabBadgeUI(tab);}
function _clearTabBadge(tab){_tabBadges[tab]=0;_updateTabBadgeUI(tab);}
function _updateTabBadgeUI(tab){
  const panel=_getSocialPanel();
  const t=panel?.querySelector(`.ym-tab[data-tab="${tab}"]`);
  if(!t)return;
  let badge=t.querySelector('.ym-tab-badge');
  const count=_tabBadges[tab]||0;
  if(count>0){
    if(!badge){badge=document.createElement('span');badge.className='ym-tab-badge';t.appendChild(badge);}
    badge.textContent=count;
  }else if(badge){badge.remove();}
}

// ── NEAR TAB ───────────────────────────────────────────────────────────────
function renderNearTab(el){
  _clearTabBadge('Near');
  const near=[..._nearUsers.values()];
  const myUUID=_ctx?.loadProfile?.()?.uuid;

  const gossipDirect=[..._gossipCache.values()]
    .filter(g=>g.source==='direct'&&!_nearUsers.has(g.profile.uuid)&&g.profile.uuid!==myUUID)
    .slice(0,10);
  const gossipRelay=[..._gossipCache.values()]
    .filter(g=>g.source==='relay'&&!_nearUsers.has(g.profile.uuid)&&g.profile.uuid!==myUUID)
    .slice(0,10);

  // FIX: badge de statut P2P visible dans l'UI pour diagnostic
  const p2pStatus = window.YM_P2P
    ? `<span style="color:var(--green);font-size:10px">● P2P connected</span>`
    : `<span style="color:#e84040;font-size:10px">● P2P connecting…</span>`;

  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <div style="font-size:10px;color:var(--text3)">Within ${NEAR_RADIUS}m · ${near.length} online</div>
      <div style="margin-left:auto;font-size:10px;color:var(--text3)">${_myCoords?'📍':'🌐'} ${_myCoords?(_myCoords.lat.toFixed(3)+','+_myCoords.lng.toFixed(3)):'P2P room'}</div>
      ${p2pStatus}
    </div>`;

  if(!near.length){
    el.innerHTML+=`<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:12px">No one nearby right now…</div>`;
  }else{
    near.forEach(u=>el.appendChild(userCard(u.profile,'near',()=>{addContact(u.profile);window.YM_toast?.('Contact added','success');renderNearTab(el);})));
  }

  if(gossipDirect.length){
    const hdr=document.createElement('div');
    hdr.style.cssText='font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);padding:12px 0 6px;border-top:1px solid var(--border);margin-top:8px';
    hdr.textContent='Recently seen';
    el.appendChild(hdr);
    gossipDirect.forEach(g=>el.appendChild(userCard(g.profile,'gossip',()=>{addContact(g.profile);window.YM_toast?.('Contact added','success');renderNearTab(el);})));
  }

  if(gossipRelay.length){
    const hdr2=document.createElement('div');
    hdr2.style.cssText='font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);padding:12px 0 6px;border-top:1px solid var(--border);margin-top:8px';
    hdr2.textContent='Nearby (via others)';
    el.appendChild(hdr2);
    gossipRelay.forEach(g=>el.appendChild(userCard(g.profile,'gossip',()=>{addContact(g.profile);window.YM_toast?.('Contact added','success');renderNearTab(el);})));
  }
}

// ── FEED TAB ───────────────────────────────────────────────────────────────
function renderFeedTab(el){
  el.innerHTML='';
  const tabs=['Nearby','Contacts'];
  let currentIdx=0;
  const subTabs=document.createElement('div');subTabs.className='ym-tabs';
  const feedContent=document.createElement('div');feedContent.style.cssText='flex:1;overflow:hidden;position:relative';

  let swipeX=0,swipeY=0,swiping=false;
  feedContent.addEventListener('pointerdown',e=>{swipeX=e.clientX;swipeY=e.clientY;swiping=true;},{passive:true});
  feedContent.addEventListener('pointerup',e=>{
    if(!swiping)return;swiping=false;
    const dx=e.clientX-swipeX,dy=e.clientY-swipeY;
    if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.5){
      const next=dx>0?Math.min(currentIdx+1,tabs.length-1):Math.max(currentIdx-1,0);
      if(next!==currentIdx){currentIdx=next;switchTab(next);}
    }
  },{passive:true});

  function switchTab(idx){
    currentIdx=idx;
    subTabs.querySelectorAll('.ym-tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
    feedContent.innerHTML='<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px">Loading…</div>';
    if(tabs[idx]==='Nearby'){
      loadFeedForUsers([..._nearUsers.values()].map(u=>u.profile),feedContent);
    }else{
      const contacts=(()=>{try{return JSON.parse(localStorage.getItem('ym_contacts_v1')||'[]');}catch{return[];}})();
      loadFeedForUsers(contacts.map(c=>c.profile).filter(Boolean),feedContent);
    }
  }

  tabs.forEach((t,i)=>{
    const tab=document.createElement('div');
    tab.className='ym-tab'+(i===0?' active':'');
    tab.dataset.tab=t;tab.textContent=t;
    tab.addEventListener('click',()=>switchTab(i));
    subTabs.appendChild(tab);
  });

  el.appendChild(subTabs);el.appendChild(feedContent);
  switchTab(0);
}

async function loadFeedForUsers(profiles,container){
  container.innerHTML='';
  if(!profiles.length){container.innerHTML=`<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px">No profiles yet</div>`;return;}
  const feedProfiles=profiles.filter(p=>(p.networks||[]).some(n=>FEED_NETWORKS.find(f=>f.id===n.id)));
  if(!feedProfiles.length){container.innerHTML=`<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px">No public social networks in these profiles</div>`;return;}
  for(const profile of feedProfiles){
    const networks=(profile.networks||[]).filter(n=>FEED_NETWORKS.find(f=>f.id===n.id));
    if(!networks.length)continue;
    const banner=document.createElement('div');
    banner.style.cssText='position:sticky;top:0;z-index:10;background:rgba(8,8,15,.92);backdrop-filter:blur(8px);padding:8px 0 6px;cursor:pointer;display:flex;align-items:center;gap:10px;margin-bottom:4px';
    const av=profile.avatar?`<img src="${profile.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`:`<div style="width:32px;height:32px;border-radius:50%;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${profile.name?.charAt(0)||'👤'}</div>`;
    banner.innerHTML=`${av}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;color:var(--text)">${profile.name||'Anonymous'}</div><div style="font-size:10px;color:var(--text3)">${networks.map(n=>n.id).join(' · ')}</div></div><span style="font-size:10px;color:var(--accent)">›</span>`;
    banner.addEventListener('click',()=>window.YM_Social?.openProfile?.(profile.uuid));
    container.appendChild(banner);
    const feedWrap=document.createElement('div');feedWrap.style.marginBottom='16px';
    feedWrap.innerHTML=`<div style="color:var(--text3);font-size:11px;padding:6px 0">Loading…</div>`;
    container.appendChild(feedWrap);
    fetchFeedItems(networks).then(items=>{
      feedWrap.innerHTML='';
      if(!items.length){feedWrap.innerHTML=`<div style="color:var(--text3);font-size:11px;padding:6px 0;text-align:center">No posts found</div>`;return;}
      items.slice(0,10).forEach(item=>{
        const card=document.createElement('div');card.className='ym-card';card.style.cssText='cursor:pointer;margin-bottom:8px';
        const excerpt=item.text?(item.text.slice(0,180)+(item.text.length>180?'…':'')):'';
        card.innerHTML=`
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span class="pill" style="font-size:9px">${item.network}</span>
            <span style="font-size:9px;color:var(--text3);margin-left:auto">${new Date(item.ts).toLocaleDateString()}</span>
          </div>
          ${item.image?`<img src="${item.image}" style="width:100%;border-radius:var(--r-sm);margin-bottom:8px;max-height:180px;object-fit:cover" loading="lazy" onerror="this.style.display='none'">`:''}
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;line-height:1.4">${item.title||''}</div>
          ${excerpt?`<div style="font-size:12px;color:var(--text2);line-height:1.5">${excerpt}</div>`:''}`;
        if(item.url)card.addEventListener('click',()=>window.open(item.url,'_blank'));
        feedWrap.appendChild(card);
      });
    }).catch(()=>{feedWrap.innerHTML=`<div style="color:var(--text3);font-size:11px;padding:6px 0;text-align:center">Could not load feed</div>`;});
  }
}

// ── SEARCH TAB ─────────────────────────────────────────────────────────────
async function renderSearchTab(el){
  el.innerHTML='';
  const form=document.createElement('div');form.style.cssText='margin-bottom:12px';
  form.innerHTML=
    '<input id="srch-query" class="ym-input" placeholder="Search by keyword, name…" style="margin-bottom:8px;font-size:13px">'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" id="srch-sphere-filters"></div>'+
    '<button class="ym-btn ym-btn-accent" id="srch-go" style="width:100%;font-size:13px">Search</button>';
  el.appendChild(form);
  const resultsEl=document.createElement('div');el.appendChild(resultsEl);

  let sphereFilters=[];
  const filterWrap=form.querySelector('#srch-sphere-filters');
  if(window.YM_sphereRegistry){
    window.YM_sphereRegistry.forEach((s,id)=>{
      if(s.isProfileSphere||id==='social.sphere.js')return;
      const pill=document.createElement('button');
      pill.className='ym-btn ym-btn-ghost';
      pill.style.cssText='font-size:10px;padding:2px 10px;border-radius:20px';
      pill.textContent=id.replace('.sphere.js','');
      pill.dataset.active='0';
      pill.addEventListener('click',()=>{
        const active=pill.dataset.active==='1';
        pill.dataset.active=active?'0':'1';
        pill.style.background=active?'':'rgba(240,168,48,.15)';
        pill.style.borderColor=active?'':'var(--gold)';
        pill.style.color=active?'':'var(--gold)';
        if(active)sphereFilters=sphereFilters.filter(s=>s!==id);
        else sphereFilters.push(id);
      });
      filterWrap.appendChild(pill);
    });
  }

  form.querySelector('#srch-go').addEventListener('click',async()=>{
    const query=form.querySelector('#srch-query').value.trim().toLowerCase();
    resultsEl.innerHTML='<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px">Searching…</div>';
    const registryUrl=(window.YM_REGISTRY_OVERRIDE&&window.YM_REGISTRY_OVERRIDE.url)||'';
    const repoMatch=registryUrl.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)/);
    const base=repoMatch?'https://raw.githubusercontent.com/'+repoMatch[1]+'/main':'https://raw.githubusercontent.com/theodoreyong9/YourMinedApp/main';
    const baseDefault='https://raw.githubusercontent.com/theodoreyong9/YourMinedApp/main';
    const t='?t='+Date.now();
    const bases=base===baseDefault?[base]:[base,baseDefault];
    const[namesResults,profilesResults]=await Promise.all([
      Promise.allSettled(bases.map(b=>fetch(b+'/name.json'+t,{mode:'cors'}).then(r=>r.ok?r.json():{}))),
      Promise.allSettled(bases.map(b=>fetch(b+'/profile.json'+t,{mode:'cors'}).then(r=>r.ok?r.json():[])))
    ]);
    let allNames={};
    namesResults.forEach(r=>{if(r.status==='fulfilled')Object.assign(allNames,r.value);});
    let byUuid={};
    profilesResults.forEach(r=>{if(r.status==='fulfilled'&&Array.isArray(r.value))r.value.forEach(p=>{if(p.uuid&&!byUuid[p.uuid])byUuid[p.uuid]=p;});});
    if(query)Object.entries(allNames).forEach(([name,uuid])=>{if(!byUuid[uuid])byUuid[uuid]={uuid,name,keywords:[],score:0};});
    let allProfiles=Object.values(byUuid);
    allProfiles.sort((a,b)=>(b.score||0)-(a.score||0));
    const filtered=allProfiles.filter(p=>{
      if(sphereFilters.length){if(!sphereFilters.some(sf=>(p.spheres||[]).includes(sf)))return false;}
      if(!query)return true;
      const nameMatch=(p.name||'').toLowerCase().includes(query);
      const kwMatch=(p.keywords||[]).join(' ').toLowerCase().includes(query);
      return nameMatch||kwMatch;
    });
    resultsEl.innerHTML='';
    if(!filtered.length){resultsEl.innerHTML='<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px">No profiles found</div>';return;}
    filtered.forEach(profile=>{
      const card=document.createElement('div');card.className='ym-card';card.style.cursor='pointer';
      const accent=profile.accent||'#f0a830';
      card.innerHTML=
        `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;color:${accent}">${(profile.name||'?').charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:var(--text)">${profile.name||'Anonymous'}</div>
            ${profile.bio?`<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${profile.bio}</div>`:''}
          </div>
        </div>`+
        (profile.keywords?.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${profile.keywords.slice(0,5).map(k=>`<span style="font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid ${accent};color:${accent};opacity:.7">${k}</span>`).join('')}</div>`:'')+
        (profile.spheres?.length?`<div style="display:flex;flex-wrap:wrap;gap:4px">${profile.spheres.slice(0,4).map(s=>`<span style="font-size:10px;padding:2px 8px;background:rgba(255,255,255,.05);border-radius:20px;color:rgba(255,255,255,.5)">${s.replace('.sphere.js','')}</span>`).join('')}</div>`:'');
      card.addEventListener('click',()=>{
        if(profile.profileSphere&&!window.YM_S[profile.uuid+'.profile.js']){
          const s=document.createElement('script');s.src=profile.profileSphere+'?t='+Date.now();document.head.appendChild(s);
          s.onload=()=>window.YM?.openProfilePanel?.(profile);
        }else window.YM?.openProfilePanel?.(profile);
      });
      resultsEl.appendChild(card);
    });
  });
}

const _panelHistory=[];

// ── YM_SOCIAL PUBLIC API ───────────────────────────────────────────────────
window.YM_Social={
  openProfile(uuid){
    const near=_nearUsers.get(uuid);
    const contact=getContact(uuid);
    const profile=getEnrichedProfile(uuid)||near?.profile||contact?.profile||{uuid,name:'Unknown'};
    window.YM?.openProfilePanel?.(profile);
  },
  isReciprocal,
  get _nearUsers(){return _nearUsers;},
  get _gossipCache(){return _gossipCache;},
  get _contacts(){return loadContacts().map(c=>c.uuid);},
  getEnrichedProfile,
  broadcastPresence,
  // FIX: diagnostic rapide accessible depuis la console
  _diag(){
    console.log('[Social] === DIAGNOSTIC ===');
    console.log('[Social] YM_P2P:', window.YM_P2P ? `OK (cdn:${window.YM_P2P.cdn||'?'})` : 'NOT SET ⚠️');
    console.log('[Social] heartbeat timer:', _heartbeatTimer ? 'running ✓' : 'stopped ⚠️');
    console.log('[Social] p2pReadyWatcher:', _p2pReadyInterval ? 'running' : 'idle');
    console.log('[Social] nearUsers:', _nearUsers.size);
    console.log('[Social] gossipCache:', _gossipCache.size, '(direct:', [..._gossipCache.values()].filter(e=>e.source==='direct').length, ', relay:', [..._gossipCache.values()].filter(e=>e.source==='relay').length, ')');
    console.log('[Social] broadcasts:', _broadcastCount, '| received:', _receiveCount);
    console.log('[Social] myCoords:', _myCoords ? `lat=${_myCoords.lat?.toFixed(5)} lng=${_myCoords.lng?.toFixed(5)}` : 'none (geo off)');
    console.log('[Social] ctx:', _ctx ? 'present ✓' : 'null ⚠️');
    console.log('[Social] ====================');
  },
};

// ── USER CARD ──────────────────────────────────────────────────────────────
function userCard(profile,type,onAdd){
  const card=document.createElement('div');card.className='ym-card';card.style.cursor='pointer';
  const isContact=!!getContact(profile.uuid);
  const isPartial=!!profile._partial;
  const av=profile.avatar
    ?`<img src="${profile.avatar}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`
    :`<div style="width:36px;height:36px;border-radius:50%;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:16px">${profile.name?.charAt(0)||'👤'}</div>`;
  card.innerHTML=`
    <div style="display:flex;align-items:center;gap:12px">
      <div style="flex-shrink:0">${av}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${profile.name||'Anonymous'}${isPartial?' <span style="font-size:9px;color:var(--text3)">(via relay)</span>':''}</div>
        ${profile.bio?`<div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${profile.bio}</div>`:''}
      </div>
      ${onAdd&&!isContact?`<button class="ym-btn ym-btn-ghost" style="padding:4px 10px;font-size:12px;min-height:unset" data-add>+</button>`:''}
      ${isContact&&type==='near'?'<span style="font-size:10px;color:var(--green)">✓</span>':''}
    </div>`;
  card.querySelector('[data-add]')?.addEventListener('click',e=>{e.stopPropagation();onAdd?.();});
  card.addEventListener('click',e=>{if(!e.target.closest('[data-add]'))window.YM_Social?.openProfile?.(profile.uuid);});
  return card;
}

})();
