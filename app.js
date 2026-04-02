const API_BASE = "https://script.google.com/macros/s/AKfycby61GhkT3ri2bnLzqtkN_0w-GWFJwGUk0qv0qjdSkoGtoN-sAX9aMLLRsTQtl0EedO9/exec"; // Ganti dengan URL Web App GAS

// --- GLOBAL STATE ---
let GLOBAL_PRODUCTS = [], GLOBAL_PROFILE = {}, GLOBAL_ACCOUNTS = [], CART = [];
let currentProductView = 'grid'; // 'grid' | 'list'
let CURRENT_USER = null; let IS_BPJS = false; let LAST_TRANSACTION = null;
let IS_RIWAYAT_STALE = true; let RIWAYAT_LAST_FILTER = null; let IS_STOK_STALE = true;
let PENDING_ACTION = null; // Used for passing actions through the PIN modal

// PWA: Caching Key
const CACHE_KEY = "pos_polindes_cache";

const dom = {
  loading: document.getElementById('loading-overlay'),
  sidebar: document.getElementById('sidebar'),
  appTitle: document.getElementById('app-title'),
  productsGrid: document.getElementById('products-grid'),
  views: document.querySelectorAll('.view-container'),
  pinDots: document.querySelectorAll('.pin-dot'),
  pinModal: new bootstrap.Modal(document.getElementById('pinModal')),
  productModal: new bootstrap.Modal(document.getElementById('productModal')),
  receiptModal: new bootstrap.Modal(document.getElementById('receiptModal')),
  cashEntryModal: new bootstrap.Modal(document.getElementById('cashEntryModal')),
  userModal: new bootstrap.Modal(document.getElementById('userModal')),
  accountModal: new bootstrap.Modal(document.getElementById('accountModal')),
  syncStatus: document.getElementById('sync-status') // Status online/offline
};

function showToast(msg, type = 'success') {
  const toastEl = document.getElementById('appToast');
  const toastBody = document.getElementById('appToastBody');
  toastEl.className = 'toast align-items-center text-white border-0';

  if (type === 'success') toastEl.classList.add('bg-success');
  else if (type === 'warning') toastEl.classList.add('bg-warning', 'text-dark');
  else if (type === 'error') toastEl.classList.add('bg-danger');
  else toastEl.classList.add('bg-primary');

  toastBody.innerText = msg;
  const t = new bootstrap.Toast(toastEl, { delay: 3000 });
  t.show();
}

window.alert = function (msg) {
  let type = 'warning';
  const m = String(msg).toLowerCase();
  if (m.includes('berhasil') || m.includes('tersimpan')) type = 'success';
  else if (m.includes('error') || m.includes('err:') || m.includes('gagal')) type = 'error';
  showToast(msg, type);
};

// --- FETCH API WRAPPER ---
async function fetchApi(action, payload = null, pin = null) {
  if (API_BASE === 'KODE_DEPLOYMENT_GAS_ANDA_DISINI') {
    return { success: false, message: "URL API_BASE belum diatur di app.js" };
  }

  // Cek koneksi internet
  if (!navigator.onLine) {
    if (action === 'getDashboardData') {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        showToast("Mode Offline: Menggunakan data terakhir tersimpan", "warning");
        setOfflineStatus(true);
        return JSON.parse(cached); // Return format yang sama dengan res GAS
      }
    }
    return { success: false, message: "Anda sedang offline. Aksi ini butuh internet." };
  }
  
  setOfflineStatus(false);

  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, payload: payload, pin: pin })
    });
    
    if (!response.ok) throw new Error("Network error");
    const result = await response.json();

    // Cache dashboard data
    if (action === 'getDashboardData' && result.success) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    }

    return result;
  } catch (error) {
    console.error("Fetch API Error:", error);
    return { success: false, message: "Gagal terhubung ke server. " + error.message };
  }
}

function setOfflineStatus(isOffline) {
  if (isOffline) {
    dom.syncStatus.innerHTML = '<i class="fa-solid fa-cloud-arrow-down me-1"></i> Offline';
    dom.syncStatus.className = 'text-warning small fw-bold mt-1';
  } else {
    dom.syncStatus.innerHTML = '<i class="fa-solid fa-cloud-check me-1"></i> Online';
    dom.syncStatus.className = 'text-success small fw-bold mt-1';
  }
}

window.addEventListener('online',  () => setOfflineStatus(false));
window.addEventListener('offline', () => setOfflineStatus(true));

// --- LIFECYCLE ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sidebarToggle').addEventListener('click', () => dom.sidebar.classList.toggle('expanded'));

  document.querySelectorAll('.numpad-btn[data-num]').forEach(b => b.addEventListener('click', e => handlePinInput(e.target.dataset.num)));
  document.getElementById('btn-pin-clear').addEventListener('click', () => clearPinUI());
  document.getElementById('btn-pin-enter').addEventListener('click', submitPin);
  document.getElementById('pinModal').addEventListener('hidden.bs.modal', clearPinUI);

  document.getElementById('search-input').addEventListener('input', e => renderProducts(document.querySelector('.btn-filter.active').dataset.filter, e.target.value));
  document.querySelectorAll('.btn-filter').forEach(btn => btn.addEventListener('click', e => {
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.replace('btn-primary', 'btn-outline-primary'));
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
    e.target.classList.replace('btn-outline-primary', 'btn-primary'); e.target.classList.add('active');
    renderProducts(e.target.dataset.filter, document.getElementById('search-input').value);
  }));

  document.getElementById('bpjs-toggle').addEventListener('change', e => {
    IS_BPJS = e.target.checked;
    document.getElementById('bpjs-active-badge').classList.toggle('d-none', !IS_BPJS);
    renderCart();
  });

  document.getElementById('prod-form-bpjs').addEventListener('change', e => {
    document.getElementById('prod-form-bpjs-nilai').classList.toggle('d-none', e.target.value !== 'Sebagian');
  });

  // Init Data
  initApp();
});

async function initApp() {
  dom.loading.style.display = 'flex';
  const res = await fetchApi('getDashboardData');
  if (!res.success) { 
    alert(res.message); 
    dom.loading.style.display = 'none'; 
    return; 
  }

  GLOBAL_PRODUCTS = res.data.products;
  GLOBAL_PROFILE = res.data.profile || {};
  GLOBAL_ACCOUNTS = res.data.accounts || [];

  dom.appTitle.innerText = GLOBAL_PROFILE.Nama_Bisnis || 'Polindes POS';
  document.getElementById('print-biz-name').innerText = GLOBAL_PROFILE.Nama_Bisnis || '';
  document.getElementById('print-biz-address').innerText = GLOBAL_PROFILE.Alamat || '';
  document.getElementById('print-biz-phone').innerText = GLOBAL_PROFILE.Telepon || '';

  refreshPaymentDropdown();
  renderProducts('all', '');
  renderMasterStok();

  dom.loading.style.opacity = '0';
  setTimeout(() => dom.loading.style.display = 'none', 300);
}

const formatRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);

function refreshPaymentDropdown() {
  const paySelect = document.getElementById('payment-method');
  paySelect.innerHTML = '';
  if (GLOBAL_ACCOUNTS.length > 0) {
    GLOBAL_ACCOUNTS.forEach(a => { paySelect.innerHTML += `<option value="${a.Nama_Akun}">${a.Nama_Akun}</option>`; });
  } else {
    paySelect.innerHTML = '<option value="Cash">Cash</option>';
  }
}

