// @ts-check

import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';
import { crc32 } from 'node:zlib';
import { fromBuffer, fromFileHandle } from '../lib/unzip.js';

const directoryName = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<number>}
 */
async function streamChecksum(stream) {
	let checksum = 0;

	for await (const chunk of stream) {
		checksum = crc32(chunk, checksum);
	}

	return checksum;
}

/**
 * @param {import('../lib/unzip.js').default} file
 * @param {import('../lib/unzip.js').Entry[]} entries
 */
async function assertZip(file, entries) {
	/** @type {import('../lib/unzip.js').Entry[]} */
	const actualEntries = [];
	const streamFactories = [];

	for await (const [entry, createReadStream] of file.entries()) {
		actualEntries.push(entry);
		streamFactories.push(createReadStream);
	}

	assert.deepStrictEqual(actualEntries, entries);
	assert.deepStrictEqual(
		await Promise.all(streamFactories.map(
			async createReadStream => streamChecksum(await createReadStream())
		)),
		entries.map(entry => entry.centralDirectoryFileHeader.crc32)
	);
}

test('simple', async () => {
	const handle = await fs.open(path.resolve(directoryName, '..', 'fixtures', 'simple.zip'), 'r');

	try {
		const file = await fromFileHandle(handle);

		await assertZip(file, [
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 798,
					versionNeededToExtract: 10,
					generalPurposeBitFlag: 0,
					compressionMethod: 0,
					fileLastModificationTime: 43437,
					fileLastModificationDate: 22811,
					crc32: 3187940748,
					compressedSize: 21,
					uncompressedSize: 21,
					fileNameLength: 8,
					extraFieldsLength: 24,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 1,
					externalFileAttributes: 2175008768,
					relativeOffsetOfLocalHeader: 0,
					fileName: Buffer.from('test.txt'),
					extraFields: [
						{ id: 21589, data: Buffer.from([3, 69, 23, 206, 102]) },
						{ id: 30837, data: Buffer.from([1, 4, 232, 3, 0, 0, 4, 232, 3, 0, 0]) }
					],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'test.txt',
				comment: '',
				modificationDate: new Date('2024-08-27T21:13:26.000Z'),
				compressedSize: 21n,
				uncompressedSize: 21n,
				relativeOffsetOfLocalHeader: 0n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: false
			}
		]);
	} finally {
		handle.close();
	}
});

test('simple buffer', async () => {
	const handle = await fs.readFile(path.resolve(directoryName, '..', 'fixtures', 'simple.zip'));

	const file = await fromBuffer(handle);

	await assertZip(file, [
		{
			centralDirectoryFileHeader: {
				versionMadeBy: 798,
				versionNeededToExtract: 10,
				generalPurposeBitFlag: 0,
				compressionMethod: 0,
				fileLastModificationTime: 43437,
				fileLastModificationDate: 22811,
				crc32: 3187940748,
				compressedSize: 21,
				uncompressedSize: 21,
				fileNameLength: 8,
				extraFieldsLength: 24,
				commentLength: 0,
				diskNumberStart: 0,
				internalFileAttributes: 1,
				externalFileAttributes: 2175008768,
				relativeOffsetOfLocalHeader: 0,
				fileName: Buffer.from('test.txt'),
				extraFields: [
					{ id: 21589, data: Buffer.from([3, 69, 23, 206, 102]) },
					{ id: 30837, data: Buffer.from([1, 4, 232, 3, 0, 0, 4, 232, 3, 0, 0]) }
				],
				comment: Buffer.allocUnsafe(0)
			},
			fileName: 'test.txt',
			comment: '',
			modificationDate: new Date('2024-08-27T21:13:26.000Z'),
			compressedSize: 21n,
			uncompressedSize: 21n,
			relativeOffsetOfLocalHeader: 0n,
			diskNumberStart: 0,
			encrypted: false,
			compressed: false
		}
	]);
});

