import EventKit
import Foundation

struct ReminderSnapshot: Codable {
    let externalId: String
    let listId: String
    let title: String
    let notes: String?
    let completed: Bool
}

let listNames = CommandLine.arguments.dropFirst().isEmpty
    ? ["Walmart", "Walmart shopping list"]
    : Array(CommandLine.arguments.dropFirst())

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var granted = false
var authError: Error?

if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { accessGranted, error in
        granted = accessGranted
        authError = error
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .reminder) { accessGranted, error in
        granted = accessGranted
        authError = error
        semaphore.signal()
    }
}

semaphore.wait()

if let authError {
    fputs("Reminders authorization failed: \(authError.localizedDescription)\n", stderr)
    exit(2)
}

guard granted else {
    fputs("Reminders access was not granted.\n", stderr)
    exit(3)
}

let calendars = store.calendars(for: .reminder)
guard let calendar = calendars.first(where: { listNames.contains($0.title) }) else {
    fputs("No Reminders list found. Tried: \(listNames.joined(separator: ", "))\n", stderr)
    exit(4)
}

let predicate = store.predicateForIncompleteReminders(
    withDueDateStarting: nil,
    ending: nil,
    calendars: [calendar]
)

store.fetchReminders(matching: predicate) { reminders in
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    for reminder in reminders ?? [] {
        let snapshot = ReminderSnapshot(
            externalId: reminder.calendarItemIdentifier,
            listId: calendar.calendarIdentifier,
            title: reminder.title ?? "",
            notes: reminder.notes,
            completed: reminder.isCompleted
        )
        if let data = try? encoder.encode(snapshot), let line = String(data: data, encoding: .utf8) {
            print(line)
        }
    }
    semaphore.signal()
}

semaphore.wait()
