// @ts-check

/* eslint-disable no-bitwise */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';
import { compressionMethods, generalPurposeBitFlags } from './constants.js';
import { decodeCp437, encodeCp437 } from './cp437.js';
import {
	serializeCentralDirectoryFileHeader,
	serializeDataDescriptor,
	serializeEndOfCentralDirectoryRecord,
	serializeLocalFileHeader,
	serializeZip64EndOfCentralDirectoryLocator,
	serializeZip64EndOfCentralDirectoryRecord
} from './write.js';

const EMPTY_BUFFER = Buffer.allocUnsafe(0);

const VERSION_NEEDED_TO_EXTRACT_UTF8 = 20;
const VERSION_NEEDED_TO_EXTRACT_ZIP64 = 45;
// 3 = unix. 63 = spec version 6.3
const VERSION_MADE_BY = (3 << 8) | 63;

const eocdrSignatureBuffer = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

export default class Zip extends Readable {
	/**
	 * @param {{ cursor?: bigint }} [options]
	 */
	constructor({ cursor = 0n } = {}) {
		super();
		/** @type {Promise<unknown> | undefined} */
		this.queue = Promise.resolve();

		/** @type {bigint} */
		this.outputStreamCursor = cursor;

		/** @type {import('./zip.js').Entry[]} */
		this.entries = [];
	}

	// TODO: backpressure
	// eslint-disable-next-line class-methods-use-this, no-underscore-dangle
	_read() {}

	/**
	 * @param {import('./unzip.js').Entry} entry
	 * @param {(
	 *   options: { decompress: false }
	 * ) => Promise<Readable>} [createReadStream]
	 * @param {{
	 *   fileName?: Buffer | string
	 *   comment?: Buffer | string
	 *   forceZip64Format?: boolean
	 *   mode?: number
	 *   mtime?: Date
	 * }} [options]
	 * @returns {Promise<import('./zip.js').Entry>}
	 */
	addEntry(entry, createReadStream, {
		fileName,
		comment,
		forceZip64Format = false,
		mode,
		mtime
	} = {}) {
		if (fileName != null) {
			fileName = Buffer.from(fileName);
			if (fileName.length > 0xffff) {
				throw new Error(`utf8 file name too long. ${fileName.length} > ${0xffff}`);
			}
		} else if (Buffer.isBuffer(entry.fileName)) {
			if (entry.centralDirectoryFileHeader.generalPurposeBitFlag & generalPurposeBitFlags.utf8) {
				fileName = entry.fileName;

				// TODO: How about Info-ZIP Unicode Path Extra Field (0x7075)?
			} else {
				fileName = Buffer.from(decodeCp437(entry.fileName));
			}
		} else {
			fileName = Buffer.from(entry.fileName);
		}

		if (comment != null) {
			comment = Buffer.from(comment);

			if (comment.length > 0xffff) {
				throw new Error('File comment is too large');
			}
		} else if (Buffer.isBuffer(entry.comment)) {
			if (entry.centralDirectoryFileHeader.generalPurposeBitFlag & generalPurposeBitFlags.utf8) {
				comment = entry.comment;
			} else {
				comment = Buffer.from(decodeCp437(entry.comment));
			}
		} else {
			comment = Buffer.from(entry.comment);
		}

		let externalFileAttributes;

		if (mode != null) {
			if ((mode & 0xffff) !== mode) {
				throw new Error(`invalid mode. expected: 0 <= ${mode} <= ${0xffff}`);
			}

			externalFileAttributes = (mode << 16) >>> 0;
		} else {
			externalFileAttributes = entry.centralDirectoryFileHeader.externalFileAttributes;
		}

		const dosDateTime = dateToDosDateTime(mtime ?? entry.modificationDate);

		/** @type {import('./zip.js').Entry} */
		const pendingEntry = {
			fileName,
			lastModFileTime: dosDateTime.time,
			lastModFileDate: dosDateTime.date,
			externalFileAttributes,
			crc32: entry.centralDirectoryFileHeader.crc32,
			uncompressedSize: entry.uncompressedSize,
			compressedSize: entry.compressedSize,
			compressionMethod: entry.centralDirectoryFileHeader.compressionMethod,
			crcAndFileSizeKnown: true,
			forceZip64Format,
			comment,
			relativeOffsetOfLocalHeader: createReadStream == null
				? entry.relativeOffsetOfLocalHeader
				: /** @type {any} */(undefined)
		};

		if (createReadStream == null) {
			if (!this.queue) {
				throw new Error('Zip file has been finalized');
			}

			const promise = this.queue.then(async () => {
				this.entries.push(pendingEntry);

				return pendingEntry;
			});

			this.queue = promise;

			return promise;
		}

		return addEntry(this, async () => {
			const stream = await createReadStream({ decompress: false });

			return [pendingEntry, () => writeRawStream(this, stream)];
		});
	}

