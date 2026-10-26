// ═══
// EXODIA NFT BATTLES — TCG DECK VALIDATION LOGIC GATEWAY
// Pure, framework-free validators enforcing card-quantity rules inside every
// deck state update. Max 3 identical copies per deck; total bound 40–60.
// ═══

/** Maximum identical copies of a single card allowed in one deck. */
export const MAX_COPIES_PER_CARD = 3;
/** Inclusive deck size bounds. */
export const DECK_MIN_SIZE = 40;
export const DECK_MAX_SIZE = 60;

export interface DeckValidationResult {
  ok: boolean;
  /** Human-readable problems, empty when ok. */
  errors: string[];
  /** Total card count in the deck. */
  total: number;
}

/**
 * Validate a deck represented as card ids (duplicates = copies).
 * Exodia relics and other unique/signature cards should never exceed 1 copy
 * in practice — callers may pass `uniqueIds` to enforce singleton copies.
 */
export function validateDeck(
  cardIds: readonly string[],
  uniqueIds: readonly string[] = [],
): DeckValidationResult {
  const errors: string[] = [];
  const total = cardIds.length;

  if (total < DECK_MIN_SIZE || total > DECK_MAX_SIZE) {
    errors.push(
      `Deck must contain between ${DECK_MIN_SIZE} and ${DECK_MAX_SIZE} cards (currently ${total}).`,
    );
  }

  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  for (const [id, n] of counts) {
    if (n > MAX_COPIES_PER_CARD) {
      errors.push(
        `Card "${id}" exceeds the max of ${MAX_COPIES_PER_CARD} identical copies (has ${n}).`,
      );
    }
  }

  for (const id of uniqueIds) {
    if ((counts.get(id) ?? 0) > 1) {
      errors.push(`Card "${id}" is unique and may appear only once in a deck.`);
    }
  }

  return { ok: errors.length === 0, errors, total };
}

/**
 * Guard a single "add card" state update. Returns false when adding one more
 * copy of `cardId` would break the quantity rules.
 */
export function canAddCard(currentCardIds: readonly string[], cardId: string): boolean {
  const sameCopies = currentCardIds.filter((id) => id === cardId).length;
  if (sameCopies + 1 > MAX_COPIES_PER_CARD) return false;
  if (currentCardIds.length + 1 > DECK_MAX_SIZE) return false;
  return true;
}
