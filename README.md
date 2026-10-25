# Otomatisasi Pemeriksaan KBLI FASIH

Sistem ini terpisah dari otomatisasi pemeriksaan biaya/pengeluaran dan pendapatan. Sumber data adalah `Data.xlsx`, daftar kode berasal dari `Daftar_Lengkap_KBLI_2025.xlsx`, dan perubahan FASIH hanya dilakukan pada rincian 13.g.

## Instalasi awal

1. Instal Node.js LTS dan Google Chrome.
2. Unduh atau clone repositori ini.
3. Salin `Data.xlsx` dan `Daftar_Lengkap_KBLI_2025.xlsx` ke folder utama repositori. Kedua file ini sengaja tidak disertakan di GitHub karena berisi data operasional/referensi lokal.
4. Buka `chrome://extensions` di Chrome.
5. Aktifkan **Developer mode**.
6. Klik **Load unpacked** lalu pilih folder `fasih-kbli-assistant-extension`.
7. Jika ekstensi pemeriksaan biaya lama masih aktif, biarkan saja. Kedua ekstensi memakai penanda proses yang berbeda.
8. Pastikan Anda sudah login ke FASIH pada Chrome yang sama.

## Menjalankan

- macOS: klik dua kali `MULAI_MAC.command`. Jika macOS menolak, klik kanan lalu pilih **Open** sekali.
- Windows: klik dua kali `MULAI_WINDOWS.bat`.
- Alternatif terminal: masuk ke folder `fasih-kbli-automation`, lalu jalankan `npm run manual-assist`.

Chrome akan membuka halaman pendamping. Pilih petugas, periksa maksimal 10 usaha pada slot tetap, lalu:

- **Sesuai (#0)** mempertahankan KBLI sebelumnya dan menulis remark `#0` pada 13.g.
- **Ubah data (#1–#4)** memakai KBLI target yang dipilih dan menulis nomor remark yang sama pada 13.g.
- Bila kode target tersedia pada rekomendasi FASIH, pilihan itu digunakan. Bila tidak, sistem memilih **Pilih dari Master KBLI**.
- Khusus petugas **Naflah**, tombol **Mulai otomatis Sesuai (#0)** memproses seluruh antrean secara berurutan. Setelah satu usaha berhasil diverifikasi dan slot baru muncul, usaha berikutnya langsung diproses dengan `#0`. Proses otomatis berhenti jika antrean habis, tombol dihentikan, atau satu usaha gagal.

Status di kolom B baru ditulis setelah perubahan FASIH tersimpan, proses kirim selesai, dan hasilnya diverifikasi. Penulisan dilakukan satu per satu dan identitas nama usaha pada nomor baris diperiksa ulang sebelum file diubah.

Jika ringkasan FASIH menemukan lebih dari satu galat, sistem tidak menampilkan alert pengganggu; status `Error` ditulis ke kolom B dan slot tersebut dilanjutkan ke usaha berikutnya.

## Struktur kolom

- Petugas: A; status: B; deskripsi: L dan AG:AO; KBLI sebelumnya: M/O.
- Alasan pusat: W; kategori pusat: Y; link FASIH: AC; nama usaha: AD; catatan: AF.
- Rekomendasi NFRQ: kode AP, kategori AQ, status AR, alasan AS.

## Catatan penting

- Tutup `Data.xlsx` di Microsoft Excel ketika otomatisasi sedang menulis status agar sinkronisasi OneDrive tidak membuat konflik salinan.
- Jangan menutup terminal selama proses masih berjalan.
- Jika data sumber dipindahkan atau namanya berubah, sesuaikan `fasih-kbli-automation/config.json`.
