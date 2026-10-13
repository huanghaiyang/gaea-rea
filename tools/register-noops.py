#!/usr/bin/env python3
"""Register the three genuine no-op nodes as forwarders."""
import pathlib
import re
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "registry.js"
t = p.read_text(encoding="utf-8")

if "name: 'Chokepoint'" in t:
    print("  already registered")
    sys.exit(0)

# Which category constant exists for utility nodes?
cats = set(re.findall(r"(\w+):\s*'[^']+'", t[:t.find("const NODES")]))
util = "CAT.UTIL" if "UTIL" in cats else ("CAT.SHAPE" if "SHAPE" in cats else "CAT.ADJ")
print(f"  categories available: {sorted(cats)}")
print(f"  using {util} for the no-ops")

anchor = "  {\n    name: 'BlobRemover', algorithm: gaeaBlobRemover, category: CAT.ADJ,"
if anchor not in t:
    print("  !! anchor not found")
    sys.exit(1)

block = f"""  // THE THREE GENUINE NO-OPS.
  //
  // `Chokepoint`, `Gate` and `Route` each have a Build() whose entire body is
  // `Commit(input.Copy(), true, true)` -- one statement, no locals, no delegation. That is not
  // a stub standing in for missing work: the vendor descriptions say so outright. Chokepoint
  // exists to break the evaluation cache, Gate "defines a baking boundary ... by forcing all
  // ancestors to bake", and Route "chooses the flow of the graph" -- all graph-level effects
  // that leave the data untouched. Implementing them as a forward is an EXACT reproduction of
  // what the managed code does, not an approximation of something unread.
  //
  // Shaper is deliberately NOT here even though the same detector flagged it. Its description
  // says it "bulks up or bulks down a terrain" and it carries Shape, Local Effect, Local Area,
  // Maintain Fine Details and Detail Size parameters, so it must do real work somewhere this
  // build has not looked. Registering it as a forward would have hidden that.
  {{
    name: 'Chokepoint', algorithm: passthrough, category: {util},
    summary: 'A no-op whose purpose is to break the evaluation cache. Recovered from the managed Build(), which is a bare input copy.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: {{}},
  }},
  {{
    name: 'Gate', algorithm: passthrough, category: {util},
    summary: 'Forces all ancestors to bake by defining a graph boundary; the data itself passes through unchanged.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: {{}},
  }},
  {{
    name: 'Route', algorithm: passthrough, category: {util},
    summary: 'Selects the graph flow between inputs and outputs; the forwarded map is unchanged.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: {{ Choice: {{ hint: 'Selects which route is taken; the data itself is forwarded as-is.' }} }},
  }},
"""

t = t.replace(anchor, block + anchor)
p.write_text(t, encoding="utf-8")
print("  registered Chokepoint, Gate, Route")