	/**
	 * @param {string} realPath
	 * @param {string} fileName
	 * @param {{
	 *   comment?: Buffer | string
	 *   compress?: boolean
	 *   forceZip64Format?: boolean
	 *   mode?: number
	 *   mtime?: Date
	 * }} [options]
	 * @returns {Promise<import('./zip.js').Entry>}
	 */
	addFile(realPath, fileName, {
		comment = EMPTY_BUFFER,
		compress = true,
		forceZip64Format = false,
		mode,
		mtime
	} = {}) {
		fileName = sanitizeMetadataPath(fileName, false);

		/** @type {Promise<[import('fs/promises').FileHandle, import('fs').BigIntStats]>} */
		const statsPromise = fs.promises.open(realPath)
			.then(async handle => [handle, await handle.stat({ bigint: true })]);

		statsPromise.catch(() => {});

		return addEntry(this, async () => {
			const [handle, stats] = await statsPromise;

			if (!stats.isFile()) {
				throw new Error(`not a file: ${realPath}`);
			}

			const entry = createEntry({
				comment,
				compress,
				fileName,
				forceZip64Format,
				mode: mode ?? Number(stats.mode),
				mtime: mtime ?? stats.mtime,
				uncompressedSize: stats.size
			});

			const readStream = handle.createReadStream();

			return [entry, () => writeEntryStream(this, entry, readStream)];
		});
	}

	/**
	 * @param {import('fs/promises').FileHandle} fileHandle
	 * @param {string} fileName
	 * @param {{
	*   comment?: Buffer | string
	*   compress?: boolean
	*   forceZip64Format?: boolean
	*   mode?: number
	*   mtime?: Date
	* }} [options]
	* @returns {Promise<import('./zip.js').Entry>}
	*/
	addFileHandle(fileHandle, fileName, {
		comment = EMPTY_BUFFER,
		compress = true,
		forceZip64Format = false,
		mode,
		mtime
	} = {}) {
		fileName = sanitizeMetadataPath(fileName, false);

		const statsPromise = fileHandle.stat({ bigint: true });

		statsPromise.catch(() => {});

		return addEntry(this, async () => {
			const stats = await statsPromise;

			if (!stats.isFile()) {
				throw new Error('not a file');
			}

			const entry = createEntry({
				comment,
				compress,
				fileName,
				forceZip64Format,
				mode: mode ?? Number(stats.mode),
				mtime: mtime ?? stats.mtime,
				uncompressedSize: stats.size
			});

			const readStream = fileHandle.createReadStream();

			return [entry, () => writeEntryStream(this, entry, readStream)];
		});
	}

	/**
	 * @param {Readable} readStream
	 * @param {string} fileName
	 * @param {{
	 *   comment?: Buffer | string
	 *   compress?: boolean
	 *   compressedSize?: bigint
	 *   crc32?: number
	 *   forceZip64Format?: boolean
	 *   mode?: number
	 *   mtime?: Date
	 *   uncompressedSize?: bigint
	 * }} [options]
	 * @returns {Promise<import('./zip.js').Entry>}
	 */
	addReadStream(readStream, fileName, {
		comment = EMPTY_BUFFER,
		compress = true,
		compressedSize,
		crc32,
		forceZip64Format = false,
		mode = 0o100664,
		mtime,
		uncompressedSize
	} = {}) {
		fileName = sanitizeMetadataPath(fileName, false);

		const entry = createEntry({
			comment,
			compress,
			compressedSize,
			crc32,
			fileName,
			forceZip64Format,
			mode,
			mtime,
			uncompressedSize
		});

		return addEntry(this, () => [entry, () => writeEntryStream(this, entry, readStream)]);
	}

