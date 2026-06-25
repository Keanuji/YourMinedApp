/* jshint esversion:11, browser:true */
// radio.sphere.js — YourMine Radio
(function(){
'use strict';
window.YM_S = window.YM_S || {};

const WIDGET_ID  = 'radio';
const STATE_KEY  = 'ym_radio_state_v1';
const CUSTOM_KEY = 'ym_radio_custom_v1';
const POS_KEY    = 'ym_radio_pos_v1';

const BUILTIN = [
  {name:'FIP',             url:'https://icecast.radiofrance.fr/fip-midfi.mp3',           genre:'Eclectic',       country:'🇫🇷'},
  {name:'FIP Rock',        url:'https://icecast.radiofrance.fr/fiprock-midfi.mp3',       genre:'Rock',           country:'🇫🇷'},
  {name:'FIP Jazz',        url:'https://icecast.radiofrance.fr/fipjazz-midfi.mp3',       genre:'Jazz',           country:'🇫🇷'},
  {name:'FIP Groove',      url:'https://icecast.radiofrance.fr/fipgroove-midfi.mp3',     genre:'Groove',         country:'🇫🇷'},
  {name:'FIP Monde',       url:'https://icecast.radiofrance.fr/fipworld-midfi.mp3',      genre:'World',          country:'🇫🇷'},
  {name:'FIP Nouveautés',  url:'https://icecast.radiofrance.fr/fipnouveautes-midfi.mp3', genre:'New Music',      country:'🇫🇷'},
  {name:'FIP Electro',     url:'https://icecast.radiofrance.fr/fipelectro-midfi.mp3',    genre:'Electro',        country:'🇫🇷'},
  {name:'France Inter',    url:'https://icecast.radiofrance.fr/franceinter-midfi.mp3',   genre:'Talk/Music',     country:'🇫🇷'},
  {name:'France Info',     url:'https://icecast.radiofrance.fr/franceinfo-midfi.mp3',    genre:'News',           country:'🇫🇷'},
  {name:'France Culture',  url:'https://icecast.radiofrance.fr/franceculture-midfi.mp3', genre:'Culture',        country:'🇫🇷'},
  {name:'France Musique',  url:'https://icecast.radiofrance.fr/francemusique-midfi.mp3', genre:'Classical',      country:'🇫🇷'},
  {name:"Mouv'",           url:'https://icecast.radiofrance.fr/mouv-midfi.mp3',          genre:'Hip-Hop',        country:'🇫🇷'},
  {name:'Nova',            url:'https://novazz.ice.infomaniak.ch/novazz-128.mp3',        genre:'Jazz/Soul',      country:'🇫🇷'},
  {name:'TSF Jazz',        url:'https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3',     genre:'Jazz',           country:'🇫🇷'},
  {name:'NRJ',             url:'https://scdn.nrjaudio.fm/adwstream/fr/00001/mp3_128.mp3',genre:'Pop/Dance',      country:'🇫🇷'},
  {name:'Skyrock',         url:'https://icecast.skyrock.net/s/natio_mp3_128k',           genre:'Hip-Hop',        country:'🇫🇷'},
  {name:'BBC Radio 1',     url:'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one',    genre:'Pop/Chart',      country:'🇬🇧'},
  {name:'BBC Radio 2',     url:'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_two',    genre:'Easy Listening', country:'🇬🇧'},
  {name:'BBC Radio 3',     url:'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_three',  genre:'Classical',      country:'🇬🇧'},
  {name:'BBC Radio 4',     url:'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_four_fm',genre:'Talk',           country:'🇬🇧'},
  {name:'BBC 6 Music',     url:'https://stream.live.vc.bbcmedia.co.uk/bbc_6music',       genre:'Alternative',    country:'🇬🇧'},
  {name:'BBC World',       url:'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',genre:'News',           country:'🇬🇧'},
  {name:'NPR News',        url:'https://npr-ice.streamguys1.com/live.mp3',               genre:'News/Talk',      country:'🇺🇸'},
  {name:'KCRW',            url:'https://kcrw.streamguys1.com/kcrw_192k_mp3_on_air',      genre:'Indie/World',    country:'🇺🇸'},
  {name:'KEXP',            url:'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',       genre:'Indie/Alt',      country:'🇺🇸'},
  {name:'WBGO Jazz',       url:'https://wbgo.streamguys1.com/wbgo128.mp3',               genre:'Jazz',           country:'🇺🇸'},
  {name:'Deutschlandfunk', url:'https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3',genre:'Culture/Talk',   country:'🇩🇪'},
  {name:'SWR3',            url:'https://liveradio.swr.de/sw282p3/swr3/play.mp3',         genre:'Pop/Rock',       country:'🇩🇪'},
  {name:'Antena 1',        url:'https://streaming.rtp.pt/live/a1/a1.aac',                genre:'Talk/Music',     country:'🇵🇹'},
  {name:'Antena 3',        url:'https://streaming.rtp.pt/live/a3/a3.aac',                genre:'Rock/Alt',       country:'🇵🇹'},
  {name:'NPO Radio 1',     url:'https://icecast.omroep.nl/radio1-bb-mp3',                genre:'News/Talk',      country:'🇳🇱'},
  {name:'SR P3',           url:'https://sverigesradio.se/topsy/direkt/164-hi.mp3',       genre:'Pop/Alt',        country:'🇸🇪'},
  {name:'Groove Salad',    url:'https://ice6.somafm.com/groovesalad-128-mp3',            genre:'Ambient',        country:'🌐'},
  {name:'Drone Zone',      url:'https://ice6.somafm.com/dronezone-128-mp3',              genre:'Drone',          country:'🌐'},
  {name:'Lush',            url:'https://ice6.somafm.com/lush-128-mp3',                   genre:'Indie Pop',      country:'🌐'},
  {name:'Nightwave Plaza', url:'https://radio.plaza.one/mp3',                            genre:'Vaporwave',      country:'🌐'},
  {name:'Radio Paradise',  url:'https://stream.radioparadise.com/aac-320',               genre:'Eclectic',       country:'🌐'},
  {name:'Lofi Hip-Hop',    url:'https://streams.ilovemusic.de/iloveradio17.mp3',         genre:'Lofi',           country:'🌐'},
  {name:'Chillhop',        url:'https://streams.ilovemusic.de/iloveradio18.mp3',         genre:'Chillhop',       country:'🌐'},
  {name:'Di.fm Chillout',  url:'https://prem2.di.fm/chillout?listen_key=public3',        genre:'Chillout',       country:'🌐'},
  {name:'Di.fm Trance',    url:'https://prem2.di.fm/trance?listen_key=public3',          genre:'Trance',         country:'🌐'},
  {name:'Di.fm House',     url:'https://prem2.di.fm/house?listen_key=public3',           genre:'House',          country:'🌐'},
];

let _ctx=null, _audio=null, _playing=false, _curStation=null, _widget=null, _vol=0.8;
let _widgetEnabled=localStorage.getItem('radio_widget')!=='false';

const BLANK_ARTWORK='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function loadState(){try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}');}catch(e){return{};}}
function saveState(d){localStorage.setItem(STATE_KEY,JSON.stringify(d));}
function loadCustom(){try{return JSON.parse(localStorage.getItem(CUSTOM_KEY)||'[]');}catch(e){return[];}}
function saveCustom(d){localStorage.setItem(CUSTOM_KEY,JSON.stringify(d));}
function loadPos(){try{return JSON.parse(localStorage.getItem(POS_KEY)||'{"right":12,"bottom":90,"page":0}');}catch(e){return{right:12,bottom:90,page:0};}}
function savePos(p){localStorage.setItem(POS_KEY,JSON.stringify(p));}
function allStations(){return [...BUILTIN,...loadCustom()];}
// Station par défaut si aucune sauvegardée : FIP
function defaultStation(){return BUILTIN[0];}

