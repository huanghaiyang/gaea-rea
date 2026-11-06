// Print the 4-byte word at each supplied address as hex and float32.
//
//   analyzeHeadless <proj> GaeaNative -process Gaea.Native.dll -noanalysis -readOnly \
//     -scriptPath tools\ghidra -postScript ReadWords.java 180356210 18035623c

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;

public class ReadWords extends GhidraScript {

	@Override
	public void run() throws Exception {
		for (String arg : getScriptArgs()) {
			String hex = arg.toLowerCase().replace("0x", "");
			while (hex.length() < 16) {
				hex = "0" + hex;
			}
			Address at = currentProgram.getImageBase().getNewAddress(Long.parseUnsignedLong(hex, 16));
			byte[] bytes = new byte[4];
			int read = currentProgram.getMemory().getBytes(at, bytes);
			if (read != 4) {
				println(at + "  <unreadable>");
				continue;
			}
			int bits = (bytes[0] & 0xff) | (bytes[1] & 0xff) << 8
					| (bytes[2] & 0xff) << 16 | (bytes[3] & 0xff) << 24;
			String word = Integer.toHexString(bits);
			while (word.length() < 8) {
				word = "0" + word;
			}
			println(at + "  0x" + word + "  " + Float.intBitsToFloat(bits));
		}
	}
}
