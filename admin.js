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
  },

  toast(message, type = '') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
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
    const L = {
      kode: Object.assign({}, CONFIG.LAYOUT.kode, (res.data.layout && res.data.layout.kode) || {}),
      nama: Object.assign({}, CONFIG.LAYOUT.nama, (res.data.layout && res.data.layout.nama) || {}),
      qr: Object.assign({}, CONFIG.LAYOUT.qr, (res.data.layout && res.data.layout.qr) || {})
    };
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
  },

  bindSettingsForm() {
    const dropZone = document.getElementById('blangkoDrop');
    const fileInput = document.getElementById('blangkoFile');
    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => this.handleBlangkoFile(fileInput.files[0]));
    }

    const form = document.getElementById('settingsForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Menyimpan...';
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
          this.toast('Pengaturan tersimpan.', 'success');
          Object.assign(CONFIG.LAYOUT, layout);
          this.loadSettings();
        } else {
          this.toast(res.message || 'Gagal menyimpan pengaturan.', 'error');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan';
      }
    });

    document.getElementById('previewPosisiBtn').addEventListener('click', () => this.previewPosisi());
    document.getElementById('downloadTemplateBtn').addEventListener('click', () => this.downloadTemplateCsv());
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
        this.toast('Blangko berhasil diunggah.', 'success');
      } else {
        this.toast(res.message || 'Gagal mengunggah blangko.', 'error');
      }
    } catch (e) {
      this.toast('Gagal mengunggah blangko. Coba file yang lebih kecil.', 'error');
    }
  },

  async previewPosisi() {
    if (!this.state.settings || !this.state.settings.blangkoUrl) {
      this.toast('Unggah blangko terlebih dahulu.', 'error');
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
    const canvas = document.getElementById('previewCanvas');
    document.getElementById('previewWrap').style.display = 'block';
    await CertRenderer.draw(canvas, {
      kode: (this.state.settings.kodePrefix || 'SBB-2026-') + '0001',
      nama: 'Nama Peserta Contoh'
    }, this.state.settings.blangkoUrl, layout);
  },

  downloadTemplateCsv() {
    const header = 'No,Nama,Nama Sekolah\n';
    const sample = '1,Contoh Nama Peserta,SD Negeri Cigombong 01\n2,Contoh Nama Peserta Dua,SD Negeri Cigombong 02\n';
    const blob = new Blob([header + sample], { type: 'text/csv;charset=utf-8' });
    CertRenderer.downloadBlob(blob, 'Template-Data-Peserta.csv');
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
      });
    });
  },

  async downloadOne(row) {
    const canvas = document.createElement('canvas');
    await CertRenderer.draw(canvas, row, this.state.settings && this.state.settings.blangkoUrl, CONFIG.LAYOUT);
    const blob = await CertRenderer.canvasToPdfBlob(canvas);
    CertRenderer.downloadBlob(blob, `Sertifikat-${row.kode}.pdf`);
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
        await CertRenderer.draw(canvas, row, this.state.settings && this.state.settings.blangkoUrl, CONFIG.LAYOUT);
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

/* ---------------- util ---------------- */
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

document.addEventListener('DOMContentLoaded', () => Admin.init());
