#!/usr/bin/env bash
# Sekali di SERVER (sebagai root): akun SSH khusus untuk VM lokal yang menarik backup.
#
#   bash deploy/salin-backup/pasang-akun-tarik.sh <kunci-publik-vm-lokal.pub> [folder-backup]
#
# Akun `tarik-backup`:
#   - hanya bisa masuk dengan kunci SSH itu, dari alamat Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48)
#     atau dari server ini sendiri (untuk uji);
#   - dikunci `rrsync -ro` ke folder backup: tidak ada shell, tidak bisa menulis atau menghapus;
#   - authorized_keys milik root, jadi akun ini tidak bisa mengubah aturannya sendiri.
# Berkas backup sendiri terenkripsi GPG; akun ini hanya bisa menyalin, tidak bisa membukanya.
# Aman dijalankan ulang (mis. untuk mengganti kunci VM lokal).

set -Eeuo pipefail

die() {
  echo "GAGAL: $*" >&2
  exit 1
}

(($# >= 1 && $# <= 2)) || die "pemakaian: pasang-akun-tarik.sh <kunci-publik.pub> [folder-backup]"
kunci_publik="$1"
folder="${2:-$(cd "$(dirname "$0")/.." && pwd)/backup}"
((EUID == 0)) || die "jalankan sebagai root"
[[ -r "$kunci_publik" ]] || die "kunci publik tidak terbaca: $kunci_publik"
ssh-keygen -l -f "$kunci_publik" >/dev/null 2>&1 || die "bukan kunci publik SSH yang valid: $kunci_publik"
(($(grep -c . "$kunci_publik") == 1)) || die "berkas harus berisi tepat satu kunci publik"
grep -qE '^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh.com) ' "$kunci_publik" ||
  die "pakai kunci ed25519 atau ecdsa (ssh-keygen -t ed25519)"

rrsync=$(command -v rrsync || true)
[[ -z "$rrsync" && -x /usr/share/doc/rsync/scripts/rrsync ]] && rrsync=/usr/share/doc/rsync/scripts/rrsync
[[ -n "$rrsync" ]] || die "rrsync tidak ditemukan (paket rsync >= 3.2)"

getent group tarik-backup >/dev/null || groupadd --system tarik-backup
if ! id tarik-backup >/dev/null 2>&1; then
  useradd --system --gid tarik-backup --home-dir /var/lib/tarik-backup --create-home \
    --shell /bin/sh --comment "Penarik backup mengundang-api (hanya-baca)" tarik-backup
fi
passwd -l tarik-backup >/dev/null

mkdir -p "$folder"
chown root:tarik-backup "$folder"
chmod 750 "$folder"
find "$folder" -maxdepth 1 -type f -name 'mengundang-*.tar.gpg' -exec chgrp tarik-backup {} + -exec chmod 640 {} +

asal='100.64.0.0/10,fd7a:115c:a1e0::/48,127.0.0.1,::1'
install -d -m 755 -o root -g root /var/lib/tarik-backup/.ssh
printf 'restrict,from="%s",command="%s -ro %s" %s\n' "$asal" "$rrsync" "$folder" "$(cat "$kunci_publik")" \
  >/var/lib/tarik-backup/.ssh/authorized_keys
chown root:root /var/lib/tarik-backup/.ssh/authorized_keys
chmod 644 /var/lib/tarik-backup/.ssh/authorized_keys

if sshd -T 2>/dev/null | grep -qiE '^(allowusers|allowgroups) '; then
  echo "PERHATIAN: sshd memakai AllowUsers/AllowGroups; tambahkan tarik-backup ke sana." >&2
fi

gid=$(getent group tarik-backup | cut -d: -f3)
echo "Akun tarik-backup siap. Folder: $folder"
echo "Isi di deploy/produksi.env:  MENGUNDANG_BACKUP_FILE_GROUP=$gid"
echo "lalu: docker compose --env-file deploy/produksi.env -f deploy/compose.yml up -d backup"
