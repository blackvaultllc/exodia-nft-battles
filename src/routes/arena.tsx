import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CARDS, type Card } from "@/data/cards";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArenaLobby } from "@/components/ArenaLobby";
import {
  DUEL_PHASES,
  PHASE_META,
  type DuelPhase,
  type DuelState,
  type DuelistState,
  type FieldCard,
  createDuel,
  reduceDuel,
  isMonster,
  levelOf,
  tributesRequired,
  type BattlePosition,
  type FaceState,
} from "@/game/duel-engine";
import {
  useCardLift,
  useTargetingPath,
  TargetingOverlay,
  useFieldFx,
  prefetchCardArt,
  type FieldEffect,
} from "@/game/interaction";

export const Route = createFileRoute("/arena")({
  component: ArenaPage,
  head: () => ({
    meta: [
      { title: "Battle Arena — Duel for Divinity" },
      {
        name: "description",
        content:
          "Vertical duel mat in the classic style. Draw, summon, battle, end — assemble Exodia Prime for an instant win.",
      },
      { property: "og:title", content: "Battle Arena — Exodia NFT Battle" },
      {
        property: "og:description",
        content: "Interactive Egyptian card duels with on-chain stakes.",
      },
      { property: "og:url", content: "/arena" },
    ],
    links: [{ rel: "canonical", href: "/arena" }],
  }),
});

// ── Duel state driven by the pure engine in @/game/duel-engine ──────────────
type Side = "you" | "opp";

function startingDeck(): Card[] {
  return CARDS.filter((c) => c.rarity !== "Exodius");
}