	/**
	 * @param {Buffer} buffer
	 * @param {string} fileName
	 * @param {{
	 *   comment?: Buffer | string
	 *   compress?: boolean
	 *   forceZip64Format?: boolean
	 *   mode?: number
	 *   mtime?: Date
	 * }} [options]
	 * @returns {Promise<import('./zip.js').Entry>}
	 */
	addBuffer(buffer, fileName, {
		comment = EMPTY_BUFFER,
		compress = true,
		forceZip64Format = false,
		mode = 0o100664,
		mtime
	} = {}) {
		fileName = sanitizeMetadataPath(fileName, false);
		if (buffer.length > 0x3fffffff) throw new Error(`buffer too large: ${buffer.length} > ${0x3fffffff}`);

		const checksum = zlib.crc32(buffer);
		const uncompressedSize = buffer.length;

		let bufferPromise = Promise.resolve(buffer);

		if (compress) {
			bufferPromise = new Promise((resolve, reject) => {
				zlib.deflateRaw(buffer, (err, compressedBuffer) => {
					if (err) {
						reject(err);

						return;
					}

					resolve(compressedBuffer);
				});
			});

			bufferPromise.catch(() => {});
		}

		return addEntry(this, async () => {
			const buffer = await bufferPromise;

			const entry = createEntry({
				comment,
				compress,
				compressedSize: BigInt(buffer.length),
				crc32: checksum,
				fileName,
				forceZip64Format,
				mode,
				mtime,
				uncompressedSize: BigInt(uncompressedSize)
			});

			return [entry, () => writeBuffer(this, buffer)];
		});
	}

	/**
	 * @param {string} fileName
	 * @param {{
	 *   comment?: Buffer | string
	 *   forceZip64Format?: boolean
	 *   mode?: number
	 *   mtime?: Date
	 * }} [options]
	 * @returns {Promise<import('./zip.js').Entry>}
	 */
	addDirectory(fileName, {
		comment = EMPTY_BUFFER,
		forceZip64Format = false,
		mode = 0o40775,
		mtime
	} = {}) {
		fileName = sanitizeMetadataPath(fileName, true);

		return addEntry(this, () => {
			const entry = createEntry({
				comment,
				compress: false,
				compressedSize: 0n,
				crc32: 0,
				fileName,
				forceZip64Format,
				mode,
				mtime,
				uncompressedSize: 0n
			});

			return Promise.resolve([entry, () => Promise.resolve()]);
		});
	}

	/**
	 * @param {{
	 *   comment?: Buffer | string
	 *   forceZip64Format?: boolean
	 * }} [options]
	 * @returns {Promise<void>}
	 */
	addCentralDirectoryRecord({
		comment = EMPTY_BUFFER,
		forceZip64Format = false
	} = {}) {
		if (!this.queue) {
			throw new Error('Zip file has been finalized');
		}

		if (comment != null) {
			comment = Buffer.isBuffer(comment)
				? comment
				: encodeCp437(comment);

			if (comment.length > 0xffff) {
				throw new Error('comment is too large');
			}

			// gotta check for this, because the zipfile format is actually ambiguous.
			if (comment.includes(eocdrSignatureBuffer)) {
				throw new Error('comment contains end of central directory record signature');
			}
		}

		const queue = this.queue.then(() => {
			this.offsetOfStartOfCentralDirectory = this.outputStreamCursor;

			this.entries.forEach(entry => {
				writeBuffer(this, getCentralDirectoryRecord(entry));
			});

			writeBuffer(this, getEndOfCentralDirectoryRecord({
				offsetOfStartOfCentralDirectory: this.offsetOfStartOfCentralDirectory,
				forceZip64Format,
				comment,
				cursor: this.outputStreamCursor,
				entryCount: BigInt(this.entries.length)
			}));
		});

		queue.catch(e => {
			this.emit('error', e);

			this.destroy();
		});

		this.queue = queue;

		return queue;
	}

	/**
	 * @param {import('./zip.js').Entry} entry
	 */
	removeEntry(entry) {
		const entryIndex = this.entries.indexOf(entry);

		if (entryIndex !== -1) {
			this.entries.splice(entryIndex, 1);
		}
	}

	end() {
		this.queue?.then(() => {
			this.push(null);
		});

		this.queue = undefined;
	}
}

/**
 * @param {{
 *   fileName: string
 *   comment: Buffer | string
 *   compress: boolean
 *   compressedSize?: undefined | bigint
 *   crc32?: undefined | number
 *   forceZip64Format: boolean
 *   mode: number
 *   mtime?: undefined | Date
 *   uncompressedSize?: undefined | bigint
 * }} options
 * @returns {import('./zip.js').Entry}
 */
