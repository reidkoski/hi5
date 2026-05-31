window._camPos = null

const onxrloaded = () => {
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
  LandingPage.configure({mediaSrc: './assets/preview.jpg'})

  // Web Audio API — more reliable than HTMLAudioElement on iOS
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const audioCtx = new AudioCtx()
  let audioBuffer = null
  let audioPlayed = false

  fetch('./assets/goblin-speech.m4a')
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => { audioBuffer = decoded })
    .catch(console.error)

  const playAudio = () => {
    if (audioPlayed || !audioBuffer || audioCtx.state !== 'running') return
    audioPlayed = true
    const src = audioCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(audioCtx.destination)
    src.start(0)
  }

  // Resume AudioContext on first touch (landing page tap unlocks it)
  document.addEventListener('touchstart', () => {
    audioCtx.resume()
  }, {once: true, capture: true})

  XR8.addCameraPipelineModule({
    name: 'goblin-systems',
    onUpdate: ({processCpuResult}) => {
      if (processCpuResult?.reality?.position) {
        window._camPos = processCpuResult.reality.position
      }
    },
    onReality: {
      ready: () => {
        setTimeout(playAudio, 2500)
      },
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
