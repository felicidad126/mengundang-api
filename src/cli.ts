// Perintah admin Helonoia. Di server dijalankan lewat service `admin` (peran pemilik database):
//   docker compose --env-file deploy/produksi.env -f deploy/compose.yml run --rm admin <perintah> ...
import { parseArgs } from 'node:util';
import {
  aturTampilUcapan,
  buatAcara,
  daftarAcara,
  daftarUcapanAdmin,
  eksporRsvpCsv,
  GalatAdmin,
} from './admin.js';
import { buatPool } from './db/pool.js';

const BANTUAN = `Perintah:
  acara:buat --slug <slug> --nama "<nama>" --tanggal YYYY-MM-DD [--batas-rsvp YYYY-MM-DD] [--zona Asia/Jakarta]
  acara:daftar
  rsvp:ekspor <slug> [--zona Asia/Jakarta]          CSV ke stdout
  ucapan:daftar <slug>
  ucapan:sembunyikan <id>
  ucapan:tampilkan <id>`;

const zonaWaktu = (d: Date | null, zona = 'Asia/Jakarta') =>
  d ? d.toLocaleString('sv-SE', { timeZone: zona, hour12: false }).slice(0, 16) : '-';

function cetakTabel(header: string[], baris: (string | number)[][]) {
  console.log([header, ...baris].map((b) => b.join('\t')).join('\n'));
}

async function jalankan(argv: string[]): Promise<number> {
  const [perintah, ...sisa] = argv;
  const { values, positionals } = parseArgs({
    args: sisa,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nama: { type: 'string' },
      tanggal: { type: 'string' },
      'batas-rsvp': { type: 'string' },
      zona: { type: 'string', default: 'Asia/Jakarta' },
    },
  });
  if (!perintah || perintah === 'bantuan' || perintah === '--help') {
    console.log(BANTUAN);
    return perintah ? 0 : 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL wajib diisi');
    return 2;
  }
  const pool = buatPool(url, 1);
  try {
    switch (perintah) {
      case 'acara:buat': {
        const a = await buatAcara(pool, {
          slug: values.slug ?? '',
          nama: values.nama ?? '',
          tanggal: values.tanggal ?? '',
          batasRsvp: values['batas-rsvp'],
          zona: values.zona,
        });
        console.log(`Acara dibuat: ${a.slug} (${a.nama}), tanggal ${a.tanggal_acara}`);
        console.log(`Batas RSVP: ${a.batas_rsvp ? `${zonaWaktu(a.batas_rsvp, values.zona)} ${values.zona}` : 'tidak ada'}`);
        console.log(`Tag untuk undangan: <meta name="acara" content="${a.slug}">`);
        return 0;
      }
      case 'acara:daftar': {
        const daftar = await daftarAcara(pool);
        cetakTabel(
          ['slug', 'nama', 'tanggal', 'batas_rsvp_wib', 'rsvp', 'hadir_orang', 'tidak', 'ragu', 'ucapan'],
          daftar.map((a) => [a.slug, a.nama, a.tanggal_acara, zonaWaktu(a.batas_rsvp), a.rsvp, a.hadir_orang, a.tidak, a.ragu, a.ucapan]),
        );
        return 0;
      }
      case 'rsvp:ekspor': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        process.stdout.write(await eksporRsvpCsv(pool, slug, values.zona));
        return 0;
      }
      case 'ucapan:daftar': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        const daftar = await daftarUcapanAdmin(pool, slug);
        cetakTabel(
          ['id', 'tampil', 'dibuat_wib', 'nama', 'pesan'],
          daftar.map((u) => [u.id, u.tampil ? 'ya' : 'TIDAK', zonaWaktu(u.dibuat), u.nama, u.pesan.replace(/\s+/g, ' ').slice(0, 80)]),
        );
        return 0;
      }
      case 'ucapan:sembunyikan':
      case 'ucapan:tampilkan': {
        const id = Number(positionals[0]);
        if (!Number.isInteger(id) || id < 1) throw new GalatAdmin('sebutkan id ucapan (lihat ucapan:daftar)');
        const tampil = perintah === 'ucapan:tampilkan';
        if (!(await aturTampilUcapan(pool, id, tampil))) throw new GalatAdmin(`ucapan ${id} tidak ditemukan`);
        console.log(`Ucapan ${id} ${tampil ? 'ditampilkan' : 'disembunyikan'}`);
        return 0;
      }
      default:
        console.error(`Perintah tidak dikenal: ${perintah}\n\n${BANTUAN}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof GalatAdmin) {
      console.error(`GAGAL: ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    await pool.end();
  }
}

process.exitCode = await jalankan(process.argv.slice(2));
