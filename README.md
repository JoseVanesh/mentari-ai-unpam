# Mentari AI

Asisten AI berbasis ekstensi Chrome untuk membantu aktivitas belajar di **Mentari UNPAM** (`mentari.unpam.ac.id`). Extension membaca soal, kuesioner, atau topik forum yang sedang terbuka, meminta bantuan **Gemini**, lalu mengisi halaman secara otomatis atau menyiapkan draf—tanpa pernah menekan tombol submit/selesai.

> **Status:** v0.2.6 · Chrome Manifest V3

## Fitur

### Quiz / Pre-Test / Post-Test

- Menjawab soal pilihan ganda (`MULTIPLE_CHOICE`) secara otomatis.
- Soal essay dan blok deskripsi dilewati untuk diisi manual.
- Jawaban yang sudah ada tidak diubah.
- Mendeteksi quiz yang belum dimulai atau sudah selesai.
- Retry otomatis dan pesan error yang jelas jika penyimpanan jawaban gagal.
- Menunggu otomatis sampai quiz dimulai, lalu mengisi jawaban.

### Kuesioner

- Mengisi grup Ya/Tidak yang masih kosong dengan **"Ya"**.
- Jawaban yang sudah diisi tetap dipertahankan.
- Tidak pernah menekan tombol submit.

### Forum diskusi

- Menyusun draf balasan berdasarkan konteks topik.
- Mengisi draf ke textarea atau CKEditor.
- Pengiriman balasan tetap dilakukan manual oleh pengguna.

### Lainnya

- Panel AI muncul di kanan bawah halaman dan mendukung navigasi SPA Mentari.
- Pengaturan lanjutan: model Gemini, ambang confidence, jumlah soal per batch, konteks materi/RPS, dan mode debug.
- Fallback model otomatis saat model utama terkena limit free tier Gemini.

## Keamanan dan batasan

- Tidak pernah memanggil endpoint untuk mengakhiri atau menyubmit quiz.
- Tidak pernah mengklik tombol **"Mulai Quiz"** atau **"Selesai Quiz"**.
- Tidak pernah mengirim balasan forum.
- Hanya mendukung role **MAHASISWA**.
- API key disimpan lokal di `chrome.storage.local`; tidak ada server perantara.
- Semua jawaban tetap perlu direview sebelum diselesaikan.

## Instalasi

1. Download file ZIP atau release terbaru.
2. Extract ke folder lokal.
3. Buka `chrome://extensions`.
4. Aktifkan **Developer mode**.
5. Klik **Load unpacked**, lalu pilih folder extension.
6. Buka popup extension, isi **Gemini API Key**, lalu klik **Simpan** dan **Test Koneksi**.
7. Buka halaman quiz, kuesioner, atau topik forum di Mentari.

## Penggunaan

- **Quiz**: buka halaman exam, klik **"Kerjakan Quiz"** lalu **"Mulai Quiz"**. Jawaban pilihan ganda akan diisi otomatis. Review tiap halaman, lalu klik **"Selesai Quiz"** sendiri.
- **Kuesioner**: buka halaman kuesioner. Grup yang masih kosong akan diisi **"Ya"** secara otomatis. Periksa kembali sebelum submit manual.
- **Forum**: buka topik diskusi, gunakan tombol **"Balas dengan AI"** untuk mengisi draf, lalu edit dan kirim sendiri.

## Pengaturan

| Pengaturan | Lokasi | Keterangan |
| --- | --- | --- |
| API Key Gemini | Popup | Disimpan lokal di browser. |
| Model | Popup | Default `gemini-3.5-flash`. |
| Ambang confidence | Options | Jawaban di bawah nilai ini ditandai untuk direview. |
| Batch size | Options | Jumlah soal per permintaan AI (1–20). |
| Konteks materi/RPS | Options | Konteks tambahan untuk meningkatkan akurasi. |
| Mode debug | Options | Log detail ke console halaman. |
| Toggle fitur | Popup | Quiz, kuesioner, dan forum dapat dimatikan. |

## Privasi

- API key hanya disimpan di penyimpanan lokal browser.
- Soal/konten yang diproses dikirim langsung ke Google Generative Language API menggunakan API key milik pengguna.
- Tidak ada backend, analytics, atau pengumpulan data oleh extension ini.

## Teknologi

- Chrome Manifest V3
- Vanilla JavaScript
- Shadow DOM untuk panel UI
- MAIN-world bridge untuk integrasi CKEditor
- Gemini Interactions API dengan fallback `generateContent`

## Struktur project

```text
.
├── manifest.json
├── assets/
│   └── icons/
└── src/
    ├── background/     # service worker, Gemini client, prompt
    ├── content/        # panel UI, API client, fitur quiz/kuesioner/forum
    ├── options/        # halaman pengaturan lanjutan
    ├── popup/          # popup extension
    └── shared/         # konstanta, routing, selector, storage
```

## Batasan

- Struktur DOM dan API Mentari dapat berubah sewaktu-waktu.
- Akurasi jawaban bergantung pada model dan konteks yang diberikan.
- Free tier Gemini memiliki batas harian.
- Belum diuji untuk role selain mahasiswa.

## Disclaimer

Project ini **bukan produk resmi UNPAM/Mentari**. Gunakan secara bertanggung jawab dan patuhi aturan akademik serta kebijakan kampus. Pengguna bertanggung jawab penuh atas penggunaan extension ini.

## Lisensi

Dirilis di bawah [MIT License](LICENSE).
