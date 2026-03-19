// Lightweight inventory module
// Provides a minimal, in-game inventory API and simple UI used by the rest
// of the project. This mirrors the previous inline implementation but
// exposes named exports for cleaner modular usage.
const inventory = {};
let inventoryUI = null;
let _closing = false;

function addToInventory(item) {
  if (!inventory[item.id]) inventory[item.id] = { item: item, count: 0 };
  inventory[item.id].count += 1;
}

function createInventoryUI() {
  if (inventoryUI) return inventoryUI;
  inventoryUI = document.createElement('div');
  inventoryUI.id = 'inventory-ui';
  inventoryUI.style.position = 'fixed';
  inventoryUI.style.left = '50%';
  inventoryUI.style.top = '50%';
  inventoryUI.style.transform = 'translate(-50%, -50%)';
  inventoryUI.style.zIndex = 10011;
  inventoryUI.style.background = 'rgba(6,6,10,0.96)';
  inventoryUI.style.color = '#fff';
  inventoryUI.style.padding = '16px';
  inventoryUI.style.borderRadius = '10px';
  inventoryUI.style.minWidth = '320px';
  inventoryUI.style.fontFamily = 'sans-serif';

  const title = document.createElement('div');
  title.textContent = 'Inventory';
  title.style.fontSize = '18px';
  title.style.marginBottom = '10px';
  inventoryUI.appendChild(title);

  const contents = document.createElement('div');
  contents.id = 'inventory-contents';
  contents.style.maxHeight = '50vh';
  contents.style.overflow = 'auto';
  inventoryUI.appendChild(contents);

  const close = document.createElement('div');
  close.style.marginTop = '12px';
  close.style.textAlign = 'right';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.padding = '6px 10px';
  closeBtn.style.borderRadius = '6px';
  closeBtn.addEventListener('click', () => { closeInventory(); });
  close.appendChild(closeBtn);
  inventoryUI.appendChild(close);
  inventoryUI.style.display = 'none';
  document.body.appendChild(inventoryUI);
  renderInventoryContents();
  return inventoryUI;
}

function openInventory() {
  createInventoryUI();
  if (inventoryUI) {
    renderInventoryContents();
    inventoryUI.style.display = 'block';
  }
}

async function closeInventory() {
  if (!inventoryUI || inventoryUI.style.display !== 'block') return;
  if (_closing) return;
  _closing = true;
  try {
    if (window.playLockerClose && typeof window.playLockerClose === 'function') {
      await window.playLockerClose();
    }
  } catch (e) { /* ignore */ }
  try { inventoryUI.style.display = 'none'; } catch (e) {}
  _closing = false;
}

function renderInventoryContents() {
  if (!inventoryUI) return;
  const contents = document.getElementById('inventory-contents');
  if (!contents) return;
  contents.innerHTML = '';
  const keys = Object.keys(inventory);
  if (keys.length === 0) {
    const empt = document.createElement('div');
    empt.textContent = 'Inventory is empty.';
    empt.style.opacity = '0.9';
    contents.appendChild(empt);
    return;
  }
  for (const k of keys) {
    const entry = inventory[k];
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '6px 0';
    const left = document.createElement('div');
    const nm = document.createElement('div');
    nm.textContent = entry.item.name;
    nm.style.fontWeight = '600';
    const cnt = document.createElement('div');
    cnt.textContent = entry.item.desc;
    cnt.style.fontSize = '12px';
    cnt.style.opacity = '0.9';
    left.appendChild(nm);
    left.appendChild(cnt);
    const right = document.createElement('div');
    right.style.textAlign = 'right';
    const count = document.createElement('div');
    count.textContent = `${entry.count}x`;
    count.style.marginBottom = '6px';
    right.appendChild(count);
    row.appendChild(left);
    row.appendChild(right);
    contents.appendChild(row);
  }
}

// Compatibility helpers: expose to window for any legacy callers
try { window.inventory = inventory; } catch (e) {}
try { window.renderInventoryContents = renderInventoryContents; } catch (e) {}
try { window.createInventoryUI = createInventoryUI; } catch (e) {}
try { window.openInventory = openInventory; } catch (e) {}
try { window.closeInventory = closeInventory; } catch (e) {}

export { inventory, inventoryUI, addToInventory, createInventoryUI, openInventory, closeInventory, renderInventoryContents };
export default { inventory, inventoryUI, addToInventory, createInventoryUI, openInventory, closeInventory, renderInventoryContents };
