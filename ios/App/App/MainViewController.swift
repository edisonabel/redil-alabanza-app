import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginType(NativeLiveDirectorEnginePlugin.self)
    }
}
