import * as ecs from '@8thwall/ecs'

declare const window: Window & {_camPos?: {x: number; y: number; z: number}}

// ── Animation clip names (from GLB inspection) ──────────────────────────────
const CLIPS = {
  fall: 'Armature|Fall_from_Bar|baselayer',
  walk: 'Armature|Monster_Walk|baselayer',
  idle: 'Armature|Idle_9|baselayer',
  scan: 'Armature|Walking_Scan_with_Sudden_Look_Back|baselayer',
  run:  'Armature|running|baselayer',
}

const ASSETS = {
  fall: 'assets/bat-fall.glb',
  walk: 'assets/bat-walk.glb',
  idle: 'assets/bat-idle.glb',
  scan: 'assets/bat-scan.glb',
  run:  'assets/bat-run.glb',
}

// Fixed durations (ms) derived from animation lengths
const FALL_MS  = 1400   // Fall_from_Bar  1.367s
const SCAN_MS  = 6800   // Walking_Scan   6.767s
const IDLE_MS  = 10000  // idle + talk buffer (audio is 8.62s, speech starts mid-walk)

type Phase = 'falling' | 'walking' | 'idle' | 'leaving' | 'rushing' | 'gone'

ecs.registerComponent({
  name: 'goblin-sequence',
  schema: {
    walkSpeed:    ecs.f32,
    stopDistance: ecs.f32,
    rushSpeed:    ecs.f32,
    rushDistance: ecs.f32,
  },
  schemaDefaults: {
    walkSpeed:    0.4,
    stopDistance: 2.5,
    rushSpeed:    2.5,
    rushDistance: 0.3,
  },

  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    // ── position state ───────────────────────────────────────────────────────
    const localPos = ecs.math.vec3.zero()
    let posX = 0
    let posZ = 0
    let landingY = 0

    // smoothed camera
    let smoothCamX = 0
    let smoothCamZ = 0
    let camReady = false

    // phase bookkeeping
    let phase: Phase = 'falling'
    let phaseStart = 0
    let initialized = false
    let speechFired = false
    let walkStartDist = 0

    // ── helpers ──────────────────────────────────────────────────────────────
    const getCam = () => {
      const c = window._camPos ?? {x: 0, y: 0, z: 0}
      if (!camReady) { smoothCamX = c.x; smoothCamZ = c.z; camReady = true }
      smoothCamX += (c.x - smoothCamX) * 0.05
      smoothCamZ += (c.z - smoothCamZ) * 0.05
      return {x: smoothCamX, z: smoothCamZ}
    }

    const faceDir = (dx: number, dz: number) => {
      world.getEntity(eid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(dx, dz)))
    }

    const setModel = (src: string, clip: string, loop: boolean) => {
      ;(ecs.GltfModel as any).set(world, eid, {url: src, animationClip: clip, loop})
    }

    const dt = () => Math.min((world.time?.delta ?? 16) / 1000, 0.1)

    const enterPhase = (p: Phase) => {
      phase = p
      phaseStart = Date.now()
      switch (p) {
        case 'falling':
          setModel(ASSETS.fall, CLIPS.fall, false)
          break
        case 'walking':
          walkStartDist = (() => {
            const cam = getCam()
            const dx = cam.x - posX
            const dz = cam.z - posZ
            return Math.sqrt(dx * dx + dz * dz)
          })()
          speechFired = false
          setModel(ASSETS.walk, CLIPS.walk, true)
          break
        case 'idle':
          setModel(ASSETS.idle, CLIPS.idle, true)
          break
        case 'leaving':
          setModel(ASSETS.scan, CLIPS.scan, false)
          break
        case 'rushing':
          setModel(ASSETS.run, CLIPS.run, true)
          break
        case 'gone':
          world.getEntity(eid).hide()
          break
      }
    }

    // ── single tick state ────────────────────────────────────────────────────
    defineState('active').initial().onTick(() => {
      if (!initialized) {
        world.transform.getLocalPosition(eid, localPos)
        posX = localPos.x
        posZ = localPos.z
        landingY = localPos.y
        initialized = true
        enterPhase('falling')
        return
      }

      const elapsed = Date.now() - phaseStart
      const cam = getCam()
      const {walkSpeed, stopDistance, rushSpeed, rushDistance} = schemaAttribute.get(eid)
      const d = dt()

      switch (phase) {

        // ── fall ─────────────────────────────────────────────────────────────
        case 'falling': {
          if (elapsed >= FALL_MS) enterPhase('walking')
          break
        }

        // ── monster walk toward camera ────────────────────────────────────────
        case 'walking': {
          const dx = cam.x - posX
          const dz = cam.z - posZ
          const dist = Math.sqrt(dx * dx + dz * dz)

          // fire speech event when goblin is ~halfway through its approach
          if (!speechFired && walkStartDist > 0 && dist < walkStartDist * 0.55) {
            speechFired = true
            window.dispatchEvent(new CustomEvent('goblin-speech-start'))
          }

          if (dist <= stopDistance) {
            world.getEntity(eid).setLocalPosition({x: posX, y: landingY, z: posZ})
            faceDir(dx, dz)
            enterPhase('idle')
            break
          }

          const nx = dx / dist
          const nz = dz / dist
          posX += nx * walkSpeed * d
          posZ += nz * walkSpeed * d
          world.getEntity(eid).setLocalPosition({x: posX, y: landingY, z: posZ})
          faceDir(nx, nz)
          break
        }

        // ── idle / talking ────────────────────────────────────────────────────
        case 'idle': {
          faceDir(cam.x - posX, cam.z - posZ)
          if (elapsed >= IDLE_MS) enterPhase('leaving')
          break
        }

        // ── scan + walk away ─────────────────────────────────────────────────
        case 'leaving': {
          const dx = posX - cam.x
          const dz = posZ - cam.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist > 0.01) {
            const nx = dx / dist
            const nz = dz / dist
            posX += nx * walkSpeed * d
            posZ += nz * walkSpeed * d
            world.getEntity(eid).setLocalPosition({x: posX, y: landingY, z: posZ})
            faceDir(nx, nz)
          }
          if (elapsed >= SCAN_MS) enterPhase('rushing')
          break
        }

        // ── sprint toward camera, get very close, vanish ──────────────────────
        case 'rushing': {
          const dx = cam.x - posX
          const dz = cam.z - posZ
          const dist = Math.sqrt(dx * dx + dz * dz)

          if (dist <= rushDistance) {
            enterPhase('gone')
            break
          }

          const nx = dx / dist
          const nz = dz / dist
          posX += nx * rushSpeed * d
          posZ += nz * rushSpeed * d
          world.getEntity(eid).setLocalPosition({x: posX, y: landingY, z: posZ})
          faceDir(nx, nz)
          break
        }

        case 'gone':
          break
      }
    })
  },
})