const _isPC=()=>window.matchMedia('(hover:hover) and (pointer:fine)').matches;

function _getNavBounds(){
  const navBar=document.getElementById('nav-bar');
  if(!navBar)return{maxRight:window.innerWidth,maxBottom:window.innerHeight};
  const r=navBar.getBoundingClientRect();
  if(_isPC())return{maxRight:r.left,maxBottom:window.innerHeight};
  return{maxRight:window.innerWidth,maxBottom:r.top};
}
function _clampPos(wx,wy){
  const bounds=_getNavBounds();
  const ww=_widget?_widget.offsetWidth:200;
  const wh=_widget?_widget.offsetHeight:90;
  return{x:Math.max(0,Math.min(bounds.maxRight-ww,wx)),y:Math.max(0,Math.min(bounds.maxBottom-wh,wy))};
}

function getAudio(){
  if(!_audio){
    _audio=document.getElementById('ym-radio-audio');
    if(!_audio){_audio=document.createElement('audio');_audio.id='ym-radio-audio';_audio.style.display='none';document.body.appendChild(_audio);}
  }
  return _audio;
}

function play(station){
  _curStation=station;
  const a=getAudio();a.src=station.url;a.volume=_vol;
  a.play().catch(e=>{if(window.YM_toast)window.YM_toast('Stream error: '+e.message,'error');});
  _playing=true;
  saveState({station,vol:_vol,playing:true});
  _updateMediaSession();_refreshWidget();_refreshPanel();
  // Broadcaster aux pairs via ctx
  if(_ctx&&_ctx.send){try{_ctx.send('radio:now',{station:station.name,genre:station.genre,country:station.country});}catch(e){}}
}

