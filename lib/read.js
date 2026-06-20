// @ts-check

/**
 * @import { FileHandle } from 'fs/promises'
 * @import { CentralDirectoryFileHeader, LocalFileHeader } from './unzip.js'
 */

/**
 * @typedef {{
 *   compressedSize: number | bigint
 *   crc32: number
 *   uncompressedSize: number | bigint
 * }} DataDescriptor
 * @typedef {{
 *   diskNumber: number
 *   centralDirectoryDiskNumber: number
 *   numberOfEntriesOnDisk: number
 *   numberOfEntries: number
 *   sizeOfCentralDirectory: number
 *   centralDirectoryOffset: number
 *   commentLength: number
 *   comment: Buffer
 * }} EndOfCentralDirectoryRecord
 * @typedef {{
 *   zip64EndOfCentralDirectoryRecordSize: bigint
 *   versionMadeBy: number
 *   versionNeededToExtract: number
 *   diskNumber: number
 *   centralDirectoryDiskNumber: number
 *   numberOfEntriesOnDisk: bigint
 *   numberOfEntries: bigint
 *   sizeOfCentralDirectory: bigint
 *   centralDirectoryOffset: bigint
 *   zip64ExtensibleDataSector: Buffer
 * }} Zip64EndOfCentralDirectoryRecord
 * @typedef {{
 *   diskCount: number
 *   zip64EndOfCentralDirectoryRecordDiskNumber: number
 *   zip64EndOfCentralDirectoryRecordOffset: bigint
 * }} Zip64EndOfCentralDirectoryLocator
 */

/**
 * @template T, R
 * @param {T | Promise<T>} value
 * @param {(value: T) => R | Promise<R>} fn
 * @returns {R | Promise<R>}
 */
export function thenable(value, fn) {
	return value instanceof Promise
		? value.then(fn)
		: fn(value);
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} offset
 * @returns {LocalFileHeader}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} offset
 * @returns {Promise<LocalFileHeader>}
 */
/**
 * @overload
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {LocalFileHeader | Promise<LocalFileHeader>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {LocalFileHeader | Promise<LocalFileHeader>}
 */
export function readLocalFileHeader(handle, offset) {
	return thenable(read(handle, offset, 30), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x04034b50) {
			throw new Error(`invalid local file header signature: 0x${signature.toString(16)}`);
		}

		const fileNameLength = buffer.readUInt16LE(26);
		const extraFieldsLength = buffer.readUInt16LE(28);

		return thenable(read(handle, offset + 30n, fileNameLength + extraFieldsLength), rest => ({
			versionNeededToExtract: buffer.readUInt16LE(4),
			generalPurposeBitFlag: buffer.readUInt16LE(6),
			compressionMethod: buffer.readUInt16LE(8),
			fileLastModificationTime: buffer.readUInt16LE(10),
			fileLastModificationDate: buffer.readUInt16LE(12),
			crc32: buffer.readUInt32LE(14),
			compressedSize: buffer.readUInt32LE(18),
			uncompressedSize: buffer.readUInt32LE(22),
			fileNameLength,
			extraFieldsLength,
			fileName: rest.subarray(0, fileNameLength),
			extraFields: parseExtraFields(rest, fileNameLength),
		}));
	});
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} cursor
 * @param {boolean} zip64
 * @returns {DataDescriptor}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} cursor
 * @param {boolean} zip64
 * @returns {Promise<DataDescriptor>}
 */
/**
 * @overload
 * @param {Buffer | FileHandle} handle
 * @param {bigint} cursor
 * @param {boolean} zip64
 * @returns {DataDescriptor | Promise<DataDescriptor>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} cursor
 * @param {boolean} zip64
 * @returns {DataDescriptor | Promise<DataDescriptor>}
 */
