#!/usr/bin/env python3
"""Replace the snow/rain count assertion with a correlation assertion."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "tests" / "gaea-ops4-test.mjs"
t = p.read_text(encoding="utf-8")

start = t.find("  let opposed = 0;")
end = t.find("  const unknown = gaeaAccumulator(")
if start < 0 or end < 0 or end < start:
    print("  !! markers not found")
    sys.exit(1)

NEW = """  // OPPOSITION IS A CORRELATION, NOT A COUNT. Counting cells where snow exceeds rain gives
  // exactly half for two monotone gradients -- the split falls on the median -- so the first
  // version of this assertion failed at 128 of 256 while the masks were, in fact, perfectly
  // anti-correlated. The SIGN of the correlation is what "opposed" means, and the count was
  // measuring where the crossover happens rather than whether there is one.
  let corr = 0;
  {
    const a = snow.data;
    const b = rain.data;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length;
    mb /= b.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    corr = num / Math.sqrt(da * db || 1);
  }
  ok(corr < -0.5, 'snow and rain are anti-correlated, not merely different', corr.toFixed(4));

"""
t = t[:start] + NEW + t[end:]
p.write_text(t, encoding="utf-8")
print("  snow/rain assertion is now a correlation")
