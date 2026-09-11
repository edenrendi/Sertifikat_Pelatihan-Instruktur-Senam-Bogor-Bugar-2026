/* =========================================================================
 * E-SERTIFIKAT — admin.js
 * Logika dashboard admin: login, settings, upload blangko, input peserta
 * (manual & bulk), tabel manajemen peserta, dan unduh massal PDF (ZIP).
 * Membutuhkan script.js (CONFIG, API, CertRenderer) dimuat lebih dulu.
 * ========================================================================= */

const Admin = {
  TOKEN_KEY: 'esertifikat_admin_token',
  state: {
    page: 1,
    pageSize: 10,
    query: '',
    total: 0,
    rows: [],
    settings: null,
    editingKode: null
  },

  getToken() { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
  clearToken() { localStorage.removeItem(this.TOKEN_KEY); },

  async init() {
    if (!document.getElementById('adminShell') && !document.getElementById('loginShell')) return;

    // Ambil logo web lebih dulu supaya tampil juga di layar login (bukan cuma dashboard).
    API.get('getSettings').then((res) => { if (res.success) applyBrandLogo(res.data.logoUrl); });

    if (this.getToken()) {
      this.showDashboard();
    } else {
      this.showLogin();
    }
    this.bindLoginForm();
    this.bindNav();
    this.bindSettingsForm();
    this.bindManualForm();
    this.bindBulkUpload();
    this.bindTableToolbar();
    this.bindModal();
    this.bindStickyHeaders();
    Review.bind();
  },

  /* ---------------- FREEZE JUDUL HALAMAN SAAT DI-SCROLL ---------------- */
  bindStickyHeaders() {
    const headers = document.querySelectorAll('.admin-header');
    if (!headers.length) return;
    const onScroll = () => {
      headers.forEach((h) => {
        if (h.offsetParent === null) return; // panel sedang tersembunyi
        h.classList.toggle('is-stuck', h.getBoundingClientRect().top <= 0);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  },

  toast(message, type = '') {
    showToast(message, type);
  },

  /* ---------------- LOGIN ---------------- */
  showLogin() {
    document.getElementById('loginShell').style.display = 'flex';
    document.getElementById('adminShell').style.display = 'none';
  },
  showDashboard() {
    document.getElementById('loginShell').style.display = 'none';
    document.getElementById('adminShell').style.display = 'flex';
    this.loadSettings();
    this.loadPeserta();
  },

  bindLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUser').value.trim();
      const password = document.getElementById('loginPass').value;
      const errBox = document.getElementById('loginError');
      const btn = form.querySelector('button[type="submit"]');
      errBox.classList.remove('show');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Masuk...';
      try {
        const res = await API.post('login', { username, password });
        if (res.success) {
          this.setToken(res.token);
          this.toast('Berhasil masuk sebagai ' + username, 'success');
          this.showDashboard();
        } else {
          errBox.textContent = res.message || 'Username atau password salah.';
          errBox.classList.add('show');
        }
      } catch (err) {
        errBox.textContent = 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
        errBox.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Masuk';
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      this.clearToken();
      this.showLogin();
    });
  },

  /* ---------------- NAVIGASI TAB ---------------- */
  bindNav() {
    document.querySelectorAll('.admin-nav button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.admin-panel').forEach((p) => (p.style.display = 'none'));
        document.getElementById(btn.dataset.target).style.display = 'block';
      });
    });
  },

  /* ---------------- SETTINGS ---------------- */
  async loadSettings() {
    const res = await API.get('getSettings');
    if (!res.success) return;
    this.state.settings = res.data;
    document.getElementById('setEventName').value = res.data.eventName || CONFIG.EVENT_NAME;
    document.getElementById('setKecamatan').value = res.data.kecamatan || CONFIG.EVENT_LOCATION;
    document.getElementById('setPrefix').value = res.data.kodePrefix || 'SBB-2026-';
    if (res.data.blangkoUrl) {
      document.getElementById('blangkoPreview').innerHTML = `<img src="${res.data.blangkoUrl}" alt="Blangko sertifikat">`;
    }
    applyBrandLogo(res.data.logoUrl);

    const L = { kode: {}, nama: {}, qr: {} };
    ['kode', 'nama', 'qr'].concat(CONFIG.OVERLAY_ASSET_KEYS).forEach((key) => {
      L[key] = Object.assign({}, CONFIG.LAYOUT[key], (res.data.layout && res.data.layout[key]) || {});
    });
    Object.assign(CONFIG.LAYOUT, L); // supaya Download/Review pakai pengaturan tersimpan, bukan default
    document.getElementById('posNamaX').value = Math.round(L.nama.xPct * 100);
    document.getElementById('posNamaY').value = Math.round(L.nama.yPct * 100);
    document.getElementById('posKodeX').value = Math.round(L.kode.xPct * 100);
    document.getElementById('posKodeY').value = Math.round(L.kode.yPct * 100);
    document.getElementById('posQrX').value = Math.round(L.qr.xPct * 100);
    document.getElementById('posQrY').value = Math.round(L.qr.yPct * 100);

    document.getElementById('namaFontFamily').value = L.nama.fontFamily;
    document.getElementById('namaFontSize').value = L.nama.fontSize;
    document.getElementById('namaColor').value = L.nama.color;
    document.getElementById('kodeFontFamily').value = L.kode.fontFamily;
    document.getElementById('kodeFontSize').value = L.kode.fontSize;
    document.getElementById('kodeColor').value = L.kode.color;

    // Pratinjau & posisi untuk aset overlay: logo, TTD Ketua KKKS, stempel, TTD Ketua KKGO
    CONFIG.OVERLAY_ASSET_KEYS.forEach((key) => {
      const url = res.data[key + 'Url'];
      const previewEl = document.getElementById(key + 'Preview');
      if (previewEl) previewEl.innerHTML = url ? `<img src="${url}" alt="${key}">` : '<span class="upload-preview-empty">📤</span>';
      const xEl = document.getElementById('pos' + capitalize(key) + 'X');
      const yEl = document.getElementById('pos' + capitalize(key) + 'Y');
      const sEl = document.getElementById('pos' + capitalize(key) + 'Size');
      if (xEl) xEl.value = Math.round(L[key].xPct * 100);
      if (yEl) yEl.value = Math.round(L[key].yPct * 100);
      if (sEl) sEl.value = Math.round(L[key].sizePct * 100);
    });

    // Tampilkan pratinjau posisi & font begitu blangko sudah ada, tanpa perlu diklik.
    if (res.data.blangkoUrl) this.previewPosisi();
  },

  bindSettingsForm() {
    const dropZone = document.getElementById('blangkoDrop');
    const fileInput = document.getElementById('blangkoFile');
    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => this.handleBlangkoFile(fileInput.files[0]));
    }

    // Dropzone untuk 4 aset overlay: logo, TTD Ketua KKKS, stempel, TTD Ketua KKGO.
    // Semua otomatis diproses agar latar putihnya jadi transparan sebelum diunggah.
    CONFIG.OVERLAY_ASSET_KEYS.forEach((key) => {
      const drop = document.getElementById(key + 'Drop');
      const input = document.getElementById(key + 'File');
      if (!drop || !input) return;
      drop.addEventListener('click', () => input.click());
      input.addEventListener('change', () => this.handleOverlayAssetFile(key, input.files[0]));
    });

    const form = document.getElementById('settingsForm');
    if (!form) return;

    // Simpan manual lewat tombol tetap tersedia, tapi sekarang perubahan juga
    // otomatis tersimpan (lihat scheduleAutosave) jadi tombol ini opsional saja.
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Menyimpan...';
      try {
        await this.saveSettings({ silent: false });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan';
      }
    });

    // ---- Pratinjau posisi & font real-time + autosave otomatis ----
    // Semua field posisi/warna/font sekaligus memicu (1) pratinjau langsung
    // tanpa perlu klik tombol, dan (2) autosave setelah pengguna berhenti mengetik sejenak.
    const liveFieldIds = [
      'posNamaX', 'posNamaY', 'posKodeX', 'posKodeY', 'posQrX', 'posQrY',
      'namaFontFamily', 'namaFontSize', 'namaColor',
      'kodeFontFamily', 'kodeFontSize', 'kodeColor'
    ];
    CONFIG.OVERLAY_ASSET_KEYS.forEach((key) => {
      liveFieldIds.push('pos' + capitalize(key) + 'X', 'pos' + capitalize(key) + 'Y', 'pos' + capitalize(key) + 'Size');
    });
    const infoFieldIds = ['setEventName', 'setKecamatan', 'setPrefix'];

    let previewTimer = null;
    const scheduleLivePreview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => this.previewPosisi({ silent: true }), 120);
    };

    liveFieldIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => { scheduleLivePreview(); this.scheduleAutosave(); });
    });
    infoFieldIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this.scheduleAutosave());
    });

    // Tombol "Pratinjau" tetap ada sebagai penyegar manual bila diperlukan.
    const previewBtn = document.getElementById('previewPosisiBtn');
    if (previewBtn) previewBtn.addEventListener('click', () => this.previewPosisi());
  },

  /* ---------------- SIMPAN PENGATURAN (dipakai submit manual & autosave) ---------------- */
  buildLayoutFromForm() {
    function num(id) { return parseFloat(document.getElementById(id).value) || 0; }
    function val(id) { return document.getElementById(id).value; }
    const layout = {
      nama: Object.assign({}, CONFIG.LAYOUT.nama, {
        xPct: num('posNamaX') / 100, yPct: num('posNamaY') / 100,
        fontFamily: val('namaFontFamily'), fontSize: num('namaFontSize'), color: val('namaColor')
      }),
      kode: Object.assign({}, CONFIG.LAYOUT.kode, {
        xPct: num('posKodeX') / 100, yPct: num('posKodeY') / 100,
        fontFamily: val('kodeFontFamily'), fontSize: num('kodeFontSize'), color: val('kodeColor')
      }),
      qr: Object.assign({}, CONFIG.LAYOUT.qr, { xPct: num('posQrX') / 100, yPct: num('posQrY') / 100 })
    };
    CONFIG.OVERLAY_ASSET_KEYS.forEach((key) => {
      const xEl = document.getElementById('pos' + capitalize(key) + 'X');
      const yEl = document.getElementById('pos' + capitalize(key) + 'Y');
      const sEl = document.getElementById('pos' + capitalize(key) + 'Size');
      if (!xEl) return;
      layout[key] = Object.assign({}, CONFIG.LAYOUT[key], {
        xPct: (parseFloat(xEl.value) || 0) / 100,
        yPct: (parseFloat(yEl.value) || 0) / 100,
        sizePct: (parseFloat(sEl.value) || 0) / 100
      });
    });
    return layout;
  },

  async saveSettings({ silent } = { silent: true }) {
    const layout = this.buildLayoutFromForm();
    this.setAutosaveStatus('saving');
    try {
      const res = await API.post('updateSettings', {
        settings: {
          eventName: document.getElementById('setEventName').value.trim(),
          kecamatan: document.getElementById('setKecamatan').value.trim(),
          kodePrefix: document.getElementById('setPrefix').value.trim(),
          layout
        }
      });
      if (res.success) {
        Object.assign(CONFIG.LAYOUT, layout);
        if (this.state.settings) this.state.settings = Object.assign({}, this.state.settings, { layout });
        this.setAutosaveStatus('saved');
        if (!silent) this.toast('Pengaturan tersimpan.', 'success');
        else this.toast('Perubahan tersimpan otomatis.', 'success');
      } else {
        this.setAutosaveStatus('error');
        this.toast(res.message || 'Gagal menyimpan pengaturan.', 'error');
      }
      return res;
    } catch (e) {
      this.setAutosaveStatus('error');
      this.toast('Gagal menyimpan pengaturan. Periksa koneksi internet.', 'error');
      return { success: false };
    }
  },

  scheduleAutosave() {
    this.setAutosaveStatus('pending');
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this.saveSettings({ silent: true }), 1200);
  },

  setAutosaveStatus(status) {
    const el = document.getElementById('autosaveStatus');
    if (!el) return;
    el.classList.remove('saving', 'saved', 'error');
    if (status === 'pending') {
      el.classList.add('saving');
      el.querySelector('span:last-child').textContent = 'Perubahan belum disimpan...';
    } else if (status === 'saving') {
      el.classList.add('saving');
      el.querySelector('span:last-child').textContent = 'Menyimpan...';
    } else if (status === 'saved') {
      el.classList.add('saved');
      el.querySelector('span:last-child').textContent = 'Tersimpan otomatis';
    } else if (status === 'error') {
      el.classList.add('error');
      el.querySelector('span:last-child').textContent = 'Gagal menyimpan';
    }
  },

  async handleBlangkoFile(file) {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) {
      this.toast('Format harus PNG atau JPG.', 'error');
      return;
    }
    document.getElementById('blangkoPreview').innerHTML = '<span class="spinner"></span> Mengunggah...';
    const base64 = await fileToBase64(file);
    try {
      const res = await API.post('uploadBlangko', {
        filename: file.name,
        mimeType: file.type,
        base64
      });
      if (res.success) {
        document.getElementById('blangkoPreview').innerHTML = `<img src="${res.url}" alt="Blangko sertifikat">`;
        CertRenderer._blangkoCache = null;
        if (this.state.settings) this.state.settings.blangkoUrl = res.url;
        this.toast('Blangko berhasil diunggah.', 'success');
        this.previewPosisi();
      } else {
        this.toast(res.message || 'Gagal mengunggah blangko.', 'error');
      }
    } catch (e) {
      this.toast('Gagal mengunggah blangko. Coba file yang lebih kecil.', 'error');
    }
  },

  async previewPosisi(opts) {
    const { silent } = opts || {};
    if (!this.state.settings || !this.state.settings.blangkoUrl) {
      if (!silent) this.toast('Unggah blangko terlebih dahulu.', 'error');
      return;
    }
    function num(x) { return parseFloat(document.getElementById(x).value) || 0; }
    function val(x) { return document.getElementById(x).value; }
    const layout = {
      kode: {
        ...CONFIG.LAYOUT.kode, xPct: num('posKodeX') / 100, yPct: num('posKodeY') / 100,
        fontFamily: val('kodeFontFamily'), fontSize: num('kodeFontSize'), color: val('kodeColor')
      },
      nama: {
        ...CONFIG.LAYOUT.nama, xPct: num('posNamaX') / 100, yPct: num('posNamaY') / 100,
        fontFamily: val('namaFontFamily'), fontSize: num('namaFontSize'), color: val('namaColor')
      },
      qr: { ...CONFIG.LAYOUT.qr, xPct: num('posQrX') / 100, yPct: num('posQrY') / 100 }
    };
    CONFIG.OVERLAY_ASSET_KEYS.forEach((key) => {
      const xEl = document.getElementById('pos' + capitalize(key) + 'X');
      if (!xEl) return;
      layout[key] = {
        ...CONFIG.LAYOUT[key],
        xPct: num('pos' + capitalize(key) + 'X') / 100,
        yPct: num('pos' + capitalize(key) + 'Y') / 100,
        sizePct: num('pos' + capitalize(key) + 'Size') / 100
      };
    });
    const canvas = document.getElementById('previewCanvas');
    await CertRenderer.draw(canvas, {
      kode: (this.state.settings.kodePrefix || 'SBB-2026-') + '0001',
      nama: 'Nama Peserta Contoh'
    }, assetsFromSettings(this.state.settings), layout);
  },

  /* ---------------- UPLOAD ASET OVERLAY (logo, TTD, stempel) ---------------- */
  async handleOverlayAssetFile(kind, file) {
    if (!file) return;
    if (!/image\/(png|jpe?g)/.test(file.type)) {
      this.toast('Format harus PNG atau JPG.', 'error');
      return;
    }
    const previewEl = document.getElementById(kind + 'Preview');
    const labels = { logo: 'Logo', ttdKkks: 'TTD Ketua KKKS', stempel: 'Stempel', ttdKkgo: 'TTD Ketua KKGO' };
    previewEl.innerHTML = '<span class="spinner" style="border-top-color:var(--forest);border-color:rgba(20,83,45,.25)"></span>';
    try {
      // Latar putih (dari foto/scan TTD atau stempel di kertas putih) dihapus otomatis
      // di browser sebelum diunggah, supaya aset bisa ditempel transparan di atas blangko.
      const { mimeType, base64 } = await stripWhiteBackground(file);
      const res = await API.post('uploadAsset', {
        kind,
        filename: file.name.replace(/\.[a-z0-9]+$/i, '') + '.png',
        mimeType,
        base64
      });
      if (res.success) {
        previewEl.innerHTML = `<img src="${res.url}" alt="${labels[kind] || kind}">`;
        CertRenderer._assetCache = {};
        if (this.state.settings) this.state.settings[kind + 'Url'] = res.url;
        this.toast(`${labels[kind] || 'Aset'} berhasil diunggah, latar putih dihapus otomatis.`, 'success');
        this.previewPosisi();
      } else {
        previewEl.innerHTML = '<span class="upload-preview-empty">📤</span>';
        this.toast(res.message || 'Gagal mengunggah aset.', 'error');
      }
    } catch (e) {
      previewEl.innerHTML = '<span class="upload-preview-empty">📤</span>';
      this.toast('Gagal memproses gambar. Coba file lain.', 'error');
    }
  },

  /* ---------------- INPUT MANUAL ---------------- */
  bindManualForm() {
    const form = document.getElementById('manualForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Menyimpan...';
      try {
        const res = await API.post('addPeserta', {
          data: {
            nama: document.getElementById('manualNama').value.trim(),
            instansi: document.getElementById('manualInstansi').value.trim()
          }
        });
        if (res.success) {
          this.toast(`Peserta ditambahkan dengan kode ${res.data.kode}`, 'success');
          form.reset();
          this.loadPeserta();
        } else {
          this.toast(res.message || 'Gagal menambahkan peserta.', 'error');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Tambah Peserta';
      }
    });
  },

  /* ---------------- BULK UPLOAD (XLSX/CSV) ---------------- */
  bindBulkUpload() {
    const input = document.getElementById('bulkFile');
    if (!input) return;
    document.getElementById('bulkDrop').addEventListener('click', () => input.click());
    input.addEventListener('change', () => this.handleBulkFile(input.files[0]));
    document.getElementById('downloadTemplateBtn').addEventListener('click', () => this.downloadTemplateXlsx());
  },

  downloadTemplateXlsx() {
    // Dibuat sebagai file .xlsx sungguhan (bukan teks CSV) supaya kolom No/Nama/Nama
    // Sekolah PASTI terpisah rapi saat dibuka di Excel, tidak tergantung pengaturan
    // pemisah desimal/daftar (locale) di Excel masing-masing perangkat.
    // eslint-disable-next-line no-undef
    const wsData = [
      ['No', 'Nama', 'Nama Sekolah'],
      [1, 'Contoh Nama Peserta', 'SD Negeri Cigombong 01'],
      [2, 'Contoh Nama Peserta Dua', 'SD Negeri Cigombong 02'],
      [3, 'Contoh Nama Peserta Tiga', 'SD Negeri Cigombong 03']
    ];
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 6 }, { wch: 32 }, { wch: 32 }];
    // eslint-disable-next-line no-undef
    const wb = XLSX.utils.book_new();
    // eslint-disable-next-line no-undef
    XLSX.utils.book_append_sheet(wb, ws, 'Data Peserta');
    // eslint-disable-next-line no-undef
    XLSX.writeFile(wb, 'Template-Data-Peserta.xlsx');
  },

  async handleBulkFile(file) {
    if (!file) return;
    // eslint-disable-next-line no-undef
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // eslint-disable-next-line no-undef
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // eslint-disable-next-line no-undef
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (!rows.length) {
          this.toast('File kosong atau format kolom tidak sesuai.', 'error');
          return;
        }
        const mapped = rows.map((r) => ({
          nama: (r['Nama'] || r['Nama Lengkap'] || '').toString().trim(),
          instansi: (r['Nama Sekolah'] || r['Instansi/Kecamatan'] || r['Instansi'] || '').toString().trim()
        })).filter((r) => r.nama);

        if (!mapped.length) {
          this.toast('Tidak ada baris valid. Pastikan kolom "Nama Lengkap" terisi.', 'error');
          return;
        }
        this.showBulkPreview(mapped);
      } catch (err) {
        this.toast('Gagal membaca file. Pastikan format .xlsx atau .csv.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  showBulkPreview(rows) {
    this._pendingBulk = rows;
    const box = document.getElementById('bulkPreview');
    box.style.display = 'block';
    box.querySelector('.panel-desc').textContent = `${rows.length} peserta siap diimpor. Kode sertifikat akan dibuat otomatis.`;
    const tbody = box.querySelector('tbody');
    tbody.innerHTML = rows.slice(0, 8).map((r) => `<tr><td>${escapeHtml(r.nama)}</td><td>${escapeHtml(r.instansi)}</td></tr>`).join('');
    if (rows.length > 8) {
      tbody.innerHTML += `<tr><td colspan="2" style="color:var(--ink-soft)">+ ${rows.length - 8} baris lainnya...</td></tr>`;
    }
    document.getElementById('confirmBulkBtn').onclick = () => this.confirmBulkImport();
  },

  async confirmBulkImport() {
    if (!this._pendingBulk || !this._pendingBulk.length) return;
    const btn = document.getElementById('confirmBulkBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Mengimpor...';
    try {
      const res = await API.post('bulkAddPeserta', { list: this._pendingBulk });
      if (res.success) {
        this.toast(`${res.data.length} peserta berhasil diimpor.`, 'success');
        document.getElementById('bulkPreview').style.display = 'none';
        document.getElementById('bulkFile').value = '';
        this._pendingBulk = null;
        this.loadPeserta();
      } else {
        this.toast(res.message || 'Gagal mengimpor data.', 'error');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Konfirmasi Impor';
    }
  },

  /* ---------------- TABEL PESERTA ---------------- */
  bindTableToolbar() {
    const searchInput = document.getElementById('tableSearch');
    if (!searchInput) return;
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.state.query = searchInput.value.trim();
        this.state.page = 1;
        this.loadPeserta();
      }, 350);
    });
    document.getElementById('prevPageBtn').addEventListener('click', () => {
      if (this.state.page > 1) { this.state.page--; this.loadPeserta(); }
    });
    document.getElementById('nextPageBtn').addEventListener('click', () => {
      const maxPage = Math.ceil(this.state.total / this.state.pageSize) || 1;
      if (this.state.page < maxPage) { this.state.page++; this.loadPeserta(); }
    });
    document.getElementById('downloadAllBtn').addEventListener('click', () => this.downloadAllZip());
    document.getElementById('reviewAllBtn').addEventListener('click', () => Review.openAt(null));
  },

  async loadPeserta() {
    const tbody = document.querySelector('#pesertaTable tbody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:30px;"><span class="spinner" style="border-top-color:var(--forest);border-color:rgba(20,83,45,.25)"></span> Memuat data...</td></tr>`;
    const res = await API.get('listPeserta', {
      page: this.state.page,
      pageSize: this.state.pageSize,
      q: this.state.query
    });
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--coral-dark);padding:30px;">Gagal memuat data peserta.</td></tr>`;
      return;
    }
    this.state.rows = res.data.rows;
    this.state.total = res.data.total;
    this.renderTable();
  },

  renderTable() {
    const tbody = document.querySelector('#pesertaTable tbody');
    if (!this.state.rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:30px;">Belum ada data peserta.</td></tr>`;
    } else {
      tbody.innerHTML = this.state.rows.map((r) => `
        <tr>
          <td><strong>${escapeHtml(r.kode)}</strong></td>
          <td>${escapeHtml(r.nama)}</td>
          <td>${escapeHtml(r.instansi || '-')}</td>
          <td>${escapeHtml(r.tanggal || '-')}</td>
          <td><span class="badge">${r.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif'}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-act="view" data-kode="${escapeHtml(r.kode)}">👁 Lihat</button>
              <button class="icon-btn" data-act="edit" data-kode="${escapeHtml(r.kode)}">Edit</button>
              <button class="icon-btn" data-act="pdf" data-kode="${escapeHtml(r.kode)}">Unduh</button>
              <button class="icon-btn danger" data-act="delete" data-kode="${escapeHtml(r.kode)}">Hapus</button>
            </div>
          </td>
        </tr>`).join('');
    }
    document.getElementById('pageInfo').textContent =
      `Halaman ${this.state.page} dari ${Math.max(1, Math.ceil(this.state.total / this.state.pageSize))} · ${this.state.total} peserta`;

    tbody.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kode = btn.dataset.kode;
        const row = this.state.rows.find((r) => r.kode === kode);
        if (btn.dataset.act === 'edit') this.openEditModal(row);
        if (btn.dataset.act === 'delete') this.confirmDelete(row);
        if (btn.dataset.act === 'pdf') this.downloadOne(row);
        if (btn.dataset.act === 'view') Review.openAt(kode);
      });
    });
  },

  async downloadOne(row) {
    try {
      const canvas = document.createElement('canvas');
      await CertRenderer.draw(canvas, row, assetsFromSettings(this.state.settings), CONFIG.LAYOUT);
      const blob = await CertRenderer.canvasToPdfBlob(canvas);
      CertRenderer.downloadBlob(blob, `Sertifikat-${row.kode}.pdf`);
    } catch (e) {
      this.toast(e.message || 'Gagal membuat PDF sertifikat ini.', 'error');
    }
  },

  async downloadAllZip() {
    if (!this.state.total) { this.toast('Tidak ada data untuk diunduh.', 'error'); return; }
    const btn = document.getElementById('downloadAllBtn');
    btn.disabled = true;
    document.getElementById('bulkProgress').style.display = 'block';
    const bar = document.querySelector('#bulkProgress > div');
    try {
      const res = await API.get('listPeserta', { page: 1, pageSize: 10000, q: '' });
      const all = res.data.rows;
      // eslint-disable-next-line no-undef
      const zip = new JSZip();
      for (let i = 0; i < all.length; i++) {
        const row = all[i];
        const canvas = document.createElement('canvas');
        await CertRenderer.draw(canvas, row, assetsFromSettings(this.state.settings), CONFIG.LAYOUT);
        const blob = await CertRenderer.canvasToPdfBlob(canvas);
        zip.file(`Sertifikat-${row.kode}-${row.nama.replace(/[^a-z0-9]+/gi, '_')}.pdf`, blob);
        bar.style.width = Math.round(((i + 1) / all.length) * 100) + '%';
      }
      const content = await zip.generateAsync({ type: 'blob' });
      CertRenderer.downloadBlob(content, 'Semua-Sertifikat.zip');
      this.toast(`${all.length} sertifikat berhasil dibuat dalam ZIP.`, 'success');
    } catch (e) {
      this.toast('Gagal membuat ZIP. Coba lagi dengan jumlah data lebih kecil.', 'error');
    } finally {
      btn.disabled = false;
      document.getElementById('bulkProgress').style.display = 'none';
      bar.style.width = '0%';
    }
  },

  /* ---------------- MODAL EDIT / HAPUS ---------------- */
  bindModal() {
    document.getElementById('modalCancelBtn').addEventListener('click', () => this.closeModal());
    const form = document.getElementById('editForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Menyimpan...';
        try {
          const res = await API.post('updatePeserta', {
            kode: this.state.editingKode,
            data: {
              nama: document.getElementById('editNama').value.trim(),
              instansi: document.getElementById('editInstansi').value.trim(),
              status: document.getElementById('editStatus').value
            }
          });
          if (res.success) {
            this.toast('Data peserta diperbarui.', 'success');
            this.closeModal();
            this.loadPeserta();
          } else {
            this.toast(res.message || 'Gagal memperbarui data.', 'error');
          }
        } finally {
          btn.disabled = false;
          btn.textContent = 'Simpan Perubahan';
        }
      });
    }
  },

  openEditModal(row) {
    this.state.editingKode = row.kode;
    document.getElementById('editKodeLabel').textContent = row.kode;
    document.getElementById('editNama').value = row.nama;
    document.getElementById('editInstansi').value = row.instansi || '';
    document.getElementById('editStatus').value = row.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif';
    document.getElementById('modalOverlay').classList.add('show');
  },
  closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
  },

  confirmDelete(row) {
    if (!confirm(`Hapus data "${row.nama}" (${row.kode})? Tindakan ini tidak dapat dibatalkan.`)) return;
    API.post('deletePeserta', { kode: row.kode }).then((res) => {
      if (res.success) {
        this.toast('Peserta dihapus.', 'success');
        this.loadPeserta();
      } else {
        this.toast(res.message || 'Gagal menghapus peserta.', 'error');
      }
    });
  }
};

