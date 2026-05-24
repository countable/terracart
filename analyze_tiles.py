#!/usr/bin/env python3
"""Analyze Tileset Spring.png by slicing into 16x16 frames."""
import struct
import zlib
import sys
import os

PNG_PATH = os.path.join(os.path.dirname(__file__), 'Tileset', 'Tileset Spring.png')
OUT_PATH = os.path.join(os.path.dirname(__file__), 'tile_analysis.txt')
TILE = 16
COLS = 12
ROWS = 20


def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', "Not a PNG"
    pos = 8
    width = height = bit_depth = color_type = 0
    idat = b''
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        ctype = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+length]
        if ctype == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', chunk[:10])
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
        pos += 8 + length + 4
    return width, height, bit_depth, color_type, idat


def decode_png(path):
    w, h, bd, ct, idat = read_png(path)
    raw = zlib.decompress(idat)
    # channels
    if ct == 6:
        ch = 4  # RGBA
    elif ct == 2:
        ch = 3  # RGB
    elif ct == 3:
        ch = 1  # palette (not handled in detail)
    elif ct == 4:
        ch = 2  # grayscale + alpha
    elif ct == 0:
        ch = 1  # grayscale
    else:
        raise ValueError(f"Unsupported color_type {ct}")
    bpp = ch * (bd // 8)
    stride = w * bpp
    pixels = bytearray(h * stride)

    def paeth(a, b, c):
        p = a + b - c
        pa = abs(p - a); pb = abs(p - b); pc = abs(p - c)
        if pa <= pb and pa <= pc: return a
        if pb <= pc: return b
        return c

    pos = 0
    prev_row = bytes(stride)
    for y in range(h):
        ftype = raw[pos]; pos += 1
        row = bytearray(raw[pos:pos+stride]); pos += stride
        if ftype == 0:
            pass
        elif ftype == 1:  # Sub
            for x in range(bpp, stride):
                row[x] = (row[x] + row[x-bpp]) & 0xFF
        elif ftype == 2:  # Up
            for x in range(stride):
                row[x] = (row[x] + prev_row[x]) & 0xFF
        elif ftype == 3:  # Average
            for x in range(stride):
                a = row[x-bpp] if x >= bpp else 0
                b = prev_row[x]
                row[x] = (row[x] + (a + b) // 2) & 0xFF
        elif ftype == 4:  # Paeth
            for x in range(stride):
                a = row[x-bpp] if x >= bpp else 0
                b = prev_row[x]
                c = prev_row[x-bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 0xFF
        pixels[y*stride:(y+1)*stride] = row
        prev_row = bytes(row)
    return w, h, ch, bytes(pixels)


def bucket(r, g, b):
    mx = max(r, g, b); mn = min(r, g, b)
    if mx < 30: return 'black'
    if mn > 220: return 'white'
    if mx - mn < 18: return 'gray'
    if g > r and g > b:
        if g - max(r, b) > 25 and g > 90: return 'green'
        return 'olive'
    if r > g and r > b:
        if g > 80 and b < 80: return 'orange/brown'
        if b > g: return 'magenta'
        return 'red'
    if b > r and b > g:
        if g > 100: return 'cyan'
        return 'blue'
    if r > 100 and g > 100 and b < 90: return 'yellow'
    return 'mixed'


def main():
    w, h, ch, px = decode_png(PNG_PATH)
    print(f"PNG {w}x{h} channels={ch}")
    assert w == COLS*TILE and h == ROWS*TILE, f"Unexpected size {w}x{h}"
    out = []
    out.append(f"PNG {w}x{h} channels={ch}")
    out.append(f"Grid {COLS}x{ROWS} -> {COLS*ROWS} frames @ {TILE}x{TILE}")
    out.append("")
    out.append(f"{'idx':>4} {'(r,c)':>8} {'hex':>8} {'rgba':>22} {'a<16%':>6} {'opaque%':>7} {'bucket':>14}")
    out.append("-" * 80)
    for idx in range(COLS*ROWS):
        r_t = idx // COLS
        c_t = idx % COLS
        sr, sg, sb, sa, na = 0, 0, 0, 0, 0
        trans = 0
        opaque = 0
        total = TILE*TILE
        for yy in range(TILE):
            for xx in range(TILE):
                x = c_t*TILE + xx
                y = r_t*TILE + yy
                i = (y*w + x)*ch
                if ch == 4:
                    R, G, B, A = px[i], px[i+1], px[i+2], px[i+3]
                elif ch == 3:
                    R, G, B = px[i], px[i+1], px[i+2]; A = 255
                else:
                    R = G = B = px[i]; A = 255
                if A < 16:
                    trans += 1
                else:
                    sr += R*A; sg += G*A; sb += B*A; na += A
                    if A > 200:
                        opaque += 1
                sa += A
        if na > 0:
            ar = sr // na; ag = sg // na; ab = sb // na
        else:
            ar = ag = ab = 0
        tp = trans*100.0/total
        op = opaque*100.0/total
        hx = f"#{ar:02x}{ag:02x}{ab:02x}"
        bk = bucket(ar, ag, ab) if na > 0 else 'empty'
        out.append(f"{idx:>4} {f'({r_t},{c_t})':>8} {hx:>8} {f'({ar},{ag},{ab},{sa//total})':>22} {tp:>5.1f} {op:>6.1f} {bk:>14}")
    txt = "\n".join(out)
    with open(OUT_PATH, 'w') as f:
        f.write(txt)
    print(f"Wrote {OUT_PATH}")
    print(txt[:2000])


if __name__ == '__main__':
    main()
