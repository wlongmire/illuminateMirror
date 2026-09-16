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

// Deliberately minimal: this only ever needs to serve one kind of response
// (an open SSE stream) to one kind of client (the page's EventSource), so
// it skips real HTTP request parsing — the mere fact that a client has
// connected and sent anything at all is treated as "please stream to me."
final class SSEServer {
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private let queue = DispatchQueue(label: "speechbridge.sse")

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
    conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] _, _, _, error in
      guard let self = self, error == nil else { return }
      let headers = "HTTP/1.1 200 OK\r\n"
        + "Content-Type: text/event-stream\r\n"
        + "Cache-Control: no-cache\r\n"
        + "Connection: keep-alive\r\n"
        + "Access-Control-Allow-Origin: *\r\n\r\n"
      conn.send(content: headers.data(using: .utf8), completion: .contentProcessed { _ in })
      self.queue.async { self.connections[id] = conn }
    }
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

  init(server: SSEServer) {
    self.server = server
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
    inputNode.installTap(onBus: 0, bufferSize: 512, format: format) { buffer, _ in
      req.append(buffer)
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

    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      guard let self = self else { return }
      if let result = result {
        self.server.broadcastResult(transcript: result.bestTranscription.formattedString, isFinal: result.isFinal)
      }
      if error != nil || (result?.isFinal ?? false) {
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
