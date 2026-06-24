/* status.sphere.js — Battery & Network status widget */
(function(){
'use strict';
window.YM_S = window.YM_S || {};

const SPHERE_ID = 'status.sphere.js';
const WIDGET_ID = 'ym-status-widget';
const POS_KEY   = 'status_widget_pos';

let _ctx    = null;
let _widget = null;
let _timer  = null;
let _battery = null;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _isPC(){return window.matchMedia&&window.matchMedia('(hover:hover) and (pointer:fine)').matches;}

// ── Pos ───────────────────────────────────────────────────────
function _loadPos(){try{return JSON.parse(localStorage.getItem(POS_KEY)||'{}');}catch{return{};}}
function _savePos(p){localStorage.setItem(POS_KEY,JSON.stringify(p));}

// ── Page sync ─────────────────────────────────────────────────
const _onPageChange=()=>_syncWidgetPage();
function _syncWidgetPage(){
  if(!_widget||!document.body.contains(_widget))return;
  if(_widget._dragging)return;
  let widgetPage=0;
  if(window.YM_Desk&&window.YM_Desk.registeredWidgetPage){
    const rp=window.YM_Desk.registeredWidgetPage(WIDGET_ID);
    if(rp!=null)widgetPage=rp;
    else widgetPage=_loadPos().page||0;
  }else{widgetPage=_loadPos().page||0;}
  const curPage=window._deskCurPage!=null?window._deskCurPage:0;
  const visible=curPage===widgetPage;
  _widget.style.opacity=visible?'1':'0';
  _widget.style.pointerEvents=visible?'auto':'none';
}

function _registerPage(page){
  if(window.YM_Desk&&window.YM_Desk.registerWidgetPage)
    window.YM_Desk.registerWidgetPage(WIDGET_ID,page,POS_KEY);
}

// ── Nav bounds ────────────────────────────────────────────────
function _getNavBounds(){
  const navBar=document.getElementById('nav-bar');
  if(!navBar)return{maxRight:window.innerWidth,maxBottom:window.innerHeight};
  const r=navBar.getBoundingClientRect();
  if(_isPC())return{maxRight:r.left,maxBottom:window.innerHeight};
  return{maxRight:window.innerWidth,maxBottom:r.top};
}
function _clampPos(wx,wy){
  const bounds=_getNavBounds();
  const ww=_widget?_widget.offsetWidth:160;
  const wh=_widget?_widget.offsetHeight:44;
  return{x:Math.max(0,Math.min(bounds.maxRight-ww,wx)),y:Math.max(0,Math.min(bounds.maxBottom-wh,wy))};
}

// ── Battery ───────────────────────────────────────────────────
async function getBattery(){
  if(!navigator.getBattery)return null;
  try{return await navigator.getBattery();}catch{return null;}
}
function batColor(level,charging){
  if(charging)return'#22d98a';
  if(level>0.5)return'#22d98a';
  if(level>0.2)return'#f0a830';
  return'#ff4560';
}

// ── Network ───────────────────────────────────────────────────
function getNet(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(!c)return{type:'?',speed:null,online:navigator.onLine};
  return{type:c.effectiveType||c.type||'?',speed:c.downlink||null,online:navigator.onLine,saveData:c.saveData||false};
}
function netIcon(net){if(!net.online)return'📵';return'📶';}

// ── Widget content ────────────────────────────────────────────
async function _refreshWidget(){
  if(!_widget)return;
  const bat=_battery||await getBattery();
  if(bat)_battery=bat;
  const net=getNet();
  const level=bat?Math.round(bat.level*100):null;
  const bc=bat?batColor(bat.level,bat.charging):'rgba(255,255,255,.4)';
  _widget.innerHTML=
    (level!=null?
      '<span style="color:'+bc+';font-size:13px">'+(bat.charging?'⚡':'🔋')+'</span>'+
      '<span style="color:'+bc+';font-weight:600;font-size:11px">'+level+'%</span>'+
      '<span style="color:rgba(255,255,255,.15);font-size:10px">·</span>'
    :'')+
    '<span style="font-size:13px">'+netIcon(net)+'</span>'+
    '<span style="color:rgba(255,255,255,.6);font-size:11px">'+esc(net.type.toUpperCase())+'</span>'+
    (net.speed?'<span style="color:rgba(255,255,255,.3);font-size:10px">'+net.speed+'M</span>':'');
}

// ── Build widget ──────────────────────────────────────────────
function _buildWidget(){
  if(_widget&&document.body.contains(_widget)){_refreshWidget();_syncWidgetPage();return;}

  const spawnPage=window._deskCurPage||0;
  const pos=_loadPos();
  const savedPage=pos.page||0;
  const targetPage=localStorage.getItem(POS_KEY)?savedPage:spawnPage;

  _widget=document.createElement('div');
  _widget.id=WIDGET_ID;
  _widget.style.cssText=
    'position:fixed;z-index:250;'+
    'background:rgba(10,10,15,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);'+
    'border:1px solid rgba(255,255,255,.1);border-radius:20px;'+
    'padding:7px 14px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;'+
    'display:flex;align-items:center;gap:8px;'+
    'box-shadow:0 2px 16px rgba(0,0,0,.4);'+
    'font-family:var(--font-m,monospace);'+
    'right:'+(pos.right||12)+'px;bottom:'+(pos.bottom||96)+'px;'+
    'cursor:pointer;transition:opacity .2s';

  _refreshWidget();
  document.body.appendChild(_widget);
  _registerPage(targetPage);
  _syncWidgetPage();

  if(!localStorage.getItem(POS_KEY)){
    const navH=window.YM_Desk&&window.YM_Desk.safeBottom||90;
    _savePos({right:12,bottom:navH+14,page:targetPage});
  }

  window.addEventListener('ym:page-change',_onPageChange);

  let dragging=false,ox=0,oy=0,wx=0,wy=0,_edgeT=null;

  const onMove=(cx,cy)=>{
    if(!dragging)return;
    const rawX=wx+(cx-ox);const rawY=wy+(cy-oy);
    ox=cx;oy=cy;
    const clamped=_clampPos(rawX,rawY);
    wx=clamped.x;wy=clamped.y;
    _widget.style.left=wx+'px';_widget.style.top=wy+'px';
    _widget.style.right='';_widget.style.bottom='';
    const vw=_isPC()?window.innerWidth-72:window.innerWidth;
    const ew=vw*0.15;
    const curPage=window._deskCurPage||0;
    if(cx<ew&&curPage>0){
      if(!_edgeT)_edgeT=setTimeout(()=>{
        _edgeT=null;const tp=curPage-1;
        if(window.YM_Desk)window.YM_Desk.goPage(tp);
        _registerPage(tp);
        const p=_loadPos();_savePos(Object.assign({},p,{page:tp}));
      },300);
    }else if(cx>vw-ew){
      if(!_edgeT)_edgeT=setTimeout(()=>{
        _edgeT=null;const tp=(window._deskCurPage||0)+1;
        if(window.YM_Desk)window.YM_Desk.goPageOrCreate(tp);
        _registerPage(tp);
        const p=_loadPos();_savePos(Object.assign({},p,{page:tp}));
      },300);
    }else{clearTimeout(_edgeT);_edgeT=null;}
  };

  const onEnd=()=>{
    if(!dragging)return;dragging=false;_widget._dragging=false;
    clearTimeout(_edgeT);_edgeT=null;
    const ww=_widget.offsetWidth,wh=_widget.offsetHeight;
    const r=Math.max(0,window.innerWidth-wx-ww);
    const b=Math.max(0,window.innerHeight-wy-wh);
    const curPage=window._deskCurPage||0;
    _registerPage(curPage);
    _savePos({right:r,bottom:b,page:curPage});
    _syncWidgetPage();
    setTimeout(()=>{if(window.YM_Desk)window.YM_Desk.autoCleanPages();},100);
  };

  _widget.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    dragging=true;_widget._dragging=true;
    const rect=_widget.getBoundingClientRect();
    wx=rect.left;wy=rect.top;
    _widget.style.left=wx+'px';_widget.style.top=wy+'px';
    _widget.style.right='';_widget.style.bottom='';
    ox=e.clientX;oy=e.clientY;
    _widget.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    e.stopPropagation();
  });
  _widget.addEventListener('pointermove',e=>{onMove(e.clientX,e.clientY);});
  _widget.addEventListener('pointerup',e=>{document.body.classList.remove('dragging');onEnd();});
  _widget.addEventListener('pointercancel',e=>{document.body.classList.remove('dragging');onEnd();});

  _widget.addEventListener('click',e=>{
    if(!_widget._dragging&&_ctx)_ctx.openPanel();
  });
}

