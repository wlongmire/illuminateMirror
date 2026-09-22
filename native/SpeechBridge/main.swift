// SpeechBridge — a tiny local companion process that does what the browser
// can't offline: continuous, on-device speech-to-text via macOS's Speech
// framework. It streams results to the page over Server-Sent Events on
// http://127.0.0.1:8765/, loopback-only. speech.js in the web app tries this
// first and falls back to the browser's own (cloud-backed) recognizer if
// it's not running — so the show still works either way, this just removes
// the internet dependency when it's running.
//
// Build:  ./build.sh   (produces SpeechBridge.app)
// Run:    open SpeechBridge.app       — must be launched this way (or by
//         double-clicking it in Finder), not by executing the binary
//         inside Contents/MacOS directly. macOS's TCC privacy prompts
//         (Microphone, Speech Recognition) only resolve this process's
//         bundle identity — and so only ever ask, rather than silently
//         crashing it — when launched through LaunchServices.
//
// Since `open` detaches this from your terminal, progress and errors are
// also written to /tmp/speechbridge.log — tail that if something's wrong.

import Foundation
import Speech
import AVFoundation
import Network

let logPath = "/tmp/speechbridge.log"
func log(_ message: String) {
  let line = "[\(Date())] \(message)\n"
  print(message)
  if let data = line.data(using: .utf8) {
    if let handle = FileHandle(forWritingAtPath: logPath) {
      handle.seekToEndOfFile()
      handle.write(data)
      handle.closeFile()
    } else {
      try? data.write(to: URL(fileURLWithPath: logPath))
    }
  }
}

let port: NWEndpoint.Port = 8765

// MARK: - Server-Sent Events server

// Deliberately minimal: it serves exactly two things to one client (the
// page) — `GET /gate?open=<dB>&close=<dB>[&end=<ms>]` sets the proximity
// gate's thresholds (and optionally the pause that ends an utterance), and
// any other request is treated as "please stream to me"
// (an open SSE stream). Only the request line is looked at.
final class SSEServer {
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private let queue = DispatchQueue(label: "speechbridge.sse")
  var onGate: ((_ openDb: Float, _ closeDb: Float, _ utteranceEndMs: Float?) -> Void)?

  func start() {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: port)
    guard let listener = try? NWListener(using: params) else {
      log("couldn't bind 127.0.0.1:\(port) — already running?")
      exit(1)
    }
    self.listener = listener
    listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
    listener.stateUpdateHandler = { state in
      if case .failed(let err) = state {
        log("listener failed: \(err)")
      }
    }
    listener.start(queue: queue)
    log("listening on http://127.0.0.1:\(port) — point the web app at this while offline.")
  }

  private func accept(_ conn: NWConnection) {
    let id = ObjectIdentifier(conn)
    conn.stateUpdateHandler = { [weak self] state in
      switch state {
      case .cancelled, .failed:
        self?.queue.async { self?.connections.removeValue(forKey: id) }
      default: break
      }
    }
    conn.start(queue: queue)
    // Wait for the client's request bytes before replying — sending before
    // the connection is actually writable can silently drop the response.
    conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
      guard let self = self, error == nil else { return }
      let requestLine = data
        .flatMap { String(data: $0, encoding: .utf8) }?
        .components(separatedBy: "\r\n").first ?? ""
      let target = requestLine.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
      if let url = URLComponents(string: target), url.path == "/gate" {
        self.handleGate(url, conn)
        return
      }
      let headers = "HTTP/1.1 200 OK\r\n"
        + "Content-Type: text/event-stream\r\n"
        + "Cache-Control: no-cache\r\n"
        + "Connection: keep-alive\r\n"
        + "Access-Control-Allow-Origin: *\r\n\r\n"
      conn.send(content: headers.data(using: .utf8), completion: .contentProcessed { _ in })
      self.queue.async { self.connections[id] = conn }
    }
  }

  private func handleGate(_ url: URLComponents, _ conn: NWConnection) {
    func value(_ name: String) -> Float? {
      url.queryItems?.first { $0.name == name }?.value.flatMap { Float($0) }
    }
    let ok = value("open") != nil && value("close") != nil
    if let open = value("open"), let close = value("close") {
      onGate?(open, close, value("end"))
    }
    let status = ok ? "204 No Content" : "400 Bad Request"
    let response = "HTTP/1.1 \(status)\r\n"
      + "Access-Control-Allow-Origin: *\r\n"
      + "Content-Length: 0\r\n"
      + "Connection: close\r\n\r\n"
    conn.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in conn.cancel() })
  }

  private func emit(_ event: String) {
    let data = event.data(using: .utf8)
    queue.async {
      for conn in self.connections.values {
        conn.send(content: data, completion: .contentProcessed { _ in })
      }
    }
  }

  func broadcastResult(transcript: String, isFinal: Bool) {
    guard let json = try? JSONSerialization.data(withJSONObject: ["transcript": transcript, "isFinal": isFinal]),
          let str = String(data: json, encoding: .utf8) else { return }
    emit("data: \(str)\n\n")
  }

  func broadcastState(listening: Bool) {
    guard let json = try? JSONSerialization.data(withJSONObject: ["state": listening ? "listening" : "idle"]),
          let str = String(data: json, encoding: .utf8) else { return }
    emit("event: state\ndata: \(str)\n\n")
  }

  func broadcastLevel(db: Float, gateOpen: Bool) {
    let clamped = db.isFinite ? Double(max(db, -120)) : -120
    guard let json = try? JSONSerialization.data(withJSONObject: ["db": clamped, "gateOpen": gateOpen]),
          let str = String(data: json, encoding: .utf8) else { return }
    emit("event: level\ndata: \(str)\n\n")
  }
}

