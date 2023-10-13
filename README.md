A modern, simple and versatile library for reading, writing and modifying ZIP archives. It has compherensive types and no dependencies.

The library attempts to efficiently cover a wide range of real-world use cases - both high-level and low-level ones. If anything is missing or works unexpectedly, please create an issue.

## Documentation

The library provides modules `@arbendium/zip/zip` and `@arbendium/zip/unzip` for writing and reading ZIP archives respectively. Other utility modules are also exported but are not supported by type declarations and do not necessarily follow semantic versioning. See [package.json](package.json) `exports` field.

Many functions and methods take an additional options' parameter. Refer to type declarations of [zip](lib/zip.d.ts) and [unzip](lib/unzip.d.ts) for complete reference.

### Examples

#### Reading a ZIP archive

```js
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fromFileHandle } from '@arbendium/zip/unzip';

const handle = await open(inputFile);
const unzip = await fromFileHandle(handle);

let i = 0;
const promises = [];

for await (const [meta, createReadStream] of unzip.entries()) {
	console.log('Entry: %s  Size: %d', meta.fileName, meta.uncompressedSize);

	promises.push(pipeline(await createReadStream(), createWriteStream(`entry${i++}`)));
}

await Promise.all(promises);

handle.close();
```

#### Creating a ZIP archive

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import Zip from '@arbendium/zip/zip';

const zip = new Zip();

const promise = pipeline(zip, createWriteStream(outputFile));

// each of the following takes `options` as an additional argument to override default behavior
zip.addBuffer(Buffer.from('foo'), 'buffer.txt');
zip.addFile('test.txt', 'file.txt');
zip.addReadStream(createReadStream('test.txt'), 'readstream.txt');
zip.addDirectory('directory');

// entries written entries can also be removed so they
// won't be included in the Central Directory Record
const entry = await zip.addDirectory('removed-directory');
zip.removeEntry(entry);

zip.addCentralDirectoryRecord();
zip.end();

await promise;
```

#### Modifying a ZIP archive

```js
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import Zip from '@arbendium/zip/zip';
import { fromFileHandle } from '@arbendium/zip/unzip';

const handle = await open(inputFile, 'r+');
const sourceZip = await fromFileHandle(handle);
const destinazionZip = new Zip({ cursor: sourceZip.fileSize });

const promise = pipeline(
	destinazionZip,
	handle.createWriteStream({ start: Number(sourceZip.fileSize) })
);

// add existing entries
for await (const [meta] of sourceZip.entries()) {
	destinazionZip.addEntry(meta);
}

// add new entries
destinazionZip.addDirectory('directory');

destinazionZip.addCentralDirectoryRecord();
destinazionZip.end();

await promise;

handle.close();
```

#### Copying entries to another ZIP archive

```js
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import Zip from '@arbendium/zip/zip';
import { fromFileHandle } from '@arbendium/zip/unzip';

const handle = await open(inputFile);
const sourceZip = await fromFileHandle(handle);
const destinazionZip = new Zip();

const promise = pipeline(destinazionZip, createWriteStream(outputFile));

for await (const [meta, createReadStream] of sourceZip.entries()) {
	destinazionZip.addEntry(meta, createReadStream);
}

destinazionZip.addCentralDirectoryRecord();
destinazionZip.end();

await promise;

handle.close();
```

# Credits

The library started as fork of [yazl](https://github.com/thejoshwolfe/yazl) and [yauzl](https://github.com/thejoshwolfe/yauzl) by Josh Wolfe. Though the library is completely rewritten, some traces of the original code can still be found.

# License

ISC
