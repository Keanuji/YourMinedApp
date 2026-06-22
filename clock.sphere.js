/* clock.sphere.js — Clock & Alarm sphere for YourMine
   Live clock icon on desktop + alarm + timer + world clock
   Background alarm via Web Audio + Notification API
*/
(function(){
'use strict';
window.YM_S = window.YM_S || {};

const SPHERE_ID = 'clock.sphere.js';
const WIDGET_ID = 'clock';
const POS_KEY   = 'ym_clock_widget_pos';

let _ctx    = null;
let _timer  = null;
let _widget = null;
let _widgetEnabled = localStorage.getItem('clock_widget') !== 'false';
let _tab    = 'clock';

// ── État alarme sonnante ──────────────────────────────────────
let _ringingAlarm   = null;  // {id, label} de l'alarme qui sonne
let _ringingAudio   = null;  // AudioContext en cours
let _ringingGain    = null;
let _ringingOscs    = [];    // oscillateurs en cours
let _ringingTimeout = null;  // auto-stop après 60s

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function pad(n){return String(n).padStart(2,'0');}

// ── Time helpers ──────────────────────────────────────────────
function now(tz){
  if(tz){try{return new Date(new Date().toLocaleString('en-US',{timeZone:tz}));}catch{}}
  return new Date();
}
function timeStr(d,seconds=false){
  return pad(d.getHours())+':'+pad(d.getMinutes())+(seconds?':'+pad(d.getSeconds()):'');
}
function dateStr(d){
  return d.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
}

// ── Son d'alarme (Web Audio API) ──────────────────────────────
function _startAlarmSound(){
  try{
    if(_ringingAudio) return; // déjà en cours
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    _ringingAudio=ac;
    _ringingGain=ac.createGain();
    _ringingGain.gain.setValueAtTime(0.6,ac.currentTime);
    _ringingGain.connect(ac.destination);

    // Pattern : bip bip bip ... (150ms on, 150ms off) x3 puis pause 600ms, repeat
    let i=0;
    const pattern=[150,150,150,150,150,600]; // durées ms [on,off,on,off,on,pause]
    function nextBip(){
      if(!_ringingAudio)return;
      const isOn=i%2===0;
      if(isOn){
        const osc=ac.createOscillator();
        osc.type='sine';
        osc.frequency.setValueAtTime(880,ac.currentTime);
        osc.connect(_ringingGain);
        osc.start();
        _ringingOscs.push(osc);
        setTimeout(()=>{
          try{osc.stop();osc.disconnect();}catch{}
          _ringingOscs=_ringingOscs.filter(o=>o!==osc);
          i++;nextBip();
        },pattern[i%pattern.length]);
      }else{
        const dur=pattern[i%pattern.length];
        i++;
        if(i>=pattern.length)i=0;
        setTimeout(nextBip,dur);
      }
    }
    nextBip();
    // Auto-stop après 60s si personne ne stoppe
    _ringingTimeout=setTimeout(_stopAlarm,60000);
  }catch(e){console.warn('Alarm sound error:',e);}
}

function _stopAlarm(){
  if(_ringingTimeout){clearTimeout(_ringingTimeout);_ringingTimeout=null;}
  _ringingOscs.forEach(o=>{try{o.stop();o.disconnect();}catch{}});
  _ringingOscs=[];
  if(_ringingGain){try{_ringingGain.disconnect();}catch{}}
  _ringingGain=null;
  if(_ringingAudio){try{_ringingAudio.close();}catch{}}
  _ringingAudio=null;
  _ringingAlarm=null;
  // Fermer bannière si ouverte
  document.getElementById('ym-alarm-banner')?.remove();
}

// ── Bannière d'alarme dismissible ─────────────────────────────
function _showAlarmBanner(alarm){
  document.getElementById('ym-alarm-banner')?.remove();
  const banner=document.createElement('div');
  banner.id='ym-alarm-banner';
  banner.style.cssText=
    'position:fixed;top:0;left:0;right:0;z-index:99999;'+
    'background:linear-gradient(135deg,rgba(240,100,50,.97),rgba(200,60,20,.97));'+
    'color:#fff;display:flex;align-items:center;gap:12px;padding:14px 16px;'+
    'box-shadow:0 4px 24px rgba(0,0,0,.6);animation:ym-slide-down .25s ease';
  // Inject keyframe once
  if(!document.getElementById('ym-alarm-style')){
    const st=document.createElement('style');st.id='ym-alarm-style';
    st.textContent='@keyframes ym-slide-down{from{transform:translateY(-100%)}to{transform:translateY(0)}}';
    document.head.appendChild(st);
  }
  banner.innerHTML=
    '<span style="font-size:28px;flex-shrink:0">⏰</span>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:15px;font-weight:700;line-height:1.2">'+esc(alarm.label||'Alarm')+'</div>'+
      '<div style="font-size:11px;opacity:.8;margin-top:2px">'+esc(alarm.time)+'</div>'+
    '</div>'+
    '<button id="ym-alarm-stop" style="'+
      'background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);'+
      'color:#fff;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;'+
      'cursor:pointer;flex-shrink:0;letter-spacing:.5px'+
    '">STOP</button>';
  document.body.appendChild(banner);
  banner.querySelector('#ym-alarm-stop').addEventListener('click',()=>{
    _stopAlarm();
    // Re-render onglet alarm si panel ouvert
    const panel=document.getElementById('panel-sphere');
    if(panel&&panel.classList.contains('open')){
      const body=panel.querySelector('[data-clock-alarm-body]');
      if(body&&_lastContainer){renderPanel(_lastContainer);}
    }
  });
}

// ── Notification système (background) ────────────────────────
function _requestNotifPerm(){
  if('Notification' in window&&Notification.permission==='default'){
    Notification.requestPermission();
  }
}

function _sendSystemNotif(alarm){
  if(!('Notification' in window))return;
  if(Notification.permission!=='granted')return;
  const n=new Notification('⏰ '+esc(alarm.label||'Alarm'),{
    body:'Alarm set for '+alarm.time,
    icon:'/icon-192.png',
    tag:'ym-alarm-'+alarm.id,
    requireInteraction:true,  // reste affichée jusqu'au dismiss
    silent:false
  });
  n.addEventListener('click',()=>{
    window.focus();
    n.close();
  });
}

// ── Alarms ────────────────────────────────────────────────────
function loadAlarms(){try{return JSON.parse(localStorage.getItem('clock_alarms')||'[]');}catch{return[];}}
function saveAlarms(a){localStorage.setItem('clock_alarms',JSON.stringify(a));}

// Empêche de déclencher 2x la même alarme dans la même minute
let _lastFiredKey='';

function _checkAlarms(){
  const alarms=loadAlarms();
  const d=now();
  const currentTime=pad(d.getHours())+':'+pad(d.getMinutes());
  const currentSec=d.getSeconds();
  if(currentSec>5)return; // seulement dans les 5 premières secondes
  const fireKey=currentTime; // une fois par minute
  if(_lastFiredKey===fireKey)return;

  alarms.forEach(alarm=>{
    if(!alarm.active||alarm.time!==currentTime)return;
    _lastFiredKey=fireKey;
    _ringingAlarm={id:alarm.id,label:alarm.label,time:alarm.time};

    // 1. Son
    _startAlarmSound();
    // 2. Bannière visuelle (si app au premier plan)
    _showAlarmBanner(alarm);
    // 3. Notification système (si app en arrière-plan / écran verr.)
    _sendSystemNotif(alarm);
    // 4. Toast YourMine
    if(_ctx){_ctx.toast('⏰ '+alarm.label,'success');_ctx.setNotification(1);}
  });
}

// ── Timer ─────────────────────────────────────────────────────
let _timerRunning=false,_timerEnd=0,_timerDuration=0,_timerInterval=null;
function _timerStart(ms){
  _timerDuration=ms;_timerEnd=Date.now()+ms;_timerRunning=true;
  if(_timerInterval)clearInterval(_timerInterval);
  _timerInterval=setInterval(()=>{
    if(!_timerRunning)return;
    const left=_timerEnd-Date.now();
    if(left<=0){
      _timerRunning=false;clearInterval(_timerInterval);_timerInterval=null;
      if(_ctx)_ctx.toast('⏰ Timer done!','success');
      if(_ctx)_ctx.setNotification(1);
      _renderTimerPanel&&_renderTimerPanel();
    }
  },500);
}

// ── World clocks ──────────────────────────────────────────────
const DEFAULT_ZONES=[
  {label:'New York',  tz:'America/New_York'},
  {label:'London',    tz:'Europe/London'},
  {label:'Paris',     tz:'Europe/Paris'},
  {label:'Tokyo',     tz:'Asia/Tokyo'},
  {label:'Dubai',     tz:'Asia/Dubai'},
  {label:'Sydney',    tz:'Australia/Sydney'},
];
function loadZones(){try{return JSON.parse(localStorage.getItem('clock_zones')||'null')||DEFAULT_ZONES.slice();}catch{return DEFAULT_ZONES.slice();}}
function saveZones(z){localStorage.setItem('clock_zones',JSON.stringify(z));}

// ── Widget ────────────────────────────────────────────────────
function _isPC(){return window.matchMedia('(hover:hover) and (pointer:fine)').matches;}
function _loadPos(){try{return JSON.parse(localStorage.getItem(POS_KEY)||'{}');}catch{return{};}}
function _savePos(p){localStorage.setItem(POS_KEY,JSON.stringify(p));}
function _registerPage(page){if(window.YM_Desk&&window.YM_Desk.registerWidgetPage)window.YM_Desk.registerWidgetPage(WIDGET_ID,page,POS_KEY);}
function _unregisterPage(){if(window.YM_Desk&&window.YM_Desk.unregisterWidget)window.YM_Desk.unregisterWidget(WIDGET_ID);}
const _onPageChange=()=>_syncWidgetPage();

function _syncWidgetPage(){
  if(!_widget||!document.body.contains(_widget)||_widget._dragging)return;
  let widgetPage=0;
  if(window.YM_Desk&&window.YM_Desk.registeredWidgetPage){
    const rp=window.YM_Desk.registeredWidgetPage(WIDGET_ID);
    if(rp!=null)widgetPage=rp;
    else widgetPage=_loadPos().page||0;
  }else{widgetPage=_loadPos().page||0;}
  const curPage=window._deskCurPage!=null?window._deskCurPage:0;
  _widget.style.transition='opacity .25s ease';
  _widget.style.opacity=curPage===widgetPage?'1':'0';
  _widget.style.pointerEvents=curPage===widgetPage?'all':'none';
}

function _getNavBounds(){
  const navBar=document.getElementById('nav-bar');
  if(!navBar)return{maxRight:window.innerWidth,maxBottom:window.innerHeight};
  const r=navBar.getBoundingClientRect();
  if(_isPC())return{maxRight:r.left,maxBottom:window.innerHeight};
  return{maxRight:window.innerWidth,maxBottom:r.top};
}
function _clampPos(wx,wy){
  const b=_getNavBounds();
  const ww=_widget?_widget.offsetWidth:160,wh=_widget?_widget.offsetHeight:60;
  return{x:Math.max(0,Math.min(b.maxRight-ww,wx)),y:Math.max(0,Math.min(b.maxBottom-wh,wy))};
}

function _refreshWidget(){
  if(!_widget)return;
  const d=now();
  const timeEl=_widget.querySelector('#cw-time');
  const dateEl=_widget.querySelector('#cw-date');
  if(timeEl)timeEl.textContent=timeStr(d,true);
  if(dateEl)dateEl.textContent=dateStr(d);
}

// ── Desktop icon ──────────────────────────────────────────────
function _updateIcon(){
  if(!_ctx||!_ctx.setIcon)return;
  const d=now();
  const h=d.getHours(),m=d.getMinutes();
  const timeLabel=pad(h)+':'+pad(m);
  const canvas=document.createElement('canvas');
  canvas.width=72;canvas.height=72;
  const ctx2=canvas.getContext('2d');
  ctx2.beginPath();ctx2.arc(36,36,33,0,Math.PI*2);
  ctx2.fillStyle='rgba(240,168,48,.12)';ctx2.fill();
  ctx2.strokeStyle='rgba(240,168,48,.6)';ctx2.lineWidth=2;ctx2.stroke();
  const hAngle=((h%12)+m/60)*Math.PI/6;
  const mAngle=(m/60)*Math.PI*2;
  ctx2.lineCap='round';
  ctx2.beginPath();ctx2.moveTo(36,36);
  ctx2.lineTo(36+Math.sin(hAngle)*15,36-Math.cos(hAngle)*15);
  ctx2.strokeStyle='#e4e6f4';ctx2.lineWidth=3;ctx2.stroke();
  ctx2.beginPath();ctx2.moveTo(36,36);
  ctx2.lineTo(36+Math.sin(mAngle)*22,36-Math.cos(mAngle)*22);
  ctx2.strokeStyle='#e4e6f4';ctx2.lineWidth=2;ctx2.stroke();
  ctx2.beginPath();ctx2.arc(36,36,3,0,Math.PI*2);
  ctx2.fillStyle='#f0a830';ctx2.fill();
  ctx2.font='bold 11px monospace';
  ctx2.fillStyle='rgba(240,168,48,.9)';
  ctx2.textAlign='center';ctx2.textBaseline='middle';
  ctx2.fillText(timeLabel,36,62);
  const url=canvas.toDataURL();
  if(url&&url.length>100)_ctx.setIcon(url);
}

function _buildWidget(){
  if(!_widgetEnabled){_destroyWidget();return;}
  if(_widget&&document.body.contains(_widget)){_refreshWidget();_syncWidgetPage();return;}
  _widget=null;
  const spawnPage=window._deskCurPage||0;
  const pos=_loadPos();
  const targetPage=localStorage.getItem(POS_KEY)?(pos.page||0):spawnPage;
  _widget=document.createElement('div');
  _widget.id='ym-clock-widget';
  _widget.style.cssText=
    'position:fixed;z-index:250;'+
    'background:rgba(6,6,18,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);'+
    'border:1px solid rgba(255,255,255,.12);border-radius:14px;'+
    'padding:10px 14px;touch-action:none;user-select:none;-webkit-user-select:none;'+
    'display:flex;align-items:center;gap:12px;min-width:160px;'+
    'box-shadow:0 4px 24px rgba(0,0,0,.5);'+
    'right:'+(pos.right||12)+'px;bottom:'+(pos.bottom||96)+'px';
  const d=now();
  _widget.innerHTML=
    '<div style="flex:1;min-width:0">'+
      '<div id="cw-time" style="font-size:22px;font-weight:300;color:#e4e6f4;font-family:var(--font-m,monospace);letter-spacing:1px;line-height:1">'+timeStr(d,true)+'</div>'+
      '<div id="cw-date" style="font-size:9px;color:rgba(228,230,244,.4);margin-top:3px;font-family:var(--font-m,monospace)">'+dateStr(d)+'</div>'+
    '</div>'+
    '<button id="cw-open" style="background:none;border:none;color:rgba(228,230,244,.25);font-size:14px;cursor:pointer;padding:4px;flex-shrink:0;line-height:1" title="Open panel">⌵</button>';
  _widget.querySelector('#cw-open').addEventListener('click',()=>{
    if(window.YM&&window.YM.openSpherePanel)window.YM.openSpherePanel(SPHERE_ID);
  });
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
    const rawX=wx+(cx-ox),rawY=wy+(cy-oy);
    ox=cx;oy=cy;
    const c=_clampPos(rawX,rawY);wx=c.x;wy=c.y;
    _widget.style.left=wx+'px';_widget.style.top=wy+'px';
    _widget.style.right='';_widget.style.bottom='';
    const vw=_isPC()?window.innerWidth-72:window.innerWidth;
    const ew=vw*0.15,curPage=window._deskCurPage||0;
    if(cx<ew&&curPage>0){
      if(!_edgeT)_edgeT=setTimeout(()=>{_edgeT=null;const tp=curPage-1;window.YM_Desk?.goPage(tp);_registerPage(tp);_savePos(Object.assign({},_loadPos(),{page:tp}));},500);
    }else if(cx>vw-ew){
      if(!_edgeT)_edgeT=setTimeout(()=>{_edgeT=null;const tp=(window._deskCurPage||0)+1;window.YM_Desk?.goPageOrCreate(tp);_registerPage(tp);_savePos(Object.assign({},_loadPos(),{page:tp}));},500);
    }else{clearTimeout(_edgeT);_edgeT=null;}
  };
  const onEnd=()=>{
    if(!dragging)return;dragging=false;_widget._dragging=false;
    clearTimeout(_edgeT);_edgeT=null;
    const ww=_widget.offsetWidth,wh=_widget.offsetHeight;
    const r=Math.max(0,window.innerWidth-wx-ww),b=Math.max(0,window.innerHeight-wy-wh);
    const page=window._deskCurPage||0;
    _registerPage(page);_savePos({right:r,bottom:b,page});
    _syncWidgetPage();
    setTimeout(()=>window.YM_Desk?.autoCleanPages(),100);
  };
  _widget.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    dragging=true;_widget._dragging=true;
    const rect=_widget.getBoundingClientRect();
    wx=rect.left;wy=rect.top;
    _widget.style.left=wx+'px';_widget.style.top=wy+'px';
    _widget.style.right='';_widget.style.bottom='';
    ox=e.clientX;oy=e.clientY;
    e.preventDefault();_widget.setPointerCapture(e.pointerId);
  },{passive:false});
  _widget.addEventListener('pointermove',e=>{if(dragging)onMove(e.clientX,e.clientY);},{passive:false});
  _widget.addEventListener('pointerup',onEnd);
  _widget.addEventListener('pointercancel',onEnd);
}

