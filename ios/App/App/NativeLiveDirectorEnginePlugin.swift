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
        CAPPluginMethod(name: "setMetersEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    private final class NativeTrack: @unchecked Sendable {
        let id: String
        let name: String
        let sourceURL: URL
        let remoteURL: URL
        let localURL: URL
        let file: AVAudioFile
        let player = AVAudioPlayerNode()
        var volume: Float
        var isMuted: Bool
        var outputRoute: String
        let duration: Double
        var isMeterTapInstalled = false
        var scheduledUntilFrame: AVAudioFramePosition = 0

        init(
            id: String,
            name: String,
            sourceURL: URL,
            remoteURL: URL,
            localURL: URL,
            file: AVAudioFile,
            volume: Float,
            isMuted: Bool,
            outputRoute: String
        ) {
            self.id = id
            self.name = name
            self.sourceURL = sourceURL
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
    private let meterTapBufferFrameCount: AVAudioFrameCount = 2048
    private let scheduledSegmentDurationSeconds: Double = 8
    private let scheduledSegmentLookaheadSeconds: Double = 24
    private let playerPrepareFrameCount: AVAudioFrameCount = 8192
    private let conversionBufferFrameCount: AVAudioFrameCount = 16384
    private let playbackStartDelay: Double = 0.2
    private let stateEventIntervalMilliseconds = 500
    private let segmentMaintenanceIntervalSeconds: CFTimeInterval = 1
    private let preferCompressedAudioCache = true
    private var engine = AVAudioEngine()
    private var tracks: [NativeTrack] = []
    private var trackLevels: [String: Double] = [:]
    private var metersEnabled = false
    private var isPlaying = false
    private var seekOffset: Double = 0
    private var playStartWallTime: CFTimeInterval = 0
    private var duration: Double = 0
    private var masterVolume: Float = 1
    private var soloTrackId: String?
    private var stateTimer: DispatchSourceTimer?
    private var didRegisterAudioSessionObservers = false
    private var lastSegmentMaintenanceWallTime: CFTimeInterval = 0

    @objc public override func load() {
        super.load()
        registerAudioSessionObservers()
        configureAudioSession()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
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
                let payload = self.statePayload()
                DispatchQueue.main.async {
                    call.resolve(payload)
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
            let payload = self.statePayload()
            DispatchQueue.main.async {
                call.resolve(payload)
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        engineQueue.async {
            self.stopPlayback(resetPosition: true)
            let payload = self.statePayload()
            DispatchQueue.main.async {
                call.resolve(payload)
            }
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let targetTime = max(0, call.getDouble("time") ?? 0)
        engineQueue.async {
            let wasPlaying = self.isPlaying
            self.stopPlayback(resetPosition: false, shouldEmitState: false)
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
            let payload = self.statePayload()
            DispatchQueue.main.async {
                call.resolve(payload)
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
            CAPLog.print("NativeLiveDirectorEngine setTrackVolume id=\(trackId) volume=\(volume)")
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
        let volume = clampVolume(Float(call.getDouble("volume") ?? 1))
        engineQueue.async {
            self.masterVolume = volume
            CAPLog.print("NativeLiveDirectorEngine setMasterVolume volume=\(volume)")
            self.engine.mainMixerNode.outputVolume = volume
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }

    @objc func setMetersEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        engineQueue.async {
            self.setMetersEnabledInternal(enabled)
            DispatchQueue.main.async {
                call.resolve(["enabled": self.metersEnabled])
            }
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        engineQueue.async {
            let payload = self.statePayload()
            DispatchQueue.main.async {
                call.resolve(payload)
            }
        }
    }

    private func prepareTracks(_ rawTracks: [JSObject], call: CAPPluginCall) async throws -> [NativeTrack] {
        var preparedTracks: [NativeTrack] = []
        notifyLoadProgress(loaded: 0, total: rawTracks.count)

        for (index, rawTrack) in rawTracks.enumerated() {
            guard
                let id = rawTrack["id"] as? String,
                let urlString = rawTrack["url"] as? String,
                let sourceURL = URL(string: urlString)
            else {
                throw NSError(domain: "NativeLiveDirectorEngine", code: 10, userInfo: [
                    NSLocalizedDescriptionKey: "Track \(index + 1) is missing id or url."
                ])
            }

            let name = rawTrack["name"] as? String ?? id
            let remoteURL = preferredAudioURL(from: rawTrack, fallbackURL: sourceURL)
            CAPLog.print("NativeLiveDirectorEngine prepareTrack start index=\(index + 1)/\(rawTracks.count) id=\(id) ext=\(remoteURL.pathExtension.lowercased()) optimized=\(remoteURL.absoluteString != sourceURL.absoluteString)")
            let volume = clampVolume(Float((rawTrack["volume"] as? Double) ?? 1))
            let isMuted = rawTrack["isMuted"] as? Bool ?? false
            let outputRoute = normalizeOutputRoute(rawTrack["outputRoute"] as? String ?? "stereo")
            let localURL = try await cachedAudioURL(for: remoteURL)
            let file = try AVAudioFile(forReading: localURL)
            CAPLog.print("NLDE ASSET id=\(id) local=\(localURL.lastPathComponent) sourceExt=\(sourceURL.pathExtension.lowercased()) playExt=\(remoteURL.pathExtension.lowercased()) durationFrames=\(file.length) scheduleMode=\(schedulingModeName(for: file)) \(audioFileSummary(file, url: localURL))")
            preparedTracks.append(NativeTrack(
                id: id,
                name: name,
                sourceURL: sourceURL,
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
                    self.removeMeterTap(for: track)
                    self.engine.detach(track.player)
                }
                self.engine.stop()
                self.engine.reset()
                self.tracks = nextTracks
                self.duration = nextTracks.map(\.duration).max() ?? 0
                self.seekOffset = 0
                self.trackLevels = nextTracks.reduce(into: [String: Double]()) { levels, track in
                    levels[track.id] = 0
                }

                nextTracks.forEach { track in
                    self.engine.attach(track.player)
                    self.engine.connect(track.player, to: self.engine.mainMixerNode, format: track.file.processingFormat)
                    self.applyTrackMixState(track)
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

        CAPLog.print("NLDE SESSION startPlayback requested seek=\(seekOffset) tracks=\(tracks.count) engineRunning=\(engine.isRunning)")
        logSessionState("pre-startPlayback")

        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }

        tracks.forEach { track in
            track.player.stop()
            let startFrame = AVAudioFramePosition(max(0, seekOffset) * track.file.processingFormat.sampleRate)
            let clampedStartFrame = min(max(0, startFrame), track.file.length)
            track.scheduledUntilFrame = clampedStartFrame
            if shouldUseChunkedScheduling(track) {
                scheduleTrackSegmentsUntil(track, targetTime: seekOffset + scheduledSegmentLookaheadSeconds)
            } else {
                scheduleRemainingTrackSegment(track)
            }
            track.player.prepare(withFrameCount: playerPrepareFrameCount)
        }

        let startTime = AVAudioTime(
            hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: playbackStartDelay)
        )
        tracks.forEach { $0.player.play(at: startTime) }
        playStartWallTime = CACurrentMediaTime() + playbackStartDelay - seekOffset
        lastSegmentMaintenanceWallTime = CACurrentMediaTime()
        isPlaying = true
        startStateTimer()
        logSessionState("post-startPlayback")
        emitState()
    }

    private func scheduleTrackSegmentsUntil(_ track: NativeTrack, targetTime: Double) {
        let sampleRate = track.file.processingFormat.sampleRate
        guard sampleRate > 0 else {
            return
        }

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

    private func scheduleRemainingTrackSegment(_ track: NativeTrack) {
        let remainingFrames = track.file.length - track.scheduledUntilFrame
        guard remainingFrames > 0 else {
            return
        }

        let framesToSchedule = min(remainingFrames, AVAudioFramePosition(UInt32.max))
        CAPLog.print("NLDE SCHED id=\(track.id) mode=single-segment-compressed startFrame=\(track.scheduledUntilFrame) frames=\(framesToSchedule)")
        track.player.scheduleSegment(
            track.file,
            startingFrame: track.scheduledUntilFrame,
            frameCount: AVAudioFrameCount(framesToSchedule),
            at: nil,
            completionHandler: nil
        )
        track.scheduledUntilFrame += framesToSchedule
    }

    private func maintainScheduledSegments() {
        guard isPlaying else {
            return
        }

        let targetTime = min(duration, currentTime() + scheduledSegmentLookaheadSeconds)
        tracks.forEach { track in
            if shouldUseChunkedScheduling(track) {
                scheduleTrackSegmentsUntil(track, targetTime: targetTime)
            }
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

    private func stopPlayback(resetPosition: Bool, shouldEmitState: Bool = true) {
        tracks.forEach { $0.player.stop() }
        isPlaying = false
        if resetPosition {
            seekOffset = 0
        }
        tracks.forEach { $0.scheduledUntilFrame = 0 }
        lastSegmentMaintenanceWallTime = 0
        resetMeters()
        if shouldEmitState {
            emitState()
        }
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
        guard metersEnabled, !track.isMeterTapInstalled else {
            return
        }

        track.isMeterTapInstalled = true
        track.player.installTap(onBus: 0, bufferSize: meterTapBufferFrameCount, format: track.file.processingFormat) { [weak self, weak track] buffer, _ in
            guard let self, let track else { return }
            guard self.metersEnabled else { return }

            let level = self.computeLevel(from: buffer)
            self.meterQueue.async {
                self.meterLock.lock()
                self.trackLevels[track.id] = level
                self.meterLock.unlock()
            }
        }
    }

    private func removeMeterTap(for track: NativeTrack) {
        guard track.isMeterTapInstalled else {
            return
        }

        track.player.removeTap(onBus: 0)
        track.isMeterTapInstalled = false
    }

    private func setMetersEnabledInternal(_ enabled: Bool) {
        if metersEnabled {
            metersEnabled = false
            tracks.forEach { removeMeterTap(for: $0) }
            resetMeters()
            emitState()
        }

        CAPLog.print("NLDE METERS requested=\(enabled) forced=false stabilityBuild=true")
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

        let timer = DispatchSource.makeTimerSource(queue: engineQueue)
        timer.schedule(
            deadline: .now(),
            repeating: .milliseconds(stateEventIntervalMilliseconds),
            leeway: .milliseconds(16)
        )
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if !self.isPlaying {
                return
            }
            if self.isPlaying && self.duration > 0 && self.currentTime() >= self.duration {
                self.stopPlayback(resetPosition: true)
                return
            }
            let now = CACurrentMediaTime()
            if now - self.lastSegmentMaintenanceWallTime >= self.segmentMaintenanceIntervalSeconds {
                self.lastSegmentMaintenanceWallTime = now
                self.maintainScheduledSegments()
            }
            self.emitState()
        }
        stateTimer = timer
        timer.resume()
    }

    private func emitState() {
        let payload = statePayload()
        DispatchQueue.main.async {
            self.notifyListeners("state", data: payload)
        }
    }

    private func statePayload() -> JSObject {
        meterLock.lock()
        let levels = trackLevels
        meterLock.unlock()
        var jsLevels: JSObject = [:]
        if metersEnabled {
            tracks.forEach { track in
                jsLevels[track.id] = levels[track.id] ?? 0
            }
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
                "url": track.sourceURL.absoluteString,
                "nativeUrl": track.remoteURL.absoluteString,
                "volume": Double(track.volume),
                "isMuted": track.isMuted,
                "outputRoute": track.outputRoute,
                "durationSeconds": track.duration
            ] as JSObject
        }
    }

    private func preferredAudioURL(from rawTrack: JSObject, fallbackURL: URL) -> URL {
        let optimizedURLKeys = ["iosUrl", "nativeUrl", "optimizedUrl", "cafUrl", "pcmUrl"]
        for key in optimizedURLKeys {
            guard let rawValue = rawTrack[key] as? String else {
                continue
            }

            let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedValue.isEmpty, let url = URL(string: trimmedValue) else {
                continue
            }

            return url
        }

        return fallbackURL
    }

    private func shouldUseChunkedScheduling(_ track: NativeTrack) -> Bool {
        isLinearPCMFile(track.file)
    }

    private func schedulingModeName(for file: AVAudioFile) -> String {
        isLinearPCMFile(file) ? "chunked-pcm" : "single-segment-compressed"
    }

    private func isLinearPCMFile(_ file: AVAudioFile) -> Bool {
        file.fileFormat.streamDescription.pointee.mFormatID == kAudioFormatLinearPCM
    }

    private func audioFileSummary(_ file: AVAudioFile, url: URL) -> String {
        let processingFormat = file.processingFormat
        let fileFormat = file.fileFormat
        let processingDescription = processingFormat.streamDescription.pointee
        let fileDescription = fileFormat.streamDescription.pointee
        let fileSizeBytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        let fileSizeMB = Double(fileSizeBytes) / 1_048_576

        return String(
            format: "sizeMB=%.2f fileRate=%.0f processingRate=%.0f channels=%u fileBits=%u processingBits=%u common=%@ fileFormatID=%08x processingFormatID=%08x interleaved=%@",
            fileSizeMB,
            fileFormat.sampleRate,
            processingFormat.sampleRate,
            processingFormat.channelCount,
            fileDescription.mBitsPerChannel,
            processingDescription.mBitsPerChannel,
            audioCommonFormatName(processingFormat.commonFormat),
            fileDescription.mFormatID,
            processingDescription.mFormatID,
            processingFormat.isInterleaved ? "true" : "false"
        )
    }

    private func audioCommonFormatName(_ commonFormat: AVAudioCommonFormat) -> String {
        switch commonFormat {
        case .pcmFormatFloat32:
            return "float32"
        case .pcmFormatFloat64:
            return "float64"
        case .pcmFormatInt16:
            return "int16"
        case .pcmFormatInt32:
            return "int32"
        case .otherFormat:
            return "other"
        @unknown default:
            return "unknown"
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
        let baseName = digest.map { String(format: "%02x", $0) }.joined()
        let pcmURL = cacheDirectory.appendingPathComponent(baseName + ".caf")
        let compressedURL = cacheDirectory.appendingPathComponent(baseName + "." + extensionName)
        let uncompressedExtensions: Set<String> = ["caf", "wav", "aif", "aiff"]

        if FileManager.default.fileExists(atPath: compressedURL.path) {
            CAPLog.print("NativeLiveDirectorEngine cache hit source=\(compressedURL.lastPathComponent)")
            return preferCompressedAudioCache || uncompressedExtensions.contains(extensionName.lowercased())
                ? compressedURL
                : try convertCachedAudioIfPossible(sourceURL: compressedURL, pcmURL: pcmURL)
        }

        if !preferCompressedAudioCache, FileManager.default.fileExists(atPath: pcmURL.path) {
            CAPLog.print("NativeLiveDirectorEngine cache hit pcm=\(pcmURL.lastPathComponent)")
            return pcmURL
        }

        if let legacyCacheDirectory = try? FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ).appendingPathComponent("RedilLiveDirectorStems", isDirectory: true) {
            let legacyURL = legacyCacheDirectory.appendingPathComponent(baseName + "." + extensionName)
            if FileManager.default.fileExists(atPath: legacyURL.path) {
                CAPLog.print("NativeLiveDirectorEngine cache hit legacy=\(legacyURL.lastPathComponent)")
                return try cacheSourceAudio(
                    sourceURL: legacyURL,
                    destinationURL: compressedURL,
                    shouldRemoveSource: true
                )
            }
        }

        let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
        if let httpResponse = response as? HTTPURLResponse, !(200..<300).contains(httpResponse.statusCode) {
            throw NSError(domain: "NativeLiveDirectorEngine", code: httpResponse.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "Audio download failed with status \(httpResponse.statusCode)."
            ])
        }

        CAPLog.print("NativeLiveDirectorEngine download complete url=\(remoteURL.lastPathComponent)")
        let sourceURL = try cacheSourceAudio(
            sourceURL: temporaryURL,
            destinationURL: compressedURL,
            shouldRemoveSource: true
        )

        if preferCompressedAudioCache || uncompressedExtensions.contains(extensionName.lowercased()) {
            return sourceURL
        }

        return try convertCachedAudioIfPossible(sourceURL: sourceURL, pcmURL: pcmURL)
    }

    private func cacheSourceAudio(
        sourceURL: URL,
        destinationURL: URL,
        shouldRemoveSource: Bool
    ) throws -> URL {
        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try? FileManager.default.removeItem(at: destinationURL)
        }

        do {
            try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
        } catch {
            try FileManager.default.copyItem(at: sourceURL, to: destinationURL)
            if shouldRemoveSource {
                try? FileManager.default.removeItem(at: sourceURL)
            }
        }

        return destinationURL
    }

    private func convertCachedAudioIfPossible(
        sourceURL: URL,
        pcmURL: URL,
        fallbackURL: URL? = nil
    ) throws -> URL {
        do {
            CAPLog.print("NativeLiveDirectorEngine transcode start source=\(sourceURL.lastPathComponent)")
            try convertAudioToPCMCAF(sourceURL: sourceURL, destinationURL: pcmURL)
            CAPLog.print("NativeLiveDirectorEngine transcode complete pcm=\(pcmURL.lastPathComponent)")
            if sourceURL.path != pcmURL.path {
                try? FileManager.default.removeItem(at: sourceURL)
            }
            return pcmURL
        } catch {
            CAPLog.print("NativeLiveDirectorEngine transcode fallback source=\(sourceURL.lastPathComponent) error=\(error.localizedDescription)")
            guard let fallbackURL else {
                return sourceURL
            }
            if FileManager.default.fileExists(atPath: fallbackURL.path) {
                try? FileManager.default.removeItem(at: fallbackURL)
            }
            do {
                try FileManager.default.moveItem(at: sourceURL, to: fallbackURL)
            } catch {
                try FileManager.default.copyItem(at: sourceURL, to: fallbackURL)
                try? FileManager.default.removeItem(at: sourceURL)
            }
            return fallbackURL
        }
    }

    private func convertAudioToPCMCAF(sourceURL: URL, destinationURL: URL) throws {
        let inputFile = try AVAudioFile(forReading: sourceURL)
        let processingFormat = inputFile.processingFormat
        guard processingFormat.sampleRate > 0, processingFormat.channelCount > 0 else {
            throw NSError(domain: "NativeLiveDirectorEngine", code: 30, userInfo: [
                NSLocalizedDescriptionKey: "Audio file has an unsupported format."
            ])
        }

        let temporaryURL = destinationURL
            .deletingLastPathComponent()
            .appendingPathComponent(destinationURL.lastPathComponent + ".tmp")
        try? FileManager.default.removeItem(at: temporaryURL)
        defer {
            try? FileManager.default.removeItem(at: temporaryURL)
        }

        let outputFile = try AVAudioFile(
            forWriting: temporaryURL,
            settings: processingFormat.settings,
            commonFormat: processingFormat.commonFormat,
            interleaved: processingFormat.isInterleaved
        )
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: processingFormat,
            frameCapacity: conversionBufferFrameCount
        ) else {
            throw NSError(domain: "NativeLiveDirectorEngine", code: 31, userInfo: [
                NSLocalizedDescriptionKey: "Could not allocate conversion buffer."
            ])
        }

        while inputFile.framePosition < inputFile.length {
            let remainingFrames = inputFile.length - inputFile.framePosition
            let framesToRead = min(AVAudioFramePosition(conversionBufferFrameCount), remainingFrames)
            if framesToRead <= 0 {
                break
            }
            try inputFile.read(into: buffer, frameCount: AVAudioFrameCount(framesToRead))
            if buffer.frameLength == 0 {
                break
            }
            try outputFile.write(from: buffer)
        }

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
        }
        try FileManager.default.moveItem(at: temporaryURL, to: destinationURL)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            logSessionState("post-setCategory")
            try session.setActive(true, options: [])
            logSessionState("post-setActive")
        } catch {
            CAPLog.print("NLDE SESSION configure FAIL: \(error.localizedDescription)")
            logSessionState("configure-failed")
        }
    }

    private func logSessionState(_ tag: String) {
        let session = AVAudioSession.sharedInstance()
        let route = session.currentRoute.outputs
            .map { $0.portType.rawValue }
            .joined(separator: ",")
        CAPLog.print(
            "NLDE SESSION[\(tag)] cat=\(session.category.rawValue) mode=\(session.mode.rawValue) rate=\(session.sampleRate) buf=\(session.ioBufferDuration) route=[\(route)] other=\(session.isOtherAudioPlaying)"
        )
    }

    private func registerAudioSessionObservers() {
        guard !didRegisterAudioSessionObservers else {
            return
        }

        didRegisterAudioSessionObservers = true
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.addObserver(
            self,
            selector: #selector(handleAudioSessionInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
        center.addObserver(
            self,
            selector: #selector(handleAudioRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: session
        )
        center.addObserver(
            self,
            selector: #selector(handleMediaServicesReset(_:)),
            name: AVAudioSession.mediaServicesWereResetNotification,
            object: session
        )
        center.addObserver(
            self,
            selector: #selector(handleEngineConfigurationChange(_:)),
            name: NSNotification.Name.AVAudioEngineConfigurationChange,
            object: engine
        )
    }

    @objc private func handleAudioSessionInterruption(_ notification: Notification) {
        let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let type = rawType.flatMap { AVAudioSession.InterruptionType(rawValue: $0) }
        CAPLog.print("NLDE SESSION interruption rawType=\(String(describing: rawType)) type=\(String(describing: type)) rawOptions=\(rawOptions) info=\(String(describing: notification.userInfo))")

        engineQueue.async {
            guard let type else {
                return
            }

            switch type {
            case .began:
                self.logSessionState("interruption-began")
                self.pausePlayback()
            case .ended:
                let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
                do {
                    try AVAudioSession.sharedInstance().setActive(true, options: [])
                } catch {
                    CAPLog.print("NLDE SESSION interruption resume setActive FAIL: \(error.localizedDescription)")
                }
                self.logSessionState("interruption-ended")
                if options.contains(.shouldResume), self.seekOffset < self.duration {
                    do {
                        try self.startPlayback()
                    } catch {
                        CAPLog.print("NLDE SESSION resume after interruption FAIL: \(error.localizedDescription)")
                        self.emitState()
                    }
                } else {
                    self.emitState()
                }
            @unknown default:
                self.emitState()
            }
        }
    }

    @objc private func handleAudioRouteChange(_ notification: Notification) {
        let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        let reason = rawReason.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
        CAPLog.print("NLDE SESSION route change rawReason=\(String(describing: rawReason)) reason=\(String(describing: reason)) info=\(String(describing: notification.userInfo))")

        engineQueue.async {
            self.logSessionState("route-change")
            if self.isPlaying, !self.engine.isRunning {
                do {
                    try self.engine.start()
                } catch {
                    CAPLog.print("NLDE SESSION restart after route change FAIL: \(error.localizedDescription)")
                }
            }
            self.emitState()
        }
    }

    @objc private func handleMediaServicesReset(_ notification: Notification) {
        CAPLog.print("NLDE SESSION media services reset info=\(String(describing: notification.userInfo))")

        engineQueue.async {
            let shouldResume = self.isPlaying
            let resumeTime = self.currentTime()
            self.tracks.forEach { $0.player.stop() }
            self.engine.stop()
            self.engine.reset()
            self.seekOffset = resumeTime
            self.isPlaying = false
            self.configureAudioSession()

            if shouldResume, self.seekOffset < self.duration {
                do {
                    try self.startPlayback()
                } catch {
                    CAPLog.print("NLDE SESSION resume after media reset FAIL: \(error.localizedDescription)")
                    self.emitState()
                }
            } else {
                self.emitState()
            }
        }
    }

    @objc private func handleEngineConfigurationChange(_ notification: Notification) {
        CAPLog.print("NLDE SESSION engine configuration changed info=\(String(describing: notification.userInfo))")

        engineQueue.async {
            if self.isPlaying, !self.engine.isRunning {
                do {
                    try self.engine.start()
                } catch {
                    CAPLog.print("NLDE SESSION restart after configuration change FAIL: \(error.localizedDescription)")
                }
            }
            self.emitState()
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
