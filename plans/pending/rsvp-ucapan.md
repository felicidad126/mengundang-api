# RSVP dan ucapan tersimpan di server

Status: **disetujui 20 November 2026; fase 1, 2, 4.1, 4.3, 5 selesai di kode** (lihat Progres).
Repo kode: `felicidad126/mengundang-api` (baru). Situs: `felicidad126/felicidad126.github.io`.

## Masalah

Form RSVP dan buku ucapan di 10 tema hanya menyimpan data di HP tamu (`localStorage`,
"Preview: data tersimpan di perangkat ini saja"). Untuk undangan klien sungguhan, mempelai
tidak pernah menerima jawaban tamunya.

## Hasil yang dituju (kriteria sukses)

1. Di undangan klien, RSVP dan ucapan tamu tersimpan di server. Untuk sekarang admin
   Helonoia mengekspor CSV dan menyembunyikan ucapan lewat perintah di server; portal
   khusus customer dibuat kemudian di rencana terpisah, di atas database yang sama.
2. Demo tema di katalog tetap bekerja persis seperti sekarang (mode Preview, tanpa server).
3. Database tidak bisa dicapai dari internet, dibackup terenkripsi setiap hari, salinan
   kedua ditarik ke VM lokal Anda, dan backup terbukti bisa dipulihkan (latihan restore
   lulus di CI setiap push).
4. Data pribadi tamu (nama, nomor WhatsApp) tidak pernah tampil ke publik (hanya nama dan
   pesan ucapan), dan dihapus otomatis 90 hari setelah tanggal acara.
5. Semua bagian mengikuti pola yang sudah dipakai di repo `tyio` (image dari CI dipin
   digest, migrasi sebagai langkah terpisah, backup GPG, latihan restore).

## Rancangan singkat

```
Tamu (HP) ──HTTPS──> nginx invitation.helonoia.com ──┬─ /            berkas statis (sudah ada)
                                                    └─ /api/  ──> 127.0.0.1:8090 api (container)
                                                                       │ jaringan internal compose
                                                                       ▼
                                                                  db PostgreSQL 18 (tanpa port host)
                                                                       ▲
                                                                  backup (pg_dump → GPG → folder backup)
                                                                       ▲
                                       VM lokal Anda ──Tailscale/SSH, hanya-baca── tarik harian (cron)
```

- **Satu origin**: API di `invitation.helonoia.com/api/`, jadi tanpa CORS dan tanpa cookie.
- **Acara** (satu per pasangan) punya `id`, `slug`, tanggal acara, dan batas RSVP. Acara
  dibuat admin lewat perintah CLI di server. Portal customer kelak menempel ke `acara.id`.
- **Undangan klien** menandai dirinya dengan `<meta name="acara" content="<slug>">`.
  Tanpa tag itu (semua demo), tema tetap memakai `localStorage` seperti sekarang.
- **Satu skrip bersama** `/acara.js` di situs menyediakan `kirimRsvp`, `kirimUcapan`, dan
  `daftarUcapan`; setiap tema hanya mengganti panggilan `store.get/set` ke skrip itu.
- **Satu perangkat, satu RSVP**: setiap HP diberi `perangkat_id` acak (disimpan di
  `localStorage`). Kirim ulang dari HP yang sama memperbarui jawaban, bukan menggandakan.
- **Perintah admin** (dijalankan di server, dari image yang sama): `acara:buat`,
  `acara:daftar`, `rsvp:ekspor <slug>` (CSV), `ucapan:sembunyikan <id>` / `ucapan:tampilkan <id>`.
  Belum ada endpoint kelola di API; itu bagian portal customer nanti.

### API

| Metode | Jalur | Akses | Isi |
| --- | --- | --- | --- |
| GET | `/api/health` | publik | status aplikasi dan database |
| GET | `/api/acara/:slug/ucapan` | publik | ucapan yang tampil (nama, pesan, waktu), terbaru dulu, berhalaman |
| POST | `/api/acara/:slug/ucapan` | publik, dibatasi | nama ≤ 80 (sama dengan tema), pesan ≤ 500 |
| PUT | `/api/acara/:slug/rsvp` | publik, dibatasi | perangkat_id, nama, kehadiran (`hadir`/`tidak`/`ragu`), jumlah 1–10, WhatsApp opsional, pesan opsional |

Batas: nginx `limit_req` 10 permintaan tulis per menit per IP (burst 5), badan permintaan
maks 8 KB, kolom honeypot anti-spam, setelah `batas_rsvp` RSVP ditolak dengan pesan jelas.

## Fase dan langkah