function switchView(viewId) {
  if (viewId === 'owner') {
    PENDING_ACTION = { type: 'openView', view: 'owner' };
    openPinModal(); return;
  }

  if (viewId !== 'owner' && document.getElementById('view-owner').classList.contains('active-view')) { sessionPin = ''; }

  document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-item-btn[onclick="switchView('${viewId}')"]`);
  if (activeBtn) activeBtn.classList.add('active');

  dom.views.forEach(v => v.classList.remove('active-view'));
  const tgt = document.getElementById('view-' + viewId);
  if (tgt) tgt.classList.add('active-view');

  if (viewId === 'riwayat') {
    const filter = document.getElementById('history-filter') ? document.getElementById('history-filter').value : 'hari_ini';
    if (IS_RIWAYAT_STALE || RIWAYAT_LAST_FILTER !== filter) loadHistoryData();
  }
  else if (viewId === 'stok' && IS_STOK_STALE) loadStockLogs();
  else if (viewId === 'laporan') loadReportData();
}

// --- PIN SYSTEM ---
let currentPin = ''; let sessionPin = ''; let PIN_CACHE = {};

function openPinModal() { clearPinUI(); dom.pinModal.show(); }
function handlePinInput(n) {
  if (currentPin.length < 4) {
    currentPin += n; updatePinIndicators();
    if (currentPin.length === 4) setTimeout(() => { submitPin(); }, 100);
  }
}
function updatePinIndicators() {
  dom.pinDots.forEach((d, i) => { if (i < currentPin.length) d.classList.add('filled'); else d.classList.remove('filled'); });
  document.getElementById('pin-error-msg').classList.add('d-none');
}
function clearPinUI() { currentPin = ''; updatePinIndicators(); }

async function submitPin() {
  if (currentPin.length === 0) return;
  document.getElementById('pin-loading').classList.remove('d-none');

  if (PIN_CACHE[currentPin]) {
    document.getElementById('pin-loading').classList.add('d-none');
    processPinSuccess(PIN_CACHE[currentPin]); return;
  }

  const res = await fetchApi('checkPIN', null, currentPin);
  document.getElementById('pin-loading').classList.add('d-none');
  
  if (res.success) {
    PIN_CACHE[currentPin] = { name: res.name, role: res.role };
    sessionPin = currentPin;
    processPinSuccess({ name: res.name, role: res.role });
  } else {
    showPinError(res.message);
  }
}

function processPinSuccess(res) {
  if (PENDING_ACTION && PENDING_ACTION.type === 'openView' && PENDING_ACTION.view === 'owner' && res.role !== 'Owner') {
    showPinError("Hanya untuk Owner."); return;
  }
  sessionPin = currentPin;
  postPinAction(res.name, sessionPin);
}

function showPinError(msg) {
  document.getElementById('pin-error-msg').innerText = msg;
  document.getElementById('pin-error-msg').classList.remove('d-none');
  clearPinUI();
}

function postPinAction(cashierName, pinToPass) {
  dom.pinModal.hide();
  if (PENDING_ACTION.type === 'checkout') doCheckout(cashierName, pinToPass);
  else if (PENDING_ACTION.type === 'cashEntry') doCashEntry(cashierName, pinToPass);
  else if (PENDING_ACTION.type === 'bulkStock') doBulkStock(cashierName, pinToPass);
  else if (PENDING_ACTION.type === 'openView') {
    dom.views.forEach(v => v.classList.remove('active-view'));
    document.getElementById('view-' + PENDING_ACTION.view).classList.add('active-view');
    if (PENDING_ACTION.view === 'owner') renderOwnerView();
    document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-item-btn[onclick="switchView('${PENDING_ACTION.view}')"]`);
    if (navBtn) navBtn.classList.add('active');
  }
  PENDING_ACTION = null;
}

// --- KASIR LOGIC ---
function renderProducts(filter, query) {
  dom.productsGrid.innerHTML = '';
  let list = GLOBAL_PRODUCTS;
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(p => String(p.Nama).toLowerCase().includes(q) || String(p.ID).toLowerCase().includes(q));
  }
  if (filter !== 'all') {
    list = list.filter(p => String(p.Kategori).toLowerCase() === filter.toLowerCase());
  }

  if (list.length === 0) { dom.productsGrid.innerHTML = '<div class="col-12 mt-4 text-center text-muted">Tak ada produk.</div>'; return; }

  list.forEach(p => {
    const isB = String(p.Kategori).toLowerCase() === 'barang';
    const stHtml = isB ? `<small class="text-muted"><i class="fa-solid fa-box-open me-1"></i> Stok: <span class="fw-bold">${p.Stok}</span></small>` : `<small class="text-muted"><i class="fa-solid fa-user-doctor me-1"></i> ${p.Kategori}</small>`;
    const isEmp = isB && parseInt(p.Stok) <= 0;

    const bpjsS = String(p['Status_BPJS (Full/Sebagian/Tidak)']).trim();
    const bdg = bpjsS === 'Full' ? `<span class="badge-bpjs position-absolute top-0 end-0 m-2">BPJS Full</span>` :
      (bpjsS === 'Sebagian' ? `<span class="badge-bpjs position-absolute top-0 end-0 m-2">BPJS Sub</span>` : '');

    const satuanText = p.Satuan && p.Satuan !== '-' ? ` / ${p.Satuan}` : '';
    const col = document.createElement('div');
    col.className = 'col-sm-6 col-md-4 col-lg-3 d-flex align-items-stretch';
    col.innerHTML = `
      <div class="card product-card w-100 p-3 position-relative ${isEmp ? 'opacity-50' : ''}" onclick="addToCart('${p.ID}')">
         ${bdg}
         <h6 class="fw-bold mt-2 mb-1 line-clamp-2">${p.Nama}</h6>
         <div class="mt-auto pt-2 border-top">
            <div class="text-primary fw-bold fs-6 mb-1">${formatRp(p.Harga || 0)}${satuanText}</div>
            ${stHtml}
         </div>
      </div>
    `;
    dom.productsGrid.appendChild(col);
  });
}

function toggleProductView() {
  const btnIcon = document.querySelector('#btn-view-toggle i');
  if (currentProductView === 'grid') {
    currentProductView = 'list';
    dom.productsGrid.classList.add('view-list');
    btnIcon.className = 'fa-solid fa-border-all text-muted';
  } else {
    currentProductView = 'grid';
    dom.productsGrid.classList.remove('view-list');
    btnIcon.className = 'fa-solid fa-list text-muted';
  }
}

function addToCart(id) {
  const p = GLOBAL_PRODUCTS.find(x => String(x.ID) === String(id)); if (!p) return;
  const isB = String(p.Kategori).toLowerCase() === 'barang';
  const avail = parseInt(p.Stok);

  const idx = CART.findIndex(c => c.id === id);
  if (idx > -1) {
    if (isB && CART[idx].qty >= avail) { alert("Stok habis!"); return; }
    CART[idx].qty++;
  } else {
    if (isB && avail <= 0) { alert("Stok kosong!"); return; }

    const s = String(p['Status_BPJS (Full/Sebagian/Tidak)']).trim();
    let tg = 0;
    if (s === 'Full') tg = p.Harga;
    else if (s === 'Sebagian') tg = p.Nilai_Tanggungan;

    CART.push({ id: p.ID, nama: p.Nama, harga: parseFloat(p.Harga) || 0, qty: 1, tanggungan: tg || 0 });
  }
  renderCart();
}