function createEntry(options) {
	const fileName = Buffer.from(options.fileName);
	if (fileName.length > 0xffff) {
		throw new Error(`utf8 file name too long. ${fileName.length} > ${0xffff}`);
	}

	if ((options.mode & 0xffff) !== options.mode) {
		throw new Error(`invalid mode. expected: 0 <= ${options.mode} <= ${0xffff}`);
	}

	const comment = Buffer.from(options.comment);

	if (comment.length > 0xffff) {
		throw new Error('File comment is too large');
	}

	const dosDateTime = dateToDosDateTime(options.mtime ?? new Date());

	return {
		fileName,
		lastModFileTime: dosDateTime.time,
		lastModFileDate: dosDateTime.date,
		externalFileAttributes: (options.mode << 16) >>> 0,
		crc32: options.crc32 ?? /** @type {any} */(undefined),
		uncompressedSize: options.uncompressedSize ?? /** @type {any} */(undefined),
		compressedSize: options.compressedSize ?? /** @type {any} */(undefined),
		compressionMethod: options.compress ? compressionMethods.deflate : compressionMethods.none,
		crcAndFileSizeKnown: options.crc32 != null
			&& options.uncompressedSize != null
			&& options.compressedSize != null,
		forceZip64Format: options.forceZip64Format,
		comment,
		relativeOffsetOfLocalHeader: /** @type {any} */(undefined)
	};
}

/**
 * @param {Zip} self
 * @param {() => (
 *   | [import('./zip.js').Entry, () => void | Promise<void>]
 *   | Promise<[import('./zip.js').Entry, () => void | Promise<void>]>
 * )} callback
 * @returns {Promise<import('./zip.js').Entry>}
 */
async function addEntry(self, callback) {
	if (!self.queue) {
		throw new Error('Zip file has been finalized');
	}

	const promise = self.queue.then(async () => {
		const [entry, write] = await callback();

		entry.relativeOffsetOfLocalHeader = self.outputStreamCursor;
		writeBuffer(self, getLocalFileHeader(entry));

		const cursor = self.outputStreamCursor;

		await write();

		const compressedSize = self.outputStreamCursor - cursor;
		if (entry.compressedSize == null) {
			entry.compressedSize = compressedSize;
		} else if (compressedSize !== entry.compressedSize) {
			throw new Error('Unexpected compressed size');
		}

		if (!entry.crcAndFileSizeKnown) {
			writeBuffer(self, serializeDataDescriptor({
				crc32: entry.crc32,
				compressedSize: entry.compressedSize,
				uncompressedSize: entry.uncompressedSize
			}));
		}

		self.entries.push(entry);

		return entry;
	});

	promise.catch(e => {
		self.emit('error', e);

		self.destroy();
	});

	self.queue = promise;

	return promise;
}

/**
 * @param {Zip} self
 * @param {Buffer} buffer
 * @returns {Promise<void>}
 */
function writeBuffer(self, buffer) {
	self.push(buffer);
	self.outputStreamCursor += BigInt(buffer.length);

	return Promise.resolve();
}

/**
 * @param {Zip} self
 * @param {Readable} readStream
 * @returns {Promise<void>}
 */
async function writeRawStream(self, readStream) {
	let size = 0n;

	await pipeline(
		readStream,
		async data => {
			for await (const chunk of data) {
				size += BigInt(chunk.length);
				self.push(chunk);

				// TODO: backpressure
			}
		}
	);

	self.outputStreamCursor += size;
}

/**
 * @param {Zip} self
 * @param {import('./zip.js').Entry} entry
 * @param {Readable} readStream
 * @returns {Promise<void>}
 */
async function writeEntryStream(self, entry, readStream) {
	let uncompressedSize = 0n;
	/** @type {bigint} */
	let compressedSize;
	let crc32 = 0;

	/** @type {any[]} */
	const streams = [
		readStream,
		/** @param {AsyncIterable<Buffer>} source */
		async function* (source) {
			for await (const chunk of source) {
				crc32 = zlib.crc32(chunk, crc32);
				uncompressedSize += BigInt(chunk.length);
				yield chunk;
			}
		}
	];

	if (entry.compressionMethod === compressionMethods.deflate) {
		compressedSize = 0n;

		streams.push(
			zlib.createDeflateRaw(),
			/** @param {AsyncIterable<Buffer>} source */
			async source => {
				for await (const chunk of source) {
					compressedSize += BigInt(chunk.length);
					self.push(chunk);

					// TODO: backpressure
				}
			}
		);

		await pipeline(streams);
	} else {
		await pipeline(streams);

		compressedSize = uncompressedSize;
	}

	if (entry.crc32 == null) {
		entry.crc32 = crc32;
	} else if (entry.crc32 !== crc32) {
		throw new Error('file data stream has unexpected checksum');
	}

	if (entry.uncompressedSize == null) {
		entry.uncompressedSize = uncompressedSize;
	} else if (entry.uncompressedSize !== uncompressedSize) {
		throw new Error('file data stream has unexpected number of bytes');
	}

	self.outputStreamCursor += compressedSize;
}