function stop(){
  const a=getAudio();a.pause();a.src='';
  _playing=false;
  saveState(Object.assign({},loadState(),{playing:false}));
  _updateMediaSession();_refreshWidget();_refreshPanel();
  if(_ctx&&_ctx.send){try{_ctx.send('radio:now',{station:null});}catch(e){}}
}

function toggle(){if(_playing)stop();else if(_curStation)play(_curStation);}
function nextStation(){const all=allStations();const idx=_curStation?all.findIndex(s=>s.url===_curStation.url):-1;play(all[(idx+1)%all.length]);}
function prevStation(){const all=allStations();const idx=_curStation?all.findIndex(s=>s.url===_curStation.url):-1;play(all[(idx-1+all.length)%all.length]);}

function _updateMediaSession(){
  if(!('mediaSession' in navigator))return;
  navigator.mediaSession.metadata=new MediaMetadata({
    title:_curStation&&_curStation.name||'Radio',
    artist:_curStation&&_curStation.genre||'',
    album:'YourMine Radio',
    artwork:[{src:BLANK_ARTWORK,sizes:'1x1',type:'image/png'}]
  });
  navigator.mediaSession.playbackState=_playing?'playing':'paused';
  navigator.mediaSession.setActionHandler('play',()=>{if(!_playing&&_curStation)play(_curStation);});
  navigator.mediaSession.setActionHandler('pause',()=>{if(_playing)stop();});
  navigator.mediaSession.setActionHandler('nexttrack',nextStation);
  navigator.mediaSession.setActionHandler('previoustrack',prevStation);
}

let _panelRefresh=null;
function _refreshPanel(){if(_panelRefresh)_panelRefresh();}

function _registerPage(page){
  if(window.YM_Desk&&window.YM_Desk.registerWidgetPage)window.YM_Desk.registerWidgetPage(WIDGET_ID,page,POS_KEY);
}
function _unregisterPage(){
  if(window.YM_Desk&&window.YM_Desk.unregisterWidget)window.YM_Desk.unregisterWidget(WIDGET_ID);
}

