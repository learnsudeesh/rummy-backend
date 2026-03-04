export type Suit = '1' | '2' | '3' | '4';

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
  suit?: Suit;
  value: CardValue;
  isJoker?: boolean;
}

export const createDeck = (): Card[] => {
  const suits: Suit[] = ['1', '2', '3', '4'];
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

  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }

  deck.push({ value: 'JOKER', isJoker: true });
  deck.push({ value: 'JOKER', isJoker: true });

  return deck;
};

export const createMultipleDecks = (count: number): Card[] => {
  let fullDeck: Card[] = [];
  for (let i = 0; i < count; i++) {
    fullDeck = fullDeck.concat(createDeck());
  }
  return fullDeck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const createAndShuffleDecks = (count: number) => {
  return shuffleDeck(createMultipleDecks(count));
};
