window._camPos = null

const onxrloaded = () => {
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
  LandingPage.configure({mediaSrc: './assets/preview.jpg'})

  const audio = new Audio('./assets/goblin-speech.m4a')
  audio.preload = 'auto'
  let unlocked = false
  let arReady = false

  const tryPlay = () => {
    if (unlocked && arReady) {
      audio.muted = false
      audio.play().catch(console.error)
    }
  }

  const unlockAudio = () => {
    if (unlocked) return
    audio.muted = true
    audio.play().then(() => {
      audio.pause()
      audio.currentTime = 0
      unlocked = true
      tryPlay()
    }).catch(() => {
      unlocked = true
      tryPlay()
    })
  }

  document.addEventListener('touchstart', unlockAudio, {once: true, capture: true})
  document.addEventListener('click', unlockAudio, {once: true, capture: true})

  XR8.addCameraPipelineModule({
    name: 'goblin-systems',
    onUpdate: ({processCpuResult}) => {
      if (processCpuResult?.reality?.position) {
        window._camPos = processCpuResult.reality.position
      }
    },
    onReality: {
      ready: () => {
        setTimeout(() => {
          arReady = true
          tryPlay()
        }, 2000)
      },
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