function createWidget(){
  if(!_widgetEnabled){if(_widget&&document.body.contains(_widget)){_widget.remove();_widget=null;}return;}
  if(_widget&&document.body.contains(_widget)){_refreshWidget();_syncWidgetPage();return;}
  _widget=null;

  const spawnPage=window._deskCurPage||0;
  const pos=loadPos();
  const targetPage=localStorage.getItem(POS_KEY)?(pos.page||0):spawnPage;

  _widget=document.createElement('div');
  _widget.id='ym-radio-widget';
  _widget.style.cssText=
    'position:fixed;z-index:250;'+
    'background:rgba(8,8,15,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);'+
    'border:1px solid rgba(232,160,32,.35);border-radius:14px;overflow:hidden;'+
    'box-shadow:0 4px 24px rgba(0,0,0,.7);'+
    'touch-action:none;user-select:none;-webkit-user-select:none;'+
    'right:'+pos.right+'px;bottom:'+pos.bottom+'px;width:200px';
  _refreshWidget();
  document.body.appendChild(_widget);

  requestAnimationFrame(()=>{
    if(!_widget)return;
    const rect=_widget.getBoundingClientRect();
    const clamped=_clampPos(rect.left,rect.top);
    if(clamped.x!==rect.left||clamped.y!==rect.top){
      _widget.style.left=clamped.x+'px';_widget.style.top=clamped.y+'px';
      _widget.style.right='';_widget.style.bottom='';
    }
  });

  _registerPage(targetPage);
  _syncWidgetPage();

  if(!localStorage.getItem(POS_KEY)){
    const navH=window.YM_Desk&&window.YM_Desk.safeBottom||90;
    savePos({right:12,bottom:navH+14,page:targetPage});
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
      if(!_edgeT)_edgeT=setTimeout(()=>{_edgeT=null;const tp=curPage-1;if(window.YM_Desk)window.YM_Desk.goPage(tp);_registerPage(tp);const p=loadPos();savePos(Object.assign({},p,{page:tp}));},500);
    }else if(cx>vw-ew){
      if(!_edgeT)_edgeT=setTimeout(()=>{_edgeT=null;const tp=(window._deskCurPage||0)+1;if(window.YM_Desk)window.YM_Desk.goPageOrCreate(tp);_registerPage(tp);const p=loadPos();savePos(Object.assign({},p,{page:tp}));},500);
    }else{clearTimeout(_edgeT);_edgeT=null;}
  };

  const onEnd=()=>{
    if(!dragging)return;dragging=false;_widget._dragging=false;
    clearTimeout(_edgeT);_edgeT=null;
    const ww=_widget.offsetWidth,wh=_widget.offsetHeight;
    const r=Math.max(0,window.innerWidth-wx-ww),b=Math.max(0,window.innerHeight-wy-wh);
    const curPage=window._deskCurPage||0;
    _registerPage(curPage);savePos({right:r,bottom:b,page:curPage});
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
    e.preventDefault();_widget.setPointerCapture(e.pointerId);
  },{passive:false});
  _widget.addEventListener('pointermove',e=>{if(dragging)onMove(e.clientX,e.clientY);},{passive:false});
  _widget.addEventListener('pointerup',onEnd);
  _widget.addEventListener('pointercancel',onEnd);
}

const _onPageChange=()=>_syncWidgetPage();

function _syncWidgetPage(){
  if(!_widget)return;
  if(!document.body.contains(_widget)){_widget=null;createWidget();return;}
  if(_widget._dragging)return;
  let widgetPage=0;
  if(window.YM_Desk&&window.YM_Desk.registeredWidgetPage){
    const rp=window.YM_Desk.registeredWidgetPage(WIDGET_ID);
    if(rp!=null)widgetPage=rp;
    else widgetPage=loadPos().page||0;
  }else{widgetPage=loadPos().page||0;}
  const curPage=window._deskCurPage!=null?window._deskCurPage:0;
  const visible=curPage===widgetPage;
  _widget.style.transition='opacity .25s ease';
  _widget.style.opacity=visible?'1':'0';
  _widget.style.pointerEvents=visible?'all':'none';
}