// MARK: - Continuous on-device recognition

// SFSpeechRecognitionTask always finalizes on a pause in speech (there's no
// "continuous" flag like Web Speech API's) — so "continuous" here just
// means: immediately start a fresh task whenever one ends, mirroring the
// same restart-on-end pattern src/speech.js already uses for the browser
// recognizer.
final class SpeechBridge {
  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private let server: SSEServer
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var intentionalStop = false
  private var tapInstalled = false
  private var taskGeneration = 0

  // MARK: Proximity noise gate
  //
  // The mic sits right against the speaker's mouth, so their voice arrives
  // far louder than anyone talking a few feet away. Rather than transcribe
  // everything the mic hears, buffers below gateCloseDb are simply never
  // appended to the recognition request — as far as the recognizer is
  // concerned, distant/bystander speech is silence.
  //
  // Two thresholds (a Schmitt trigger) instead of one: the gate opens at
  // gateOpenDb and, once open, only closes once level drops below the
  // lower gateCloseDb — this stops a voice hovering right at one boundary
  // from chattering open/closed word to word. gateReleaseSec additionally
  // holds the gate open briefly after level drops, so the trailing end of
  // a word (naturally quieter than its middle) doesn't get clipped.
  //
  // The thresholds are tuned live from the page's style panel (sent via
  // GET /gate on every connect and every slider change); the values here
  // are only what's used before a page has connected. The measured level
  // streams back to the page (SSE "level" events) so tuning is visual.
  //
  // utteranceEndSec: once the gate has been closed this long since the last
  // loud audio, the current task is told its audio has ended, forcing a
  // final result and a fresh task. Without it, Apple's recognizer decides
  // on its own (observed ~1–2s of silence).
  private let gateLock = NSLock()
  private var gateOpenDb: Float = -30
  private var gateCloseDb: Float = -40
  private var utteranceEndSec: TimeInterval = 0.8
  private let gateReleaseSec: TimeInterval = 0.35
  private let levelBroadcastSec: TimeInterval = 0.1
  private var gateOpen = false
  private var lastLoudAt = Date.distantPast
  private var lastLevelSentAt = Date.distantPast
  // Per recognition task, reset in start().
  private var heardSpeechThisTask = false
  private var endRequested = false

  init(server: SSEServer) {
    self.server = server
  }

  func setGate(openDb: Float, closeDb: Float, utteranceEndMs: Float?) {
    gateLock.lock()
    gateOpenDb = openDb
    gateCloseDb = min(closeDb, openDb)
    if let ms = utteranceEndMs { utteranceEndSec = TimeInterval(max(ms, 0)) / 1000 }
    let endSec = utteranceEndSec
    gateLock.unlock()
    log(String(format: "gate set: open %.0f dB, close %.0f dB, utterance end %.2fs", openDb, min(closeDb, openDb), endSec))
  }

  private func levelDb(of buffer: AVAudioPCMBuffer) -> Float {
    guard let channelData = buffer.floatChannelData else { return -.infinity }
    let frameLength = Int(buffer.frameLength)
    guard frameLength > 0 else { return -.infinity }
    let channelCount = Int(buffer.format.channelCount)
    var sumSquares: Float = 0
    for channel in 0..<channelCount {
      let samples = channelData[channel]
      for i in 0..<frameLength { sumSquares += samples[i] * samples[i] }
    }
    let rms = sqrt(sumSquares / Float(frameLength * channelCount))
    return rms > 0 ? 20 * log10(rms) : -.infinity
  }

  private func silentCopy(of buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let silent = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
    silent.frameLength = buffer.frameLength
    for audioBuffer in UnsafeMutableAudioBufferListPointer(silent.mutableAudioBufferList) {
      if let data = audioBuffer.mData { memset(data, 0, Int(audioBuffer.mDataByteSize)) }
    }
    return silent
  }

