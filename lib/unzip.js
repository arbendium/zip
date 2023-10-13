// @ts-check

/* eslint-disable no-bitwise */
import { Readable, Transform, pipeline } from 'node:stream';
import * as zlib from 'node:zlib';
import { decodeCp437 } from './cp437.js';
import { compressionMethods, generalPurposeBitFlags } from './constants.js';
import { read, readCentralDirectoryFileHeader, readLocalFileHeader } from './read.js';

/**
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {import('./unzip.js').UnzipOptions} [options]
 * @returns {Promise<Unzip>}
 */
export async function fromFileHandle(handle, options) {
	const stats = await handle.stat({ bigint: true });

	return fromRandomAccessReader(handle, stats.size, options);
}

/**
 * @param {Buffer} buffer
 * @param {import('./unzip.js').UnzipOptions} [options]
 * @returns {Promise<Unzip>}
 */
export function fromBuffer(buffer, options) {
	return fromRandomAccessReader(buffer, BigInt(buffer.length), options);
}

/**
 * @param {import('node:fs/promises').FileHandle | Buffer} handle
 * @param {bigint} totalSize
 * @param {import('./unzip.js').UnzipOptions} [options]
 * @returns {Promise<Unzip>}
 */
async function fromRandomAccessReader(handle, totalSize, { decodeStrings = true } = {}) {
	// eocdr means End of Central Directory Record.
	// search backwards for the eocdr signature.
	// the last field of the eocdr is a variable-length comment.
	// The comment size is encoded in a 2-byte field in the eocdr, which we can't find without
	// trudging backwards through the comment to find it. As a consequence of this design decision,
	// it's possible to have ambiguous zip file metadata if a coherent eocdr was in the comment. We
	// search backwards for a eocdr signature, and hope that whoever made the zip file was smart
	// enough to forbid the eocdr signature in the comment.
	const eocdrWithoutCommentSize = 22;
	const maxCommentSize = 0xffff; // 2-byte size
	const bufferSize = Math.min(Number(totalSize), eocdrWithoutCommentSize + maxCommentSize);
	const bufferReadStart = totalSize - BigInt(bufferSize);
	const buffer = await read(handle, bufferReadStart, bufferSize);

	for (let i = bufferSize - eocdrWithoutCommentSize; i >= 0; i--) {
		if (buffer.readUInt32LE(i) !== 0x06054b50) {
			continue;
		}

		// found eocdr
		const eocdrBuffer = buffer.subarray(i);

		// 0 - End of central directory signature = 0x06054b50
		// 4 - Number of this disk
		const diskNumber = eocdrBuffer.readUInt16LE(4);

		if (diskNumber !== 0) {
			throw new Error(`multi-disk zip files are not supported: found disk number: ${diskNumber}`);
		}

		// 6 - Disk where central directory starts
		// 8 - Number of central directory records on this disk
		// 10 - Total number of central directory records
		let entryCount = BigInt(eocdrBuffer.readUInt16LE(10));

		// 12 - Size of central directory (bytes)
		// 16 - Offset of start of central directory, relative to start of archive
		let centralDirectoryOffset = BigInt(eocdrBuffer.readUInt32LE(16));

		// 20 - Comment length
		const commentLength = eocdrBuffer.readUInt16LE(20);
		const expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;

		if (commentLength !== expectedCommentLength) {
			throw new Error(`invalid comment length. expected: ${expectedCommentLength}. found: ${commentLength}`);
		}

		// 22 - Comment
		// the encoding is always cp437.
		const comment = decodeStrings
			? decodeCp437(eocdrBuffer, 22)
			: eocdrBuffer.subarray(22);

		eocdrBuffer.subarray(22);

		if (entryCount !== 0xffffn && centralDirectoryOffset !== 0xffffffffn) {
			return new Unzip(
				handle,
				centralDirectoryOffset,
				totalSize,
				entryCount,
				comment
			);
		}

		// ZIP64 format

		// ZIP64 Zip64 end of central directory locator
		const zip64EocdlOffset = bufferReadStart + BigInt(i - 20);
		const zip64EocdlBuffer = await read(handle, zip64EocdlOffset, 20);

		// 0 - zip64 end of central dir locator signature = 0x07064b50
		if (zip64EocdlBuffer.readUInt32LE(0) !== 0x07064b50) {
			throw new Error('invalid zip64 end of central directory locator signature');
		}
		// 4 - number of the disk with the start of the zip64 end of central directory
		// 8 - relative offset of the zip64 end of central directory record
		const zip64EocdrOffset = zip64EocdlBuffer.readBigUint64LE(8);
		// 16 - total number of disks

		// ZIP64 end of central directory record
		const zip64EocdrBuffer = await read(handle, zip64EocdrOffset, 56);

		// 0 - zip64 end of central dir signature                           4 bytes  (0x06064b50)
		if (zip64EocdrBuffer.readUInt32LE(0) !== 0x06064b50) {
			throw new Error('invalid zip64 end of central directory record signature');
		}
		// 4 - size of zip64 end of central directory record                8 bytes
		// 12 - version made by                                             2 bytes
		// 14 - version needed to extract                                   2 bytes
		// 16 - number of this disk                                         4 bytes
		// 20 - number of the disk with the start of the central directory  4 bytes
		// 24 - total number of entries in the central directory on this disk         8 bytes
		// 32 - total number of entries in the central directory            8 bytes
		entryCount = zip64EocdrBuffer.readBigUInt64LE(32);
		// 40 - size of the central directory                               8 bytes
		// eslint-disable-next-line max-len
		// 48 - offset of start of central directory with respect to the starting disk number     8 bytes
		centralDirectoryOffset = zip64EocdrBuffer.readBigUInt64LE(48);
		// 56 - zip64 extensible data sector                                (variable size)

		return new Unzip(
			handle,
			centralDirectoryOffset,
			totalSize,
			entryCount,
			comment
		);
	}

	throw new Error('end of central directory record signature not found');
}

