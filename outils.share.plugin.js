/**
 * Autopartage — YourMine plugin
 * Conversations privées conducteur ↔ chaque passager.
 * Modèle: trip.convs = { [passengerUuid]: [{uuid,name,text,ts}] }
 */
const plugin = {
  icon: '🚗',
  description: 'Covoiturage pair-à-pair entre utilisateurs proches',

  _key: 'ym_plugin_autopartage',
  _save(d) { try { localStorage.setItem(this._key, JSON.stringify(d)); } catch(e) {} },
  _load()  { try { return JSON.parse(localStorage.getItem(this._key) || 'null'); } catch(e) { return null; } },

  _cfg: null,
  _trips: [],
  _YM: null,
  _container: null,
  _broadcastTimer: null,
  _view: null,  // null=list, {tripId, passengerUuid}=open conversation

  render(container, YM) {
    this._YM = YM;
    this._container = container;
    const saved = this._load() || {};
    this._cfg   = saved.cfg   || null;
    this._trips = saved.trips || [];
    this._view  = null;
    container.style.cssText = 'font-family:inherit;padding:0;display:flex;flex-direction:column;height:100%;';
    if (YM.onHub) {
      YM.onHub(data => {
        if (data && data.autopartage) this._mergeTrip(data.autopartage);
      });
    }
    this._renderMain();
  },

  _mergeTrip(incoming) {
    const idx = this._trips.findIndex(t => t.id === incoming.id);
    if (idx >= 0) {
      const ex = this._trips[idx];
      const merged = Object.assign({}, ex.convs || {});
      Object.entries(incoming.convs || {}).forEach(function(entry) {
        const pUuid = entry[0];
        const msgs  = entry[1];
        const existing = merged[pUuid] || [];
        const seen = new Set(existing.map(function(m) { return m.uuid + m.ts; }));
        const fresh = msgs.filter(function(m) { return !seen.has(m.uuid + m.ts); });
        merged[pUuid] = existing.concat(fresh).sort(function(a,b) { return a.ts - b.ts; });
      });
      Object.assign(ex, {
        destination: incoming.destination,
        seats:       incoming.seats,
        driverPhoto: incoming.driverPhoto,
        driverName:  incoming.driverName,
        convs:       merged,
      });
    } else {
      this._trips.unshift(incoming);
    }
    this._persist();
    if (this._container && this._container.isConnected) {
      if (this._view && this._view.tripId === incoming.id) {
        this._renderConv(this._view.tripId, this._view.passengerUuid);
      } else if (!this._view) {
        this._renderMain();
      }
    }
  },

  _persist() { this._save({ cfg: this._cfg, trips: this._trips }); },

  _renderMain() {
    this._view = null;
    const c = this._container;
    c.innerHTML = '';
    const bar = el('div', 'ap-bar');
    bar.append(el('div', 'ap-title', '🚗 Autopartage'), btn('⚙', 'ap-cfg-btn', () => this._renderConfig()));
    c.appendChild(bar);

    const myUuid = (this._YM.profile && this._YM.profile.uuid) || 'local';
    const myRole = this._cfg && this._cfg.role;

    if (!myRole) {
      c.appendChild(el('div', 'ap-hint', 'Configure ton rôle via ⚙ pour participer.'));
      c.appendChild(styleBlock());
      return;
    }

    if (myRole === 'driver') {
      const myTrip = this._trips.find(function(t) { return t.id === 'trip-' + myUuid; });
      if (!myTrip) {
        c.appendChild(el('div', 'ap-hint', 'Sauvegarde ta config pour publier ton trajet.'));
      } else {
        const info = el('div', 'ap-trip-info');
        info.innerHTML = '📍 <strong>' + esc(myTrip.destination || '?') + '</strong> · 💺 ' + (myTrip.seats||1) + ' place(s)';
        c.appendChild(info);
        const convs = myTrip.convs || {};
        const pUuids = Object.keys(convs);
        c.appendChild(el('div', 'ap-section-label', pUuids.length ? 'Conversations (' + pUuids.length + ')' : 'En attente de messages…'));
        if (pUuids.length === 0) {
          c.appendChild(el('div', 'ap-empty', 'Aucun passager ne t\'a encore écrit.'));
        } else {
          const self = this;
          pUuids.forEach(function(pUuid) {
            const msgs = convs[pUuid] || [];
            const last = msgs[msgs.length - 1];
            const near = self._YM.nearPeers && self._YM.nearPeers.find(function(e) { return e.uuid === pUuid; });
            const pName  = (near && near.profile && near.profile.name) || (last && last.uuid !== myUuid && last.name) || 'Passager';
            const pPhoto = (near && near.profile && near.profile.photo) || '';
            c.appendChild(self._convRow(pUuid, pName, pPhoto, last, myUuid, function() {
              self._renderConv(myTrip.id, pUuid);
            }));
          });
        }
      }
    } else {
      // passenger
      const self = this;
      const drivers = this._trips.filter(function(t) { return t.role === 'driver'; });
      c.appendChild(el('div', 'ap-section-label', 'Conducteurs disponibles'));
      if (drivers.length === 0) {
        c.appendChild(el('div', 'ap-empty', 'Aucun conducteur pour l\'instant.'));
      } else {
        drivers.forEach(function(trip) {
          const myConv = (trip.convs && trip.convs[myUuid]) || [];
          const last = myConv[myConv.length - 1];
          c.appendChild(self._driverRow(trip, last, myUuid, function() {
            self._renderConv(trip.id, myUuid);
          }));
        });
      }
    }

    clearInterval(this._broadcastTimer);
    this._broadcastMyTrip();
    const self = this;
    this._broadcastTimer = setInterval(function() {
      if (self._container && self._container.isConnected) self._broadcastMyTrip();
      else clearInterval(self._broadcastTimer);
    }, 15000);

    c.appendChild(styleBlock());
  },

  _convRow(pUuid, pName, pPhoto, lastMsg, myUuid, onclick) {
    const row = el('div', 'ap-conv-row');
    row.style.cursor = 'pointer';
    const avatar = el('div', 'ap-avatar');
    if (pPhoto) {
      const img = document.createElement('img');
      img.src = pPhoto; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      avatar.appendChild(img);
    } else { avatar.textContent = (pName||'?')[0].toUpperCase(); }
    const body = el('div', 'ap-conv-row-body');
    body.appendChild(el('div', 'ap-conv-row-name', esc(pName)));
    if (lastMsg) {
      body.appendChild(el('div', 'ap-conv-row-preview', (lastMsg.uuid === myUuid ? 'Toi: ' : '') + esc(lastMsg.text).slice(0,50)));
    }
    row.append(avatar, body, el('div', 'ap-conv-row-arrow', '›'));
    row.onclick = onclick;
    return row;
  },

  _driverRow(trip, lastMsg, myUuid, onclick) {
    const row = el('div', 'ap-conv-row');
    row.style.cursor = 'pointer';
    const avatar = el('div', 'ap-avatar');
    if (trip.driverPhoto) {
      const img = document.createElement('img');
      img.src = trip.driverPhoto; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      avatar.appendChild(img);
    } else { avatar.textContent = (trip.driverName||'?')[0].toUpperCase(); }
    const body = el('div', 'ap-conv-row-body');
    body.appendChild(el('div', 'ap-conv-row-name', esc(trip.driverName || 'Anonyme')));
    body.appendChild(el('div', 'ap-conv-row-preview', '📍 ' + esc(trip.destination||'?') + ' · 💺 ' + (trip.seats||'?')));
    if (lastMsg) body.appendChild(el('div', 'ap-conv-row-preview', (lastMsg.uuid === myUuid ? 'Toi: ' : '') + esc(lastMsg.text).slice(0,40)));
    row.append(avatar, body, el('div', 'ap-conv-row-arrow', '›'));
    row.onclick = onclick;
    return row;
  },

  _renderConv(tripId, passengerUuid) {
    this._view = { tripId: tripId, passengerUuid: passengerUuid };
    const c = this._container;
    c.innerHTML = '';
    const myUuid = (this._YM.profile && this._YM.profile.uuid) || 'local';
    const myName = (this._YM.profile && this._YM.profile.name) || 'Anonyme';
    const trip = this._trips.find(function(t) { return t.id === tripId; });
    if (!trip) { this._renderMain(); return; }

    const isDriver = myUuid === trip.driverUuid;
    var otherUuid, otherName, otherPhoto;
    if (isDriver) {
      otherUuid = passengerUuid;
      const near = this._YM.nearPeers && this._YM.nearPeers.find(function(e) { return e.uuid === passengerUuid; });
      const msgs = (trip.convs && trip.convs[passengerUuid]) || [];
      const firstFromOther = msgs.find(function(m) { return m.uuid !== myUuid; });
      otherName  = (near && near.profile && near.profile.name) || (firstFromOther && firstFromOther.name) || 'Passager';
      otherPhoto = (near && near.profile && near.profile.photo) || '';
    } else {
      otherUuid  = trip.driverUuid;
      otherName  = trip.driverName || 'Conducteur';
      otherPhoto = trip.driverPhoto || '';
    }

    // Header bar
    const bar = el('div', 'ap-conv-bar');
    const self = this;
    bar.appendChild(btn('←', 'ap-back-btn', function() { self._renderMain(); }));
    const head = el('div', 'ap-conv-head');
    head.style.cursor = 'pointer';
    head.onclick = function() {
      const near = self._YM.nearPeers && self._YM.nearPeers.find(function(e) { return e.uuid === otherUuid; });
      if (self._YM.openProfile) self._YM.openProfile(otherUuid,
        (near && near.profile) || { name: otherName, photo: otherPhoto, networks: [], plugins: [] },
        near || null);
    };
    const avatarSm = el('div', 'ap-avatar-sm');
    if (otherPhoto) {
      const img = document.createElement('img');
      img.src = otherPhoto; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      avatarSm.appendChild(img);
    } else { avatarSm.textContent = (otherName||'?')[0].toUpperCase(); }
    const headInfo = el('div', 'ap-conv-head-info');
    headInfo.appendChild(el('div', 'ap-conv-head-name', esc(otherName)));
    headInfo.appendChild(el('div', 'ap-conv-head-sub',
      isDriver ? '👤 Passager' : '📍 ' + esc(trip.destination||'?') + ' · 💺 ' + (trip.seats||'?')));
    head.append(avatarSm, headInfo);
    bar.appendChild(head);
    c.appendChild(bar);

    // Messages area
    const convWrap = el('div', 'ap-conv-wrap');
    const renderMsgs = function() {
      convWrap.innerHTML = '';
      const msgs = (trip.convs && trip.convs[passengerUuid]) || [];
      if (msgs.length === 0) {
        convWrap.appendChild(el('div', 'ap-no-msg', 'Pas encore de messages. Dis bonjour !'));
      } else {
        msgs.forEach(function(m) {
          const row = el('div', 'ap-msg' + (m.uuid === myUuid ? ' ap-msg-me' : ''));
          row.innerHTML = '<span class="ap-msg-name">' + esc(m.name) + '</span><span class="ap-msg-text">' + esc(m.text) + '</span>';
          convWrap.appendChild(row);
        });
        convWrap.scrollTop = convWrap.scrollHeight;
      }
    };
    renderMsgs();
    c.appendChild(convWrap);

    // Input
    const inputRow = el('div', 'ap-input-row');
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'Message…'; input.className = 'ap-input';
    const sendFn = function() {
      const txt = input.value.trim(); if (!txt) return;
      if (!trip.convs) trip.convs = {};
      if (!trip.convs[passengerUuid]) trip.convs[passengerUuid] = [];
      trip.convs[passengerUuid].push({ uuid: myUuid, name: myName, text: txt, ts: Date.now() });
      self._persist();
      self._broadcastTrip(trip);
      input.value = '';
      renderMsgs();
      input.focus();
    };
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendFn(); });
    inputRow.append(input, btn('↑', 'ap-send-btn', sendFn));
    c.appendChild(inputRow);
    c.appendChild(styleBlock());
  },

  _renderConfig() {
    const c = this._container;
    c.innerHTML = '';
    const cfg = Object.assign({ role: 'passenger', destination: '', seats: 2, photo: '' }, this._cfg || {});
    const wrap = el('div', 'ap-config-wrap');
    const self = this;

    wrap.appendChild(btn('← Retour', 'ap-back-btn', function() { self._renderMain(); }));
    wrap.appendChild(el('div', 'ap-config-title', 'Configuration'));

    // Role
    const roleGroup = el('div', 'ap-field-group');
    roleGroup.appendChild(el('label', 'ap-label', 'Rôle'));
    const roleRow = el('div', 'ap-role-row');
    const seatsGroup = el('div', 'ap-field-group');
    seatsGroup.style.display = cfg.role === 'driver' ? '' : 'none';
    const mkRole = function(val, label) {
      const b = btn(label, 'ap-role-btn' + (cfg.role === val ? ' active' : ''), function() {
        cfg.role = val;
        wrap.querySelectorAll('.ap-role-btn').forEach(function(x) { x.classList.remove('active'); });
        b.classList.add('active');
        seatsGroup.style.display = val === 'driver' ? '' : 'none';
      });
      return b;
    };
    roleRow.append(mkRole('driver', '🧑‍✈️ Conducteur'), mkRole('passenger', '🙋 Conduit'));
    roleGroup.appendChild(roleRow);
    wrap.appendChild(roleGroup);

    // Destination
    const destGroup = el('div', 'ap-field-group');
    destGroup.appendChild(el('label', 'ap-label', 'Destination'));
    const destInput = document.createElement('input');
    destInput.type = 'text'; destInput.className = 'ap-field-input';
    destInput.placeholder = 'Ex: Gare de Lyon'; destInput.value = cfg.destination || '';
    destGroup.appendChild(destInput);
    wrap.appendChild(destGroup);

    // Seats
    seatsGroup.appendChild(el('label', 'ap-label', 'Places disponibles'));
    const seatsInput = document.createElement('input');
    seatsInput.type = 'number'; seatsInput.className = 'ap-field-input';
    seatsInput.min = 1; seatsInput.max = 8; seatsInput.value = cfg.seats || 2;
    seatsGroup.appendChild(seatsInput);
    wrap.appendChild(seatsGroup);

    // Photo
    const photoGroup = el('div', 'ap-field-group');
    photoGroup.appendChild(el('label', 'ap-label', 'Photo (optionnel)'));
    const photoRow = el('div', 'ap-photo-row');
    const photoPreview = el('div', 'ap-photo-preview');
    const showPreview = function(src) {
      photoPreview.innerHTML = '';
      if (src) {
        const img = document.createElement('img');
        img.src = src; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
        photoPreview.appendChild(img);
      } else { photoPreview.textContent = '👤'; }
    };
    showPreview(cfg.photo);
    const photoInput = document.createElement('input');
    photoInput.type = 'file'; photoInput.accept = 'image/*'; photoInput.style.display = 'none';
    photoInput.onchange = function() {
      const file = photoInput.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          canvas.width = 80; canvas.height = 80;
          canvas.getContext('2d').drawImage(img, 0, 0, 80, 80);
          cfg.photo = canvas.toDataURL('image/jpeg', 0.75);
          showPreview(cfg.photo);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    photoRow.append(photoPreview, btn('Choisir photo', 'ap-upload-btn', function() { photoInput.click(); }), photoInput);
    photoGroup.appendChild(photoRow);
    wrap.appendChild(photoGroup);

    // Save
    wrap.appendChild(btn('Enregistrer', 'ap-save-btn', function() {
      cfg.destination = destInput.value.trim();
      cfg.seats = parseInt(seatsInput.value) || 2;
      self._cfg = cfg;
      const myUuid = (self._YM.profile && self._YM.profile.uuid) || 'local';
      const existing = self._trips.find(function(t) { return t.id === 'trip-' + myUuid; });
      const myTrip = existing || { id: 'trip-' + myUuid, convs: {} };
      Object.assign(myTrip, {
        role:        cfg.role,
        driverUuid:  myUuid,
        driverName:  (self._YM.profile && self._YM.profile.name) || 'Anonyme',
        driverPhoto: cfg.photo || (self._YM.profile && (self._YM.profile.photoHub || self._YM.profile.photo)) || '',
        destination: cfg.destination,
        seats:       cfg.seats,
        timestamp:   Date.now(),
      });
      if (!myTrip.convs) myTrip.convs = {};
      if (!existing) self._trips.unshift(myTrip);
      self._persist();
      self._broadcastMyTrip();
      self._renderMain();
    }));

    c.append(wrap, styleBlock());
  },

  _broadcastMyTrip() {
    if (!this._cfg) return;
    const myUuid = (this._YM.profile && this._YM.profile.uuid) || 'local';
    const t = this._trips.find(function(t) { return t.id === 'trip-' + myUuid; });
    if (t) this._broadcastTrip(t);
  },

  _broadcastTrip(trip) {
    try { this._YM.broadcast({ autopartage: trip }); } catch(e) {}
  },
};

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
function btn(label, cls, onclick) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = label;
  b.addEventListener('click', onclick);
  return b;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const _STYLE_ID = 'ap-styles';
