// Dump the instruction listing of one function, so call-site register setup can be read.
//
//   analyzeHeadless <proj> GaeaNative -process Gaea.Native.dll -noanalysis -readOnly \
//     -scriptPath tools\ghidra -postScript DumpDisasm.java 1801f24f0

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;

import java.io.File;
import java.io.FileWriter;

public class DumpDisasm extends GhidraScript {

	@Override
	public void run() throws Exception {
		String dir = System.getenv("GAEA_GHIDRA_OUT");
		File outDir = new File(dir == null || dir.isEmpty() ? "." : dir);
		outDir.mkdirs();

		String[] args = getScriptArgs();
		String[] targets = args.length > 0 ? args : new String[] { "1801f24f0" };
		for (String target : targets) {
			String hex = target.toLowerCase().replace("0x", "");
			while (hex.length() < 16) {
				hex = "0" + hex;
			}
			Address at = currentProgram.getImageBase().getNewAddress(Long.parseUnsignedLong(hex, 16));
			Function function = currentProgram.getFunctionManager().getFunctionAt(at);
			if (function == null) {
				println("no function at " + at);
				continue;
			}
			StringBuilder out = new StringBuilder();
			int count = 0;
			InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
			for (Instruction instruction : instructions) {
				out.append(instruction.getAddress()).append("  ")
						.append(instruction.toString()).append('\n');
				count++;
			}
			File file = new File(outDir, "disasm_" + hex + ".txt");
			try (FileWriter writer = new FileWriter(file)) {
				writer.write(out.toString());
			}
			println("wrote " + file + " (" + count + " instructions)");
		}
	}
}
