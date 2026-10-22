#!/usr/bin/env python3
"""Generate a dark-mode override stylesheet from an app's light stylesheet.

Not an invert filter: every literal colour (hex, rgb[a], hsl[a]) found in a
colour-bearing declaration is re-mapped in HSL space so hue is preserved:
  * light surfaces (L >= 60)          -> deep, desaturated surfaces of the same hue
  * saturated accents (S >= 30, L<60) -> brighter versions that read on dark
  * neutral dark ink (S < 30, L < 45) -> light ink
Only declarations that contain colours are emitted, each re-scoped under
`html.dark`. Output is deterministic; hand-tuned overrides live next to it.

usage: gen-dark-overrides.py <input.css> [--scope html.dark] > out.css
"""
import re
import sys
import colorsys

PROPS = re.compile(r"^(--[\w-]+|background(-color|-image)?|color|border(-[a-z-]+)?|outline(-color)?|box-shadow|fill|stroke|accent-color|text-decoration-color|caret-color)$")
HEX = r"#[0-9a-fA-F]{3,8}\b"
RGB = r"rgba?\([^)]*\)"
HSL = r"hsla?\([^)]*\)"
COLOR = re.compile(f"({HEX}|{RGB}|{HSL})")


def to_hsl(tok):
    """Return (h 0-360, s 0-100, l 0-100, alpha str|None) or None."""
    t = tok.strip()
    if t.startswith("#"):
        x = t[1:]
        if len(x) in (3, 4):
            x = "".join(c * 2 for c in x)
        r, g, b = (int(x[i:i + 2], 16) / 255 for i in (0, 2, 4))
        a = None
        if len(x) == 8:
            a = f"{int(x[6:8], 16) / 255:.3f}".rstrip("0").rstrip(".")
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        return h * 360, s * 100, l * 100, a
    m = re.match(r"rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)", t)
    if m:
        r, g, b = (float(m.group(i)) / 255 for i in (1, 2, 3))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        return h * 360, s * 100, l * 100, m.group(4)
    m = re.match(r"hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*(?:[,/]\s*([\d.%]+))?\s*\)", t)
    if m:
        return float(m.group(1)), float(m.group(2)), float(m.group(3)), m.group(4)
    return None


def remap(h, s, l):
    if l >= 60:  # surface / tint
        nl = 8 + (100 - l) * 0.9
        ns = min(s * 0.5, 38)
    elif s >= 30 and l >= 25:  # accent
        nl = min(max(l + 25, 58), 74)
        ns = min(s * 0.95 + 5, 80)
    elif l < 45:  # ink (neutral or deep-tinted)
        nl = 100 - l * 0.6
        ns = min(s, 18)
    else:
        nl = min(l + 12, 72)
        ns = s
    return h, ns, nl


def convert(tok):
    p = to_hsl(tok)
    if not p:
        return tok
    h, s, l, a = p
    # Translucent dark shadow/line tints stay dark (they read as depth on dark too).
    if a is not None and l < 30:
        return f"hsl({h:.0f} {min(s, 40):.0f}% 2% / {a})"
    h, s, l = remap(h, s, l)
    body = f"{h:.0f} {s:.0f}% {l:.0f}%"
    return f"hsl({body} / {a})" if a is not None else f"hsl({body})"


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def blocks(css):
    """Yield (prelude, body) at one nesting level."""
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            return
        prelude = css[i:j].split(";")[-1].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def scope_selector(sel, scope):
    out = []
    for s in sel.split(","):
        s = s.strip()
        if not s:
            continue
        if s in (":root", "html"):
            out.append(scope)
        elif s.startswith(":root ") or s.startswith("html "):
            out.append(f"{scope} {s.split(' ', 1)[1]}")
        else:
            out.append(f"{scope} {s}")
    return ", ".join(out)


def decls(body):
    parts, buf, depth = [], "", 0
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == ";" and depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        parts.append(buf)
    for p in parts:
        if ":" in p:
            k, v = p.split(":", 1)
            yield k.strip(), v.strip()


def process(css, scope, indent=""):
    out = []
    for prelude, body in blocks(css):
        if prelude.startswith("@media") or prelude.startswith("@supports"):
            inner = process(body, scope, indent + "  ")
            if inner:
                out.append(f"{indent}{prelude} {{\n{inner}\n{indent}}}")
            continue
        if prelude.startswith("@"):
            continue  # @theme handled as :root vars below, keyframes/imports skipped
        keep = []
        for k, v in decls(body):
            if PROPS.match(k) and COLOR.search(v):
                keep.append(f"{k}: {COLOR.sub(lambda m: convert(m.group(1)), v)}")
        if keep:
            out.append(f"{indent}{scope_selector(prelude, scope)} {{ " + "; ".join(keep) + "; }")
    return "\n".join(out)


def main():
    src = sys.argv[1]
    scope = sys.argv[sys.argv.index("--scope") + 1] if "--scope" in sys.argv else "html.dark"
    css = strip_comments(open(src).read())
    # Tailwind v4 @theme blocks define :root custom properties; treat them as such.
    css = re.sub(r"@theme(\s+inline)?\s*\{", ":root {", css)
    print(f"/* generated by scripts/theme/gen-dark-overrides.py from {src} — do not hand edit */")
    print(process(css, scope))


if __name__ == "__main__":
    main()