function _refreshWidget(){
  if(!_widget)return;
  const name=(_curStation&&_curStation.name)||'No station';
  const genre=(_curStation&&_curStation.genre)||'';
  _widget.innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:grab">'+
      '<span style="font-size:16px">📻</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:11px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+name+'</div>'+
        '<div style="font-size:9px;color:'+(_playing?'var(--gold)':'var(--text3)')+'">'+(_playing?'▶ ON AIR — '+genre:'⏹ stopped')+'</div>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;align-items:center;justify-content:space-around;padding:4px 8px 8px;gap:4px">'+
      '<button id="rw-prev" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:4px;line-height:1">⏮</button>'+
      '<button id="rw-pp" style="background:var(--gold);border:none;color:#000;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center">'+(_playing?'⏸':'▶')+'</button>'+
      '<button id="rw-next" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:4px;line-height:1">⏭</button>'+
      '<button id="rw-open" style="background:none;border:none;color:rgba(232,160,32,.5);font-size:12px;cursor:pointer;padding:4px;line-height:1">⬡</button>'+
    '</div>';
  _widget.querySelector('#rw-prev').addEventListener('click',e=>{e.stopPropagation();prevStation();});
  _widget.querySelector('#rw-pp').addEventListener('click',e=>{e.stopPropagation();toggle();});
  _widget.querySelector('#rw-next').addEventListener('click',e=>{e.stopPropagation();nextStation();});
  _widget.querySelector('#rw-open').addEventListener('click',e=>{e.stopPropagation();if(window.YM)window.YM.openSpherePanel('radio.sphere.js');});
}

function removeWidget(){
  if(_widget){window.removeEventListener('ym:page-change',_onPageChange);_widget.remove();_widget=null;}
  _unregisterPage();
}

// ── broadcastData — écoute live partagée avec les pairs ───────
function broadcastData(){
  return{
    station: _playing&&_curStation?_curStation.name:null,
    genre:   _playing&&_curStation?_curStation.genre:null,
    country: _playing&&_curStation?_curStation.country:null,
    playing: _playing,
  };
}

