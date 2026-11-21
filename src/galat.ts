import type { FastifyReply } from 'fastify';

/** Bentuk galat yang sama di semua endpoint: { galat: kode-mesin, pesan: teks untuk manusia }. */
export function kirimGalat(reply: FastifyReply, status: number, galat: string, pesan: string) {
  return reply.code(status).send({ galat, pesan });
}

/** Batas tulis per acara tercapai: coba lagi setelah beberapa menit. */
export function kirimTerlaluBanyak(reply: FastifyReply, pesan: string) {
  reply.header('Retry-After', '600');
  return kirimGalat(reply, 429, 'terlalu_banyak', pesan);
}