function _destroyWidget(){
  window.removeEventListener('ym:page-change',_onPageChange);
  _unregisterPage();
  if(_widget&&document.body.contains(_widget))document.body.removeChild(_widget);
  _widget=null;
}

// ── Panel ─────────────────────────────────────────────────────
let _renderTimerPanel=null;
let _lastContainer=null;

function renderPanel(container){
  _lastContainer=container;
  container.innerHTML='';
  container.style.cssText='flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0';

  // Bannière alarme sonnante persistante en haut du panel
  if(_ringingAlarm){
    const ring=document.createElement('div');
    ring.style.cssText=
      'flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 14px;'+
      'background:linear-gradient(90deg,rgba(240,100,50,.2),rgba(240,100,50,.05));'+
      'border-bottom:1px solid rgba(240,100,50,.3)';
    ring.innerHTML=
      '<span style="font-size:20px;animation:ym-ring .4s ease infinite alternate">⏰</span>'+
      '<span style="flex:1;font-size:12px;font-weight:600;color:#f06432">'+esc(_ringingAlarm.label)+' — '+esc(_ringingAlarm.time)+'</span>'+
      '<button id="panel-alarm-stop" style="background:rgba(240,100,50,.2);border:1px solid rgba(240,100,50,.5);color:#f06432;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:700">STOP</button>';
    if(!document.getElementById('ym-ring-style')){
      const st=document.createElement('style');st.id='ym-ring-style';
      st.textContent='@keyframes ym-ring{from{transform:rotate(-12deg)}to{transform:rotate(12deg)}}';
      document.head.appendChild(st);
    }
    ring.querySelector('#panel-alarm-stop').addEventListener('click',()=>{_stopAlarm();renderPanel(container);});
    container.appendChild(ring);
  }

  // Widget toggle
  const wRow=document.createElement('div');
  wRow.style.cssText='display:flex;align-items:center;justify-content:flex-end;padding:5px 12px;border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0';
  const wBtn=document.createElement('button');
  wBtn.style.cssText='background:'+(_widgetEnabled?'rgba(240,168,48,.15)':'rgba(255,255,255,.06)')+';border:1px solid '+(_widgetEnabled?'rgba(240,168,48,.3)':'rgba(255,255,255,.1)')+';border-radius:6px;color:'+(_widgetEnabled?'var(--gold,#f0a830)':'rgba(228,230,244,.4)')+';font-size:9px;padding:3px 9px;cursor:pointer;font-family:var(--font-m,monospace)';
  wBtn.textContent=_widgetEnabled?'🪟 Widget on':'🪟 Widget off';
  wBtn.addEventListener('click',()=>{
    _widgetEnabled=!_widgetEnabled;
    localStorage.setItem('clock_widget',_widgetEnabled?'true':'false');
    if(_widgetEnabled)_buildWidget();
    else if(_widget&&document.body.contains(_widget)){_widget.remove();_widget=null;}
    renderPanel(container);
  });
  wRow.appendChild(wBtn);container.appendChild(wRow);

  // Tabs
  const tabs=document.createElement('div');
  tabs.style.cssText='display:flex;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;background:rgba(0,0,0,.2)';
  [{id:'clock',label:'🕐 Clock'},{id:'alarm',label:'⏰ Alarm'},{id:'timer',label:'⏱ Timer'},{id:'world',label:'🌍 World'}].forEach(t=>{
    const tab=document.createElement('div');
    tab.style.cssText='flex:1;padding:11px 4px 9px;text-align:center;font-size:9px;font-family:var(--font-m,monospace);cursor:pointer;transition:all .15s;border-top:2px solid '+(t.id===_tab?'var(--gold,#f0a830)':'transparent')+';color:'+(_tab===t.id?'var(--gold,#f0a830)':'rgba(255,255,255,.35)');
    tab.textContent=t.label;
    tab.addEventListener('click',()=>{_tab=t.id;renderPanel(container);});
    tabs.appendChild(tab);
  });
  container.appendChild(tabs);

  const body=document.createElement('div');
  body.style.cssText='flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:0';
  body.setAttribute('data-clock-alarm-body','1');
  container.appendChild(body);

  if(_tab==='clock')renderClockTab(body,container);
  else if(_tab==='alarm')renderAlarmTab(body,container);
  else if(_tab==='timer')renderTimerTab(body,container);
  else renderWorldTab(body,container);
}

