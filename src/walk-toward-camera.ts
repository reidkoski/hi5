import * as ecs from '@8thwall/ecs'

declare const window: Window & {_camPos?: {x: number; y: number; z: number}}

const StaticGoblin = ecs.registerComponent({name: 'static-goblin'})
const staticGoblinQuery = ecs.defineQuery([StaticGoblin])

ecs.registerComponent({
  name: 'walk-toward-camera',
  schema: {
    speed: ecs.f32,
    stopDistance: ecs.f32,
    startDelay: ecs.f32,
    fallHeight: ecs.f32,
    fallDuration: ecs.f32,
    staticTarget: 'eid',
  },
  schemaDefaults: {
    speed: 0.75,
    stopDistance: 1.25,
    startDelay: 1.4,
    fallHeight: 4,
    fallDuration: 1.2,
  },
  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    let startTime: number | null = null
    let posX = 0
    let posZ = 0
    let landingY = 0
    let initialized = false
    // Smoothed camera position to reduce SLAM jitter
    let smoothCamX = 0
    let smoothCamZ = 0
    let camInitialized = false
    let stopped = false
    const localPosition = ecs.math.vec3.zero()

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const showStaticPose = (target: bigint, yaw: number) => {
      const targetEid = target || staticGoblinQuery(world)[0]
      if (!targetEid) return
      const staticEntity = world.getEntity(targetEid)
      staticEntity.setLocalPosition({x: posX, y: landingY, z: posZ})
      staticEntity.set(ecs.Quaternion, ecs.math.quat.yRadians(yaw))
      staticEntity.show()
      world.getEntity(eid).hide()
    }

    defineState('active').initial().onTick(() => {
      if (stopped) return

      const now = Date.now()
      const {speed, stopDistance, startDelay, fallHeight, fallDuration, staticTarget} = schemaAttribute.get(eid)

      if (!initialized) {
        world.transform.getLocalPosition(eid, localPosition)
        posX = localPosition.x
        posZ = localPosition.z
        landingY = localPosition.y
        world.getEntity(eid).setLocalPosition({x: posX, y: landingY + fallHeight, z: posZ})
        initialized = true
      }

      if (startTime === null) startTime = now

      const elapsed = (now - startTime) / 1000
      const fallProgress = Math.min(elapsed / Math.max(fallDuration, 0.001), 1)
      const y = landingY + fallHeight * (1 - easeOutCubic(fallProgress))

      if (elapsed < startDelay) {
        world.getEntity(eid).setLocalPosition({x: posX, y, z: posZ})
        return
      }

      const cam = window._camPos ?? {x: 0, y: 0, z: 0}

      // Initialize smooth cam on first frame
      if (!camInitialized) {
        smoothCamX = cam.x
        smoothCamZ = cam.z
        camInitialized = true
      }

      // Low-pass filter on camera position — smooths out SLAM jitter
      const alpha = 0.05
      smoothCamX += (cam.x - smoothCamX) * alpha
      smoothCamZ += (cam.z - smoothCamZ) * alpha

      const dx = smoothCamX - posX
      const dz = smoothCamZ - posZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= stopDistance) {
        world.getEntity(eid).setLocalPosition({x: posX, y: landingY, z: posZ})
        showStaticPose(staticTarget, Math.atan2(dx, dz))
        stopped = true
        return
      }

      const nx = dx / dist
      const nz = dz / dist
      const dt = Math.min((world.time?.delta ?? 16) / 1000, 0.1)

      posX += nx * speed * dt
      posZ += nz * speed * dt

      world.getEntity(eid).setLocalPosition({x: posX, y, z: posZ})
      world.getEntity(eid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(nx, nz)))
    })
  },
})