// ── Panel ─────────────────────────────────────────────────────
async function renderPanel(container){
  container.innerHTML='';
  container.style.cssText='padding:16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto';

  const bat=await getBattery();if(bat)_battery=bat;
  const net=getNet();
  const conn=navigator.connection||null;

  if(bat){
    const level=Math.round(bat.level*100);
    const bc=batColor(bat.level,bat.charging);
    const card=document.createElement('div');
    card.style.cssText='background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px';
    card.innerHTML=
      '<div style="font-size:9px;color:var(--text3);font-family:var(--font-m,monospace);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">🔋 Battery</div>'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'+
        '<div style="font-size:36px">'+(bat.charging?'⚡':'🔋')+'</div>'+
        '<div><div style="font-size:28px;font-weight:700;color:'+bc+';font-family:var(--font-m,monospace)">'+level+'%</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+(bat.charging?'Charging':'Discharging')+'</div></div>'+
      '</div>'+
      '<div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">'+
        '<div style="height:100%;width:'+level+'%;background:'+bc+';border-radius:3px"></div>'+
      '</div>'+
      (bat.chargingTime&&bat.chargingTime!==Infinity?'<div style="font-size:10px;color:var(--text3);margin-top:6px">Full in ~'+Math.round(bat.chargingTime/60)+' min</div>':'')+
      (bat.dischargingTime&&bat.dischargingTime!==Infinity&&!bat.charging?'<div style="font-size:10px;color:var(--text3);margin-top:6px">~'+Math.round(bat.dischargingTime/60)+' min remaining</div>':'');
    container.appendChild(card);
  }else{
    const noCard=document.createElement('div');
    noCard.style.cssText='background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;font-size:12px;color:var(--text3)';
    noCard.textContent='Battery API not available (iOS Safari).';
    container.appendChild(noCard);
  }

  const netCard=document.createElement('div');
  netCard.style.cssText='background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px';
  netCard.innerHTML=
    '<div style="font-size:9px;color:var(--text3);font-family:var(--font-m,monospace);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📶 Network</div>'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+
      '<div style="font-size:28px">'+netIcon(net)+'</div>'+
      '<div><div style="font-size:16px;font-weight:600;color:'+(net.online?'#22d98a':'#ff4560')+'">'+(net.online?'Online':'Offline')+'</div>'+
      '<div style="font-size:11px;color:var(--text3)">'+esc(net.type.toUpperCase())+'</div></div>'+
    '</div>'+
    (net.speed?'<div style="display:flex;justify-content:space-between;font-size:11px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)"><span style="color:var(--text3)">Downlink</span><span style="color:var(--text2)">'+net.speed+' Mbps</span></div>':'')+
    (conn?.rtt?'<div style="display:flex;justify-content:space-between;font-size:11px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)"><span style="color:var(--text3)">RTT</span><span style="color:var(--text2)">'+conn.rtt+' ms</span></div>':'')+
    (net.saveData?'<div style="font-size:10px;color:#f0a830;margin-top:6px">⚠ Data saver active</div>':'');
  container.appendChild(netCard);

  const btn=document.createElement('button');
  btn.className='ym-btn ym-btn-ghost';btn.style.cssText='font-size:11px;width:100%';btn.textContent='↺ Refresh';
  btn.addEventListener('click',async()=>{await renderPanel(container);await _refreshWidget();});
  container.appendChild(btn);
}