function renderClockTab(body,container){
  const wrap=document.createElement('div');
  wrap.style.cssText='display:flex;flex-direction:column;align-items:center;padding:24px 16px';
  body.appendChild(wrap);
  const timeEl=document.createElement('div');
  timeEl.style.cssText='font-family:var(--font-m,monospace);font-size:64px;font-weight:200;color:var(--text,#e4e6f4);letter-spacing:2px;line-height:1;margin-bottom:8px;text-align:center';
  const dateEl=document.createElement('div');
  dateEl.style.cssText='font-size:13px;color:rgba(228,230,244,.45);font-family:var(--font-m,monospace);text-align:center;margin-bottom:24px';
  wrap.appendChild(timeEl);wrap.appendChild(dateEl);
  const canvas=document.createElement('canvas');
  canvas.width=200;canvas.height=200;
  canvas.style.cssText='width:160px;height:160px;margin-bottom:24px';
  wrap.appendChild(canvas);
  function drawClock(){
    const d=now();
    const ctx2=canvas.getContext('2d');
    const cx=100,cy=100,r=90;
    ctx2.clearRect(0,0,200,200);
    ctx2.beginPath();ctx2.arc(cx,cy,r,0,Math.PI*2);
    ctx2.fillStyle='rgba(255,255,255,.04)';ctx2.fill();
    ctx2.strokeStyle='rgba(255,255,255,.1)';ctx2.lineWidth=1.5;ctx2.stroke();
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6;
      const x1=cx+Math.sin(a)*(r-8),y1=cy-Math.cos(a)*(r-8);
      const x2=cx+Math.sin(a)*(r-16),y2=cy-Math.cos(a)*(r-16);
      ctx2.beginPath();ctx2.moveTo(x1,y1);ctx2.lineTo(x2,y2);
      ctx2.strokeStyle='rgba(255,255,255,.3)';ctx2.lineWidth=1.5;ctx2.stroke();
    }
    const h=d.getHours()%12,m=d.getMinutes(),s=d.getSeconds();
    const hAngle=(h+m/60)*Math.PI/6;
    const mAngle=(m+s/60)*Math.PI/30;
    const sAngle=s*Math.PI/30;
    ctx2.beginPath();ctx2.moveTo(cx,cy);ctx2.lineTo(cx+Math.sin(hAngle)*55,cy-Math.cos(hAngle)*55);
    ctx2.strokeStyle='#e4e6f4';ctx2.lineWidth=3;ctx2.lineCap='round';ctx2.stroke();
    ctx2.beginPath();ctx2.moveTo(cx,cy);ctx2.lineTo(cx+Math.sin(mAngle)*75,cy-Math.cos(mAngle)*75);
    ctx2.strokeStyle='#e4e6f4';ctx2.lineWidth=2;ctx2.lineCap='round';ctx2.stroke();
    ctx2.beginPath();ctx2.moveTo(cx,cy);ctx2.lineTo(cx+Math.sin(sAngle)*80,cy-Math.cos(sAngle)*80);
    ctx2.strokeStyle='var(--gold,#f0a830)';ctx2.lineWidth=1;ctx2.lineCap='round';ctx2.stroke();
    ctx2.beginPath();ctx2.arc(cx,cy,4,0,Math.PI*2);
    ctx2.fillStyle='var(--gold,#f0a830)';ctx2.fill();
    timeEl.textContent=timeStr(d,true);
    dateEl.textContent=dateStr(d);
  }
  drawClock();
  const iv=setInterval(drawClock,1000);
  const obs=new MutationObserver(()=>{if(!document.body.contains(canvas)){clearInterval(iv);obs.disconnect();}});
  obs.observe(document.body,{childList:true,subtree:true});
}

