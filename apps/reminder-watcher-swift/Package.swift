// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ReminderWatcher",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "reminder-watcher", targets: ["ReminderWatcher"])
    ],
    targets: [
        .executableTarget(name: "ReminderWatcher")
    ]
)
