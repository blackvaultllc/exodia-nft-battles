// ═════════════════════════════════════════════════════════════════════════════
// XOVIA DUEL ENGINE — Full Yu-Gi-Oh rule matrix, pure & framework-free.
// Phase state machine, standard zone layout, battle math, chain resolution.
// No React here: this is a pure state machine the UI layers render from.
// ═════════════════════════════════════════════════════════════════════════════
import type { Card } from "@/data/cards";
import { levelOf } from "@/data/cards";

// Re-export for route consumers.
export { levelOf };

// ── Phase matrix ───────────────────────────────────────────────────────────
export const DUEL_PHASES = ["Draw", "Standby", "Main1", "Battle", "Main2", "End"] as const;
export type DuelPhase = (typeof DUEL_PHASES)[number];

export const PHASE_META: Record<DuelPhase, { label: string; hint: string; accent: string }> = {
  Draw: { label: "Draw Phase", hint: "Draw 1 card from your Deck.", accent: "gold" },
  Standby: {
    label: "Standby Phase",
    hint: "Resolve maintenance costs & effects.",
    accent: "accent",
  },
  Main1: { label: "Main Phase 1", hint: "Summon, Set, activate Spells & Traps.", accent: "teal" },
  Battle: { label: "Battle Phase", hint: "Declare attacks with your monsters.", accent: "crimson" },
  Main2: { label: "Main Phase 2", hint: "Set cards; no Normal Summon/Position.", accent: "teal" },
  End: { label: "End Phase", hint: "Hand limit 7. Pass the turn.", accent: "purple" },
};

const PHASE_ORDER: Record<DuelPhase, number> = {
  Draw: 0,
  Standby: 1,
  Main1: 2,
  Battle: 3,
  Main2: 4,
  End: 5,
};

// ── Zone matrix ────────────────────────────────────────────────────────────
export const MONSTER_ZONES = 5;
export const SPELL_TRAP_ZONES = 5;

export type BattlePosition = "ATK" | "DEF";
export type FaceState = "face-up" | "face-down";

export interface FieldCard {
  card: Card;
  position: BattlePosition;
  face: FaceState;
  /** Has this monster already attacked this Battle Phase? */
  hasAttacked: boolean;
  /** Turn count the card has been on the field (Set monsters cannot flip the turn they're set). */
  setTurn: number;
  /** Position was manually changed this turn (one position change per turn). */
  positionChangedThisTurn: boolean;
}

export type Graveyard = Card[];
export type Banished = Card[];
export type ExtraDeckEntry = Card[];

export interface DuelistState {
  name: string;
  lp: number;
  hand: Card[];
  /** 5 Monster Zones, null = empty */
  monsters: (FieldCard | null)[];
  /** 5 Spell & Trap Zones, null = empty */
  spellTraps: (FieldCard | null)[];
  graveyard: Graveyard;
  banished: Banished;
  extraDeck: ExtraDeckEntry;
  deck: Card[];
  normalSummonsUsed: number;
}

export interface ChainLink {
  id: number;
  card: Card;
  owner: "you" | "opp";
  /** What the chain is responding to. */
  trigger: string;
  resolved: boolean;
}

export interface DuelState {
  turn: "you" | "opp";
  turnCount: number;
  phase: DuelPhase;
  you: DuelistState;
  opp: DuelistState;
  /** Active chain stack — last element is the most recent link (resolves first). */
  chain: ChainLink[];
  /** Card from the Heavens: attacks sealed for N more rounds. */
  heavensRoundsLeft: number;
  log: string[];
  winner: "you" | "opp" | "draw" | null;
}

// ── Factories ──────────────────────────────────────────────────────────────
export function emptyDuelist(name: string, deck: Card[] = []): DuelistState {
  return {
    name,
    lp: 8000,
    hand: [],
    monsters: Array(MONSTER_ZONES).fill(null),
    spellTraps: Array(SPELL_TRAP_ZONES).fill(null),
    graveyard: [],
    banished: [],
    extraDeck: [],
    deck,
    normalSummonsUsed: 0,
  };
}