function renderCart() {
  const ls = document.getElementById('cart-list');
  ls.innerHTML = '';
  document.getElementById('cart-empty-state').style.display = CART.length === 0 ? 'block' : 'none';

  CART.forEach((c, i) => {
    const prHtml = IS_BPJS && c.tanggungan > 0
      ? `<div class="text-dark">${formatRp(c.harga * c.qty)}</div><div class="text-success small">- ${formatRp(c.tanggungan * c.qty)}</div>`
      : `<div class="text-dark">${formatRp(c.harga * c.qty)}</div>`;

    const li = document.createElement('li'); li.className = 'list-group-item px-0 pb-2 pt-3 border-bottom';
    li.innerHTML = `
       <div class="d-flex justify-content-between align-items-start mb-2">
         <div class="fw-medium w-75">${c.nama}</div>
         <button class="btn btn-sm text-danger p-0 border-0 bg-transparent" onclick="CART.splice(${i},1); renderCart()"><i class="fa-solid fa-xmark"></i></button>
       </div>
       <div class="d-flex justify-content-between align-items-center">
         <div class="qty-control">
           <button class="qty-btn" onclick="CART[${i}].qty--; if(CART[${i}].qty<=0) CART.splice(${i},1); renderCart()"><i class="fa-solid fa-minus"></i></button>
           <input type="number" min="1" class="qty-input text-center" value="${c.qty}" onchange="updateCartQty(${i}, this.value)">
           <button class="qty-btn" onclick="addToCart('${c.id}')"><i class="fa-solid fa-plus"></i></button>
         </div>
         <div class="text-end">${prHtml}</div>
       </div>
     `;
    ls.appendChild(li);
  });
  updateCartTotals();
}

function updateCartQty(index, newQty) {
  newQty = parseInt(newQty);
  if (isNaN(newQty) || newQty <= 0) CART.splice(index, 1);
  else CART[index].qty = newQty;
  renderCart();
}

function updateCartTotals() {
  let sub = 0, disc = 0;
  CART.forEach(c => {
    const itemSub = c.harga * c.qty; sub += itemSub;
    if (IS_BPJS) disc += Math.min(c.tanggungan * c.qty, itemSub);
  });
  document.getElementById('cart-subtotal').innerText = formatRp(sub);
  const dr = document.getElementById('bpjs-discount-row');
  if (IS_BPJS && disc > 0) { dr.classList.remove('d-none'); document.getElementById('cart-discount').innerText = '-' + formatRp(disc); }
  else dr.classList.add('d-none');

  document.getElementById('cart-total').innerText = formatRp(sub - disc);
  document.getElementById('btn-pay').disabled = CART.length === 0;

  document.getElementById('btn-pay').onclick = () => {
    if (CART.length === 0) return;
    PENDING_ACTION = { type: 'checkout' }; openPinModal();
  };
}

async function doCheckout(cashierName, passedPin) {
  let sub = 0, disc = 0;
  const paymentMethod = document.getElementById('payment-method').value || 'Cash';
  const payload = {
    type: IS_BPJS ? 'BPJS' : 'Umum',
    method: paymentMethod,
    items: CART.map(c => {
      const h = c.harga; const t = IS_BPJS ? Math.min(c.tanggungan, h) : 0;
      const subitem = (h * c.qty) - (t * c.qty);
      sub += h * c.qty; disc += t * c.qty;
      return { id: c.id, nama: c.nama, harga: h, qty: c.qty, disc_bpjs: t, subtotal: subitem };
    })
  };
  payload.total = sub - disc;

  dom.loading.style.display = 'flex'; dom.loading.style.opacity = '1';
  
  const res = await fetchApi('saveTransaction', payload, passedPin);
  
  dom.loading.style.opacity = '0'; setTimeout(() => dom.loading.style.display = 'none', 300);
  
  if (res.success) {
    IS_RIWAYAT_STALE = true; IS_STOK_STALE = true;
    LAST_TRANSACTION = { id: res.transactionId, date: new Date().toLocaleString('id-ID'), cashier: cashierName, data: payload, totals: { sub, disc, total: payload.total }, customerType: payload.type };

    // OPTIMISTIC UI: Decrement local stock immediately so user can transact again
    CART.forEach(c => { 
      const gp = GLOBAL_PRODUCTS.find(x => x.ID === c.id); 
      if (gp && String(gp.Kategori).toLowerCase() === 'barang') gp.Stok -= c.qty; 
    });

    populateReceiptPreview();
    resetTransaction();
    dom.receiptModal.show();
  } else alert(res.message);
}

function resetTransaction() { 
  CART = []; 
  document.getElementById('payment-method').selectedIndex = 0; 
  renderCart(); 
  renderProducts(document.querySelector('.btn-filter.active').dataset.filter, document.getElementById('search-input').value); 
}

function populateReceiptPreview() {
  if (!LAST_TRANSACTION) return;
  const d = LAST_TRANSACTION;
  document.getElementById('print-date').innerText = d.date;
  document.getElementById('print-trx-id').innerText = d.id;
  document.getElementById('print-cashier').innerText = d.cashier;
  document.getElementById('print-customer-type').innerText = d.customerType === 'BPJS' ? 'Pasien BPJS' : 'Pasien Umum';

  const listHtml = document.getElementById('print-items-list');
  listHtml.innerHTML = '';
  d.data.items.forEach(i => {
    const isDiscounted = i.disc_bpjs > 0;
    const subtotalHtml = isDiscounted
      ? `<div class="d-flex flex-column text-end"><del class="text-muted small">${formatRp(i.harga * i.qty)}</del><span class="fw-bold">${formatRp(i.subtotal)}</span></div>`
      : `<div class="fw-bold">${formatRp(i.subtotal)}</div>`;

    listHtml.innerHTML += `
       <div class="d-flex justify-content-between align-items-start mb-2">
         <div class="d-flex flex-column w-75">
           <span class="fw-bold text-dark">${i.nama}</span>
           <span class="text-muted small">${i.qty} x ${formatRp(i.harga)} ${isDiscounted ? '<span class="text-success ms-1">(BPJS)</span>' : ''}</span>
         </div>
         ${subtotalHtml}
       </div>
     `;
  });
  document.getElementById('print-total').innerText = formatRp(d.totals.total);
}

function printReceipt() {
  // Fungsi lama tetap ada sebagai fallback (Opsi Cadangan)
  const source = document.getElementById('print-area');
  const clone = document.getElementById('print-clone');
  if (!source || !clone) { window.print(); return; } 

  clone.innerHTML = source.innerHTML;
  void clone.offsetHeight;

  function cleanup() {
    clone.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  }
  window.addEventListener('afterprint', cleanup);

  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 3000);
  }, 150);
}

/* ====================================================
   PRINTER BLUETOOTH (ESC/POS)
   ==================================================== */