/**
 * @param {{
 *   offsetOfStartOfCentralDirectory: bigint,
 *   cursor: bigint,
 *   forceZip64Format: boolean,
 *   comment: Buffer,
 *   entryCount: bigint
 * }} param0
 * @returns
 */
function getEndOfCentralDirectoryRecord({
	entryCount,
	cursor,
	offsetOfStartOfCentralDirectory,
	comment,
	forceZip64Format
}) {
	const sizeOfCentralDirectory = cursor - offsetOfStartOfCentralDirectory;

	const useZip64Format = forceZip64Format
		|| entryCount >= 0xffff
		|| sizeOfCentralDirectory >= 0xffffffff
		|| offsetOfStartOfCentralDirectory >= 0xffffffff;

	let normalEntryCount;
	let normalOffsetOfStartOfCentralDirectory;
	let normalSizeOfCentralDirectory;

	if (forceZip64Format) {
		normalEntryCount = 0xffff;
		normalSizeOfCentralDirectory = 0xffffffff;
		normalOffsetOfStartOfCentralDirectory = 0xffffffff;
	} else {
		normalEntryCount = Number(entryCount);
		normalSizeOfCentralDirectory = Number(sizeOfCentralDirectory);
		normalOffsetOfStartOfCentralDirectory = Number(offsetOfStartOfCentralDirectory);
	}

	const eocdrBuffer = serializeEndOfCentralDirectoryRecord({
		diskNumber: 0,
		centralDirectoryDiskNumber: 0,
		numberOfEntriesOnDisk: normalEntryCount,
		numberOfEntries: normalEntryCount,
		sizeOfCentralDirectory: normalSizeOfCentralDirectory,
		centralDirectoryOffset: normalOffsetOfStartOfCentralDirectory,
		comment
	});

	if (!useZip64Format) {
		return eocdrBuffer;
	}

	const zip64EocdrBuffer = serializeZip64EndOfCentralDirectoryRecord({
		versionMadeBy: VERSION_MADE_BY,
		versionNeededToExtract: VERSION_NEEDED_TO_EXTRACT_ZIP64,
		diskNumber: 0,
		centralDirectoryDiskNumber: 0,
		numberOfEntriesOnDisk: entryCount,
		numberOfEntries: entryCount,
		sizeOfCentralDirectory,
		centralDirectoryOffset: offsetOfStartOfCentralDirectory,
		zip64ExtensibleDataSector: EMPTY_BUFFER
	});

	const zip64EocdlBuffer = serializeZip64EndOfCentralDirectoryLocator({
		zip64EndOfCentralDirectoryRecordDiskNumber: 0,
		zip64EndOfCentralDirectoryRecordOffset: cursor,
		diskCount: 1
	});

	return Buffer.concat([
		zip64EocdrBuffer,
		zip64EocdlBuffer,
		eocdrBuffer
	]);
}

/**
 * @param {string} metadataPath
 * @param {boolean} isDirectory
 * @returns {string}
 */
function sanitizeMetadataPath(metadataPath, isDirectory) {
	if (metadataPath === '') {
		throw new Error('empty metadataPath');
	}

	metadataPath = metadataPath.replace(/\\/g, '/');

	if (/^[a-zA-Z]:/.test(metadataPath) || /^\//.test(metadataPath)) {
		throw new Error(`absolute path: ${metadataPath}`);
	}

	if (metadataPath.split('/').indexOf('..') !== -1) {
		throw new Error(`invalid relative path: ${metadataPath}`);
	}

	const looksLikeDirectory = /\/$/.test(metadataPath);

	if (isDirectory) {
		// append a trailing '/' if necessary.
		if (!looksLikeDirectory) {
			metadataPath += '/';
		}
	} else if (looksLikeDirectory) {
		throw new Error(`file path cannot end with '/': ${metadataPath}`);
	}

	return metadataPath;
}

/**
 * @param {import('./zip.js').Entry} entry
 * @returns {Buffer}
 */
