window._camPos = null

// --- Audio debug overlay (append ?debug to the URL to enable) ---
const DEBUG_AUDIO = new URLSearchParams(location.search).has('debug')
const dbg = (() => {
  if (!DEBUG_AUDIO) return () => {}
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'max-height:40vh', 'overflow-y:auto',
    'background:rgba(0,0,0,0.75)', 'color:#0f0',
    'font:11px/1.4 monospace', 'padding:6px 8px',
    'z-index:9999', 'pointer-events:none',
  ].join(';')
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(panel))
  // also add it immediately if DOM already ready
  if (document.body) document.body.appendChild(panel)
  const log = msg => {
    console.log('[dbg]', msg)
    const t = new Date().toISOString().slice(11, 22)
    const line = document.createElement('div')
    line.textContent = `${t}  ${msg}`
    panel.appendChild(line)
    panel.scrollTop = panel.scrollHeight
  }
  window._dbg = log   // expose for goblin-sequence.ts
  return log
})()

const onxrloaded = () => {
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
  LandingPage.configure({mediaSrc: './assets/preview.jpg'})

  // Web Audio API — more reliable than HTMLAudioElement on iOS
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const audioCtx = new AudioCtx()
  dbg(`AudioContext created — state: ${audioCtx.state}`)

  let audioBuffer = null
  let audioPlayed = false
  let realityReadyAt = null
  const speechDelayMs = 2500

  const tryPlayAudio = () => {
    dbg(`tryPlayAudio — played:${audioPlayed} buffer:${!!audioBuffer} readyAt:${!!realityReadyAt} ctxState:${audioCtx.state}`)
    if (audioPlayed || !audioBuffer || !realityReadyAt) return
    const waitMs = realityReadyAt + speechDelayMs - Date.now()
    if (waitMs > 0) {
      dbg(`waiting ${waitMs}ms more before play`)
      setTimeout(tryPlayAudio, waitMs)
      return
    }
    if (audioCtx.state !== 'running') {
      dbg(`ctx not running (${audioCtx.state}) — calling resume()`)
      audioCtx.resume().then(tryPlayAudio).catch(e => dbg(`resume error: ${e}`))
      return
    }
    dbg('PLAYING audio now')
    audioPlayed = true
    const src = audioCtx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(audioCtx.destination)
    src.start(0)
    src.onended = () => dbg('audio ended')
    // Tell goblin-sequence to start rushing 0.5 s before audio ends
    const rushMs = Math.max(0, (audioBuffer.duration - 0.5) * 1000)
    dbg(`rush scheduled in ${(rushMs / 1000).toFixed(1)}s  (audio ${audioBuffer.duration.toFixed(2)}s)`)
    setTimeout(() => window.dispatchEvent(new CustomEvent('goblin-rush')), rushMs)
  }

  fetch('./assets/goblin-speech.m4a')
    .then(r => {
      dbg(`fetch ok — status ${r.status}`)
      return r.arrayBuffer()
    })
    .then(buf => {
      dbg(`arrayBuffer ready — ${buf.byteLength} bytes — decoding…`)
      return audioCtx.decodeAudioData(buf)
    })
    .then(decoded => {
      dbg(`decode ok — duration ${decoded.duration.toFixed(2)}s`)
      audioBuffer = decoded
      tryPlayAudio()
    })
    .catch(e => dbg(`fetch/decode error: ${e}`))

  const unlockAudio = () => {
    dbg(`unlockAudio — ctx state before resume: ${audioCtx.state}`)
    audioCtx.resume().then(() => {
      dbg(`resume resolved — ctx state: ${audioCtx.state}`)
      // Play a silent 1-sample buffer — permanently activates Web Audio on iOS,
      // preventing the context from auto-suspending before the speech fires.
      const silentBuf = audioCtx.createBuffer(1, 1, 22050)
      const silentSrc = audioCtx.createBufferSource()
      silentSrc.buffer = silentBuf
      silentSrc.connect(audioCtx.destination)
      silentSrc.start(0)
      dbg('silent buffer played')
      tryPlayAudio()
    }).catch(e => dbg(`unlockAudio resume error: ${e}`))
  }

  // Resume AudioContext on first interaction. The landing page tap usually unlocks it on mobile.
  document.addEventListener('touchstart', () => { dbg('touchstart fired'); unlockAudio() }, {once: true, capture: true})
  document.addEventListener('pointerdown', () => { dbg('pointerdown fired'); unlockAudio() }, {once: true, capture: true})
  document.addEventListener('click', () => { dbg('click fired'); unlockAudio() }, {once: true, capture: true})

  // Audio is triggered by goblin-sequence dispatching 'goblin-speech-start'
  // when the goblin is halfway through its walk-toward-camera phase.
  // A fallback timer fires 12s after reality-ready in case the event is missed.
  window.addEventListener('goblin-speech-start', () => {
    dbg('goblin-speech-start event → tryPlayAudio')
    tryPlayAudio()
  }, {once: true})

  // onReality.ready doesn't fire in 8th Wall ECS v2 pipeline modules, so we
  // detect reality-ready by watching for the first camera position in onUpdate.
  let realityReadyFired = false
  const onRealityReady = () => {
    realityReadyAt = Date.now()
    dbg(`reality ready (via onUpdate)`)
    setTimeout(tryPlayAudio, 12000) // fallback only

    // Show scan prompt, fade out just before goblin starts walking (startDelay 4.0s).
    const prompt = document.getElementById('scan-prompt')
    if (prompt) {
      prompt.style.opacity = '1'
      setTimeout(() => { prompt.style.opacity = '0' }, 3200)
      setTimeout(() => { prompt.remove() }, 3800)
    }
  }

  XR8.addCameraPipelineModule({
    name: 'goblin-systems',
    onUpdate: ({processCpuResult}) => {
      if (processCpuResult?.reality?.position) {
        window._camPos = processCpuResult.reality.position
        if (!realityReadyFired) {
          realityReadyFired = true
          onRealityReady()
        }
      }
    },
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
