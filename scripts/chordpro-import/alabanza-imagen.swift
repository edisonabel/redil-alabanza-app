// Herramienta local de imagen para importar ChordPro (macOS: PDFKit + Vision). Sin red.
//   pdf <entrada.pdf> <prefijo-salida> <ancho>      → páginas como PNG
//   prepare <imagen> <salida.png> <ancho-mínimo>     → PNG ampliado con interpolación alta (nunca reduce)
//   ocr <imagen>                                      → JSON con cada línea y la x de cada letra
//   gray <imagen> <salida.raw>                        → píxeles en escala de grises (1 byte)
//   crop <imagen> <x> <y> <ancho> <alto> <escala> <salida.png>
//   thumb <imagen> <ancho> <salida.jpg>
import AppKit
import PDFKit
import Vision

func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
func load(_ path: String) -> CGImage {
  guard let image = NSImage(contentsOfFile: path)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("No pude abrir la imagen \(path)") }
  return image
}
func render(width: Int, height: Int, draw: (CGContext) -> Void) -> CGImage {
  let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  context.interpolationQuality = .high
  draw(context)
  return context.makeImage()!
}
func write(_ image: CGImage, _ path: String, jpeg: Bool = false) {
  let rep = NSBitmapImageRep(cgImage: image)
  let data = jpeg ? rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) : rep.representation(using: .png, properties: [:])
  try! data!.write(to: URL(fileURLWithPath: path))
}
func scaled(_ image: CGImage, _ factor: CGFloat) -> CGImage {
  let w = max(1, Int(CGFloat(image.width) * factor)), h = max(1, Int(CGFloat(image.height) * factor))
  return render(width: w, height: h) { $0.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h)) }
}

let args = CommandLine.arguments
guard args.count > 1 else { fail("Falta el subcomando") }
switch args[1] {
case "pdf":
  guard let document = PDFDocument(url: URL(fileURLWithPath: args[2])) else { fail("No pude abrir el PDF") }
  let target = CGFloat(Double(args[4]) ?? 2600)
  for i in 0..<document.pageCount {
    guard let page = document.page(at: i) else { continue }
    let box = page.bounds(for: .mediaBox), factor = target / box.width
    let w = Int(box.width * factor), h = Int(box.height * factor)
    let image = render(width: w, height: h) { context in
      context.setFillColor(NSColor.white.cgColor); context.fill(CGRect(x: 0, y: 0, width: w, height: h))
      context.scaleBy(x: factor, y: factor); page.draw(with: .mediaBox, to: context)
    }
    write(image, "\(args[3])-p\(i + 1).png")
  }
  print(document.pageCount)
case "prepare":
  let image = load(args[2]), minimum = CGFloat(Double(args[4]) ?? 2400)
  let factor = max(1, min(3, minimum / CGFloat(image.width)))
  write(factor > 1.01 ? scaled(image, factor) : image, args[3])
  print(factor)
case "ocr":
  let image = load(args[2])
  let width = CGFloat(image.width), height = CGFloat(image.height)
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false // no "corregir" nombres de acordes
  request.recognitionLanguages = ["es-ES", "en-US"]
  try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string
    // Vision devuelve la caja de la palabra aunque se pida una letra: se reparte cada palabra entre sus letras.
    var xs = [Double](repeating: -1, count: text.count)
    var offset = 0
    for word in text.split(separator: " ", omittingEmptySubsequences: false) {
      let count = word.count
      if count > 0, let box = try? candidate.boundingBox(for: word.startIndex..<word.endIndex) {
        let x0 = Double(box.boundingBox.minX * width), x1 = Double(box.boundingBox.maxX * width)
        for k in 0..<count { xs[offset + k] = x0 + (x1 - x0) * Double(k) / Double(count) }
        if offset + count < xs.count { xs[offset + count] = x1 }
      }
      offset += count + 1
    }
    let box = observation.boundingBox
    lines.append(["text": text, "chars": xs, "x0": Double(box.minX * width), "x1": Double(box.maxX * width),
                  "top": Double((1 - box.maxY) * height), "bottom": Double((1 - box.minY) * height)])
  }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["width": Double(width), "height": Double(height), "lines": lines]))
case "gray":
  let image = load(args[2])
  var pixels = [UInt8](repeating: 0, count: image.width * image.height)
  let context = CGContext(data: &pixels, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width,
                          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  FileManager.default.createFile(atPath: args[3], contents: Data(pixels))
case "crop":
  let image = load(args[2])
  let x = max(0, Int(Double(args[3])!)), y = max(0, Int(Double(args[4])!))
  let w = min(image.width - x, Int(Double(args[5])!)), h = min(image.height - y, Int(Double(args[6])!))
  guard w > 0, h > 0, let piece = image.cropping(to: CGRect(x: x, y: y, width: w, height: h)) else { fail("Recorte vacío") }
  write(scaled(piece, CGFloat(Double(args[7]) ?? 3)), args[8])
case "thumb":
  let image = load(args[2]), target = CGFloat(Double(args[3]) ?? 900)
  write(scaled(image, min(1, target / CGFloat(image.width))), args[4], jpeg: true)
default:
  fail("Subcomando desconocido: \(args[1])")
}