export function readDataDescriptor(handle, cursor, zip64) {
	return thenable(read(handle, cursor, zip64 ? 24 : 16), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x08074b50) {
			throw new Error(`invalid data descriptor: 0x${signature.toString(16)}`);
		}

		return {
			crc32: buffer.readUInt32LE(4),
			compressedSize: zip64 ? buffer.readBigUInt64LE(8) : buffer.readUInt32LE(8),
			uncompressedSize: zip64 ? buffer.readBigUInt64LE(16) : buffer.readUInt32LE(12),
		};
	});
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} offset
 * @returns {CentralDirectoryFileHeader}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} offset
 * @returns {Promise<CentralDirectoryFileHeader>}
 */
/**
 * @overload
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {CentralDirectoryFileHeader | Promise<CentralDirectoryFileHeader>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {CentralDirectoryFileHeader | Promise<CentralDirectoryFileHeader>}
 */
export function readCentralDirectoryFileHeader(handle, offset) {
	return thenable(read(handle, offset, 46), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x02014b50) {
			throw new Error(`invalid central directory file header signature: 0x${signature.toString(16).padStart(8, '0')}`);
		}

		const fileNameLength = buffer.readUInt16LE(28);
		const extraFieldsLength = buffer.readUInt16LE(30);
		const commentLength = buffer.readUInt16LE(32);

		return thenable(
			read(handle, offset + 46n, fileNameLength + extraFieldsLength + commentLength),
			rest => ({
				versionMadeBy: buffer.readUInt16LE(4),
				versionNeededToExtract: buffer.readUInt16LE(6),
				generalPurposeBitFlag: buffer.readUInt16LE(8),
				compressionMethod: buffer.readUInt16LE(10),
				fileLastModificationTime: buffer.readUInt16LE(12),
				fileLastModificationDate: buffer.readUInt16LE(14),
				crc32: buffer.readUInt32LE(16),
				compressedSize: buffer.readUInt32LE(20),
				uncompressedSize: buffer.readUInt32LE(24),
				fileNameLength,
				extraFieldsLength,
				commentLength,
				diskNumberStart: buffer.readUInt16LE(34),
				internalFileAttributes: buffer.readUInt16LE(36),
				externalFileAttributes: buffer.readUInt32LE(38),
				relativeOffsetOfLocalHeader: buffer.readUInt32LE(42),
				fileName: rest.subarray(0, fileNameLength),
				extraFields: parseExtraFields(rest, fileNameLength, fileNameLength + extraFieldsLength),
				comment: rest.subarray(fileNameLength + extraFieldsLength),
			}),
		);
	});
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} offset
 * @returns {EndOfCentralDirectoryRecord}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} offset
 * @returns {Promise<EndOfCentralDirectoryRecord>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {EndOfCentralDirectoryRecord | Promise<EndOfCentralDirectoryRecord>}
 */
export function readEndOfCentralDirectoryRecord(handle, offset) {
	return thenable(read(handle, offset, 22), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x06054b50) {
			throw new Error('invalid end of central directory record signature');
		}

		const commentLength = buffer.readUInt16LE(20);

		return thenable(read(handle, offset + 22n, commentLength), rest => ({
			diskNumber: buffer.readUInt16LE(4),
			centralDirectoryDiskNumber: buffer.readUInt16LE(6),
			numberOfEntriesOnDisk: buffer.readUInt16LE(8),
			numberOfEntries: buffer.readUInt16LE(10),
			sizeOfCentralDirectory: buffer.readUInt32LE(12),
			centralDirectoryOffset: buffer.readUInt32LE(16),
			commentLength,
			comment: rest,
		}));
	});
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} offset
 * @returns {Zip64EndOfCentralDirectoryRecord}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} offset
 * @returns {Promise<Zip64EndOfCentralDirectoryRecord>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {Zip64EndOfCentralDirectoryRecord | Promise<Zip64EndOfCentralDirectoryRecord>}
 */
export function readZip64EndOfCentralDirectoryRecord(handle, offset) {
	return thenable(read(handle, offset, 54), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x06064b50) {
			throw new Error('invalid zip64 end of central directory record signature');
		}

		const zip64EndOfCentralDirectoryRecordSize = buffer.readBigUInt64LE(4);

		return thenable(
			read(handle, offset + 54n, Number(zip64EndOfCentralDirectoryRecordSize)),
			rest => ({
				zip64EndOfCentralDirectoryRecordSize,
				versionMadeBy: buffer.readUInt16LE(12),
				versionNeededToExtract: buffer.readUInt16LE(14),
				diskNumber: buffer.readUInt32LE(16),
				centralDirectoryDiskNumber: buffer.readUInt32LE(20),
				numberOfEntriesOnDisk: buffer.readBigUInt64LE(24),
				numberOfEntries: buffer.readBigUInt64LE(32),
				sizeOfCentralDirectory: buffer.readBigUInt64LE(40),
				centralDirectoryOffset: buffer.readBigUInt64LE(48),
				zip64ExtensibleDataSector: rest,
			}),
		);
	});
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} offset
 * @returns {Zip64EndOfCentralDirectoryLocator}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} offset
 * @returns {Promise<Zip64EndOfCentralDirectoryLocator>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} offset
 * @returns {Zip64EndOfCentralDirectoryLocator | Promise<Zip64EndOfCentralDirectoryLocator>}
 */
