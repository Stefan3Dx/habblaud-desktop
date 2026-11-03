import { describe, expect, it } from 'vitest';
import { FURNITURE } from './api';
import { FARM_KINDS, renderFarmFurniture } from './farm';

describe('tema fazenda', () => {
  it('cada móvel trocado tem desenho, em todas as variantes e com sementes diferentes', () => {
    for (const kind of FARM_KINDS) {
      const variants = FURNITURE[kind].variants ?? [undefined];
      for (const variant of variants) {
        for (const seed of [0, 1, 2, 3, 7, 123456]) {
          const f = renderFarmFurniture(kind, variant, seed);
          expect(f, `${kind}/${variant}/${seed}`).not.toBeNull();
          expect(f!.base.buf.data.some((v, i) => i % 4 === 3 && v > 0), `${kind} vazio`).toBe(true);
          expect(f!.front).toBeUndefined();
        }
      }
    }
  });

  it('copa, banheiro e recepção ficam como estão', () => {
    for (const kind of ['coffee_machine', 'toilet_stall', 'reception_desk', 'arcade', 'fridge'] as const) expect(renderFarmFurniture(kind, undefined, 1)).toBeNull();
  });
});
