// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "GuitarCowriter",
    platforms: [.macOS(.v14)],
    targets: [
        // Pure music engine + data model (ported from src/engine/*.ts)
        .target(name: "CoWriterKit", path: "Sources/CoWriterKit"),
        // AVAudioEngine body: devices, AU hosting, transport, listening
        .target(name: "CoWriterAudio", dependencies: ["CoWriterKit"], path: "Sources/CoWriterAudio"),
        // The app: SwiftUI shell + brain bridge
        .executableTarget(
            name: "GuitarCowriter",
            dependencies: ["CoWriterKit", "CoWriterAudio"],
            path: "Sources/GuitarCowriter"
        ),
        // CLT has no XCTest/Testing modules — checks run as a plain executable
        .executableTarget(name: "CoWriterKitChecks", dependencies: ["CoWriterKit"], path: "Checks"),
    ]
)
