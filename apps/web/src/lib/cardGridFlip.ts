import type { LayoutFlipOptions } from "./useLayoutFlip";

/**
 * `useLayoutFlip` settings shared by the three card grids (Clients
 * overview, Build → Planning, Build → Projects), so a search, filter or
 * sort moves cards the same way on each.
 *
 * - `maxMoves` is one page of cards (the Build grids page by 24): a
 *   change that would send more than that gliding at once is a wholesale
 *   re-sort, which reads as noise — it just lands.
 * - `onlyWhenKeysChange`: only a change to *which* cards are shown, or
 *   their order, moves anything. Late data filling the cards in after
 *   first load (task counts, checklist progress) can grow a row; that
 *   just lands, as it always did.
 * - `clampToViewport`: a card arriving from below the fold (a filter can
 *   pull one up from several screens down) slides in from the viewport
 *   edge instead of covering the whole distance in 200ms.
 * - A card that wasn't in the results before fades in, opacity only, so
 *   it never pops into the gap the others are opening for it. The hook
 *   runs it on the move's own 200ms ease-out clock; holding full opacity
 *   from 90% of that eased progress lands the fade at about 125ms — inside
 *   `--duration-fast`. Nothing slides or scales, and it never plays on
 *   first load.
 */
export const CARD_GRID_FLIP: LayoutFlipOptions = {
  maxMoves: 24,
  onlyWhenKeysChange: true,
  clampToViewport: true,
  enter: [{ opacity: 0 }, { opacity: 1, offset: 0.9 }, { opacity: 1 }],
};