export default class Unzip {
	/**
	 * @param {import('node:fs/promises').FileHandle | Buffer} handle
	 * @param {bigint} centralDirectoryOffset
	 * @param {bigint} fileSize
	 * @param {bigint} entryCount
	 * @param {string | Buffer} comment
	 */
	constructor(
		handle,
		centralDirectoryOffset,
		fileSize,
		entryCount,
		comment
	) {
		this.handle = handle;
		this.centralDirectoryOffset = centralDirectoryOffset;
		this.fileSize = fileSize;
		this.entryCount = entryCount;
		this.comment = comment;
	}

	/**
	 * @param {{ decodeStrings?: boolean }} [options]
	 */
	async* entries({ decodeStrings = true } = {}) {
		let cursor = this.centralDirectoryOffset;

		for (let entriesRead = 0n; entriesRead < this.entryCount; entriesRead++) {
			const entry = await readEntry(this.handle, cursor, decodeStrings);

			const entrySize = BigInt(
				46
					+ entry[0].centralDirectoryFileHeader.fileNameLength
					+ entry[0].centralDirectoryFileHeader.extraFieldsLength
					+ entry[0].centralDirectoryFileHeader.commentLength
			);

			yield entry;

			cursor += entrySize;
		}
	}
}

/**
 * @param {import('node:fs/promises').FileHandle | Buffer} handle
 * @param {bigint} cursor
 * @param {boolean} decodeStrings
 * @returns {Promise<[
 *   import('./unzip.js').Entry,
 *   (options?: import('./unzip.js').UnzipEntryOptions) => Promise<Readable>
 * ]>}
 */
