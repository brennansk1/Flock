# DESIGN CUTS & REWORKS — v2.1 "The Clean Cut"

This document records the design decisions and architectural cuts made to streamline *Flock* while preserving its strategic and dramatic depth.

---

## The Market Lens & Thesis

FLOCK's pitch is **OpenFront-style .io territory game × cult satire with shareable drama**. That market imposes three hard laws:
1. **10-second time-to-fun, one-match learnability.** Guests drop in with no account. The core loop must be playable knowing only: *click to found → click fronts → 1/2/3 stances*. Everything else must be optional depth, not required homework.
2. **The drama IS the marketing.** JUDAS banners, schisms, scandal exposés, CPA sieges, recap cards — these generate the screenshots and clips that grow an .io game. Any feature that manufactures *stories* is disproportionately valuable.
3. **12-minute matches.** Anything whose payoff is invisible (<10% modifiers) or whose horizon exceeds ~3 minutes is dead weight.

We prune features by asking: *Is it visible on the map? Does it create a decision or a story? Can you explain it in one sentence?* We aim to shrink the learnable surface while keeping the strategic and dramatic depth fully intact.

---

## Action Plan

### 1. CUTS (4)
*   **Hotline Center**: Removed. The 75% intercept probability is deleted (not folded into Watchtower). Strike counterplay is positional spread and reacting to the visible 10s warning banner.
*   **Print Shop**: Removed. Regional percent-discounts are spreadsheet effects that players don't feel in a 12-minute match.
*   **Garage**: Removed. Van capacity is folded directly into Compounds (each Compound raises van cap by +3).
*   **Court Defection**: Removed. Redundant with raids (which revert enemy districts). raiders use a dramatic map interaction, while Defections were a transactional button click. Replaced by moving the USD cost onto raids.

### 2. REWORKS (4)
*   **Atonement → "Public Apology"**: Day of Atonement is redesigned as a "Public Apology" valve. Spends Faith, has a long cooldown, and pauses your active conversion gains (not your defenses) while dissent and global heat vent rapidly. This gives players an escape valve to recover from aggressive Crusade stances.
*   **Agents (Victim-Side Tell)**: Keep Agents (revealing them with Watchtowers is crucial counterplay). To prevent frustration, when an Agent is channeling a Deprogramming Raid or scanning for Evidence in a district, show a "suspicious activity" warning indicator in the target district during the channel phase.
*   **Economic Win (Circle Ledger Telegraph)**: Keep the Ledger victory (Prosperity Circle). Once a Prosperity Circle player's Ledger total passes 60% of the victory threshold, broadcast their progress to all players like a prophecy countdown, allowing the lobby to team up and stop them.
*   **Dissent Heat-map**: Keep per-district Dissent (crucial for Schisms and local feedback). Add a toggleable Dissent overlay in the HUD so players can clearly see which areas of their territory are disgruntled.

### 3. KEEPS
*   All 5 resources (Followers, USD, Faith, Dissent, Heat).
*   5+1 buildings (Compound, Watchtower, Collection Plate, Broadcast Tower, Supplement Lab).
*   Vans, Couriers, Agents, Prophet, CPA minivans/buses.
*   3 strikes (Pamphlet Bomb, Exposé, Manifesto Drop) + Raid + Scandal.
*   3 win conditions (Domination, Doctrinal megachurch channel, Economic ledger).

---

## Gameplay System Summary After Cuts

*   **Build tray:** Reduced from 8 buttons to 5 + 1 signature.
*   **Scheme panel:** Reduced from 11 buttons to 9.
*   **Learnable surface:** Shrunk significantly, keeping automated Couriers and Agents (no micro needed) and focusing depth on visible map events.
