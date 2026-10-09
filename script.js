/* =========================================================================
 * E-SERTIFIKAT — script.js
 * Berisi:
 *  1. CONFIG           -> alamat API GAS & pengaturan default
 *  2. API              -> helper fetch ke Google Apps Script Web App
 *  3. CertRenderer     -> menggambar sertifikat (blangko + data + QR) ke <canvas>
 *  4. Public page logic-> pencarian, preview, unduh PDF, verifikasi via QR
 *
 * File ini dipakai bersama oleh index.html DAN admin.html (admin.html juga
 * memuat admin.js untuk fitur dashboard).
 * ========================================================================= */

/* ---------------------------------------------------------------------
 * 1. KONFIGURASI
 * ------------------------------------------------------------------- */
const CONFIG = {
  // GANTI dengan URL Web App hasil deploy Google Apps Script (lihat PANDUAN-DEPLOY.md)
  API_URL: 'https://script.google.com/macros/s/AKfycbxCEnQHs0rjFfQar16v6giRqfk-fM7NXMxE7xjb1UX-CYFLDZ8b5yAVXB7HzVp1Hpb5KA/exec',

  EVENT_NAME: 'Pelatihan Instruktur Senam Bogor Bugar Tahun 2026',
  EVENT_LOCATION: 'Kecamatan Cigombong',

  // Ukuran kanvas sertifikat -> rasio A4 Landscape (297mm x 210mm).
  // ~240dpi: tajam untuk cetak, tapi jauh lebih ringan di memori HP dibanding 300dpi penuh.
  CERT_WIDTH: 2808,
  CERT_HEIGHT: 1985,

  // Posisi elemen di atas blangko, dalam PERSEN (0-1) dari lebar/tinggi kanvas.
  // Blangko sudah lengkap (hanya Nama & Kode yang dicetak dinamis oleh sistem).
  // Nilai default ini bisa ditimpa oleh Settings yang disimpan admin (lihat loadSettings()).
  LAYOUT: {
    kode: { xPct: 0.945, yPct: 0.075, align: 'right',  color: '#0B3D91', fontFamily: 'Inter',   fontWeight: '700', fontSize: 34 },
    nama: { xPct: 0.5,   yPct: 0.46,  align: 'center', color: '#0B3D91', fontFamily: 'Archivo', fontWeight: '900', fontSize: 96 },
    // Kolom "Sebagai" (PESERTA / PANITIA / teks manual). Nonaktif secara default
    // supaya sertifikat lama tidak berubah sampai admin menyalakannya di Pengaturan.
    // `text` = isi default untuk semua sertifikat; bisa ditimpa per orang lewat kolom "Sebagai" di data peserta.
    sebagai: { enabled: false, text: 'PESERTA', xPct: 0.5, yPct: 0.53, align: 'center', color: '#0B3D91', fontFamily: 'Montserrat', fontWeight: '700', fontSize: 52 },
    qr:   { xPct: 0.90,  yPct: 0.855, sizePct: 0.10 },
    // Aset gambar tambahan yang bisa ditempel di atas blangko, posisinya bisa
    // diatur admin lewat panel "Logo, TTD & Stempel". sizePct = lebar aset
    // relatif terhadap lebar kanvas sertifikat; tinggi menyesuaikan rasio asli gambar.
    logo:     { xPct: 0.085, yPct: 0.085, sizePct: 0.09, enabled: true },
    ttdKkks:  { xPct: 0.30,  yPct: 0.865, sizePct: 0.12, enabled: true },
    stempel:  { xPct: 0.50,  yPct: 0.835, sizePct: 0.11, enabled: true },
    ttdKkgo:  { xPct: 0.70,  yPct: 0.865, sizePct: 0.12, enabled: true }
  },

  // Kunci setiap aset gambar yang dikelola admin (unggah & pratinjau) di panel
  // "Logo Web, TTD & Stempel". Dipakai admin.js untuk dropzone/pratinjau.
  OVERLAY_ASSET_KEYS: ['logo', 'ttdKkks', 'stempel', 'ttdKkgo'],

  // Dari daftar di atas, hanya aset berikut yang benar-benar DIGAMBAR di atas
  // blangko sertifikat oleh CertRenderer.draw(). Logo Web SENGAJA tidak
  // disertakan di sini karena logo hanya tampil sebagai logo situs (header),
  // bukan ditempel pada lembar sertifikat.
  CERT_ASSET_KEYS: ['ttdKkks', 'stempel', 'ttdKkgo'],

  // Pilihan cepat untuk kolom "Sebagai" (selain isian manual)
  SEBAGAI_CHOICES: ['PESERTA', 'PANITIA'],

  // Pilihan jenis font yang tersedia untuk Nama & Kode di menu Pengaturan
  FONT_CHOICES: ['Archivo', 'Inter', 'Playfair Display', 'Montserrat', 'Georgia', 'Times New Roman', 'Arial'],

  // URL dasar untuk link verifikasi yang ditanam di QR Code (auto terisi dari lokasi halaman saat ini)
  get VERIFY_BASE_URL() {
    return window.location.origin + window.location.pathname.replace(/admin\.html$/, 'index.html');
  }
};

