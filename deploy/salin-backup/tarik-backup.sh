#!/usr/bin/env bash
# Dijalankan di VM LOKAL (bukan di server), oleh cron: menarik backup terenkripsi dari server
# lewat Tailscale + SSH. Server tidak pernah memegang akses ke VM lokal (model tarik), jadi
# server yang dibobol tidak bisa menghapus salinan di sini.
#
#   TARIK_SUMBER=tarik-backup@<nama-tailscale-server>:/ TARIK_TUJUAN=/srv/backup/mengundang \
#     ./tarik-backup.sh
#
# Variabel:
#   TARIK_SUMBER         sumber rsync. Di server, akun tarik-backup dikunci `rrsync -ro` ke folder
#                        backup, jadi "/" berarti folder backup itu. Untuk uji: folder lokal.
#   TARIK_TUJUAN         folder salinan di VM lokal.
#   TARIK_KUNCI_SSH      kunci privat SSH (bawaan ~/.ssh/tarik-backup).
#   TARIK_SIMPAN_HARI    salinan lebih tua dari ini dihapus (bawaan 90).
#   TARIK_MAKS_UMUR_JAM  gagal (keluar 1) bila backup terbaru lebih tua dari ini (bawaan 26).
#
# Keluar 0 bila salinan terbaru cukup baru. Berkas yang sudah ada tidak pernah ditimpa, dan
# berkas yang hilang di server tidak ikut dihapus di sini.

set -Eeuo pipefail
umask 077

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() {
  log "GAGAL: $*"
  exit 1
}

: "${TARIK_SUMBER:?TARIK_SUMBER wajib diisi, mis. tarik-backup@server-tailscale:/}"
: "${TARIK_TUJUAN:?TARIK_TUJUAN wajib diisi}"
simpan_hari="${TARIK_SIMPAN_HARI:-90}"
maks_jam="${TARIK_MAKS_UMUR_JAM:-26}"
if ! [[ "$simpan_hari" =~ ^[0-9]+$ ]] || ((simpan_hari < 1)); then
  die "TARIK_SIMPAN_HARI harus bilangan bulat >= 1"
fi
if ! [[ "$maks_jam" =~ ^[0-9]+$ ]] || ((maks_jam < 1)); then
  die "TARIK_MAKS_UMUR_JAM harus bilangan bulat >= 1"
fi
command -v rsync >/dev/null || die "rsync belum terpasang"
command -v flock >/dev/null || die "flock belum terpasang"

mkdir -p "$TARIK_TUJUAN"
exec 9>"$TARIK_TUJUAN/.tarik.lock"
flock -n 9 || die "penarikan lain masih berjalan"

ssh_args=()
if [[ "$TARIK_SUMBER" == *:* ]]; then
  kunci="${TARIK_KUNCI_SSH:-$HOME/.ssh/tarik-backup}"
  [[ -r "$kunci" ]] || die "kunci SSH tidak terbaca: $kunci"
  # Sidik host server harus sudah ada di known_hosts (lihat docs/operasi.md); tanpa itu gagal.
  ssh_args=(-e "ssh -i $kunci -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20")
fi

log "Menarik dari $TARIK_SUMBER ke $TARIK_TUJUAN"
# Hanya berkas backup yang sudah lengkap (nama akhir *.tar.gpg, bukan *.tmp).
rsync -rt --ignore-existing --include='mengundang-*.tar.gpg' --exclude='*' \
  "${ssh_args[@]}" "$TARIK_SUMBER" "$TARIK_TUJUAN/" || die "rsync gagal"

# Salinan lama dihapus hanya setelah penarikan berhasil.
find "$TARIK_TUJUAN" -maxdepth 1 -type f -name 'mengundang-*.tar.gpg' -mtime +"$simpan_hari" -print -delete |
  while read -r lama; do log "Dihapus (lebih dari $simpan_hari hari): $lama"; done

terbaru=$(find "$TARIK_TUJUAN" -maxdepth 1 -type f -name 'mengundang-*.tar.gpg' -printf '%T@ %p\n' |
  sort -rn | head -n 1 | cut -d' ' -f2-)
[[ -n "$terbaru" ]] || die "belum ada backup di $TARIK_TUJUAN"
if [[ -z "$(find "$terbaru" -mmin "-$((maks_jam * 60))")" ]]; then
  die "backup terbaru lebih tua dari $maks_jam jam: $terbaru (backup di server macet?)"
fi
jumlah=$(find "$TARIK_TUJUAN" -maxdepth 1 -type f -name 'mengundang-*.tar.gpg' | wc -l)
log "Selesai: $jumlah salinan, terbaru $(basename "$terbaru")"
