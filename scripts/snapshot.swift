import AppKit
import WebKit

// snapshot <url> <out.png> <width> <height> [scale] [transparent]
// Loads a page in macOS's own WebKit (no browser to install), waits for its
// web fonts and one layout pass, and writes the top width×height points as a
// PNG at scale× the pixels. scripts/previews.mjs compiles and runs it.
let args = CommandLine.arguments
guard args.count >= 5, let target = URL(string: args[1]), let width = Double(args[3]), let height = Double(args[4]) else {
  FileHandle.standardError.write("usage: snapshot <url> <out.png> <width> <height> [scale]\n".data(using: .utf8)!); exit(2)
}

final class Shooter: NSObject, WKNavigationDelegate {
  let out: String, width: Double, height: Double, scale: Double
  init(out: String, width: Double, height: Double, scale: Double) { self.out = out; self.width = width; self.height = height; self.scale = scale }
  func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript("await document.fonts.ready; await new Promise(r => setTimeout(r, 1200)); return true;", arguments: [:], in: nil, in: .page) { _ in
      let config = WKSnapshotConfiguration()
      config.rect = CGRect(x: 0, y: 0, width: self.width, height: self.height)
      config.snapshotWidth = NSNumber(value: self.width)
      webView.takeSnapshot(with: config) { image, error in
        guard let image else { self.fail("snapshot failed: \(String(describing: error))") }
        let pw = Int(self.width * self.scale), ph = Int(self.height * self.scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pw, pixelsHigh: ph, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { self.fail("no bitmap") }
        rep.size = NSSize(width: pw, height: ph)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pw, height: ph))
        NSGraphicsContext.restoreGraphicsState()
        guard let data = rep.representation(using: .png, properties: [:]) else { self.fail("no png") }
        do { try data.write(to: URL(fileURLWithPath: self.out)) } catch { self.fail("\(error)") }
        exit(0)
      }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let frame = NSRect(x: 0, y: 0, width: width, height: height)
let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()   // no cache: every run sees the files as they are
let webView = WKWebView(frame: frame, configuration: configuration)
webView.appearance = NSAppearance(named: .aqua)   // the light theme
window.contentView = webView
if args.count > 6 && args[6] == "transparent" { webView.setValue(false, forKey: "drawsBackground") }
let shooter = Shooter(out: args[2], width: width, height: height, scale: args.count > 5 ? Double(args[5]) ?? 1 : 1)
webView.navigationDelegate = shooter
webView.load(URLRequest(url: target))
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { FileHandle.standardError.write("timed out\n".data(using: .utf8)!); exit(1) }
app.run()
