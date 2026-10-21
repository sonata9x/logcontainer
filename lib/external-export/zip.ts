export type StoredZipFile = { path: string; data: Blob | Uint8Array | string };

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function view(size: number) {
  const bytes = new Uint8Array(size);
  return { bytes, data: new DataView(bytes.buffer) };
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cleanPath(path: string) {
  const value = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("ZIP 파일 경로가 올바르지 않습니다.");
  return value;
}

async function bytesFor(data: StoredZipFile["data"]) {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

export async function createStoredZip(files: StoredZipFile[], onProgress?: (completed: number, total: number) => void) {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  const stamp = dosDateTime();
  let offset = 0;
  let completed = 0;

  for (const file of files) {
    const path = cleanPath(file.path);
    const name = encoder.encode(path);
    const content = await bytesFor(file.data);
    if (content.byteLength > 0xffffffff || offset > 0xffffffff) throw new Error("ZIP 파일이 4GB 제한을 초과했습니다.");
    const checksum = crc32(content);
    const local = view(30 + name.byteLength);
    local.data.setUint32(0, 0x04034b50, true);
    local.data.setUint16(4, 20, true);
    local.data.setUint16(6, 0x0800, true);
    local.data.setUint16(8, 0, true);
    local.data.setUint16(10, stamp.time, true);
    local.data.setUint16(12, stamp.date, true);
    local.data.setUint32(14, checksum, true);
    local.data.setUint32(18, content.byteLength, true);
    local.data.setUint32(22, content.byteLength, true);
    local.data.setUint16(26, name.byteLength, true);
    local.bytes.set(name, 30);
    parts.push(blobPart(local.bytes), file.data instanceof Blob ? file.data : blobPart(content));

    const header = view(46 + name.byteLength);
    header.data.setUint32(0, 0x02014b50, true);
    header.data.setUint16(4, 20, true);
    header.data.setUint16(6, 20, true);
    header.data.setUint16(8, 0x0800, true);
    header.data.setUint16(10, 0, true);
    header.data.setUint16(12, stamp.time, true);
    header.data.setUint16(14, stamp.date, true);
    header.data.setUint32(16, checksum, true);
    header.data.setUint32(20, content.byteLength, true);
    header.data.setUint32(24, content.byteLength, true);
    header.data.setUint16(28, name.byteLength, true);
    header.data.setUint32(42, offset, true);
    header.bytes.set(name, 46);
    central.push(header.bytes);
    offset += local.bytes.byteLength + content.byteLength;
    completed += 1;
    onProgress?.(completed, files.length);
  }

  const centralOffset = offset;
  for (const header of central) { parts.push(blobPart(header)); offset += header.byteLength; }
  const end = view(22);
  end.data.setUint32(0, 0x06054b50, true);
  end.data.setUint16(8, files.length, true);
  end.data.setUint16(10, files.length, true);
  end.data.setUint32(12, offset - centralOffset, true);
  end.data.setUint32(16, centralOffset, true);
  parts.push(blobPart(end.bytes));
  return new Blob(parts, { type: "application/zip" });
}