async function readEntry(handle, cursor, decodeStrings) {
	const centralDirectoryFileHeader = await readCentralDirectoryFileHeader(handle, cursor);

	if (centralDirectoryFileHeader.generalPurposeBitFlag & generalPurposeBitFlags.strongEncryption) {
		throw new Error('strong encryption is not supported');
	}

	const isUtf8 = !!(centralDirectoryFileHeader.generalPurposeBitFlag & generalPurposeBitFlags.utf8);

	/** @type {import('./unzip.js').Entry} */
	const entry = {
		centralDirectoryFileHeader,
		// eslint-disable-next-line no-nested-ternary
		fileName: decodeStrings
			? isUtf8
				? centralDirectoryFileHeader.fileName.toString()
				: decodeCp437(centralDirectoryFileHeader.fileName)
			: centralDirectoryFileHeader.fileName,
		// eslint-disable-next-line no-nested-ternary
		comment: decodeStrings
			? isUtf8
				? centralDirectoryFileHeader.comment.toString()
				: decodeCp437(centralDirectoryFileHeader.comment)
			: centralDirectoryFileHeader.comment,
		modificationDate: dosDateTimeToDate(
			centralDirectoryFileHeader.fileLastModificationDate,
			centralDirectoryFileHeader.fileLastModificationTime
		),
		compressedSize: /** @type {any} */(undefined),
		uncompressedSize: /** @type {any} */(undefined),
		relativeOffsetOfLocalHeader: /** @type {any} */(undefined),
		diskNumberStart: /** @type {any} */(undefined),
		// eslint-disable-next-line max-len
		encrypted: !!(centralDirectoryFileHeader.generalPurposeBitFlag & generalPurposeBitFlags.encrypted),
		// eslint-disable-next-line no-nested-ternary
		compressed: centralDirectoryFileHeader.compressionMethod === compressionMethods.none
			? false
			: centralDirectoryFileHeader.compressionMethod === compressionMethods.deflate
				? true
				: undefined
	};

	if (centralDirectoryFileHeader.uncompressedSize === 0xffffffff
			|| centralDirectoryFileHeader.compressedSize === 0xffffffff
			|| centralDirectoryFileHeader.relativeOffsetOfLocalHeader === 0xffffffff
			|| centralDirectoryFileHeader.diskNumberStart === 0xffff
	) {
		// ZIP64 format
		// find the Zip64 Extended Information Extra Field
		let zip64EiefBuffer;

		for (let i = 0; i < centralDirectoryFileHeader.extraFields.length; i++) {
			const field = centralDirectoryFileHeader.extraFields[i];

			if (field.id === 0x0001) {
				zip64EiefBuffer = field.data;

				break;
			}
		}

		if (zip64EiefBuffer == null) {
			throw new Error('expected zip64 extended information extra field');
		}

		let cursor = 0;

		if (centralDirectoryFileHeader.uncompressedSize === 0xffffffff) {
			if (cursor + 8 > zip64EiefBuffer.length) {
				throw new Error('zip64 extended information extra field does not include uncompressed size');
			}

			entry.uncompressedSize = zip64EiefBuffer.readBigUInt64LE(cursor);
			cursor += 8;
		} else {
			entry.uncompressedSize = BigInt(centralDirectoryFileHeader.uncompressedSize);
		}

		if (centralDirectoryFileHeader.compressedSize === 0xffffffff) {
			if (cursor + 8 > zip64EiefBuffer.length) {
				throw new Error('zip64 extended information extra field does not include compressed size');
			}

			entry.compressedSize = zip64EiefBuffer.readBigUInt64LE(cursor);
			cursor += 8;
		} else {
			entry.compressedSize = BigInt(centralDirectoryFileHeader.compressedSize);
		}

		if (centralDirectoryFileHeader.relativeOffsetOfLocalHeader === 0xffffffff) {
			if (cursor + 8 > zip64EiefBuffer.length) {
				throw new Error('zip64 extended information extra field does not include relative header offset');
			}

			entry.relativeOffsetOfLocalHeader = zip64EiefBuffer.readBigUInt64LE(cursor);
			cursor += 8;
		} else {
			// eslint-disable-next-line max-len
			entry.relativeOffsetOfLocalHeader = BigInt(centralDirectoryFileHeader.relativeOffsetOfLocalHeader);
		}

		if (centralDirectoryFileHeader.relativeOffsetOfLocalHeader === 0xffffffff) {
			if (cursor + 4 > zip64EiefBuffer.length) {
				throw new Error('zip64 extended information extra field does not include disk number start');
			}

			entry.diskNumberStart = zip64EiefBuffer.readUInt32LE(cursor);
		} else {
			entry.diskNumberStart = centralDirectoryFileHeader.diskNumberStart;
		}
	} else {
		entry.uncompressedSize = BigInt(centralDirectoryFileHeader.uncompressedSize);
		entry.compressedSize = BigInt(centralDirectoryFileHeader.compressedSize);
		// eslint-disable-next-line max-len
		entry.relativeOffsetOfLocalHeader = BigInt(centralDirectoryFileHeader.relativeOffsetOfLocalHeader);
		entry.diskNumberStart = centralDirectoryFileHeader.diskNumberStart;
	}

	// check for Info-ZIP Unicode Path Extra Field (0x7075)
	// see https://github.com/thejoshwolfe/yauzl/issues/33
	if (decodeStrings) {
		for (let i = 0; i < centralDirectoryFileHeader.extraFields.length; i++) {
			const extraField = centralDirectoryFileHeader.extraFields[i];
			if (extraField.id === 0x7075) {
				if (extraField.data.length < 6) {
					// too short to be meaningful
					continue;
				}

				// Version       1 byte      version of this extra field, currently 1
				if (extraField.data.readUInt8(0) !== 1) {
					// > Changes may not be backward compatible so this extra
					// > field should not be used if the version is not recognized.
					continue;
				}

				// NameCRC32     4 bytes     File Name Field CRC32 Checksum
				const oldNameCrc32 = extraField.data.readUInt32LE(1);

				if (zlib.crc32(centralDirectoryFileHeader.fileName) !== oldNameCrc32) {
					// > If the CRC check fails, this UTF-8 Path Extra Field should be
					// > ignored and the File Name field in the header should be used instead.
					continue;
				}

				// UnicodeName   Variable    UTF-8 version of the entry File Name
				entry.fileName = extraField.data.toString('utf8', 5);
				break;
			}
		}
	}

	return [
		entry,
		function createReadStream(options) {
			return openReadStream(handle, entry, options);
		}
	];
}

