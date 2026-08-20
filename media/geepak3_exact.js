(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GEEPAK3 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIGNATURE_V2 = [0x07, 0x47, 0x45, 0x45, 0x50, 0x41, 0x4b, 0x32];
  const SIGNATURE_V3 = [0x07, 0x47, 0x45, 0x45, 0x50, 0x41, 0x4b, 0x33];
  const PASSWORD = 'QQ1167746';
  const HEADER_SIZE = 266;

  function base64Bytes(value) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
    const binary = atob(value);
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
    return result;
  }

  const INDEX_KEY = base64Bytes(
    'D0uIybe1eHYICFzU99vEZUrAwo8KH3VIGEjsnLNha/iNBAbD+s8nTIAI5PxgYGBgBoXKS2BgYGAwBPz8YGBgYA8ARM8UWgjuKGTUmAnZeLGNA4EP6fn78jBI3Oz+z7kUhwTNx/rd38dIwPjImqWnR84JCI//4fcvQCz4vN/77jtPQMpOer5evfAgqPg/369lT4LEi6/CP9aAYNxw/7v/PY+DwoTy/fseoIB87Lxff3sKiMjHn5ufphjAmHz3/3OXjgjEz//e/9cwOGTkz+dVhwsHzMj5r/XfFFDw/Pd/fTePQcTPvyvdZwykrFz/cfuCAUHAx33p19HsAHz4pNq7TQ=='
  );
  const GLOBAL_KEY = base64Bytes(
    'bRWEpWaulkkr5aIPuQstO1Fk5djuIfJElvYUhc7DtVOM+4HmnOShoECFaziW/FLrO/cJTmHnLACMam1iftGx0rpixwSq9hoFpJ2wFKuOBCUqobuIByWGKH3W/BFGgMDMtaINyGAwkFE+mZfCcRBQ1KoAFaYMSP2EyNM4rk0pL0w/cpQMh0p2LuLbBgtZYdznXGjJXzY2ut78l4xzILNkbnaNXjsvnz31aPTApenmobRbLcP4uCoPoHZZmb2ZjLOmteMrwaop2CjaINcMMW+HcLpe7ptb8/CCHDbfU8ROVCoAF4eh6ppQ2ORnDYgqRh/EMJsVAQVimVlgE/sGg2J3hA=='
  );
  const IMAGE_KEY = base64Bytes(
    'm3Z+8GCUzj9CKAlRRTpOJKbuS8otBuepT2z2d/M3fUyqhKd79PMxpf6NjRp033iPVPfo1mZe3sK67jKePSaG1e7JGU7iFS5h4z1WWCJWalrZPpXLYoa/88/oDb2pEZK4QswowX2bDOg1ZAzyyxb9k1kkWRUApHvoTToEcMdU9sdEMz5b2FLBpfxamANFyJjtWOTGCdwAsKk0J8hKBwTbf1xVnyQkkIanwxsVf/sukkmVF0uCBKpP6dqufhnLOWjZl5wfqmdbjtb41N+z7oHFHFb8D2DFfQlgXyVgE7U/JsF8qsInE1hiRfruJncm25Zyhcq4u2iJG8wEHX07E8yDR0lVCbTSZcWCfz6Bu1t318g7J3mgeq1loTXxHG0fgpY9JrikTHnQeQpPqYikp7U36gtxZfQebBBwmG+kz4vRtR9ImhiJJNO8hRvnp4eFI3e4OdqWj0sgy9FtpKp5JUJrJ69inqZPfNEeFrcrOmhx+kUdVjmsEtcNnL8RuOI1rwB9ILHWgR2X9rijapuR1gJBKIRwj87yNVaFHbiIDFlvtl+DSZ8gUC8rTzPRt2t68oYBM4pMclGYNYtM7LCd5ln/9a+D34SPQQ5bCwW7pSaOWia9DL3kihs+1USK6ibkIghWzPuwNT6nVU4oTn7VIwDoSPPZ5iZvxJNPW1mklpDtiuMakkaS857qGwwP12RW+ozso5xr3Hap/ZGu1hvUymKESqVzf9JHK6IXBElASfWnrhq/a/k6R7eG0QAXEEJ5c1joWpmMz8ex35jodz36ntWGX9tZyvO2nup+GQnKztpPfKrF4ZLgvBqTBAfJoaMrPg6wndRdtbVZjm+fmNF/ehdKhZCXoOqo6Bro2skTk/sX0Q25j3WCCF76+ZnY2MzPcDj7rXh6zEqXkyA995Zx/ypI8RDM2ROscL/1xD5CzVLpnCfPuM7I7hMXRjCAWIuCT/mYOXCjOHJmaGvlxNLEXZZAiM6BJqMwebZBlFWzZVUnAnQBHgOGJSH+4fnkIPInGgse0RygiJ+Wn+WwQ7IzLPIxyC8IVnRwJjnOJ2tJKzVKbYXdcKxis+Rmk/wEIICA5ct7HZmd2iYmiLTtSnCHYvpVQoEWIijwMgrUuFaWeyVAvnK+1YVFD+mzLDev61MFnqYQKvG65apN9GQGBbvc50Vz4ENLScVK2FC6SxEgKMcrTbgqSbsCVvHGLaJou/ziTsXaX39lgMeMqMDxtDEqsy32UHsQslCQGaS7jmi8TVRN7G4XX1qNiRlcwiQalnN51E/c5FMlSJfO4RWPkkgDSFi8ZmNeXqlIYwn65Sy1e96clpDv1K06BtxnZHmxZloLLYkkFLDVBrOCa0Zs4tBDPNgS7A=='
  );
  const LEGACY_GLOBAL_KEY = base64Bytes(
    'dMHHTvzHSrToxfZvbCW/o0FDQqlMb5Dbw0aRL6W0dqRxC95L4p5nZQU3fVoEezZsYvgmr5ZOgpF0nA=='
  );
  const LEGACY_INDEX_KEY = base64Bytes(
    'NDe3/RCc3arrryd7Cz/VFLf2+rAoXD60pwdPSzLlTNo68LuzVHZu4TPnOw+fn5+fsDq395+fn59zY0P3n5+fn/Iz//gpX04rc9PHr1q2e8z9OXz5swCA8e/jow8ABCjM/fu4ewwCQACrexvXAQawjLO2OPwGCcDEj/vfw4dHg254uze5FgBBUMOL4+sAKZV3d71yM0KZgDH7k6P/wNYxMH64dHECxcAZv1/fkyykUEC89bQ8AIAY2Ldbl8sIBGPEt/W9tyADFGkfR5Nj0QUApbZxfrYAERChWy97hwBBZAl4N790MAAg2hsr8x80Kcgy+/SyPoBQFEaHf8dziMBDeA=='
  );
  const LEGACY_IMAGE_KEY = base64Bytes(
    '1HD6b5c0nWMAAAAAwTjuTRONObdtt9YDAAAAALbyAWv9+9UH4Z8DgQAAAAAXC9jzmTGRY/Z4ILsAAAAA8BCu0JpKE71CJMqcAAAAAL9p5LCX1ytNXKXWAgAAAACf3eL2js4jj/EvRQIAAAAAWE8uPmO6eLxQla0iAAAAAKQZ2AUHD4Diuh7TegAAAAAGxwsIHX5YET9IdR4AAAAAJEnmw3G+8wMzwBZiAAAAAGYtOS+F+CH0z6FuWQAAAADmcxAdwq9hQV+mQe8AAAAA6E77GgMJoxktD1FQAAAAANZYZMo6gpLn2KZjBAAAAADXdVTnDZU9W3l+jMIAAAAAXD+B5KSWcmTLX9ayAAAAAFgBRaqYaKJPuNyQGgAAAADB+/geR/if6pL4bxsAAAAAd/RZ6yryOrwdGHhbAAAAAGfFJYsXqdwgNflVXAAAAABrhmN5ugS31NnGZQgAAAAAfV9FiG0Bi18hiSt0AAAAAIiwQXfcqZzo3mU/UgAAAAAMiC+ASz/brTUM5Y0AAAAArmNm7Sz7TTic8Ef3AAAAAAChBLjC/X9c+ImbNQAAAACYM+bLyBOF49I+fDkAAAAARJ3y0VPKHczseZcWAAAAANe3PGNe0uClXmcsZAAAAACXMDYOp5d5jyS48UEAAAAA2liLLVdG4KT8jVHPAAAAAOFbG+l5NaJbXwQExwAAAAC+LjDf8B+PnDpFL8EAAAAARyWtj+e/qPY03JCiAAAAAAqf6StLhICy96ciYQAAAACTs6ORqSncBbvE2tgAAAAANt8cw2Yth22e/tOuAAAAAGPXD4j9YvGfFlaSvQAAAABE5zKo4ITpzO+cXyQAAAAABZeD6MoKdjMqKS2yAAAAAFf/xCDNJgSxXT6+xQAAAAA/525X7fJQS11ooyUAAAAAgUM/XmoBmzNS3DSUAAAAAO3Fq61IjIsV7VLYpAAAAADPqpIWzE9u5ffqUrwAAAAAXVet3pByqLl8h3hLAAAAAACfFeAE6r3PU7OoWAAAAACBAe5MiU86wUPtn5IAAAAAbBV3GyZGySbz6GcsAAAAAA53ZgGUQwz49nnpLQAAAAAwQXUcUegE4e569xYAAAAAVwJEGE3Ch/ZC78yuAAAAAHoJNlQOiQ3ywJgJeQAAAAAMEfqoBrPW7KaMz68AAAAAVnX6qR+i0iFdg8iDAAAAAIrWtfL6TyA/LbRaKAAAAABu/l7/vvZmjkC9Kn8AAAAAaAQZ4FGLHhYG9JwrAAAAAKBeL01VPv/shsee/gAAAAD1CQyJgzr5x7xlzW8AAAAAmmVVoXn60jkww0MlAAAAAOZ4CRurUFZnNsLo9QAAAABKgKNUSGpyMcuOKz0AAAAAAu00Jw=='
  );
  const A8_PALETTE_BGRA = base64Bytes(
    'AAAAAAAAgP8AgAD/AICA/4AAAP+AAID/gIAA/8DAwP+XgFX/yLmd/3Nze/8pKS3/UlJa/1paY/85OUL/GBgd/xAQGP8YGCn/CAgQ/3F58v9fZ+H/Wlr//zEx//9SWtb/ABCU/xgplP8ACDn/ABBz/wAYtf9SY73/EBhC/5mq//8AEFr/KTlz/zFKpf9ze5T/MVK9/xAhUv8YMXv/EBgt/zFKjP8AKZT/ADG9/1Jzxv8YMWv/QmvG/wBKzv85Y6X/GDFa/wAQKv8ACBX/ABg6/wAACP8AACn/AABK/wAAnf8AANz/AADe/wAA+/9Sc5z/SmuU/ylKc/8YMVL/GEqM/xFEiP8AIUr/EBgh/1qU1v8ha8b/AGvv/wB3//+ElKX/ITFC/wgQGP8IGCn/ABAh/xgpOf85Y4z/EClC/xhCa/8YSnv/AEqU/3uEjP9aY2v/OUJK/xghKf8pOUb/lKW1/1pre/+Usc7/c4yl/1pzjP9zlLX/c6XW/0ql7/+Mxu//QmN7/zlWa/9alL3/ADlj/63G1v8pQlL/GGOU/63W7/9jjKX/Slpj/3ulvf8YQlr/MYy9/ykxNf9jhJT/Smt7/1qMpf8pSlr/OXuc/xAxQv8hre//ABAY/wAhKf8Aa5z/WoSU/xhCUv8pWmv/IWN7/yF7nP8Apd7/OVJa/xApMf97vc7/OVpj/0qElP8ppcb/GJwQ/0qMQv9CjDH/KZQQ/xAYCP8YGAj/ECkI/ylCGP+ttaX/c3Nr/ykpGP9KQhj/SkIx/97GY///3UT/79aM/zlrc/853vf/jO/3/wDn9/9aa2v/pYxa/++1Of/OnEr/tYQx/2tSMf/W3t7/tb29/4SMjP/e9/f/GAgA/zkYCP8pEAj/ABgI/wApCP+lUgD/3nsA/0opEP9rORD/jFIQ/6VaIf9aMRD/hEIQ/4RSMf8xIRj/e1pK/6VrUv9jOSn/3koQ/yEpKf85Skr/GCkp/ylKSv9Ce3v/Spyc/ylaWv8UQkL/ADk5/wBZWf8sNcr/IXNr/wAxKf8QOTH/GDkx/wBKQv8YY1L/KXNa/xhKMf8AIRj/ADEY/xA5GP9KhGP/Sr1r/0q1Y/9KvWP/Spxa/zmMSv9KxmP/StZj/0qEUv8pczH/WsZj/0q9Uv8A/xD/GCkY/0qISv9K50r/AFoA/wCIAP8AlAD/AN4A/wDuAP8A+wD/lFpK/7VzY//WjHv/1ntr//+Id//Oxsb/nJSU/8aUnP85MTH/hBgp/4QAGP9SQkr/e0JS/3NaY//3tc7/nHuM/8wid///qt3/KrTw/58A3/+zF+P/8Pv//6SgoP+AgID/AAD//wD/AP8A/////wAA//8A/////wD//////w=='
  );

  function u16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function i16(bytes, offset) {
    const value = u16(bytes, offset);
    return value & 0x8000 ? value - 0x10000 : value;
  }

  function u32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function titleFrom(plain) {
    const length = plain[1];
    if (2 + length > plain.length) throw new Error('GEE global title length is invalid');
    let result = '';
    for (let i = 0; i < length; i++) result += String.fromCharCode(plain[2 + i]);
    return result;
  }

  function globalFields(plain) {
    return {
      title: titleFrom(plain),
      headerSize: u32(plain, 0x2a),
      count: u32(plain, 0x2e),
      version: u32(plain, 0x32),
      indexOffset: u32(plain, 0x36),
    };
  }

  function validGlobal(fields, fileSize) {
    return (fields.title === 'www.gameofmir.com' || fields.title === 'www.gameofmir2.com') &&
      fields.headerSize === HEADER_SIZE && fields.version === 2 &&
      fields.indexOffset === HEADER_SIZE && fields.count <= 1000000 &&
      fields.indexOffset + fields.count * 4 <= fileSize;
  }

  function formatName(imageType, flags) {
    const formats = {
      '3:0': 'GEE_A8_PALETTE',
      '5:0': 'GEE_R5G6B5',
      '6:0': 'GEE_R8G8B8',
      '6:1': 'GEE_R8G8B8_A8',
      '7:0': 'GEE_X8R8G8B8',
      '7:1': 'GEE_A8R8G8B8',
    };
    const result = formats[imageType + ':' + flags];
    if (!result) throw new Error(`unsupported GEE image format type=${imageType}, flags=${flags}`);
    return result;
  }

  function rawImageSize(imageType, flags, width, height) {
    let rowSize;
    if (imageType === 3 && flags === 0) rowSize = (width + 3) & ~3;
    else if (imageType === 5 && flags === 0) rowSize = (width * 2 + 3) & ~3;
    else if (imageType === 6 && flags === 0) rowSize = (width * 3 + 3) & ~3;
    else if (imageType === 6 && flags === 1) {
      rowSize = ((width * 3 + 3) & ~3) + ((width + 3) & ~3);
    } else if (imageType === 7 && (flags === 0 || flags === 1)) rowSize = width * 4;
    else throw new Error(`unsupported GEE image layout type=${imageType}, flags=${flags}`);
    return rowSize * height;
  }

  function hasSignature(bytes, signature) {
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }

  function decodeProfileBytes(value, name, expectedLength) {
    const bytes = value instanceof Uint8Array ? value : base64Bytes(value || '');
    if (bytes.length !== expectedLength) {
      throw new Error(`PAK 离线引擎返回的 ${name} 长度无效：${bytes.length}`);
    }
    return bytes;
  }

  function profileKeys(password, profile) {
    if (!profile) {
      if (password !== PASSWORD) {
        throw new Error('当前密码需要 PAK 离线引擎派生密钥');
      }
      return { indexKey: INDEX_KEY, globalKey: GLOBAL_KEY, imageKey: IMAGE_KEY };
    }
    return {
      indexKey: decodeProfileBytes(profile.indexKey, 'indexKey', 256),
      globalKey: decodeProfileBytes(profile.globalHeaderKey, 'globalHeaderKey', 256),
      imageKey: decodeProfileBytes(profile.imageHeaderKey, 'imageHeaderKey', 1024),
    };
  }

  function parseGee2FromReader(fileSize, read, profile, prefix = null) {
    const headerPrefix = prefix || read(0, HEADER_SIZE);
    if (!hasSignature(headerPrefix, SIGNATURE_V2)) {
      throw new Error('不是有效的 GEEPAK2 文件');
    }
    if (!profile || profile.format !== 'GEEPAK2' || profile.family !== 'gee2') {
      throw new Error('GEEPAK2 需要离线引擎返回精确索引');
    }
    const fields = {
      title: String(profile.title || ''),
      headerSize: Number(profile.headerSize),
      count: Number(profile.slotCount),
      version: Number(profile.version),
      indexOffset: Number(profile.indexOffset),
    };
    if (!Number.isInteger(fields.count) || !validGlobal(fields, fileSize)) {
      throw new Error('PAK 离线引擎返回的 GEEPAK2 全局头无效');
    }
    const imageMask = decodeProfileBytes(profile.imageHeaderMask, 'GEEPAK2 imageHeaderMask', 8);
    const decryptedIndex = decodeProfileBytes(
      profile.decryptedIndex,
      'GEEPAK2 decryptedIndex',
      fields.count * 4
    );
    const offsets = new Uint32Array(fields.count);
    const entries = [];
    const seenOffsets = new Set();
    const indexEnd = fields.indexOffset + fields.count * 4;
    for (let logicalIndex = 0; logicalIndex < fields.count; logicalIndex++) {
      const headerOffset = u32(decryptedIndex, logicalIndex * 4);
      offsets[logicalIndex] = headerOffset;
      if (headerOffset === 0) continue;
      if (headerOffset < indexEnd || headerOffset + 16 > fileSize) {
        throw new Error(`图像 ${logicalIndex} 的 GEEPAK2 块头越界`);
      }
      if (seenOffsets.has(headerOffset)) throw new Error(`图像 ${logicalIndex} 的块偏移重复`);
      seenOffsets.add(headerOffset);
      entries.push({ logicalIndex, headerOffset });
    }

    entries.sort((left, right) => left.headerOffset - right.headerOffset);
    const blocks = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];
      const { logicalIndex, headerOffset } = entry;
      const decrypted = Uint8Array.from(read(headerOffset, 16));
      for (let index = 0; index < imageMask.length; index++) {
        decrypted[index] ^= imageMask[index];
      }
      const imageType = decrypted[0];
      const flags = decrypted[3];
      const width = u16(decrypted, 4);
      const height = u16(decrypted, 6);
      const x = i16(decrypted, 8);
      const y = i16(decrypted, 10);
      const compressedSize = u32(decrypted, 12);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) {
        throw new Error(`图像 ${logicalIndex} 的尺寸无效：${width}x${height}`);
      }
      const rawSize = rawImageSize(imageType, flags, width, height);
      const payloadSize = compressedSize || rawSize;
      const payloadOffset = headerOffset + 16;
      if (payloadSize < 1 || payloadOffset + payloadSize > fileSize) {
        throw new Error(`图像 ${logicalIndex} 的数据越界`);
      }
      const nextHeaderOffset = entries[entryIndex + 1]?.headerOffset || fileSize;
      if (payloadOffset + payloadSize > nextHeaderOffset) {
        throw new Error(`图像 ${logicalIndex} 的数据与下一个图像块重叠`);
      }
      if (compressedSize) {
        const zlibHeader = read(payloadOffset, 2);
        const cmf = zlibHeader[0], flg = zlibHeader[1];
        if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) {
          throw new Error(`图像 ${logicalIndex} 的 zlib 头无效`);
        }
      }
      blocks.push({
        logicalIndex, headerOffset, payloadOffset, compressedSize, payloadSize,
        rawSize, imageType, flags, width, height, x, y,
        format: formatName(imageType, flags), family: 'gee2',
      });
    }
    blocks.sort((left, right) => left.logicalIndex - right.logicalIndex);
    return { header: Object.assign({ family: 'gee2' }, fields), offsets, blocks };
  }

  function parse(bytes, password, profile = null) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length < HEADER_SIZE) throw new Error('GEE 文件长度无效');
    if (hasSignature(bytes, SIGNATURE_V2)) {
      return parseGee2FromReader(
        bytes.length,
        (offset, length) => bytes.subarray(offset, offset + length),
        profile,
        bytes.subarray(0, HEADER_SIZE)
      );
    }
    const keys = profileKeys(password, profile);
    if (!hasSignature(bytes, SIGNATURE_V3)) {
      throw new Error('不是有效的 GEEPAK3 文件');
    }

    let plain = new Uint8Array(256);
    for (let i = 0; i < 256; i++) plain[i] = bytes[10 + i] ^ keys.globalKey[i];
    let fields = globalFields(plain);
    let family = 'main';
    if (!validGlobal(fields, bytes.length)) {
      plain = new Uint8Array(256);
      for (let i = 0; i < LEGACY_GLOBAL_KEY.length; i++) {
        plain[i] = bytes[10 + i] ^ LEGACY_GLOBAL_KEY[i];
      }
      fields = globalFields(plain);
      family = 'legacy';
    }
    if (!validGlobal(fields, bytes.length)) throw new Error('GEE 全局头解密失败或密码错误');

    const offsets = new Uint32Array(fields.count);
    const indexKey = family === 'legacy' ? LEGACY_INDEX_KEY : keys.indexKey;
    for (let index = 0; index < fields.count; index++) {
      const encrypted = u32(bytes, fields.indexOffset + index * 4);
      const key = u32(indexKey, (index % 64) * 4);
      const mask = family === 'legacy' ? key : (~key >>> 0);
      offsets[index] = (encrypted ^ mask ^ index) >>> 0;
    }

    const blocks = [];
    const seenOffsets = new Set();
    for (let logicalIndex = 0; logicalIndex < offsets.length; logicalIndex++) {
      const headerOffset = offsets[logicalIndex];
      if (headerOffset === 0) continue;
      if (headerOffset + 16 > bytes.length) throw new Error(`图像 ${logicalIndex} 的块头越界`);
      if (seenOffsets.has(headerOffset)) throw new Error(`图像 ${logicalIndex} 的块偏移重复`);
      seenOffsets.add(headerOffset);

      const decrypted = new Uint8Array(16);
      const keyOffset = (logicalIndex % 64) * 16;
      if (family === 'legacy') {
        for (let i = 0; i < 8; i++) decrypted[i] = bytes[headerOffset + i] ^ LEGACY_IMAGE_KEY[keyOffset + i];
        for (let i = 12; i < 16; i++) decrypted[i] = bytes[headerOffset + i] ^ LEGACY_IMAGE_KEY[keyOffset + i];
      } else {
        for (let i = 0; i < 16; i++) decrypted[i] = bytes[headerOffset + i] ^ keys.imageKey[keyOffset + i];
      }

      const imageType = decrypted[0];
      const flags = decrypted[3];
      const width = u16(decrypted, 4);
      const height = u16(decrypted, 6);
      const x = family === 'legacy' ? 0 : i16(decrypted, 8);
      const y = family === 'legacy' ? 0 : i16(decrypted, 10);
      const compressedSize = u32(decrypted, 12);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) {
        throw new Error(`图像 ${logicalIndex} 的尺寸无效：${width}x${height}`);
      }
      const rawSize = rawImageSize(imageType, flags, width, height);
      const payloadSize = compressedSize || rawSize;
      const payloadOffset = headerOffset + 16;
      if (payloadOffset + payloadSize > bytes.length) throw new Error(`图像 ${logicalIndex} 的数据越界`);
      if (compressedSize) {
        const cmf = bytes[payloadOffset], flg = bytes[payloadOffset + 1];
        if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) {
          throw new Error(`图像 ${logicalIndex} 的 zlib 头无效`);
        }
      }
      blocks.push({
        logicalIndex, headerOffset, payloadOffset, compressedSize, payloadSize,
        rawSize, imageType, flags, width, height, x, y,
        format: formatName(imageType, flags), family,
      });
    }
    return { header: Object.assign({ family }, fields), offsets, blocks };
  }

  function parseFromReader(fileSize, readRange, password, profile = null) {
    if (!Number.isSafeInteger(fileSize) || fileSize < HEADER_SIZE) {
      throw new Error('GEE 文件长度无效');
    }
    if (typeof readRange !== 'function') throw new Error('GEE 文件读取器无效');
    const read = (offset, length) => {
      const value = readRange(offset, length);
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (bytes.length !== length) throw new Error(`GEE 文件数据提前结束：${offset}+${length}`);
      return bytes;
    };
    const prefix = read(0, HEADER_SIZE);
    if (hasSignature(prefix, SIGNATURE_V2)) {
      return parseGee2FromReader(fileSize, read, profile, prefix);
    }
    const keys = profileKeys(password, profile);
    if (!hasSignature(prefix, SIGNATURE_V3)) {
      throw new Error('不是有效的 GEEPAK3 文件');
    }

    let plain = new Uint8Array(256);
    for (let i = 0; i < 256; i++) plain[i] = prefix[10 + i] ^ keys.globalKey[i];
    let fields = globalFields(plain);
    let family = 'main';
    if (!validGlobal(fields, fileSize)) {
      plain = new Uint8Array(256);
      for (let i = 0; i < LEGACY_GLOBAL_KEY.length; i++) {
        plain[i] = prefix[10 + i] ^ LEGACY_GLOBAL_KEY[i];
      }
      fields = globalFields(plain);
      family = 'legacy';
    }
    if (!validGlobal(fields, fileSize)) throw new Error('GEE 全局头解密失败或密码错误');

    const encryptedIndex = read(fields.indexOffset, fields.count * 4);
    const offsets = new Uint32Array(fields.count);
    const indexKey = family === 'legacy' ? LEGACY_INDEX_KEY : keys.indexKey;
    const entries = [];
    const seenOffsets = new Set();
    for (let logicalIndex = 0; logicalIndex < fields.count; logicalIndex++) {
      const encrypted = u32(encryptedIndex, logicalIndex * 4);
      const key = u32(indexKey, (logicalIndex % 64) * 4);
      const mask = family === 'legacy' ? key : (~key >>> 0);
      const headerOffset = (encrypted ^ mask ^ logicalIndex) >>> 0;
      offsets[logicalIndex] = headerOffset;
      if (headerOffset === 0) continue;
      if (headerOffset + 16 > fileSize) throw new Error(`图像 ${logicalIndex} 的块头越界`);
      if (seenOffsets.has(headerOffset)) throw new Error(`图像 ${logicalIndex} 的块偏移重复`);
      seenOffsets.add(headerOffset);
      entries.push({ logicalIndex, headerOffset });
    }

    entries.sort((left, right) => left.headerOffset - right.headerOffset);
    const blocks = [];
    for (const entry of entries) {
      const { logicalIndex, headerOffset } = entry;
      const encryptedHeader = read(headerOffset, 16);
      const decrypted = new Uint8Array(16);
      const keyOffset = (logicalIndex % 64) * 16;
      if (family === 'legacy') {
        for (let i = 0; i < 8; i++) decrypted[i] = encryptedHeader[i] ^ LEGACY_IMAGE_KEY[keyOffset + i];
        for (let i = 12; i < 16; i++) decrypted[i] = encryptedHeader[i] ^ LEGACY_IMAGE_KEY[keyOffset + i];
      } else {
        for (let i = 0; i < 16; i++) decrypted[i] = encryptedHeader[i] ^ keys.imageKey[keyOffset + i];
      }

      const imageType = decrypted[0];
      const flags = decrypted[3];
      const width = u16(decrypted, 4);
      const height = u16(decrypted, 6);
      const x = family === 'legacy' ? 0 : i16(decrypted, 8);
      const y = family === 'legacy' ? 0 : i16(decrypted, 10);
      const compressedSize = u32(decrypted, 12);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) {
        throw new Error(`图像 ${logicalIndex} 的尺寸无效：${width}x${height}`);
      }
      const rawSize = rawImageSize(imageType, flags, width, height);
      const payloadSize = compressedSize || rawSize;
      const payloadOffset = headerOffset + 16;
      if (payloadOffset + payloadSize > fileSize) throw new Error(`图像 ${logicalIndex} 的数据越界`);
      if (compressedSize) {
        const zlibHeader = read(payloadOffset, 2);
        const cmf = zlibHeader[0], flg = zlibHeader[1];
        if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) {
          throw new Error(`图像 ${logicalIndex} 的 zlib 头无效`);
        }
      }
      blocks.push({
        logicalIndex, headerOffset, payloadOffset, compressedSize, payloadSize,
        rawSize, imageType, flags, width, height, x, y,
        format: formatName(imageType, flags), family,
      });
    }
    blocks.sort((left, right) => left.logicalIndex - right.logicalIndex);
    return { header: Object.assign({ family }, fields), offsets, blocks };
  }

  function readPayload(bytes, block, inflate) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    let raw;
    if (block.compressedSize) {
      if (typeof inflate !== 'function') throw new Error('zlib inflater is required');
      raw = inflate(bytes.subarray(block.payloadOffset, block.payloadOffset + block.compressedSize));
    } else {
      raw = bytes.slice(block.payloadOffset, block.payloadOffset + block.rawSize);
    }
    if (!(raw instanceof Uint8Array)) raw = new Uint8Array(raw);
    if (raw.length !== block.rawSize) {
      throw new Error(`图像 ${block.logicalIndex} 解压长度 ${raw.length}，预期 ${block.rawSize}`);
    }
    return raw;
  }

  function toRgba(raw, block) {
    if (!(raw instanceof Uint8Array)) raw = new Uint8Array(raw);
    if (raw.length !== block.rawSize) throw new Error('GEE raw image size mismatch');
    const width = block.width, height = block.height;
    const rgba = new Uint8ClampedArray(width * height * 4);
    if (block.imageType === 3) {
      const stride = (width + 3) & ~3;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sourceY = height - 1 - y;
        const palette = raw[sourceY * stride + x] * 4;
        const target = (y * width + x) * 4;
        rgba[target] = A8_PALETTE_BGRA[palette + 2];
        rgba[target + 1] = A8_PALETTE_BGRA[palette + 1];
        rgba[target + 2] = A8_PALETTE_BGRA[palette];
        rgba[target + 3] = A8_PALETTE_BGRA[palette + 3];
      }
      return rgba;
    }
    if (block.imageType === 5) {
      const stride = (width * 2 + 3) & ~3;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sourceY = height - 1 - y;
        const value = u16(raw, sourceY * stride + x * 2);
        const r = (value >> 11) & 31, g = (value >> 5) & 63, b = value & 31;
        const target = (y * width + x) * 4;
        rgba[target] = (r << 3) | (r >> 2);
        rgba[target + 1] = (g << 2) | (g >> 4);
        rgba[target + 2] = (b << 3) | (b >> 2);
        rgba[target + 3] = 255;
      }
      return rgba;
    }
    if (block.imageType === 6) {
      const colorStride = (width * 3 + 3) & ~3;
      const alphaStride = (width + 3) & ~3;
      const alphaOffset = colorStride * height;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sourceY = height - 1 - y;
        const source = sourceY * colorStride + x * 3;
        const target = (y * width + x) * 4;
        rgba[target] = raw[source + 2];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source];
        rgba[target + 3] = block.flags ? raw[alphaOffset + sourceY * alphaStride + x] : 255;
      }
      return rgba;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = ((height - 1 - y) * width + x) * 4;
      const target = (y * width + x) * 4;
      rgba[target] = raw[source + 2];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source];
      rgba[target + 3] = block.flags ? raw[source + 3] : 255;
    }
    return rgba;
  }

  return { PASSWORD, HEADER_SIZE, A8_PALETTE_BGRA, formatName, rawImageSize, parse, parseFromReader, readPayload, toRgba };
});