function renderAlarmTab(body,container){
  const alarms=loadAlarms();

  // Demande permission notif si pas encore accordée
  _requestNotifPerm();

  // Avertissement si notifications refusées
  if('Notification' in window&&Notification.permission==='denied'){
    const warn=document.createElement('div');
    warn.style.cssText='margin:10px 14px;padding:8px 10px;background:rgba(240,100,50,.1);border:1px solid rgba(240,100,50,.25);border-radius:6px;font-size:10px;color:rgba(240,130,80,.9);line-height:1.5';
    warn.textContent='⚠ Notifications blocked — alarms will only ring if the app is open.';
    body.appendChild(warn);
  }

  const form=document.createElement('div');
  form.style.cssText='padding:14px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;display:flex;gap:8px;align-items:center';
  form.innerHTML=
    '<input id="alarm-time" type="time" class="ym-input" style="flex:1;font-size:13px;font-family:var(--font-m,monospace)">'+
    '<input id="alarm-label" class="ym-input" placeholder="Label" style="flex:1;font-size:12px">'+
    '<button id="alarm-add" class="ym-btn ym-btn-accent" style="font-size:12px;padding:9px 14px;flex-shrink:0">+</button>';
  body.appendChild(form);

  form.querySelector('#alarm-add').addEventListener('click',()=>{
    const time=form.querySelector('#alarm-time').value;
    const label=form.querySelector('#alarm-label').value.trim()||'Alarm';
    if(!time){if(_ctx)_ctx.toast('Set a time first','warn');return;}
    const newAlarms=[...alarms,{id:Date.now(),time,label,active:true}];
    saveAlarms(newAlarms);
    renderPanel(container);
  });

  if(!alarms.length){
    const empty=document.createElement('div');
    empty.style.cssText='padding:32px;text-align:center;font-size:11px;color:rgba(228,230,244,.3);font-family:var(--font-m,monospace)';
    empty.textContent='No alarms set';
    body.appendChild(empty);return;
  }

  alarms.forEach(alarm=>{
    const isRinging=_ringingAlarm&&_ringingAlarm.id===alarm.id;
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.04)'+(isRinging?';background:rgba(240,100,50,.08)':'');
    row.innerHTML=
      '<div style="flex:1">'+
        '<div style="font-size:22px;font-family:var(--font-m,monospace);font-weight:300;color:'+(alarm.active?'var(--text,#e4e6f4)':'rgba(228,230,244,.3)')+(isRinging?';color:#f06432':'')+'">'+esc(alarm.time)+'</div>'+
        '<div style="font-size:10px;color:rgba(228,230,244,.4);margin-top:2px">'+esc(alarm.label)+(isRinging?' <span style="color:#f06432">● ringing</span>':'')+'</div>'+
      '</div>'+
      (isRinging
        ?'<button data-stop style="background:rgba(240,100,50,.2);border:1px solid rgba(240,100,50,.5);color:#f06432;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:700">STOP</button>'
        :'<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="al-'+alarm.id+'" '+(alarm.active?'checked':'')+' style="width:16px;height:16px;cursor:pointer"></label>')+
      '<button data-del="'+alarm.id+'" style="background:none;border:none;color:rgba(255,69,96,.4);font-size:16px;cursor:pointer;padding:4px">✕</button>';

    if(isRinging){
      row.querySelector('[data-stop]').addEventListener('click',()=>{_stopAlarm();renderPanel(container);});
    }else{
      row.querySelector('#al-'+alarm.id).addEventListener('change',e=>{
        const updated=loadAlarms().map(a=>a.id===alarm.id?{...a,active:e.target.checked}:a);
        saveAlarms(updated);
      });
    }
    row.querySelector('[data-del]').addEventListener('click',()=>{
      if(isRinging)_stopAlarm();
      saveAlarms(loadAlarms().filter(a=>a.id!==alarm.id));
      renderPanel(container);
    });
    body.appendChild(row);
  });
}

