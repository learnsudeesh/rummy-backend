import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Player {
  id: string;
  name: string;
  hand: string[];
  hasDrawn: boolean;
}

interface Room {
  players: Player[];
  hostId: string | null;
  deck: string[];
  openPile: string[];
  currentTurnIndex: number;
  gameStarted: boolean;
  suspenseJoker: string | null;
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

  // ================= JOIN =================
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

  // ================= START =================
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

  // ================= DRAW =================
  @SubscribeMessage('drawCard')
  draw(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { from: 'deck' | 'open' },
  ) {
    const player = this.getCurrent();
    if (!player || player.id !== client.id) return;
    if (player.hasDrawn) return;

    if (data.from === 'deck' && this.room.deck.length === 0) this.reshuffle();

    const card =
      data.from === 'deck' ? this.room.deck.pop() : this.room.openPile.pop();

    if (!card) return;

    player.hand.push(card);
    player.hasDrawn = true;

    this.broadcast();
  }

  // ================= DROP =================
  @SubscribeMessage('dropCard')
  drop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { card: string },
  ) {
    const player = this.getCurrent();
    if (!player || player.id !== client.id) return;
    if (!player.hasDrawn) return;

    const i = player.hand.indexOf(data.card);
    if (i === -1) return;

    player.hand.splice(i, 1);
    this.room.openPile.push(data.card);
    player.hasDrawn = false;

    // ✅ If this player unlocked joker and now drops card
    if (this.room.jokerUnlockedBy === client.id) {
      this.server.to(client.id).emit('showJoker', this.room.suspenseJoker);

      // Prevent multiple sends
      this.room.jokerUnlockedBy = null;
    }

    this.nextTurn();
    this.broadcast();
  }

  // ================= SHOW RUMMY =================
  @SubscribeMessage('showRummy')
  show(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { cards: string[] },
  ) {
    const player = this.room.players.find((p) => p.id === client.id);
    if (!player) return;

    if (!data.cards || data.cards.length !== 3) return;

    // Check that selected cards exist in player's hand
    const valid = data.cards.every((card) => player.hand.includes(card));

    if (!valid) return;

    this.room.pendingRummy = {
      playerId: player.id,
      playerName: player.name,
      cards: data.cards,
    };

    // Send ONLY to other players
    client.broadcast.to(this.ROOM).emit('rummyRequest', {
      playerName: player.name,
      cards: data.cards,
    });
  }

  // ================= VERIFY =================
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

    // ✅ Mark raiser as eligible to receive joker AFTER drop
    this.room.jokerUnlockedBy = raiserId;

    // Just inform raiser approval happened
    this.server.to(raiserId).emit('rummyApproved');

    this.room.pendingRummy = null;
  }

  // ================= COMPLETE =================
  @SubscribeMessage('completeGame')
  complete(@ConnectedSocket() client: Socket) {
    if (client.id !== this.room.jokerUnlockedBy) return;

    this.server.to(this.ROOM).emit('gameCompleted', {
      winner: client.id,
      joker: this.room.suspenseJoker,
    });

    this.room.gameStarted = false;
  }

  // ================= HELPERS =================
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
    return {
      players: this.room.players,
      hostId: this.room.hostId,
      currentPlayerId: this.getCurrent()?.id,
      openCard: this.room.openPile[this.room.openPile.length - 1],
      deckCount: this.room.deck.length,
      gameStarted: this.room.gameStarted,
    };
  }

  private reshuffle() {
    const top = this.room.openPile.pop();
    this.room.deck = [...this.room.openPile];
    this.shuffle(this.room.deck);
    this.room.openPile = [top!];
  }

  private createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
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
    const singleDeck = suits.flatMap((s) => values.map((v) => v + s));

    return [...singleDeck, ...singleDeck, ...singleDeck];
  }

  private shuffle(a: string[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  private validateSequence(cards: string[]) {
    const suit = cards[0].slice(-1);
    const map: any = { A: 1, J: 11, Q: 12, K: 13 };

    const nums = cards.map((c) => {
      if (c.slice(-1) !== suit) return -1;
      const v = c.slice(0, -1);
      return map[v] || parseInt(v);
    });

    if (nums.includes(-1)) return false;
    nums.sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++)
      if (nums[i] !== nums[i - 1] + 1) return false;

    return true;
  }
}
