import * as ecs from '@8thwall/ecs'

// Camera position is set each frame by app.js via XR8's onUpdate pipeline
declare const window: Window & {_camPos?: {x: number; y: number; z: number}}

ecs.registerComponent({
  name: 'walk-toward-camera',
  schema: {
    speed: ecs.f32,
    stopDistance: ecs.f32,
    startDelay: ecs.f32,
  },
  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    let startTime: number | null = null
    let posX = 0
    let posZ = 0

    defineState('active').initial().onTick(() => {
      if (startTime === null) startTime = Date.now()

      const {speed, stopDistance, startDelay} = schemaAttribute.get(eid)
      if (Date.now() - startTime < startDelay * 1000) return

      const cam = window._camPos
      if (!cam) return

      const dx = cam.x - posX
      const dz = cam.z - posZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= stopDistance) return

      const nx = dx / dist
      const nz = dz / dist
      const dt = Math.min((world.time?.delta ?? 16) / 1000, 0.1)

      posX += nx * speed * dt
      posZ += nz * speed * dt

      world.getEntity(eid).setLocalPosition({x: posX, y: 0, z: posZ})
      world.getEntity(eid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(nx, nz)))
    })
  },
})
