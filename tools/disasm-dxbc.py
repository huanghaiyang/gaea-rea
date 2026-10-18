#!/usr/bin/env python3
"""Disassemble the DXBC shaders with the D3D compiler Microsoft ships in Windows.

WHY NOT A HAND-WRITTEN DISASSEMBLER
Writing an SM5 opcode table from memory risks producing confident, wrong instruction names, and the
whole point of this exercise is to stop guessing. `d3dcompiler_47.dll` exposes

    HRESULT D3DDisassemble(LPCVOID pSrcData, SIZE_T SrcDataSize, UINT Flags,
                           LPCSTR szComments, ID3DBlob **ppDisassembly);

and it is the same compiler Unity's bytecode came from, so its output IS the ground truth for the
instruction stream. It returns a COM blob whose buffer holds the text.

The DXBC container is located by scanning each Unity subprogram record (the record begins with its
own magic, so the table offset is not the container start).
"""
import ctypes
import pathlib
import struct
import sys
import uuid

ROOT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders\blobs")
OUT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders\disasm")

# IID_ID3DBlob
IID_ID3DBlob = uuid.UUID("8ba5fb08-5195-40e2-ac58-0d989c3a0102")


class GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]


def load_compiler():
    for name in ("d3dcompiler_47.dll", "d3dcompiler_46.dll"):
        try:
            return ctypes.WinDLL(name)
        except OSError:
            continue
    return None


def blob_text(ptr):
    """Read an ID3DBlob's buffer through its vtable (GetBufferPointer, GetBufferSize)."""
    vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    get_ptr = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(vtbl[3])
    get_size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(vtbl[4])
    buf = get_ptr(ptr)
    size = get_size(ptr)
    return ctypes.string_at(buf, size).decode("latin1", "replace")


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def find_containers(b):
    """Every DXBC container in the file, in order."""
    out = []
    pos = 0
    while True:
        i = b.find(b"DXBC", pos)
        if i < 0:
            break
        if i + 32 <= len(b):
            total = u32(b, i + 24)
            if 32 < total <= len(b) - i:
                out.append(i)
        pos = i + 4
    return out


def main() -> int:
    dll = load_compiler()
    if dll is None:
        print("  no d3dcompiler found")
        return 2
    fn = dll.D3DDisassemble
    fn.restype = ctypes.c_long
    fn.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint,
                   ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]

    # D3D_DISASM_ENABLE_COLOR_CODE is off; 0 gives plain text.
    targets = sys.argv[1:] if len(sys.argv) > 1 else []
    files = [f for f in sorted(ROOT.glob("*.bin"))
             if "D3D11" in f.name and (not targets or any(t in f.name for t in targets))]

    OUT.mkdir(parents=True, exist_ok=True)
    for f in files:
        b = f.read_bytes()
        containers = find_containers(b)
        if not containers:
            continue
        print("=" * 78)
        print(f"  {f.name}   ({len(b):,} bytes, {len(containers)} DXBC container(s))")
        print("=" * 78)
        alltext = []
        for ci, at in enumerate(containers):
            total = u32(b, at + 24)
            chunk = b[at:at + total]
            buf = ctypes.create_string_buffer(chunk, len(chunk))
            out_ptr = ctypes.c_void_p()
            hr = fn(ctypes.cast(buf, ctypes.c_void_p), len(chunk), 0, None,
                    ctypes.byref(out_ptr))
            if hr != 0 or not out_ptr.value:
                print(f"    [{ci}] D3DDisassemble failed hr=0x{hr & 0xFFFFFFFF:08x}")
                continue
            text = blob_text(out_ptr.value)
            alltext.append(f"; ---- container {ci} at {at}, {total} bytes ----\n{text}")
            print(f"\n    [{ci}] container at {at}  ({total} bytes)")
            for line in text.splitlines():
                print(f"      {line}")
        if alltext:
            (OUT / (f.stem + ".asm")).write_text("\n".join(alltext), encoding="utf-8")
            print(f"\n    wrote {OUT / (f.stem + '.asm')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