test('infozip-zip64-streamed', async () => {
	const handle = await fs.open(path.resolve(directoryName, '..', 'fixtures', 'infozip-zip64-streamed.zip'), 'r');

	try {
		const file = await fromFileHandle(handle);

		await assertZip(file, [
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 798,
					versionNeededToExtract: 45,
					generalPurposeBitFlag: 8,
					compressionMethod: 8,
					fileLastModificationTime: 31517,
					fileLastModificationDate: 22812,
					crc32: 1686450267,
					compressedSize: 10487360,
					uncompressedSize: 10485760,
					fileNameLength: 1,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 293601280,
					relativeOffsetOfLocalHeader: 0,
					fileName: Buffer.from([0x2d]),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: '-',
				comment: '',
				modificationDate: new Date('2024-08-28T15:24:58.000Z'),
				compressedSize: 10487360n,
				uncompressedSize: 10485760n,
				relativeOffsetOfLocalHeader: 0n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			}
		]);
	} finally {
		handle.close();
	}
});

test('musescore', async () => {
	const handle = await fs.open(path.resolve(directoryName, '..', 'fixtures', 'musescore.zip'), 'r');

	try {
		const file = await fromFileHandle(handle);

		await assertZip(file, [
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 2098270317,
					compressedSize: 10795,
					uncompressedSize: 71542,
					fileNameLength: 15,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 0,
					fileName: Buffer.from('c2NvcmVfc3R5bGUubXNz', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'score_style.mss',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 10795n,
				uncompressedSize: 71542n,
				relativeOffsetOfLocalHeader: 0n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			},
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 2099785702,
					compressedSize: 18606,
					uncompressedSize: 222280,
					fileNameLength: 38,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 10840,
					fileName: Buffer.from('VGFhdmV0aSBsYXVsIDE0MSAtIEN5cmlsbHVzIEtyZWVrLm1zY3g=', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'Taaveti laul 141 - Cyrillus Kreek.mscx',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 18606n,
				uncompressedSize: 222280n,
				relativeOffsetOfLocalHeader: 10840n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			},
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 1612644900,
					compressedSize: 20367,
					uncompressedSize: 20935,
					fileNameLength: 24,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 29514,
					fileName: Buffer.from('VGh1bWJuYWlscy90aHVtYm5haWwucG5n', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'Thumbnails/thumbnail.png',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 20367n,
				uncompressedSize: 20935n,
				relativeOffsetOfLocalHeader: 29514n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			},
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 1497484307,
					compressedSize: 686,
					uncompressedSize: 7674,
					fileNameLength: 18,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 49935,
					fileName: Buffer.from('YXVkaW9zZXR0aW5ncy5qc29u', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'audiosettings.json',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 686n,
				uncompressedSize: 7674n,
				relativeOffsetOfLocalHeader: 49935n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			},
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 2481312062,
					compressedSize: 45,
					uncompressedSize: 55,
					fileNameLength: 17,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 50669,
					fileName: Buffer.from('dmlld3NldHRpbmdzLmpzb24=', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'viewsettings.json',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 45n,
				uncompressedSize: 55n,
				relativeOffsetOfLocalHeader: 50669n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			},
			{
				centralDirectoryFileHeader: {
					versionMadeBy: 768,
					versionNeededToExtract: 20,
					generalPurposeBitFlag: 2048,
					compressionMethod: 8,
					fileLastModificationTime: 46923,
					fileLastModificationDate: 22808,
					crc32: 2704527522,
					compressedSize: 174,
					uncompressedSize: 354,
					fileNameLength: 22,
					extraFieldsLength: 0,
					commentLength: 0,
					diskNumberStart: 0,
					internalFileAttributes: 0,
					externalFileAttributes: 2179203072,
					relativeOffsetOfLocalHeader: 50761,
					fileName: Buffer.from('TUVUQS1JTkYvY29udGFpbmVyLnhtbA==', 'base64'),
					extraFields: [],
					comment: Buffer.allocUnsafe(0)
				},
				fileName: 'META-INF/container.xml',
				comment: '',
				modificationDate: new Date('2024-08-24T22:58:22.000Z'),
				compressedSize: 174n,
				uncompressedSize: 354n,
				relativeOffsetOfLocalHeader: 50761n,
				diskNumberStart: 0,
				encrypted: false,
				compressed: true
			}
		]);
	} finally {
		handle.close();
	}
});