export function createDuel(
  youName: string,
  oppName: string,
  youDeck: Card[],
  oppDeck: Card[],
): DuelState {
  return {
    turn: "you",
    turnCount: 1,
    phase: "Draw",
    you: emptyDuelist(youName, youDeck),
    opp: emptyDuelist(oppName, oppDeck),
    chain: [],
    heavensRoundsLeft: 0,
    log: ["The sands are still. The duel begins."],
    winner: null,
  };
}

// ── Pure helpers ───────────────────────────────────────────────────────────
export function isMonster(c: Card): boolean {
  return c.type !== "Spell" && c.type !== "Trap" && c.type !== "Field" && c.type !== "Seal";
}
export function isSpellOrTrap(c: Card): boolean {
  return !isMonster(c);
}
export function tributesRequired(card: Card): number {
  const lv = levelOf(card);
  if (lv >= 7) return 2;
  if (lv >= 5) return 1;
  return 0;
}
export function faceCard(fieldCard: FieldCard | null): Card | null {
  return fieldCard?.card ?? null;
}

function log(state: DuelState, line: string): DuelState {
  return { ...state, log: [line, ...state.log].slice(0, 120) };
}

// ── Phase transitions (the state machine) ──────────────────────────────────
export type DuelAction =
  | { type: "ADVANCE_PHASE" }
  | { type: "DRAW"; who: "you" | "opp" }
  | {
      type: "SUMMON_MONSTER";
      who: "you" | "opp";
      card: Card;
      slot: number;
      position: BattlePosition;
      face: FaceState;
      tributeSlots: number[];
    }
  | { type: "SET_SPELL_TRAP"; who: "you" | "opp"; card: Card; slot: number; faceDown: boolean }
  | { type: "DECLARE_ATTACK"; who: "you" | "opp"; attackerSlot: number; targetSlot: number | null }
  | { type: "CHANGE_POSITION"; who: "you" | "opp"; slot: number }
  | { type: "SEND_TO_GRAVE"; who: "you" | "opp"; zone: "monster" | "spellTrap"; slot: number }
  | { type: "BANISH"; who: "you" | "opp"; from: "graveyard"; index: number }
  | { type: "TRIGGER_CHAIN"; who: "you" | "opp"; card: Card; trigger: string }
  | { type: "RESOLVE_CHAIN" };

function sideOf(state: DuelState, who: "you" | "opp"): DuelistState {
  return who === "you" ? state.you : state.opp;
}
function foeOf(state: DuelState, who: "you" | "opp"): DuelistState {
  return who === "you" ? state.opp : state.you;
}
function withSide(state: DuelState, who: "you" | "opp", side: DuelistState): DuelState {
  return who === "you" ? { ...state, you: side } : { ...state, opp: side };
}

/** Normal summon/set limit: 1 per turn. Main Phase 2 forbids new summons. */
export function canNormalSummon(state: DuelState, who: "you" | "opp"): boolean {
  if (state.phase !== "Main1" && state.phase !== "Main2") return false;
  if (state.phase === "Main2") return false;
  return sideOf(state, who).normalSummonsUsed < 1;
}

export function canEnterBattlePhase(state: DuelState): boolean {
  return state.phase === "Main1" || state.phase === "Battle" || state.phase === "Main2";
}

