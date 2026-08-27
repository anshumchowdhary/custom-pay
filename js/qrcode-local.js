/*
 * Minimal standalone QR Code generator.
 * Adapted (no external deps, no CDN) from the public-domain "QR Code generator library"
 * approach by Project Nayuki (MIT-licensed derivative work, condensed for this project).
 * Exposes a tiny API: QRCode.toCanvas(canvas, text, opts, callback)
 */
(function (global) {
  "use strict";

  const QRUtil = {};
  // Single convention used everywhere in this file: spec table order L,M,Q,H = 0,1,2,3
  const EC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  // Bits actually placed in the format-info field per the QR spec (indicator bits, not table order)
  const EC_FORMAT_BITS = { 0: 0b01, 1: 0b00, 2: 0b11, 3: 0b10 }; // L=01 M=00 Q=11 H=10

  // ---- Galois field tables ----
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  (function initGF() {
    for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
    for (let i = 8; i < 256; i++) {
      EXP_TABLE[i] =
        EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    }
    for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;
  })();
  function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; }
  function glog(n) { if (n < 1) throw new Error("glog(" + n + ")"); return LOG_TABLE[n]; }

  class Polynomial {
    constructor(num, shift) {
      let offset = 0;
      while (offset < num.length && num[offset] === 0) offset++;
      this.num = new Array(num.length - offset + (shift || 0)).fill(0);
      for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    }
    get(i) { return this.num[i]; }
    get length() { return this.num.length; }
    multiply(e) {
      const num = new Array(this.length + e.length - 1).fill(0);
      for (let i = 0; i < this.length; i++)
        for (let j = 0; j < e.length; j++)
          num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      return new Polynomial(num, 0);
    }
    mod(e) {
      if (this.length - e.length < 0) return this;
      const ratio = glog(this.get(0)) - glog(e.get(0));
      const num = this.num.slice();
      for (let i = 0; i < e.length; i++) num[i] ^= gexp(glog(e.get(i)) + ratio);
      return new Polynomial(num, 0).mod(e);
    }
  }
  function errorCorrectPolynomial(n) {
    let e = new Polynomial([1], 0);
    for (let i = 0; i < n; i++) e = e.multiply(new Polynomial([1, gexp(i)], 0));
    return e;
  }

  // ---- BitBuffer ----
  class BitBuffer {
    constructor() { this.buffer = []; this.length = 0; }
    get(i) { return ((this.buffer[Math.floor(i / 8)] >>> (7 - i % 8)) & 1) === 1; }
    put(num, len) { for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1); }
    putBit(bit) {
      const idx = Math.floor(this.length / 8);
      if (this.buffer.length <= idx) this.buffer.push(0);
      if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  }

  // ---- byte data (UTF-8 safe) ----
  function toUtf8Bytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.codePointAt(i);
      if (c > 0xFFFF) i++; // surrogate pair consumed
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c < 0x10000) {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else {
        bytes.push(
          0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
          0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)
        );
      }
    }
    return bytes;
  }

  // ---- RS block table (subset covering levels/version needed for typical UPI links, up to version 12) ----
  const RS_BLOCK_TABLE = [
    [1,26,19],[1,26,16],[1,26,13],[1,25,9],
    [1,44,34],[1,44,28],[1,44,22],[1,44,16],
    [1,70,55],[1,70,44],[2,35,17],[2,35,13],
    [1,100,80],[2,50,32],[2,50,24],[4,25,9],
    [1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],
    [2,86,68],[4,43,27],[4,43,19],[4,43,15],
    [2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],
    [2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],
    [2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],
    [2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],
    [4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],
    [2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15]
  ];
  function getRSBlocks(typeNumber, ecLevel) {
    const idx = (typeNumber - 1) * 4 + ecLevel;
    const row = RS_BLOCK_TABLE[idx];
    const list = [];
    for (let i = 0; i < row.length; i += 3) {
      const count = row[i], totalCount = row[i + 1], dataCount = row[i + 2];
      for (let j = 0; j < count; j++) list.push({ totalCount, dataCount });
    }
    return list;
  }

  const MAX_LENGTH_TABLE = {
    0: [17,32,53,78,106,134,154,192,230,271,321,367],
    1: [14,26,42,62,84,106,122,152,180,213,251,287],
    2: [11,20,32,46,60,74,86,108,130,151,177,203],
    3: [7,14,24,34,44,58,64,84,98,119,137,155]
  };
  function getMaxLength(typeNumber, ecLevel) {
    return (MAX_LENGTH_TABLE[ecLevel][typeNumber - 1] || 0) * 8;
  }

  function createData(typeNumber, ecLevel, dataBytes) {
    const buffer = new BitBuffer();
    buffer.put(4, 4); // byte mode
    const lenBits = typeNumber < 10 ? 8 : 16;
    buffer.put(dataBytes.length, lenBits);
    for (const b of dataBytes) buffer.put(b, 8);

    const rsBlocks = getRSBlocks(typeNumber, ecLevel);
    const totalDataCount = rsBlocks.reduce((s, b) => s + b.dataCount, 0);
    const maxBits = totalDataCount * 8;

    if (buffer.length > maxBits) throw new Error("data too long for version");
    if (buffer.length + 4 <= maxBits) buffer.put(0, 4);
    while (buffer.length % 8 !== 0) buffer.putBit(false);
    const padAlt = [0xEC, 0x11];
    let p = 0;
    while (buffer.length < maxBits) { buffer.put(padAlt[p % 2], 8); p++; }

    return createBytes(buffer, rsBlocks);
  }

  function createBytes(buffer, rsBlocks) {
    let offset = 0;
    const maxDcCount = Math.max(...rsBlocks.map(b => b.dataCount));
    const maxEcCount = Math.max(...rsBlocks.map(b => b.totalCount - b.dataCount));
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r++) {
      const dc = rsBlocks[r].dataCount, ec = rsBlocks[r].totalCount - dc;
      dcdata[r] = new Array(dc);
      for (let i = 0; i < dc; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dc;
      const rsPoly = errorCorrectPolynomial(ec);
      const rawPoly = new Polynomial(dcdata[r], rsPoly.length - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.length - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const idx = i + modPoly.length - ecdata[r].length;
        ecdata[r][i] = idx >= 0 ? modPoly.get(idx) : 0;
      }
    }
    const totalCodeCount = rsBlocks.reduce((s, b) => s + b.totalCount, 0);
    const data = new Array(totalCodeCount);
    let idx = 0;
    for (let i = 0; i < maxDcCount; i++)
      for (let r = 0; r < rsBlocks.length; r++)
        if (i < dcdata[r].length) data[idx++] = dcdata[r][i];
    for (let i = 0; i < maxEcCount; i++)
      for (let r = 0; r < rsBlocks.length; r++)
        if (i < ecdata[r].length) data[idx++] = ecdata[r][i];
    return data;
  }

  // ---- Matrix building ----
  class QRModel {
    constructor(typeNumber, ecLevel) {
      this.typeNumber = typeNumber;
      this.ecLevel = ecLevel;
      this.modules = null;
      this.moduleCount = 0;
      this.dataCache = null;
    }
    addData(dataBytes) { this.dataBytes = dataBytes; }
    isDark(row, col) {
      if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) throw new Error("out of bounds");
      return this.modules[row][col];
    }
    make() {
      this.makeImpl(false, this.getBestMaskPattern());
    }
    getBestMaskPattern() {
      let minLostPoint = Infinity, pattern = 0;
      for (let i = 0; i < 8; i++) {
        this.makeImpl(true, i);
        const lost = this.lostPoint();
        if (lost < minLostPoint) { minLostPoint = lost; pattern = i; }
      }
      return pattern;
    }
    makeImpl(test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = Array.from({ length: this.moduleCount }, () => new Array(this.moduleCount).fill(null));
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      if (this.typeNumber >= 7) this.setupTypeNumber(test);
      if (this.dataCache == null) this.dataCache = createData(this.typeNumber, this.ecLevel, this.dataBytes);
      this.mapData(this.dataCache, maskPattern);
    }
    setupPositionProbePattern(row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          const dark = (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
                       (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
                       (2 <= r && r <= 4 && 2 <= c && c <= 4);
          this.modules[row + r][col + c] = dark;
        }
      }
    }
    getPatternPositions() {
      const PATPOS = {
        1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],
        9:[6,26,46],10:[6,28,50],11:[6,30,54],12:[6,32,58]
      };
      return PATPOS[this.typeNumber] || [];
    }
    setupPositionAdjustPattern() {
      const pos = this.getPatternPositions();
      for (let i = 0; i < pos.length; i++)
        for (let j = 0; j < pos.length; j++) {
          const row = pos[i], col = pos[j];
          if (this.modules[row][col] != null) continue;
          for (let r = -2; r <= 2; r++)
            for (let c = -2; c <= 2; c++) {
              const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
              this.modules[row + r][col + c] = dark;
            }
        }
    }
    setupTimingPattern() {
      for (let r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] != null) continue;
        this.modules[r][6] = (r % 2 === 0);
      }
      for (let c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] != null) continue;
        this.modules[6][c] = (c % 2 === 0);
      }
    }
    setupTypeNumber(test) {
      const bits = bchTypeNumber(this.typeNumber);
      for (let i = 0; i < 18; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
      }
      for (let i = 0; i < 18; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    }
    setupTypeInfo(test, maskPattern) {
      const data = (EC_FORMAT_BITS[this.ecLevel] << 3) | maskPattern;
      const bits = bchTypeInfo(data);
      // Per ISO/IEC 18004: bit i (LSB-first, i=0..14) maps to fixed strip positions below.
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;
      }
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      this.modules[this.moduleCount - 8][8] = (!test);
    }
    mapData(data, maskPattern) {
      let inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0;
      const maskFn = getMaskFunction(maskPattern);
      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] == null) {
              let dark = false;
              if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
              if (maskFn(row, col - c)) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    }
    lostPoint() {
      const mc = this.moduleCount, mods = this.modules;
      let lost = 0;
      for (let row = 0; row < mc; row++)
        for (let col = 0; col < mc; col++) {
          let sameCount = 0;
          const dark = mods[row][col];
          for (let r = -1; r <= 1; r++) {
            if (row + r < 0 || mc <= row + r) continue;
            for (let c = -1; c <= 1; c++) {
              if (col + c < 0 || mc <= col + c) continue;
              if (r === 0 && c === 0) continue;
              if (dark === mods[row + r][col + c]) sameCount++;
            }
          }
          if (sameCount > 5) lost += (3 + sameCount - 5);
        }
      for (let row = 0; row < mc - 1; row++)
        for (let col = 0; col < mc - 1; col++) {
          const count =
            (mods[row][col] ? 1 : 0) + (mods[row + 1][col] ? 1 : 0) +
            (mods[row][col + 1] ? 1 : 0) + (mods[row + 1][col + 1] ? 1 : 0);
          if (count === 0 || count === 4) lost += 3;
        }
      for (let row = 0; row < mc; row++)
        for (let col = 0; col < mc - 6; col++)
          if (mods[row][col] && !mods[row][col+1] && mods[row][col+2] && mods[row][col+3] && mods[row][col+4] && !mods[row][col+5] && mods[row][col+6])
            lost += 40;
      for (let col = 0; col < mc; col++)
        for (let row = 0; row < mc - 6; row++)
          if (mods[row][col] && !mods[row+1][col] && mods[row+2][col] && mods[row+3][col] && mods[row+4][col] && !mods[row+5][col] && mods[row+6][col])
            lost += 40;
      let darkCount = 0;
      for (let row = 0; row < mc; row++) for (let col = 0; col < mc; col++) if (mods[row][col]) darkCount++;
      lost += Math.abs(100 * darkCount / (mc * mc) - 50) / 5 * 10;
      return lost;
    }
  }

  function getMaskFunction(pattern) {
    switch (pattern) {
      case 0: return (r,c) => (r+c) % 2 === 0;
      case 1: return (r,c) => r % 2 === 0;
      case 2: return (r,c) => c % 3 === 0;
      case 3: return (r,c) => (r+c) % 3 === 0;
      case 4: return (r,c) => (Math.floor(r/2) + Math.floor(c/3)) % 2 === 0;
      case 5: return (r,c) => (r*c) % 2 + (r*c) % 3 === 0;
      case 6: return (r,c) => ((r*c) % 2 + (r*c) % 3) % 2 === 0;
      case 7: return (r,c) => ((r*c) % 3 + (r+c) % 2) % 2 === 0;
      default: throw new Error("bad mask pattern " + pattern);
    }
  }

  const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
  function getBCHDigit(data) { let d = 0; while (data !== 0) { d++; data >>>= 1; } return d; }
  function bchTypeInfo(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bchTypeNumber(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18)));
    return (data << 12) | d;
  }

  function pickVersion(byteLength, ecLevel) {
    for (let v = 1; v <= 12; v++) {
      if (byteLength * 8 + 20 <= getMaxLength(v, ecLevel)) return v;
    }
    throw new Error("data too long — reduce note/name length");
  }

  function encode(text, ecLevelName) {
    const ecLevel = EC_LEVELS[ecLevelName] != null ? EC_LEVELS[ecLevelName] : EC_LEVELS.M;
    const bytes = toUtf8Bytes(text);
    const typeNumber = pickVersion(bytes.length, ecLevel);
    const model = new QRModel(typeNumber, ecLevel);
    model.addData(bytes);
    model.make();
    return model;
  }

  function toCanvas(canvas, text, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    options = options || {};
    try {
      const model = encode(text, options.errorCorrectionLevel || "M");
      const count = model.moduleCount;
      const margin = options.margin != null ? options.margin : 4;
      const targetSize = options.width || 280;
      const cell = Math.floor(targetSize / (count + margin * 2));
      const size = cell * (count + margin * 2);
      const dark = (options.color && options.color.dark) || "#000000";
      const light = (options.color && options.color.light) || "#ffffff";

      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = dark;
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (model.isDark(r, c)) {
            ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
          }
        }
      }
      if (callback) callback(null);
    } catch (e) {
      if (callback) callback(e);
      else throw e;
    }
  }

  global.QRCode = { toCanvas };
})(window);
