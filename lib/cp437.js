// @ts-check

const cp437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

if (cp437.length !== 256) {
	throw new Error('assertion failure');
}

/** @type {Record<string, number> | undefined} */
let reverseCp437;

/**
 * @param {string} string
 * @returns {Buffer}
 */
export function encodeCp437(string) {
	if (/^[\x20-\x7e]*$/.test(string)) {
		// CP437, ASCII, and UTF-8 overlap in this range.
		return Buffer.from(string);
	}

	// This is the slow path.
	if (reverseCp437 == null) {
		// cache this once
		reverseCp437 = {};
		for (let i = 0; i < cp437.length; i++) {
			reverseCp437[cp437[i]] = i;
		}
	}

	const result = Buffer.allocUnsafe(string.length);
	for (let i = 0; i < string.length; i++) {
		const b = reverseCp437[string[i]];
		if (b == null) throw new Error(`character not encodable in CP437: ${JSON.stringify(string[i])}`);
		result[i] = b;
	}

	return result;
}

/**
 * @param {Buffer} buffer
 * @param {number} [start]
 * @param {number} [end]
 * @returns {string}
 */
export function decodeCp437(buffer, start = 0, end = buffer.length) {
	let result = '';
	for (let i = start; i < end; i++) {
		result += cp437[buffer[i]];
	}

	return result;
}