// ── broadcastData — partagé avec les pairs via social presence ─
function broadcastData(){
  const net=getNet();
  const bat=_battery;
  return{
    online:net.online,
    network:net.type,
    speed:net.speed||null,
    battery:bat?Math.round(bat.level*100):null,
    charging:bat?bat.charging:null,
  };
}

// ── profileSection — dans ton propre profil → onglet Spheres ──
// Affiche batterie + réseau en live avec refresh auto
function profileSection(container){
  function render(){
    container.innerHTML='';
    const net=getNet();
    const bat=_battery;
    const level=bat?Math.round(bat.level*100):null;
    const bc=bat?batColor(bat.level,bat.charging):'rgba(255,255,255,.4)';

    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:16px;flex-wrap:wrap';

    // Battery block
    if(level!=null){
      const batBlock=document.createElement('div');
      batBlock.style.cssText='display:flex;align-items:center;gap:8px';
      // Bar
      const barWrap=document.createElement('div');
      barWrap.style.cssText='width:36px;height:14px;border:1.5px solid rgba(255,255,255,.2);border-radius:3px;position:relative;overflow:hidden';
      const barFill=document.createElement('div');
      barFill.style.cssText='height:100%;width:'+level+'%;background:'+bc+';border-radius:2px;transition:width .5s';
      // Charging tip
      const tip=document.createElement('div');
      tip.style.cssText='position:absolute;right:-5px;top:50%;transform:translateY(-50%);width:4px;height:7px;background:rgba(255,255,255,.2);border-radius:0 2px 2px 0';
      barWrap.appendChild(barFill);barWrap.appendChild(tip);
      const batTxt=document.createElement('span');
      batTxt.style.cssText='font-size:13px;font-weight:700;color:'+bc+';font-family:var(--font-m,monospace)';
      batTxt.textContent=level+'%'+(bat.charging?' ⚡':'');
      batBlock.appendChild(barWrap);batBlock.appendChild(batTxt);
      row.appendChild(batBlock);
    }

    // Network block
    const netBlock=document.createElement('div');
    netBlock.style.cssText='display:flex;align-items:center;gap:6px';
    const netDot=document.createElement('span');
    netDot.style.cssText='width:7px;height:7px;border-radius:50%;background:'+(net.online?'#22d98a':'#ff4560')+';flex-shrink:0';
    const netTxt=document.createElement('span');
    netTxt.style.cssText='font-size:12px;color:var(--text2);font-family:var(--font-m,monospace)';
    netTxt.textContent=net.type.toUpperCase()+(net.speed?' · '+net.speed+'M':'');
    netBlock.appendChild(netDot);netBlock.appendChild(netTxt);
    row.appendChild(netBlock);

    container.appendChild(row);
  }

  render();
  // Refresh toutes les 10s tant que le container est dans le DOM
  const iv=setInterval(function(){
    if(!document.body.contains(container)){clearInterval(iv);return;}
    render();
  },10000);
  // Refresh immédiat si batterie disponible
  getBattery().then(function(bat){
    if(!bat)return;
    _battery=bat;
    bat.addEventListener('levelchange',render);
    bat.addEventListener('chargingchange',render);
  });
}