export function readZip64EndOfCentralDirectoryLocator(handle, offset) {
	return thenable(read(handle, offset, 20), buffer => {
		const signature = buffer.readUInt32LE(0);

		if (signature !== 0x07064b50) {
			throw new Error('invalid zip64 end of central directory locator signature');
		}

		return {
			zip64EndOfCentralDirectoryRecordDiskNumber: buffer.readUInt32LE(4),
			zip64EndOfCentralDirectoryRecordOffset: buffer.readBigUInt64LE(8),
			diskCount: buffer.readUInt32LE(16),
		};
	});
}

/**
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} end
 * @returns {{ id: number, data: Buffer }[]}
 */
function parseExtraFields(buffer, start = 0, end = buffer.length) {
	const extraFields = [];

	while (start < end) {
		if (end - start < 4) {
			throw new Error('extra field header exceeds extra field buffer size');
		}

		const id = buffer.readUInt16LE(start);
		const size = buffer.readUInt16LE(start + 2);

		start += 4;

		if (start + size > end) {
			throw new Error('extra field length exceeds extra field buffer size');
		}

		extraFields.push({
			id,
			data: buffer.subarray(start, start + size),
		});

		start += size;
	}

	return extraFields;
}

/**
 * @overload
 * @param {Buffer} handle
 * @param {bigint} position
 * @param {number} length
 * @returns {Buffer}
 */
/**
 * @overload
 * @param {FileHandle} handle
 * @param {bigint} position
 * @param {number} length
 * @returns {Promise<Buffer>}
 */
/**
 * @overload
 * @param {Buffer | FileHandle} handle
 * @param {bigint} position
 * @param {number} length
 * @returns {Buffer | Promise<Buffer>}
 */
/**
 * @param {Buffer | FileHandle} handle
 * @param {bigint} position
 * @param {number} length
 * @returns {Buffer | Promise<Buffer>}
 */
export function read(handle, position, length) {
	if (Buffer.isBuffer(handle)) {
		if (handle.length < BigInt(length) + position) {
			throw new Error('unexpected EOF');
		}

		return handle.subarray(Number(position), Number(position) + length);
	}

	const buffer = Buffer.allocUnsafe(length);

	if (length === 0) {
		// handle.read will throw an out-of-bounds error if you try to read 0 bytes from a 0 byte file
		return buffer;
	}

	return handle.read(buffer, undefined, undefined, /** @type {any} */(position)).then(
		({ bytesRead }) => {
			if (bytesRead < buffer.length) {
				throw new Error('unexpected EOF');
			}

			return buffer;
		},
	);
}
