// @ts-check

import assert from 'node:assert';
import { open } from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { fromFileHandle } from '../lib/unzip.js';
import Zip from '../lib/zip.js';

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

test('modify', async () => {
	const handle = await open(path.resolve(directoryName, '..', 'fixtures', 'musescore.zip'), 'r');

	try {
		const sourceZip = await fromFileHandle(handle);
		const destinazionZip = new Zip({ cursor: sourceZip.fileSize });
		const promise = streamChecksum(destinazionZip);

		for await (const [meta] of sourceZip.entries()) {
			if (meta.fileName !== 'audiosettings.json') {
				destinazionZip.addEntry(meta);
			}
		}

		destinazionZip.addDirectory('directory', { mode: 0, mtime: new Date(0) });

		destinazionZip.addCentralDirectoryRecord();
		destinazionZip.end();

		assert.strictEqual(await promise, 4207948425);
	} finally {
		handle.close();
	}
});

test('copy', async () => {
	const handle = await open(path.resolve(directoryName, '..', 'fixtures', 'musescore.zip'), 'r');

	try {
		const sourceZip = await fromFileHandle(handle);
		const destinazionZip = new Zip();
		const promise = streamChecksum(destinazionZip);

		for await (const [meta, createReadStream] of sourceZip.entries()) {
			destinazionZip.addEntry(meta, createReadStream);
		}

		destinazionZip.addCentralDirectoryRecord();
		destinazionZip.end();

		assert.strictEqual(await promise, 2324660906);
	} finally {
		handle.close();
	}
});
