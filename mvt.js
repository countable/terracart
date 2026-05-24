// Minimal MVT (Mapbox Vector Tile) decoder.
// Supports just what we need: layers -> features (geometry + tags).
// Returns geometry in raw MVT integer coords (4096 units per tile edge by default).

(function (global) {
  function Reader(buf) {
    this.buf = buf;
    this.pos = 0;
    this.len = buf.length;
  }
  Reader.prototype.readVarint = function () {
    let r = 0, s = 0, b;
    while (true) {
      b = this.buf[this.pos++];
      r |= (b & 0x7f) << s;
      if (!(b & 0x80)) return r >>> 0;
      s += 7;
    }
  };
  Reader.prototype.readSVarint = function () {
    const v = this.readVarint();
    return (v >>> 1) ^ -(v & 1);
  };
  Reader.prototype.readString = function () {
    const len = this.readVarint();
    let s = '';
    const end = this.pos + len;
    // UTF-8 decode (assume mostly ASCII for prototype; fallback for non-ASCII via TextDecoder)
    const slice = this.buf.subarray(this.pos, end);
    this.pos = end;
    return new TextDecoder('utf-8').decode(slice);
  };
  Reader.prototype.readDouble = function () {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    const v = dv.getFloat64(0, true);
    this.pos += 8;
    return v;
  };
  Reader.prototype.readFloat = function () {
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    const v = dv.getFloat32(0, true);
    this.pos += 4;
    return v;
  };
  Reader.prototype.readBytes = function () {
    const len = this.readVarint();
    const b = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return b;
  };
  Reader.prototype.skip = function (wire) {
    if (wire === 0) this.readVarint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const l = this.readVarint(); this.pos += l; }
    else if (wire === 5) this.pos += 4;
  };

  function readValue(r) {
    // a Value message: oneof string/float/double/int/uint/sint/bool
    const end = r.readVarint() + r.pos;
    let v = null;
    while (r.pos < end) {
      const k = r.readVarint(); const tag = k >> 3, wire = k & 7;
      if (tag === 1) v = r.readString();
      else if (tag === 2) v = r.readFloat();
      else if (tag === 3) v = r.readDouble();
      else if (tag === 4) v = r.readVarint();      // int64
      else if (tag === 5) v = r.readVarint();      // uint64
      else if (tag === 6) v = r.readSVarint();     // sint64
      else if (tag === 7) v = !!r.readVarint();    // bool
      else r.skip(wire);
    }
    return v;
  }

  function decodeGeometry(cmds) {
    // Returns array of rings/lines: each is {type, points: [{x,y},...]}.
    // For points: array of single-point "rings".
    // We don't yet split polygon rings into outer/inner — caller can use signed area.
    const out = [];
    let x = 0, y = 0;
    let i = 0;
    let cur = null;
    while (i < cmds.length) {
      const cmdInt = cmds[i++];
      const cmd = cmdInt & 0x7;
      const count = cmdInt >> 3;
      if (cmd === 1) { // MoveTo
        for (let k = 0; k < count; k++) {
          const dx = (cmds[i] >> 1) ^ -(cmds[i] & 1); i++;
          const dy = (cmds[i] >> 1) ^ -(cmds[i] & 1); i++;
          x += dx; y += dy;
          cur = [{ x, y }];
          out.push(cur);
        }
      } else if (cmd === 2) { // LineTo
        for (let k = 0; k < count; k++) {
          const dx = (cmds[i] >> 1) ^ -(cmds[i] & 1); i++;
          const dy = (cmds[i] >> 1) ^ -(cmds[i] & 1); i++;
          x += dx; y += dy;
          cur.push({ x, y });
        }
      } else if (cmd === 7) { // ClosePath
        if (cur && cur.length) cur.push({ x: cur[0].x, y: cur[0].y });
      }
    }
    return out;
  }

  function decodeFeature(r, end, keys, values) {
    const f = { id: 0, type: 0, tags: {}, geom: null };
    let tagPairs = null, geomInts = null;
    while (r.pos < end) {
      const k = r.readVarint(); const tag = k >> 3, wire = k & 7;
      if (tag === 1) f.id = r.readVarint();
      else if (tag === 2 && wire === 2) {
        const l = r.readVarint(); const stop = r.pos + l;
        tagPairs = [];
        while (r.pos < stop) tagPairs.push(r.readVarint());
      } else if (tag === 3) f.type = r.readVarint(); // 1=point,2=line,3=poly
      else if (tag === 4 && wire === 2) {
        const l = r.readVarint(); const stop = r.pos + l;
        geomInts = [];
        while (r.pos < stop) geomInts.push(r.readVarint());
      } else r.skip(wire);
    }
    if (tagPairs) {
      for (let i = 0; i + 1 < tagPairs.length; i += 2) {
        f.tags[keys[tagPairs[i]]] = values[tagPairs[i + 1]];
      }
    }
    f.geom = geomInts ? decodeGeometry(geomInts) : [];
    return f;
  }

  function decodeLayer(r, end) {
    const layer = { name: '', extent: 4096, features: [], keys: [], values: [] };
    // Two-pass: protobuf fields can come in any order, but in practice MVT puts name first.
    // We'll collect into the layer struct as we go. Tag values reference layer.keys/values,
    // so we have to be careful — values may appear after features. We handle this by storing
    // raw feature byte spans and parsing features at the end.
    const featSpans = [];
    while (r.pos < end) {
      const k = r.readVarint(); const tag = k >> 3, wire = k & 7;
      if (tag === 1) layer.name = r.readString();
      else if (tag === 2 && wire === 2) {
        const l = r.readVarint(); featSpans.push([r.pos, r.pos + l]); r.pos += l;
      } else if (tag === 3) layer.keys.push(r.readString());
      else if (tag === 4) layer.values.push(readValue(r));
      else if (tag === 5) layer.extent = r.readVarint();
      else r.skip(wire);
    }
    for (const [a, b] of featSpans) {
      const sub = new Reader(r.buf);
      sub.pos = a;
      layer.features.push(decodeFeature(sub, b, layer.keys, layer.values));
    }
    return layer;
  }

  function decodeTile(bytes) {
    // gzip auto-decompress if needed (uncommon for MVT in browsers, but safe)
    const r = new Reader(bytes);
    const layers = [];
    while (r.pos < r.len) {
      const k = r.readVarint(); const tag = k >> 3, wire = k & 7;
      if (tag === 3 && wire === 2) {
        const l = r.readVarint();
        layers.push(decodeLayer(r, r.pos + l));
      } else r.skip(wire);
    }
    return layers;
  }

  global.MVT = { decodeTile };
})(window);