// ── renderPanel ────────────────────────────────────────────────
function renderPanel(container){
  container.style.cssText='display:flex;flex-direction:column;height:100%';
  container.innerHTML='';
  _panelRefresh=()=>renderPanel(container);

  // Widget toggle
  const wRow=document.createElement('div');
  wRow.style.cssText='display:flex;align-items:center;justify-content:flex-end;padding:5px 12px;border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0';
  const wBtn=document.createElement('button');
  wBtn.style.cssText='background:'+(_widgetEnabled?'rgba(240,168,48,.15)':'rgba(255,255,255,.06)')+';border:1px solid '+(_widgetEnabled?'rgba(240,168,48,.3)':'rgba(255,255,255,.1)')+';border-radius:6px;color:'+(_widgetEnabled?'var(--gold,#f0a830)':'rgba(228,230,244,.4)')+';font-size:9px;padding:3px 9px;cursor:pointer;font-family:var(--font-m,monospace)';
  wBtn.textContent=_widgetEnabled?'🪟 Widget on':'🪟 Widget off';
  wBtn.addEventListener('click',()=>{
    _widgetEnabled=!_widgetEnabled;
    localStorage.setItem('radio_widget',_widgetEnabled?'true':'false');
    if(_widgetEnabled)createWidget();
    else if(_widget&&document.body.contains(_widget)){_widget.remove();_widget=null;}
    renderPanel(container);
  });
  wRow.appendChild(wBtn);container.appendChild(wRow);

  const nowEl=document.createElement('div');
  nowEl.style.cssText='flex-shrink:0;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.06);text-align:center';
  container.appendChild(nowEl);

  const volEl=document.createElement('div');
  volEl.style.cssText='flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06)';
  volEl.innerHTML=
    '<span style="font-size:13px">🔊</span>'+
    '<input type="range" id="rad-vol" min="0" max="1" step="0.05" value="'+_vol+'" style="flex:1;accent-color:var(--gold)">'+
    '<span id="rad-vol-lbl" style="font-size:11px;color:var(--text3);min-width:28px">'+Math.round(_vol*100)+'%</span>';
  container.appendChild(volEl);
  volEl.querySelector('#rad-vol').addEventListener('input',e=>{
    _vol=parseFloat(e.target.value);
    volEl.querySelector('#rad-vol-lbl').textContent=Math.round(_vol*100)+'%';
    if(_audio)_audio.volume=_vol;
    saveState(Object.assign({},loadState(),{vol:_vol}));
  });

  const list=document.createElement('div');list.style.cssText='flex:1;overflow-y:auto';
  container.appendChild(list);

  const addEl=document.createElement('div');
  addEl.style.cssText='flex-shrink:0;padding:10px 16px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:6px';
  addEl.innerHTML=
    '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Custom station</div>'+
    '<div style="display:flex;gap:6px">'+
      '<input id="rad-cname" class="ym-input" placeholder="Name" style="flex:1;font-size:11px">'+
      '<input id="rad-curl" class="ym-input" placeholder="Stream URL" style="flex:2;font-size:11px">'+
      '<button id="rad-cadd" class="ym-btn ym-btn-ghost" style="font-size:11px">Add</button>'+
    '</div>';
  container.appendChild(addEl);
  addEl.querySelector('#rad-cadd').addEventListener('click',()=>{
    const n=addEl.querySelector('#rad-cname').value.trim();
    const u=addEl.querySelector('#rad-curl').value.trim();
    if(!n||!u){if(window.YM_toast)window.YM_toast('Name and URL required','warn');return;}
    const c=loadCustom();c.push({name:n,url:u,genre:'Custom',country:'🌐'});saveCustom(c);
    addEl.querySelector('#rad-cname').value='';addEl.querySelector('#rad-curl').value='';
    renderStations();
  });

  function renderNow(){
    // ── Si aucune station connue → auto-sélectionner la station par défaut ──
    if(!_curStation){
      const def=defaultStation();
      _curStation=def;
      play(def); // démarre directement
      return; // renderNow sera rappelé via _refreshPanel → _panelRefresh
    }
    const n=_curStation.name;
    const g=_curStation.genre||'';
    nowEl.innerHTML=
      '<div style="font-size:10px;color:var(--text3);margin-bottom:4px;font-family:var(--font-m,monospace)">'+(_playing?'▶ NOW PLAYING':'PAUSED')+'</div>'+
      '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:2px">'+n+'</div>'+
      (g?'<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+g+'</div>':'<div style="height:8px"></div>')+
      '<div style="display:flex;justify-content:center;align-items:center;gap:12px">'+
        '<button id="pnl-prev" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">⏮</button>'+
        '<button id="pnl-pp" class="ym-btn '+(_playing?'ym-btn-ghost':'ym-btn-accent')+'" style="font-size:14px;padding:6px 20px;min-width:90px">'+(_playing?'⏸ Pause':'▶ Play')+'</button>'+
        '<button id="pnl-next" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">⏭</button>'+
      '</div>';
    nowEl.querySelector('#pnl-prev').addEventListener('click',()=>{prevStation();});
    nowEl.querySelector('#pnl-pp').addEventListener('click',()=>{toggle();});
    nowEl.querySelector('#pnl-next').addEventListener('click',()=>{nextStation();});
  }

  function renderStations(){
    list.innerHTML='';
    const countries=[...new Set(allStations().map(s=>s.country||'🌐'))];
    const activeCo=list._activeCo||'All';
    const coBar=document.createElement('div');
    coBar.style.cssText='display:flex;gap:4px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.06)';
    ['All',...countries].forEach(co=>{
      const b=document.createElement('button');
      b.className='ym-btn ym-btn-ghost';
      b.style.cssText='font-size:11px;padding:2px 8px'+(co===activeCo?';background:var(--gold);color:#000':'');
      b.textContent=co;
      b.addEventListener('click',()=>{list._activeCo=co;renderStations();});
      coBar.appendChild(b);
    });
    list.appendChild(coBar);
    const stations=allStations().filter(s=>activeCo==='All'||(s.country||'🌐')===activeCo);
    stations.forEach((s,i)=>{
      const isActive=_curStation&&_curStation.url===s.url;
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)'+(isActive?';background:rgba(232,160,32,.07)':'');
      row.innerHTML=
        '<div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:'+(isActive&&_playing?'var(--gold)':'rgba(255,255,255,.15)')+'"></div>'+
        '<span style="font-size:14px;flex-shrink:0">'+(s.country||'🌐')+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:'+(isActive?600:400)+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+s.name+'</div>'+
          (s.genre?'<div style="font-size:10px;color:var(--text3)">'+s.genre+'</div>':'')+
        '</div>'+
        (i>=BUILTIN.length?'<button data-del="'+(i-BUILTIN.length)+'" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:15px;padding:2px 6px">×</button>':'');
      row.addEventListener('click',e=>{
        if(e.target.dataset.del!==undefined)return;
        const scrollY=list.scrollTop;
        if(isActive)toggle();else play(s);
        requestAnimationFrame(()=>{list.scrollTop=scrollY;});
      });
      const delBtn=row.querySelector('[data-del]');
      if(delBtn){delBtn.addEventListener('click',e=>{
        e.stopPropagation();
        const c=loadCustom();c.splice(parseInt(e.target.dataset.del),1);saveCustom(c);renderStations();
      });}
      list.appendChild(row);
    });
    // Scroller jusqu'à la station active
    if(_curStation){
      const activeIdx=stations.findIndex(s=>s.url===_curStation.url);
      if(activeIdx>0){
        requestAnimationFrame(()=>{
          const rows=list.querySelectorAll('[style*="border-bottom"]');
          // ~54px par row, +coBar
          list.scrollTop=Math.max(0,(activeIdx-2)*54);
        });
      }
    }
  }

  renderNow();
  renderStations();
}

