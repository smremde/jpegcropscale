const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { test } = require('node:test');
const { cropTiles, getInfo, jpegtran, ready } = require('../index.js');

const input = fs.readFileSync(path.join(__dirname, 'image.jpg'));

// Every tile of a grid of tileW x tileH, clipped at the right and bottom edges.
function grid(info, tileW, tileH) {
    const regions = [];
    for (let top = 0; top < info.height; top += tileH)
        for (let left = 0; left < info.width; left += tileW)
            regions.push({ left, top, width: Math.min(tileW, info.width - left), height: Math.min(tileH, info.height - top) });
    return regions;
}

test('getInfo reads the header', async () => {
    await ready;
    const info = getInfo(input);
    assert.ok(info.width > 0 && info.height > 0);
    assert.ok([8, 16, 32].includes(info.mcuWidth));
    assert.ok([8, 16, 32].includes(info.mcuHeight));
});

test('cropTiles cuts every tile of a grid with the right sizes', async () => {
    await ready;
    const info = getInfo(input);
    const tile = info.mcuWidth * 4;
    const regions = grid(info, tile, tile);
    const tiles = cropTiles(input, regions);

    assert.equal(tiles.length, regions.length);
    tiles.forEach((t, i) => {
        assert.ok(Buffer.isBuffer(t));
        assert.equal(t[0], 0xff); assert.equal(t[1], 0xd8); // SOI
        const ti = getInfo(t);
        assert.equal(ti.width, regions[i].width, `tile ${i} width`);
        assert.equal(ti.height, regions[i].height, `tile ${i} height`);
        assert.equal(ti.subsampling, info.subsampling);
    });
});

test('cropTiles output matches a single lossless jpegtran crop', async () => {
    await ready;
    const info = getInfo(input);
    const r = { left: info.mcuWidth, top: info.mcuHeight, width: info.mcuWidth * 2, height: info.mcuHeight * 2 };
    const [tile] = cropTiles(input, [r]);
    const single = jpegtran(input, 1, r.left, r.top, r.height, r.width);
    assert.deepEqual(tile, single);
});

test('optimize produces valid, no larger tiles', async () => {
    await ready;
    const info = getInfo(input);
    const regions = grid(info, info.mcuWidth * 4, info.mcuHeight * 4);
    const plain = cropTiles(input, regions);
    const opt = cropTiles(input, regions, { optimize: true });
    const sum = (a) => a.reduce((s, b) => s + b.length, 0);
    assert.ok(sum(opt) <= sum(plain));
    opt.forEach((t, i) => assert.equal(getInfo(t).width, regions[i].width));
});

test('truncated input throws instead of returning a partial image', async () => {
    await ready;
    const truncated = input.subarray(0, Math.floor(input.length / 2));
    const info = getInfo(input);
    assert.throws(() => cropTiles(truncated, [{ left: 0, top: 0, width: info.width, height: info.height }]), /crop_tiles: .+/);
    assert.throws(() => jpegtran(truncated, 1, 0, 0, info.height, info.width), /crop_tiles: .+/);
});

test('unaligned and out-of-bounds regions throw descriptive errors', async () => {
    await ready;
    const info = getInfo(input);
    if (info.mcuWidth > 8) {
        assert.throws(() => cropTiles(input, [{ left: 8, top: 0, width: 16, height: 16 }]), /multiple of/);
    }
    assert.throws(() => cropTiles(input, [{ left: 0, top: 0, width: info.width + info.mcuWidth, height: 16 }]), /region 0 .* exceeds/);
    assert.throws(() => cropTiles(input, [
        { left: 0, top: 0, width: 16, height: 16 },
        { left: info.width - 16, top: 0, width: 64, height: 16 },
    ]), /region 1 .* exceeds/);
});

test('invalid arguments throw', async () => {
    await ready;
    assert.throws(() => cropTiles(input, []), /non-empty/);
    assert.throws(() => cropTiles(input, [{ left: -16, top: 0, width: 16, height: 16 }]), /Invalid region at index 0/);
    assert.throws(() => cropTiles(input, [{ left: 0, top: 0, width: 0, height: 16 }]), /Invalid region/);
    assert.throws(() => cropTiles(Buffer.alloc(0), [{ left: 0, top: 0, width: 16, height: 16 }]), /Invalid input/);
    assert.throws(() => cropTiles(Buffer.from('not a jpeg'), [{ left: 0, top: 0, width: 16, height: 16 }]), /crop_tiles: .+/);
    assert.throws(() => getInfo(Buffer.from('not a jpeg')), /jpeg_info: .+/);
});

test('repeated calls do not leak WASM memory', async () => {
    await ready;
    const info = getInfo(input);
    const regions = grid(info, info.mcuWidth * 4, info.mcuHeight * 4);
    const heap = () => require('../dist/node/jpeg_worker.js').HEAPU8.length;
    for (let i = 0; i < 20; i++) cropTiles(input, regions);
    const before = heap();
    for (let i = 0; i < 300; i++) {
        cropTiles(input, regions);
        try { cropTiles(input.subarray(0, 1000), regions); } catch { /* expected */ }
    }
    assert.equal(heap(), before);
});