/**
 * @param {import('node:fs/promises').FileHandle | Buffer} handle
 * @param {import('./unzip.js').Entry} entry
 * @param {import('./unzip.js').UnzipEntryOptions} [options]
 * @returns {Promise<import('node:stream').Readable>}
 */
async function openReadStream(handle, entry, options = {}) {
	// parameter validation
	let relativeStart = 0n;
	let relativeEnd = entry.compressedSize;

	if (options.start != null || options.end != null) {
		if (entry.compressed && options.decompress !== false) {
			throw new Error('start/end range not allowed for compressed entry without options.decompress === false');
		}

		if (entry.encrypted && options.decrypt !== false) {
			throw new Error('start/end range not allowed for encrypted entry without options.decrypt === false');
		}
	}

	if (options.start != null) {
		relativeStart = options.start;
		if (relativeStart < 0) throw new Error('options.start < 0');
		if (relativeStart > entry.compressedSize) throw new Error('options.start > entry.compressedSize');
	}

	if (options.end != null) {
		relativeEnd = options.end;
		if (relativeEnd < 0) throw new Error('options.end < 0');
		if (relativeEnd > entry.compressedSize) throw new Error('options.end > entry.compressedSize');
		if (relativeEnd < relativeStart) throw new Error('options.end < options.start');
	}

	const localFileHeader = await readLocalFileHeader(handle, entry.relativeOffsetOfLocalHeader);

	const fileDataStart = entry.relativeOffsetOfLocalHeader
		+ BigInt(30 + localFileHeader.fileNameLength + localFileHeader.extraFieldsLength);

	if (localFileHeader.compressionMethod !== compressionMethods.none
		&& localFileHeader.compressionMethod !== compressionMethods.deflate) {
		throw new Error(`unsupported compression method: ${localFileHeader.compressionMethod}`);
	}

	const readStream = createReadStream(handle, {
		start: fileDataStart + relativeStart,
		end: fileDataStart + relativeEnd
	});

	/** @type {any[]} */
	const streams = [readStream];

	const decompress = localFileHeader.compressionMethod === compressionMethods.deflate
		&& options.decompress !== false;

	if (decompress) {
		streams.push(zlib.createInflateRaw());
	}

	if (options.validateData !== false
		&& (localFileHeader.compressionMethod === compressionMethods.none || decompress)) {
		let bytes = 0n;
		let crc32 = 0;

		streams.push(new Transform({
			transform(chunk, encoding, callback) {
				bytes += BigInt(chunk.length);

				if (bytes > entry.uncompressedSize) {
					throw new Error(`too many bytes in the stream. expected ${entry.uncompressedSize}. got at least ${bytes}`);
				}

				crc32 = zlib.crc32(chunk, crc32);

				callback(undefined, chunk);
			},
			flush(callback) {
				if (bytes !== entry.uncompressedSize) {
					throw new Error(`not enough bytes in the stream. expected ${entry.uncompressedSize}. got ${bytes}`);
				}

				if (crc32 !== entry.centralDirectoryFileHeader.crc32) {
					throw new Error(`unexpected checksum. expected ${entry.uncompressedSize}. got ${bytes}`);
				}

				callback();
			}
		}));
	}

	if (streams.length > 1) {
		pipeline(streams, () => {});
	}

	return streams[streams.length - 1];
}

/**
 * @param {import('node:fs/promises').FileHandle | Buffer} handle
 * @param {{ start: bigint, end: bigint }} options
 * @returns {import('node:stream').Readable}
 */
function createReadStream(handle, options) {
	if (options.start >= Number.MAX_SAFE_INTEGER || options.end >= Number.MAX_SAFE_INTEGER) {
		throw new Error('Buffers don\'t support bigints');
	}

	const start = Number(options.start);
	const end = Number(options.end);

	if (Buffer.isBuffer(handle)) {
		return Readable.from(handle.subarray(start, end));
	}

	if (start === end) {
		return Readable.from(Buffer.allocUnsafe(0));
	}

	return handle.createReadStream({
		start,
		end: end - 1,
		autoClose: false
	});
}

/**
 * @param {number} date
 * @param {number} time
 * @returns {Date}
 */
function dosDateTimeToDate(date, time) {
	return new Date(Date.UTC(
		(date >> 9 & 0x7f) + 1980,
		(date >> 5 & 0xf) - 1,
		date & 0x1f,
		time >> 11 & 0x1f,
		time >> 5 & 0x3f,
		(time & 0x1f) * 2
	));
}
