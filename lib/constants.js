// Section 4.4.4
export const generalPurposeBitFlags = {
	encrypted: 0x0001,
	strongEncryption: 0x0040,
	unknownCrc32AndFileSizes: 0x0008,
	utf8: 0x0800
};

// Section 4.4.5
export const compressionMethods = {
	none: 0,
	deflate: 8
};
