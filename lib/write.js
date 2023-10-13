// @ts-check

/**
 * @param {Omit<
 *   Awaited<ReturnType<typeof import('./read.js').readLocalFileHeader>>,
 *   'fileNameLength' | 'extraFieldsLength'
 * >} object
 * @returns {Buffer}
 */
export function serializeLocalFileHeader(object) {
	const buffer = Buffer.allocUnsafe(30);

	const extraFields = serializeExtraFields(object.extraFields);

	buffer.writeUInt32LE(0x04034b50, 0);
	buffer.writeUInt16LE(object.versionNeededToExtract, 4);
	buffer.writeUInt16LE(object.generalPurposeBitFlag, 6);
	buffer.writeUInt16LE(object.compressionMethod, 8);
	buffer.writeUInt16LE(object.fileLastModificationTime, 10);
	buffer.writeUInt16LE(object.fileLastModificationDate, 12);
	buffer.writeUInt32LE(object.crc32, 14);
	buffer.writeUInt32LE(object.compressedSize, 18);
	buffer.writeUInt32LE(object.uncompressedSize, 22);
	buffer.writeUInt16LE(object.fileName.length, 26);
	buffer.writeUInt16LE(extraFields.length, 28);

	return Buffer.concat([buffer, object.fileName, extraFields]);
}

/**
 * @param {Omit<
 *   Awaited<ReturnType<typeof import('./read.js').readDataDescriptor>>,
 *   'fileNameLength' | 'extraFieldsLength' | 'commentLength'
 * >} object
 * @returns {Buffer}
 */
export function serializeDataDescriptor(object) {
	if (typeof object.compressedSize !== 'bigint' || typeof object.uncompressedSize !== 'bigint') {
		throw new Error('data descriptor should only be used with zip64');
	}

	const buffer = Buffer.allocUnsafe(24);

	buffer.writeUInt32LE(0x08074b50, 0);
	buffer.writeUInt32LE(object.crc32, 4);
	buffer.writeBigUint64LE(object.compressedSize, 8);
	buffer.writeBigUint64LE(object.uncompressedSize, 16);

	return buffer;
}

/**
 * @param {Omit<
 *   Awaited<ReturnType<typeof import('./read.js').readCentralDirectoryFileHeader>>,
 *   'fileNameLength' | 'extraFieldsLength' | 'commentLength'
 * >} object
 * @returns {Buffer}
 */
export function serializeCentralDirectoryFileHeader(object) {
	const buffer = Buffer.allocUnsafe(46);

	const extraFields = serializeExtraFields(object.extraFields);

	buffer.writeUInt32LE(0x02014b50, 0);
	buffer.writeUInt16LE(object.versionMadeBy, 4);
	buffer.writeUInt16LE(object.versionNeededToExtract, 6);
	buffer.writeUInt16LE(object.generalPurposeBitFlag, 8);
	buffer.writeUInt16LE(object.compressionMethod, 10);
	buffer.writeUInt16LE(object.fileLastModificationTime, 12);
	buffer.writeUInt16LE(object.fileLastModificationDate, 14);
	buffer.writeUInt32LE(object.crc32, 16);
	buffer.writeUInt32LE(object.compressedSize, 20);
	buffer.writeUInt32LE(object.uncompressedSize, 24);
	buffer.writeUInt16LE(object.fileName.length, 28);
	buffer.writeUInt16LE(extraFields.length, 30);
	buffer.writeUInt16LE(object.comment.length, 32);
	buffer.writeUInt16LE(object.diskNumberStart, 34);
	buffer.writeUInt16LE(object.internalFileAttributes, 36);
	buffer.writeUInt32LE(object.externalFileAttributes, 38);
	buffer.writeUInt32LE(object.relativeOffsetOfLocalHeader, 42);

	return Buffer.concat([
		buffer,
		object.fileName,
		extraFields,
		object.comment
	]);
}

/**
 * @param {Omit<
 *   Awaited<ReturnType<typeof import('./read.js').readEndOfCentralDirectoryRecord>>,
 *   'commentLength'
 * >} object
 * @returns {Buffer}
 */
export function serializeEndOfCentralDirectoryRecord(object) {
	const buffer = Buffer.allocUnsafe(22);

	buffer.writeUInt32LE(0x06054b50, 0);
	buffer.writeUInt16LE(object.diskNumber, 4);
	buffer.writeUInt16LE(object.centralDirectoryDiskNumber, 6);
	buffer.writeUInt16LE(object.numberOfEntriesOnDisk, 8);
	buffer.writeUInt16LE(object.numberOfEntries, 10);
	buffer.writeUInt32LE(object.sizeOfCentralDirectory, 12);
	buffer.writeUInt32LE(object.centralDirectoryOffset, 16);

	return Buffer.concat([
		buffer,
		object.comment
	]);
}

/**
 * @param {Omit<
 *   Awaited<ReturnType<typeof import('./read.js').readZip64EndOfCentralDirectoryRecord>>,
 *   'zip64EndOfCentralDirectoryRecordSize'
 * >} object
 * @returns {Buffer}
 */
export function serializeZip64EndOfCentralDirectoryRecord(object) {
	const buffer = Buffer.allocUnsafe(56);

	buffer.writeUInt32LE(0x06064b50, 0);
	buffer.writeBigUInt64LE(44n + BigInt(object.zip64ExtensibleDataSector.length), 4);
	buffer.writeUInt16LE(object.versionMadeBy, 12);
	buffer.writeUInt16LE(object.versionNeededToExtract, 14);
	buffer.writeUInt32LE(object.diskNumber, 16);
	buffer.writeUInt32LE(object.centralDirectoryDiskNumber, 20);
	buffer.writeBigUInt64LE(object.numberOfEntriesOnDisk, 24);
	buffer.writeBigUInt64LE(object.numberOfEntries, 32);
	buffer.writeBigUInt64LE(object.sizeOfCentralDirectory, 40);
	buffer.writeBigUInt64LE(object.centralDirectoryOffset, 48);

	if (object.zip64ExtensibleDataSector.length > 0) {
		return Buffer.concat([buffer, object.zip64ExtensibleDataSector]);
	}

	return buffer;
}

/**
 * @param {Awaited<
 *   ReturnType<typeof import('./read.js').readZip64EndOfCentralDirectoryLocator>
 * >} object
 * @returns {Buffer}
 */
export function serializeZip64EndOfCentralDirectoryLocator(object) {
	const buffer = Buffer.allocUnsafe(20);

	buffer.writeUInt32LE(0x07064b50, 0);
	// number of the disk with the start of the zip64 end of central directory  4 bytes
	buffer.writeUInt32LE(object.zip64EndOfCentralDirectoryRecordDiskNumber, 4);
	// relative offset of the zip64 end of central directory record             8 bytes
	buffer.writeBigUInt64LE(object.zip64EndOfCentralDirectoryRecordOffset, 8);
	// total number of disks                                                    4 bytes
	buffer.writeUInt32LE(object.diskCount, 16);

	return buffer;
}

/**
 * @param {Buffer | { id: number, data: Buffer }[]} extraFields
 * @returns {Buffer}
 */
function serializeExtraFields(extraFields) {
	if (Buffer.isBuffer(extraFields)) {
		return extraFields;
	}

	/** @type {Buffer[]} */
	const buffers = [];

	for (let i = 0; i < extraFields.length; i++) {
		const header = Buffer.allocUnsafe(4);

		header.writeUInt16LE(extraFields[i].id);
		header.writeUInt16LE(extraFields[i].data.length, 2);

		buffers.push(header, extraFields[i].data);
	}

	return Buffer.concat(buffers);
}