  // Returns whether this buffer should be forwarded to the recognizer.
  private func gateAllows(_ buffer: AVAudioPCMBuffer) -> Bool {
    let db = levelDb(of: buffer)
    gateLock.lock()
    let openDb = gateOpenDb
    let closeDb = gateCloseDb
    gateLock.unlock()

    let now = Date()
    if db >= openDb {
      gateOpen = true
      heardSpeechThisTask = true
      lastLoudAt = now
    } else if db < closeDb, gateOpen, now.timeIntervalSince(lastLoudAt) > gateReleaseSec {
      gateOpen = false
    }

    if now.timeIntervalSince(lastLevelSentAt) >= levelBroadcastSec {
      lastLevelSentAt = now
      server.broadcastLevel(db: db, gateOpen: gateOpen)
    }
    return gateOpen
  }

  // True exactly once per task, when a pause after gated speech has lasted
  // utteranceEndSec.
  private func shouldEndUtterance() -> Bool {
    guard heardSpeechThisTask, !gateOpen, !endRequested else { return false }
    gateLock.lock()
    let endSec = utteranceEndSec
    gateLock.unlock()
    guard Date().timeIntervalSince(lastLoudAt) >= endSec else { return false }
    endRequested = true
    return true
  }

  func requestPermissions(_ completion: @escaping (Bool, String?) -> Void) {
    SFSpeechRecognizer.requestAuthorization { authStatus in
      guard authStatus == .authorized else {
        completion(false, "Speech Recognition permission denied (status: \(authStatus.rawValue)).")
        return
      }
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        completion(granted, granted ? nil : "Microphone permission denied.")
      }
    }
  }

  func start() {
    intentionalStop = false
    guard let recognizer = recognizer, recognizer.isAvailable else {
      // Locale data not ready yet, or momentarily busy — try again shortly
      // rather than giving up on the whole show.
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.start() }
      return
    }

    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    // .dictation biases the recognizer toward frequent partial-hypothesis
    // updates during continuous free-form speech — the default hint
    // (.unspecified) is tuned more conservatively (e.g. for short search
    // queries) and visibly lagged behind actual speech in testing.
    req.taskHint = .dictation
    if recognizer.supportsOnDeviceRecognition {
      req.requiresOnDeviceRecognition = true
    }
    request = req

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    if tapInstalled { inputNode.removeTap(onBus: 0) }
    // Smaller buffer = audio reaches the recognizer in finer-grained
    // chunks, shaving a little more off the delay before it can react.
    heardSpeechThisTask = false
    endRequested = false
    inputNode.installTap(onBus: 0, bufferSize: 512, format: format) { [weak self] buffer, _ in
      guard let self = self, !self.endRequested else { return }
      if self.shouldEndUtterance() {
        req.endAudio()
        return
      }
      if self.gateAllows(buffer) {
        req.append(buffer)
      } else if let silence = self.silentCopy(of: buffer) {
        // Silence, not nothing: the recognizer only ends an utterance when
        // it hears a pause, so dropping gated audio entirely would keep one
        // task (and its transcript) growing forever.
        req.append(silence)
      }
    }
    tapInstalled = true

    audioEngine.prepare()
    do {
      try audioEngine.start()
    } catch {
      log("audio engine failed to start: \(error)")
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.start() }
      return
    }

    server.broadcastState(listening: true)

    taskGeneration += 1
    let generation = taskGeneration
    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      // A finished task can still call back (e.g. with a cancellation error
      // after teardown's cancel()) — acting on that would re-send its final
      // transcript and schedule a second, overlapping restart.
      guard let self = self, generation == self.taskGeneration else { return }
      if let result = result {
        self.server.broadcastResult(transcript: result.bestTranscription.formattedString, isFinal: result.isFinal)
      }
      if error != nil || (result?.isFinal ?? false) {
        self.taskGeneration += 1
        self.teardown()
        if !self.intentionalStop {
          // A clean end-of-utterance restarts almost immediately — any
          // delay here is dead air where speech starting right away would
          // get clipped. A real error gets a longer beat instead, so a
          // persistent failure (e.g. no mic) doesn't spin tightly.
          let delay = error != nil ? 0.5 : 0.02
          DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.start() }
        }
      }
    }
  }

  private func teardown() {
    audioEngine.stop()
    if tapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    request?.endAudio()
    task?.cancel()
    server.broadcastState(listening: false)
  }

  func stop() {
    intentionalStop = true
    teardown()
  }
}

// MARK: - Entry point

log("starting up (pid \(ProcessInfo.processInfo.processIdentifier))")

let server = SSEServer()
server.start()

let bridge = SpeechBridge(server: server)
server.onGate = { open, close, end in bridge.setGate(openDb: open, closeDb: close, utteranceEndMs: end) }
log("requesting microphone + speech recognition permissions...")
bridge.requestPermissions { granted, message in
  guard granted else {
    log("\(message ?? "Permission denied.") Grant access in System Settings > Privacy & Security, then re-run.")
    exit(1)
  }
  log("permissions granted — starting recognition")
  DispatchQueue.main.async { bridge.start() }
}

signal(SIGINT) { _ in
  bridge.stop()
  exit(0)
}

RunLoop.main.run()