// ── profileSection — dans ton propre profil ────────────────────
function profileSection(container){
  function render(){
    container.innerHTML='';
    const n=(_curStation&&_curStation.name)||'—';
    const g=(_curStation&&_curStation.genre)||'';
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;align-items:center;gap:10px';
    // Dot animé si en lecture
    const dot=document.createElement('span');
    dot.style.cssText='width:8px;height:8px;border-radius:50%;flex-shrink:0;background:'+(_playing?'var(--gold,#f0a830)':'rgba(255,255,255,.2)')+';'+ (_playing?'animation:ym-pulse 1s ease infinite':'');
    const info=document.createElement('div');
    info.style.cssText='flex:1;min-width:0';
    const nameEl=document.createElement('div');
    nameEl.style.cssText='font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameEl.textContent=n;
    const genreEl=document.createElement('div');
    genreEl.style.cssText='font-size:10px;color:var(--text3)';
    genreEl.textContent=_playing?'▶ ON AIR'+(g?' — '+g:''):'⏹ '+g;
    info.appendChild(nameEl);info.appendChild(genreEl);
    const ppBtn=document.createElement('button');
    ppBtn.className='ym-btn ym-btn-ghost';
    ppBtn.style.cssText='font-size:11px;padding:4px 10px;flex-shrink:0';
    ppBtn.textContent=_playing?'⏸':'▶';
    ppBtn.addEventListener('click',()=>{
      if(!_curStation){play(defaultStation());return;}
      toggle();render();
    });
    const nxBtn=document.createElement('button');
    nxBtn.className='ym-btn ym-btn-ghost';
    nxBtn.style.cssText='font-size:11px;padding:4px 8px;flex-shrink:0';
    nxBtn.textContent='⏭';
    nxBtn.addEventListener('click',()=>{nextStation();render();});
    wrap.appendChild(dot);wrap.appendChild(info);wrap.appendChild(ppBtn);wrap.appendChild(nxBtn);
    container.appendChild(wrap);
  }
  render();
  // Listener pour mise à jour si état change depuis widget
  const _obs=new MutationObserver(()=>{if(!document.body.contains(container))_obs.disconnect();});
  _obs.observe(document.body,{childList:true,subtree:true});
}

