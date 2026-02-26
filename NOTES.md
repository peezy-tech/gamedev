# Dev Notes

## Problems

### LiveKit — Unexpected High Usage Cost
Every player who joins the world immediately connects to LiveKit (mic off by default), burning participant-minutes even with zero voice activity. The free tier (~10,000 participant-minutes/month) is exhausted quickly with normal traffic.

**Root cause:** `ClientLiveKit.js:81` calls `room.connect()` unconditionally during world join. LiveKit bills $0.0005/min per connected participant regardless of mic state.

**Potential solutions:**
1. **Lazy connect** — only call `room.connect()` when the player first enables their mic
2. **Opt-in voice** — keep mic off by default, but defer the LiveKit connection until user interaction
3. **Skip connect when level is `disabled`** — if the world/player voice level is `disabled`, never connect
4. **Self-host LiveKit** — run own LiveKit server (open source) at flat infra cost instead of per-minute billing

### LiveKit — `livekit-server-sdk` imported in client bundle
`ClientLiveKit.js:1` imports `TrackSource` from `livekit-server-sdk`, which is a server-only package. This causes the warning: *"Your web client should request a token from your backend server..."* and risks exposing the API secret in the client bundle.

**Root cause:** Unused import of `TrackSource` from `livekit-server-sdk` in `ClientLiveKit.js`. The token is correctly generated server-side in `ServerLiveKit.js` and sent to the client — the import just needs to be removed.

**Fix:** Remove `import { TrackSource } from 'livekit-server-sdk'` from `ClientLiveKit.js:1` (it's imported but never used).

### Validation — Lazy LiveKit Connect

Open browser devtools console and filter by `[livekit]`.

**On world join (no mic/screenshare):**
- You should see: `[livekit] initialized, connection deferred until mic or screenshare requested`
- You should NOT see: `[livekit] connecting...`
- LiveKit dashboard participant count for the room should be 0

**On clicking the mic button for the first time:**
- You should see in order:
  1. `[livekit] mic enable requested, triggering connect`
  2. `[livekit] connecting...`
  3. `[livekit] connected`
  4. `[livekit] setting microphone enabled: true`
- LiveKit dashboard participant count should increment to 1

**On starting a screenshare:**
- You should see: `[livekit] screenshare requested, triggering connect`
- Followed by the same connect sequence if not already connected

**Confirming the fix worked:**
- Have multiple users join and idle without using mic/screenshare
- Check LiveKit dashboard — participant-minutes should not accrue for those users
- Only users who actively clicked mic or screenshare should appear as participants

---

## Relevant Files

### LiveKit Systems
- `src/core/systems/ServerLiveKit.js` — generates access tokens, manages voice levels/modifiers per player
- `src/core/systems/ClientLiveKit.js` — connects to LiveKit room, manages audio/screenshare tracks
- `src/core/systems/AdminLiveKit.js` — no-op stub; admin clients do not join voice

### World Registration
- `src/core/createServerWorld.js` — registers `ServerLiveKit`
- `src/core/createClientWorld.js` — registers `ClientLiveKit`
- `src/core/createAdminWorld.js` — registers `AdminLiveKit`

### Network Integration
- `src/core/systems/ServerNetwork.js:565` — serializes livekit token on player join
- `src/core/systems/ServerNetwork.js:752` — handles mute
- `src/core/systems/ServerNetwork.js:1214` — clears modifiers on disconnect
- `src/core/systems/ClientNetwork.js:196` — triggers `livekit.deserialize()` (and thus `room.connect()`) on world join
- `src/core/systems/ClientNetwork.js:269` — handles voice level changes
- `src/core/systems/ClientNetwork.js:273` — handles mute changes

### Entities
- `src/core/entities/PlayerLocal.js:459` — checks mute state
- `src/core/entities/PlayerRemote.js:145` — checks mute state
- `src/core/entities/AdminLocalPlayer.js:45` — checks mute state
- `src/core/entities/AdminPlayerRemote.js:107` — checks mute state

### Other
- `src/core/extras/createPlayerProxy.js:203-228` — screen share target + voice modifier API
- `src/core/nodes/Video.js:122` — registers/unregisters screen nodes
- `src/client/components/MainMenu.js:47` — voice UI (mic toggle, mute status)
