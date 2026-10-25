import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("Arsip XLSX tidak valid: direktori ZIP tidak ditemukan.");
}

function decodeEntryName(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString("utf8").replaceAll("\\", "/");
}

export function readZipEntries(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 22) throw new Error("Arsip XLSX terlalu kecil atau rusak.");

  const endOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Arsip XLSX multi-disk tidak didukung.");
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("Arsip XLSX ZIP64 tidak didukung.");
  }
  if (centralDirectoryOffset + centralDirectorySize > endOffset) {
    throw new Error("Arsip XLSX rusak: posisi direktori ZIP tidak valid.");
  }

  const entries = new Map();
  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Arsip XLSX rusak: entri direktori ZIP tidak valid.");
    }

    const flags = buffer.readUInt16LE(centralOffset + 8);
    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const entryName = decodeEntryName(buffer, centralOffset + 46, nameLength);

    if ((flags & 1) !== 0) throw new Error(`Entri XLSX terenkripsi tidak didukung: ${entryName}`);
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(`Entri XLSX terlalu besar untuk dibaca: ${entryName}`);
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`Arsip XLSX rusak: header lokal ${entryName} tidak valid.`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`Arsip XLSX rusak: data ${entryName} tidak lengkap.`);

    const compressed = buffer.subarray(dataOffset, dataEnd);
    let content;
    if (compressionMethod === 0) content = Buffer.from(compressed);
    else if (compressionMethod === 8) content = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new Error(`Metode kompresi XLSX tidak didukung (${compressionMethod}): ${entryName}`);

    if (content.length !== uncompressedSize) {
      throw new Error(`Arsip XLSX rusak: ukuran ${entryName} tidak sesuai.`);
    }
    entries.set(entryName, content);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
