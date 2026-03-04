// deck.ts

export type Suit = '♠' | '♥' | '♦' | '♣';

export type CardValue =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'JOKER';

export interface Card {
  suit?: Suit; // Joker will not have suit
  value: CardValue;
  isJoker?: boolean;
}

/**
 * Create a single 54-card deck (52 + 2 Jokers)
 */
export const createDeck = (): Card[] => {
  const suits: Suit[] = ['♠', '♥', '♦', '♣'];
  const values: CardValue[] = [
    'A',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    'J',
    'Q',
    'K',
  ];

  const deck: Card[] = [];

  // Create 52 standard cards
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }

  // Add 2 Jokers
  deck.push({ value: 'JOKER', isJoker: true });
  deck.push({ value: 'JOKER', isJoker: true });

  return deck;
};

/**
 * Create multiple decks (e.g., 3 decks for 4-player Rummy)
 */
export const createMultipleDecks = (count: number): Card[] => {
  let fullDeck: Card[] = [];

  for (let i = 0; i < count; i++) {
    fullDeck = fullDeck.concat(createDeck());
  }

  return fullDeck;
};

/**
 * Fisher-Yates Shuffle (Fair shuffle)
 */
export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
};

/**
 * Helper to create and shuffle decks together
 */
export const createAndShuffleDecks = (deckCount: number): Card[] => {
  const deck = createMultipleDecks(deckCount);
  return shuffleDeck(deck);
};