// ── peerSection — écoute live du pair ─────────────────────────
function peerSection(container,peerCtx){
  container.innerHTML='';
  const bd=peerCtx&&peerCtx.profile&&peerCtx.profile.broadcastData;
  const data=bd&&bd['radio.sphere.js'];

  const wrap=document.createElement('div');
  wrap.style.cssText='display:flex;align-items:center;gap:10px';

  if(!data||!data.station){
    // Pas en écoute
    const dot=document.createElement('span');
    dot.style.cssText='width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.15);flex-shrink:0';
    const txt=document.createElement('span');
    txt.style.cssText='font-size:12px;color:var(--text3)';
    txt.textContent='Not listening';
    wrap.appendChild(dot);wrap.appendChild(txt);
  }else{
    // En écoute — afficher station + bouton "Écouter aussi"
    const dot=document.createElement('span');
    dot.style.cssText='width:8px;height:8px;border-radius:50%;background:var(--gold,#f0a830);flex-shrink:0;animation:ym-pulse 1s ease infinite';
    const info=document.createElement('div');
    info.style.cssText='flex:1;min-width:0';
    const nameEl=document.createElement('div');
    nameEl.style.cssText='font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameEl.textContent='▶ '+data.station;
    const genreEl=document.createElement('div');
    genreEl.style.cssText='font-size:10px;color:var(--text3)';
    genreEl.textContent=(data.country?data.country+' ':'')+(data.genre||'');
    info.appendChild(nameEl);info.appendChild(genreEl);

    // Bouton "Listen too" — trouve la station dans la liste et la joue
    const listenBtn=document.createElement('button');
    listenBtn.className='ym-btn ym-btn-ghost';
    listenBtn.style.cssText='font-size:11px;padding:4px 10px;flex-shrink:0;border-color:rgba(240,168,48,.3);color:var(--gold,#f0a830)';
    listenBtn.textContent='Listen too';
    listenBtn.addEventListener('click',()=>{
      // Chercher la station par nom dans la liste
      const found=allStations().find(s=>s.name===data.station);
      if(found){
        play(found);
        listenBtn.textContent='▶ Playing';
        listenBtn.disabled=true;
        // Ouvrir le panel radio
        if(window.YM&&window.YM.openSpherePanel)window.YM.openSpherePanel('radio.sphere.js');
      }else{
        if(window.YM_toast)window.YM_toast('Station not found locally','warn');
      }
    });

    wrap.appendChild(dot);wrap.appendChild(info);wrap.appendChild(listenBtn);
  }
  container.appendChild(wrap);
}

// ── Sphere object ──────────────────────────────────────────────
window.YM_S['radio.sphere.js']={
  name:'Radio',icon:'📻',category:'Media',
  description:'Internet radio — background playback, live sharing, draggable widget',
  emit:['radio:now'],receive:[],

  activate(ctx){
    _ctx=ctx;
    if(!document.getElementById('ym-radio-css')){
      const s=document.createElement('style');s.id='ym-radio-css';
      s.textContent='@keyframes ym-pulse{0%,100%{opacity:1}50%{opacity:.4}}';
      document.head.appendChild(s);
    }
    const st=loadState();
    _vol=st.vol||0.8;
    // ── Ouvrir sur une écoute — restaurer la dernière station ──
    // Si une station est sauvegardée → la sélectionner
    // Si elle était en lecture → reprendre automatiquement
    // Si rien → prendre la station par défaut mais ne pas auto-play (nécessite geste utilisateur)
    if(st.station){
      _curStation=st.station;
      if(st.playing){
        // Reprendre la lecture (la page était déjà en cours)
        play(st.station);
      }
      // Sinon : station sélectionnée mais pas auto-play (pas de geste user)
    }else{
      // Première utilisation : pré-sélectionner FIP sans auto-play
      _curStation=defaultStation();
    }
    createWidget();
    document._ymRadioVisHandler=()=>{
      if(document.visibilityState==='visible'){
        if(_widget&&!document.body.contains(_widget))_widget=null;
        if(!_widget)createWidget();
        else{_refreshWidget();_syncWidgetPage();}
      }
    };
    document.addEventListener('visibilitychange',document._ymRadioVisHandler);
  },

  deactivate(){
    stop();removeWidget();_panelRefresh=null;
    const audioEl=document.getElementById('ym-radio-audio');if(audioEl)audioEl.remove();
    _audio=null;_ctx=null;
    if(document._ymRadioVisHandler){
      document.removeEventListener('visibilitychange',document._ymRadioVisHandler);
      document._ymRadioVisHandler=null;
    }
  },

  renderPanel,
  broadcastData,
  profileSection,
  peerSection,
};
})();
