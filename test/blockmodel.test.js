import { describe, expect, it } from 'vitest';
import { bakeState, boxGeometry, tintFor } from '../src/blockmodel.js';

const cube = { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#all', cullface: 'north' }, up: { texture: '#all', cullface: 'up', tintindex: 0 } } }], textures: { all: 'minecraft:block/stone', particle: 'minecraft:block/stone' } };
const plate = { elements: [{ from: [4, 0, 4], to: [12, 2, 12], faces: { down: { texture: '#all' } } }], textures: { all: 'minecraft:block/lever_base' } };

describe('block model baking', () => {
  it('maps default UVs and resolves texture variables', () => {
    const g = bakeState({ parts: [{ model: 'm:cube', x: 0, y: 0, uvlock: false }] }, { 'm:cube': cube });
    expect(g.modelled).toBe(true);
    expect(g.full).toBe(true);
    expect(g.particle).toBe('minecraft:block/stone');
    const north = g.faces[0];
    expect(north.texture).toBe('minecraft:block/stone');
    expect(north.uv).toEqual([[0, 0], [16, 0], [16, 16], [0, 16]]);
    expect(north.verts).toEqual([[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]]);
    expect(north.cull).toEqual([0, 0, -1]);
    expect(north.shade).toBe(0.8);
    expect(g.faces[1].tint).toBe(0);
  });

  it('turns the model and its cull faces with the blockstate y rotation', () => {
    const g = bakeState({ parts: [{ model: 'm:cube', x: 0, y: 90, uvlock: false }] }, { 'm:cube': cube });
    expect(g.faces[0].cull).toEqual([1, 0, 0]);
    expect(g.faces[0].shade).toBe(0.6);
    expect(g.faces[1].cull).toEqual([0, 1, 0]);
  });

  it('puts a floor model against the south wall for x=90, as wall levers facing north are', () => {
    const g = bakeState({ parts: [{ model: 'm:plate', x: 90, y: 0, uvlock: false }] }, { 'm:plate': plate });
    expect(g.boxes[0]).toEqual([0.25, 0.25, 0.875, 0.75, 0.75, 1]);
    expect(g.full).toBe(false);
  });

  it('rotates face UVs clockwise and element geometry about its origin', () => {
    const turned = { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#a', uv: [0, 0, 8, 8], rotation: 90 } } }], textures: { a: 'x:a' } };
    expect(bakeState({ parts: [{ model: 'm', x: 0, y: 0 }] }, { m: turned }).faces[0].uv).toEqual([[0, 8], [0, 0], [8, 0], [8, 8]]);
    const tilted = { elements: [{ from: [0, 8, 8], to: [16, 8, 8], rotation: { angle: 45, axis: 'x', origin: [8, 8, 8], rescale: true }, faces: { up: { texture: '#a' } } }], textures: { a: 'x:a' } };
    const v = bakeState({ parts: [{ model: 'm', x: 0, y: 0 }] }, { m: tilted }).faces[0].verts;
    expect(v.every((p) => Math.abs(p[1] - 0.5) < 1e-6 && Math.abs(p[2] - 0.5) < 1e-6)).toBe(true);
  });

  it('skips missing models and builds box geometry for blocks drawn in code', () => {
    expect(bakeState({ parts: [{ model: 'm:none', x: 0, y: 0 }] }, {}).modelled).toBe(false);
    const g = boxGeometry([[0, 0, 0, 1, 0.5, 1]], 'minecraft:block/oak_planks', false);
    expect(g.faces).toHaveLength(6);
    expect(g.faces.every((f) => f.texture === 'minecraft:block/oak_planks' && f.cull === null)).toBe(true);
    expect(g.faces.find((f) => f.verts.every((p) => p[1] === 0.5)).uv).toEqual([[0, 0], [16, 0], [16, 16], [0, 16]]);
  });

  it('tints grass, foliage, water and redstone', () => {
    expect(tintFor('minecraft:grass_block')).toEqual([0.47, 0.75, 0.35]);
    expect(tintFor('minecraft:oak_leaves')).toEqual([0.35, 0.68, 0.19]);
    expect(tintFor('minecraft:water')).toEqual([0.25, 0.46, 0.89]);
    expect(tintFor('minecraft:redstone_wire', { power: '15' })).toEqual([1, 0, 0]);
  });
});
