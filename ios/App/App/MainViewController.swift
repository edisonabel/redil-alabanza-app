import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        if bridge?.plugin(withName: "NativeLiveDirectorEngine") == nil {
            bridge?.registerPluginInstance(NativeLiveDirectorEnginePlugin())
        }
    }
}
