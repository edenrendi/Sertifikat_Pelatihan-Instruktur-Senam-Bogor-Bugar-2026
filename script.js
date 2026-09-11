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
    qr:   { xPct: 0.90,  yPct: 0.855, sizePct: 0.10 },
    // Aset gambar tambahan yang bisa ditempel di atas blangko, posisinya bisa
    // diatur admin lewat panel "Logo, TTD & Stempel". sizePct = lebar aset
    // relatif terhadap lebar kanvas sertifikat; tinggi menyesuaikan rasio asli gambar.
    logo:     { xPct: 0.085, yPct: 0.085, sizePct: 0.09 },
    ttdKkks:  { xPct: 0.30,  yPct: 0.865, sizePct: 0.12 },
    stempel:  { xPct: 0.50,  yPct: 0.835, sizePct: 0.11 },
    ttdKkgo:  { xPct: 0.70,  yPct: 0.865, sizePct: 0.12 }
  },

  // Kunci setiap aset overlay gambar (di luar blangko itu sendiri & QR yang
  // dibuat otomatis). Dipakai bersama oleh CertRenderer.draw() dan admin.js.
  OVERLAY_ASSET_KEYS: ['logo', 'ttdKkks', 'stempel', 'ttdKkgo'],

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

  // Memuat gambar aset overlay (logo/TTD/stempel). Karena aset ini sekarang
  // selalu berupa data URI (lihat getSettings di code.gs), tidak ada isu CORS
  // sama sekali -> lebih sederhana & tidak pernah "tainted".
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
    try {
      img = await tryLoad(true);
    } catch (e) {
      // Sebagian jaringan seluler/proxy data-saver memblokir permintaan gambar
      // bermode CORS. Coba lagi tanpa CORS supaya sertifikat tetap TERLIHAT,
      // meski akibatnya unduhan PDF untuk kasus ini mungkin gagal (lihat catch
      // di canvasToPdfBlob).
      console.warn('Gagal memuat blangko dengan mode CORS, mencoba ulang tanpa CORS...', e);
      img = await tryLoad(false);
      tainted = true;
    }
    this._blangkoCache = img;
    this._blangkoUrl = url;
    this._blangkoTainted = tainted;
    return img;
  },

  async makeQrDataUrl(text, sizePx) {
    // Menggunakan library qrcodejs (dimuat via CDN) -> render ke elemen tersembunyi, ambil canvas-nya.
    return new Promise((resolve) => {
      const holder = document.createElement('div');
      holder.style.display = 'none';
      document.body.appendChild(holder);
      // eslint-disable-next-line no-undef
      new QRCode(holder, {
        text,
        width: sizePx,
        height: sizePx,
        correctLevel: QRCode.CorrectLevel.M
      });
      setTimeout(() => {
        const canvas = holder.querySelector('canvas');
        const dataUrl = canvas ? canvas.toDataURL('image/png') : null;
        document.body.removeChild(holder);
        resolve(dataUrl);
      }, 60);
    });
  },

  /**
   * Menggambar satu sertifikat lengkap ke sebuah <canvas> yang diberikan.
   * data: { kode, nama, instansi, tanggal }
   * assets: { blangko, logo, ttdKkks, stempel, ttdKkgo } — masing-masing data URI
   *         (lihat assetsFromSettings()). Untuk kompatibilitas lama, string biasa
   *         juga masih diterima dan diperlakukan sebagai blangko saja.
   * layout: opsional, override CONFIG.LAYOUT (dipakai kalau admin sudah kalibrasi posisi)
   */
  async draw(canvas, data, assets, layout) {
    if (typeof assets === 'string') assets = { blangko: assets }; // kompatibilitas lama
    assets = assets || {};
    const blangkoUrl = assets.blangko;
    const L = layout || CONFIG.LAYOUT;
    const W = CONFIG.CERT_WIDTH, H = CONFIG.CERT_HEIGHT;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Latar putih dulu (jaga-jaga blangko transparan / gagal load)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (blangkoUrl) {
      try {
        const img = await this.loadBlangko(blangkoUrl);
        ctx.drawImage(img, 0, 0, W, H);
      } catch (e) {
        // blangko benar-benar gagal dimuat (bukan cuma taint CORS) -> tampilkan pesan jelas
        ctx.fillStyle = '#F5F6F0';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#D9481F';
        ctx.lineWidth = 10;
        ctx.strokeRect(30, 30, W - 60, H - 60);
        ctx.fillStyle = '#B23A17';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 42px Inter';
        ctx.fillText('Gagal memuat gambar blangko sertifikat.', W / 2, H / 2 - 30);
        ctx.font = '400 32px Inter';
        ctx.fillText('Coba muat ulang halaman ini.', W / 2, H / 2 + 30);
        console.error('Gagal memuat blangko:', e);
      }
    }

    const fontString = (cfg) => `${cfg.fontWeight || '400'} ${cfg.fontSize}px "${cfg.fontFamily}"`;

    // Pastikan web font (Archivo/Inter/Playfair Display/Montserrat) sudah termuat
    // sebelum digambar, supaya tidak jatuh ke font fallback pada render pertama.
    try {
      const toLoad = ['kode', 'nama'].filter((k) => L[k]).map((k) => document.fonts.load(fontString(L[k])));
      await Promise.all(toLoad);
      await document.fonts.ready;
    } catch (e) { /* abaikan jika API fonts tidak didukung */ }

    const drawText = (key, text) => {
      const cfg = L[key];
      if (!cfg || !text) return;
      ctx.font = fontString(cfg);
      ctx.fillStyle = cfg.color;
      ctx.textAlign = cfg.align;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, W * cfg.xPct, H * cfg.yPct);
    };

    // Hanya Nama & Kode yang dicetak dinamis — Nama Sekolah tetap tersimpan sebagai
    // data (tampil di tabel admin & halaman verifikasi) tapi tidak digambar di atas
    // blangko, karena blangko sudah lengkap.
    drawText('kode', data.kode);
    drawText('nama', data.nama);

    // Aset overlay: logo, TTD Ketua KKKS, stempel, TTD Ketua KKGO -> masing-masing
    // opsional, hanya digambar kalau admin sudah mengunggahnya & posisinya diatur.
    for (const key of CONFIG.OVERLAY_ASSET_KEYS) {
      const cfg = L[key];
      const url = assets[key];
      if (!cfg || !url) continue;
      try {
        const img = await this.loadAssetImage(url);
        if (!img) continue;
        const w = W * cfg.sizePct;
        const h = w * (img.naturalHeight / img.naturalWidth || 1); // pertahankan rasio asli gambar
        ctx.drawImage(img, W * cfg.xPct - w / 2, H * cfg.yPct - h / 2, w, h);
      } catch (e) {
        console.warn(`Gagal memuat aset "${key}":`, e);
      }
    }

    // QR code -> mengarah ke halaman verifikasi
    const qrCfg = L.qr;
    if (qrCfg) {
      const sizePx = Math.round(W * qrCfg.sizePct);
      const verifyUrl = `${CONFIG.VERIFY_BASE_URL}?verify=${encodeURIComponent(data.kode)}`;
      const qrDataUrl = await this.makeQrDataUrl(verifyUrl, 300);
      if (qrDataUrl) {
        const qrImg = await new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.src = qrDataUrl;
        });
        const qx = W * qrCfg.xPct - sizePx / 2;
        const qy = H * qrCfg.yPct - sizePx / 2;
        ctx.drawImage(qrImg, qx, qy, sizePx, sizePx);
      }
    }

    return canvas;
  },

  /** Ekspor canvas sertifikat menjadi PDF A4 Landscape berkualitas tinggi */
  async canvasToPdfBlob(canvas) {
    // eslint-disable-next-line no-undef
    const { jsPDF } = window.jspdf;
    let imgData;
    try {
      imgData = canvas.toDataURL('image/jpeg', 0.95);
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
const PublicPage = {
  settings: null,
  currentPeserta: null,

  async init() {
    if (!document.getElementById('searchForm')) return; // bukan index.html

    this.bindEvents();
    await this.loadSettings();

    // Jika dibuka lewat scan QR (?verify=KODE) -> langsung tampilkan
    const params = new URLSearchParams(window.location.search);
    const verifyKode = params.get('verify');
    if (verifyKode) {
      document.getElementById('searchInput').value = verifyKode;
      this.search(verifyKode);
    }
  },

  async loadSettings() {
    try {
      const res = await API.get('getSettings');
      if (res.success) {
        this.settings = res.data;
        if (res.data.layout) Object.assign(CONFIG.LAYOUT, res.data.layout);
        applyBrandLogo(res.data.logoUrl);
      }
    } catch (e) {
      console.warn('Gagal memuat pengaturan, memakai default.', e);
    }
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

  async search(query) {
    const btn = document.querySelector('#searchForm button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Mencari...';
    try {
      const res = await API.get('search', { q: query });
      if (!res.success || !res.data) {
        this.showEmpty(`Sertifikat dengan kode/nama "${query}" tidak ditemukan. Periksa kembali penulisan kode atau nama Anda.`);
        return;
      }
      this.currentPeserta = res.data;
      await this.renderResult(res.data);
    } catch (e) {
      this.showEmpty('Terjadi kendala koneksi ke server. Silakan coba lagi beberapa saat lagi.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Cari Sertifikat';
    }
  },

  async renderResult(peserta) {
    document.getElementById('emptyState').style.display = 'none';
    const panel = document.getElementById('resultPanel');
    panel.style.display = 'block';

    const valid = peserta.status !== 'Nonaktif';
    this.setStatus(valid ? 'valid' : 'invalid', valid ? 'Sertifikat terverifikasi asli' : 'Sertifikat tidak aktif / dicabut');

    document.getElementById('metaKode').textContent = peserta.kode;
    document.getElementById('metaNama').textContent = peserta.nama;
    document.getElementById('metaInstansi').textContent = peserta.instansi || '-';
    document.getElementById('metaTanggal').textContent = peserta.tanggal;

    const canvas = document.getElementById('certCanvas');
    await CertRenderer.draw(canvas, peserta, assetsFromSettings(this.settings), CONFIG.LAYOUT);
  },

  async downloadCurrent() {
    if (!this.currentPeserta) return;
    const btn = document.getElementById('downloadBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Menyiapkan PDF...';
    try {
      const canvas = document.getElementById('certCanvas');
      const blob = await CertRenderer.canvasToPdfBlob(canvas);
      CertRenderer.downloadBlob(blob, `Sertifikat-${this.currentPeserta.kode}.pdf`);
    } catch (e) {
      showToast(e.message || 'Gagal membuat file PDF. Coba muat ulang halaman.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => PublicPage.init());