/* ---------------------------------------------------------------------
 * REVIEW SERTIFIKAT (satu peserta / semua peserta, gaya "Halaman X / Y")
 * ------------------------------------------------------------------- */
const Review = {
  list: [],
  index: 0,
  zoom: 100,

  bind() {
    const closeBtn = document.getElementById('reviewCloseBtn');
    if (!closeBtn) return; // bukan admin.html
    closeBtn.addEventListener('click', () => this.close());
    document.getElementById('reviewModalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'reviewModalOverlay') this.close();
    });
    document.getElementById('reviewPrevBtn').addEventListener('click', () => this.prev());
    document.getElementById('reviewNextBtn').addEventListener('click', () => this.next());
    document.getElementById('reviewZoomInBtn').addEventListener('click', () => this.setZoom(this.zoom + 10));
    document.getElementById('reviewZoomOutBtn').addEventListener('click', () => this.setZoom(this.zoom - 10));
    document.getElementById('reviewDownloadBtn').addEventListener('click', () => this.downloadCurrent());
  },

  /** kode = null -> buka dari peserta pertama ("Review Semua Peserta"); kode = "SBB-..." -> langsung loncat ke peserta itu */
  async openAt(kode) {
    Admin.toast('Menyiapkan data untuk direview...', '');
    const res = await API.get('listPeserta', { page: 1, pageSize: 10000, q: '' });
    if (!res.success || !res.data.rows.length) {
      Admin.toast('Belum ada data peserta untuk direview.', 'error');
      return;
    }
    this.list = res.data.rows;
    this.index = kode ? Math.max(0, this.list.findIndex((r) => r.kode === kode)) : 0;
    this.zoom = 100;
    document.getElementById('reviewModalOverlay').classList.add('show');
    await this.render();
  },

  close() {
    document.getElementById('reviewModalOverlay').classList.remove('show');
  },

  prev() { if (this.index > 0) { this.index--; this.render(); } },
  next() { if (this.index < this.list.length - 1) { this.index++; this.render(); } },
  setZoom(pct) { this.zoom = Math.max(40, Math.min(300, pct)); this.render(); },

  async render() {
    const row = this.list[this.index];
    document.getElementById('reviewPageInfo').textContent = `Halaman ${this.index + 1} / ${this.list.length}`;
    document.getElementById('reviewMetaLabel').textContent = `${row.kode} — ${row.nama}`;
    document.getElementById('reviewZoomLabel').textContent = this.zoom + '%';
    document.getElementById('reviewPrevBtn').disabled = this.index === 0;
    document.getElementById('reviewNextBtn').disabled = this.index === this.list.length - 1;

    const canvas = document.getElementById('reviewCanvas');
    canvas.style.width = Math.round(640 * (this.zoom / 100)) + 'px';
    await CertRenderer.draw(canvas, row, assetsFromSettings(Admin.state.settings), CONFIG.LAYOUT);
  },

  async downloadCurrent() {
    const row = this.list[this.index];
    const btn = document.getElementById('reviewDownloadBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Menyiapkan...';
    try {
      const canvas = document.getElementById('reviewCanvas');
      const blob = await CertRenderer.canvasToPdfBlob(canvas);
      CertRenderer.downloadBlob(blob, `Sertifikat-${row.kode}.pdf`);
    } catch (e) {
      Admin.toast(e.message || 'Gagal membuat PDF.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download PDF Peserta Ini';
    }
  }
};

/* ---------------- util ---------------- */
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Menghapus latar belakang putih pada gambar TTD/stempel/logo secara otomatis
 * di browser sebelum diunggah, lalu mengembalikan PNG (mimeType + base64).
 * - Berlaku untuk JPG (yang memang tidak punya kanal transparansi) MAUPUN PNG
 *   yang latarnya masih putih solid (mis. hasil scan/foto TTD di kertas putih).
 * - Kalau file PNG yang diunggah SUDAH punya transparansi asli yang cukup luas,
 *   file dibiarkan apa adanya supaya transparansi yang sudah sengaja dibuat
 *   admin (mis. logo dengan lubang transparan) tidak ikut diutak-atik.
 * - Memakai flood-fill dari TEPI gambar (bukan seluruh gambar) supaya area putih
 *   yang TERTUTUP di tengah (mis. celah pada huruf "o", "a") tidak ikut hilang.
 */
async function stripWhiteBackground(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = objectUrl;
  });

  const MAX_DIM = 1400; // cukup tajam untuk TTD/stempel/logo, tapi ringan diproses
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(objectUrl);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;

  if (file.type === 'image/png') {
    let transparentPixels = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transparentPixels++;
    if (transparentPixels / (w * h) > 0.02) {
      // Sudah punya transparansi asli yang berarti -> jangan diproses ulang.
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return { mimeType: 'image/png', base64: await blobToBase64(blob) };
    }
  }

  const WHITE_MIN = 235; // ambang kemiripan dengan putih (0-255 per kanal)
  const isNearWhite = (r, g, b) => r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN;

  const visited = new Uint8Array(w * h);
  const stackX = [];
  const stackY = [];
  for (let x = 0; x < w; x++) { stackX.push(x, x); stackY.push(0, h - 1); }
  for (let y = 0; y < h; y++) { stackX.push(0, w - 1); stackY.push(y, y); }

  while (stackX.length) {
    const x = stackX.pop();
    const y = stackY.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const p = idx * 4;
    const r = px[p], g = px[p + 1], b = px[p + 2];
    if (!isNearWhite(r, g, b)) continue;
    // Pudarkan bertahap dekat tepi objek supaya hasilnya tidak bergerigi.
    const dist = Math.min(255 - r, 255 - g, 255 - b);
    px[p + 3] = Math.round(255 * Math.min(1, dist / (255 - WHITE_MIN + 1)));
    stackX.push(x + 1, x - 1, x, x); stackY.push(y, y, y + 1, y - 1);
  }

  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { mimeType: 'image/png', base64: await blobToBase64(blob) };
}

document.addEventListener('DOMContentLoaded', () => Admin.init());
