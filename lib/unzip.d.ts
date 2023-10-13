import type { FileHandle } from 'node:fs/promises'
import type { Readable } from 'node:stream'

// Reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

// Section 4.3.7 - 0x04034b50
export interface LocalFileHeader {
	versionNeededToExtract: number // 2 bytes @4
	generalPurposeBitFlag: number// 2 bytes @6
	compressionMethod: number// 2 bytes @8
	fileLastModificationTime: number // 2 bytes @10
	fileLastModificationDate: number // 2 bytes @12
	crc32: number // 4 bytes @14
	compressedSize: number // 4 bytes @18
	uncompressedSize: number // 4 bytes @22
	fileNameLength: number // 2 bytes @26 - `n`
	extraFieldsLength: number // 2 bytes @28 - `m`
	fileName: Buffer // `n` bytes @30
	extraFields: { id: number, data: Buffer }[] // `m` byttes @30+n
}

// Section 4.3.12 - signature 0x02014b50
export interface CentralDirectoryFileHeader {
	versionMadeBy: number // 2 bytes @4
	versionNeededToExtract: number // 2 bytes @6
	generalPurposeBitFlag: number// 2 bytes @8
	compressionMethod: number// 2 bytes @10
	fileLastModificationTime: number // 2 bytes @12
	fileLastModificationDate: number // 2 bytes @14
	crc32: number // 4 bytes @16
	compressedSize: number // 4 bytes @20
	uncompressedSize: number // 4 bytes @24
	fileNameLength: number // 2 bytes @28 - `n`
	extraFieldsLength: number // 2 bytes @30 - `m`
	commentLength: number // 2 bytes @32 - `k`
	diskNumberStart: number // 2 bytes @34
	internalFileAttributes: number // 4 bytes @36
	externalFileAttributes: number // 4 bytes @38
	relativeOffsetOfLocalHeader: number // 4 bytes @42
	fileName: Buffer // `n` bytes @46
	extraFields: { id: number, data: Buffer }[] // `m` byttes @46+n
	comment: Buffer // `k` bytes @46+n+m
}

export interface Entry {
	centralDirectoryFileHeader: CentralDirectoryFileHeader
	fileName: Buffer | string
	comment: Buffer | string
	compressed: boolean | undefined
	encrypted: boolean
	modificationDate: Date
	compressedSize: bigint
	uncompressedSize: bigint
	relativeOffsetOfLocalHeader: bigint
	diskNumberStart: number
}

export interface UnzipOptions {
	decodeStrings?: undefined | boolean
}

export interface UnzipEntryOptions {
	decompress?: boolean
	decrypt?: boolean
	end?: bigint
	start?: bigint
	validateData?: boolean
}

export default class Unzip {
	handle: FileHandle
	centralDirectoryOffset: bigint
	fileSize: bigint
	entryCount: bigint
	comment: string | Buffer
	entries(options?: { decodeStrings?: boolean }): AsyncIterable<[Entry, (options?: UnzipEntryOptions) => Promise<Readable>]>
}

export function fromBuffer(buffer: Buffer, options?: UnzipOptions): Unzip
export function fromFileHandle(buffer: FileHandle, options?: UnzipOptions): Unzip
