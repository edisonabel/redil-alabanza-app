import AVFoundation
import Capacitor
import Foundation
import Speech

@objc(NativeVoiceFollowerPlugin)
public class NativeVoiceFollowerPlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    public let identifier = "NativeVoiceFollowerPlugin"
    public let jsName = "NativeVoiceFollower"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private var shouldListen = false
    private var isStarting = false
    private var selectedLocale = ""
    private var contextualStrings: [String] = []
    private var restartWorkItem: DispatchWorkItem?
    private var recognitionGeneration = 0
    private var previousAudioCategory: AVAudioSession.Category?
    private var previousAudioMode: AVAudioSession.Mode?
    private var previousAudioOptions: AVAudioSession.CategoryOptions = []

    deinit {
        stopRecognition(restoreAudioSession: true)
    }

    @objc func getAvailability(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let locales = self.readLocales(from: call)
            if let selection = self.selectRecognizer(locales: locales) {
                call.resolve([
                    "available": true,
                    "locale": selection.locale
                ])
            } else {
                call.resolve([
                    "available": false,
                    "reason": "El reconocimiento local no está disponible para español en este dispositivo."
                ])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard !self.isStarting else {
                call.reject("El reconocimiento ya se está preparando.")
                return
            }

            self.isStarting = true
            self.contextualStrings = (call.getArray("contextualStrings") as? [String] ?? [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .prefix(100)
                .map { String($0) }

            let locales = self.readLocales(from: call)
            guard let selection = self.selectRecognizer(locales: locales) else {
                self.isStarting = false
                call.reject("El reconocimiento local no está disponible para español en este dispositivo.")
                return
            }

            self.speechRecognizer = selection.recognizer
            self.selectedLocale = selection.locale
            self.requestPermissions { [weak self] granted, message in
                guard let self else { return }
                DispatchQueue.main.async {
                    guard granted else {
                        self.isStarting = false
                        call.reject(message ?? "No se concedieron los permisos de voz.")
                        return
                    }

                    do {
                        self.shouldListen = true
                        try self.beginRecognition()
                        self.isStarting = false
                        call.resolve([
                            "listening": true,
                            "locale": self.selectedLocale,
                            "onDevice": true
                        ])
                    } catch {
                        self.shouldListen = false
                        self.isStarting = false
                        self.stopRecognition(restoreAudioSession: true)
                        call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.shouldListen = false
            self?.isStarting = false
            self?.stopRecognition(restoreAudioSession: true)
            call.resolve(["listening": false])
        }
    }

    private func readLocales(from call: CAPPluginCall) -> [String] {
        let requested = call.getArray("locales") as? [String] ?? []
        let cleaned = requested
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return cleaned.isEmpty ? ["es-CO", "es-ES", "es-US"] : cleaned
    }

    private func selectRecognizer(locales: [String]) -> (recognizer: SFSpeechRecognizer, locale: String)? {
        for localeIdentifier in locales {
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)) else {
                continue
            }
            if recognizer.supportsOnDeviceRecognition && recognizer.isAvailable {
                return (recognizer, localeIdentifier)
            }
        }
        return nil
    }

    private func requestPermissions(completion: @escaping (Bool, String?) -> Void) {
        requestSpeechPermission { speechGranted in
            guard speechGranted else {
                completion(false, "Activa Reconocimiento de voz en Ajustes para usar Seguir voz.")
                return
            }
            self.requestMicrophonePermission { microphoneGranted in
                completion(
                    microphoneGranted,
                    microphoneGranted ? nil : "Activa el micrófono en Ajustes para usar Seguir voz."
                )
            }
        }
    }

    private func requestSpeechPermission(completion: @escaping (Bool) -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            completion(true)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                completion(status == .authorized)
            }
        default:
            completion(false)
        }
    }

    private func requestMicrophonePermission(completion: @escaping (Bool) -> Void) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            completion(true)
        case .undetermined:
            session.requestRecordPermission { granted in
                completion(granted)
            }
        default:
            completion(false)
        }
    }

    private func beginRecognition() throws {
        guard shouldListen else { return }
        guard let speechRecognizer, speechRecognizer.supportsOnDeviceRecognition else {
            throw NSError(
                domain: "NativeVoiceFollower",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "El reconocimiento local dejó de estar disponible."]
            )
        }

        stopRecognition(restoreAudioSession: false)
        saveAudioSessionIfNeeded()

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.defaultToSpeaker, .allowBluetoothHFP]
        )
        try session.setActive(true, options: [])

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        request.contextualStrings = Array(contextualStrings.prefix(100))
        recognitionRequest = request
        let currentGeneration = recognitionGeneration

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(
                domain: "NativeVoiceFollower",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "El micrófono no entregó un formato de audio válido."]
            )
        }

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            guard currentGeneration == self.recognitionGeneration else { return }
            if let result {
                let transcription = result.bestTranscription
                let segments: [JSObject] = transcription.segments.map { segment in
                    [
                        "text": segment.substring,
                        "alternatives": segment.alternativeSubstrings,
                        "confidence": Double(segment.confidence),
                        "timestamp": segment.timestamp,
                        "duration": segment.duration
                    ]
                }
                self.notifyListeners("transcript", data: [
                    "text": transcription.formattedString,
                    "isFinal": result.isFinal,
                    "locale": self.selectedLocale,
                    "segments": segments
                ])
            }

            if error != nil || result?.isFinal == true {
                self.scheduleRestartIfNeeded(error: error)
            }
        }
    }

    private func scheduleRestartIfNeeded(error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.shouldListen else { return }
            self.restartWorkItem?.cancel()
            let workItem = DispatchWorkItem { [weak self] in
                guard let self, self.shouldListen else { return }
                do {
                    try self.beginRecognition()
                } catch {
                    self.shouldListen = false
                    self.stopRecognition(restoreAudioSession: true)
                    self.notifyListeners("voiceError", data: [
                        "code": "restart_failed",
                        "message": error.localizedDescription
                    ])
                }
            }
            self.restartWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: workItem)
        }
    }

    private func saveAudioSessionIfNeeded() {
        guard previousAudioCategory == nil else { return }
        let session = AVAudioSession.sharedInstance()
        previousAudioCategory = session.category
        previousAudioMode = session.mode
        previousAudioOptions = session.categoryOptions
    }

    private func stopRecognition(restoreAudioSession: Bool) {
        recognitionGeneration &+= 1
        restartWorkItem?.cancel()
        restartWorkItem = nil
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)

        guard restoreAudioSession, let category = previousAudioCategory else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                category,
                mode: previousAudioMode ?? .default,
                options: previousAudioOptions
            )
            try session.setActive(true, options: [])
        } catch {
            // The web audio layer may own the active session; keep the stop path non-fatal.
        }
        previousAudioCategory = nil
        previousAudioMode = nil
        previousAudioOptions = []
    }
}
