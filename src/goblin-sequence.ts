import * as ecs from '@8thwall/ecs'

declare const window: Window & {
  _camPos?: {x: number; y: number; z: number}
  _dbg?: (msg: string) => void
}
const log = (msg: string) => { if (window._dbg) window._dbg('[seq] ' + msg) }

// ── Per-phase marker components (one on each phase entity in the scene) ──────
// The sequence controller queries these to find and show/hide the right mesh.
const FallPhase = ecs.registerComponent({name: 'bat-phase-fall'})
const WalkPhase = ecs.registerComponent({name: 'bat-phase-walk'})
const IdlePhase = ecs.registerComponent({name: 'bat-phase-idle'})
const ScanPhase = ecs.registerComponent({name: 'bat-phase-scan'})
const RunPhase  = ecs.registerComponent({name: 'bat-phase-run'})

const fallQ = ecs.defineQuery([FallPhase])
const walkQ = ecs.defineQuery([WalkPhase])
const idleQ = ecs.defineQuery([IdlePhase])
const scanQ = ecs.defineQuery([ScanPhase])
const runQ  = ecs.defineQuery([RunPhase])

// ── Phase durations (ms, from GLB animation inspection) ──────────────────────
const FALL_MS = 1400   // Fall_from_Bar  1.367 s
const IDLE_MS = 10000  // idle/talk buffer — audio is 8.62 s, speech fires mid-walk
const SCAN_MS = 6800   // Walking_Scan_with_Sudden_Look_Back  6.767 s

type Phase = 'waiting' | 'falling' | 'walking' | 'idle' | 'leaving' | 'rushing' | 'gone'