function renderTimerTab(body,container){
  _renderTimerPanel=()=>{if(document.body.contains(body)){body.innerHTML='';renderTimerTab(body,container);}};
  const wrap=document.createElement('div');
  wrap.style.cssText='padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:16px';
  body.appendChild(wrap);
  const left=_timerRunning?Math.max(0,_timerEnd-Date.now()):_timerDuration;
  const totalSec=Math.ceil(left/1000);
  const h=Math.floor(totalSec/3600),m=Math.floor((totalSec%3600)/60),s=totalSec%60;
  const display=document.createElement('div');
  display.style.cssText='font-family:var(--font-m,monospace);font-size:56px;font-weight:200;color:var(--text,#e4e6f4);letter-spacing:2px;text-align:center';
  display.textContent=pad(h)+':'+pad(m)+':'+pad(s);
  wrap.appendChild(display);
  if(_timerRunning){
    const iv=setInterval(()=>{
      if(!_timerRunning){clearInterval(iv);return;}
      const l=Math.max(0,_timerEnd-Date.now());
      const ts=Math.ceil(l/1000);
      const th=Math.floor(ts/3600),tm=Math.floor((ts%3600)/60),tsec=ts%60;
      display.textContent=pad(th)+':'+pad(tm)+':'+pad(tsec);
      if(l<=0)clearInterval(iv);
    },500);
  }
  const presets=document.createElement('div');
  presets.style.cssText='display:flex;gap:6px;flex-wrap:wrap;justify-content:center';
  [[1,'1m'],[5,'5m'],[10,'10m'],[15,'15m'],[25,'25m'],[30,'30m'],[60,'1h']].forEach(([min,label])=>{
    const btn=document.createElement('button');
    btn.className='ym-btn ym-btn-ghost';btn.style.cssText='font-size:11px;padding:6px 12px';
    btn.textContent=label;
    btn.addEventListener('click',()=>{_timerDuration=min*60*1000;_timerRunning=false;if(_timerInterval){clearInterval(_timerInterval);_timerInterval=null;}renderPanel(container);});
    presets.appendChild(btn);
  });
  wrap.appendChild(presets);
  const customRow=document.createElement('div');
  customRow.style.cssText='display:flex;gap:6px;align-items:center';
  customRow.innerHTML=
    '<input id="timer-h" type="number" min="0" max="23" placeholder="h" class="ym-input" style="width:60px;font-size:13px;text-align:center;font-family:var(--font-m,monospace)">'+
    '<span style="color:rgba(228,230,244,.4)">:</span>'+
    '<input id="timer-m" type="number" min="0" max="59" placeholder="m" class="ym-input" style="width:60px;font-size:13px;text-align:center;font-family:var(--font-m,monospace)">'+
    '<span style="color:rgba(228,230,244,.4)">:</span>'+
    '<input id="timer-s" type="number" min="0" max="59" placeholder="s" class="ym-input" style="width:60px;font-size:13px;text-align:center;font-family:var(--font-m,monospace)">';
  wrap.appendChild(customRow);
  const controls=document.createElement('div');
  controls.style.cssText='display:flex;gap:8px';
  if(_timerRunning){
    const stopBtn=document.createElement('button');
    stopBtn.className='ym-btn ym-btn-danger';stopBtn.textContent='⏹ Stop';
    stopBtn.addEventListener('click',()=>{_timerRunning=false;if(_timerInterval){clearInterval(_timerInterval);_timerInterval=null;}_timerDuration=0;renderPanel(container);});
    controls.appendChild(stopBtn);
  }else{
    const startBtn=document.createElement('button');
    startBtn.className='ym-btn ym-btn-accent';startBtn.style.cssText='font-size:13px;padding:12px 24px';startBtn.textContent='▶ Start';
    startBtn.addEventListener('click',()=>{
      const th=parseInt(customRow.querySelector('#timer-h').value)||0;
      const tm=parseInt(customRow.querySelector('#timer-m').value)||0;
      const ts=parseInt(customRow.querySelector('#timer-s').value)||0;
      const total=(th*3600+tm*60+ts)*1000||_timerDuration;
      if(!total){if(_ctx)_ctx.toast('Set a duration first','warn');return;}
      _timerStart(total);renderPanel(container);
    });
    controls.appendChild(startBtn);
    if(_timerDuration>0){
      const resetBtn=document.createElement('button');
      resetBtn.className='ym-btn ym-btn-ghost';resetBtn.textContent='↺ Reset';
      resetBtn.addEventListener('click',()=>{_timerDuration=0;renderPanel(container);});
      controls.appendChild(resetBtn);
    }
  }
  wrap.appendChild(controls);
}

