import Accelerate
import AVFoundation
import Capacitor
import CryptoKit
import Foundation
import QuartzCore

@objc(NativeLiveDirectorEnginePlugin)
public class NativeLiveDirectorEnginePlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    public let identifier = "NativeLiveDirectorEnginePlugin"
    public let jsName = "NativeLiveDirectorEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTrackVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTrackOutputRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toggleMute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "soloTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMasterVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    private final class NativeTrack: @unchecked Sendable {
        let id: String
        let name: String
        let remoteURL: URL
        let localURL: URL
        let file: AVAudioFile
        let player = AVAudioPlayerNode()
        let mixer = AVAudioMixerNode()
        var volume: Float
        var isMuted: Bool
        var outputRoute: String
        let duration: Double
        var scheduledUntilFrame: AVAudioFramePosition = 0

        init(
            id: String,
            name: String,
            remoteURL: URL,
            localURL: URL,
            file: AVAudioFile,
            volume: Float,
            isMuted: Bool,
            outputRoute: String
        ) {
            self.id = id
            self.name = name
            self.remoteURL = remoteURL
            self.localURL = localURL
            self.file = file
            self.volume = volume
            self.isMuted = isMuted
            self.outputRoute = outputRoute
            self.duration = file.processingFormat.sampleRate > 0
                ? Double(file.length) / file.processingFormat.sampleRate
                : 0
        }
    }

    private let engineQueue = DispatchQueue(label: "redil.live-director.native-engine")
    private let meterQueue = DispatchQueue(label: "redil.live-director.native-meters")
    private let meterLock = NSLock()
    private let scheduledSegmentDurationSeconds: Double = 18
    private let scheduledSegmentLookaheadSeconds: Double = 36
    private let meterTapBufferFrameCount: AVAudioFrameCount = 2048
    private let playerPrepareFrameCount: AVAudioFrameCount = 4096
    private var engine = AVAudioEngine()
    private var tracks: [NativeTrack] = []
    private var trackLevels: [String: Double] = [:]
    private var isPlaying = false
    private var seekOffset: Double = 0
    private var playStartWallTime: CFTimeInterval = 0
    private var duration: Double = 0
    private var masterVolume: Float = 1
    private var soloTrackId: String?
    private var stateTimer: DispatchSourceTimer?
    private var playbackGeneration = 0
    private var lastSegmentMaintenanceWallTime: CFTimeInterval = 0

    @objc public override func load() {
        super.load()
        configureAudioSession()
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let rawTracks = call.getArray("tracks") as? [JSObject] else {
            call.reject("Missing tracks")
            return
        }

        Task {
            do {
                let loadedTracks = try await self.prepareTracks(rawTracks, call: call)
                await self.configureEngine(with: loadedTracks)
                call.resolve([
                    "duration": self.duration,
                    "tracks": self.tracksPayload()
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        engineQueue.async {
            do {
                try self.startPlayback()
                DispatchQueue.main.async {
                    call.resolve(self.statePayload())
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        engineQueue.async {
            self.pausePlayback()
            DispatchQueue.main.async {
                call.resolve(self.statePayload())
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        engineQueue.async {
            self.stopPlayback(resetPosition: true)
            DispatchQueue.main.async {
                call.resolve(self.statePayload())
            }
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let targetTime = max(0, call.getDouble("time") ?? 0)
        engineQueue.async {
            let wasPlaying = self.isPlaying
            self.stopPlayback(resetPosition: false)
            self.seekOffset = min(targetTime, self.duration)
            if wasPlaying {
                do {
                    try self.startPlayback()
                } catch {
                    DispatchQueue.main.async {
                        call.reject(error.localizedDescription)
                    }
                    return
                }
            }
            DispatchQueue.main.async {
                call.resolve(self.statePayload())
            }
        }
    }

    @objc func setTrackVolume(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing trackId")
            return
        }

        let volume = clampVolume(Float(call.getDouble("volume") ?? 1))
        engineQueue.async {
            guard let track = self.tracks.first(where: { $0.id == trackId }) else {
                DispatchQueue.main.async {
                    call.reject("Track not found")
                }
                return
            }

            track.volume = volume
            self.applyTrackMixState(track)
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }

    @objc func setTrackOutputRoute(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing trackId")
            return
        }

        let outputRoute = normalizeOutputRoute(call.getString("outputRoute") ?? "stereo")
        engineQueue.async {
            guard let track = self.tracks.first(where: { $0.id == trackId }) else {
                DispatchQueue.main.async {
                    call.reject("Track not found")
                }
                return
            }

            track.outputRoute = outputRoute
            self.applyTrackMixState(track)
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }

    @objc func toggleMute(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing trackId")
            return
        }

        engineQueue.async {
            guard let track = self.tracks.first(where: { $0.id == trackId }) else {
                DispatchQueue.main.async {
                    call.reject("Track not found")
                }
                return
            }

            track.isMuted.toggle()
            self.applyTrackMixState(track)
            DispatchQueue.main.async {
                call.resolve(["muted": track.isMuted])
            }
        }
    }

    @objc func soloTrack(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing trackId")
            return
        }

        engineQueue.async {
            self.soloTrackId = self.soloTrackId == trackId ? nil : trackId
            self.tracks.forEach { self.applyTrackMixState($0) }
            DispatchQueue.main.async {
                call.resolve(["soloTrackId": self.soloTrackId as Any])
            }
        }
    }

    @objc func setMasterVolume(_ call: CAPPluginCall) {
        masterVolume = clampVolume(Float(call.getDouble("volume") ?? 1))
        engine.mainMixerNode.outputVolume = masterVolume
        call.resolve()
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(statePayload())
    }

    private func prepareTracks(_ rawTracks: [JSObject], call: CAPPluginCall) async throws -> [NativeTrack] {
        var preparedTracks: [NativeTrack] = []
        notifyLoadProgress(loaded: 0, total: rawTracks.count)

        for (index, rawTrack) in rawTracks.enumerated() {
            guard
                let id = rawTrack["id"] as? String,
                let urlString = rawTrack["url"] as? String,
                let remoteURL = URL(string: urlString)
            else {
                throw NSError(domain: "NativeLiveDirectorEngine", code: 10, userInfo: [
                    NSLocalizedDescriptionKey: "Track \(index + 1) is missing id or url."
                ])
            }

            let name = rawTrack["name"] as? String ?? id
            let volume = clampVolume(Float((rawTrack["volume"] as? Double) ?? 1))
            let isMuted = rawTrack["isMuted"] as? Bool ?? false
            let outputRoute = normalizeOutputRoute(rawTrack["outputRoute"] as? String ?? "stereo")
            let localURL = try await cachedAudioURL(for: remoteURL)
            let file = try AVAudioFile(forReading: localURL)
            preparedTracks.append(NativeTrack(
                id: id,
                name: name,
                remoteURL: remoteURL,
                localURL: localURL,
                file: file,
                volume: volume,
                isMuted: isMuted,
                outputRoute: outputRoute
            ))
            notifyLoadProgress(loaded: index + 1, total: rawTracks.count)
        }

        return preparedTracks
    }

    private func configureEngine(with nextTracks: [NativeTrack]) async {
        await withCheckedContinuation { continuation in
            engineQueue.async {
                self.stopPlayback(resetPosition: true)
                self.tracks.forEach { track in
                    track.mixer.removeTap(onBus: 0)
                    self.engine.detach(track.player)
                    self.engine.detach(track.mixer)
                }
                self.engine.stop()
                self.engine.reset()
                self.tracks = nextTracks
                self.duration = nextTracks.map(\.duration).max() ?? 0
                self.seekOffset = 0
                self.playbackGeneration += 1
                self.lastSegmentMaintenanceWallTime = 0
                self.trackLevels = nextTracks.reduce(into: [String: Double]()) { levels, track in
                    levels[track.id] = 0
                }

                nextTracks.forEach { track in
                    self.engine.attach(track.player)
                    self.engine.attach(track.mixer)
                    self.engine.connect(track.player, to: track.mixer, format: track.file.processingFormat)
                    self.engine.connect(track.mixer, to: self.engine.mainMixerNode, format: track.file.processingFormat)
                    self.applyTrackMixState(track)
                    self.installMeterTap(for: track)
                }

                self.engine.mainMixerNode.outputVolume = self.masterVolume
                self.startStateTimer()
                continuation.resume()
            }
        }
    }

    private func startPlayback() throws {
        guard !tracks.isEmpty else {
            throw NSError(domain: "NativeLiveDirectorEngine", code: 20, userInfo: [
                NSLocalizedDescriptionKey: "No tracks loaded."
            ])
        }

        configureAudioSession()
        playbackGeneration += 1
        let currentGeneration = playbackGeneration
        lastSegmentMaintenanceWallTime = 0

        tracks.forEach { track in
            track.player.stop()
            let startFrame = AVAudioFramePosition(max(0, seekOffset) * track.file.processingFormat.sampleRate)
            track.scheduledUntilFrame = min(max(0, startFrame), track.file.length)
            scheduleTrackSegmentsUntil(
                track,
                targetTime: seekOffset + scheduledSegmentLookaheadSeconds,
                generation: currentGeneration
            )
            track.player.prepare(withFrameCount: playerPrepareFrameCount)
        }

        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }

        let startDelay = 0.08
        let startTime = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: startDelay))
        tracks.forEach { $0.player.play(at: startTime) }
        playStartWallTime = CACurrentMediaTime() + startDelay - seekOffset
        isPlaying = true
        startStateTimer()
    }

    private func scheduleTrackSegmentsUntil(
        _ track: NativeTrack,
        targetTime: Double,
        generation: Int
    ) {
        guard generation == playbackGeneration else { return }

        let sampleRate = track.file.processingFormat.sampleRate
        guard sampleRate > 0 else { return }

        let targetFrame = min(
            track.file.length,
            AVAudioFramePosition(max(0, targetTime) * sampleRate)
        )
        let maxSegmentFrames = max(
            1,
            AVAudioFramePosition(scheduledSegmentDurationSeconds * sampleRate)
        )

        while track.scheduledUntilFrame < targetFrame {
            let startFrame = track.scheduledUntilFrame
            let remainingFrames = track.file.length - startFrame
            if remainingFrames <= 0 {
                break
            }

            let nextFrameCount = min(remainingFrames, maxSegmentFrames)
            track.player.scheduleSegment(
                track.file,
                startingFrame: startFrame,
                frameCount: AVAudioFrameCount(nextFrameCount),
                at: nil,
                completionHandler: nil
            )
            track.scheduledUntilFrame = startFrame + nextFrameCount
        }
    }

    private func maintainScheduledSegments(generation: Int) {
        guard isPlaying, generation == playbackGeneration else { return }
        let targetTime = min(duration, currentTime() + scheduledSegmentLookaheadSeconds)
        tracks.forEach { track in
            scheduleTrackSegmentsUntil(track, targetTime: targetTime, generation: generation)
        }
    }

    private func pausePlayback() {
        if isPlaying {
            seekOffset = currentTime()
        }
        tracks.forEach { $0.player.pause() }
        isPlaying = false
        resetMeters()
        emitState()
    }

    private func stopPlayback(resetPosition: Bool) {
        playbackGeneration += 1
        tracks.forEach { $0.player.stop() }
        isPlaying = false
        if resetPosition {
            seekOffset = 0
        }
        tracks.forEach { $0.scheduledUntilFrame = 0 }
        lastSegmentMaintenanceWallTime = 0
        resetMeters()
        emitState()
    }

    private func currentTime() -> Double {
        if isPlaying {
            return min(duration, max(0, CACurrentMediaTime() - playStartWallTime))
        }

        return min(duration, max(0, seekOffset))
    }

    private func applyTrackMixState(_ track: NativeTrack) {
        let soloAllowsTrack = soloTrackId == nil || soloTrackId == track.id
        track.player.volume = track.isMuted || !soloAllowsTrack ? 0 : track.volume

        switch track.outputRoute {
        case "left":
            track.player.pan = -1
        case "right":
            track.player.pan = 1
        default:
            track.player.pan = 0
        }
    }

    private func installMeterTap(for track: NativeTrack) {
        track.mixer.installTap(onBus: 0, bufferSize: meterTapBufferFrameCount, format: nil) { [weak self, weak track] buffer, _ in
            guard let self, let track else { return }

            let level = self.computeLevel(from: buffer)
            self.meterQueue.async {
                self.meterLock.lock()
                self.trackLevels[track.id] = level
                self.meterLock.unlock()
            }
        }
    }

    private func computeLevel(from buffer: AVAudioPCMBuffer) -> Double {
        guard let channelData = buffer.floatChannelData else {
            return 0
        }

        let channelCount = Int(buffer.format.channelCount)
        let frameLength = Int(buffer.frameLength)
        if channelCount <= 0 || frameLength <= 0 {
            return 0
        }

        var peak: Float = 0
        for channelIndex in 0..<channelCount {
            let samples = channelData[channelIndex]
            var channelPeak: Float = 0
            vDSP_maxmgv(samples, 1, &channelPeak, vDSP_Length(frameLength))
            peak = max(peak, channelPeak)
        }

        if peak <= 0.00075 {
            return 0
        }

        return min(1, Double(sqrt(peak) * 1.14))
    }

    private func resetMeters() {
        meterLock.lock()
        tracks.forEach { trackLevels[$0.id] = 0 }
        meterLock.unlock()
    }

    private func startStateTimer() {
        if stateTimer != nil {
            return
        }

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(42), leeway: .milliseconds(8))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if self.isPlaying && self.duration > 0 && self.currentTime() >= self.duration {
                self.engineQueue.async {
                    self.stopPlayback(resetPosition: true)
                }
                return
            }
            if self.isPlaying {
                let now = CACurrentMediaTime()
                if now - self.lastSegmentMaintenanceWallTime >= 0.75 {
                    self.lastSegmentMaintenanceWallTime = now
                    let generation = self.playbackGeneration
                    self.engineQueue.async {
                        self.maintainScheduledSegments(generation: generation)
                    }
                }
            }
            self.emitState()
        }
        stateTimer = timer
        timer.resume()
    }

    private func emitState() {
        DispatchQueue.main.async {
            self.notifyListeners("state", data: self.statePayload())
        }
    }

    private func statePayload() -> JSObject {
        meterLock.lock()
        let levels = trackLevels
        meterLock.unlock()
        var jsLevels: JSObject = [:]
        levels.forEach { trackId, level in
            jsLevels[trackId] = level
        }

        return [
            "isPlaying": isPlaying,
            "currentTime": currentTime(),
            "duration": duration,
            "trackLevels": jsLevels,
            "engineMode": "ios-native"
        ]
    }

    private func tracksPayload() -> JSArray {
        tracks.map { track in
            [
                "id": track.id,
                "name": track.name,
                "url": track.remoteURL.absoluteString,
                "volume": Double(track.volume),
                "isMuted": track.isMuted,
                "outputRoute": track.outputRoute,
                "durationSeconds": track.duration
            ] as JSObject
        }
    }

    private func notifyLoadProgress(loaded: Int, total: Int) {
        DispatchQueue.main.async {
            self.notifyListeners("loadProgress", data: [
                "loaded": loaded,
                "total": total
            ])
        }
    }

    private func cachedAudioURL(for remoteURL: URL) async throws -> URL {
        let cacheDirectory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("RedilLiveDirectorStems", isDirectory: true)

        try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        var protectedCacheDirectory = cacheDirectory
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? protectedCacheDirectory.setResourceValues(resourceValues)

        let extensionName = remoteURL.pathExtension.isEmpty ? "audio" : remoteURL.pathExtension
        let digest = SHA256.hash(data: Data(remoteURL.absoluteString.utf8))
        let fileName = digest.map { String(format: "%02x", $0) }.joined() + "." + extensionName
        let destinationURL = cacheDirectory.appendingPathComponent(fileName)

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            return destinationURL
        }

        if let legacyCacheDirectory = try? FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ).appendingPathComponent("RedilLiveDirectorStems", isDirectory: true) {
            let legacyURL = legacyCacheDirectory.appendingPathComponent(fileName)
            if FileManager.default.fileExists(atPath: legacyURL.path) {
                do {
                    try FileManager.default.moveItem(at: legacyURL, to: destinationURL)
                } catch {
                    try FileManager.default.copyItem(at: legacyURL, to: destinationURL)
                    try? FileManager.default.removeItem(at: legacyURL)
                }
                return destinationURL
            }
        }

        let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
        if let httpResponse = response as? HTTPURLResponse, !(200..<300).contains(httpResponse.statusCode) {
            throw NSError(domain: "NativeLiveDirectorEngine", code: httpResponse.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "Audio download failed with status \(httpResponse.statusCode)."
            ])
        }

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
        }
        try FileManager.default.moveItem(at: temporaryURL, to: destinationURL)
        return destinationURL
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            CAPLog.print("NativeLiveDirectorEngine audio session failed: \(error.localizedDescription)")
        }
    }

    private func clampVolume(_ volume: Float) -> Float {
        if !volume.isFinite {
            return 1
        }
        return min(1, max(0, volume))
    }

    private func normalizeOutputRoute(_ outputRoute: String) -> String {
        outputRoute == "left" || outputRoute == "right" ? outputRoute : "stereo"
    }
}
