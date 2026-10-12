// GaeaPools - decode Eazfuscator.NET constant-pool resources from a managed PE.
//
// Recovered envelope (see docs/engine-dataformats.md for the evidence trail):
//   [UInt16 headerLen][headerLen bytes][Byte ivLen][ivLen bytes][payload...]
//   header ^= iv (repeating)
//   header: BinaryReader.ReadString() (unused), Byte flags, Byte alg, Byte keySel,
//           Byte keyLen, keyLen bytes key, then either keyLen more key bytes
//           (keySel < 64) or a key copied from the assembly public key at keySel+12
//   alg: 1=DES 2=AES 3=TripleDES 4=Rijndael 5=RC2 6=custom XOR
//   flags bit1 => decrypt payload, bit0 => raw Deflate after that
//
// Modes:
//   list  <assembly>
//   dump  <assembly> <outdir>            decode every embedded resource payload
//   probe <assembly>                     classify each decoded payload
//   ints  <assembly> <resourceName>      print int-pool arrays
//   strs  <assembly> <resourceName>      print string-pool entries
//   eval  <expr>                         evaluate an int expression from decompiled C#

using System.Security.Cryptography;
using System.Text;
using ICSharpCode.Decompiler.Metadata;

namespace GaeaPools;

internal static class Program
{
    private static int Main(string[] args)
    {
        try { Console.OutputEncoding = new UTF8Encoding(false); } catch (IOException) { }
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: GaeaPools <list|dump|probe|ints|strs|eval> <assembly> [outdir|name]");
            return 2;
        }
        try
        {
            return args[0] switch
            {
                "list" => RunList(args[1]),
                "dump" => RunDump(args[1], args[2]),
                "probe" => RunProbe(args[1]),
                "ints" => RunInts(args[1], args[2]),
                "strs" => RunStrs(args[1], args[2]),
                "eval" => RunEval(args[1]),
                "debug" => RunDebug(args[1]),
                "brute" => RunBrute(args[1]),
                "scanraw" => RunScanRaw(args[1]),
                "raw" => RunRaw(args[1], args[2], args[3]),
                _ => Fail("unknown mode"),
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }

    private static int Fail(string m) { Console.Error.WriteLine(m); return 2; }

    // ---------------- resource access ----------------

    private sealed record Raw(string Name, byte[] Data);

    private static byte[] AssemblyPublicKey(PEFile pe)
    {
        var md = pe.Metadata;
        var ad = md.GetAssemblyDefinition();
        if (ad.PublicKey.IsNil) return Array.Empty<byte>();
        return md.GetBlobBytes(ad.PublicKey);
    }

    private static List<Raw> EmbeddedResources(PEFile pe)
    {
        // Read the CLI resources directory directly: ManifestResource.Offset is a
        // byte offset from the directory start to a 4-byte little-endian length
        // followed by that many payload bytes (ECMA-335 II.24.2.6).
        var list = new List<Raw>();
        var md = pe.Metadata;
        var reader = pe.Reader;
        int resRva = reader.PEHeaders.CorHeader.ResourcesDirectory.RelativeVirtualAddress;
        if (resRva == 0) return list;
        var dir = reader.GetSectionData(resRva).GetContent();
        foreach (var h in md.ManifestResources)
        {
            var mr = md.GetManifestResource(h);
            if (!mr.Implementation.IsNil) continue;      // linked / assembly-linked
            string name = md.GetString(mr.Name);
            int off = (int)mr.Offset;
            if (off < 0 || off + 4 > dir.Length) continue;
            int len = dir[off] | (dir[off + 1] << 8) | (dir[off + 2] << 16) | (dir[off + 3] << 24);
            if (len < 0 || off + 4 + len > dir.Length) continue;
            var data = new byte[len];
            for (int i = 0; i < len; i++) data[i] = dir[off + 4 + i];
            list.Add(new Raw(name, data));
        }
        return list;
    }

    // ---------------- envelope ----------------

    internal sealed record Envelope(byte Flags, byte Alg, byte KeySel, byte KeyLen, byte[] Key,
                                   byte[] Header, byte[] Payload, byte[] Decoded, string Strategy,
                                   string Problem);

    private static Envelope Unwrap(byte[] raw, byte[] publicKey, string name)
    {
        var br = new BinaryReader(new MemoryStream(raw, false));
        int headerLen = br.ReadUInt16();
        byte[] header = br.ReadBytes(headerLen);
        int ivLen = br.ReadByte();
        byte[] iv = br.ReadBytes(ivLen);
        byte[] payload = raw.AsSpan((int)br.BaseStream.Position).ToArray();

        byte[] xored = (byte[])header.Clone();
        for (int i = 0; i < xored.Length; i++) xored[i] ^= iv[i % ivLen];

        string marker;
        byte flags, alg, keySel, keyLen;
        byte[] key;
        try
        {
            var hb = new BinaryReader(new MemoryStream(xored, false));
            marker = hb.ReadString();          // envelope marker, e.g. "licF46B7B1E"
            if (marker.Length != 11 || !marker.StartsWith("lic", StringComparison.Ordinal))
                return new Envelope(0, 0, 0, 0, Array.Empty<byte>(), header, payload, null, null,
                                    $"not an Eazfuscator envelope (marker='{marker}')");
            flags = hb.ReadByte();
            alg = hb.ReadByte();
            keySel = hb.ReadByte();
            keyLen = hb.ReadByte();
            // The key is read from the header only when keySel selects the inline form;
            // otherwise it is copied out of the assembly public key at keySel + 12.
            key = new byte[keyLen];
            if (keySel < 64)
            {
                key = hb.ReadBytes(keyLen);
            }
            else
            {
                int off = keySel + 12;
                if (publicKey.Length >= off + keyLen) Buffer.BlockCopy(publicKey, off, key, 0, keyLen);
            }
        }
        catch (Exception ex)
        {
            return new Envelope(0, 0, 0, 0, Array.Empty<byte>(), header, payload, null, null,
                                "header parse failed: " + ex.Message);
        }

        string problem = null;
        try
        {
            byte[] body;
            if ((flags & 2) != 0)
            {
                using var sym = MakeAlgorithm(alg);
                sym.Key = key;
                sym.IV = iv;
                using var cs = new CryptoStream(new MemoryStream(payload, false), sym.CreateDecryptor(), CryptoStreamMode.Read);
                using var ms = new MemoryStream();
                cs.CopyTo(ms);
                body = ms.ToArray();
                if ((flags & 1) != 0) body = Inflate(body);
            }
            else if (flags == 1)
            {
                body = Inflate(payload);
            }
            else
            {
                body = payload;
            }
            return new Envelope(flags, alg, keySel, keyLen, key, header, payload, body,
                                $"flags=0x{flags:X2} alg={alg} keySel={keySel} keyLen={keyLen}", null);
        }
        catch (Exception ex)
        {
            problem = ex.GetType().Name + ": " + ex.Message;
            return new Envelope(flags, alg, keySel, keyLen, key, header, payload, null, null, problem);
        }
    }

    private static SymmetricAlgorithm MakeAlgorithm(byte alg) => alg switch
    {
        1 => DES.Create(),
        2 => Aes.Create(),
        3 => TripleDES.Create(),
        4 => Rijndael.Create(),
        5 => RC2.Create(),
        _ => throw new NotSupportedException($"alg {alg}"),
    };

    private static byte[] Inflate(byte[] data)
    {
        var problems = new List<string>();
        var attempts = new (string Name, Func<Stream> Make)[]
        {
            ("deflate", () => new System.IO.Compression.DeflateStream(new MemoryStream(data, false), System.IO.Compression.CompressionMode.Decompress)),
            ("zlib",    () => new System.IO.Compression.ZLibStream(new MemoryStream(data, false), System.IO.Compression.CompressionMode.Decompress)),
            ("gzip",    () => new System.IO.Compression.GZipStream(new MemoryStream(data, false), System.IO.Compression.CompressionMode.Decompress)),
            ("deflate+2", () => new System.IO.Compression.DeflateStream(new MemoryStream(data, 2, data.Length - 2, false), System.IO.Compression.CompressionMode.Decompress)),
            ("zlib+2",    () => new System.IO.Compression.ZLibStream(new MemoryStream(data, 2, data.Length - 2, false), System.IO.Compression.CompressionMode.Decompress)),
        };
        foreach (var (name, make) in attempts)
        {
            try
            {
                using var ds = make();
                using var outp = new MemoryStream();
                ds.CopyTo(outp);
                LastInflate = name;
                return outp.ToArray();
            }
            catch (Exception ex) { problems.Add($"{name}:{ex.GetType().Name}"); }
        }
        throw new InvalidDataException("no inflate strategy worked: " + string.Join(",", problems));
    }

    internal static string LastInflate;

    // ---------------- payload parsers ----------------

    internal sealed record IntPool(int[] Ints, long[] Longs, float[] Floats, double[] Doubles);

    private static IntPool ParseIntPool(byte[] data, out string error)
    {
        error = null;
        try
        {
            var br = new BinaryReader(new MemoryStream(data, false));
            // Every count is a length of a following blob, so it must be bounded by
            // the remaining byte count; reject anything else instead of allocating.
            int n1 = br.ReadInt32() ^ unchecked((int)0x38BB36CB);
            if (n1 < 0 || n1 > data.Length / 4) { error = $"implausible int count {n1}"; return null; }
            int[] ints = new int[n1];
            for (int i = ints.Length - 1; i >= 0; i--) ints[i] = br.ReadInt32() ^ unchecked((int)0x1C6ACF13);

            int n2 = br.ReadInt32() ^ unchecked((int)0x2349D2F4);
            if (n2 < 0 || n2 > data.Length / 8) { error = $"implausible long count {n2}"; return null; }
            long[] longs = new long[n2];
            for (int i = longs.Length - 1; i >= 0; i--) longs[i] = br.ReadInt64() ^ 1846900219L;

            int n3 = br.ReadInt32() ^ unchecked((int)0x192C4375);
            if (n3 < 0 || n3 > data.Length / 4) { error = $"implausible float count {n3}"; return null; }
            float[] floats = new float[n3];
            for (int i = floats.Length - 1; i >= 0; i--) floats[i] = br.ReadSingle();

            int n4 = br.ReadInt32() ^ unchecked((int)0x64A4F638);
            if (n4 < 0 || n4 > data.Length / 8) { error = $"implausible double count {n4}"; return null; }
            double[] doubles = new double[n4];
            for (int i = doubles.Length - 1; i >= 0; i--) doubles[i] = br.ReadDouble();

            return new IntPool(ints, longs, floats, doubles);
        }
        catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; return null; }
    }

