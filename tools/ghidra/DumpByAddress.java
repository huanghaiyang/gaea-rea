// Decompile an explicit list of addresses (and optionially their callees) from the already
// imported Gaea.Native.dll program.
//
// Targets file, one entry per line:
//     0x180053e80            decompile this address, plus callees one level deep
//     0x180054140 0          decompile this address only
//     ShadeIspc              decompile the named symbol, plus callees one level deep
//
// Run:
//   analyzeHeadless <proj> GaeaNative -process Gaea.Native.dll -noanalysis -readOnly \
//     -scriptPath tools\ghidra -postScript DumpByAddress.java
//
// GAEA_GHIDRA_OUT  output directory (default ".")
// GAEA_GHIDRA_TARGETS  targets file (default "targets.txt" next to this script)

import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompInterface;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DumpByAddress extends GhidraScript {

	private Program program;
	private File outDir;
	private DecompInterface decompiler;
	private final Set<Long> written = new LinkedHashSet<>();
	private final List<String> log = new ArrayList<>();

	@Override
	public void run() throws Exception {
		program = currentProgram;
		String dir = System.getenv("GAEA_GHIDRA_OUT");
		outDir = new File(dir == null || dir.isEmpty() ? "." : dir);
		outDir.mkdirs();

		String targetsPath = System.getenv("GAEA_GHIDRA_TARGETS");
		if (targetsPath == null || targetsPath.isEmpty()) {
			targetsPath = "targets.txt";
		}
		Path path = Paths.get(targetsPath);
		if (!path.isAbsolute()) {
			path = Paths.get(getScriptArgs().length > 0 ? getScriptArgs()[0] : ".").resolve(targetsPath);
		}
		List<String> lines = Files.readAllLines(path);
		println("DumpByAddress: reading " + path);

		decompiler = new DecompInterface();
		decompiler.setOptions(new DecompileOptions());
		decompiler.toggleCCode(true);
		decompiler.toggleSyntaxTree(true);
		if (!decompiler.openProgram(program)) {
			println("decompiler refused the program");
			return;
		}

		for (String raw : lines) {
			String line = raw.trim();
			if (line.isEmpty() || line.startsWith("#")) {
				continue;
			}
			String[] parts = line.split("\\s+");
			int depth = parts.length > 1 ? Integer.parseInt(parts[1]) : 1;
			Function function = resolve(parts[0]);
			if (function == null) {
				log.add(raw + "\tNOT-FOUND");
				continue;
			}
			walk(function, depth, 0);
		}

		StringBuilder index = new StringBuilder("target\taddress\tresult\n");
		for (String row : log) {
			index.append(row).append('\n');
		}
		write("byaddress.tsv", index.toString());
		decompiler.dispose();
		println("DumpByAddress: " + written.size() + " functions written to " + outDir);
	}

	private Function resolve(String token) {
		FunctionManager functions = program.getFunctionManager();
		if (token.startsWith("0x") || token.startsWith("180")) {
			Address at = program.getImageBase().getNewAddress(Long.parseUnsignedLong(cleanHex(token), 16));
			Function function = functions.getFunctionAt(at);
			if (function == null) {
				function = createFunction(at, null);
			}
			return function;
		}
		SymbolTable symbols = program.getSymbolTable();
		for (Symbol symbol : symbols.getSymbols(token)) {
			if (symbol.getAddress() == null) {
				continue;
			}
			Function function = functions.getFunctionAt(symbol.getAddress());
			if (function != null) {
				return function;
			}
		}
		return null;
	}

	private static String cleanHex(String token) {
		String value = token.toLowerCase();
		if (value.startsWith("0x")) {
			value = value.substring(2);
		}
		while (value.length() < 16) {
			value = "0" + value;
		}
		return value;
	}

	private void walk(Function function, int depth, int level) throws IOException {
		if (function == null || function.isThunk()) {
			return;
		}
		long key = function.getEntryPoint().getUnsignedOffset();
		if (!written.add(key)) {
			return;
		}
		DecompileResults results = decompiler.decompileFunction(function, 240, monitor);
		if (results == null || !results.decompileCompleted()) {
			log.add(function.getEntryPoint() + "\tdecompile-failed");
			return;
		}
		String c = results.getDecompiledFunction().getC();
		if (c == null) {
			return;
		}

		String base = function.getEntryPoint().toString();
		StringBuilder header = new StringBuilder();
		header.append("// ").append(function.getName()).append(" @ ").append(base).append('\n');
		header.append("// callers: ");
		for (Function caller : function.getCallingFunctions(monitor)) {
			header.append(caller.getEntryPoint()).append(' ').append(caller.getName()).append("; ");
		}
		header.append("\n\n");
		write(base + "_" + sanitize(function.getName()) + ".c", header + c + "\n");
		writeConstants(function, base);
		log.add(base + "\t" + function.getName() + "\tok");

		if (level >= depth) {
			return;
		}
		for (Function callee : function.getCalledFunctions(monitor)) {
			walk(callee, depth, level + 1);
		}
	}

	private void writeConstants(Function function, String base) throws IOException {
		Memory memory = program.getMemory();
		Map<String, String> rows = new LinkedHashMap<>();
		InstructionIterator instructions = program.getListing().getInstructions(function.getBody(), true);
		for (Instruction instruction : instructions) {
			for (int op = 0; op < instruction.getNumOperands(); op++) {
				for (Object object : instruction.getOpObjects(op)) {
					if (object instanceof Scalar) {
						Scalar scalar = (Scalar) object;
						if (scalar.bitLength() == 32) {
							int bits = (int) scalar.getUnsignedValue();
							String key = "imm\t" + instruction.getAddress() + "\t" + hex(bits);
							rows.put(key, key + "\t" + Float.intBitsToFloat(bits) + "\timmediate");
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
							rows.put(key, key + "\t" + Float.intBitsToFloat(bits) + "\tdata");
						}
						catch (Exception ignored) {
							// unmapped or uninitialised
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
		write(base + "_" + sanitize(function.getName()) + ".constants.tsv", out.toString());
	}

	private void write(String name, String content) throws IOException {
		try (FileWriter writer = new FileWriter(new File(outDir, name))) {
			writer.write(content);
		}
	}

	private static String sanitize(String name) {
		return name.replaceAll("[^A-Za-z0-9_.-]", "_");
	}

	private static String hex(int bits) {
		String value = Integer.toHexString(bits);
		return "0x" + "00000000".substring(value.length()) + value;
	}
}
