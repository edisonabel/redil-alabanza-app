// Pista virtual de click para canciones sin stems: un M4A (AAC-LC, mono, 48 kHz) con la duración de la
// canción, de puro silencio. El motor lo reproduce como una pista más (búsquedas, saltos, transiciones y
// guardado en el equipo funcionan igual) y el click digital reemplaza su sonido. No se guarda ningún
// archivo: se arma al vuelo. Un cuadro AAC de silencio son 4 bytes: 5 minutos ocupan unos 120 KB.
const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 1024;
const CARRIER_FRAME = [0x01, 0x18, 0x20, 0x07];
// AudioSpecificConfig: AAC-LC (2), 48 kHz (índice 3), mono (1).
const AUDIO_SPECIFIC_CONFIG = [0x11, 0x88];
// El motor descarga primero 64 KB y no vuelve a extraer cuadros que llegaron en esa descarga, así que una
// búsqueda dentro de ella nunca se completa. Como en un stem real, esos 64 KB son solo encabezado: el
// audio empieza después de un relleno («free»).
const FIRST_AUDIO_BYTE = 64 * 1024;

export const CLICK_CARRIER_MIN_SECONDS = 1;
export const CLICK_CARRIER_MAX_SECONDS = 1800;
export const CLICK_CARRIER_PATH = '/api/live-director-click-carrier/';
const CLICK_CARRIER_PATTERN = /\/api\/live-director-click-carrier\/(\d+(?:\.\d{1,3})?)\.m4a(?:[?#]|$)/;

export const normalizeClickCarrierSeconds = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < CLICK_CARRIER_MIN_SECONDS || seconds > CLICK_CARRIER_MAX_SECONDS) return null;
  return Math.round(seconds * 1000) / 1000;
};
export const buildClickCarrierUrl = (seconds) => {
  const normalized = normalizeClickCarrierSeconds(seconds);
  return normalized === null ? '' : `${CLICK_CARRIER_PATH}${normalized}.m4a`;
};
/** Duración pedida en la URL de una pista virtual de click, o null si la URL no es una. */
export const readClickCarrierSeconds = (url) => {
  const match = CLICK_CARRIER_PATTERN.exec(String(url || ''));
  return match ? normalizeClickCarrierSeconds(match[1]) : null;
};
export const isClickCarrierUrl = (url) => readClickCarrierSeconds(url) !== null;

const ascii = (text) => Array.from(text, (character) => character.charCodeAt(0));
const u16 = (value) => [(value >>> 8) & 255, value & 255];
const u32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const box = (type, ...parts) => {
  const body = parts.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
};
const fullBox = (type, version, flags, ...parts) => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...parts);
const UNITY_MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
const descriptor = (tag, body) => [tag, body.length, ...body];

/** Bytes del M4A de la pista virtual. La duración real redondea hacia arriba al cuadro AAC (≤ 21 ms). */
export function buildSilentAacMp4(seconds) {
  const normalized = normalizeClickCarrierSeconds(seconds);
  if (normalized === null) throw new RangeError('Duración de la pista de click fuera de rango.');
  const frames = Math.ceil((normalized * SAMPLE_RATE) / FRAME_SAMPLES);
  const duration = frames * FRAME_SAMPLES;
  const esds = fullBox('esds', 0, 0, descriptor(0x03, [
    ...u16(1), 0,
    ...descriptor(0x04, [0x40, 0x15, 0, 0, 0, ...u32(32000), ...u32(32000), ...descriptor(0x05, AUDIO_SPECIFIC_CONFIG)]),
    ...descriptor(0x06, [0x02]),
  ]));
  const mp4a = box('mp4a', [0, 0, 0, 0, 0, 0], u16(1), new Array(8).fill(0), u16(1), u16(16), u16(0), u16(0), u32(SAMPLE_RATE << 16 >>> 0), esds);
  const moovFor = (chunkOffset) => box('moov',
    fullBox('mvhd', 0, 0, u32(0), u32(0), u32(SAMPLE_RATE), u32(duration), u32(0x00010000), u16(0x0100), new Array(10).fill(0), UNITY_MATRIX, new Array(24).fill(0), u32(2)),
    box('trak',
      fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), new Array(8).fill(0), u16(0), u16(0), u16(0x0100), u16(0), UNITY_MATRIX, u32(0), u32(0)),
      box('mdia',
        fullBox('mdhd', 0, 0, u32(0), u32(0), u32(SAMPLE_RATE), u32(duration), u16(0x55c4), u16(0)),
        fullBox('hdlr', 0, 0, u32(0), ascii('soun'), new Array(12).fill(0), ascii('SoundHandler'), [0]),
        box('minf',
          fullBox('smhd', 0, 0, u16(0), u16(0)),
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          box('stbl',
            fullBox('stsd', 0, 0, u32(1), mp4a),
            fullBox('stts', 0, 0, u32(1), u32(frames), u32(FRAME_SAMPLES)),
            fullBox('stsc', 0, 0, u32(1), u32(1), u32(frames), u32(1)),
            fullBox('stsz', 0, 0, u32(CARRIER_FRAME.length), u32(frames)),
            fullBox('stco', 0, 0, u32(1), u32(chunkOffset)),
          ),
        ),
      ),
    ),
  );
  const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A '), ascii('mp42'), ascii('isom'));
  const moov = moovFor(FIRST_AUDIO_BYTE);
  const mdatHeader = 8;
  const freeLength = FIRST_AUDIO_BYTE - ftyp.length - moov.length - mdatHeader;
  if (freeLength < 8) throw new RangeError('El encabezado de la pista de click no cabe antes del audio.');
  const payloadLength = frames * CARRIER_FRAME.length;
  const bytes = new Uint8Array(FIRST_AUDIO_BYTE + payloadLength);
  bytes.set(ftyp, 0);
  bytes.set(moov, ftyp.length);
  bytes.set([...u32(freeLength), ...ascii('free')], ftyp.length + moov.length);
  bytes.set([...u32(mdatHeader + payloadLength), ...ascii('mdat')], FIRST_AUDIO_BYTE - mdatHeader);
  for (let offset = FIRST_AUDIO_BYTE; offset < bytes.length; offset += CARRIER_FRAME.length) bytes.set(CARRIER_FRAME, offset);
  return bytes;
}