// Kelas sederhana pembentuk instruksi byte ESC/POS
class EscPosEncoder {
  constructor() { this.buffer = []; }
  init() { this.buffer.push(0x1B, 0x40); return this; }
  alignLeft() { this.buffer.push(0x1B, 0x61, 0x00); return this; }
  alignCenter() { this.buffer.push(0x1B, 0x61, 0x01); return this; }
  alignRight() { this.buffer.push(0x1B, 0x61, 0x02); return this; }
  bold(on) { this.buffer.push(0x1B, 0x45, on ? 1 : 0); return this; }
  newline(count = 1) { for (let i = 0; i < count; i++) this.buffer.push(0x0A); return this; }
  text(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.buffer.push(...bytes);
    return this;
  }
  generate() { return new Uint8Array(this.buffer); }
}

let btDevice = null;
let btCharacteristic = null;

async function connectBluetoothPrinter() {
  try {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth tidak didukung. Gunakan Chrome Android/PC.");

    document.getElementById('bt-status').innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span> <span class="text-primary small ms-1">Mencari...</span>';

    // Coba reconnect ke device jika API getDevices tersedia (menghindari popup berulang kali)
    if (!btDevice && navigator.bluetooth.getDevices) {
      const devices = await navigator.bluetooth.getDevices();
      if (devices.length > 0) btDevice = devices[0];
    }

    if (!btDevice) {
      btDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455'
        ]
      });
    }

    btDevice.addEventListener('gattserverdisconnected', () => {
      document.getElementById('bt-status').innerHTML = '<i class="fa-solid fa-bluetooth text-muted"></i> <span class="text-muted small ms-1">Printer Putus</span>';
      btCharacteristic = null;
    });

    if (!btDevice.gatt.connected) await btDevice.gatt.connect();

    const server = btDevice.gatt;
    const services = await server.getPrimaryServices();
    let service = services.find(s => s.uuid.includes('18f0') || s.uuid.includes('e781') || s.uuid.includes('4953'));
    if (!service) service = services[0];

    const characteristics = await service.getCharacteristics();
    btCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

    if (!btCharacteristic) throw new Error("Karakteristik Bluetooth untuk Print tidak ditemukan");

    document.getElementById('bt-status').innerHTML = '<i class="fa-solid fa-bluetooth text-success"></i> <span class="text-success small ms-1 fw-bold">Konek: ' + btDevice.name + '</span>';
    return true;
  } catch (err) {
    console.error(err);
    // Ignore error if user cancelled the picker
    if (err.name !== 'NotFoundError' && err.message !== 'User cancelled the requestDevice() chooser.') {
      alert("Koneksi Bluetooth Gagal: " + err.message);
    }
    document.getElementById('bt-status').innerHTML = '<i class="fa-solid fa-bluetooth text-danger"></i> <span class="text-danger small ms-1">Gagal Konek</span>';
    return false;
  }
}

function rightAlignText(left, right, maxLen = 32) {
  const spaces = maxLen - left.length - right.length;
  if (spaces <= 0) return left + " " + right; // fallback
  return left + " ".repeat(spaces) + right;
}

async function printBluetooth() {
  if (!LAST_TRANSACTION) return;
  const d = LAST_TRANSACTION;

  // Cek koneksi dulu
  if (!btDevice || !btDevice.gatt.connected || !btCharacteristic) {
    const connected = await connectBluetoothPrinter();
    if (!connected) return; // Jika gagal konek, berhenti
  }

  try {
    const esc = new EscPosEncoder();
    esc.init();
    
    // HEADER
    esc.alignCenter();
    esc.bold(true);
    esc.text(GLOBAL_PROFILE.Nama_Bisnis ? GLOBAL_PROFILE.Nama_Bisnis + "\n" : "POLINDES\n");
    esc.bold(false);
    if(GLOBAL_PROFILE.Alamat) esc.text(GLOBAL_PROFILE.Alamat + "\n");
    esc.text("================================\n"); // 32 char wide
    
    // INFO TRANSAKSI
    esc.alignLeft();
    esc.text("Waktu : " + (d.waktu || d.date) + "\n");
    if(d.id) esc.text("ID Trx: " + d.id + "\n");
    esc.text("Kasir : " + d.cashier + "\n");
    esc.text("Tipe  : " + (d.customerType === 'BPJS' ? 'Pasien BPJS' : 'Pasien Umum') + "\n");
    esc.text("--------------------------------\n");
    
    // ITEM
    d.data.items.forEach(i => {
      // Baris 1: Nama Item
      // Pastikan nama tidak > 32 char, jika ya potong
      let nama = i.nama;
      if (nama.length > 32) nama = nama.substring(0, 32); 
      esc.text(nama + "\n");
      
      // Baris 2: Qty x Harga ....... Subtotal
      let qtyStr = `${i.qty} x ${i.harga.toLocaleString('id-ID')}`;
      if (i.disc_bpjs > 0) qtyStr += " (BPJS)";
      let subStr = String(i.subtotal.toLocaleString('id-ID'));
      
      esc.text(rightAlignText(qtyStr, subStr) + "\n");
    });
    
    esc.text("--------------------------------\n");
    
    // TOTAL
    esc.bold(true);
    esc.text(rightAlignText("TOTAL:", String(d.totals.total.toLocaleString('id-ID'))) + "\n");
    esc.bold(false);
    
    esc.text("================================\n");
    esc.alignCenter();
    esc.text((GLOBAL_PROFILE.Pesan_Struk || "Terima Kasih Atas Kunjungan Anda") + "\n");
    esc.newline(3); // extra feed buat sobekan
    
    const payload = esc.generate();
    
    // Kirim secara chunk (agar tidak terpotong oleh Bluetooth MTU limit -- biasanya 512 bytes limit)
    // 100 bytes is very safe per chunk
    const MAX_CHUNK = 100;
    for (let i = 0; i < payload.length; i += MAX_CHUNK) {
      await btCharacteristic.writeValue(payload.slice(i, i + MAX_CHUNK));
    }
    
    showToast("Print Bluetooth Berhasil!");
  } catch (err) {
    console.error(err);
    alert("Gagal print bluetooth: " + err.message);
  }
}


function reprintTransaction(t) {
  try {
    const parsed = JSON.parse(t.Detail_JSON);
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    const total = parseFloat(t.Total_Bayar) || 0;

    LAST_TRANSACTION = {
      id: t.ID_Transaksi, date: t.Tanggal, cashier: t.Nama_Kasir,
      customerType: t['Tipe_Pasien (Umum/BPJS)'] || 'Umum',
      data: { items: items, method: t.Metode_Bayar || 'Cash' },
      totals: { sub: total, disc: 0, total: total }
    };

    let calcSub = 0, calcDisc = 0;
    items.forEach(i => {
      calcSub += (parseFloat(i.harga) || 0) * (parseInt(i.qty) || 0);
      calcDisc += (parseFloat(i.disc_bpjs) || 0) * (parseInt(i.qty) || 0);
    });
    if (calcSub > 0) LAST_TRANSACTION.totals = { sub: calcSub, disc: calcDisc, total: calcSub - calcDisc };

    populateReceiptPreview();
    dom.receiptModal.show();
  } catch (e) {
    showToast('Gagal membuka struk: ' + e.message, 'error');
  }
}

