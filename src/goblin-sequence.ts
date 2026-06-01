import * as ecs from '@8thwall/ecs'

declare const window: Window & {
  _camPos?: {x: number; y: number; z: number}
  _dbg?: (msg: string) => void
}
const log = (msg: string) => { if (window._dbg) window._dbg('[seq] ' + msg) }

// ── Per-phase marker components ───────────────────────────────────────────────
const FallPhase = ecs.registerComponent({name: 'bat-phase-fall'})
const WalkPhase = ecs.registerComponent({name: 'bat-phase-walk'})
const IdlePhase = ecs.registerComponent({name: 'bat-phase-idle'})
const RunPhase  = ecs.registerComponent({name: 'bat-phase-run'})
// bat-phase-scan still registered so the scene entity doesn't error
ecs.registerComponent({name: 'bat-phase-scan'})

const fallQ = ecs.defineQuery([FallPhase])
const walkQ = ecs.defineQuery([WalkPhase])
const idleQ = ecs.defineQuery([IdlePhase])
const runQ  = ecs.defineQuery([RunPhase])

// ── Timing constants ──────────────────────────────────────────────────────────
const FALL_MS     = 1400   // Fall_from_Bar animation length
const FALL_HEIGHT = 3.0    // metres above ground the bat starts — sells the "from sky" drop
const IDLE_MS     = 20000  // generous fallback; rush is normally event-driven

type Phase = 'waiting' | 'falling' | 'walking' | 'idle' | 'rushing' | 'gone'

