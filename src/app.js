const onxrloaded = () => {
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
  LandingPage.configure({
    mediaSrc: './assets/preview.jpg'
  })

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

  // iOS requires audio to be triggered from a direct user gesture.
  // Play muted during the landing page tap to unlock the audio context,
  // then unmute and play for real once AR is ready.
  const unlockAudio = () => {
    if (unlocked) return
    audio.muted = true
    audio.play().then(() => {
      audio.pause()
      audio.currentTime = 0
      unlocked = true
      tryPlay()
    }).catch(() => {
      unlocked = true  // mark unlocked anyway and hope for the best
      tryPlay()
    })
  }

  document.addEventListener('touchstart', unlockAudio, {once: true, capture: true})
  document.addEventListener('click', unlockAudio, {once: true, capture: true})

  XR8.addCameraPipelineModule({
    name: 'goblin-audio',
    onReality: {
      ready: () => {
        // Small delay so SLAM stabilises and intro animation plays first
        setTimeout(() => {
          arReady = true
          tryPlay()
        }, 2000)
      },
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
