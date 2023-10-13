// @ts-check

/* eslint-disable no-bitwise,no-console */
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import {
	readCentralDirectoryFileHeader,
	readDataDescriptor,
	readEndOfCentralDirectoryRecord,
	readLocalFileHeader,
	readZip64EndOfCentralDirectoryLocator,
	readZip64EndOfCentralDirectoryRecord
} from '../lib/read.js';

if (process.argv.length < 2) {
	console.error('Input file not given');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const file = process.argv[2];

const buffer = await fs.readFile(file);

console.log('File size: ', buffer.length);
console.log('');

let cursor = 0n;

for (; cursor < buffer.length;) {
	const signature = buffer.readUInt32LE(Number(cursor));

	switch (signature) {
	case 0x04034b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - Local file header ===`);
		const object = await readLocalFileHeader(buffer, cursor);

		console.log('Signature:                     ', signature.toString(16).padStart(8, '0'));
		console.log('Version needed to extract:     ', object.versionNeededToExtract);
		console.log('General-purpose bit flag:      ', object.generalPurposeBitFlag.toString(2));
		console.log('Compression method:            ', object.compressionMethod);
		console.log('Last modification date         ', dosDateTimeToDate(object.fileLastModificationDate, object.fileLastModificationTime));
		console.log('CRC32:                         ', object.crc32.toString(16).padStart(8, '0'));
		console.log('Compressed size:               ', object.compressedSize === 0xffffffff ? 'ffffffff' : object.compressedSize);
		console.log('Uncompressed size:             ', object.uncompressedSize === 0xffffffff ? 'ffffffff' : object.uncompressedSize);
		console.log('File name length:              ', object.fileNameLength);
		console.log('Extra fields length:           ', object.extraFieldsLength);
		console.log('File name:                     ', object.fileName, `(${object.fileName.toString()})`);
		console.log('Extra fields name:             ', object.extraFields);
		console.log('');

		const dataLength = BigInt(await rl.question('How much data? '));

		if (dataLength < 0) {
			throw new Error(`Invalid data length: ${dataLength}`);
		}

		cursor += BigInt(30 + object.fileNameLength + object.extraFieldsLength) + dataLength;
		break;
	}
	case 0x08074b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - Data descriptor ===`);

		const zip64Answer = await rl.question('ZIP64? (yes/no) ');

		if (!['yes', 'no'].includes(zip64Answer)) {
			throw new Error(`Invalid answer: ${zip64Answer}`);
		}

		const zip64 = zip64Answer === 'yes';

		const object = await readDataDescriptor(buffer, cursor, zip64);

		console.log('Signature:                     ', signature.toString(16).padStart(8, '0'));
		console.log('CRC32:                         ', object.crc32.toString(16).padStart(8, '0'));
		console.log('Compressed size:               ', object.compressedSize);
		console.log('Uncompressed size:             ', object.uncompressedSize);
		console.log('');

		cursor += zip64 ? 24n : 16n;
		break;
	}
	case 0x02014b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - Central directory file header ===`);

		const object = await readCentralDirectoryFileHeader(buffer, cursor);

		console.log('Signature:                     ', signature.toString(16).padStart(8, '0'));
		console.log('Version made by:               ', object.versionMadeBy);
		console.log('Version needed to extract:     ', object.versionNeededToExtract);
		console.log('General-purpose bit flag:      ', object.generalPurposeBitFlag.toString(2));
		console.log('Compression method:            ', object.compressionMethod);
		console.log('Last modification date         ', dosDateTimeToDate(object.fileLastModificationDate, object.fileLastModificationTime));
		console.log('CRC32:                         ', object.crc32.toString(16).padStart(8, '0'));
		console.log('Compressed size:               ', object.compressedSize);
		console.log('Uncompressed size:             ', object.uncompressedSize);
		console.log('File name length:              ', object.fileNameLength);
		console.log('Extra fields length:           ', object.extraFieldsLength);
		console.log('File comment length:           ', object.extraFieldsLength);
		console.log('Disk number start:             ', object.diskNumberStart);
		console.log('Internal file attributes:      ', object.internalFileAttributes);
		console.log('External file attributes:      ', object.externalFileAttributes);
		console.log('Relative local header offset:  ', object.relativeOffsetOfLocalHeader);
		console.log('File name:                     ', object.fileName, `(${object.fileName.toString()})`);
		console.log('Extra fields name:             ', object.extraFields);
		console.log('File comment:                  ', object.comment);
		console.log('');

		cursor += BigInt(
			46 + object.fileNameLength + object.extraFieldsLength + object.commentLength
		);
		break;
	}
	case 0x06054b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - End of central directory record ===`);

		const object = await readEndOfCentralDirectoryRecord(buffer, cursor);

		console.log('Signature:                     ', signature.toString(16).padStart(8, '0'));
		console.log('Number of this disk:           ', object.diskNumber);
		console.log('Central directory start disk:  ', object.centralDirectoryDiskNumber);
		console.log('Number of entries on disk:     ', object.numberOfEntriesOnDisk);
		console.log('Number of entries:             ', object.numberOfEntries);
		console.log('Size of central directory:     ', object.sizeOfCentralDirectory);
		console.log('Central directory offset:      ', object.centralDirectoryOffset);
		console.log('File comment length:           ', object.commentLength);
		console.log('File comment:                  ', object.comment);
		console.log('');

		cursor += BigInt(22 + object.commentLength);
		break;
	}
	case 0x06064b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - Zip64 end of central directory record ===`);

		const object = await readZip64EndOfCentralDirectoryRecord(buffer, cursor);

		console.log('Signature:                     ', signature.toString(16).padStart(8, '0'));
		console.log('Zip64 end of central directory record size: ', object.zip64EndOfCentralDirectoryRecordSize);
		console.log('Version made by:               ', object.versionMadeBy);
		console.log('Version needed to extract:     ', object.versionNeededToExtract);
		console.log('Number of this disk:           ', object.diskNumber);
		console.log('Central directory start disk:  ', object.centralDirectoryDiskNumber);
		console.log('Number of entries on disk:     ', object.numberOfEntriesOnDisk);
		console.log('Number of entries:             ', object.numberOfEntries);
		console.log('Size of central directory:     ', object.sizeOfCentralDirectory);
		console.log('Central directory offset:      ', object.centralDirectoryOffset);
		console.log('Zip64 extensible data sector:  ', object.zip64ExtensibleDataSector);
		console.log('');

		cursor += 12n + object.zip64EndOfCentralDirectoryRecordSize;
		break;
	}
	case 0x07064b50: {
		console.log(`=== ${cursor.toString(16).padStart(8, '0')} - Zip64 end of central directory locator ===`);

		const object = await readZip64EndOfCentralDirectoryLocator(buffer, cursor);

		console.log('Signature:                                         ', signature.toString(16).padStart(8, '0'));
		console.log('Zip64 end of central directory record disk number: ', object.zip64EndOfCentralDirectoryRecordDiskNumber);
		console.log('Zip64 end of central directory record offset:      ', object.zip64EndOfCentralDirectoryRecordOffset);
		console.log('Number of disks:                                   ', object.diskCount);
		console.log('');

		cursor += 20n;
		break;
	}
	default:
		throw new Error(`Unexpected signature: ${signature.toString(16).padStart(8, '0')} @${cursor} (${cursor.toString(16)})`);
	}
}

rl.close();

console.log('Done');

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