ecs.registerComponent({
  name: 'goblin-sequence',
  schema: {
    startDelay:   ecs.f32,
    walkSpeed:    ecs.f32,
    stopDistance: ecs.f32,
    rushSpeed:    ecs.f32,
    rushDistance: ecs.f32,
  },
  schemaDefaults: {
    startDelay:   2000,   // ms after SLAM ready — bat falls in while scan prompt is fading
    walkSpeed:    0.65,   // m/s — faster = less dead time
    stopDistance: 2.0,    // m — stop closer so idle kicks in sooner
    rushSpeed:    2.5,
    rushDistance: 0.3,
  },

  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    const localPos = ecs.math.vec3.zero()
    let posX = 0
    let posZ = 0
    let landingY = 0

    let smoothCamX = 0
    let smoothCamZ = 0
    let camReady = false

    let phase: Phase = 'waiting'
    let phaseStart = 0
    let initialized = false
    let speechFired = false
    let rushPending = false

    // Listen for audio-driven rush trigger from app.js
    window.addEventListener('goblin-rush', () => {
      rushPending = true
      log('goblin-rush received')
    }, {once: true})

    // ── helpers ───────────────────────────────────────────────────────────────
    const getCam = () => {
      const c = window._camPos ?? {x: 0, y: 0, z: 0}
      if (!camReady) { smoothCamX = c.x; smoothCamZ = c.z; camReady = true }
      smoothCamX += (c.x - smoothCamX) * 0.05
      smoothCamZ += (c.z - smoothCamZ) * 0.05
      return {x: smoothCamX, z: smoothCamZ}
    }

    const faceTowardCam = (activeEid: ecs.Eid) => {
      const cam = getCam()
      const dx = cam.x - posX
      const dz = cam.z - posZ
      world.getEntity(activeEid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(dx, dz)))
    }

    const phaseEid = (p: Phase): ecs.Eid | undefined => {
      if (p === 'falling') return fallQ(world)[0]
      if (p === 'walking') return walkQ(world)[0]
      if (p === 'idle')    return idleQ(world)[0]
      if (p === 'rushing') return runQ(world)[0]
      return undefined
    }

    const enterPhase = (next: Phase) => {
      log(`enterPhase ${phase} → ${next}  pos=(${posX.toFixed(2)},${landingY.toFixed(2)},${posZ.toFixed(2)})`)

      const outEid = phaseEid(phase)
      if (outEid != null) world.getEntity(outEid).hide()

      phase = next
      phaseStart = Date.now()

      if (next === 'gone') return

      const inEid = phaseEid(next)
      if (inEid == null) {
        log(`WARNING: no entity found for phase ${next}`)
        return
      }

      // Fall phase: start high so the bat visibly drops from the sky
      const spawnY = next === 'falling' ? landingY + FALL_HEIGHT : landingY
      world.getEntity(inEid).setLocalPosition({x: posX, y: spawnY, z: posZ})
      faceTowardCam(inEid)
      world.getEntity(inEid).show()
    }

    // ── main tick ─────────────────────────────────────────────────────────────
    defineState('active').initial().onTick(() => {
      if (!initialized) {
        // Wait for SLAM: getLocalPosition returns (0,0,0) on the first ECS tick
        // before entity transforms are committed — reading too early puts the bat
        // at the world origin (right in the user's face).
        if (!window._camPos) return
        world.transform.getLocalPosition(eid, localPos)
        posX = localPos.x
        posZ = localPos.z
        landingY = localPos.y
        initialized = true
        phaseStart = Date.now()
        log(`init  pos=(${posX.toFixed(2)},${landingY.toFixed(2)},${posZ.toFixed(2)})  cam=(${window._camPos.x.toFixed(2)},${window._camPos.z.toFixed(2)})`)
        return
      }

      const elapsed = Date.now() - phaseStart
      const {startDelay, walkSpeed, stopDistance, rushSpeed, rushDistance} = schemaAttribute.get(eid)
      const dt = Math.min((world.time?.delta ?? 16) / 1000, 0.1)
      const cam = getCam()

      // ── waiting ───────────────────────────────────────────────────────────
      if (phase === 'waiting') {
        if (elapsed >= startDelay) enterPhase('falling')
        return
      }

      const aEid = phaseEid(phase)

      switch (phase) {

        // ── fall from sky ─────────────────────────────────────────────────
        case 'falling': {
          if (aEid == null) break
          // Smoothly descend from FALL_HEIGHT to ground during the animation
          const t = Math.min(elapsed / FALL_MS, 1)
          const ease = t * t * (3 - 2 * t)  // smoothstep
          const currentY = landingY + FALL_HEIGHT * (1 - ease)
          world.getEntity(aEid).setLocalPosition({x: posX, y: currentY, z: posZ})
          if (elapsed >= FALL_MS) enterPhase('walking')
          break
        }

        // ── monster-walk toward camera ────────────────────────────────────
        case 'walking': {
          if (aEid == null) break

          // Fire speech as soon as walking starts
          if (!speechFired) {
            speechFired = true
            window.dispatchEvent(new CustomEvent('goblin-speech-start'))
            log('goblin-speech-start fired')
          }

          const dx = cam.x - posX
          const dz = cam.z - posZ
          const dist = Math.sqrt(dx * dx + dz * dz)

          if (dist <= stopDistance) {
            world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
            faceTowardCam(aEid)
            enterPhase('idle')
            break
          }

          const nx = dx / dist
          const nz = dz / dist
          posX += nx * walkSpeed * dt
          posZ += nz * walkSpeed * dt
          world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
          world.getEntity(aEid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(nx, nz)))
          break
        }

        // ── idle / talking ────────────────────────────────────────────────
        case 'idle': {
          if (aEid == null) break
          world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
          faceTowardCam(aEid)
          // Rush triggered by audio (0.5s before it ends), with a long fallback
          if (rushPending || elapsed >= IDLE_MS) enterPhase('rushing')
          break
        }

        // ── sprint at camera — no walking-away phase ──────────────────────
        case 'rushing': {
          if (aEid == null) break
          const dx = cam.x - posX
          const dz = cam.z - posZ
          const dist = Math.sqrt(dx * dx + dz * dz)

          if (dist <= rushDistance) {
            enterPhase('gone')
            break
          }

          const nx = dx / dist
          const nz = dz / dist
          posX += nx * rushSpeed * dt
          posZ += nz * rushSpeed * dt
          world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
          world.getEntity(aEid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(nx, nz)))
          break
        }

        case 'gone':
          break
      }
    })
  },
})
