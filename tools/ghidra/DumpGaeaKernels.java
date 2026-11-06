// Dump specified Gaea.Native.dll functions as C pseudocode plus their literal pools.
//
// Run under analyzeHeadless:
//   analyzeHeadless <projDir> <projName> -import "D:\Gaea 2\Gaea.Native.dll" \
//     -scriptPath tools\ghidra -postScript DumpGaeaKernels.java
//
// Output directory comes from GAEA_GHIDRA_OUT (defaults to the current directory).
// Nothing here executes the binary; this is static decompilation only.

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DumpGaeaKernels extends GhidraScript {

	/** Exported kernel entry points, plus the internal helpers already identified in docs. */
	private static final String[] NAMED = {
		"ParallelErosion_Erode",
		"HydrologicalCorrection",
		"Rivers",
		"Lake_Create",
		"FastBlur_Process",
		"FastBlur4_Process",
		"ShadeIspc",
		"SunLightIntegralIspc",
		"MeshPort_HeightmapToMesh",
		"MeshPort_HeightmapToMeshWithAdaptiveSubdivision",
		"MeshPort_PointCloudToMesh",
		"MeshPort_TrianglesToMesh",
		"MathX_Compute",
		"MathX_Function",
	};

	/** Interior functions named in docs/gaea-native-kernels.md and gaea-erosion-kernel-recovered.md. */
	private static final long[] INTERNAL = {
		0x1801f1350L, // iteration driver
		0x1801f1ed0L, // particle initialisation
		0x1801f2100L, // height-weighted seeding
		0x1801f24f0L, // erosion worker
		0x1801f2f30L, // flow-coupled pass
		0x1801f35f0L, // relaxation kernel
		0x1801f0350L, // per-level parameter curve
		0x18003cfe0L, // ParallelErosion_Erode
		0x18003b720L, // parameter marshalling
		0x18003bc90L, // level construction
		0x18003e3d0L,
	};

	private Program program;
	private File outDir;
	private DecompInterface decompiler;

	@Override
	public void run() throws Exception {
		program = currentProgram;
		String dir = System.getenv("GAEA_GHIDRA_OUT");
		outDir = new File(dir == null || dir.isEmpty() ? "." : dir);
		if (!outDir.isDirectory() && !outDir.mkdirs()) {
			println("cannot create output dir " + outDir);
			return;
		}

		writeFunctionIndex();
		writeExports();

		decompiler = new DecompInterface();
		DecompileOptions options = new DecompileOptions();
		decompiler.setOptions(options);
		decompiler.toggleCCode(true);
		decompiler.toggleSyntaxTree(true);
		if (!decompiler.openProgram(program)) {
			println("decompiler refused the program");
			return;
		}

		StringBuilder index = new StringBuilder("requested\taddress\tsize\tbytes\tstatus\tfile\n");

		Set<Function> done = new LinkedHashSet<>();
		SymbolTable symbols = program.getSymbolTable();
		FunctionManager functions = program.getFunctionManager();
		for (String name : NAMED) {
			boolean found = false;
			for (Symbol symbol : symbols.getSymbols(name)) {
				Address at = symbol.getAddress();
				if (at == null) {
					continue;
				}
				Function function = functions.getFunctionAt(at);
				if (function == null) {
					continue;
				}
				found = true;
				if (!done.add(function)) {
					continue;
				}
				index.append(indexRow(name, function, dump(function, name)));
			}
			if (!found) {
				index.append(name).append("\t\t\t\tnot-found\t\n");
			}
		}

		Address base = program.getImageBase();
		for (long raw : INTERNAL) {
			Address at = base.getNewAddress(raw);
			Function function = functions.getFunctionAt(at);
			if (function == null) {
				index.append("internal\t").append(at).append("\t\t\tno-function\t\n");
				continue;
			}
			if (!done.add(function)) {
				continue;
			}
			index.append(indexRow("internal", function, dump(function, "internal")));
		}

		write("index.tsv", index.toString());
		decompiler.dispose();
		println("DumpGaeaKernels: " + done.size() + " functions written to " + outDir);
	}

	private String indexRow(String requested, Function function, String status) {
		return requested + "\t" + function.getEntryPoint() + "\t"
				+ function.getBody().getNumAddresses() + "\t"
				+ function.getBody().getNumAddresses() + "\t" + status + "\t"
				+ outputName(requested, function) + "\n";
	}

	private String outputName(String requested, Function function) {
		String safe = requested.replaceAll("[^A-Za-z0-9_.-]", "_");
		return safe + "_" + function.getEntryPoint() + ".c";
	}

	/** Decompile one function, write the C body and its literal pool, return a status word. */
	private String dump(Function function, String requested) throws IOException {
		DecompileResults results = decompiler.decompileFunction(function, 240, monitor);
		if (results == null || !results.decompileCompleted()) {
			String why = results == null ? "null" : results.getErrorMessage();
			return "decompile-failed: " + why;
		}
		String c = results.getDecompiledFunction().getC();
		if (c == null) {
			return "no-c";
		}

		StringBuilder header = new StringBuilder();
		header.append("// ").append(function.getName()).append(" @ ").append(function.getEntryPoint())
				.append("  size=").append(function.getBody().getNumAddresses()).append(" bytes\n");
		header.append("// requested as: ").append(requested).append("\n");
		header.append("// image base: ").append(program.getImageBase()).append("\n\n");
		write(outputName(requested, function), header + c + "\n");

		writeConstants(function, requested);
		return "ok";
	}

	/**
	 * Every 4-byte word this function references, either as an immediate or through a
	 * memory operand, decoded as float32. This is how the kernel constants were recovered.
	 */
	private void writeConstants(Function function, String requested) throws IOException {
		Memory memory = program.getMemory();
		Map<String, String> rows = new LinkedHashMap<>();
		InstructionIterator instructions =
				program.getListing().getInstructions(function.getBody(), true);
		for (Instruction instruction : instructions) {
			int operands = instruction.getNumOperands();
			for (int op = 0; op < operands; op++) {
				for (Object object : instruction.getOpObjects(op)) {
					if (object instanceof Scalar) {
						Scalar scalar = (Scalar) object;
						if (scalar.bitLength() == 32) {
							int bits = (int) scalar.getUnsignedValue();
							String key = "imm\t" + instruction.getAddress() + "\t" + hex(bits);
							rows.put(key, key + "\t" + Float.intBitsToFloat(bits) + "\tinstruction-immediate");
						}
					}
					else if (object instanceof Address) {
						Address at = (Address) object;
						try {
							byte[] bytes = new byte[4];
							if (memory.getBytes(at, bytes) != 4) {
								continue;
							}
							int bits = (bytes[0] & 0xff) | (bytes[1] & 0xff) << 8
									| (bytes[2] & 0xff) << 16 | (bytes[3] & 0xff) << 24;
							String key = "data\t" + at + "\t" + hex(bits);
							rows.put(key, key + "\t" + Float.intBitsToFloat(bits) + "\tdata-reference");
						}
						catch (Exception ignored) {
							// unmapped or uninitialised: nothing to decode
						}
					}
				}
			}
		}

		if (rows.isEmpty()) {
			return;
		}
		StringBuilder out = new StringBuilder("kind\tinstruction\tword\tfloat\tnote\n");
		for (String row : rows.values()) {
			out.append(row).append('\n');
		}
		String name = requested.replaceAll("[^A-Za-z0-9_.-]", "_") + "_"
				+ function.getEntryPoint() + ".constants.tsv";
		write(name, out.toString());
	}

	private void writeFunctionIndex() throws IOException {
		StringBuilder out = new StringBuilder("address\tsize\tname\tthunk\tcallers\n");
		FunctionManager functions = program.getFunctionManager();
		FunctionIterator iterator = functions.getFunctions(true);
		while (iterator.hasNext()) {
			Function function = iterator.next();
			if (function.isExternal()) {
				continue;
			}
			int callers = function.getCallingFunctions(monitor).size();
			out.append(function.getEntryPoint()).append('\t')
					.append(function.getBody().getNumAddresses()).append('\t')
					.append(function.getName()).append('\t')
					.append(function.isThunk()).append('\t')
					.append(callers).append('\n');
		}
		write("functions.tsv", out.toString());
	}

	private void writeExports() throws IOException {
		StringBuilder out = new StringBuilder("address\tname\n");
		for (Symbol symbol : program.getSymbolTable().getAllSymbols(true)) {
			if (symbol.isExternalEntryPoint()) {
				out.append(symbol.getAddress()).append('\t').append(symbol.getName()).append('\n');
			}
		}
		write("exports.tsv", out.toString());
	}

	private void write(String name, String content) throws IOException {
		try (FileWriter writer = new FileWriter(new File(outDir, name))) {
			writer.write(content);
		}
	}

	private static String hex(int bits) {
		String value = Integer.toHexString(bits);
		return "0x" + "00000000".substring(value.length()) + value;
	}
}