function ArenaPage() {
  const [duel, setDuel] = useState<DuelState>(() => {
    const d = createDuel("You", "Akhenaten·Adept", startingDeck(), startingDeck());
    const oppDeck = d.opp.deck;
    const anubis = CARDS.find((c) => c.id === "anubis");
    const set = CARDS.find((c) => c.id === "set");
    if (anubis)
      d.opp.monsters[1] = {
        card: anubis,
        position: "ATK",
        face: "face-up",
        hasAttacked: false,
        setTurn: 0,
        positionChangedThisTurn: false,
      };
    if (set)
      d.opp.monsters[2] = {
        card: set,
        position: "DEF",
        face: "face-up",
        hasAttacked: false,
        setTurn: 0,
        positionChangedThisTurn: false,
      };
    d.opp.deck = oppDeck;
    return d;
  });

  // Prefetch hot card art once per session for instant re-mounts at scale.
  useEffect(() => {
    prefetchCardArt(CARDS);
  }, []);

  const dispatch = useMemo(
    () => (action: Parameters<typeof reduceDuel>[1]) => setDuel((s) => reduceDuel(s, action)),
    [],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [pendingTribute, setPendingTribute] = useState<{
    card: Card;
    needed: number;
    chosen: number[];
  } | null>(null);
  const [targetingAttacker, setTargetingAttacker] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const { fire, activeAt } = useFieldFx();

  const you = duel.you;
  const opp = duel.opp;
  const phase = duel.phase;
  const turn = duel.turn;
  const log = duel.log;
  const heavensRoundsLeft = duel.heavensRoundsLeft;
  const isYourTurn = turn === "you";
  const normalSummonsLeft = Math.max(0, 1 - you.normalSummonsUsed);

  // ── FX + chain visuals ──
  const targeting = useTargetingPath(
    targetingAttacker !== null ? `[data-slot="you:monster:${targetingAttacker}"]` : null,
    "[data-duel-seal]",
    targetingAttacker !== null && phase === "Battle",
  );

  const appendLog = (s: string) => setDuel((st) => ({ ...st, log: [s, ...st.log].slice(0, 120) }));

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setSignupCount(count ?? 0));
  }, []);

  function maybeDropHeavens(youLp: number, oppLp: number) {
    if (heavensRoundsLeft > 0) return;
    const count = signupCount ?? 999;
    const base = count <= 30 ? 0.08 : 0.0001;
    const nearDeath = youLp < 2000 || oppLp < 2000;
    const chance = nearDeath ? Math.max(base, count <= 30 ? 0.25 : 0.02) : base;
    if (Math.random() < chance) {
      setDuel((st) => ({ ...st, heavensRoundsLeft: 3 }));
      appendLog("✦ THE CARD FROM THE HEAVENS DESCENDS — no damage may be dealt for 3 rounds.");
      toast("The Card from the Heavens descends", {
        description: "Both duelists may draw and set, but no attacks land for 3 rounds.",
      });
    }
  }

  const advancePhase = () => {
    if (!isYourTurn) {
      toast("Opponent's turn — wait for their move.");
      return;
    }
    if (pendingTribute) {
      toast("Finish or cancel the tribute first.");
      return;
    }
    if (phase === "Draw") dispatch({ type: "DRAW", who: "you" });
    if (phase === "End") {
      dispatch({ type: "ADVANCE_PHASE" });
      setTimeout(() => {
        opponentTurn();
      }, 350);
      return;
    }
    dispatch({ type: "ADVANCE_PHASE" });
  };

  const completeMonsterSummon = (
    card: Card,
    tributeSlots: number[] = [],
    position: BattlePosition = "ATK",
    face: FaceState = "face-up",
  ) => {
    const slot = you.monsters.findIndex((s, i) => s === null && !tributeSlots.includes(i));
    if (slot === -1) {
      toast("Your field is full.");
      return;
    }
    dispatch({ type: "SUMMON_MONSTER", who: "you", card, slot, position, face, tributeSlots });
    fire(`you:monster:${slot}`, face === "face-down" ? "set" : "summon");
    const exodiusOnField = [...you.monsters.map((m) => m?.card), card].filter(
      (c) => c && c.rarity === "Exodius",
    ) as Card[];
    if (exodiusOnField.length >= 5) {
      appendLog(`THE FORBIDDEN ONE IS ASSEMBLED. The duel ends.`);
      setDuel((st) => ({ ...st, opp: { ...st.opp, lp: 0 }, winner: "you" }));
      toast("Exodia Prime is whole. You win.", { description: "All five relics on your field." });
    }
  };

  const playFromHand = (card: Card) => {
    if (!isYourTurn) {
      toast("Wait for your turn.");
      return;
    }
    if (phase !== "Main1" && phase !== "Main2") {
      toast("Switch to Main Phase 1 to play cards.");
      return;
    }
    if (!isMonster(card)) {
      const slot = you.spellTraps.findIndex((s) => s === null);
      if (slot === -1) {
        toast("Your spell/trap row is full.");
        return;
      }
      dispatch({ type: "SET_SPELL_TRAP", who: "you", card, slot, faceDown: card.type === "Trap" });
      fire(`you:spellTrap:${slot}`, "set");
      return;
    }
    if (phase === "Main2" || normalSummonsLeft <= 0) {
      toast("Only one normal summon per turn, and not in Main Phase 2.");
      return;
    }
    const needed = tributesRequired(card);
    if (needed === 0) {
      completeMonsterSummon(card);
      return;
    }
    const onField = you.monsters.filter((c) => c !== null).length;
    if (onField < needed) {
      toast(`Need ${needed} tribute${needed > 1 ? "s" : ""} on the field.`, {
        description: `${card.name} is Lv${levelOf(card)}.`,
      });
      return;
    }
    setPendingTribute({ card, needed, chosen: [] });
    appendLog(`Select ${needed} monster${needed > 1 ? "s" : ""} to tribute for ${card.name}.`);
    toast(`Tribute required`, {
      description: `Click ${needed} of your monsters to send to the graveyard.`,
    });
  };

  const monsterClick = (slot: number) => {
    if (pendingTribute) {
      if (!you.monsters[slot]) return;
      const chosen = pendingTribute.chosen.includes(slot)
        ? pendingTribute.chosen.filter((s) => s !== slot)
        : [...pendingTribute.chosen, slot];
      if (chosen.length >= pendingTribute.needed) {
        const card = pendingTribute.card;
        setPendingTribute(null);
        completeMonsterSummon(card, chosen);
      } else {
        setPendingTribute({ ...pendingTribute, chosen });
      }
      return;
    }
    if (
      isYourTurn &&
      phase === "Battle" &&
      you.monsters[slot]?.position === "ATK" &&
      !you.monsters[slot]?.hasAttacked
    ) {
      setTargetingAttacker(slot);
      toast("Select a target — or attack directly.", {
        description: "Click an opponent monster, or the seal for a direct attack.",
      });
      return;
    }
    if (isYourTurn && (phase === "Main1" || phase === "Main2") && you.monsters[slot]) {
      dispatch({ type: "CHANGE_POSITION", who: "you", slot });
      fire(`you:monster:${slot}`, "activate");
    }
  };

  const attackTarget = (targetSlot: number | null) => {
    if (targetingAttacker === null) return;
    dispatch({ type: "DECLARE_ATTACK", who: "you", attackerSlot: targetingAttacker, targetSlot });
    fire(`you:monster:${targetingAttacker}`, "attack");
    setTargetingAttacker(null);
  };

  const opponentTurn = () => {
    // Draw
    dispatch({ type: "DRAW", who: "opp" });
    // Summon first open hand monster, face-up ATK
    const handCard = duel.opp.hand[0];
    const openSlot = duel.opp.monsters.findIndex((m) => m === null);
    if (handCard && isMonster(handCard) && openSlot !== -1) {
      dispatch({
        type: "SUMMON_MONSTER",
        who: "opp",
        card: handCard,
        slot: openSlot,
        position: "ATK",
        face: "face-up",
        tributeSlots: [],
      });
      fire(`opp:monster:${openSlot}`, "summon");
    }
    setTimeout(() => {
      const attackerIdx = duel.opp.monsters.findIndex(
        (m) => m && m.position === "ATK" && !m.hasAttacked,
      );
      if (attackerIdx === -1) {
        dispatch({ type: "ADVANCE_PHASE" });
        return;
      }
      const targetIdx = duel.you.monsters.findIndex((m) => m !== null);
      dispatch({
        type: "DECLARE_ATTACK",
        who: "opp",
        attackerSlot: attackerIdx,
        targetSlot: targetIdx === -1 ? null : targetIdx,
      });
      fire(`opp:monster:${attackerIdx}`, "attack");
      // End opponent's turn after attacking.
      setTimeout(() => {
        setDuel((st) => reduceDuel(st, { type: "ADVANCE_PHASE" }));
        dispatch({ type: "DRAW", who: "you" });
        maybeDropHeavens(duel.you.lp, duel.opp.lp);
      }, 800);
    }, 600);
  };

  const winner = useMemo(() => {
    if (duel.winner) return duel.winner;
    if (you.lp <= 0) return "opp";
    if (opp.lp <= 0) return "you";
    return null;
  }, [duel.winner, you.lp, opp.lp]);

  const { user } = useAuth();
  const awardedRef = useRef(false);
  useEffect(() => {
    if (!winner || !user || awardedRef.current) return;
    awardedRef.current = true;
    const won = winner === "you";
    supabase.rpc("award_battle_xp", { _won: won }).then(({ data, error }) => {
      if (error) {
        toast.error("Could not save battle result", { description: error.message });
        return;
      }
      const r = data as {
        xp: number;
        level: number;
        leveled_up: boolean;
        levels_gained: number;
        pending_free_packs: number;
        unlocked: string[];
      } | null;
      if (!r) return;
      appendLog(`+${won ? 50 : 15} XP · Total ${r.xp} (Lv ${r.level})`);
      if (r.leveled_up) {
        toast.success(`Level up! You reached Lv ${r.level}`, {
          description: `+${250 * r.levels_gained} EXOD and +${r.levels_gained} free pack credit. Open it in Drops.`,
        });
        appendLog(`★ LEVEL UP — Lv ${r.level}. +${r.levels_gained} free pack queued.`);
      } else {
        toast(won ? "Victory recorded — +50 XP" : "Defeat recorded — +15 XP");
      }
      if (r.unlocked && r.unlocked.length > 0) {
        for (const a of r.unlocked) {
          toast.success("Achievement unlocked!", { description: a.replace(/_/g, " ") });
          appendLog(`🏆 Achievement unlocked: ${a.replace(/_/g, " ")}`);
        }
      }
    });
  }, [winner, user]);

  return (
    <div className="min-h-screen">
      <TargetingOverlay path={targeting} />
      <SiteHeader />

      <section className="w-full px-3 pt-4 pb-2 md:px-6">
        <ArenaLobby />

        {/* Top bar: title + phase + actions */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/30 bg-card/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-crimson">
                Sands of Judgment
              </div>
              <h1 className="font-display text-xl md:text-2xl text-gradient-gold leading-none">
                Battle Arena
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 p-1">
            {DUEL_PHASES.map((p, i) => (
              <button
                key={p}
                title={PHASE_META[p].hint}
                onClick={() => {
                  if (isYourTurn && !pendingTribute) dispatch({ type: "ADVANCE_PHASE" });
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.25em] transition",
                  phase === p
                    ? "bg-gold/20 text-gold ring-1 ring-gold/60 glow-gold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i + 1}. {PHASE_META[p].label}
              </button>
            ))}
            <Button
              size="sm"
              onClick={advancePhase}
              disabled={!isYourTurn || !!pendingTribute}
              className={cn(
                "ml-1 h-7",
                phase === "End"
                  ? "bg-crimson text-foreground hover:bg-crimson/90"
                  : "bg-gold text-gold-foreground hover:bg-gold/90",
              )}
            >
              {phase === "End" ? "End Turn ⟳" : "Next →"}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-border/70"
              onClick={() =>
                toast("Spectator mode coming in Phase 5.", {
                  description: "Watch live public duels with chat.",
                })
              }
            >
              Spectate
            </Button>
            <Button
              size="sm"
              className="bg-crimson text-foreground hover:bg-crimson/90"
              onClick={() => toast("Matchmaking ships in Phase 2 with auth.")}
            >
              Find PvP Duel
            </Button>
          </div>
        </div>

        {/* Turn indicator + tribute prompt */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.25em]">
          <span
            className={cn(
              "rounded-full border px-3 py-1",
              turn === "you"
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-crimson/60 bg-crimson/10 text-crimson",
            )}
          >
            {turn === "you" ? "Your turn" : "Opponent's turn"}
          </span>
          <span className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-muted-foreground">
            Normal summon: {normalSummonsLeft}/1
          </span>
          <span className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-muted-foreground">
            {PHASE_META[phase].hint}
          </span>
          {pendingTribute && (
            <span className="flex items-center gap-2 rounded-full border border-crimson/60 bg-crimson/10 px-3 py-1 text-crimson">
              Tribute {pendingTribute.chosen.length}/{pendingTribute.needed} for{" "}
              {pendingTribute.card.name}
              <button
                onClick={() => {
                  setPendingTribute(null);
                  appendLog("Tribute canceled.");
                }}
                className="text-[10px] underline"
              >
                cancel
              </button>
            </span>
          )}
        </div>

        <AnimatePresence>
          {heavensRoundsLeft > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-3 flex items-center gap-3 rounded-lg border border-accent/60 bg-gradient-to-r from-accent/10 via-gold/10 to-accent/10 p-2.5"
            >
              <div className="font-display text-xl text-gold">✦</div>
              <div className="text-xs">
                <span className="text-accent uppercase tracking-[0.2em]">
                  Card from the Heavens
                </span>{" "}
                <span className="text-muted-foreground">
                  — attacks sealed for {heavensRoundsLeft} round{heavensRoundsLeft === 1 ? "" : "s"}
                  .
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main layout: board + log sidebar */}
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          {/* DUEL MAT */}
          <div className="relative overflow-hidden rounded-xl border border-gold/40 bg-card/70 hieroglyph-bg shadow-[0_0_60px_-20px_rgba(201,168,76,0.4)]">
            <div
              className="flex flex-col justify-between gap-1"
              style={{ height: "min(78vh, 760px)", minHeight: "520px" }}
            >
              {/* Opponent face-down hand */}
              <div className="flex justify-center gap-1 px-4 pt-2">
                {Array.from({ length: Math.min(opp.hand.length + 4, 7) }).map((_, i) => (
                  <div
                    key={i}
                    className="h-6 w-10 rounded-sm border border-gold/40 bg-gradient-to-br from-background to-card/80 shadow-md md:h-7 md:w-12"
                  >
                    <div className="flex h-full items-center justify-center font-display text-[10px] text-gold/70">
                      𓂀
                    </div>
                  </div>
                ))}
              </div>

              {/* Opponent info bar */}
              <PlayerBar
                combatant={opp}
                label="AKHENATEN·ADEPT"
                sublabel="Adept · Rank Bronze"
                side="top"
              />

              {/* Opponent back row: Field Spell | 5 S/T | Extra Deck */}
              <FieldRow
                left={<CornerZone label="Field" tone="green" />}
                right={
                  <CornerZone label="Extra" tone="purple" count={opp.extraDeck.length || 15} />
                }
                center={<ZoneRow zones={opp.spellTraps} variant="st" facedown />}
              />

              {/* Opponent front row: Graveyard | 5 Monster | Deck */}
              <FieldRow
                left={<CornerZone label="Grave" tone="gray" count={opp.graveyard.length} stacked />}
                right={<CornerZone label="Deck" tone="purple" count={opp.deck.length} stacked />}
                center={
                  <MonsterRow
                    cards={opp.monsters}
                    isYou={false}
                    phase={phase}
                    onAttack={() => {}}
                  />
                }
              />

              {/* NEUTRAL CENTER — seal flanking 2 shared Extra Monster Zones */}
              <div onClick={() => attackTarget(null)} data-duel-seal className="contents">
                <SealCenter turn={turn} phase={phase} />
              </div>

              {/* Player front row: Deck | 5 Monster | Graveyard */}
              <FieldRow
                left={<CornerZone label="Deck" tone="purple" count={you.deck.length} stacked />}
                right={
                  <CornerZone label="Grave" tone="gray" count={you.graveyard.length} stacked />
                }
                center={
                  <MonsterRow
                    cards={you.monsters}
                    isYou
                    phase={phase}
                    onAttack={monsterClick}
                    highlightSlots={pendingTribute?.chosen ?? []}
                    selectable={!!pendingTribute}
                  />
                }
              />

              {/* Player back row: Extra Deck | 5 S/T | Field Spell */}
              <FieldRow
                left={<CornerZone label="Extra" tone="purple" count={you.extraDeck.length || 15} />}
                right={<CornerZone label="Field" tone="green" />}
                center={<ZoneRow zones={you.spellTraps} variant="st" />}
              />

              {/* Player info bar */}
              <PlayerBar
                combatant={you}
                label="YOU · DUELIST"
                sublabel="Rank Bronze"
                side="bottom"
              />
            </div>

            {winner && (
              <div className="absolute inset-x-6 bottom-4 rounded-md border border-gold/60 bg-background/90 p-3 text-center font-display text-lg text-gradient-gold backdrop-blur">
                {winner === "you"
                  ? "Victory. The dynasty bends."
                  : "Defeat. The sands close over you."}
              </div>
            )}
          </div>

          {/* COMBAT LOG */}
          <div className="hidden rounded-xl border border-border/60 bg-card/40 p-4 lg:block">
            <div className="mb-2 text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Combat Log
            </div>
            <div className="max-h-[min(78vh,760px)] space-y-1.5 overflow-y-auto pr-1 text-xs">
              <AnimatePresence initial={false}>
                {log.map((line, i) => (
                  <motion.div
                    key={`${line}-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "border-l-2 pl-2",
                      i === 0
                        ? "border-gold/70 text-foreground"
                        : "border-border/60 text-muted-foreground",
                    )}
                  >
                    {line}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* PLAYER HAND ROW */}
        <div className="mt-3 rounded-xl border border-gold/30 bg-card/60 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Hand ({you.hand.length})
            </div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              {phase === "Main1" || phase === "Main2"
                ? "Click a card to summon or set"
                : "Switch to Main Phase 1 to play cards"}
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {you.hand.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  playFromHand(c);
                }}
                className={cn(
                  "group relative h-[108px] w-[78px] shrink-0 overflow-hidden rounded transition md:h-[120px] md:w-[86px]",
                  `card-frame-${c.rarity}`,
                  (phase === "Main1" || phase === "Main2") &&
                    "hover:-translate-y-5 hover:ring-2 hover:ring-gold/80",
                  selected === c.id && "ring-2 ring-gold/80 -translate-y-3",
                )}
              >
                <img
                  src={c.art}
                  alt={c.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/95 to-transparent p-1">
                  <div className="truncate font-display text-[9px]">{c.name}</div>
                  <div className="text-[9px] text-gold">
                    Lv{levelOf(c)} · {c.atk}/{c.def}
                  </div>
                  {!isMonster(c) && (
                    <div className="text-[8px] uppercase tracking-widest text-accent">{c.type}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Mobile log toggle */}
        <div className="mt-3 lg:hidden">
          <Button
            variant="outline"
            size="sm"
            className="w-full border-gold/40"
            onClick={() => setLogOpen((v) => !v)}
          >
            {logOpen ? "Hide Combat Log" : "Show Combat Log"}
          </Button>
          {logOpen && (
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 bg-card/40 p-3 text-xs">
              {log.map((line, i) => (
                <div
                  key={`${line}-${i}`}
                  className={cn(
                    "border-l-2 pl-2",
                    i === 0
                      ? "border-gold/70 text-foreground"
                      : "border-border/60 text-muted-foreground",
                  )}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Local exhibition mode. Live PvP, spectator chat, and ranked matchmaking ship in Phase 2
          with accounts.
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ─── Subcomponents ─────────────────────────────────────── */

function PlayerBar({
  combatant,
  label,
  sublabel,
  side,
}: {
  combatant: DuelistState;
  label: string;
  sublabel: string;
  side: "top" | "bottom";
}) {
  const lpPct = Math.max(0, Math.min(100, (combatant.lp / 8000) * 100));
  const lpColor =
    side === "top" ? "from-accent via-gold to-accent" : "from-crimson via-gold to-crimson";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-border/40 bg-background/40 px-4 py-2",
        side === "top" ? "border-b" : "border-t",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-gold/80 to-crimson/80 ring-1 ring-gold/60" />
        <div>
          <div className="font-display text-sm text-gold leading-tight">{label}</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {sublabel}
          </div>
        </div>
      </div>
      <div className="flex-1 max-w-md">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">LP</span>
          <span className="font-display text-base text-gold tabular-nums">{combatant.lp}</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-background/80 ring-1 ring-border/60">
          <div
            className={cn("h-full bg-gradient-to-r transition-all", lpColor)}
            style={{ width: `${lpPct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Deck</div>
          <div className="font-display text-xs text-gold tabular-nums">{combatant.deck.length}</div>
        </div>
        <div className="relative h-10 w-7 rounded-sm border border-gold/50 bg-gradient-to-br from-background to-card shadow-inner">
          <div className="flex h-full items-center justify-center font-display text-sm text-gold/70">
            𓂀
          </div>
        </div>
      </div>
    </div>
  );
}

function CenterDivider({
  clash,
}: {
  clash: { id: number; kind: "hit" | "poison" | "direct" } | null;
}) {
  return (
    <div className="relative my-2 flex items-center justify-center">
      <div
        className="h-px w-full bg-gradient-to-r from-transparent via-gold to-transparent"
        style={{ boxShadow: "0 0 12px rgba(201,168,76,0.6)" }}
      />
      <div className="absolute inset-x-0 flex items-center justify-center">
        <span className="rounded-full border border-gold/60 bg-background/80 px-3 py-0.5 font-display text-[10px] uppercase tracking-[0.4em] text-gold backdrop-blur">
          ✦ XOVIA ✦
        </span>
      </div>
      <AnimatePresence>
        {clash && (
          <motion.div
            key={clash.id}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1.6 }}
            exit={{ opacity: 0, scale: 2.2 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={cn(
              "pointer-events-none absolute h-24 w-24 rounded-full blur-xl",
              clash.kind === "hit" && "bg-crimson/70",
              clash.kind === "direct" && "bg-gold/70",
              clash.kind === "poison" && "bg-green-500/70",
            )}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {clash && clash.kind === "poison" && (
          <motion.div
            key={`smoke-${clash.id}`}
            initial={{ opacity: 0.8, y: 0, scale: 0.6 }}
            animate={{ opacity: 0, y: -40, scale: 1.4 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none absolute h-16 w-32 rounded-full bg-green-500/40 blur-2xl"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FieldRow({
  left,
  right,
  center,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  center: React.ReactNode;
}) {
  return (
    <div className="flex items-stretch gap-2 px-2 py-1.5 md:px-4">
      <div className="flex shrink-0 items-center">{left}</div>
      <div className="flex-1">{center}</div>
      <div className="flex shrink-0 items-center">{right}</div>
    </div>
  );
}

function MonsterRow({
  cards,
  isYou,
  phase,
  onAttack,
  highlightSlots = [],
  selectable = false,
}: {
  cards: (FieldCard | null)[];
  isYou: boolean;
  phase: DuelPhase;
  onAttack: (slot: number) => void;
  highlightSlots?: number[];
  selectable?: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 md:gap-2">
      {cards.map((fc, i) => (
        <button
          key={i}
          data-slot={`${isYou ? "you" : "opp"}:monster:${i}`}
          disabled={!isYou || !fc}
          onClick={() => fc && onAttack(i)}
          className={cn(
            "relative aspect-[3/4] overflow-hidden rounded border-2 border-dashed border-border/50 bg-background/30 transition",
            "h-[88px] sm:h-[104px] md:h-[120px] lg:h-[136px]",
            fc && `card-frame-${fc.card.rarity} border-solid`,
            isYou &&
              fc &&
              phase === "Battle" &&
              "ring-2 ring-crimson/70 hover:scale-[1.03] cursor-pointer",
            isYou && fc && selectable && "ring-2 ring-accent/80 cursor-pointer animate-pulse",
            highlightSlots.includes(i) &&
              "ring-4 ring-crimson outline outline-2 outline-crimson/80",
          )}
        >
          {fc ? (
            <>
              {fc.face === "face-down" ? (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-background to-card/80 font-display text-2xl text-gold/70">
                  𓂀
                </div>
              ) : (
                <img
                  src={fc.card.art}
                  alt={fc.card.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/95 via-background/70 to-transparent p-1">
                <div className="truncate font-display text-[10px] leading-tight md:text-[11px]">
                  {fc.card.name}
                </div>
                <div className="text-[9px] text-gold tabular-nums md:text-[10px]">
                  Lv{levelOf(fc.card)} · {fc.card.atk}/{fc.card.def} · {fc.position}
                  {fc.face === "face-down" ? "·Set" : ""}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center font-display text-2xl text-gold/15">
              𓂀
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function SealCenter({ turn, phase }: { turn: "you" | "opp"; phase: DuelPhase }) {
  return (
    <div className="relative my-1 flex flex-1 items-center justify-center overflow-hidden">
      {/* horizon gradient lines */}
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        style={{ boxShadow: "0 0 18px rgba(201,168,76,0.4)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        style={{ boxShadow: "0 0 18px rgba(201,168,76,0.4)" }}
      />
      {/* the seal */}
      <div className="relative flex flex-col items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-[140px] w-[140px] rounded-full border border-gold/40 md:h-[200px] md:w-[200px]" />
          <div
            className="absolute h-[110px] w-[110px] rounded-full border border-gold/30 md:h-[160px] md:w-[160px]"
            style={{ borderStyle: "dashed" }}
          />
          <div className="absolute h-[170px] w-[170px] rounded-full border border-gold/20 md:h-[240px] md:w-[240px]" />
          <div className="font-display text-[64px] leading-none text-gold/60 drop-shadow-[0_0_18px_rgba(201,168,76,0.5)] md:text-[110px]">
            𓂀
          </div>
        </div>
        <div className="mt-2 rounded-full border border-gold/60 bg-background/80 px-4 py-1 font-display text-[10px] uppercase tracking-[0.5em] text-gold backdrop-blur md:text-xs">
          ✦ XOVIA ✦
        </div>
        <div className="mt-1 text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
          {turn === "you" ? `Your ${PHASE_META[phase].label}` : "Opponent acts"}
        </div>
      </div>

      {/* Shared Extra Monster Zones (amber) — flank the seal */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-4 md:px-12 lg:px-20">
        <div className="flex h-[70px] w-[54px] flex-col items-center justify-center rounded border border-[hsl(38,90%,58%)]/80 bg-[hsl(38,90%,58%)]/15 md:h-[88px] md:w-[68px]">
          <div className="font-display text-2xl text-[hsl(38,90%,58%)]">★</div>
          <div className="text-[7px] uppercase tracking-widest text-[hsl(38,90%,68%)]">
            Extra MZ
          </div>
        </div>
        <div className="flex h-[70px] w-[54px] flex-col items-center justify-center rounded border border-[hsl(38,90%,58%)]/80 bg-[hsl(38,90%,58%)]/15 md:h-[88px] md:w-[68px]">
          <div className="font-display text-2xl text-[hsl(38,90%,58%)]">★</div>
          <div className="text-[7px] uppercase tracking-widest text-[hsl(38,90%,68%)]">
            Extra MZ
          </div>
        </div>
      </div>

      {/* clash effects */}
    </div>
  );
}

function ZoneRow({
  zones,
  variant,
  facedown,
}: {
  zones: (FieldCard | null)[];
  variant: "st";
  facedown?: boolean;
}) {
  return (
    <div className="px-2 md:px-4">
      <div className="grid grid-cols-5 gap-1.5 md:gap-2">
        {zones.map((fc, i) => (
          <div
            key={i}
            data-slot={`st:${i}`}
            className={cn(
              "relative h-[42px] overflow-hidden rounded border border-dashed border-border/50 bg-background/20 md:h-[52px] lg:h-[60px]",
            )}
          >
            {fc ? (
              facedown || fc.face === "face-down" ? (
                <div className="flex h-full items-center justify-center font-display text-base text-gold/70 bg-gradient-to-br from-background to-card/80">
                  𓂀
                </div>
              ) : (
                <img src={fc.card.art} alt={fc.card.name} className="h-full w-full object-cover" />
              )
            ) : (
              <div className="flex h-full items-center justify-center font-display text-lg text-gold/15">
                ☥
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SideZone({ label }: { label: string }) {
  return (
    <div className="flex h-full w-[54px] flex-col items-center justify-center rounded border border-dashed border-border/50 bg-background/20 md:w-[70px]">
      <div className="font-display text-xl text-gold/20">☥</div>
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

const ZONE_TONES: Record<string, string> = {
  coral: "border-[hsl(8,75%,62%)]/70 bg-[hsl(8,75%,62%)]/10 ring-[hsl(8,75%,62%)]/40",
  teal: "border-[hsl(180,55%,50%)]/70 bg-[hsl(180,55%,50%)]/10 ring-[hsl(180,55%,50%)]/40",
  amber: "border-[hsl(38,90%,58%)]/80 bg-[hsl(38,90%,58%)]/15 ring-[hsl(38,90%,58%)]/50",
  green: "border-[hsl(140,55%,48%)]/70 bg-[hsl(140,55%,48%)]/10 ring-[hsl(140,55%,48%)]/40",
  purple: "border-[hsl(270,55%,62%)]/70 bg-[hsl(270,55%,62%)]/10 ring-[hsl(270,55%,62%)]/40",
  gray: "border-border/60 bg-muted/30 ring-border/40",
};

function CornerZone({
  label,
  tone,
  count,
  stacked,
}: {
  label: string;
  tone: keyof typeof ZONE_TONES;
  count?: number;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-[54px] flex-col items-center justify-center rounded border md:w-[70px]",
        ZONE_TONES[tone],
      )}
    >
      {stacked ? (
        <div className="relative h-9 w-7">
          <div className="absolute inset-0 rotate-[-4deg] rounded-sm border border-gold/40 bg-gradient-to-br from-background to-card/80" />
          <div className="absolute inset-0 rotate-[2deg] rounded-sm border border-gold/40 bg-gradient-to-br from-background to-card/80" />
          <div className="absolute inset-0 flex items-center justify-center font-display text-[10px] text-gold/70">
            𓂀
          </div>
        </div>
      ) : (
        <div className="font-display text-xl opacity-60">☥</div>
      )}
      <div className="mt-1 text-[8px] uppercase tracking-widest text-foreground/70">{label}</div>
      {typeof count === "number" && (
        <div className="font-display text-[11px] text-gold tabular-nums">{count}</div>
      )}
    </div>
  );
}

function GraveyardZone({ count }: { count: number }) {
  return (
    <div className="flex h-full w-[54px] flex-col items-center justify-center rounded border border-crimson/40 bg-background/30 md:w-[70px]">
      <div className="relative h-9 w-7">
        <div className="absolute inset-0 rotate-[-4deg] rounded-sm border border-gold/40 bg-gradient-to-br from-background to-card/80" />
        <div className="absolute inset-0 rotate-[2deg] rounded-sm border border-gold/40 bg-gradient-to-br from-background to-card/80" />
        <div className="absolute inset-0 flex items-center justify-center font-display text-[10px] text-gold/70">
          𓂀
        </div>
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-widest text-muted-foreground">Grave</div>
      <div className="font-display text-[11px] text-gold tabular-nums">{count}</div>
    </div>
  );
}