function renderWorldTab(body,container){
  const zones=loadZones();
  const form=document.createElement('div');
  form.style.cssText='padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;gap:6px';
  form.innerHTML=
    '<input id="zone-label" class="ym-input" placeholder="City name" style="flex:1;font-size:11px">'+
    '<input id="zone-tz" class="ym-input" placeholder="Timezone (e.g. Asia/Seoul)" style="flex:2;font-size:11px">'+
    '<button id="zone-add" class="ym-btn ym-btn-ghost" style="font-size:12px;flex-shrink:0">+</button>';
  body.appendChild(form);
  form.querySelector('#zone-add').addEventListener('click',()=>{
    const label=form.querySelector('#zone-label').value.trim();
    const tz=form.querySelector('#zone-tz').value.trim();
    if(!label||!tz){if(_ctx)_ctx.toast('Enter city and timezone','warn');return;}
    const newZones=[...zones,{label,tz}];
    saveZones(newZones);renderPanel(container);
  });
  const list=document.createElement('div');
  body.appendChild(list);
  function updateTimes(){
    zones.forEach((z,i)=>{
      const timeEl=list.querySelector('#wc-time-'+i);
      const d=now(z.tz);
      if(timeEl)timeEl.textContent=timeStr(d,false);
    });
  }
  zones.forEach((z,i)=>{
    const d=now(z.tz);
    const localD=now();
    const diffH=Math.round((d.getTime()-localD.getTime())/3600000);
    const diffStr=diffH===0?'local':(diffH>0?'+'+diffH+'h':diffH+'h');
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.04)';
    row.innerHTML=
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:600;color:var(--text,#e4e6f4)">'+esc(z.label)+'</div>'+
        '<div style="font-size:9px;color:rgba(228,230,244,.3);font-family:var(--font-m,monospace)">'+esc(z.tz)+'</div>'+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0">'+
        '<div id="wc-time-'+i+'" style="font-size:20px;font-family:var(--font-m,monospace);font-weight:300;color:var(--text,#e4e6f4)">'+timeStr(d,false)+'</div>'+
        '<div style="font-size:9px;color:rgba(228,230,244,.3)">'+diffStr+'</div>'+
      '</div>'+
      '<button data-del-zone="'+i+'" style="background:none;border:none;color:rgba(255,69,96,.3);font-size:14px;cursor:pointer;padding:4px">✕</button>';
    row.querySelector('[data-del-zone]').addEventListener('click',()=>{
      zones.splice(i,1);saveZones(zones);renderPanel(container);
    });
    list.appendChild(row);
  });
  updateTimes();
  const iv=setInterval(updateTimes,1000);
  const obs=new MutationObserver(()=>{if(!document.body.contains(list)){clearInterval(iv);obs.disconnect();}});
  obs.observe(document.body,{childList:true,subtree:true});
}

