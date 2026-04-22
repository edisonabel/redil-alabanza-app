import Accelerate
import AVFoundation
import Capacitor
import CryptoKit
import Foundation
import MediaPlayer
import QuartzCore
import UIKit

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
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNowPlayingMetadata", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNowPlayingMetadata", returnType: CAPPluginReturnPromise)
    ]

    private struct ActivityEnvelope {
        let bucketMs: Int
        let values: [Double]
    }

    private final class NativeTrack: @unchecked Sendable {
        let id: String
        let name: String
        let sourceURL: URL
        let remoteURL: URL
        let localURL: URL
        let file: AVAudioFile
        let loadIndex: Int
        let player = AVAudioPlayerNode()
        var volume: Float
        var isMuted: Bool
        var outputRoute: String
        let duration: Double
        var activityEnvelope: ActivityEnvelope?
        var scheduledUntilFrame: AVAudioFramePosition = 0

        init(
            id: String,
            name: String,
            sourceURL: URL,
            remoteURL: URL,
            localURL: URL,
            file: AVAudioFile,
            loadIndex: Int,
            volume: Float,
            isMuted: Bool,
            outputRoute: String,
            activityEnvelope: ActivityEnvelope?
        ) {
            self.id = id
            self.name = name
            self.sourceURL = sourceURL
            self.remoteURL = remoteURL
            self.localURL = localURL
            self.file = file
            self.loadIndex = loadIndex
            self.volume = volume
            self.isMuted = isMuted
            self.outputRoute = outputRoute
            self.activityEnvelope = activityEnvelope
            self.duration = file.processingFormat.sampleRate > 0
                ? Double(file.length) / file.processingFormat.sampleRate
                : 0
        }
    }

    private let engineQueue = DispatchQueue(label: "redil.live-director.native-engine")
    private let meterLock = NSLock()
    private let playerPrepareFrameCount: AVAudioFrameCount = 8192
    private let conversionBufferFrameCount: AVAudioFrameCount = 16384
    private let playbackStartDelay: Double = 0.2
    private let stateEventIntervalMilliseconds = 500
    private let preferCompressedAudioCache = true
    private let internalPadTrackId = "__internal-pad__"
    private let maxScheduledSilencePadSeconds: Double = 1.0
    private let internalPadTailSeconds: Double = 30.0
    private let internalPadFadeOutSeconds: Double = 10.0
    private let syncDebugIntervalSeconds: Double = 5.0
    private var engine = AVAudioEngine()
    private var tracks: [NativeTrack] = []
    private var trackLevels: [String: Double] = [:]
    private var metersEnabled = false
    private var isPlaying = false
    private var seekOffset: Double = 0
    private var playStartWallTime: CFTimeInterval = 0
    private var playbackAnchorOffset: Double = 0
    private var playbackStartHostTime: UInt64 = 0
    private var duration: Double = 0
    private var playbackStopDuration: Double = 0
    private var masterVolume: Float = 1
    private var soloTrackId: String?
    private var internalPadFadeScale: Float = 1
    private var lastSyncDebugLogElapsed: Double = -Double.greatestFiniteMagnitude
    private var stateTimer: DispatchSourceTimer?
    private var didRegisterAudioSessionObservers = false
    // Now Playing / lock screen metadata. Set from the JS side with
    // `setNowPlayingMetadata({title, artist, albumTitle})` when a song is
    // loaded. Kept in sync with the engine's isPlaying / currentTime / duration
    // by updateNowPlayingInfo(), which we call on every transport event.
    private var nowPlayingTitle: String?
    private var nowPlayingArtist: String?
    private var nowPlayingAlbumTitle: String?
    private var didConfigureRemoteCommandCenter = false

    @objc public override func load() {
        super.load()
        registerAudioSessionObservers()
        configureAudioSession()
        configureRemoteCommandCenter()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        // Release the idle-timer lock if we go away mid-playback so other
        // apps / screens don't inherit a permanently-awake device.
        DispatchQueue.main.async {
            if UIApplication.shared.isIdleTimerDisabled {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let rawTracks = call.getArray("tracks") as? [JSObject] else {
            call.reject("Missing tracks")
            return
        }

        Task {
            do {
                let result = try await self.prepareTracks(rawTracks, call: call)
                await self.configureEngine(with: result.tracks)
                var payload: [String: Any] = [
                    "duration": self.duration,
                    "tracks": self.tracksPayload()
                ]
                if !result.warnings.isEmpty {
                    payload["warnings"] = result.warnings
                }
                call.resolve(payload)
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
            } else {
                // Paused seek — startPlayback() won't fire, so push the new
                // position to the lock screen ourselves.
                self.updateNowPlayingInfo()
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
            if self.isSyncDebugTrack(track) {
                CAPLog.print("NLDE SYNCDBG MIX index=\(track.loadIndex) id=\(track.id) name=\(track.name) setTrackVolume requested=\(volume) applied=\(track.player.volume) muted=\(track.isMuted) solo=\(self.soloTrackId ?? "none")")
            }
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
            if self.isSyncDebugTrack(track) {
                CAPLog.print("NLDE SYNCDBG MIX index=\(track.loadIndex) id=\(track.id) name=\(track.name) setOutputRoute=\(outputRoute) pan=\(track.player.pan)")
            }
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
            if self.isSyncDebugTrack(track) {
                CAPLog.print("NLDE SYNCDBG MIX index=\(track.loadIndex) id=\(track.id) name=\(track.name) toggleMute muted=\(track.isMuted) appliedVolume=\(track.player.volume)")
            }
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
            self.tracks
                .filter { self.isSyncDebugTrack($0) }
                .forEach {
                    CAPLog.print("NLDE SYNCDBG MIX index=\($0.loadIndex) id=\($0.id) name=\($0.name) soloTrack=\(self.soloTrackId ?? "none") appliedVolume=\($0.player.volume) muted=\($0.isMuted)")
                }
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

    /// Accept a title/artist/album from the JS side and push them to the
    /// lock screen / Now Playing center. Safe to call as often as metadata
    /// changes (e.g. when the user picks a different song).
    @objc func setNowPlayingMetadata(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist")
        let albumTitle = call.getString("albumTitle")
        engineQueue.async {
            self.nowPlayingTitle = title.isEmpty ? nil : title
            self.nowPlayingArtist = artist?.isEmpty == true ? nil : artist
            self.nowPlayingAlbumTitle = albumTitle?.isEmpty == true ? nil : albumTitle
            self.updateNowPlayingInfo()
            DispatchQueue.main.async {
                call.resolve()
            }
        }
    }

    /// Used when leaving the Live Director screen — clears the lock-screen
    /// card so we don't advertise a song we aren't actually playing anymore.
    @objc func clearNowPlayingMetadata(_ call: CAPPluginCall) {
        engineQueue.async {
            self.nowPlayingTitle = nil
            self.nowPlayingArtist = nil
            self.nowPlayingAlbumTitle = nil
            DispatchQueue.main.async {
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
                call.resolve()
            }
        }
    }

    /// Result of preparing a session worth of tracks. `warnings` contains one
    /// JS-ready dictionary per track that failed to open, so the React side can
    /// surface a non-blocking banner ("El stem X no se pudo abrir, se omitió")
    /// instead of the whole session collapsing because of a single bad file.
    private struct PreparedTracksResult {
        let tracks: [NativeTrack]
        let warnings: [[String: Any]]
    }

    private func prepareTracks(_ rawTracks: [JSObject], call: CAPPluginCall) async throws -> PreparedTracksResult {
        // Defensive filter: React already strips `enabled === false` tracks, but
        // we double-check here so a stale bridge call can never download,
        // decode, or attach a disabled stem on the native side.
        let activeRawTracks = rawTracks.filter { rawTrack in
            if let enabledFlag = rawTrack["enabled"] as? Bool {
                return enabledFlag
            }
            return true
        }

        let skippedCount = rawTracks.count - activeRawTracks.count
        if skippedCount > 0 {
            CAPLog.print("NativeLiveDirectorEngine prepareTracks skipping \(skippedCount) disabled track(s)")
        }

        var preparedTracks: [NativeTrack] = []
        var warnings: [[String: Any]] = []
        var lastOpenError: NSError? = nil
        notifyLoadProgress(loaded: 0, total: activeRawTracks.count)

        for (index, rawTrack) in activeRawTracks.enumerated() {
            guard
                let id = rawTrack["id"] as? String,
                let urlString = rawTrack["url"] as? String,
                let sourceURL = URL(string: urlString)
            else {
                // Structural issue (missing id/url) — still hard fail, this is
                // a bug in the caller, not a runtime asset problem.
                throw NSError(domain: "NativeLiveDirectorEngine", code: 10, userInfo: [
                    NSLocalizedDescriptionKey: "Track \(index + 1) is missing id or url."
                ])
            }

            let name = rawTrack["name"] as? String ?? id
            let remoteURL = preferredAudioURL(from: rawTrack, fallbackURL: sourceURL)
            CAPLog.print("NativeLiveDirectorEngine prepareTrack start index=\(index + 1)/\(activeRawTracks.count) id=\(id) ext=\(remoteURL.pathExtension.lowercased()) optimized=\(remoteURL.absoluteString != sourceURL.absoluteString)")
            let volume = clampVolume(Float((rawTrack["volume"] as? Double) ?? 1))
            let isMuted = rawTrack["isMuted"] as? Bool ?? false
            let outputRoute = normalizeOutputRoute(rawTrack["outputRoute"] as? String ?? "stereo")

            let localURL: URL
            do {
                localURL = try await cachedAudioURL(for: remoteURL)
            } catch {
                let nsError = error as NSError
                CAPLog.print("NLDE ASSET_CACHE_FAIL id=\(id) remote=\(remoteURL.absoluteString) domain=\(nsError.domain) code=\(nsError.code) desc=\(nsError.localizedDescription)")
                warnings.append([
                    "trackId": id,
                    "trackName": name,
                    "reason": "cache",
                    "osStatus": nsError.code,
                    "fourCharCode": fourCharCodeString(from: nsError.code),
                    "message": "No se pudo descargar el stem '\(name)': \(nsError.localizedDescription)"
                ])
                lastOpenError = nsError
                notifyLoadProgress(loaded: index + 1, total: activeRawTracks.count)
                continue
            }

            let file: AVAudioFile
            do {
                file = try AVAudioFile(forReading: localURL)
            } catch {
                let nsError = error as NSError
                let osCode = nsError.code
                let fourCC = fourCharCodeString(from: osCode)
                let fileSize: String
                if let attrs = try? FileManager.default.attributesOfItem(atPath: localURL.path),
                   let bytes = attrs[.size] as? NSNumber {
                    fileSize = "\(bytes.intValue)B"
                } else {
                    fileSize = "?"
                }
                CAPLog.print("NLDE ASSET_OPEN_FAIL id=\(id) local=\(localURL.lastPathComponent) sourceExt=\(sourceURL.pathExtension.lowercased()) playExt=\(remoteURL.pathExtension.lowercased()) size=\(fileSize) OSStatus=\(osCode) fourCC=\(fourCC) domain=\(nsError.domain) desc=\(nsError.localizedDescription)")

                // Special-case: raw ADTS .aac is known to be fragile in
                // AVAudioFile (AACAudioFile::ParseAudioFile fails with
                // 'sync'). Surface a targeted hint so the operator knows the
                // file needs to be remuxed to .m4a.
                let playExt = remoteURL.pathExtension.lowercased()
                let hint: String
                if osCode == 1937337955 && playExt == "aac" {
                    hint = " — el archivo .aac crudo (ADTS) no lo parsea AVAudioFile en iOS. Re-encodéalo como .m4a o .wav."
                } else if osCode == 1937337955 {
                    hint = " — el archivo está corrupto o el contenedor no coincide con la extensión. Verificá la descarga o re-encodeá."
                } else {
                    hint = ""
                }

                warnings.append([
                    "trackId": id,
                    "trackName": name,
                    "reason": "open",
                    "osStatus": osCode,
                    "fourCharCode": fourCC,
                    "playExtension": playExt,
                    "message": "No se pudo abrir el stem '\(name)' (\(id)): \(nsError.localizedDescription) [OSStatus=\(osCode) '\(fourCC)']\(hint)"
                ])
                lastOpenError = nsError
                notifyLoadProgress(loaded: index + 1, total: activeRawTracks.count)
                continue
            }
            CAPLog.print("NLDE ASSET id=\(id) local=\(localURL.lastPathComponent) sourceExt=\(sourceURL.pathExtension.lowercased()) playExt=\(remoteURL.pathExtension.lowercased()) durationFrames=\(file.length) scheduleMode=\(schedulingModeName(for: file)) \(audioFileSummary(file, url: localURL))")

            // Reuse the envelope the caller already persisted, otherwise
            // compute it here off the main thread. Activity envelopes replace
            // live meter taps for the breathing UI animation, so we only
            // spend this work once per load.
            let persistedEnvelope = parseActivityEnvelope(rawTrack["activityEnvelope"])
            let activityEnvelope: ActivityEnvelope?
            if let persistedEnvelope = persistedEnvelope {
                activityEnvelope = persistedEnvelope
            } else {
                activityEnvelope = await computeActivityEnvelope(for: localURL)
            }

            let nativeTrack = NativeTrack(
                id: id,
                name: name,
                sourceURL: sourceURL,
                remoteURL: remoteURL,
                localURL: localURL,
                file: file,
                loadIndex: index + 1,
                volume: volume,
                isMuted: isMuted,
                outputRoute: outputRoute,
                activityEnvelope: activityEnvelope
            )
            if isSyncDebugTrack(nativeTrack) {
                logSyncDebugAsset(nativeTrack)
            }
            preparedTracks.append(nativeTrack)
            notifyLoadProgress(loaded: index + 1, total: activeRawTracks.count)
        }

        // If *every* enabled track failed we have nothing to play, so bubble
        // up the last underlying error as the rejection reason. Otherwise we
        // return whatever we could load and let the UI surface warnings.
        if preparedTracks.isEmpty, !activeRawTracks.isEmpty {
            if let underlying = lastOpenError {
                throw NSError(domain: "NativeLiveDirectorEngine", code: 15, userInfo: [
                    NSLocalizedDescriptionKey: "Ningún stem se pudo abrir. \(underlying.localizedDescription)",
                    "warnings": warnings
                ])
            }
            throw NSError(domain: "NativeLiveDirectorEngine", code: 15, userInfo: [
                NSLocalizedDescriptionKey: "Ningún stem se pudo cargar.",
                "warnings": warnings
            ])
        }

        if !warnings.isEmpty {
            CAPLog.print("NativeLiveDirectorEngine prepareTracks completed with \(warnings.count) skipped stem(s); \(preparedTracks.count)/\(activeRawTracks.count) loaded")
        }

        return PreparedTracksResult(tracks: preparedTracks, warnings: warnings)
    }

    private func parseActivityEnvelope(_ raw: Any?) -> ActivityEnvelope? {
        guard let dict = raw as? JSObject else {
            return nil
        }

        let bucketMsValue = (dict["bucketMs"] as? Int)
            ?? Int(round((dict["bucketMs"] as? Double) ?? 0))
        let bucketMs = max(20, bucketMsValue > 0 ? bucketMsValue : 100)

        guard let rawValues = dict["values"] as? [Any], !rawValues.isEmpty else {
            return nil
        }

        var values: [Double] = []
        values.reserveCapacity(rawValues.count)
        var hasAnyActivity = false
        for rawValue in rawValues {
            let numericValue: Double
            if let doubleValue = rawValue as? Double {
                numericValue = doubleValue
            } else if let intValue = rawValue as? Int {
                numericValue = Double(intValue)
            } else if let nsNumber = rawValue as? NSNumber {
                numericValue = nsNumber.doubleValue
            } else {
                numericValue = 0
            }
            let clamped = min(1, max(0, numericValue.isFinite ? numericValue : 0))
            let quantized = (clamped * 1000).rounded() / 1000
            values.append(quantized)
            if quantized > 0 {
                hasAnyActivity = true
            }
        }

        guard hasAnyActivity else {
            return nil
        }

        return ActivityEnvelope(bucketMs: bucketMs, values: values)
    }

    private func computeActivityEnvelope(for localURL: URL) async -> ActivityEnvelope? {
        await withCheckedContinuation { (continuation: CheckedContinuation<ActivityEnvelope?, Never>) in
            DispatchQueue.global(qos: .utility).async {
                let envelope = self.computeActivityEnvelopeSync(for: localURL)
                continuation.resume(returning: envelope)
            }
        }
    }

    private func computeActivityEnvelopeSync(for localURL: URL) -> ActivityEnvelope? {
        let bucketMs = 100
        do {
            let file = try AVAudioFile(forReading: localURL)
            let format = file.processingFormat
            guard format.sampleRate > 0, format.channelCount > 0 else {
                return nil
            }

            let totalFrames = file.length
            guard totalFrames > 0 else {
                return nil
            }

            let framesPerBucket = max(1, Int((Double(bucketMs) / 1000.0) * format.sampleRate))
            let bucketCount = max(1, Int((totalFrames + AVAudioFramePosition(framesPerBucket) - 1) / AVAudioFramePosition(framesPerBucket)))
            var buckets = [Float](repeating: 0, count: bucketCount)

            // Read in reasonably-sized chunks so we do not allocate a full-
            // track buffer. 1 second worth of audio per read keeps memory
            // small and cache-friendly without the per-bucket overhead.
            let chunkFrameCount: AVAudioFrameCount = AVAudioFrameCount(max(framesPerBucket * 10, 4096))
            guard let readBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkFrameCount) else {
                return nil
            }

            var cursorFrame: Int = 0
            while cursorFrame < Int(totalFrames) {
                readBuffer.frameLength = 0
                do {
                    try file.read(into: readBuffer)
                } catch {
                    return nil
                }

                let frameCount = Int(readBuffer.frameLength)
                if frameCount <= 0 {
                    break
                }

                guard let channelData = readBuffer.floatChannelData else {
                    cursorFrame += frameCount
                    continue
                }

                let channelCount = Int(format.channelCount)
                for channelIndex in 0..<channelCount {
                    let samples = channelData[channelIndex]
                    // Walk the channel frame-by-frame to accumulate per-bucket
                    // peak magnitude. We avoid vDSP here because bucket
                    // boundaries do not always line up with chunk boundaries.
                    var localFrame = 0
                    while localFrame < frameCount {
                        let globalFrame = cursorFrame + localFrame
                        let bucketIndex = min(bucketCount - 1, globalFrame / framesPerBucket)
                        let bucketEndFrameGlobal = (bucketIndex + 1) * framesPerBucket
                        let framesRemainingInBucketGlobal = bucketEndFrameGlobal - globalFrame
                        let framesRemainingInChunk = frameCount - localFrame
                        let framesInSlice = max(1, min(framesRemainingInBucketGlobal, framesRemainingInChunk))

                        var sliceMax: Float = 0
                        let slicePointer = UnsafePointer(samples.advanced(by: localFrame))
                        vDSP_maxmgv(slicePointer, 1, &sliceMax, vDSP_Length(framesInSlice))

                        if sliceMax > buckets[bucketIndex] {
                            buckets[bucketIndex] = sliceMax
                        }

                        localFrame += framesInSlice
                    }
                }

                cursorFrame += frameCount
            }

            var values: [Double] = []
            values.reserveCapacity(bucketCount)
            var hasAnyActivity = false
            for peak in buckets {
                let value = shapePeakToActivity(peak)
                values.append(value)
                if value > 0 {
                    hasAnyActivity = true
                }
            }

            guard hasAnyActivity else {
                return nil
            }

            return ActivityEnvelope(bucketMs: bucketMs, values: values)
        } catch {
            CAPLog.print("NativeLiveDirectorEngine envelope compute failed local=\(localURL.lastPathComponent) error=\(error.localizedDescription)")
            return nil
        }
    }

    private func shapePeakToActivity(_ peak: Float) -> Double {
        if !peak.isFinite || peak <= 0.00075 {
            return 0
        }
        let activity = Double(sqrt(peak) * 1.14)
        if activity >= 1 {
            return 1
        }
        if activity <= 0 {
            return 0
        }
        return (activity * 1000).rounded() / 1000
    }

    private func configureEngine(with nextTracks: [NativeTrack]) async {
        await withCheckedContinuation { continuation in
            engineQueue.async {
                self.stopPlayback(resetPosition: true)
                self.tracks.forEach { track in
                    self.engine.detach(track.player)
                }
                self.engine.stop()
                self.engine.reset()
                self.tracks = nextTracks
                let timelineTracks = nextTracks.filter { !self.isInternalPadTrack($0) }
                self.duration = (timelineTracks.isEmpty ? nextTracks : timelineTracks).map(\.duration).max() ?? 0
                self.playbackStopDuration = self.duration + (nextTracks.contains(where: { self.isInternalPadTrack($0) }) ? self.internalPadTailSeconds : 0)
                self.internalPadFadeScale = 1
                self.lastSyncDebugLogElapsed = -Double.greatestFiniteMagnitude
                self.seekOffset = 0
                self.trackLevels = nextTracks.reduce(into: [String: Double]()) { levels, track in
                    levels[track.id] = 0
                }
                self.logSyncDebugSessionSummary()

                nextTracks.forEach { track in
                    self.engine.attach(track.player)
                    self.engine.connect(track.player, to: self.engine.mainMixerNode, format: track.file.processingFormat)
                    self.applyTrackMixState(track)
                }

                self.engine.mainMixerNode.outputVolume = self.masterVolume
                self.startStateTimer()
                // New session → refresh lock-screen duration, even if
                // metadata hasn't been set yet (it'll use the default
                // "Live Director" title until the JS side pushes a real
                // song name via setNowPlayingMetadata).
                self.updateNowPlayingInfo()
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

        // Three-pass startup to keep every AVAudioPlayerNode sample-aligned on
        // seeks. Mixing stop/schedule/play in a single loop occasionally left a
        // node in a stale-buffer state after seeking — the next scheduleSegment
        // silently did nothing and the stem "dejó de sonar" until the session
        // was reloaded.
        //
        // Pass 1: stop + reset each player so its internal scheduled-buffer
        //         queue is guaranteed clean.
        tracks.forEach { track in
            track.player.stop()
            track.player.reset()
        }

        // Pass 2: schedule the real audio segment + the trailing silence pad
        //         for every track. Pad length is adjusted for the current
        //         seek offset so late-song seeks don't overshoot the shared
        //         timeline on shorter stems.
        tracks.forEach { track in
            let sampleRate = track.file.processingFormat.sampleRate
            let startFrame = AVAudioFramePosition(max(0, seekOffset) * sampleRate)
            let clampedStartFrame = min(max(0, startFrame), track.file.length)
            track.scheduledUntilFrame = clampedStartFrame
            scheduleRemainingTrackSegment(track)
            scheduleSilencePadIfNeeded(track, seekOffset: seekOffset)
            track.player.prepare(withFrameCount: playerPrepareFrameCount)
        }

        internalPadFadeScale = internalPadFadeScale(forElapsed: seekOffset)
        tracks.forEach { applyTrackMixState($0) }
        lastSyncDebugLogElapsed = -Double.greatestFiniteMagnitude

        // Pass 3: arm every player to start at the same hostTime. Done last so
        //         scheduling work above doesn't eat into the start delay and
        //         push some nodes past the target (which used to happen when
        //         schedule + play were interleaved in one forEach).
        let startHostTime = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: playbackStartDelay)
        let startTime = AVAudioTime(hostTime: startHostTime)
        tracks.forEach { $0.player.play(at: startTime) }
        playStartWallTime = CACurrentMediaTime() + playbackStartDelay - seekOffset
        playbackAnchorOffset = seekOffset
        playbackStartHostTime = startHostTime
        isPlaying = true
        setIdleTimerDisabled(true)
        startStateTimer()
        logSessionState("post-startPlayback")
        logPlaybackAlignment("post-startPlayback")
        logSyncDebugPlaybackSnapshot("post-startPlayback", elapsed: seekOffset)
        emitState()
        updateNowPlayingInfo()
    }

    private func scheduleRemainingTrackSegment(_ track: NativeTrack) {
        let sampleRate = track.file.processingFormat.sampleRate
        var scheduleEndFrame = track.file.length
        if isInternalPadTrack(track), duration > 0, sampleRate > 0 {
            let padEndFrame = AVAudioFramePosition((playbackStopDuration * sampleRate).rounded(.up))
            scheduleEndFrame = min(scheduleEndFrame, max(0, padEndFrame))
        }

        let remainingFrames = scheduleEndFrame - track.scheduledUntilFrame
        guard remainingFrames > 0 else {
            if isSyncDebugTrack(track) {
                CAPLog.print("NLDE SYNCDBG SCHED index=\(track.loadIndex) id=\(track.id) name=\(track.name) no-remaining startFrame=\(track.scheduledUntilFrame) endFrame=\(scheduleEndFrame) fileFrames=\(track.file.length) seek=\(String(format: "%.6f", seekOffset))")
            }
            return
        }

        let framesToSchedule = min(remainingFrames, AVAudioFramePosition(UInt32.max))
        CAPLog.print("NLDE SCHED id=\(track.id) mode=\(schedulingModeName(for: track.file)) startFrame=\(track.scheduledUntilFrame) frames=\(framesToSchedule)")
        if isSyncDebugTrack(track) {
            let startSec = sampleRate > 0 ? Double(track.scheduledUntilFrame) / sampleRate : 0
            let endSec = sampleRate > 0 ? Double(scheduleEndFrame) / sampleRate : 0
            let framesSec = sampleRate > 0 ? Double(framesToSchedule) / sampleRate : 0
            CAPLog.print(
                "NLDE SYNCDBG SCHED index=\(track.loadIndex) id=\(track.id) name=\(track.name) mode=\(schedulingModeName(for: track.file)) startFrame=\(track.scheduledUntilFrame) startSec=\(String(format: "%.6f", startSec)) frames=\(framesToSchedule) framesSec=\(String(format: "%.6f", framesSec)) endFrame=\(scheduleEndFrame) endSec=\(String(format: "%.6f", endSec)) fileFrames=\(track.file.length) fileSec=\(String(format: "%.6f", track.duration)) seek=\(String(format: "%.6f", seekOffset))"
            )
        }
        track.player.scheduleSegment(
            track.file,
            startingFrame: track.scheduledUntilFrame,
            frameCount: AVAudioFrameCount(framesToSchedule),
            at: nil,
            completionHandler: nil
        )
        track.scheduledUntilFrame += framesToSchedule
    }

    /// If this track is shorter than the longest track in the session, append a
    /// silent buffer so every player node remains active for the full session
    /// duration. This keeps start/stop alignment checks consistent and avoids
    /// late-track "early stop" artifacts (e.g. bass/custom-ga being ~52ms short
    /// of the other stems due to source-file length mismatches).
    ///
    /// When called from a seek path, `seekOffset` lets us shrink the pad so
    /// stems that end before the seek point don't over-play silence past the
    /// longer stems and desync the mix.
    private func scheduleSilencePadIfNeeded(_ track: NativeTrack, seekOffset: Double = 0) {
        if isInternalPadTrack(track) {
            return
        }

        let trackSampleRate = track.file.processingFormat.sampleRate
        guard trackSampleRate > 0, duration > 0 else {
            return
        }

        let trackSeconds = Double(track.file.length) / trackSampleRate
        // Remaining real audio after the seek (0 if seek is past this stem).
        let remainingRealSeconds = max(0, trackSeconds - max(0, seekOffset))
        // Remaining timeline for the longest stem after the seek.
        let remainingMaxSeconds = max(0, duration - max(0, seekOffset))
        let gapSeconds = remainingMaxSeconds - remainingRealSeconds
        // Anything under ~2ms is just floating point noise; ignore.
        guard gapSeconds > 0.002 else {
            return
        }
        guard gapSeconds <= maxScheduledSilencePadSeconds else {
            CAPLog.print(
                "NLDE PAD id=\(track.id) skip-large-silence gapMs=\(String(format: "%.2f", gapSeconds * 1000)) maxMs=\(String(format: "%.0f", maxScheduledSilencePadSeconds * 1000))"
            )
            return
        }

        let silenceFrameCount = AVAudioFrameCount(max(1, (gapSeconds * trackSampleRate).rounded(.up)))
        let format = track.file.processingFormat
        guard let silenceBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: silenceFrameCount) else {
            CAPLog.print("NLDE PAD id=\(track.id) failed-to-alloc silenceFrames=\(silenceFrameCount)")
            return
        }

        silenceBuffer.frameLength = silenceFrameCount
        // AVAudioPCMBuffer allocation does not guarantee zeroed memory across
        // all iOS versions. Zero every channel explicitly.
        if let channelData = silenceBuffer.floatChannelData {
            let bytesPerChannel = Int(silenceFrameCount) * MemoryLayout<Float>.stride
            for channel in 0..<Int(format.channelCount) {
                memset(channelData[channel], 0, bytesPerChannel)
            }
        } else if let int16Data = silenceBuffer.int16ChannelData {
            let bytesPerChannel = Int(silenceFrameCount) * MemoryLayout<Int16>.stride
            for channel in 0..<Int(format.channelCount) {
                memset(int16Data[channel], 0, bytesPerChannel)
            }
        } else if let int32Data = silenceBuffer.int32ChannelData {
            let bytesPerChannel = Int(silenceFrameCount) * MemoryLayout<Int32>.stride
            for channel in 0..<Int(format.channelCount) {
                memset(int32Data[channel], 0, bytesPerChannel)
            }
        }

        CAPLog.print(
            "NLDE PAD id=\(track.id) silenceFrames=\(silenceFrameCount) gapMs=\(String(format: "%.2f", gapSeconds * 1000)) sr=\(trackSampleRate) trackSeconds=\(String(format: "%.3f", trackSeconds)) maxDuration=\(String(format: "%.3f", duration)) seekOffset=\(String(format: "%.3f", seekOffset))"
        )
        track.player.scheduleBuffer(silenceBuffer, at: nil, options: [], completionHandler: nil)
    }

    private func pausePlayback() {
        if isPlaying {
            logSyncDebugPlaybackSnapshot("pre-pausePlayback", elapsed: rawCurrentTime())
            seekOffset = currentTime()
        }
        tracks.forEach { $0.player.pause() }
        isPlaying = false
        setIdleTimerDisabled(false)
        resetMeters()
        emitState()
        updateNowPlayingInfo()
    }

    private func stopPlayback(resetPosition: Bool, shouldEmitState: Bool = true) {
        if isPlaying {
            logSyncDebugPlaybackSnapshot("pre-stopPlayback", elapsed: rawCurrentTime())
            logPlaybackAlignment("pre-stopPlayback")
        }
        tracks.forEach { $0.player.stop() }
        isPlaying = false
        setIdleTimerDisabled(false)
        if resetPosition {
            seekOffset = 0
            playbackAnchorOffset = 0
            playbackStartHostTime = 0
        }
        internalPadFadeScale = 1
        tracks.forEach { $0.scheduledUntilFrame = 0 }
        resetMeters()
        if shouldEmitState {
            emitState()
            updateNowPlayingInfo()
        }
    }

    /// Keep the iPad screen from dimming/locking while multitrack is live.
    /// Must be set on the main thread. Safe to call redundantly.
    private func setIdleTimerDisabled(_ disabled: Bool) {
        DispatchQueue.main.async {
            if UIApplication.shared.isIdleTimerDisabled != disabled {
                UIApplication.shared.isIdleTimerDisabled = disabled
            }
        }
    }

    private func currentTime() -> Double {
        return min(duration, max(0, rawCurrentTime()))
    }

    private func rawCurrentTime() -> Double {
        if isPlaying {
            if playbackStartHostTime > 0 {
                let nowHostTime = mach_absolute_time()
                if nowHostTime <= playbackStartHostTime {
                    return max(0, playbackAnchorOffset)
                }

                let elapsedHostTime = nowHostTime - playbackStartHostTime
                let elapsedSeconds = AVAudioTime.seconds(forHostTime: elapsedHostTime)
                return max(0, playbackAnchorOffset + elapsedSeconds)
            }
            return max(0, CACurrentMediaTime() - playStartWallTime)
        }

        return max(0, seekOffset)
    }

    private func applyTrackMixState(_ track: NativeTrack) {
        let soloAllowsTrack = soloTrackId == nil || soloTrackId == track.id
        let fadeScale = isInternalPadTrack(track) ? internalPadFadeScale : 1
        track.player.volume = track.isMuted || !soloAllowsTrack ? 0 : track.volume * fadeScale

        switch track.outputRoute {
        case "left":
            track.player.pan = -1
        case "right":
            track.player.pan = 1
        default:
            track.player.pan = 0
        }
    }

    // Live per-player meter taps were removed: we now derive per-track activity
    // from the precomputed envelope instead of running an AVAudioEngine tap,
    // which was the main source of route-change crashes on iPad. Keep this
    // shim so the JS bridge can still call setMetersEnabled without blowing
    // up if the preference is toggled in the UI.
    private func setMetersEnabledInternal(_ enabled: Bool) {
        if metersEnabled {
            metersEnabled = false
            resetMeters()
            emitState()
        }

        CAPLog.print("NLDE METERS requested=\(enabled) forced=false stabilityBuild=true")
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
            let elapsed = self.rawCurrentTime()
            self.updateInternalPadTailFade(elapsed: elapsed)
            self.logSyncDebugPlaybackIfNeeded(elapsed: elapsed)
            if self.isPlaying && self.playbackStopDuration > 0 && elapsed >= self.playbackStopDuration {
                self.stopPlayback(resetPosition: true)
                return
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
            var payload: JSObject = [
                "id": track.id,
                "name": track.name,
                "url": track.sourceURL.absoluteString,
                "nativeUrl": track.remoteURL.absoluteString,
                "volume": Double(track.volume),
                "isMuted": track.isMuted,
                "outputRoute": track.outputRoute,
                "durationSeconds": track.duration
            ]
            if let envelope = track.activityEnvelope {
                payload["activityEnvelope"] = [
                    "bucketMs": envelope.bucketMs,
                    "values": envelope.values
                ] as JSObject
            }
            return payload
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

    private func schedulingModeName(for file: AVAudioFile) -> String {
        isLinearPCMFile(file) ? "single-segment-pcm" : "single-segment-compressed"
    }

    private func isInternalPadTrack(_ track: NativeTrack) -> Bool {
        track.id == internalPadTrackId
    }

    private func internalPadFadeScale(forElapsed elapsed: Double) -> Float {
        guard
            duration > 0,
            playbackStopDuration > duration,
            internalPadFadeOutSeconds > 0,
            tracks.contains(where: { isInternalPadTrack($0) })
        else {
            return 1
        }

        let fadeStart = max(duration, playbackStopDuration - internalPadFadeOutSeconds)
        if elapsed <= fadeStart {
            return 1
        }
        if elapsed >= playbackStopDuration {
            return 0
        }

        let remaining = max(0, playbackStopDuration - elapsed)
        return Float(min(1, max(0, remaining / internalPadFadeOutSeconds)))
    }

    private func updateInternalPadTailFade(elapsed: Double) {
        let nextScale = internalPadFadeScale(forElapsed: elapsed)
        guard abs(nextScale - internalPadFadeScale) > 0.001 else {
            return
        }

        internalPadFadeScale = nextScale
        tracks
            .filter { isInternalPadTrack($0) }
            .forEach { applyTrackMixState($0) }
    }

    private struct SyncDebugPlayerInfo {
        let nodeSeconds: Double
        let absoluteSeconds: Double
        let sampleTime: AVAudioFramePosition
        let sampleRate: Double
    }

    private func isSyncDebugTrack(_ track: NativeTrack) -> Bool {
        let compactText = syncDebugCompactText([
            track.id,
            track.name,
            track.sourceURL.lastPathComponent,
            track.remoteURL.lastPathComponent,
            track.localURL.lastPathComponent
        ])

        return compactText.contains("ge345")
    }

    private func syncDebugCompactText(_ values: [String]) -> String {
        values
            .joined(separator: " ")
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
            .filter { $0.isLetter || $0.isNumber }
    }

    private func logSyncDebugAsset(_ track: NativeTrack) {
        let file = track.file
        let fileRate = file.fileFormat.sampleRate
        let processingRate = file.processingFormat.sampleRate
        let fileDuration = processingRate > 0 ? Double(file.length) / processingRate : 0
        let fileSizeBytes = (try? track.localURL.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        let fileSizeMB = Double(fileSizeBytes) / 1_048_576
        let asset = AVURLAsset(url: track.localURL)
        let assetDuration = CMTimeGetSeconds(asset.duration)
        let assetDeltaMs = assetDuration.isFinite ? (assetDuration - fileDuration) * 1000 : Double.nan
        let assetTrackSummary = asset.tracks(withMediaType: .audio)
            .enumerated()
            .map { index, assetTrack in
                let rangeDuration = CMTimeGetSeconds(assetTrack.timeRange.duration)
                return "audioTrack\(index)=timeRangeSec=\(String(format: "%.6f", rangeDuration))"
            }
            .joined(separator: " ")

        CAPLog.print(
            "NLDE SYNCDBG ASSET index=\(track.loadIndex) id=\(track.id) name=\(track.name) local=\(track.localURL.lastPathComponent) remote=\(track.remoteURL.lastPathComponent) source=\(track.sourceURL.lastPathComponent) fileSizeMB=\(String(format: "%.2f", fileSizeMB)) fileFrames=\(file.length) fileDurationSec=\(String(format: "%.6f", fileDuration)) assetDurationSec=\(String(format: "%.6f", assetDuration)) assetMinusFileMs=\(String(format: "%+.2f", assetDeltaMs)) fileRate=\(String(format: "%.0f", fileRate)) processingRate=\(String(format: "%.0f", processingRate)) channels=\(file.processingFormat.channelCount) scheduleMode=\(schedulingModeName(for: file)) \(assetTrackSummary)"
        )
    }

    private func logSyncDebugSessionSummary() {
        guard tracks.contains(where: { isSyncDebugTrack($0) }) else {
            return
        }

        CAPLog.print(
            "NLDE SYNCDBG SESSION durationSec=\(String(format: "%.6f", duration)) playbackStopSec=\(String(format: "%.6f", playbackStopDuration)) tracks=\(tracks.count) sampleRate=\(String(format: "%.0f", AVAudioSession.sharedInstance().sampleRate))"
        )
        tracks.forEach { track in
            let deltaMs = (track.duration - duration) * 1000
            let sampleRate = track.file.processingFormat.sampleRate
            CAPLog.print(
                "NLDE SYNCDBG SESSION_TRACK index=\(track.loadIndex) debug=\(isSyncDebugTrack(track)) id=\(track.id) name=\(track.name) file=\(track.remoteURL.lastPathComponent) frames=\(track.file.length) durationSec=\(String(format: "%.6f", track.duration)) deltaVsSessionMs=\(String(format: "%+.2f", deltaMs)) sr=\(String(format: "%.0f", sampleRate)) muted=\(track.isMuted) vol=\(track.volume)"
            )
        }
    }

    private func playerInfo(for track: NativeTrack) -> SyncDebugPlayerInfo? {
        guard let nodeRenderTime = track.player.lastRenderTime,
              let nodeTime = track.player.playerTime(forNodeTime: nodeRenderTime)
        else {
            return nil
        }

        let sampleRate = nodeTime.sampleRate > 0
            ? nodeTime.sampleRate
            : track.file.processingFormat.sampleRate
        guard sampleRate > 0 else {
            return nil
        }

        let nodeSeconds = Double(nodeTime.sampleTime) / sampleRate
        return SyncDebugPlayerInfo(
            nodeSeconds: nodeSeconds,
            absoluteSeconds: playbackAnchorOffset + nodeSeconds,
            sampleTime: nodeTime.sampleTime,
            sampleRate: sampleRate
        )
    }

    private func logSyncDebugPlaybackIfNeeded(elapsed: Double) {
        guard tracks.contains(where: { isSyncDebugTrack($0) }) else {
            return
        }

        if elapsed < lastSyncDebugLogElapsed {
            lastSyncDebugLogElapsed = -Double.greatestFiniteMagnitude
        }

        guard elapsed - lastSyncDebugLogElapsed >= syncDebugIntervalSeconds else {
            return
        }

        lastSyncDebugLogElapsed = elapsed
        logSyncDebugPlaybackSnapshot("timer", elapsed: elapsed)
    }

    private func logSyncDebugPlaybackSnapshot(_ tag: String, elapsed: Double) {
        let debugTracks = tracks.filter { isSyncDebugTrack($0) }
        guard !debugTracks.isEmpty else {
            return
        }

        let referenceTrack = tracks.first(where: { !isInternalPadTrack($0) && !isSyncDebugTrack($0) })
            ?? tracks.first(where: { !isInternalPadTrack($0) })
        let referenceInfo = referenceTrack.flatMap { playerInfo(for: $0) }
        let referenceLabel = referenceTrack.map { "\($0.loadIndex):\($0.id)" } ?? "none"
        let referenceSeconds = referenceInfo.map { String(format: "%.6f", $0.absoluteSeconds) } ?? "?"

        CAPLog.print(
            "NLDE SYNCDBG PLAY[\(tag)] elapsed=\(String(format: "%.6f", elapsed)) anchor=\(String(format: "%.6f", playbackAnchorOffset)) seek=\(String(format: "%.6f", seekOffset)) ref=\(referenceLabel) refAbsSec=\(referenceSeconds) isPlaying=\(isPlaying)"
        )

        debugTracks.forEach { track in
            guard let info = playerInfo(for: track) else {
                CAPLog.print("NLDE SYNCDBG PLAY[\(tag)] target index=\(track.loadIndex) id=\(track.id) name=\(track.name) no-playerTime playerPlaying=\(track.player.isPlaying) scheduledUntil=\(track.scheduledUntilFrame) fileFrames=\(track.file.length)")
                return
            }

            let driftHostMs = (info.absoluteSeconds - elapsed) * 1000
            let driftRefMs = referenceInfo.map { (info.absoluteSeconds - $0.absoluteSeconds) * 1000 }
            let driftRefText = driftRefMs.map { String(format: "%+.2f", $0) } ?? "?"
            CAPLog.print(
                "NLDE SYNCDBG PLAY[\(tag)] target index=\(track.loadIndex) id=\(track.id) name=\(track.name) nodeSec=\(String(format: "%.6f", info.nodeSeconds)) absSec=\(String(format: "%.6f", info.absoluteSeconds)) driftHostMs=\(String(format: "%+.2f", driftHostMs)) driftRefMs=\(driftRefText) sampleTime=\(info.sampleTime) sr=\(String(format: "%.0f", info.sampleRate)) scheduledUntil=\(track.scheduledUntilFrame) fileFrames=\(track.file.length) playerPlaying=\(track.player.isPlaying) muted=\(track.isMuted) vol=\(String(format: "%.4f", track.player.volume)) pan=\(String(format: "%.2f", track.player.pan))"
            )
        }
    }

    private func isLinearPCMFile(_ file: AVAudioFile) -> Bool {
        file.fileFormat.streamDescription.pointee.mFormatID == kAudioFormatLinearPCM
    }

    /// Decodes a numeric OSStatus (often returned by CoreAudio/AVFoundation)
    /// as a 4-character ASCII code when possible. Example: 1937337955 → "sync".
    /// Falls back to the numeric string for non-printable codes.
    private func fourCharCodeString(from code: Int) -> String {
        let value = UInt32(bitPattern: Int32(truncatingIfNeeded: code))
        let bytes: [UInt8] = [
            UInt8((value >> 24) & 0xFF),
            UInt8((value >> 16) & 0xFF),
            UInt8((value >> 8) & 0xFF),
            UInt8(value & 0xFF)
        ]
        let allPrintable = bytes.allSatisfy { $0 >= 0x20 && $0 <= 0x7E }
        if allPrintable {
            return String(bytes: bytes, encoding: .ascii) ?? String(code)
        }
        return String(code)
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

    /// Wires up the iOS Remote Command Center — the lock-screen / Control
    /// Center / external media-key surface. Play/pause/seek are handled
    /// natively (they just drive the existing engine transport). Next /
    /// Previous Track buttons are forwarded to JS via the `remoteCommand`
    /// event so the React side can decide what "next/prev" means
    /// (section jump, song jump, etc.) without the plugin needing to know.
    private func configureRemoteCommandCenter() {
        guard !didConfigureRemoteCommandCenter else { return }
        didConfigureRemoteCommandCenter = true

        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.engineQueue.async {
                do {
                    try self.startPlayback()
                } catch {
                    CAPLog.print("NLDE REMOTE play FAIL \(error.localizedDescription)")
                }
            }
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.engineQueue.async { self.pausePlayback() }
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.engineQueue.async {
                if self.isPlaying {
                    self.pausePlayback()
                } else {
                    do { try self.startPlayback() } catch {
                        CAPLog.print("NLDE REMOTE toggle->play FAIL \(error.localizedDescription)")
                    }
                }
            }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self = self else { return .commandFailed }
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let target = max(0, positionEvent.positionTime)
            self.engineQueue.async {
                let wasPlaying = self.isPlaying
                self.stopPlayback(resetPosition: false, shouldEmitState: false)
                self.seekOffset = min(target, self.duration)
                if wasPlaying {
                    do { try self.startPlayback() } catch {
                        CAPLog.print("NLDE REMOTE scrub FAIL \(error.localizedDescription)")
                    }
                } else {
                    self.emitState()
                    self.updateNowPlayingInfo()
                }
            }
            return .success
        }

        // Next / Previous Track are pass-through: let the JS side decide what
        // these mean in the context of the current song. React listens for
        // the `remoteCommand` event and calls its own handlePreviousSection
        // / handleNextSection.
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            DispatchQueue.main.async {
                self.notifyListeners("remoteCommand", data: ["action": "nextSection"])
            }
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            DispatchQueue.main.async {
                self.notifyListeners("remoteCommand", data: ["action": "previousSection"])
            }
            return .success
        }

        // Explicitly disable commands we don't support so iOS doesn't show
        // them as active on the lock screen (skipForward / skipBackward
        // with 15s intervals would look odd in a worship context).
        commandCenter.skipForwardCommand.isEnabled = false
        commandCenter.skipBackwardCommand.isEnabled = false
        commandCenter.seekForwardCommand.isEnabled = false
        commandCenter.seekBackwardCommand.isEnabled = false
    }

    /// Push the latest transport state (isPlaying, elapsed, duration,
    /// metadata) to MPNowPlayingInfoCenter. Must be called after any
    /// transport event that changes those values or the lock-screen
    /// scrubber will drift / freeze.
    private func updateNowPlayingInfo() {
        // Read engine-thread-owned state on this queue, then hop to the main
        // queue to touch MPNowPlayingInfoCenter (it's main-thread-affine).
        let title = nowPlayingTitle ?? "Live Director"
        let artist = nowPlayingArtist
        let albumTitle = nowPlayingAlbumTitle
        let durationSnapshot = duration
        let elapsedSnapshot = currentTime()
        let isPlayingSnapshot = isPlaying
        DispatchQueue.main.async {
            var info: [String: Any] = [:]
            info[MPMediaItemPropertyTitle] = title
            if let artist = artist { info[MPMediaItemPropertyArtist] = artist }
            if let albumTitle = albumTitle { info[MPMediaItemPropertyAlbumTitle] = albumTitle }
            info[MPMediaItemPropertyPlaybackDuration] = durationSnapshot
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsedSnapshot
            info[MPNowPlayingInfoPropertyPlaybackRate] = isPlayingSnapshot ? 1.0 : 0.0
            info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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

    /// Passive one-shot snapshot of per-node alignment. Intended to be called at
    /// lifecycle transitions (start/stop) so we can verify drift without running
    /// a periodic timer that might eat CPU on-stage.
    private func logPlaybackAlignment(_ tag: String) {
        guard !tracks.isEmpty else {
            CAPLog.print("NLDE ALIGN[\(tag)] no-tracks")
            return
        }

        let engineRenderTime = engine.isRunning ? engine.outputNode.lastRenderTime : nil
        let engineSampleTime = engineRenderTime?.isSampleTimeValid == true ? engineRenderTime?.sampleTime : nil
        let engineHostTime = engineRenderTime?.isHostTimeValid == true ? engineRenderTime?.hostTime : nil

        var details: [String] = []
        var referenceTime: Double? = nil
        for track in tracks {
            let player = track.player
            guard let nodeRenderTime = player.lastRenderTime else {
                details.append("\(track.id)=no-render")
                continue
            }
            guard let nodeTime = player.playerTime(forNodeTime: nodeRenderTime) else {
                let rawSample = nodeRenderTime.isSampleTimeValid ? String(nodeRenderTime.sampleTime) : "?"
                details.append("\(track.id)=no-playerTime(rawSample=\(rawSample))")
                continue
            }
            let sampleRate = nodeTime.sampleRate > 0
                ? nodeTime.sampleRate
                : track.file.processingFormat.sampleRate
            let seconds = sampleRate > 0 ? Double(nodeTime.sampleTime) / sampleRate : Double.nan
            if referenceTime == nil {
                referenceTime = seconds
            }
            let deltaMs: String
            if let ref = referenceTime {
                deltaMs = String(format: "%+.2f", (seconds - ref) * 1000.0)
            } else {
                deltaMs = "?"
            }
            details.append("\(track.id)=\(String(format: "%.6f", seconds))s Δ=\(deltaMs)ms sr=\(sampleRate) muted=\(track.isMuted) vol=\(track.player.volume)")
        }

        let engineInfo: String
        if let sample = engineSampleTime, let host = engineHostTime {
            engineInfo = "engineSample=\(sample) host=\(host)"
        } else {
            engineInfo = "engine=none"
        }

        CAPLog.print(
            "NLDE ALIGN[\(tag)] isPlaying=\(isPlaying) anchor=\(playbackAnchorOffset) seek=\(seekOffset) \(engineInfo) tracks=\(tracks.count)"
        )
        details.forEach { line in
            CAPLog.print("NLDE ALIGN[\(tag)] • \(line)")
        }
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

            // Apple HIG: when the previous output becomes unavailable
            // (headphones unplugged, Bluetooth disconnected), pause playback so
            // we don't suddenly blast audio through the built-in speaker in a
            // public rehearsal context.
            if reason == .oldDeviceUnavailable, self.isPlaying {
                CAPLog.print("NLDE SESSION route change → pausing due to oldDeviceUnavailable")
                self.pausePlayback()
                return
            }

            // If we're still marked as playing but the engine went down along
            // with the route change, we need a full reschedule — just calling
            // engine.start() is not enough because AVAudioEngine discards the
            // scheduled buffers on hardware configuration swaps.
            if self.isPlaying, !self.engine.isRunning {
                let resumeTime = self.currentTime()
                self.stopPlayback(resetPosition: false, shouldEmitState: false)
                self.seekOffset = min(max(0, resumeTime), self.duration)
                do {
                    try self.startPlayback()
                } catch {
                    CAPLog.print("NLDE SESSION restart after route change FAIL: \(error.localizedDescription)")
                    self.emitState()
                }
                return
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
            // A configuration change (sample-rate swap, hardware reroute, etc.)
            // invalidates every scheduled buffer on every AVAudioPlayerNode.
            // Simply calling engine.start() leaves the nodes armed but empty →
            // silent output until the next manual seek. To avoid that, snap
            // the current position, tear everything down, and relaunch via the
            // normal startPlayback path so buffers get rescheduled from the
            // resume point.
            guard self.isPlaying else {
                self.emitState()
                return
            }

            let resumeTime = self.currentTime()
            self.stopPlayback(resetPosition: false, shouldEmitState: false)
            self.seekOffset = min(max(0, resumeTime), self.duration)

            do {
                try self.startPlayback()
            } catch {
                CAPLog.print("NLDE SESSION restart after configuration change FAIL: \(error.localizedDescription)")
                self.emitState()
            }
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
