// Minimal 32-bit signed integer expression evaluator for the constant-folded
// expressions Eazfuscator leaves behind in decompiled C#, e.g.
//   -((-775936807 ^ 0x271B0CED) - -153409420) >> 6
//   --591646195 + -591645987 >> 1
// Supports: decimal/hex literals, unary - ~ +, binary + - * / % << >> ^ & |,
// and parentheses. Arithmetic is unchecked 32-bit, matching C# int semantics.

using System.Globalization;

namespace GaeaPools;

internal static class IntExpr
{
    public static int Eval(string s)
    {
        var p = new Parser(s);
        int v = p.ParseOr();
        p.SkipWs();
        if (!p.AtEnd) throw new FormatException($"trailing input at {p.Pos} in '{s}'");
        return v;
    }

    private sealed class Parser(string s)
    {
        private int _i;
        public int Pos => _i;
        public bool AtEnd => _i >= s.Length;
        public void SkipWs() { while (_i < s.Length && char.IsWhiteSpace(s[_i])) _i++; }

        private bool Take(string tok)
        {
            SkipWs();
            if (_i + tok.Length <= s.Length && s.AsSpan(_i, tok.Length).SequenceEqual(tok))
            {
                // avoid splitting '<<' into '<' etc.
                _i += tok.Length;
                return true;
            }
            return false;
        }

        public int ParseOr()
        {
            int v = ParseXor();
            while (true)
            {
                if (Take("|")) v |= ParseXor(); else return v;
            }
        }

        private int ParseXor()
        {
            int v = ParseAnd();
            while (true)
            {
                if (Take("^")) v ^= ParseAnd(); else return v;
            }
        }

        private int ParseAnd()
        {
            int v = ParseShift();
            while (true)
            {
                SkipWs();
                if (_i < s.Length && s[_i] == '&' && !(_i + 1 < s.Length && s[_i + 1] == '&')) { _i++; v &= ParseShift(); }
                else return v;
            }
        }

        private int ParseShift()
        {
            int v = ParseAdd();
            while (true)
            {
                SkipWs();
                if (_i + 1 < s.Length && s[_i] == '<' && s[_i + 1] == '<') { _i += 2; v <<= ParseAdd(); }
                else if (_i + 1 < s.Length && s[_i] == '>' && s[_i + 1] == '>') { _i += 2; v >>= ParseAdd(); }
                else return v;
            }
        }

        private int ParseAdd()
        {
            int v = ParseMul();
            while (true)
            {
                SkipWs();
                if (_i < s.Length && s[_i] == '+') { _i++; v += ParseMul(); }
                else if (_i < s.Length && s[_i] == '-') { _i++; v -= ParseMul(); }
                else return v;
            }
        }

        private int ParseMul()
        {
            int v = ParseUnary();
            while (true)
            {
                SkipWs();
                if (_i < s.Length && s[_i] == '*') { _i++; v *= ParseUnary(); }
                else if (_i < s.Length && s[_i] == '/') { _i++; v /= ParseUnary(); }
                else if (_i < s.Length && s[_i] == '%') { _i++; v %= ParseUnary(); }
                else return v;
            }
        }

        private int ParseUnary()
        {
            SkipWs();
            if (_i < s.Length)
            {
                if (s[_i] == '-') { _i++; return -ParseUnary(); }
                if (s[_i] == '+') { _i++; return ParseUnary(); }
                if (s[_i] == '~') { _i++; return ~ParseUnary(); }
                if (s[_i] == '(')
                {
                    _i++;
                    int v = ParseOr();
                    SkipWs();
                    if (_i >= s.Length || s[_i] != ')') throw new FormatException("expected )");
                    _i++;
                    return v;
                }
            }
            return ParseValue();
        }

        private int ParseValue()
        {
            SkipWs();
            int start = _i;
            if (_i + 1 < s.Length && s[_i] == '0' && (s[_i + 1] == 'x' || s[_i + 1] == 'X'))
            {
                _i += 2;
                while (_i < s.Length && Uri.IsHexDigit(s[_i])) _i++;
                return int.Parse(s.AsSpan(start + 2, _i - start - 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            }
            while (_i < s.Length && char.IsDigit(s[_i])) _i++;
            if (_i == start) throw new FormatException($"expected number at {_i}");
            return int.Parse(s.AsSpan(start, _i - start), CultureInfo.InvariantCulture);
        }
    }
}
