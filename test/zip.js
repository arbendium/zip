// @ts-check

import assert from 'node:assert';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';
import { crc32 } from 'node:zlib';
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

test('simple write', async () => {
	const zip = new Zip();

	const promise = streamChecksum(zip);

	const testTxt = path.resolve(directoryName, '..', 'fixtures', 'test.txt');

	const options = { mode: 0, mtime: new Date(0) };

	zip.addBuffer(Buffer.from('foo'), 'buffer.txt', options);
	zip.addFile(testTxt, 'file.txt', options);
	zip.addReadStream(createReadStream(testTxt), 'readstream.txt', options);
	zip.addDirectory('directory', options);

	const entry = await zip.addDirectory('removed-directory', options);
	zip.removeEntry(entry);

	zip.addCentralDirectoryRecord();
	zip.end();

	assert.strictEqual(await promise, 2392539768);
});
