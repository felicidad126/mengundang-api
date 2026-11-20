#!/usr/bin/env bash
# Uji asap stack produksi (deploy/compose.yml) dengan image yang diberikan: nyalakan semua service
# dengan kata sandi dan kunci backup sekali pakai, jalankan alur utama lewat HTTP dan perintah
# admin, periksa pengerasan container, lalu backup + latihan restore + uji skrip backup.
#
#   MENGUNDANG_IMAGE=mengundang-api:lokal deploy/uji-asap.sh
#
# Butuh: docker compose, curl, gpg, openssl. Latihan restore membaca berkas backup milik root,
# jadi jalankan sebagai root (CI: sudo -E). UJI_SIMPAN=1: stack tidak dimatikan di akhir.

set -Eeuo pipefail
: "${MENGUNDANG_IMAGE:?MENGUNDANG_IMAGE wajib diisi}"
deploy=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d /tmp/mengundang-asap.XXXXXX)
port="${UJI_PORT:-18090}"
base="http://127.0.0.1:$port"
env_file="$work/uji.env"
compose=(docker compose --project-name mengundang-asap --env-file "$env_file" -f "$deploy/compose.yml")

log() { printf '== %s\n' "$*" >&2; }
gagal() {
  log "GAGAL: $*"
  exit 1
}
selesai() {
  local status=$?
  if ((status != 0)); then "${compose[@]}" logs --no-color --tail 80 >&2 || true; fi
  if [[ -z "${UJI_SIMPAN:-}" ]]; then "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; fi
  GNUPGHOME="$work/gnupg" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
  [[ -z "${UJI_SIMPAN:-}" ]] && rm -rf "$work"
  exit "$status"
}
trap selesai EXIT

http() { curl --noproxy '*' -sS -o "$work/badan" -w '%{http_code}' "$@"; }
harus() {
  local kode="$1" nama="$2"
  shift 2
  local dapat
  dapat=$(http "$@") || gagal "$nama: curl gagal"
  [[ "$dapat" == "$kode" ]] || gagal "$nama: status $dapat, seharusnya $kode: $(cat "$work/badan")"
  log "LULUS  $nama ($kode)"
}

log "Kunci backup sekali pakai dan berkas env"
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
mkdir "$work/backup"
gpg --batch --quiet --passphrase '' --quick-gen-key 'Mengundang Uji <uji@mengundang.invalid>' future-default default never
gpg --armor --export uji@mengundang.invalid >"$work/backup-public.asc"
gpg --batch --pinentry-mode loopback --passphrase '' --armor --export-secret-keys uji@mengundang.invalid >"$work/backup-private.asc"
gpgconf --kill gpg-agent
db_pw=$(openssl rand -hex 32)
cat >"$env_file" <<ENV
MENGUNDANG_IMAGE=$MENGUNDANG_IMAGE
MENGUNDANG_DB_PASSWORD=$db_pw
MENGUNDANG_APP_DB_PASSWORD=$(openssl rand -hex 32)
MENGUNDANG_ASAL=https://invitation.helonoia.com
MENGUNDANG_API_PORT=$port
MENGUNDANG_BACKUP_PUBLIC_KEY=$work/backup-public.asc
MENGUNDANG_BACKUP_DIR=$work/backup
ENV
chmod 600 "$env_file"

log "Menyalakan stack"
"${compose[@]}" up -d --wait --wait-timeout 180

log "Alur utama"
harus 200 "health" "$base/api/health"
"${compose[@]}" run --rm -T admin acara:buat --slug uji-asap --nama 'Uji & Asap' --tanggal 2099-01-01 --batas-rsvp 2098-12-25 >/dev/null
harus 404 "acara tidak dikenal" "$base/api/acara/tidak-ada/ucapan"
json=(-H 'content-type: application/json' -H 'origin: https://invitation.helonoia.com')
harus 201 "kirim ucapan" -X POST "${json[@]}" -d '{"nama":"Budi","pesan":"Selamat!"}' "$base/api/acara/uji-asap/ucapan"
harus 200 "baca ucapan" "$base/api/acara/uji-asap/ucapan"
grep -q '"jumlah":1' "$work/badan" || gagal "ucapan tidak terbaca: $(cat "$work/badan")"
harus 403 "origin lain ditolak" -X POST -H 'content-type: application/json' -H 'origin: https://contoh.com' \
  -d '{"nama":"Budi","pesan":"x"}' "$base/api/acara/uji-asap/ucapan"
harus 200 "kirim RSVP" -X PUT "${json[@]}" \
  -d '{"perangkat_id":"3f2b7c1e-8d4a-4b6f-9c2e-1a5d7e9f0b3c","nama":"Sari","kehadiran":"hadir","jumlah":2,"telepon":"0812 3456 7890"}' \
  "$base/api/acara/uji-asap/rsvp"
"${compose[@]}" run --rm -T admin rsvp:ekspor uji-asap >"$work/rsvp.csv"
grep -q '"Sari","Hadir","2","6281234567890"' "$work/rsvp.csv" || gagal "CSV tidak berisi RSVP: $(cat "$work/rsvp.csv")"
log "LULUS  ekspor CSV"
"${compose[@]}" run --rm -T admin acara:daftar | grep -qP '^uji-asap\tUji & Asap\t2099-01-01\t2098-12-26 00:00\t1\t2\t0\t0\t1$' ||
  gagal "acara:daftar tidak sesuai"
log "LULUS  acara:daftar"

log "Pengerasan"
terbuka=$("${compose[@]}" port db 5432 2>/dev/null || true)
[[ -z "$terbuka" || "$terbuka" == ":0" ]] || gagal "port database terbuka ke host: $terbuka"
log "LULUS  port database tidak terbuka"
[[ "$("${compose[@]}" exec -T api id -u)" != "0" ]] || gagal "api berjalan sebagai root"
log "LULUS  api bukan root"
"${compose[@]}" exec -T api sh -c 'touch /app/coba' 2>/dev/null && gagal "sistem berkas api bisa ditulis"
log "LULUS  sistem berkas api hanya-baca"
"${compose[@]}" exec -T db sh -c 'getent hosts example.com >/dev/null || exit 0; exit 1' ||
  log "PERHATIAN: db bisa menyelesaikan nama domain luar (jaringan dalam seharusnya tanpa internet)"

log "Backup, latihan restore, uji skrip backup"
"${compose[@]}" exec -T backup bash /scripts/backup.sh >/dev/null
BACKUP_DIR="$work/backup" BACKUP_PRIVATE_KEY="$work/backup-private.asc" bash "$deploy/scripts/latihan-restore.sh"
"${compose[@]}" run --rm --no-deps -T --entrypoint bash \
  -e UJI_SERVER_URL="postgres://mengundang:$db_pw@db:5432/postgres" backup /scripts/uji-backup.sh
[[ "$("${compose[@]}" ps --format '{{.Health}}' backup)" == "healthy" ]] || log "PERHATIAN: service backup belum healthy"
log "SEMUA LULUS"
