import AppKit
import Foundation

// A project-local demo mark. The fixture and UI use this without claiming an official corporate logo.
func render(size: Int, background: Bool, output: String) throws {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
  ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "demo-icon", code: 1) }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.cgContext.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)

  if background {
    NSColor(calibratedRed: 69 / 255, green: 35 / 255, blue: 71 / 255, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024)).fill()
  }
  let c = NSBezierPath()
  c.lineWidth = 100
  c.lineCapStyle = .round
  c.appendArc(withCenter: NSPoint(x: 500, y: 535), radius: 255, startAngle: 48, endAngle: 312, clockwise: false)
  NSColor(calibratedRed: 1, green: 0.976, blue: 0.957, alpha: 1).setStroke()
  c.stroke()

  let check = NSBezierPath()
  check.lineWidth = 102
  check.lineCapStyle = .round
  check.lineJoinStyle = .round
  check.move(to: NSPoint(x: 550, y: 322))
  check.line(to: NSPoint(x: 640, y: 235))
  check.line(to: NSPoint(x: 818, y: 442))
  NSColor(calibratedRed: 0.953, green: 0.650, blue: 0.705, alpha: 1).setStroke()
  check.stroke()

  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "demo-icon", code: 2) }
  try png.write(to: URL(fileURLWithPath: output))
}

let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("assets")
try render(size: 1024, background: true, output: directory.appendingPathComponent("icon.png").path)
try render(size: 1024, background: false, output: directory.appendingPathComponent("adaptive-icon.png").path)
try render(size: 48, background: true, output: directory.appendingPathComponent("favicon.png").path)