/** Apply one action; returns the next immutable state. */
export function reduceDuel(state: DuelState, action: DuelAction): DuelState {
  switch (action.type) {
    case "ADVANCE_PHASE": {
      const idx = PHASE_ORDER[state.phase];
      if (idx >= PHASE_ORDER.End) {
        // End Phase → pass turn to the other duelist; reset per-turn flags.
        const nextTurn = state.turn === "you" ? "opp" : "you";
        const resetSide = (s: DuelistState): DuelistState => ({
          ...s,
          normalSummonsUsed: 0,
          monsters: s.monsters.map((m) =>
            m ? { ...m, hasAttacked: false, positionChangedThisTurn: false } : null,
          ),
        });
        const heavens = Math.max(0, state.heavensRoundsLeft - 1);
        const turnCount = nextTurn === "you" ? state.turnCount + 1 : state.turnCount;
        return log(
          {
            ...state,
            turn: nextTurn,
            turnCount,
            phase: "Draw",
            heavensRoundsLeft: heavens,
            you: resetSide(state.you),
            opp: resetSide(state.opp),
          },
          `— ${sideOf(state, state.turn).name} ends their turn. ${sideOf(state, nextTurn).name}: Draw Phase.`,
        );
      }
      const next = DUEL_PHASES[idx + 1];
      return log({ ...state, phase: next }, `— Phase: ${PHASE_META[next].label}.`);
    }

    case "DRAW": {
      const side = sideOf(state, action.who);
      const foe = foeOf(state, action.who);
      if (side.deck.length === 0) {
        return log(
          { ...state, winner: action.who === "you" ? "opp" : "you" },
          `${side.name} cannot draw — deck out. Duel over.`,
        );
      }
      const [drawn, ...rest] = side.deck;
      return log(
        withSide(state, action.who, {
          ...side,
          deck: rest,
          hand: [...side.hand, drawn],
        }),
        `${side.name} draws ${drawn.name} (${foe.name} deck: ${foe.deck.length}).`,
      );
    }

    case "SUMMON_MONSTER": {
      const side = sideOf(state, action.who);
      if (!canNormalSummon(state, action.who)) return log(state, "Illegal summon attempt.");
      const monsters = [...side.monsters];
      const grave = [...side.graveyard];
      for (const ti of action.tributeSlots) {
        const t = monsters[ti];
        if (t) {
          grave.push(t.card);
          monsters[ti] = null;
        }
      }
      monsters[action.slot] = {
        card: action.card,
        position: action.position,
        face: action.face,
        hasAttacked: false,
        setTurn: state.turnCount,
        positionChangedThisTurn: false,
      };
      const summoned = withSide(state, action.who, {
        ...side,
        monsters,
        graveyard: grave,
        hand: side.hand.filter((h) => h.id !== action.card.id),
        normalSummonsUsed: side.normalSummonsUsed + 1,
      });
      const posText =
        action.face === "face-down" ? `Set in defense` : `Summoned in ${action.position}`;
      return log(
        summoned,
        `${side.name} ${posText}: ${action.card.name} [Lv${levelOf(action.card)}]${action.tributeSlots.length ? ` (tribute ×${action.tributeSlots.length})` : ""}.`,
      );
    }

    case "SET_SPELL_TRAP": {
      const side = sideOf(state, action.who);
      const st = [...side.spellTraps];
      st[action.slot] = {
        card: action.card,
        position: "DEF",
        face: action.faceDown ? "face-down" : "face-up",
        hasAttacked: false,
        setTurn: state.turnCount,
        positionChangedThisTurn: false,
      };
      return log(
        withSide(state, action.who, {
          ...side,
          spellTraps: st,
          hand: side.hand.filter((h) => h.id !== action.card.id),
        }),
        `${side.name} ${action.faceDown ? "sets" : "activates"} ${action.card.name}.`,
      );
    }

    case "DECLARE_ATTACK": {
      if (state.phase !== "Battle")
        return log(state, "Attacks may only be declared in the Battle Phase.");
      if (state.heavensRoundsLeft > 0)
        return log(
          state,
          `The Card from the Heavens seals all attacks (${state.heavensRoundsLeft} rounds remain).`,
        );
      const attackerSide = sideOf(state, action.who);
      const foe = foeOf(state, action.who);
      const attackerFc = attackerSide.monsters[action.attackerSlot];
      if (
        !attackerFc ||
        attackerFc.face === "face-down" ||
        attackerFc.hasAttacked ||
        attackerFc.position !== "ATK"
      ) {
        return log(state, "That monster cannot attack.");
      }
      const attacker = attackerFc.card;
      // Mark attacked.
      const monsters = [...attackerSide.monsters];
      monsters[action.attackerSlot] = { ...attackerFc, hasAttacked: true };
      let next = withSide(state, action.who, { ...attackerSide, monsters });

      if (action.targetSlot === null || foe.monsters.every((m) => !m)) {
        // Direct attack.
        next = withSide(next, action.who === "you" ? "opp" : "you", {
          ...foe,
          lp: Math.max(0, foe.lp - attacker.atk),
        });
        return log(next, `${attacker.name} attacks directly for ${attacker.atk}!`);
      }
      const targetFc = foe.monsters[action.targetSlot]!;
      const target = targetFc.card;
      const targetPower = targetFc.position === "ATK" ? target.atk : target.def;
      const diff = attacker.atk - targetPower;
      if (diff > 0) {
        const foeMonsters = [...foe.monsters];
        const fallen = foeMonsters[action.targetSlot]!;
        foeMonsters[action.targetSlot] = null;
        next = withSide(next, action.who === "you" ? "opp" : "you", {
          ...foe,
          monsters: foeMonsters,
          graveyard: [...foe.graveyard, fallen.card],
          lp: Math.max(0, foe.lp - (targetFc.position === "ATK" ? diff : 0)),
        });
        return log(
          next,
          `${attacker.name} destroys ${target.name} (+${diff} piercing damage${targetFc.position === "ATK" ? "" : " blocked by defense"}).`,
        );
      }
      if (diff === 0) {
        const aMonsters = [...attackerSide.monsters];
        const fMonsters = [...foe.monsters];
        aMonsters[action.attackerSlot] = null;
        fMonsters[action.targetSlot] = null;
        next = withSide(next, action.who, {
          ...attackerSide,
          monsters: aMonsters,
          graveyard: [...attackerSide.graveyard, attacker],
        });
        next = withSide(next, action.who === "you" ? "opp" : "you", {
          ...foe,
          monsters: fMonsters,
          graveyard: [...foe.graveyard, target],
        });
        return log(next, `${attacker.name} and ${target.name} destroy each other — mutual ruin.`);
      }
      // diff < 0: attacker's controller takes the difference.
      next = withSide(next, action.who, {
        ...attackerSide,
        lp: Math.max(0, attackerSide.lp - Math.abs(diff)),
      });
      return log(
        next,
        `${target.name} repels ${attacker.name}. ${sideOf(next, action.who).name} takes ${Math.abs(diff)} damage.`,
      );
    }

    case "CHANGE_POSITION": {
      const side = sideOf(state, action.who);
      const fc = side.monsters[action.slot];
      if (!fc || fc.positionChangedThisTurn || fc.setTurn === state.turnCount)
        return log(state, "Position cannot be changed this turn.");
      const monsters = [...side.monsters];
      monsters[action.slot] = {
        ...fc,
        position: fc.position === "ATK" ? "DEF" : "ATK",
        face: fc.face === "face-down" ? "face-up" : fc.face,
        positionChangedThisTurn: true,
      };
      return log(
        withSide(state, action.who, { ...side, monsters }),
        `${fc.card.name} switches to ${monsters[action.slot]!.position}.`,
      );
    }

    case "SEND_TO_GRAVE": {
      const side = sideOf(state, action.who);
      const zone = action.zone === "monster" ? [...side.monsters] : [...side.spellTraps];
      const fc = zone[action.slot];
      if (!fc) return state;
      zone[action.slot] = null;
      const updated = {
        ...side,
        [action.zone === "monster" ? "monsters" : "spellTraps"]: zone,
        graveyard: [...side.graveyard, fc.card],
      } as DuelistState;
      return log(withSide(state, action.who, updated), `${fc.card.name} is sent to the Graveyard.`);
    }

    case "BANISH": {
      const side = sideOf(state, action.who);
      if (!side.graveyard[action.index]) return state;
      const grave = [...side.graveyard];
      const [banishedCard] = grave.splice(action.index, 1);
      return log(
        withSide(state, action.who, {
          ...side,
          graveyard: grave,
          banished: [...side.banished, banishedCard],
        }),
        `${banishedCard.name} is removed from play.`,
      );
    }

    case "TRIGGER_CHAIN": {
      const link: ChainLink = {
        id: state.chain.length + Date.now(),
        card: action.card,
        owner: action.who,
        trigger: action.trigger,
        resolved: false,
      };
      return log(
        { ...state, chain: [...state.chain, link] },
        `⛓ Chain Link ${state.chain.length + 1}: ${action.card.name} (${action.trigger}).`,
      );
    }

    case "RESOLVE_CHAIN": {
      if (state.chain.length === 0) return state;
      // Resolve from the top of the stack (last link first).
      const chainSnapshot: ChainLink[] = [...state.chain];
      const ordered = [...chainSnapshot].reverse();
      let next: DuelState = state;
      for (const link of ordered) {
        next = log(
          { ...next, chain: next.chain.filter((l) => l.id !== link.id) },
          `⛓ Resolved: ${link.card.name} (Chain Link ${chainSnapshot.indexOf(link) + 1}).`,
        );
      }
      return next;
    }

    default:
      return state;
  }
}