function styleBlock() {
  if (document.getElementById(_STYLE_ID)) return document.createComment('ap-styles-ok');
  const s = document.createElement('style');
  s.id = _STYLE_ID;
  s.textContent = `
  .ap-bar { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 8px; flex-shrink:0; }
  .ap-title { font-size:1.1rem; font-weight:700; }
  .ap-cfg-btn { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14); border-radius:20px; padding:6px 14px; font-size:.82rem; cursor:pointer; color:inherit; }
  .ap-hint { padding:16px; font-size:.84rem; color:rgba(255,255,255,.45); font-style:italic; }
  .ap-section-label { padding:6px 16px 4px; font-size:.7rem; text-transform:uppercase; letter-spacing:.07em; color:rgba(255,255,255,.4); flex-shrink:0; }
  .ap-empty { padding:20px 16px; text-align:center; color:rgba(255,255,255,.35); font-size:.85rem; }
  .ap-trip-info { padding:8px 16px 4px; font-size:.84rem; color:rgba(255,255,255,.6); flex-shrink:0; }
  .ap-conv-row { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid rgba(255,255,255,.06); cursor:pointer; }
  .ap-conv-row:hover { background:rgba(255,255,255,.04); }
  .ap-avatar { width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0; overflow:hidden; }
  .ap-conv-row-body { flex:1; min-width:0; }
  .ap-conv-row-name { font-weight:600; font-size:.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ap-conv-row-preview { font-size:.78rem; color:rgba(255,255,255,.45); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .ap-conv-row-arrow { color:rgba(255,255,255,.3); font-size:1.4rem; flex-shrink:0; }
  .ap-conv-bar { display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0; }
  .ap-back-btn { background:none; border:none; color:rgba(255,255,255,.6); cursor:pointer; font-size:1.1rem; padding:0 6px; flex-shrink:0; }
  .ap-conv-head { display:flex; align-items:center; gap:10px; flex:1; min-width:0; cursor:pointer; }
  .ap-avatar-sm { width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; font-size:1rem; flex-shrink:0; overflow:hidden; }
  .ap-conv-head-info { min-width:0; }
  .ap-conv-head-name { font-weight:600; font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ap-conv-head-sub { font-size:.74rem; color:rgba(255,255,255,.5); }
  .ap-conv-wrap { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:8px; min-height:0; }
  .ap-no-msg { font-size:.8rem; color:rgba(255,255,255,.3); text-align:center; padding:20px 0; }
  .ap-msg { display:flex; flex-direction:column; align-self:flex-start; max-width:78%; }
  .ap-msg-me { align-self:flex-end; align-items:flex-end; }
  .ap-msg-name { font-size:.67rem; color:rgba(255,255,255,.4); margin-bottom:2px; }
  .ap-msg-text { background:rgba(255,255,255,.1); border-radius:14px; padding:7px 12px; font-size:.84rem; line-height:1.4; }
  .ap-msg-me .ap-msg-text { background:rgba(99,179,237,.28); }
  .ap-input-row { display:flex; gap:8px; padding:8px 12px 14px; border-top:1px solid rgba(255,255,255,.07); flex-shrink:0; }
  .ap-input { flex:1; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); border-radius:22px; padding:8px 16px; font-size:.84rem; color:inherit; outline:none; }
  .ap-input:focus { border-color:rgba(99,179,237,.5); }
  .ap-send-btn { background:rgba(99,179,237,.2); border:1px solid rgba(99,179,237,.4); border-radius:22px; padding:8px 16px; font-size:.84rem; cursor:pointer; color:inherit; }
  .ap-send-btn:hover { background:rgba(99,179,237,.35); }
  .ap-config-wrap { padding:12px 16px 24px; display:flex; flex-direction:column; gap:14px; overflow-y:auto; }
  .ap-config-title { font-size:1rem; font-weight:700; text-align:center; }
  .ap-field-group { display:flex; flex-direction:column; gap:6px; }
  .ap-label { font-size:.75rem; color:rgba(255,255,255,.5); text-transform:uppercase; letter-spacing:.05em; }
  .ap-field-input { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:9px 13px; font-size:.88rem; color:inherit; outline:none; width:100%; box-sizing:border-box; }
  .ap-field-input:focus { border-color:rgba(99,179,237,.5); }
  .ap-role-row { display:flex; gap:8px; }
  .ap-role-btn { flex:1; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:10px; cursor:pointer; font-size:.88rem; color:inherit; }
  .ap-role-btn.active { background:rgba(99,179,237,.2); border-color:rgba(99,179,237,.5); }
  .ap-photo-row { display:flex; align-items:center; gap:12px; }
  .ap-photo-preview { width:52px; height:52px; border-radius:50%; background:rgba(255,255,255,.1); display:flex; align-items:center; justify-content:center; font-size:1.5rem; overflow:hidden; flex-shrink:0; }
  .ap-upload-btn { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:8px 14px; font-size:.82rem; cursor:pointer; color:inherit; }
  .ap-save-btn { background:rgba(99,179,237,.25); border:1px solid rgba(99,179,237,.45); border-radius:12px; padding:12px; font-size:.92rem; font-weight:600; cursor:pointer; color:inherit; width:100%; }
  .ap-save-btn:hover { background:rgba(99,179,237,.4); }
  `;
  return s;
}