// ── broadcastData ──────────────────────────────────────────────
function broadcastData(){
  const d=now();
  return{time:timeStr(d,false),tz:Intl.DateTimeFormat().resolvedOptions().timeZone||''};
}

// ── Sphere object ──────────────────────────────────────────────
window.YM_S[SPHERE_ID]={
  name:'Clock',
  icon:'🕐',
  category:'Tools',
  description:'Live clock, alarms, timer and world clock. Alarms ring with sound + system notification.',

  activate(ctx){
    _ctx=ctx;
    _buildWidget();
    _updateIcon();
    _requestNotifPerm();
    _timer=setInterval(()=>{
      _updateIcon();
      _refreshWidget();
      _checkAlarms();
    },1000);
    // Re-check quand l'app revient au premier plan (arrière-plan PWA)
    document.addEventListener('visibilitychange',_onVisibility);
  },

  deactivate(){
    if(_timer){clearInterval(_timer);_timer=null;}
    if(_timerInterval){clearInterval(_timerInterval);_timerInterval=null;}
    _destroyWidget();
    document.removeEventListener('visibilitychange',_onVisibility);
    _ctx=null;
  },

  renderPanel,
  broadcastData,

  profileSection(container){
    const d=now();
    container.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:22px">🕐</span>'+
        '<div>'+
          '<div style="font-size:16px;font-weight:600;font-family:var(--font-m,monospace);color:var(--text,#e4e6f4)" id="ps-clock-time">'+timeStr(d,false)+'</div>'+
          '<div style="font-size:10px;color:rgba(228,230,244,.4)">'+esc(Intl.DateTimeFormat().resolvedOptions().timeZone||'')+'</div>'+
        '</div>'+
      '</div>';
    const iv=setInterval(()=>{
      const el=container.querySelector('#ps-clock-time');
      if(!el){clearInterval(iv);return;}
      el.textContent=timeStr(now(),false);
    },1000);
  },

  peerSection(container,peerCtx){
    const profile=peerCtx&&peerCtx.profile;
    const bd=profile&&profile.broadcastData;
    const clock=bd&&bd['clock.sphere.js'];
    const tz=(clock&&clock.tz)||(profile&&profile.tz)||'';
    if(!tz&&(!clock||!clock.time)){
      container.innerHTML='<div style="font-size:10px;color:rgba(228,230,244,.3)">No time data</div>';
      return;
    }
    if(tz){
      const d=now(tz);
      container.innerHTML=
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<span style="font-size:22px">🕐</span>'+
          '<div>'+
            '<div id="peer-clock-time" style="font-size:20px;font-weight:300;font-family:var(--font-m,monospace);color:var(--text,#e4e6f4);letter-spacing:1px">'+timeStr(d,false)+'</div>'+
            '<div style="font-size:9px;color:rgba(228,230,244,.3);margin-top:2px">'+esc(tz)+'</div>'+
          '</div>'+
        '</div>';
      const iv=setInterval(()=>{
        const el=container.querySelector('#peer-clock-time');
        if(!el){clearInterval(iv);return;}
        el.textContent=timeStr(now(tz),false);
      },1000);
      const obs=new MutationObserver(()=>{
        if(!document.body.contains(container)){clearInterval(iv);obs.disconnect();}
      });
      obs.observe(document.body,{childList:true,subtree:true});
    }else{
      container.innerHTML=
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<span style="font-size:22px">🕐</span>'+
          '<div>'+
            '<div style="font-size:20px;font-weight:300;font-family:var(--font-m,monospace);color:var(--text,#e4e6f4)">'+esc(clock.time)+'</div>'+
            '<div style="font-size:9px;color:rgba(228,230,244,.3);margin-top:2px">last seen</div>'+
          '</div>'+
        '</div>';
    }
  },
};

// Quand app revient au premier plan : vérifier alarmes manquées
function _onVisibility(){
  if(document.visibilityState==='visible'){
    _lastFiredKey=''; // reset pour permettre un re-check
    _checkAlarms();
  }
}

})();