// --- RIWAYAT DATA API ---
async function loadHistoryData() {
  document.getElementById('table-history-trx').innerHTML = '<tr><td colspan="8" class="text-center py-4">Memuat...</td></tr>';
  document.getElementById('table-history-arus').innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat...</td></tr>';
  const filter = document.getElementById('history-filter') ? document.getElementById('history-filter').value : 'hari_ini';

  const res = await fetchApi('getHistoryData', filter);
  
  const trxBody = document.getElementById('table-history-trx');
  const aruBody = document.getElementById('table-history-arus');

  if (!res.success) {
    trxBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4"><i class="fa-solid fa-triangle-exclamation me-2"></i>${res.message}</td></tr>`;
    aruBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Gagal Memuat</td></tr>`;
    return;
  }

  // TRANSAKSI
  trxBody.innerHTML = '';
  if (res.data.transactions.length === 0) {
    trxBody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">Tidak ada transaksi pada periode ini.</td></tr>';
  }
  res.data.transactions.forEach((t, i) => {
    const detailId = 'trxDetail' + i;
    let itemsHtml = '<div class="text-muted small">Detail tidak tersedia</div>';
    try {
      const parsed = JSON.parse(t.Detail_JSON);
      const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
      if (items.length > 0) {
        itemsHtml = '<ul class="list-group list-group-flush border rounded-3">';
        items.forEach(item => {
          itemsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center bg-light small py-2">
            <span>${item.qty}x <strong>${item.nama}</strong></span>
            <span class="text-muted">${formatRp(item.subtotal)} ${parseFloat(item.disc_bpjs) > 0 ? '<span class="text-success">(BPJS)</span>' : ''}</span>
          </li>`;
        });
        itemsHtml += '</ul>';
      }
    } catch (e) { }

    trxBody.innerHTML += `
    <tr style="cursor: pointer;" data-bs-toggle="collapse" data-bs-target="#${detailId}" aria-expanded="false">
      <td class="text-muted"><i class="fa-solid fa-chevron-down small"></i></td>
      <td>${t.Tanggal}</td>
      <td><span class="badge bg-secondary font-monospace">${t.ID_Transaksi}</span></td>
      <td>${t['Tipe_Pasien (Umum/BPJS)'] === 'BPJS' ? '<span class="badge bg-success">BPJS</span>' : '<span class="badge bg-light text-dark border">Umum</span>'}</td>
      <td class="fw-bold text-success">${formatRp(t.Total_Bayar)}</td>
      <td><span class="badge bg-info text-dark">${t.Metode_Bayar || 'Cash'}</span></td>
      <td>${t.Nama_Kasir}</td>
      <td class="text-center"><button class="btn btn-sm btn-outline-dark" onclick="event.stopPropagation(); reprintTransaction(${JSON.stringify(t).replace(/"/g, '&quot;')})" title="Cetak Ulang"><i class="fa-solid fa-print"></i></button></td>
    </tr>
    <tr>
      <td colspan="8" class="p-0 border-0">
        <div class="collapse" id="${detailId}">
          <div class="p-3 border-start border-4 border-primary bg-light m-2 rounded shadow-sm">
             <h6 class="fw-bold mb-2 text-dark"><i class="fa-solid fa-receipt me-2"></i>Rincian Item</h6>
             ${itemsHtml}
          </div>
        </div>
      </td>
    </tr>`;
  });

  // ARUS KAS
  aruBody.innerHTML = '';
  if (res.data.arusKas.length === 0) {
    aruBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Tidak ada arus kas pada periode ini.</td></tr>';
  }
  res.data.arusKas.forEach((a, j) => {
    const arusDetailId = 'arusDetail' + j;
    const kategori = a['Kategori (Masuk Non-Jual/Keluar/Penjualan)'] || '';
    const isIncome = kategori === 'Penjualan' || kategori.includes('Masuk');
    let detailContent = '<div class="text-muted small">Tidak ada detail</div>';
    
    try {
      if (a.Detail_JSON) {
        const detail = JSON.parse(a.Detail_JSON);
        if (detail.type === 'penjualan' && detail.items && detail.items.length > 0) {
          detailContent = '<ul class="list-group list-group-flush border rounded-3">';
          detail.items.forEach(item => {
            detailContent += `<li class="list-group-item d-flex justify-content-between align-items-center bg-light small py-2">
              <span>${item.qty}x <strong>${item.nama}</strong></span>
              <span class="text-muted">${formatRp(item.subtotal)}</span>
            </li>`;
          });
          detailContent += '</ul>';
        } else if (detail.description) {
          detailContent = `<p class="mb-0 small">${detail.description}</p>`;
        }
      }
    } catch (e) { }

    if (a.Keterangan) detailContent = `<p class="mb-2 small text-muted"><i class="fa-solid fa-quote-left me-1"></i>${a.Keterangan}</p>` + detailContent;

    aruBody.innerHTML += `
    <tr style="cursor: pointer;" data-bs-toggle="collapse" data-bs-target="#${arusDetailId}" aria-expanded="false">
      <td class="text-muted"><i class="fa-solid fa-chevron-down small"></i></td>
      <td>${a.Tanggal}</td>
      <td><span class="badge ${isIncome ? 'bg-success' : 'bg-danger'}">${kategori}</span></td>
      <td class="fw-bold ${isIncome ? 'text-success' : 'text-danger'}">${isIncome ? '+' : '-'} ${formatRp(Math.abs(a.Nominal))}</td>
      <td><span class="badge bg-info text-dark">${a.Akun || '-'}</span></td>
      <td>${a.PIC || '-'}</td>
    </tr>
    <tr>
      <td colspan="6" class="p-0 border-0">
        <div class="collapse" id="${arusDetailId}">
          <div class="p-3 border-start border-4 border-warning bg-light m-2 rounded shadow-sm">
             <h6 class="fw-bold mb-2 text-dark"><i class="fa-solid fa-file-invoice me-2"></i>Detail</h6>
             ${detailContent}
          </div>
        </div>
      </td>
    </tr>`;
  });

  IS_RIWAYAT_STALE = false;
  RIWAYAT_LAST_FILTER = filter;
}

