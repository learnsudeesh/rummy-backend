import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/* ================= CARD ================= */

interface Card {
  id: string; // A_♠_1
  value: string; // A
  suit: string; // ♠
}

/* ================= PLAYER ================= */

interface Player {
  id: string;
  name: string;
  hand: Card[];
  hasDrawn: boolean;
}

/* ================= ROOM ================= */

interface Room {
  players: Player[];
  hostId: string | null;
  deck: Card[];
  openPile: Card[];
  currentTurnIndex: number;
  gameStarted: boolean;
  suspenseJoker: Card | null;
  pendingRummy: any;
  jokerUnlockedBy: string | null;
}

@WebSocketGateway({ cors: true })
export class GameGateway {
  @WebSocketServer() server: Server;

  private ROOM = 'rummy-room';

  private room: Room = {
    players: [],
    hostId: null,
    deck: [],
    openPile: [],
    currentTurnIndex: 0,
    gameStarted: false,
    suspenseJoker: null,
    pendingRummy: null,
    jokerUnlockedBy: null,
  };

  /* ================= JOIN ================= */

  @SubscribeMessage('joinGame')
  join(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string },
  ) {
    const existing = this.room.players.find((p) => p.name === data.name);

    if (existing) {
      existing.id = client.id;
      client.join(this.ROOM);
      client.emit('gameState', this.getState());
      return;
    }

    if (this.room.gameStarted) return;

    const player: Player = {
      id: client.id,
      name: data.name,
      hand: [],
      hasDrawn: false,
    };

    this.room.players.push(player);

    if (!this.room.hostId) this.room.hostId = client.id;

    client.join(this.ROOM);
    this.broadcast();
  }

  /* ================= START ================= */

  @SubscribeMessage('startGame')
  start(@ConnectedSocket() client: Socket) {
    if (client.id !== this.room.hostId) return;
    if (this.room.players.length < 2) return;

    this.room.deck = this.createDeck();
    this.shuffle(this.room.deck);

    this.room.players.forEach((p) => {
      p.hand = this.room.deck.splice(0, 13);
      p.hasDrawn = false;
    });

    this.room.openPile = [this.room.deck.pop()!];
    this.room.currentTurnIndex = 0;
    this.room.gameStarted = true;

    this.room.suspenseJoker =
      this.room.deck[Math.floor(Math.random() * this.room.deck.length)];

    this.room.jokerUnlockedBy = null;

    this.broadcast();
  }

  /* ================= DRAW ================= */

  @SubscribeMessage('drawCard')
  draw(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { from: 'deck' | 'open' },
  ) {
    const player = this.getCurrent();
    if (!player || player.id !== client.id) return;
    if (player.hasDrawn) return;

    if (data.from === 'deck' && this.room.deck.length === 0) {
      this.reshuffle();
    }

    const card =
      data.from === 'deck' ? this.room.deck.pop() : this.room.openPile.pop();

    if (!card) return;

    player.hand.push(card);
    player.hasDrawn = true;

    this.broadcast();
  }

  /* ================= DROP ================= */

  @SubscribeMessage('dropCard')
  drop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { cardId: string },
  ) {
    const player = this.getCurrent();
    if (!player || player.id !== client.id) return;
    if (!player.hasDrawn) return;

    const index = player.hand.findIndex((c) => c.id === data.cardId);
    if (index === -1) return;

    const droppedCard = player.hand.splice(index, 1)[0];
    this.room.openPile.push(droppedCard);
    player.hasDrawn = false;

    if (this.room.jokerUnlockedBy === client.id) {
      this.server.to(client.id).emit('showJoker', this.room.suspenseJoker);
      this.room.jokerUnlockedBy = null;
    }

    this.nextTurn();
    this.broadcast();
  }

  /* ================= SHOW RUMMY ================= */

  @SubscribeMessage('showRummy')
  show(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { cardIds: string[] },
  ) {
    const player = this.room.players.find((p) => p.id === client.id);
    if (!player) return;
    if (!data.cardIds || data.cardIds.length !== 3) return;

    const valid = data.cardIds.every((id) =>
      player.hand.some((c) => c.id === id),
    );

    if (!valid) return;

    const selectedCards = player.hand.filter((c) =>
      data.cardIds.includes(c.id),
    );

    this.room.pendingRummy = {
      playerId: player.id,
      playerName: player.name,
      cards: selectedCards,
    };

    client.broadcast.to(this.ROOM).emit('rummyRequest', {
      playerName: player.name,
      cards: selectedCards,
    });
  }

  /* ================= VERIFY ================= */

  @SubscribeMessage('verifyRummy')
  verify(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { approve: boolean },
  ) {
    if (!this.room.pendingRummy) return;

    const raiserId = this.room.pendingRummy.playerId;

    if (!data.approve) {
      this.server.to(raiserId).emit('rummyRejected');
      this.room.pendingRummy = null;
      return;
    }

    this.room.jokerUnlockedBy = raiserId;
    this.server.to(raiserId).emit('rummyApproved');

    this.room.pendingRummy = null;
  }

  /* ================= COMPLETE ================= */

  @SubscribeMessage('completeGame')
  complete(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { screenshot: string },
  ) {
    // Find winner player
    const winnerPlayer = this.room.players.find((p) => p.id === client.id);

    if (!winnerPlayer) return;

    this.server.to(this.ROOM).emit('gameCompleted', {
      winnerId: client.id,
      winnerName: winnerPlayer.name, // ✅ added
      joker: this.room.suspenseJoker,
      screenshot: data?.screenshot || null,
    });

    this.room.gameStarted = false;
  }
  /* ================= RESET ================= */

  @SubscribeMessage('restartServer')
  restartServer(@ConnectedSocket() client: Socket) {
    if (client.id !== this.room.hostId) return;

    this.server.to(this.ROOM).emit('serverRestarted');
    this.resetEntireRoom();
  }

  /* ================= HELPERS ================= */

  private getCurrent() {
    return this.room.players[this.room.currentTurnIndex];
  }

  private nextTurn() {
    this.room.currentTurnIndex =
      (this.room.currentTurnIndex + 1) % this.room.players.length;
  }

  private broadcast() {
    this.server.to(this.ROOM).emit('gameState', this.getState());
  }

  private getState() {
    const current = this.getCurrent();

    return {
      players: this.room.players,
      hostId: this.room.hostId,
      currentPlayerId: this.getCurrent()?.id,
      openCard: this.room.openPile[this.room.openPile.length - 1],
      deckCount: this.room.deck.length,
      gameStarted: this.room.gameStarted,
      currentPlayerName: current?.name,
    };
  }

  private resetEntireRoom() {
    this.room = {
      players: [],
      hostId: null,
      deck: [],
      openPile: [],
      currentTurnIndex: 0,
      gameStarted: false,
      suspenseJoker: null,
      pendingRummy: null,
      jokerUnlockedBy: null,
    };
  }

  private reshuffle() {
    const top = this.room.openPile.pop();
    if (!top) return;

    this.room.deck = [...this.room.openPile];
    this.shuffle(this.room.deck);
    this.room.openPile = [top];
  }

  private createDeck(): Card[] {
    const suits = ['♤', '♥', '♦', '♧'];
    const values = [
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

    for (let deckNumber = 1; deckNumber <= 3; deckNumber++) {
      // Normal cards
      for (const suit of suits) {
        for (const value of values) {
          deck.push({
            id: `${value}${suit}_${deckNumber}`,
            value,
            suit,
          });
        }
      }

      // ✅ Add Jokers with symbol
      deck.push({
        id: `JOKER_RED_${deckNumber}`,
        value: '🃏',
        suit: '',
      });

      deck.push({
        id: `JOKER_BLACK_${deckNumber}`,
        value: '🃏',
        suit: '',
      });
    }

    return deck;
  }

  private shuffle(array: Card[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
