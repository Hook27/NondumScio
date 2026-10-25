import { zlibSync } from 'fflate';

/** Een effen rode PNG van `width` bij `height` beeldpunten, zonder hulpbibliotheek. */
export function makePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[] | Uint8Array) => {
    const body = Uint8Array.from([...[...type].map((c) => c.charCodeAt(0)), ...data]);
    return [...u32(data.length), ...body, ...u32(crc(body))];
  };
  const row = [0, ...Array.from({ length: width }, () => [255, 0, 0]).flat()];
  const raw = Uint8Array.from(Array.from({ length: height }, () => row).flat());
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    ...chunk('IDAT', zlibSync(raw)),
    ...chunk('IEND', []),
  ]);
}