    internal sealed record StrEntry(int Pos, string Value);

    private static List<StrEntry> ParseStringPool(byte[] data)
    {
        var list = new List<StrEntry>();
        var br = new BinaryReader(new MemoryStream(data, false));
        var ms = (MemoryStream)br.BaseStream;
        while (ms.Position < ms.Length)
        {
            int pos = (int)ms.Position;
            try { list.Add(new StrEntry(pos, br.ReadString())); }
            catch { break; }
        }
        return list;
    }

    // ---------------- modes ----------------

    private static int RunList(string asmPath)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        Console.WriteLine($"assembly public key: {pk.Length} bytes");
        foreach (var r in EmbeddedResources(pe))
            Console.WriteLine($"{r.Name,-12} {r.Data.Length,10} bytes  first16={Convert.ToHexString(r.Data.AsSpan(0, Math.Min(16, r.Data.Length)))}");
        return 0;
    }

    private static int RunDump(string asmPath, string outDir)
    {
        Directory.CreateDirectory(outDir);
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        int ok = 0, fail = 0;
        foreach (var r in EmbeddedResources(pe))
        {
            var env = Unwrap(r.Data, pk, r.Name);
            if (env.Decoded == null) { fail++; Console.Error.WriteLine($"[fail {r.Name}] {env.Problem}"); continue; }
            File.WriteAllBytes(Path.Combine(outDir, $"res_{Convert.ToHexString(Encoding.UTF8.GetBytes(r.Name))}.bin"), env.Decoded);
            Console.WriteLine($"{r.Name}\t{r.Data.Length}\t->{env.Decoded.Length}\t{env.Strategy}");
            ok++;
        }
        Console.Error.WriteLine($"[decoded {ok}, failed {fail}]");
        return 0;
    }

    private static int RunProbe(string asmPath)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        foreach (var r in EmbeddedResources(pe))
        {
            var env = Unwrap(r.Data, pk, r.Name);
            string verdict = "decode-failed";
            string detail = env.Problem ?? "";
            if (env.Decoded != null)
            {
                var ip = ParseIntPool(env.Decoded, out _);
                var sp = ParseStringPool(env.Decoded);
                int ipTotal = ip == null ? 0 : ip.Ints.Length + ip.Longs.Length + ip.Floats.Length + ip.Doubles.Length;
                if (ipTotal > 1 && !(sp.Count > 1 && sp[0].Value.Length > 0 && ipTotal < 4))
                {
                    verdict = "int-pool";
                    detail = $"ints={ip.Ints.Length} longs={ip.Longs.Length} floats={ip.Floats.Length} doubles={ip.Doubles.Length}";
                }
                else if (sp.Count > 0)
                {
                    verdict = "string-pool";
                    detail = $"strings={sp.Count} first={(sp.Count > 0 ? sp[0].Value : "")}";
                }
                else
                {
                    verdict = "unknown";
                    detail = $"len={env.Decoded.Length} hex={Convert.ToHexString(env.Decoded.AsSpan(0, Math.Min(32, env.Decoded.Length)))}";
                }
            }
            Console.WriteLine($"{r.Name,-10}\t{r.Data.Length,-8}\t{verdict,-12}\t{detail}");
        }
        return 0;
    }

    private static int RunInts(string asmPath, string name)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        var r = EmbeddedResources(pe).FirstOrDefault(x => x.Name == name);
        if (r == null) { Console.Error.WriteLine("resource not found"); return 3; }
        var env = Unwrap(r.Data, pk, name);
        if (env.Decoded == null) { Console.Error.WriteLine(env.Problem); return 3; }
        var ip = ParseIntPool(env.Decoded, out var err);
        if (ip == null) { Console.Error.WriteLine("not an int pool: " + err); return 3; }
        for (int i = 0; i < ip.Ints.Length; i++) Console.WriteLine($"int[{i}] = {ip.Ints[i]}");
        for (int i = 0; i < ip.Longs.Length; i++) Console.WriteLine($"long[{i}] = {ip.Longs[i]}");
        for (int i = 0; i < ip.Floats.Length; i++) Console.WriteLine($"float[{i}] = {ip.Floats[i]}");
        for (int i = 0; i < ip.Doubles.Length; i++) Console.WriteLine($"double[{i}] = {ip.Doubles[i]}");
        return 0;
    }

    private static int RunStrs(string asmPath, string name)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        var r = EmbeddedResources(pe).FirstOrDefault(x => x.Name == name);
        if (r == null) { Console.Error.WriteLine("resource not found"); return 3; }
        var env = Unwrap(r.Data, pk, name);
        if (env.Decoded == null) { Console.Error.WriteLine(env.Problem); return 3; }
        foreach (var e in ParseStringPool(env.Decoded)) Console.WriteLine($"{e.Pos}\t{e.Value}");
        return 0;
    }

    /// <summary>Evaluate the small integer expressions Eazfuscator leaves in decompiled code.</summary>
    private static int RunEval(string expr) { Console.WriteLine(IntExpr.Eval(expr)); return 0; }

    /// <summary>Try every plausible envelope interpretation and report which one yields data.</summary>
    private static int RunBrute(string asmPath)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        foreach (var r in EmbeddedResources(pe))
        {
            Console.WriteLine($"=== {r.Name} raw={r.Data.Length} ===");
            var br = new BinaryReader(new MemoryStream(r.Data, false));
            int headerLen = br.ReadUInt16();
            byte[] header = br.ReadBytes(headerLen);
            int ivLen = br.ReadByte();
            byte[] iv = br.ReadBytes(ivLen);
            byte[] payload = r.Data.AsSpan((int)br.BaseStream.Position).ToArray();
            if (headerLen == 0 || ivLen == 0) { Console.WriteLine("  no envelope"); continue; }
            byte[] x = (byte[])header.Clone();
            for (int i = 0; i < x.Length; i++) x[i] ^= iv[i % ivLen];
            byte flags = 0, alg = 0, keySel = 0, keyLen = 0;
            byte[] inlineKey = Array.Empty<byte>(), pubKey = Array.Empty<byte>();
            try
            {
                var hb = new BinaryReader(new MemoryStream(x, false));
                hb.ReadString();
                flags = hb.ReadByte(); alg = hb.ReadByte(); keySel = hb.ReadByte(); keyLen = hb.ReadByte();
                inlineKey = keySel < 64 ? hb.ReadBytes(keyLen) : Array.Empty<byte>();
                if (keySel >= 64 && pk.Length >= keySel + 12 + keyLen)
                {
                    pubKey = new byte[keyLen];
                    Buffer.BlockCopy(pk, keySel + 12, pubKey, 0, keyLen);
                }
            }
            catch (Exception ex) { Console.WriteLine("  header parse failed: " + ex.Message); continue; }
            Console.WriteLine($"  flags=0x{flags:X2} alg={alg} keySel={keySel} keyLen={keyLen} inlineKey={inlineKey.Length} pubKey={pubKey.Length}");

            foreach (var (kname, key) in new[] { ("inline", inlineKey), ("public", pubKey) })
                foreach (var decrypt in new[] { false, true })
                {
                    if (key.Length == 0) continue;
                    byte[] body = payload;
                    if (decrypt)
                    {
                        try
                        {
                            using var sym = MakeAlgorithm(alg);
                            sym.Key = key; sym.IV = iv;
                            using var cs = new CryptoStream(new MemoryStream(payload, false), sym.CreateDecryptor(), CryptoStreamMode.Read);
                            using var ms = new MemoryStream(); cs.CopyTo(ms); body = ms.ToArray();
                        }
                        catch (Exception ex) { Console.WriteLine($"  {kname} decrypt-fail {ex.GetType().Name}"); continue; }
                    }
                    foreach (var mode in new[] { "none", "raw", "skip2", "zlib", "skip2zlib", "scan" })
                    {
                        if (mode == "none")
                        {
                            var ipx = ParseIntPool(body, out var ipErr);
                            int tot = ipx == null ? 0 : ipx.Ints.Length + ipx.Longs.Length + ipx.Floats.Length + ipx.Doubles.Length;
                            Console.WriteLine($"  INTPOOL key={kname} decrypt={decrypt} -> {(tot > 0 ? $"ints={ipx.Ints.Length} longs={ipx.Longs.Length} floats={ipx.Floats.Length} doubles={ipx.Doubles.Length} first={string.Join(",", ipx.Ints.Take(8))}" : "no (" + ipErr + ")")}");
                            continue;
                        }
                        if (mode == "scan")
                        {
                            for (int skip = 0; skip <= 512; skip++)
                            {
                                foreach (var zl in new[] { false, true })
                                {
                                    try
                                    {
                                        var r2 = InflateStrategy(body, skip, zl);
                                        if (r2.Length > 64)
                                            Console.WriteLine($"  SCAN key={kname} decrypt={decrypt} skip={skip} zlib={zl} len={r2.Length} head={Convert.ToHexString(r2.AsSpan(0, Math.Min(16, r2.Length)))}");
                                    }
                                    catch { }
                                }
                            }
                            continue;
                        }
                        byte[] outb = null;
                        try
                        {
                            outb = mode switch
                            {
                                "none" => body,
                                "raw" => InflateStrategy(body, 0, false),
                                "skip2" => InflateStrategy(body, 2, false),
                                "zlib" => InflateStrategy(body, 0, true),
                                "skip2zlib" => InflateStrategy(body, 2, true),
                                _ => null,
                            };
                        }
                        catch { continue; }
                        if (outb == null || outb.Length == 0) continue;
                        var head = Convert.ToHexString(outb.AsSpan(0, Math.Min(16, outb.Length)));
                        var ascii = new string(outb.Take(16).Select(b => b >= 32 && b < 127 ? (char)b : '.').ToArray());
                        Console.WriteLine($"  OK key={kname} decrypt={decrypt} inflate={mode} len={outb.Length} head={head} '{ascii}'");
                    }
                }
        }
        return 0;
    }

    /// <summary>Write the raw, still-wrapped payload bytes of one resource to a file.</summary>
    private static int RunRaw(string asmPath, string name, string outFile)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        var r = EmbeddedResources(pe).FirstOrDefault(x => x.Name == name);
        if (r == null) { Console.Error.WriteLine("resource not found"); return 3; }
        var env = Unwrap(r.Data, pk, name);
        File.WriteAllBytes(outFile, env.Payload);
        Console.Error.WriteLine($"[{name}: payload {env.Payload.Length} bytes -> {outFile}] flags=0x{env.Flags:X2} alg={env.Alg}");
        return 0;
    }

    private static byte[] InflateStrategy(byte[] data, int skip, bool zlib)
    {
        var ms = new MemoryStream(data, skip, data.Length - skip, false);
        Stream ds = zlib
            ? new System.IO.Compression.ZLibStream(ms, System.IO.Compression.CompressionMode.Decompress)
            : new System.IO.Compression.DeflateStream(ms, System.IO.Compression.CompressionMode.Decompress);
        using (ds)
        {
            using var outp = new MemoryStream();
            ds.CopyTo(outp);
            return outp.ToArray();
        }
    }

    /// <summary>Scan every byte offset of each raw resource for a working deflate stream.</summary>
    private static int RunScanRaw(string asmPath)
    {
        using var pe = new PEFile(asmPath);
        foreach (var r in EmbeddedResources(pe))
        {
            Console.WriteLine($"=== {r.Name} raw={r.Data.Length} ===");
            for (int skip = 0; skip < Math.Min(600, r.Data.Length - 16); skip++)
            {
                foreach (var zl in new[] { false, true })
                {
                    try
                    {
                        var outp = InflateStrategy(r.Data, skip, zl);
                        if (outp.Length > 64)
                            Console.WriteLine($"  off={skip} zlib={zl} len={outp.Length} head={Convert.ToHexString(outp.AsSpan(0, Math.Min(24, outp.Length)))}");
                    }
                    catch { }
                }
            }
        }
        return 0;
    }

    /// <summary>Show the raw envelope header fields for every embedded resource.</summary>
    private static int RunDebug(string asmPath)
    {
        using var pe = new PEFile(asmPath);
        var pk = AssemblyPublicKey(pe);
        Console.WriteLine($"publicKey({pk.Length}) = {Convert.ToHexString(pk)}");
        foreach (var r in EmbeddedResources(pe))
        {
            Console.WriteLine($"=== {r.Name}  raw={r.Data.Length} ===");
            var br = new BinaryReader(new MemoryStream(r.Data, false));
            int headerLen = br.ReadUInt16();
            byte[] header = br.ReadBytes(headerLen);
            int ivLen = br.ReadByte();
            byte[] iv = br.ReadBytes(ivLen);
            int payloadLen = r.Data.Length - (int)br.BaseStream.Position;
            Console.WriteLine($"  headerLen={headerLen} ivLen={ivLen} payloadLen={payloadLen}");
            Console.WriteLine($"  iv   = {Convert.ToHexString(iv)}");
            Console.WriteLine($"  hdrCipher[0..32] = {Convert.ToHexString(header.AsSpan(0, Math.Min(32, header.Length)))}");
            byte[] x = (byte[])header.Clone();
            for (int i = 0; i < x.Length; i++) x[i] ^= iv[i % ivLen];
            Console.WriteLine($"  hdrPlain [0..48] = {Convert.ToHexString(x.AsSpan(0, Math.Min(48, x.Length)))}");
            Console.WriteLine($"  hdrPlainAscii    = {new string(x.Take(48).Select(b => b >= 32 && b < 127 ? (char)b : '.').ToArray())}");
            var env = Unwrap(r.Data, pk, r.Name);
            Console.WriteLine($"  payload[0..24] = {Convert.ToHexString(env.Payload.AsSpan(0, Math.Min(24, env.Payload.Length)))}");
            if (env.Decoded != null)
                Console.WriteLine($"  decoded[{LastInflate}] {env.Decoded.Length} bytes = {Convert.ToHexString(env.Decoded.AsSpan(0, Math.Min(24, env.Decoded.Length)))}");
            else
                Console.WriteLine("  decode: " + env.Problem);
            if (headerLen == 0 || ivLen == 0) continue;
            try
            {
                var hb = new BinaryReader(new MemoryStream(x, false));
                string marker = hb.ReadString();
                byte flags = hb.ReadByte(), alg = hb.ReadByte(), keySel = hb.ReadByte(), keyLen = hb.ReadByte();
                byte[] k = hb.ReadBytes(keyLen);
                Console.WriteLine($"  marker='{marker}' flags=0x{flags:X2} alg={alg} keySel={keySel} keyLen={keyLen} key={Convert.ToHexString(k)} hdrPos={hb.BaseStream.Position}/{x.Length}");
                Console.WriteLine($"  remaining header = {Convert.ToHexString(x.AsSpan((int)hb.BaseStream.Position))}");
            }
            catch (Exception ex) { Console.WriteLine("  header parse failed: " + ex.Message); }
        }
        return 0;
    }
}