// ── peerSection — dans le profil d'un pair ─────────────────────
// Affiche les données réseau reçues via broadcastData (pas la batterie — privée)
function peerSection(container,peerCtx){
  container.innerHTML='';
  const bd=peerCtx&&peerCtx.profile&&peerCtx.profile.broadcastData;
  const data=bd&&bd['status.sphere.js'];

  if(!data){
    const empty=document.createElement('div');
    empty.style.cssText='font-size:11px;color:var(--text3,rgba(228,230,244,.3))';
    empty.textContent='No status data';
    container.appendChild(empty);
    return;
  }

  const row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;gap:14px;flex-wrap:wrap';

  // Battery (si partagée)
  if(data.battery!=null){
    const bc=batColor(data.battery/100,data.charging);
    const batBlock=document.createElement('div');
    batBlock.style.cssText='display:flex;align-items:center;gap:7px';
    const barWrap=document.createElement('div');
    barWrap.style.cssText='width:32px;height:13px;border:1.5px solid rgba(255,255,255,.2);border-radius:3px;overflow:hidden';
    const barFill=document.createElement('div');
    barFill.style.cssText='height:100%;width:'+data.battery+'%;background:'+bc+';border-radius:2px';
    barWrap.appendChild(barFill);
    const batTxt=document.createElement('span');
    batTxt.style.cssText='font-size:12px;font-weight:700;color:'+bc+';font-family:var(--font-m,monospace)';
    batTxt.textContent=data.battery+'%'+(data.charging?' ⚡':'');
    batBlock.appendChild(barWrap);batBlock.appendChild(batTxt);
    row.appendChild(batBlock);
  }

  // Network
  const netBlock=document.createElement('div');
  netBlock.style.cssText='display:flex;align-items:center;gap:6px';
  const netDot=document.createElement('span');
  netDot.style.cssText='width:7px;height:7px;border-radius:50%;flex-shrink:0;background:'+(data.online?'#22d98a':'#ff4560');
  const netTxt=document.createElement('span');
  netTxt.style.cssText='font-size:12px;color:var(--text2);font-family:var(--font-m,monospace)';
  netTxt.textContent=(data.network||'?').toUpperCase()+(data.speed?' · '+data.speed+'M':'');
  netBlock.appendChild(netDot);netBlock.appendChild(netTxt);
  row.appendChild(netBlock);

  container.appendChild(row);
}

// ── Sphere object ──────────────────────────────────────────────
window.YM_S[SPHERE_ID]={
  name:'Status',
  icon:'📡',
  category:'Tools',
  description:'Battery level and network status widget. Draggable between pages.',

  activate(ctx){
    _ctx=ctx;
    _buildWidget();
    getBattery().then(bat=>{
      if(!bat)return;
      _battery=bat;
      bat.addEventListener('levelchange',()=>_refreshWidget());
      bat.addEventListener('chargingchange',()=>_refreshWidget());
      _refreshWidget();
    }).catch(()=>{});
    _timer=setInterval(()=>_refreshWidget(),30000);
    window.addEventListener('online',()=>_refreshWidget());
    window.addEventListener('offline',()=>_refreshWidget());
    if(navigator.connection)navigator.connection.addEventListener('change',()=>_refreshWidget());
  },

  deactivate(){
    _ctx=null;
    clearInterval(_timer);_timer=null;
    window.removeEventListener('ym:page-change',_onPageChange);
    const el=document.getElementById(WIDGET_ID);if(el)el.remove();
    _widget=null;_battery=null;
  },

  renderPanel,
  broadcastData,
  profileSection,
  peerSection,
};
})();