// --- MANAJEMEN STOK ---
function renderMasterStok() {
  const tb = document.getElementById('table-master-stok'); tb.innerHTML = '';
  GLOBAL_PRODUCTS.forEach(p => {
    const isB = String(p.Kategori).toLowerCase() === 'barang';
    const pJstr = JSON.stringify(p).replace(/"/g, '&quot;');
    const satuanText = p.Satuan && p.Satuan !== '-' ? `/${p.Satuan}` : '';
    tb.innerHTML += `<tr>
        <td><small class="text-muted">${p.ID}</small></td>
        <td class="fw-bold">${p.Nama}</td>
        <td>${p.Kategori}</td>
        <td>${formatRp(p.Harga)} ${satuanText}</td>
        <td class="${isB && p.Stok <= 5 ? 'text-danger fw-bold' : ''}">${isB ? p.Stok : '-'}</td>
        <td>${p['Status_BPJS (Full/Sebagian/Tidak)']}</td>
        <td><button class="btn btn-sm btn-outline-primary" onclick="editProduct('${pJstr}')"><i class="fa-solid fa-pen-to-square"></i></button></td>
      </tr>`;
  });
}

async function loadStockLogs() {
  const tb = document.getElementById('table-stock-logs');
  tb.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Memuat data...</td></tr>';
  const filter = document.getElementById('stock-filter') ? document.getElementById('stock-filter').value : 'hari_ini';

  const res = await fetchApi('getStockLogs', filter);
  if (!res.success) {
    tb.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Error: ${res.message}</td></tr>`;
    return;
  }
  tb.innerHTML = '';
  if (res.data.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Tidak ada riwayat pergerakan stok.</td></tr>';
    return;
  }

  res.data.forEach((l, i) => {
    const isKeluar = l['Jenis (Penjualan/Masuk/Keluar)'] === 'Penjualan' || l['Jenis (Penjualan/Masuk/Keluar)'] === 'Keluar';
    const detailId = 'stockLogDetail' + i;
    let detailHtml = '<div class="text-muted small">No Detail</div>';
    
    try {
      const parsed = JSON.parse(l.Detail_Stok_JSON);
      if (parsed && parsed.length > 0) {
        detailHtml = '<ul class="list-group list-group-flush border rounded-3">';
        parsed.forEach(p => {
          detailHtml += `<li class="list-group-item d-flex justify-content-between align-items-center bg-light small py-2">
            <span><strong>${p.nama || p.id}</strong></span>
            <span class="fw-bold ${p.qty_keluar ? 'text-danger' : 'text-success'}">${p.qty_keluar ? '-' : '+'}${p.qty_keluar || p.qty_masuk || 0}</span>
          </li>`;
        });
        detailHtml += '</ul>';
      }
    } catch (e) { }

    tb.innerHTML += `
      <tr style="cursor: pointer;" data-bs-toggle="collapse" data-bs-target="#${detailId}" aria-expanded="false">
        <td class="text-muted"><i class="fa-solid fa-chevron-down small"></i></td>
        <td>${l.Tanggal}</td>
        <td class="fw-bold ${isKeluar ? 'text-danger' : 'text-success'}"><i class="fa-solid ${isKeluar ? 'fa-arrow-down' : 'fa-arrow-up'} me-1"></i>${l['Jenis (Penjualan/Masuk/Keluar)']}</td>
        <td><span class="badge bg-secondary font-monospace">${l.ID_Log}</span></td>
        <td>${l.PIC}</td>
      </tr>
      <tr>
        <td colspan="5" class="p-0 border-0">
          <div class="collapse" id="${detailId}">
            <div class="p-3 border-start border-4 border-info bg-light m-2 rounded shadow-sm">
               <h6 class="fw-bold mb-2 text-dark"><i class="fa-solid fa-boxes-stacked me-2"></i>Item Terdampak</h6>
               ${detailHtml}
            </div>
          </div>
        </td>
      </tr>`;
  });
  IS_STOK_STALE = false;
}

// Tambah modal functions
function openAddProductModal() {
  document.getElementById('productModalTitle').innerText = "Buat Produk Baru";
  document.getElementById('btn-prod-delete').classList.add('d-none');
  document.getElementById('prod-form-id').value = "";
  document.getElementById('prod-form-name').value = "";
  document.getElementById('prod-form-uom').value = "";
  document.getElementById('prod-form-price').value = 0;

  document.getElementById('prod-form-bpjs').value = "Tidak";
  document.getElementById('prod-form-bpjs').dispatchEvent(new Event('change'));
  document.getElementById('prod-form-bpjs-nilai').value = "";

  document.getElementById('prod-current-stock').innerText = 0;
  document.getElementById('prod-form-add-stock').value = 0;
  document.getElementById('prod-form-stock-reason').value = "Stok Awal";
  document.getElementById('prod-form-stock-box').style.display = "block"; 

  dom.productModal.show();
}

function editProduct(prodJsonStr) {
  const p = JSON.parse(prodJsonStr);
  document.getElementById('productModalTitle').innerText = "Edit Produk / Add Stok";
  document.getElementById('btn-prod-delete').classList.remove('d-none');
  document.getElementById('btn-prod-delete').onclick = () => { deleteProductRequest(p.ID); };

  document.getElementById('prod-form-id').value = p.ID;
  document.getElementById('prod-form-name').value = p.Nama;
  document.getElementById('prod-form-cat').value = p.Kategori;
  document.getElementById('prod-form-uom').value = p.Satuan || '';
  document.getElementById('prod-form-price').value = p.Harga;

  document.getElementById('prod-form-bpjs').value = p['Status_BPJS (Full/Sebagian/Tidak)'];
  document.getElementById('prod-form-bpjs').dispatchEvent(new Event('change'));
  document.getElementById('prod-form-bpjs-nilai').value = p.Nilai_Tanggungan || 0;

  if (String(p.Kategori).toLowerCase() == "barang") {
    document.getElementById('prod-form-stock-box').style.display = "block";
    document.getElementById('prod-current-stock').innerText = p.Stok;
    document.getElementById('prod-form-add-stock').value = 0;
    document.getElementById('prod-form-stock-reason').value = "";
  } else {
    document.getElementById('prod-form-stock-box').style.display = "none";
  }

  dom.productModal.show();
}

async function saveProductForm() {
  const isNew = !document.getElementById('prod-form-id').value;
  const addStockVal = parseInt(document.getElementById('prod-form-add-stock').value) || 0;
  let baseStock = parseInt(document.getElementById('prod-current-stock').innerText) || 0;
  if (isNew) baseStock = addStockVal;

  const payload = {
    id: document.getElementById('prod-form-id').value,
    nama: document.getElementById('prod-form-name').value,
    kategori: document.getElementById('prod-form-cat').value,
    satuan: document.getElementById('prod-form-uom').value,
    harga: parseFloat(document.getElementById('prod-form-price').value) || 0,
    bpjs_status: document.getElementById('prod-form-bpjs').value,
    bpjs_nilai: parseFloat(document.getElementById('prod-form-bpjs-nilai').value) || 0,
    stok: baseStock
  };

  if (!payload.nama) { alert("Nama produk tidak boleh kosong!"); return; }

  dom.loading.style.display = 'flex'; dom.loading.style.opacity = '1';

  const res = await fetchApi('saveProductData', payload);
  if (res.success) {
    GLOBAL_PRODUCTS = res.products; renderMasterStok(); renderProducts('all', '');
    
    if (!isNew && payload.kategori === 'Barang' && addStockVal !== 0) {
      const stockPayload = [{ id: payload.id, qty_added: addStockVal, reason: document.getElementById('prod-form-stock-reason').value || "Manual Update" }];
      const sRes = await fetchApi('updateStock', stockPayload);
      
      if (sRes.success) { 
        GLOBAL_PRODUCTS = sRes.products; renderMasterStok(); renderProducts('all', ''); 
        dom.productModal.hide(); alert("Produk & Stok tersimpan."); 
      } else alert(sRes.message);
    } else {
      dom.productModal.hide(); alert(res.message);
    }
  } else {
    alert(res.message);
  }
  dom.loading.style.opacity = '0'; setTimeout(() => dom.loading.style.display = 'none', 300);
}

async function deleteProductRequest(id) {
  if (confirm("Yakin hapus produk ini permanen?")) {
    dom.loading.style.display = 'flex'; dom.loading.style.opacity = '1';
    const res = await fetchApi('deleteProduct', id);
    dom.loading.style.opacity = '0'; setTimeout(() => dom.loading.style.display = 'none', 300);
    
    if (res.success) { GLOBAL_PRODUCTS = res.products; renderMasterStok(); renderProducts('all', ''); dom.productModal.hide(); }
    else alert(res.message);
  }
}

// LAPORAN KEUANGAN 
let flowChart = null;
let catChart = null;

async function loadReportData() {
  const filter = document.getElementById('laporan-filter').value;
  const tMasuk = document.getElementById('report-kas-masuk');
  const tKeluar = document.getElementById('report-kas-keluar');
  const tNet = document.getElementById('report-net-kas');
  const tAcc = document.getElementById('report-account-balances');

  tMasuk.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  tKeluar.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  tNet.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  tAcc.innerHTML = '<tr><td colspan="2" class="text-center py-4">Memuat data...</td></tr>';

  const res = await fetchApi('getReportData', filter);
  
  if (!res.success) {
    showToast(res.message, 'error');
    tAcc.innerHTML = `<tr><td colspan="2" class="text-center text-danger py-4">${res.message}</td></tr>`;
    return;
  }

  const data = res.data;
  tMasuk.innerText = formatRp(data.totalMasuk);
  tKeluar.innerText = formatRp(data.totalKeluar);
  tNet.innerText = formatRp(data.netKas);
  tNet.className = 'fw-bold m-0 ' + (data.netKas > 0 ? 'text-success' : (data.netKas < 0 ? 'text-danger' : 'text-dark'));

  document.getElementById('report-rincian-jual').innerText = '+' + formatRp(data.rincian.penjualan);
  document.getElementById('report-rincian-lain').innerText = '+' + formatRp(data.rincian.masukLainnya);
  document.getElementById('report-rincian-keluar').innerText = '-' + formatRp(data.rincian.keluar);
  document.getElementById('report-rincian-net').innerText = formatRp(data.netKas);
  document.getElementById('report-rincian-net').className = 'text-end pe-4 fw-bold fs-6 ' + (data.netKas > 0 ? 'text-success' : data.netKas < 0 ? 'text-danger' : 'text-dark');

  tAcc.innerHTML = '';
  if (data.accounts.length === 0) {
    tAcc.innerHTML = '<tr><td colspan="2" class="text-center py-4 text-muted">Belum ada akun</td></tr>';
  } else {
    data.accounts.forEach(acc => {
      tAcc.innerHTML += `
         <tr>
           <td class="ps-4 fw-bold text-dark">${acc.name}</td>
           <td class="text-end pe-4 font-monospace fs-6 ${acc.saldo < 0 ? 'text-danger' : 'text-success'}">${formatRp(acc.saldo)}</td>
         </tr>
       `;
    });
  }

  // --- RENDER CHARTS ---
  renderCharts(data.chartData);
}

function renderCharts(chartData) {
  if (!chartData) return;

  // 1. Cashflow Chart (Line/Bar)
  const ctxFlow = document.getElementById('cashflowChart');
  if (flowChart) flowChart.destroy();
  
  if (chartData.dailyBreakdown && chartData.dailyBreakdown.length > 0) {
    const labels = chartData.dailyBreakdown.map(d => d.date);
    const masuk = chartData.dailyBreakdown.map(d => d.masuk);
    const keluar = chartData.dailyBreakdown.map(d => d.keluar);

    flowChart = new Chart(ctxFlow, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Kas Masuk', data: masuk, backgroundColor: '#2DCE89', borderRadius: 4 },
          { label: 'Kas Keluar', data: keluar, backgroundColor: '#f5365c', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  // 2. Category Pie Chart
  const ctxCat = document.getElementById('categoryChart');
  if (catChart) catChart.destroy();
  
  if (chartData.categoryBreakdown) {
    const catLabels = Object.keys(chartData.categoryBreakdown);
    const catData = Object.values(chartData.categoryBreakdown);

    catChart = new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: ['#5E72E4', '#11cdef', '#fb6340', '#ffd600', '#8965e0'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
}

// --- OWNER AREA ---
function renderOwnerView() {
  document.getElementById('setup-nama-bisnis').value = GLOBAL_PROFILE.Nama_Bisnis || '';
  document.getElementById('setup-alamat').value = GLOBAL_PROFILE.Alamat || '';
  document.getElementById('setup-telepon').value = GLOBAL_PROFILE.Telepon || '';
  document.getElementById('setup-pesan-nota').value = GLOBAL_PROFILE.Pesan_Nota || '';

  const tbAccounts = document.getElementById('table-owner-accounts');
  tbAccounts.innerHTML = '';
  GLOBAL_ACCOUNTS.forEach(a => {
    tbAccounts.innerHTML += `
      <tr>
        <td>${a.ID}</td>
        <td>${a.Nama_Akun}</td>
        <td class="text-end fw-bold">Rp ${parseInt(a.Saldo || 0).toLocaleString('id-ID')}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary" onclick='editAccount(${JSON.stringify(a).replace(/'/g, "&apos;")})'><i class="fa-solid fa-edit"></i></button>
        </td>
      </tr>
    `;
  });
  if (GLOBAL_ACCOUNTS.length === 0) tbAccounts.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada akun.</td></tr>`;
  
  loadOwnerUsers();
}

async function loadOwnerUsers() {
  const tbUsers = document.getElementById('table-owner-users');
  tbUsers.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Memuat user...</td></tr>`;
  
  const res = await fetchApi('getUsers', null, sessionPin);
  if (res.success) {
    tbUsers.innerHTML = '';
    res.data.forEach(u => {
      tbUsers.innerHTML += `
        <tr>
          <td>${u.Nama}</td>
          <td><span class="badge ${u.Role === 'Owner' ? 'bg-danger' : 'bg-primary'}">${u.Role}</span></td>
          <td>***</td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-primary" onclick='editUser(${JSON.stringify(u).replace(/'/g, "&apos;")})'><i class="fa-solid fa-edit"></i></button>
          </td>
        </tr>
      `;
    });
  } else {
    tbUsers.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Gagal memuat user.</td></tr>`;
  }
}

async function saveProfileSetup() {
  const payload = {
    Nama_Bisnis: document.getElementById('setup-nama-bisnis').value,
    Alamat: document.getElementById('setup-alamat').value,
    Telepon: document.getElementById('setup-telepon').value,
    Pesan_Nota: document.getElementById('setup-pesan-nota').value
  };
  dom.loading.style.display = 'flex';
  const res = await fetchApi('saveProfileData', payload, sessionPin);
  dom.loading.style.display = 'none';
  
  if (res.success) {
    GLOBAL_PROFILE = res.profile;
    showToast("Profil berhasil disimpan!");
    dom.appTitle.innerText = GLOBAL_PROFILE.Nama_Bisnis || 'Polindes POS';
  } else showToast(res.message, 'error');
}

function lockOwnerArea() {
  sessionPin = '';
  switchView('kasir');
  showToast("Akses Owner telah dikunci.", "warning");
}

// User & Account Modal Handlers (Omitting bulk content length for brevity but logic is similar with await fetchApi)
function openUserModal() {
  document.getElementById('userModalTitle').innerText = 'Tambah User';
  document.getElementById('user-old-name').value = '';
  document.getElementById('user-nama').value = '';
  document.getElementById('user-role').value = 'Kasir';
  document.getElementById('user-pin').value = '';
  document.getElementById('btn-user-delete').classList.add('d-none');
  dom.userModal.show();
}

function editUser(u) {
  document.getElementById('userModalTitle').innerText = 'Edit User';
  document.getElementById('user-old-name').value = u.Nama;
  document.getElementById('user-nama').value = u.Nama;
  document.getElementById('user-role').value = u.Role;
  document.getElementById('user-pin').value = ''; // Don't show PIN
  document.getElementById('btn-user-delete').classList.remove('d-none');
  dom.userModal.show();
}

async function saveUser() {
  const payload = {
    oldName: document.getElementById('user-old-name').value,
    Nama: document.getElementById('user-nama').value,
    Role: document.getElementById('user-role').value,
    PIN: document.getElementById('user-pin').value
  };
  if (!payload.Nama) { showToast("Nama wajib diisi!", "warning"); return; }

  dom.loading.style.display = 'flex';
  const res = await fetchApi('saveUserData', payload, sessionPin);
  dom.loading.style.display = 'none';
  
  if (res.success) {
    showToast(res.message); dom.userModal.hide(); loadOwnerUsers();
  } else showToast(res.message, 'error');
}

async function deleteUser() {
  if (!confirm("Yakin hapus user ini?")) return;
  const name = document.getElementById('user-old-name').value;
  dom.loading.style.display = 'flex';
  const res = await fetchApi('deleteUser', name, sessionPin);
  dom.loading.style.display = 'none';
  if (res.success) { showToast(res.message); dom.userModal.hide(); loadOwnerUsers(); } 
  else showToast(res.message, 'error');
}

function openAccountModal() { document.getElementById('account-old-id').value = ''; document.getElementById('account-id').value = ''; document.getElementById('account-nama').value = ''; document.getElementById('account-saldo').value = ''; document.getElementById('btn-account-delete').classList.add('d-none'); dom.accountModal.show(); }
function editAccount(a) { document.getElementById('account-old-id').value = a.ID; document.getElementById('account-id').value = a.ID; document.getElementById('account-nama').value = a.Nama_Akun; document.getElementById('account-saldo').value = ''; document.getElementById('btn-account-delete').classList.remove('d-none'); dom.accountModal.show(); }

async function saveAccount() {
  const payload = {
    oldID: document.getElementById('account-old-id').value,
    ID: document.getElementById('account-id').value,
    Nama_Akun: document.getElementById('account-nama').value,
    NewSaldoStr: document.getElementById('account-saldo').value
  };
  if (!payload.ID || !payload.Nama_Akun) { showToast("ID & Nama Akun wajib diisi!", "warning"); return; }
  dom.loading.style.display = 'flex';
  const res = await fetchApi('saveAccountData', payload, sessionPin);
  dom.loading.style.display = 'none';
  if (res.success) { showToast(res.message); dom.accountModal.hide(); GLOBAL_ACCOUNTS = res.accounts; renderOwnerView(); refreshPaymentDropdown(); } 
  else showToast(res.message, 'error');
}

async function deleteAccount() {
  if (!confirm("Yakin hapus akun ini?")) return;
  const id = document.getElementById('account-old-id').value;
  dom.loading.style.display = 'flex';
  const res = await fetchApi('deleteAccount', id, sessionPin);
  dom.loading.style.display = 'none';
  if (res.success) { showToast(res.message); dom.accountModal.hide(); GLOBAL_ACCOUNTS = res.accounts; renderOwnerView(); refreshPaymentDropdown(); } 
  else showToast(res.message, 'error');
}

// Bulk & Cash Modals setup omitted for brevity but they wrap variables to PENDING_ACTION like before
function openCashEntryModal() { document.getElementById('cash-form-type').value = 'Masuk Non-Jual'; document.getElementById('cash-form-amount').value = ''; document.getElementById('cash-form-desc').value = ''; const accSelect = document.getElementById('cash-form-account'); accSelect.innerHTML = ''; GLOBAL_ACCOUNTS.forEach(a => { accSelect.innerHTML += `<option value="${a.Nama_Akun}">${a.Nama_Akun}</option>`; }); dom.cashEntryModal.show(); }
function prepareCashEntry() { const type = document.getElementById('cash-form-type').value; const amount = parseFloat(document.getElementById('cash-form-amount').value) || 0; const account = document.getElementById('cash-form-account').value; const desc = document.getElementById('cash-form-desc').value; if(amount<=0 || !desc) {alert('Error input'); return;} dom.cashEntryModal.hide(); PENDING_ACTION = {type: 'cashEntry', payload: {type, amount, account, desc}}; openPinModal(); }
async function doCashEntry(cashierName, passedPin) { dom.loading.style.display='flex'; const res = await fetchApi('saveCashEntry', PENDING_ACTION.payload, passedPin); dom.loading.style.display='none'; if(res.success){ IS_RIWAYAT_STALE=true; alert('Sukses dsimpan'); loadHistoryData();} else alert(res.message); }

function openBulkStockModal() { document.getElementById('bulk-stock-reason').value = ''; document.getElementById('bulk-stock-rows').innerHTML = ''; addBulkStockRow(); dom.bulkStockModal ? dom.bulkStockModal.show() : (dom.bulkStockModal = new bootstrap.Modal(document.getElementById('bulkStockModal'))).show(); }
function addBulkStockRow() { const rowId = Date.now(); let opt = '<option value="">-- Pilih Barang --</option>'; GLOBAL_PRODUCTS.filter(p=>p.Kategori==='Barang').forEach(p=> {opt += `<option value="${p.ID}" data-stock="${p.Stok}">${p.Nama}</option>`}); document.getElementById('bulk-stock-rows').insertAdjacentHTML('beforeend', `<div class="row g-2 mb-2 bulk-row" id="row-${rowId}"><div class="col-7"><select class="form-select bulk-item-select">${opt}</select></div><div class="col-3"><input type="number" class="form-control bulk-item-qty" placeholder="Qty"></div><div class="col-2"><button class="btn btn-outline-danger btn-sm w-100" onclick="document.getElementById('row-${rowId}').remove()"><i class="fa-solid fa-trash"></i></button></div></div>`); }
function prepareBulkStock() { const type = document.getElementById('bulk-stock-type').value; const reason = document.getElementById('bulk-stock-reason').value; const rows = document.querySelectorAll('.bulk-row'); const items = []; let err=false; rows.forEach(r => { const sel = r.querySelector('select'); const qty = parseInt(r.querySelector('input').value)||0; if(!sel.value || qty<=0) err=true; const maxs = parseInt(sel.options[sel.selectedIndex].dataset.stock)||0; if(type==='Keluar'&&qty>maxs) err=true; items.push({id: sel.value, nama: sel.options[sel.selectedIndex].text, qty: qty, currentStock: maxs}); }); if(err || !reason) {alert("Cek input!"); return;} dom.bulkStockModal.hide(); PENDING_ACTION = {type: 'bulkStock', payload: {type, reason, items}}; openPinModal(); }
async function doBulkStock(cashierName, passedPin) { dom.loading.style.display='flex'; const res = await fetchApi('saveBulkStock', PENDING_ACTION.payload, passedPin); dom.loading.style.display='none'; if(res.success){ IS_STOK_STALE=true; GLOBAL_PRODUCTS=res.products; renderMasterStok(); alert('Sukses');} else alert(res.message); }

function showPrinterGuide() { showToast('1. Pair printer bluetooth\n2. Klik Cetak di struk', 'info'); }

async function refreshOwnerData() {
  dom.loading.style.display = 'flex';
  const res = await fetchApi('getDashboardData');
  dom.loading.style.display = 'none';
  if(res.success) {
    GLOBAL_PROFILE = res.data.profile;
    GLOBAL_ACCOUNTS = res.data.accounts;
    renderOwnerView();
    showToast("Data diperbarui!");
  }
}

// Register PWA Service Worker (Will be created in Phase 5)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    console.log('App is PWA ready', reg.scope);
  }).catch(err => console.log('SW ref failed', err));
}
