// Player inventory and locker UI
const PlayerInventory = (() => {
  const player = {};
  const locker = {};
  const equipped = {};
  let uiPlayer = null;
  let uiLocker = null;
  let _closingPlayer = false;
  let _closingLocker = false;

  function setLockerInventory(items) {
    for (const k in locker) delete locker[k];
    if (!items) return;
    for (const id in items) locker[id] = { item: items[id].item, count: items[id].count };
    renderLocker();
  }

  function addToPlayer(it, count=1) {
    const id = it.id || (it.name && it.name.toLowerCase()) || Math.random().toString(36).slice(2);
    if (!player[id]) player[id] = { item: it, count: 0 };
    player[id].count += count;
    // keep legacy global inventory in sync
    try {
      const wid = it.id || id;
      if (!window.inventory) window.inventory = {};
      if (!window.inventory[wid]) window.inventory[wid] = { item: it, count: 0 };
      window.inventory[wid].count = (window.inventory[wid].count || 0) + count;
    } catch (e) {}
    renderPlayer();
  }

  function addToLocker(it, count=1) {
    const id = it.id || (it.name && it.name.toLowerCase()) || Math.random().toString(36).slice(2);
    if (!locker[id]) locker[id] = { item: it, count: 0 };
    locker[id].count += count;
    renderLocker();
  }

  function transferToPlayer(id) {
    if (!locker[id]) return;
    addToPlayer(locker[id].item, 1);
    locker[id].count -= 1;
    if (locker[id].count <= 0) delete locker[id];
    renderLocker();
    renderPlayer();
  }

  function transferToLocker(id) {
    if (!player[id]) return;
    // check proximity via helper on window
    try {
      const canStore = (typeof window.isPlayerNearLocker === 'function') ? window.isPlayerNearLocker() : true;
      if (!canStore) { alert('You must be near the locker to store items.'); return; }
    } catch (e) {}
    // if this item is currently equipped, unequip and turn off effects
    try {
      if (equipped[id]) {
        equipped[id] = false;
        try { window.flashlightOn = false; } catch (e) {}
      }
    } catch (e) {}
    addToLocker(player[id].item, 1);
    // Keep legacy inventory in sync for other systems
    try {
      const wid = player[id].item.id || id;
      if (!window.inventory) window.inventory = {};
      if (!window.inventory[wid]) window.inventory[wid] = { item: player[id].item, count: 0 };
      window.inventory[wid].count = (window.inventory[wid].count || 0) - 1;
      if (window.inventory[wid].count <= 0) delete window.inventory[wid];
    } catch (e) {}
    player[id].count -= 1;
    if (player[id].count <= 0) {
      delete player[id];
      try { if (equipped[id]) delete equipped[id]; } catch (e) {}
    }
    renderLocker();
    renderPlayer();
  }

  function createPlayerUI() {
    if (uiPlayer) return uiPlayer;
    uiPlayer = document.createElement('div');
    uiPlayer.id = 'player-inventory-ui-player';
    uiPlayer.style.position = 'fixed';
    uiPlayer.style.right = '12px';
    uiPlayer.style.top = '12px';
    uiPlayer.style.zIndex = 10012;
    uiPlayer.style.background = 'rgba(6,6,10,0.9)';
    uiPlayer.style.color = '#fff';
    uiPlayer.style.padding = '10px';
    uiPlayer.style.borderRadius = '8px';
    uiPlayer.style.minWidth = '240px';
    uiPlayer.style.fontFamily = 'sans-serif';

    const title = document.createElement('div'); title.textContent = 'You'; title.style.fontWeight = '700'; title.style.marginBottom = '8px'; uiPlayer.appendChild(title);
    const listP = document.createElement('div'); listP.id = 'pi-player'; listP.style.maxHeight='60vh'; listP.style.overflow='auto'; uiPlayer.appendChild(listP);
    const foot = document.createElement('div'); foot.style.marginTop='8px'; foot.style.textAlign='right';
    const closeBtn = document.createElement('button'); closeBtn.textContent='Close'; closeBtn.style.padding='6px 8px'; closeBtn.style.borderRadius='6px'; closeBtn.addEventListener('click', () => closePlayerUI());
    foot.appendChild(closeBtn); uiPlayer.appendChild(foot);
    uiPlayer.style.display = 'none'; document.body.appendChild(uiPlayer);
    return uiPlayer;
  }

  function createLockerUI() {
    if (uiLocker) return uiLocker;
    uiLocker = document.createElement('div');
    uiLocker.id = 'player-inventory-ui-locker';
    uiLocker.style.position = 'fixed';
    uiLocker.style.left = '50%';
    uiLocker.style.top = '50%';
    uiLocker.style.transform = 'translate(-50%, -50%)';
    uiLocker.style.zIndex = 10012;
    uiLocker.style.background = 'rgba(6,6,10,0.96)';
    uiLocker.style.color = '#fff';
    uiLocker.style.padding = '12px';
    uiLocker.style.borderRadius = '10px';
    uiLocker.style.minWidth = '340px';
    uiLocker.style.fontFamily = 'sans-serif';

    const title = document.createElement('div'); title.textContent = 'Locker'; title.style.fontWeight='700'; title.style.marginBottom='8px'; uiLocker.appendChild(title);
    const listL = document.createElement('div'); listL.id = 'pi-locker'; listL.style.maxHeight='60vh'; listL.style.overflow='auto'; uiLocker.appendChild(listL);
    const foot = document.createElement('div'); foot.style.marginTop='8px'; foot.style.textAlign='right';
    const closeBtn = document.createElement('button'); closeBtn.textContent='Close'; closeBtn.style.padding='6px 8px'; closeBtn.style.borderRadius='6px'; closeBtn.addEventListener('click', () => closeLockerUI());
    foot.appendChild(closeBtn); uiLocker.appendChild(foot);
    uiLocker.style.display = 'none'; document.body.appendChild(uiLocker);
    return uiLocker;
  }

  function openPlayerUI() { createPlayerUI(); renderPlayer(); uiPlayer.style.display = 'block'; }
  function closePlayerUI() { if (!uiPlayer || uiPlayer.style.display !== 'block') return; if (_closingPlayer) return; _closingPlayer = true; uiPlayer.style.display = 'none'; _closingPlayer = false; }
  function togglePlayerUI() { createPlayerUI(); if (uiPlayer.style.display === 'block') closePlayerUI(); else openPlayerUI(); }

  function openLockerUI() {
    createLockerUI(); renderLocker();
    uiLocker.style.display = 'block';
  }
  async function closeLockerUI() {
    if (!uiLocker || uiLocker.style.display !== 'block') return;
    if (_closingLocker) return;
    _closingLocker = true;
    try {
      if (typeof window.playLockerClose === 'function') {
        try { await Promise.resolve(window.playLockerClose()); } catch (e) {}
      }
    } catch (e) {}
    uiLocker.style.display = 'none';
    _closingLocker = false;
  }
  function toggleLockerUI() { createLockerUI(); if (uiLocker.style.display === 'block') closeLockerUI(); else openLockerUI(); }

  function renderPlayer() {
    if (!uiPlayer) return;
    const listP = document.getElementById('pi-player'); if (!listP) return; listP.innerHTML = '';
    const pkeys = Object.keys(player);
    if (pkeys.length === 0) { const e = document.createElement('div'); e.textContent = 'You are empty-handed'; e.style.opacity='0.9'; listP.appendChild(e); return; }
    for (const id of pkeys) {
      const e = player[id];
      const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='6px 0';
      const left = document.createElement('div'); const nm = document.createElement('div'); nm.textContent = `${e.item.name}`; nm.style.fontWeight='600'; const desc = document.createElement('div'); desc.textContent = `${e.item.desc || ''}`; desc.style.fontSize='12px'; desc.style.opacity='0.9'; left.appendChild(nm); left.appendChild(desc);
      const right = document.createElement('div'); right.style.textAlign='right'; const cnt = document.createElement('div'); cnt.textContent = `${e.count}x`; cnt.style.marginBottom='6px'; right.appendChild(cnt);
      const btn = document.createElement('button'); btn.textContent='Store'; btn.style.padding='6px 8px'; btn.style.borderRadius='6px'; btn.addEventListener('click', () => { transferToLocker(id); }); right.appendChild(btn);
      // Equip/Unequip button for equippable items
      if (e.item && (e.item.id === 'flashlight' || (e.item.name && e.item.name.toLowerCase().includes('flashlight')))) {
        const isEq = !!equipped[id];
        const eq = document.createElement('button'); eq.textContent = isEq ? 'Unequip' : 'Equip'; eq.style.marginLeft = '6px'; eq.style.padding='6px 8px'; eq.style.borderRadius='6px';
        eq.addEventListener('click', () => { equipItem(id); });
        right.appendChild(eq);
      }
      row.appendChild(left); row.appendChild(right); listP.appendChild(row);
    }
  }

  function renderLocker() {
    if (!uiLocker) return;
    const listL = document.getElementById('pi-locker'); if (!listL) return; listL.innerHTML = '';
    const lkeys = Object.keys(locker);
    if (lkeys.length === 0) { const e = document.createElement('div'); e.textContent = 'Locker is empty'; e.style.opacity='0.9'; listL.appendChild(e); return; }
    for (const id of lkeys) {
      const e = locker[id];
      const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='6px 0';
      const left = document.createElement('div'); const nm = document.createElement('div'); nm.textContent = `${e.item.name}`; nm.style.fontWeight='600'; const desc = document.createElement('div'); desc.textContent = `${e.item.desc || ''}`; desc.style.fontSize='12px'; desc.style.opacity='0.9'; left.appendChild(nm); left.appendChild(desc);
      const right = document.createElement('div'); right.style.textAlign='right'; const cnt = document.createElement('div'); cnt.textContent = `${e.count}x`; cnt.style.marginBottom='6px'; right.appendChild(cnt);
      const btn = document.createElement('button'); btn.textContent='Take'; btn.style.padding='6px 8px'; btn.style.borderRadius='6px'; btn.addEventListener('click', () => { transferToPlayer(id); }); right.appendChild(btn);
      row.appendChild(left); row.appendChild(right); listL.appendChild(row);
    }
  }

  function getLockerItemCount(id) {
    try {
      if (!locker[id]) return 0;
      return locker[id].count || 0;
    } catch (e) { return 0; }
  }

  function equipItem(id) {
    try {
      if (!player[id]) return;
      const it = player[id].item;
      // toggle equip state
      if (equipped[id]) {
        // unequip
        equipped[id] = false;
        try { window.flashlightOn = false; } catch (e) {}
      } else {
        equipped[id] = true;
        // spawn flashlight light if requested
        if (it.id === 'flashlight' || (it.name && it.name.toLowerCase().includes('flashlight'))) {
          try { if (typeof window.spawnFlashlight === 'function') window.spawnFlashlight(); } catch (e) {}
          try { window.flashlightOn = true; } catch (e) {}
        }
      }
      try { if (typeof window.playerInventory !== 'undefined' && typeof window.playerInventory.renderPlayer === 'function') window.playerInventory.renderPlayer(); } catch (e) {}
    } catch (e) {}
  }

  // Public API
  try { window.playerInventory = { setLockerInventory, addToPlayer, addToLocker, openPlayerUI, closePlayerUI, togglePlayerUI, createPlayerUI, renderPlayer, openLockerUI, closeLockerUI, toggleLockerUI, createLockerUI, renderLocker, equipItem, getLockerItemCount }; } catch (e) {}

  return { setLockerInventory, addToPlayer, addToLocker, openPlayerUI, closePlayerUI, togglePlayerUI, createPlayerUI, renderPlayer, openLockerUI, closeLockerUI, toggleLockerUI, createLockerUI, renderLocker, equipItem, getLockerItemCount };
})();

export default PlayerInventory;
