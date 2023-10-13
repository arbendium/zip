import type { FileHandle } from 'node:fs/promises'
import type { Readable } from 'node:stream'

export interface Entry {
	fileName: Buffer
	lastModFileTime: number
	lastModFileDate: number
	externalFileAttributes: number
	crc32: number
	uncompressedSize: bigint
	compressedSize: bigint
	compressionMethod: number
	crcAndFileSizeKnown: boolean
	forceZip64Format: boolean
	comment: Buffer,
	relativeOffsetOfLocalHeader: bigint
}

export default class Zip extends Readable {
	constructor(options?: { cursor?: bigint })
	addEntry(
		entry: import('./unzip.js').Entry,
		createReadStream?: (options: { decompress: false }) => Promise<Readable>,
		options?: {
		  fileName?: Buffer | string
		  comment?: Buffer | string
		  forceZip64Format?: boolean
		  mode?: number
		  mtime?: Date
		}
	): Promise<Entry>
	addFile(realPath: string, fileName: string, options?: {
		comment?: Buffer | string
		compress?: boolean
		forceZip64Format?: boolean,
		mode?: number
		mtime?: Date
	}): Promise<Entry>
	addFileHandle(fileHandle: FileHandle, fileName: string, options?: {
		comment?: Buffer | string
		compress?: boolean
		forceZip64Format?: boolean
		mode?: number
		mtime?: Date
	}): Promise<Entry>
	addReadStream(readStream: Readable, fileName: string, options?: {
		comment?: Buffer | string
		compress?: boolean
		compressedSize?: bigint
		crc32?: number
		forceZip64Format?: boolean
		mode?: number
		mtime?: Date
		uncompressedSize?: bigint
	}): Promise<Entry>
	addBuffer(buffer: Buffer, fileName: string, options?: {
		comment?: Buffer | string
		compress?: boolean
		forceZip64Format?: boolean
		mode?: number
		mtime?: Date
	}): Promise<Entry>
	addDirectory(fileName: string, options?: {
		mode?: number
		comment?: Buffer | string
		forceZip64Format?: boolean
		mtime?: Date
	}): Promise<Entry>
	addCentralDirectoryRecord(options?: {
		comment?: Buffer | string
		forceZip64Format?: boolean
	}): void
	removeEntry(entry: Entry): void;
	end(): void
}