function getCentralDirectoryRecord(entry) {
	let compressedSize;
	let uncompressedSize;
	let relativeOffsetOfLocalHeader;
	let versionNeededToExtract;
	const extraFields = [];

	const useZip64Format = entry.forceZip64Format
		|| entry.uncompressedSize >= 0xffffffff
		|| entry.compressedSize >= 0xffffffff
		|| entry.relativeOffsetOfLocalHeader >= 0xffffffff;

	if (useZip64Format) {
		versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_ZIP64;
		compressedSize = 0xffffffff;
		uncompressedSize = 0xffffffff;
		relativeOffsetOfLocalHeader = 0xffffffff;

		// ZIP64 extended information extra field
		const zeiefBuffer = Buffer.allocUnsafe(24);
		zeiefBuffer.writeBigUInt64LE(entry.uncompressedSize, 0);
		zeiefBuffer.writeBigUInt64LE(entry.compressedSize, 8);
		zeiefBuffer.writeBigUInt64LE(entry.relativeOffsetOfLocalHeader, 16);

		extraFields.push({ id: 0x0001, data: zeiefBuffer });
	} else {
		versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_UTF8;
		compressedSize = Number(entry.compressedSize);
		uncompressedSize = Number(entry.uncompressedSize);
		relativeOffsetOfLocalHeader = Number(entry.relativeOffsetOfLocalHeader);
	}

	let generalPurposeBitFlag = generalPurposeBitFlags.utf8;
	if (!entry.crcAndFileSizeKnown) {
		generalPurposeBitFlag |= generalPurposeBitFlags.unknownCrc32AndFileSizes;
		// maybe it's not needed
		versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_ZIP64;
	}

	return serializeCentralDirectoryFileHeader({
		versionMadeBy: VERSION_MADE_BY,
		versionNeededToExtract,
		generalPurposeBitFlag,
		compressionMethod: entry.compressionMethod,
		fileLastModificationDate: entry.lastModFileDate,
		fileLastModificationTime: entry.lastModFileTime,
		crc32: entry.crc32,
		compressedSize,
		uncompressedSize,
		diskNumberStart: 0,
		internalFileAttributes: 0,
		externalFileAttributes: entry.externalFileAttributes,
		relativeOffsetOfLocalHeader,
		fileName: entry.fileName,
		extraFields,
		comment: entry.comment
	});
}

/**
 * @param {import('./zip.js').Entry} entry
 * @returns
 */
function getLocalFileHeader(entry) {
	let generalPurposeBitFlag = generalPurposeBitFlags.utf8;
	let compressedSize = 0;
	let uncompressedSize = 0;
	let versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_UTF8;
	const extraFields = [];
	let crc32 = 0;

	const useZip64Format = entry.forceZip64Format
		|| !entry.crcAndFileSizeKnown
		|| entry.uncompressedSize >= 0xffffffff
		|| entry.compressedSize >= 0xffffffff;

	if (useZip64Format) {
		compressedSize = 0xffffffff;
		uncompressedSize = 0xffffffff;
		versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_ZIP64;

		const zeiefBuffer = Buffer.alloc(16);

		if (entry.crcAndFileSizeKnown) {
			zeiefBuffer.writeBigUInt64LE(entry.uncompressedSize, 0);
			zeiefBuffer.writeBigUInt64LE(entry.compressedSize, 8);
		}

		extraFields.push({ id: 0x0001, data: zeiefBuffer });
	} else {
		compressedSize = Number(entry.compressedSize);
		uncompressedSize = Number(entry.uncompressedSize);
	}

	if (entry.crcAndFileSizeKnown) {
		crc32 = entry.crc32;
	} else {
		generalPurposeBitFlag |= generalPurposeBitFlags.unknownCrc32AndFileSizes;
	}

	return serializeLocalFileHeader({
		versionNeededToExtract,
		generalPurposeBitFlag,
		compressionMethod: entry.compressionMethod,
		fileLastModificationDate: entry.lastModFileDate,
		fileLastModificationTime: entry.lastModFileTime,
		crc32,
		compressedSize,
		uncompressedSize,
		fileName: entry.fileName,
		extraFields
	});
}

/**
 * @param {Date} date
 * @returns {{ date: number, time: number }}
 */
function dateToDosDateTime(date) {
	return {
		date: (date.getUTCDate() & 0x1f)
			| (((date.getUTCMonth() + 1) & 0xf) << 5)
			| (((date.getUTCFullYear() - 1980) & 0x7f) << 9),
		time: Math.floor(date.getUTCSeconds() / 2)
			| ((date.getUTCMinutes() & 0x3f) << 5)
			| ((date.getUTCHours() & 0x1f) << 11)
	};
}
