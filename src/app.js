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
    audioCtx.resume().then(() => {
      // Play a silent 1-sample buffer — permanently activates Web Audio on iOS,
      // preventing the context from auto-suspending before the speech fires.
      const silentBuf = audioCtx.createBuffer(1, 1, 22050)
      const silentSrc = audioCtx.createBufferSource()
      silentSrc.buffer = silentBuf
      silentSrc.connect(audioCtx.destination)
      silentSrc.start(0)
      tryPlayAudio()
    }).catch(console.error)
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

        // Show scan prompt immediately, then fade it out just before the goblin
        // starts walking (startDelay is 4.0s, so fade begins at 3.2s).
        const prompt = document.getElementById('scan-prompt')
        if (prompt) {
          prompt.style.opacity = '1'
          setTimeout(() => { prompt.style.opacity = '0' }, 3200)
          setTimeout(() => { prompt.remove() }, 3800)
        }
      },
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
