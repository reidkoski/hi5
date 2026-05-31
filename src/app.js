window._camPos = null

const onxrloaded = () => {
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
  LandingPage.configure({mediaSrc: './assets/preview.jpg'})

  // Web Audio API — more reliable than HTMLAudioElement on iOS
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const audioCtx = new AudioCtx()
  let audioBuffer = null
  let audioPlayed = false
  let realityReadyAt = null
  const speechDelayMs = 2500

  const tryPlayAudio = () => {
    if (audioPlayed || !audioBuffer || !realityReadyAt) return
    const waitMs = realityReadyAt + speechDelayMs - Date.now()
    if (waitMs > 0) {
      setTimeout(tryPlayAudio, waitMs)
      return
    }
    if (audioCtx.state !== 'running') {
      audioCtx.resume().then(tryPlayAudio).catch(console.error)
      return
    }
    audioPlayed = true
    const src = audioCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(audioCtx.destination)
    src.start(0)
  }

  fetch('./assets/goblin-speech.m4a')
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => {
      audioBuffer = decoded
      tryPlayAudio()
    })
    .catch(console.error)

  const unlockAudio = () => {
    audioCtx.resume().then(tryPlayAudio).catch(console.error)
  }

  // Resume AudioContext on first interaction. The landing page tap usually unlocks it on mobile.
  document.addEventListener('touchstart', unlockAudio, {once: true, capture: true})
  document.addEventListener('pointerdown', unlockAudio, {once: true, capture: true})
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
        realityReadyAt = Date.now()
        setTimeout(tryPlayAudio, speechDelayMs)
      },
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
