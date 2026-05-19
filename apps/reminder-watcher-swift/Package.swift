// swift-tools-version: 6.0
import PackageDescription

let infoPlistLinkerFlags = [
    "-Xlinker", "-sectcreate",
    "-Xlinker", "__TEXT",
    "-Xlinker", "__info_plist",
    "-Xlinker", "Info.plist"
]

let package = Package(
    name: "ReminderWatcher",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "reminder-watcher", targets: ["ReminderWatcher"]),
        .executable(name: "reminderctl", targets: ["ReminderCtl"])
    ],
    targets: [
        .executableTarget(name: "ReminderWatcher", linkerSettings: [.unsafeFlags(infoPlistLinkerFlags)]),
        .executableTarget(name: "ReminderCtl", linkerSettings: [.unsafeFlags(infoPlistLinkerFlags)])
    ]
)