/* ---------------------------------------------------------------------
 * Util bersama: aset & logo
 * ------------------------------------------------------------------- */
// Mengubah objek settings (hasil getSettings) menjadi peta { blangko, logo,
// ttdKkks, stempel, ttdKkgo } berisi data URI, siap dipakai CertRenderer.draw().
function assetsFromSettings(settings) {
  if (!settings) return {};
  return {
    blangko: settings.blangkoUrl,
    logo: settings.logoUrl,
    ttdKkks: settings.ttdKkksUrl,
    stempel: settings.stempelUrl,
    ttdKkgo: settings.ttdKkgoUrl
  };
}

// Teks "Sebagai" yang dicetak: nilai khusus peserta (jika ada), kalau tidak pakai default dari Pengaturan.
function resolveSebagai(data, layout) {
  const cfg = (layout || CONFIG.LAYOUT).sebagai || {};
  return String((data && data.sebagai) || cfg.text || '').trim();
}

// Memuat skrip pihak ketiga hanya saat dibutuhkan (mis. jsPDF baru dimuat ketika tombol Download ditekan),
// supaya halaman peserta di HP tidak menunggu pustaka yang belum tentu dipakai.
const _scriptPromises = {};
function loadScriptOnce(src) {
  if (!_scriptPromises[src]) {
    _scriptPromises[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => { delete _scriptPromises[src]; reject(new Error('Gagal memuat pustaka: ' + src)); };
      document.head.appendChild(el);
    });
  }
  return _scriptPromises[src];
}
async function ensureJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  return window.jspdf.jsPDF;
}

// Menempatkan logo web yang diunggah admin ke semua elemen .brand-mark di
// halaman (header publik, sidebar admin, layar login), menggantikan tanda "SB".
function applyBrandLogo(url) {
  if (!url) return;
  document.querySelectorAll('.brand-mark').forEach((el) => {
    if (el.dataset.logoApplied === url) return;
    el.innerHTML = `<img src="${url}" alt="Logo">`;
    el.classList.add('has-logo');
    el.dataset.logoApplied = url;
  });
}

/* ---------------------------------------------------------------------
 * 2. API HELPER
 *   Trik penting: request POST dikirim dengan Content-Type "text/plain"
 *   supaya browser TIDAK melakukan CORS preflight (OPTIONS), karena
 *   Google Apps Script Web App tidak menangani preflight OPTIONS.
 * ------------------------------------------------------------------- */
const API = {
  async get(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: 'GET' });
    return res.json();
  },
  async post(action, payload = {}) {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        token: (typeof Admin !== 'undefined' && Admin.getToken) ? Admin.getToken() : undefined,
        ...payload
      })
    });
    return res.json();
  }
};

/* ---------------------------------------------------------------------
 * 3. RENDER SERTIFIKAT KE CANVAS
 * ------------------------------------------------------------------- */
