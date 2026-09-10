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

  // Ukuran kanvas sertifikat -> rasio A4 Landscape (297mm x 210mm), kualitas cetak 300dpi
  CERT_WIDTH: 3508,
  CERT_HEIGHT: 2480,

  // Posisi elemen di atas blangko, dalam PERSEN (0-1) dari lebar/tinggi kanvas.
  // Nilai default ini bisa ditimpa oleh Settings yang disimpan admin (lihat loadSettings()).
  LAYOUT: {
    kode:      { xPct: 0.945, yPct: 0.075, align: 'right',  font: '700 34px Inter',       color: '#14532D' },
    nama:      { xPct: 0.5,   yPct: 0.46,  align: 'center', font: '900 96px Archivo',     color: '#14532D' },
    instansi:  { xPct: 0.5,   yPct: 0.565, align: 'center', font: '500 36px Inter',       color: '#333333' },
    tanggal:   { xPct: 0.5,   yPct: 0.66,  align: 'center', font: '400 30px Inter',       color: '#4B564E' },
    qr:        { xPct: 0.90,  yPct: 0.855, sizePct: 0.10 }
  },

  // URL dasar untuk link verifikasi yang ditanam di QR Code (auto terisi dari lokasi halaman saat ini)
  get VERIFY_BASE_URL() {
    return window.location.origin + window.location.pathname.replace(/admin\.html$/, 'index.html');
  }
};

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

  async loadBlangko(url) {
    if (this._blangkoCache && this._blangkoUrl === url) return this._blangkoCache;
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    this._blangkoCache = img;
    this._blangkoUrl = url;
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
   * blangkoUrl: URL gambar blangko (PNG/JPG)
   * layout: opsional, override CONFIG.LAYOUT (dipakai kalau admin sudah kalibrasi posisi)
   */
  async draw(canvas, data, blangkoUrl, layout) {
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
        // blangko gagal dimuat -> tampilkan placeholder sederhana
        ctx.strokeStyle = '#14532D';
        ctx.lineWidth = 10;
        ctx.strokeRect(30, 30, W - 60, H - 60);
      }
    }

    const drawText = (key, text) => {
      const cfg = L[key];
      if (!cfg || !text) return;
      ctx.font = cfg.font;
      ctx.fillStyle = cfg.color;
      ctx.textAlign = cfg.align;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, W * cfg.xPct, H * cfg.yPct);
    };

    drawText('kode', data.kode);
    drawText('nama', data.nama);
    drawText('instansi', data.instansi);
    drawText('tanggal', data.tanggal);

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
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
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
    await CertRenderer.draw(canvas, peserta, this.settings && this.settings.blangkoUrl, CONFIG.LAYOUT);
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
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => PublicPage.init());
