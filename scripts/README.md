# Kernel reverse-engineering pipeline

Offline, read-only w.r.t. `D:\Gaea 2`. Run from `D:\sgames\gaea-rea` with the
workspace Python (`python` on PATH).

```
# 1. managed metadata, one GaeaDump invocation per declared type
python scripts/collect_kernels.py            # -> evidence/kernels/raw/*.txt, metadata.json

# 2. declaration-order fix (metadata.json merges repeated sections with a set,
#    which loses field order; the raw dumps keep the first, ordered occurrence)
python scripts/reorder_fields.py             # -> evidence/kernels/fields-ordered.json

# 3. native symbol harvest + MSVC demangling (dbghelp!UnDecorateSymbolName)
python scripts/demangle_native.py            # -> evidence/kernels/symbols/*.demangled.tsv
python scripts/extract_native_signatures.py  # -> evidence/kernels/native-symbols.json
python scripts/namespace_census.py           # -> evidence/kernels/namespace-census.json

# 4. node -> kernel call sites and the obfuscated parameter-name recovery
python scripts/extract_node_callsites.py     # -> evidence/kernels/node-callsites.json
python scripts/decode_obfuscated_fields.py   # -> evidence/kernels/obfuscated-field-decoding.json

# 5. deliverables
python scripts/build_inventory.py            # -> docs/kernels-inventory.json
python scripts/build_reference.py            # -> docs/kernels-reference.md
python scripts/build_backends_mapping.py     # -> docs/kernels-backends.md
                                             #    docs/kernels-node-mapping.md
```

Helpers: `scripts/parse_raw.py` (human-readable view of the raw dumps),
`scripts/show_native.py` (human-readable view of the demangled signatures).

Notes:

* `collect_kernels.py` merges repeated member sections with a set, so its
  `metadata.json` field lists are **unordered**. Always take field order from
  `fields-ordered.json`, never from `metadata.json`.
* `demangle_native.py` needs `dbghelp.dll` (present on every Windows host) and
  nothing else; the PowerShell variant was dropped because script execution is
  blocked by policy in this environment.
* Nothing in this pipeline executes Gaea code, disassembles kernel bodies or
  writes to `D:\Gaea 2`.