const CertRenderer = {
  _blangkoCache: null,
  _blangkoUrl: null,
  _assetCache: {},

  // Memuat gambar aset overlay (logo/TTD/stempel). Aset ini berupa data URI
  // (lihat getSettings di code.gs), jadi tidak ada isu CORS.
  loadAssetImage(url) {
    if (!url) return Promise.resolve(null);
    if (this._assetCache[url]) return Promise.resolve(this._assetCache[url]);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { this._assetCache[url] = im; resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
  },

  async loadBlangko(url) {
    if (this._blangkoCache && this._blangkoUrl === url) return this._blangkoCache;

    const tryLoad = (withCors) => new Promise((resolve, reject) => {
      const im = new Image();
      if (withCors) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });

    let img;
    let tainted = false;
    if (/^data:/i.test(url)) {
      // Data URI tidak pernah kena CORS -> langsung muat, tanpa percobaan ganda.
      img = await tryLoad(false);
    } else {
      try {
        img = await tryLoad(true);
      } catch (e) {
        // Sebagian jaringan seluler/proxy data-saver memblokir permintaan gambar bermode CORS.
        console.warn('Gagal memuat blangko dengan mode CORS, mencoba ulang tanpa CORS...', e);
        img = await tryLoad(false);
        tainted = true;
      }
    }
    // Dekode di luar proses gambar kanvas, supaya drawImage() tidak membeku di HP.
    try { if (img.decode) await img.decode(); } catch (e) { /* abaikan */ }
    this._blangkoCache = img;
    this._blangkoUrl = url;
    this._blangkoTainted = tainted;
    return img;
  },

  // Membuat QR Code sebagai <canvas> (qrcodejs menggambar secara sinkron, jadi tidak perlu menunggu).
  async makeQrCanvas(text) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
    document.body.appendChild(holder);
    try {
      // eslint-disable-next-line no-undef
      new QRCode(holder, { text, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
      let qc = holder.querySelector('canvas');
      if (!qc) { await new Promise((r) => setTimeout(r, 60)); qc = holder.querySelector('canvas'); }
      if (!qc) return null;
      const copy = document.createElement('canvas');
      copy.width = qc.width; copy.height = qc.height;
      copy.getContext('2d').drawImage(qc, 0, 0);
      return copy;
    } catch (e) {
      console.warn('Gagal membuat QR Code', e);
      return null;
    } finally {
      holder.remove();
    }
  },

  /**
   * Menggambar satu sertifikat lengkap ke sebuah <canvas> yang diberikan.
   * data: { kode, nama, instansi, tanggal, sebagai? }
   * assets: { blangko, logo, ttdKkks, stempel, ttdKkgo } — masing-masing data URI
   * layout: opsional, override CONFIG.LAYOUT
   * opts.scale: faktor ukuran kanvas (1 = penuh 2808x1985, 0.5 = pratinjau ringan untuk layar HP).
   *             Ukuran font ikut diskalakan, jadi hasilnya identik, hanya lebih ringan.
   */
  async draw(canvas, data, assets, layout, opts) {
    if (typeof assets === 'string') assets = { blangko: assets }; // kompatibilitas lama
    assets = assets || {};
    const scale = (opts && opts.scale) || 1;
    const L = layout || CONFIG.LAYOUT;
    const W = Math.round(CONFIG.CERT_WIDTH * scale), H = Math.round(CONFIG.CERT_HEIGHT * scale);
    const fontString = (cfg) => `${cfg.fontWeight || '400'} ${Math.round(cfg.fontSize * scale)}px "${cfg.fontFamily}"`;
    const sebagaiText = resolveSebagai(data, L);
    const textKeys = ['kode', 'nama', 'sebagai'].filter((k) => L[k] && (k !== 'sebagai' || (L[k].enabled && sebagaiText)));

    // ---- Mulai SEMUA pemuatan sekaligus (paralel), bukan satu per satu ----
    const blangkoP = assets.blangko
      ? this.loadBlangko(assets.blangko).then((img) => ({ img }), (err) => ({ err }))
      : Promise.resolve(null);

    // Font web: dibatasi 3 detik. Jaringan lambat -> pakai font cadangan, jangan membuat peserta menunggu.
    const fontsP = Promise.race([
      Promise.all(textKeys.map((k) => document.fonts.load(fontString(L[k]), 'Aa Bb'))).catch(() => {}),
      new Promise((r) => setTimeout(r, 3000))
    ]);

    const assetP = Promise.all(CONFIG.CERT_ASSET_KEYS.map(async (key) => {
      const cfg = L[key];
      const url = assets[key];
      if (!cfg || !url || cfg.enabled === false) return null;
      try { return { key, cfg, img: await this.loadAssetImage(url) }; }
      catch (e) { console.warn(`Gagal memuat aset "${key}":`, e); return null; }
    }));

    const qrCfg = L.qr;
    const qrP = qrCfg
      ? this.makeQrCanvas(`${CONFIG.VERIFY_BASE_URL}?verify=${encodeURIComponent(data.kode)}`)
      : Promise.resolve(null);

    const [blangko, , assetImgs, qrCanvas] = await Promise.all([blangkoP, fontsP, assetP, qrP]);

    // ---- Menggambar (semuanya sudah siap, jadi cepat) ----
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (blangko && blangko.img) {
      ctx.drawImage(blangko.img, 0, 0, W, H);
    } else if (blangko && blangko.err) {
      ctx.fillStyle = '#F5F6F0';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#D9481F';
      ctx.lineWidth = 10 * scale;
      ctx.strokeRect(30 * scale, 30 * scale, W - 60 * scale, H - 60 * scale);
      ctx.fillStyle = '#B23A17';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(42 * scale)}px Inter, Arial, sans-serif`;
      ctx.fillText('Gagal memuat gambar blangko sertifikat.', W / 2, H / 2 - 30 * scale);
      ctx.font = `400 ${Math.round(32 * scale)}px Inter, Arial, sans-serif`;
      ctx.fillText('Coba muat ulang halaman ini.', W / 2, H / 2 + 30 * scale);
      console.error('Gagal memuat blangko:', blangko.err);
    }

    const drawText = (key, text) => {
      const cfg = L[key];
      if (!cfg || !text) return;
      ctx.font = fontString(cfg);
      ctx.fillStyle = cfg.color;
      ctx.textAlign = cfg.align;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, W * cfg.xPct, H * cfg.yPct);
    };

    // Kode & Nama selalu dicetak; "Sebagai" hanya bila diaktifkan admin.
    drawText('kode', data.kode);
    drawText('nama', data.nama);
    if (L.sebagai && L.sebagai.enabled) drawText('sebagai', sebagaiText);

    // TTD Ketua KKKS, Stempel, TTD Ketua KKGO (Logo Web tidak ikut digambar di sertifikat).
    for (const item of assetImgs) {
      if (!item || !item.img) continue;
      const { cfg, img } = item;
      const w = W * cfg.sizePct;
      const h = w * (img.naturalHeight / img.naturalWidth || 1);
      ctx.drawImage(img, W * cfg.xPct - w / 2, H * cfg.yPct - h / 2, w, h);
    }

    if (qrCfg && qrCanvas) {
      const sizePx = Math.round(W * qrCfg.sizePct);
      ctx.drawImage(qrCanvas, W * qrCfg.xPct - sizePx / 2, H * qrCfg.yPct - sizePx / 2, sizePx, sizePx);
    }

    return canvas;
  },

  /** Ekspor canvas sertifikat menjadi PDF A4 Landscape berkualitas tinggi */
  async canvasToPdfBlob(canvas) {
    const jsPDF = await ensureJsPdf();
    let imgData;
    try {
      imgData = canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      throw new Error('Gagal membuat PDF karena gambar blangko diblokir keamanan browser (CORS). Coba muat ulang halaman lalu unduh lagi.');
    }
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);
    return pdf.output('blob');
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
};

/* ---------------------------------------------------------------------
 * TOAST NOTIFIKASI KECIL (dipakai index.html & admin.html)
 * ------------------------------------------------------------------- */
let _toastTimer;
function showToast(message, type = '') {
  const el = document.getElementById('toast');
  if (!el) { console.warn('[toast]', message); return; }
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

/* ---------------------------------------------------------------------
 * 4. LOGIKA HALAMAN PUBLIK (index.html)
 * ------------------------------------------------------------------- */
/* Cache pengaturan (blangko, TTD, stempel, posisi) di IndexedDB perangkat peserta.
 * Kunjungan berikutnya (atau scan QR) langsung tampil tanpa menunggu server;
 * data terbaru tetap diambil di latar belakang. */
const SettingsCache = {
  DB: 'esertifikat-cache', STORE: 'kv', KEY: 'settings-v1',
  _open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB tidak tersedia'));
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get() {
    try {
      const db = await this._open();
      return await new Promise((resolve) => {
        const r = db.transaction(this.STORE).objectStore(this.STORE).get(this.KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  },
  async set(value) {
    try {
      const db = await this._open();
      await new Promise((resolve) => {
        const tx = db.transaction(this.STORE, 'readwrite');
        tx.objectStore(this.STORE).put(value, this.KEY);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      });
    } catch (e) { /* mode privat / penyimpanan penuh: abaikan */ }
  }
};

const PublicPage = {
  settings: null,
  settingsReady: null,
  currentPeserta: null,
  _renderToken: 0,

  init() {
    if (!document.getElementById('searchForm')) return; // bukan index.html

    this.bindEvents();
    // Pengaturan (template sertifikat) mulai dimuat SEKARANG, paralel dengan pencarian nama,
    // dan tidak ditunggu oleh init(), supaya peserta bisa langsung mengetik & mencari.
    this.settingsReady = this.loadSettings();

    // Jika dibuka lewat scan QR (?verify=KODE) -> langsung tampilkan
    const params = new URLSearchParams(window.location.search);
    const verifyKode = params.get('verify');
    if (verifyKode) {
      document.getElementById('searchInput').value = verifyKode;
      this.search(verifyKode);
    }
  },

  applySettings(data) {
    this.settings = data;
    if (data.layout) Object.assign(CONFIG.LAYOUT, data.layout);
    applyBrandLogo(data.logoUrl);
  },

  _settingsChanged(a, b) {
    if (!a || !b) return true;
    return ['blangkoUrl', 'logoUrl', 'ttdKkksUrl', 'stempelUrl', 'ttdKkgoUrl'].some((k) => a[k] !== b[k])
      || JSON.stringify(a.layout || {}) !== JSON.stringify(b.layout || {});
  },

  /**
   * Alur cepat: (1) getSettingsLite = beberapa KB, (2) gambar diunduh paralel hanya bila versinya
   * berbeda dari salinan di perangkat. Jika backend lama (belum punya getSettingsLite), otomatis
   * memakai getSettings seperti sebelumnya.
   */
  async fetchSettings(cached) {
    try {
      let lite;
      try { lite = await API.get('getSettingsLite'); } catch (e) { lite = null; }
      if (!lite || !lite.success) {
        const res = await API.get('getSettings'); // cadangan untuk backend lama
        if (res && res.success) { SettingsCache.set(res.data); return res.data; }
        return null;
      }
      const data = lite.data;
      const versions = data.assetVersions || {};
      const have = (cached && cached.assetVersions) || {};
      await Promise.all(Object.keys(versions).map(async (kind) => {
        if (cached && have[kind] === versions[kind] && cached[kind + 'Url']) {
          data[kind + 'Url'] = cached[kind + 'Url']; // sudah ada di perangkat
          return;
        }
        try {
          const r = await API.get('getAsset', { kind });
          data[kind + 'Url'] = (r && r.success) ? r.url : null;
        } catch (e) { data[kind + 'Url'] = null; }
      }));
      if (data.blangkoUrl) SettingsCache.set(data);
      return data;
    } catch (e) {
      console.warn('Gagal memuat pengaturan dari server.', e);
    }
    return null;
  },

  async loadSettings() {
    const cached = await SettingsCache.get();
    const fresh = this.fetchSettings(cached);
    if (cached && cached.blangkoUrl) {
      // Ada salinan di perangkat -> pakai langsung, perbarui diam-diam di latar belakang.
      this.applySettings(cached);
      fresh.then((data) => {
        if (data && this._settingsChanged(this.settings, data)) {
          this.applySettings(data);
          if (this.currentPeserta) this.renderResult(this.currentPeserta);
        }
      });
      return;
    }
    const data = await fresh;
    if (data) this.applySettings(data);
  },

  bindEvents() {
    const form = document.getElementById('searchForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('searchInput').value.trim();
      if (q) this.search(q);
    });

    document.getElementById('downloadBtn').addEventListener('click', () => this.downloadCurrent());
  },

  setStatus(mode, text) {
    const el = document.getElementById('resultStatus');
    el.classList.toggle('is-invalid', mode === 'invalid');
    el.querySelector('span').textContent = text;
  },

  showEmpty(message) {
    document.getElementById('resultPanel').style.display = 'none';
    const empty = document.getElementById('emptyState');
    empty.style.display = 'block';
    empty.querySelector('p').textContent = message;
  },

  // Penanda "sedang memuat" di atas area sertifikat, supaya peserta tidak melihat kotak putih kosong.
  setCertLoading(on, text, withSpinner = true) {
    const el = document.getElementById('certLoading');
    if (!el) return;
    el.hidden = !on;
    if (!on) return;
    el.querySelector('.cert-loading-text').textContent = text || '';
    el.querySelector('.spinner').style.display = withSpinner ? '' : 'none';
  },

  async search(query) {
    const btn = document.querySelector('#searchForm button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Mencari...';
    let peserta = null;
    try {
      const res = await API.get('search', { q: query });
      if (!res.success || !res.data) {
        this.showEmpty(`Sertifikat dengan kode/nama "${query}" tidak ditemukan. Periksa kembali penulisan kode atau nama Anda.`);
        return;
      }
      peserta = res.data;
    } catch (e) {
      this.showEmpty('Terjadi kendala koneksi ke server. Silakan coba lagi beberapa saat lagi.');
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Cari Sertifikat';
    }
    // Tombol sudah normal kembali; penggambaran sertifikat punya indikator sendiri.
    this.currentPeserta = peserta;
    await this.renderResult(peserta);
  },

  async renderResult(peserta) {
    const token = ++this._renderToken;
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('resultPanel').style.display = 'block';

    // 1) Data teks tampil SEKETIKA setelah pencarian selesai.
    const valid = peserta.status !== 'Nonaktif';
    this.setStatus(valid ? 'valid' : 'invalid', valid ? 'Sertifikat terverifikasi asli' : 'Sertifikat tidak aktif / dicabut');
    document.getElementById('metaKode').textContent = peserta.kode;
    document.getElementById('metaNama').textContent = peserta.nama;
    document.getElementById('metaInstansi').textContent = peserta.instansi || '-';
    document.getElementById('metaJabatan').textContent = peserta.jabatan || '-';
    document.getElementById('metaTanggal').textContent = peserta.tanggal;

    const dlBtn = document.getElementById('downloadBtn');
    dlBtn.disabled = true;

    // 2) Pastikan template sertifikat sudah ada (jika belum, tunggu dengan indikator jelas).
    if (!this.settings) {
      this.setCertLoading(true, 'Mengambil template sertifikat… (pertama kali bisa agak lama, mohon tunggu)');
      await this.settingsReady;
      if (!this.settings) { // coba sekali lagi bila gagal
        this.settingsReady = this.loadSettings();
        await this.settingsReady;
      }
      if (token !== this._renderToken) return;
      if (!this.settings) {
        this.setCertLoading(true, 'Template sertifikat gagal dimuat. Periksa koneksi internet lalu tekan "Cari Sertifikat" lagi.', false);
        return;
      }
    }

    const sebagai = resolveSebagai(peserta, CONFIG.LAYOUT);
    const showSebagai = !!(CONFIG.LAYOUT.sebagai && CONFIG.LAYOUT.sebagai.enabled && sebagai);
    const rowSebagai = document.getElementById('rowSebagai');
    if (rowSebagai) {
      rowSebagai.style.display = showSebagai ? '' : 'none';
      document.getElementById('metaSebagai').textContent = sebagai || '-';
    }

    // 3) Gambar pratinjau ukuran ringan (setengah resolusi) — cukup tajam untuk layar HP.
    this.setCertLoading(true, 'Menyiapkan sertifikat…');
    const canvas = document.getElementById('certCanvas');
    try {
      await CertRenderer.draw(canvas, peserta, assetsFromSettings(this.settings), CONFIG.LAYOUT, { scale: 0.5 });
    } catch (e) {
      console.error(e);
      if (token === this._renderToken) this.setCertLoading(true, 'Gagal menampilkan sertifikat. Coba muat ulang halaman.', false);
      return;
    }
    if (token !== this._renderToken) return;
    this.setCertLoading(false);
    dlBtn.disabled = false;
  },

  async downloadCurrent() {
    if (!this.currentPeserta || !this.settings) return;
    const btn = document.getElementById('downloadBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Menyiapkan PDF...';
    let full = null;
    try {
      // Kualitas penuh (2808×1985) hanya dibuat saat mengunduh, bukan saat pratinjau.
      full = document.createElement('canvas');
      await CertRenderer.draw(full, this.currentPeserta, assetsFromSettings(this.settings), CONFIG.LAYOUT, { scale: 1 });
      const blob = await CertRenderer.canvasToPdfBlob(full);
      CertRenderer.downloadBlob(blob, `Sertifikat-${this.currentPeserta.kode}.pdf`);
    } catch (e) {
      showToast(e.message || 'Gagal membuat file PDF. Coba muat ulang halaman.', 'error');
    } finally {
      if (full) { full.width = 0; full.height = 0; } // bebaskan memori HP
      btn.disabled = false;
      btn.textContent = original;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => PublicPage.init());