// ── Controller component (attach to an invisible entity in the scene) ─────────
ecs.registerComponent({
  name: 'goblin-sequence',
  schema: {
    startDelay:   ecs.f32,   // ms to wait after SLAM ready before falling in
    walkSpeed:    ecs.f32,
    stopDistance: ecs.f32,
    rushSpeed:    ecs.f32,
    rushDistance: ecs.f32,   // distance at which goblin vanishes during rush
  },
  schemaDefaults: {
    startDelay:   4000,
    walkSpeed:    0.4,
    stopDistance: 2.5,
    rushSpeed:    2.5,
    rushDistance: 0.3,
  },

  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    // ── shared position state ─────────────────────────────────────────────────
    const localPos = ecs.math.vec3.zero()
    let posX = 0
    let posZ = 0
    let landingY = 0

    // smoothed camera position (reduces SLAM jitter)
    let smoothCamX = 0
    let smoothCamZ = 0
    let camReady = false

    // phase bookkeeping
    let phase: Phase = 'waiting'
    let phaseStart = 0
    let initialized = false
    let speechFired = false
    let walkStartDist = 0

    // ── helpers ───────────────────────────────────────────────────────────────
    const getCam = () => {
      const c = window._camPos ?? {x: 0, y: 0, z: 0}
      if (!camReady) { smoothCamX = c.x; smoothCamZ = c.z; camReady = true }
      smoothCamX += (c.x - smoothCamX) * 0.05
      smoothCamZ += (c.z - smoothCamZ) * 0.05
      return {x: smoothCamX, z: smoothCamZ}
    }

    const faceDir = (activeEid: ecs.Eid, dx: number, dz: number) => {
      world.getEntity(activeEid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(dx, dz)))
    }

    // Returns the mesh entity for a given phase, or undefined
    const phaseEid = (p: Phase): ecs.Eid | undefined => {
      if (p === 'falling') return fallQ(world)[0]
      if (p === 'walking') return walkQ(world)[0]
      if (p === 'idle')    return idleQ(world)[0]
      if (p === 'leaving') return scanQ(world)[0]
      if (p === 'rushing') return runQ(world)[0]
      return undefined
    }

    const enterPhase = (next: Phase) => {
      log(`enterPhase ${phase} → ${next}  pos=(${posX.toFixed(2)},${landingY.toFixed(2)},${posZ.toFixed(2)})`)

      // hide outgoing mesh
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

      if (next === 'walking') {
        const cam = getCam()
        const dx = cam.x - posX
        const dz = cam.z - posZ
        walkStartDist = Math.sqrt(dx * dx + dz * dz)
        speechFired = false
        log(`walkStartDist=${walkStartDist.toFixed(2)}  cam=(${cam.x.toFixed(2)},${cam.z.toFixed(2)})`)
      }

      world.getEntity(inEid).setLocalPosition({x: posX, y: landingY, z: posZ})
      world.getEntity(inEid).show()
    }

    // ── single ECS state, internal phase switch ───────────────────────────────
    defineState('active').initial().onTick(() => {
      if (!initialized) {
        // Wait for SLAM to be live before reading transforms.
        // getLocalPosition returns (0,0,0) on the very first ECS tick
        // before entity positions are committed — reading too early puts
        // the bat at the world origin (right in the user's face).
        if (!window._camPos) return
        world.transform.getLocalPosition(eid, localPos)
        posX = localPos.x
        posZ = localPos.z
        landingY = localPos.y
        initialized = true
        phaseStart = Date.now()
        log(`init  pos=(${posX.toFixed(2)},${landingY.toFixed(2)},${posZ.toFixed(2)})  cam=(${window._camPos.x.toFixed(2)},${window._camPos.z.toFixed(2)})`)
        // 'waiting' phase already set — no mesh shown yet
        return
      }

      const elapsed = Date.now() - phaseStart
      const {startDelay, walkSpeed, stopDistance, rushSpeed, rushDistance} = schemaAttribute.get(eid)
      const dt = Math.min((world.time?.delta ?? 16) / 1000, 0.1)
      const cam = getCam()

      // ── waiting for scan prompt to clear ─────────────────────────────────
      if (phase === 'waiting') {
        if (elapsed >= startDelay) enterPhase('falling')
        return
      }

      const aEid = phaseEid(phase)

      switch (phase) {

        // ── fall from above ────────────────────────────────────────────────
        case 'falling': {
          if (elapsed >= FALL_MS) enterPhase('walking')
          break
        }

        // ── monster-walk toward camera ─────────────────────────────────────
        case 'walking': {
          if (aEid == null) break
          const dx = cam.x - posX
          const dz = cam.z - posZ
          const dist = Math.sqrt(dx * dx + dz * dz)

          // dispatch speech event when ~halfway through the approach
          if (!speechFired && walkStartDist > 0 && dist < walkStartDist * 0.55) {
            speechFired = true
            window.dispatchEvent(new CustomEvent('goblin-speech-start'))
          }

          if (dist <= stopDistance) {
            world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
            faceDir(aEid, dx, dz)
            enterPhase('idle')
            break
          }

          const nx = dx / dist
          const nz = dz / dist
          posX += nx * walkSpeed * dt
          posZ += nz * walkSpeed * dt
          world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
          faceDir(aEid, nx, nz)
          break
        }

        // ── idle / talking ─────────────────────────────────────────────────
        case 'idle': {
          if (aEid == null) break
          world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
          faceDir(aEid, cam.x - posX, cam.z - posZ)
          if (elapsed >= IDLE_MS) enterPhase('leaving')
          break
        }

        // ── scan + walk away ───────────────────────────────────────────────
        case 'leaving': {
          if (aEid == null) break
          const dx = posX - cam.x
          const dz = posZ - cam.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist > 0.01) {
            posX += (dx / dist) * walkSpeed * dt
            posZ += (dz / dist) * walkSpeed * dt
            world.getEntity(aEid).setLocalPosition({x: posX, y: landingY, z: posZ})
            faceDir(aEid, dx / dist, dz / dist)
          }
          if (elapsed >= SCAN_MS) enterPhase('rushing')
          break
        }

        // ── sprint at camera, vanish when very close ───────────────────────
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
          faceDir(aEid, nx, nz)
          break
        }

        case 'gone':
          break
      }
    })
  },
})