Setiap langkah: ukuran, kriteria terima, perintah verifikasi, dan langkah yang harus
selesai lebih dulu (*Blocked by*). Langkah yang semua pendahulunya selesai boleh paralel.

### Fase 0 — Prasyarat dari Anda (tidak bisa saya kerjakan)

- **0.1** Login GitHub di Chrome ini, supaya saya bisa membuat repo dan pull request.
- **0.2** Buat pasangan kunci backup di laptop Anda (perintah saya siapkan), kirim hanya
  kunci **publik**. Kunci privat + passphrase disimpan di dua tempat, tidak di server.
- **0.3** (nanti) VM lokal Linux dengan Tailscale yang tersambung ke tailnet yang sama dengan
  server, dan kunci SSH publik dari VM lokal itu. Saya tidak mengetik token atau kata sandi
  apa pun; login Tailscale Anda lakukan sendiri.

### Fase 1 — Fondasi repo dan database

Terverifikasi bila: CI hijau (lint, cek tipe, uji dengan PostgreSQL asli, build image, uji asap compose).

- **1.1 Repo, CI, image** (M) — Node 26 LTS, TypeScript, Fastify, `pg`; Dockerfile dua tahap,
  jalan sebagai `node`, healthcheck; CI dengan action dipin SHA. *Verifikasi:* CI hijau.
  *Blocked by:* 0.1
- **1.2 Skema + migrasi** (S) — tabel `acara`, `rsvp`, `ucapan`; migrasi SQL naik/turun;
  peran database terpisah: pemilik (migrasi) dan `aplikasi` (hanya SELECT/INSERT/UPDATE/DELETE).
  *Verifikasi:* `pnpm test` (migrasi naik → turun → naik). *Blocked by:* 1.1

### Fase 2 — Ucapan dan RSVP (alur utuh, diuji di API)

Terverifikasi bila: uji API lulus untuk alur normal, validasi, batas waktu, dan slug tak dikenal.

- **2.1 Ucapan** (S) — GET berhalaman + POST. *Blocked by:* 1.2
- **2.2 RSVP** (S) — PUT upsert per `perangkat_id`, tolak setelah batas RSVP. *Blocked by:* 1.2
- **2.3 Perintah admin** (S) — `acara:buat`, `acara:daftar`, `rsvp:ekspor` (CSV, aman dari
  formula injection di Excel), `ucapan:sembunyikan/tampilkan`. *Blocked by:* 2.1, 2.2

### Fase 3 — Pasang di VM

Terverifikasi bila: `https://invitation.helonoia.com/api/health` 200 dan port database tidak terbuka.

- **3.1 Stack compose** (S) — `/opt/mengundang-api`: db, migrate, api, backup; env mode 600;
  container read-only, `no-new-privileges`, `cap_drop: ALL`, batas memori, log berotasi;
  api hanya di `127.0.0.1:8090`. *Blocked by:* 1.1
- **3.2 nginx** (S) — `location /api/` ke api, `limit_req`, `client_max_body_size 8k`.
  *Verifikasi:* uji beban kecil memicu 429. *Blocked by:* 3.1

### Fase 4 — Backup dan retensi

Terverifikasi bila: ada backup terenkripsi < 26 jam (service backup *healthy*), latihan
restore lulus di CI, dan (setelah 0.3) VM lokal punya salinan backup terbaru.

- **4.1 Backup GPG** (M) — skrip dari `tyio/deploy/scripts` (backup, terjadwal, sehat,
  restore, latihan-restore, uji-backup) disesuaikan; 01:30 WIB, simpan 30 hari.
  *Blocked by:* 0.2, 3.1
- **4.2 Salinan kedua, model tarik** (S) — di server: akun `tarik-backup` khusus, hanya kunci
  SSH, dikunci `rrsync -ro` ke folder backup (tidak bisa shell, tidak bisa menulis/menghapus).
  Di VM lokal: skrip `tarik-backup.sh` + cron 03:17 WIB, simpan 90 hari, gagal bila backup
  terbaru > 26 jam. Server tidak pernah memegang akses ke VM lokal. Skrip dan akun disiapkan
  sekarang; diaktifkan saat 0.3 siap. *Blocked by:* 4.1 (aktivasi: 0.3)
- **4.3 Retensi data** (S) — tugas harian menghapus RSVP dan ucapan 90 hari setelah tanggal
  acara; diuji. *Blocked by:* 2.2

### Fase 5 — Situs: 10 tema

Terverifikasi bila: uji Playwright di semua 10 tema lulus dua kali — tanpa tag acara
(perilaku lama, tanpa permintaan ke `/api`) dan dengan tag acara (data masuk database,
memakai acara uji yang dihapus setelahnya).

