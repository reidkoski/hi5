import * as ecs from '@8thwall/ecs'

const WALK_READY = 'walk-ready'

ecs.registerComponent({
  name: 'walk-toward-camera',
  schema: {
    camera: 'eid',
    speed: ecs.f32,
    stopDistance: ecs.f32,
    startDelay: ecs.f32,   // seconds to wait before walking (let intro finish)
  },
  stateMachine: ({world, eid, schemaAttribute, defineState}) => {
    let elapsed = 0

    defineState('waiting')
      .initial()
      .onEvent(WALK_READY, 'walking', {target: eid})
      .onTick(() => {
        elapsed += world.time?.delta ?? 16
        if (elapsed >= schemaAttribute.get(eid).startDelay * 1000) {
          world.events.dispatch(eid, WALK_READY)
        }
      })

    defineState('walking').onTick(() => {
      const {camera: camEid, speed, stopDistance} = schemaAttribute.get(eid)
      if (!camEid) return

      const gPos = world.getEntity(eid).getLocalPosition()
      const cPos = world.getEntity(camEid).getLocalPosition()
      if (!gPos || !cPos) return

      const dx = cPos.x - gPos.x
      const dz = cPos.z - gPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= stopDistance) return

      const nx = dx / dist
      const nz = dz / dist
      const dt = (world.time?.delta ?? 16) / 1000

      world.getEntity(eid).setLocalPosition({
        x: gPos.x + nx * speed * dt,
        y: 0,
        z: gPos.z + nz * speed * dt,
      })
      world.getEntity(eid).set(ecs.Quaternion, ecs.math.quat.yRadians(Math.atan2(nx, nz)))
    })
  },
})