- **5.1 `/acara.js` + Lengkung Sage** (S) — satu tema dulu sebagai pola. *Blocked by:* 3.2
- **5.2 Sembilan tema lain** (M) — pola yang sama; teks "Preview" hanya di mode demo, di
  undangan klien diganti pemberitahuan singkat ke mana data dikirim. *Blocked by:* 5.1
- **5.3 README situs** (XS) — alamat utama sekarang VM, Pages jadi cadangan; cara membuat
  undangan klien bertag acara. *Blocked by:* 5.2

### Fase 6 — Dokumentasi dan serah terima

- **6.1** `docs/operasi.md`: menjalankan, membuat acara, rilis, backup, restore. Arsipkan
  rencana ini dengan catatan eksekusi. *Blocked by:* semua di atas

## Keputusan

| # | Keputusan | Alasan |
| --- | --- | --- |
| D1 | Repo terpisah `mengundang-api`, publik seperti `tyio` | Repo situs dilayani apa adanya di tiga tempat; kode tidak berisi rahasia; image GHCR publik bisa ditarik server tanpa token |
| D2 | Node 26 + Fastify + `pg` + migrasi SQL, bukan NestJS/TypeORM | Hanya 7 endpoint; lebih sedikit dependensi dan lebih mudah dirawat. Pola deploy, CI, dan backup tetap sama dengan `tyio` |
| D3 | Stack sendiri (db, migrate, api, backup), terpisah dari `tyio-staging` | Reset atau migrasi staging tyio tidak menyentuh data tamu |
| D4 | API satu origin di `/api/` lewat nginx yang sudah ada | Tanpa CORS; TLS sudah ada |
| D5 | Belum ada endpoint kelola; admin memakai perintah CLI di server | Portal customer dibuat terpisah nanti; endpoint dengan token sekarang akan terbuang |
| D6 | IP tamu tidak disimpan; pembatasan di nginx | Minimisasi data pribadi (UU PDP) |
| D7 | Backup GPG kunci publik, kunci privat tidak pernah di server | Server dibobol ≠ backup terbaca |
| D8 | Rilis API manual: ganti digest image di env lalu `up -d --wait` | Migrasi database selalu disengaja, tidak otomatis tiap push |
| D9 | Salinan kedua ditarik oleh VM lokal (pull), bukan didorong server | Server yang dibobol tidak bisa menghapus atau merusak salinan di VM lokal |

## Belum ditentukan

- Fase 5: cara membuat undangan klien (salin folder tema + isi data asli + tag acara?) —
  **kabut**, di luar rencana ini. Rencana ini hanya menyiapkan tag `meta acara`.
- Fase 4.2: nama host Tailscale server dan VM lokal — diisi saat 0.3.
- Portal customer: rencana terpisah (akun customer, login, tampilan RSVP).

## Selalu / Tidak pernah

- Selalu: versi dipin persis (image dengan digest, action dengan SHA); setiap migrasi punya
  jalur turun; setiap perubahan lewat pull request yang Anda merge; undangan klien pertama
  baru boleh tayang setelah service backup *healthy*.
- Tidak pernah: port database dibuka ke host; rahasia masuk git; saya mengetik token atau
  kata sandi; data demo dikirim ke server.
- Di luar cakupan: portal customer, membuat undangan klien, notifikasi WhatsApp/email ke
  mempelai, memasang Tailscale, backup `tyio-staging`, pembaruan OS server.

## Progres

| Fase | Status |
| --- | --- |
| 0 Prasyarat | 0.1 login GitHub dan 0.2 kunci publik backup menunggu pemilik; 0.3 (VM lokal + Tailscale) nanti |
| 1 Fondasi | selesai: lint, build, 50 uji API dengan PostgreSQL 18 asli (API diuji dengan hak `mengundang_app`) |
| 2 Ucapan dan RSVP | selesai, termasuk perintah admin dan retensi; uji mutasi menangkap kesalahan retensi dan upsert |
| 3 Pasang di VM | menunggu image dari CI (butuh repo di GitHub) dan kunci publik backup |
| 4 Backup dan retensi | 4.1 dan 4.3 selesai; uji asap compose: backup, latihan restore, 11 uji skrip backup lulus; prosedur restore sungguhan dicoba di stack baru (COCOK). 4.2 skrip dan akun siap (9 uji lulus), aktivasi menunggu 0.3 |
| 5 Situs (10 tema) | selesai: 20 uji Playwright (10 tema × demo/klien) + jalur galat lulus; README situs diperbarui |
| 6 Dokumentasi | `docs/operasi.md` dan README selesai; arsip rencana setelah fase 3 |
