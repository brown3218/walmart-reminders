import EventKit
import Foundation

struct ReminderSnapshot: Codable {
    let externalId: String
    let listId: String
    let listName: String
    let title: String
    let notes: String?
    let completed: Bool
}

struct ReminderCtlError: Error, CustomStringConvertible {
    let description: String
}

do {
    let store = EKEventStore()
    try requestReminderAccess(store: store)
    try runCommand(Array(CommandLine.arguments.dropFirst()), store: store)
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}

func runCommand(_ arguments: [String], store: EKEventStore) throws {
    guard let command = arguments.first else {
        throw usageError()
    }
    let rest = Array(arguments.dropFirst())

    switch command {
    case "list":
        let listNames = values(after: "--list-names", in: rest)
        guard !listNames.isEmpty else { throw usageError() }
        try listReminders(store: store, listNames: listNames)
    case "complete":
        let reminder = try findReminder(store: store, externalId: requiredValue(after: "--external-id", in: rest))
        reminder.isCompleted = true
        try store.save(reminder, commit: true)
        printJson(["ok": true])
    case "delete":
        let reminder = try findReminder(store: store, externalId: requiredValue(after: "--external-id", in: rest))
        try store.remove(reminder, commit: true)
        printJson(["ok": true])
    case "rename":
        let reminder = try findReminder(store: store, externalId: requiredValue(after: "--external-id", in: rest))
        reminder.title = try requiredValue(after: "--title", in: rest)
        try store.save(reminder, commit: true)
        printJson(["ok": true])
    case "create":
        let listName = try requiredValue(after: "--list-name", in: rest)
        let title = try requiredValue(after: "--title", in: rest)
        let calendar = try findCalendar(store: store, named: listName)
        let reminder = EKReminder(eventStore: store)
        reminder.calendar = calendar
        reminder.title = title
        try store.save(reminder, commit: true)
        printSnapshot(reminder, calendar: calendar)
    default:
        throw usageError()
    }
}

@MainActor
func requestReminderAccess(store: EKEventStore) throws {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    if #available(macOS 14.0, *) {
        if status == .fullAccess || status == .writeOnly {
            return
        }
    } else if status == .authorized {
        return
    }

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
    if let authError { throw authError }
    guard granted else {
        throw ReminderCtlError(description: "Reminders access was not granted.")
    }
}

func listReminders(store: EKEventStore, listNames: [String]) throws {
    let calendars = store.calendars(for: .reminder).filter { listNames.contains($0.title) }
    guard !calendars.isEmpty else {
        throw ReminderCtlError(description: "No Reminders list found. Tried: \(listNames.joined(separator: ", "))")
    }

    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    for reminder in fetchReminders(store: store, matching: predicate) {
        if let calendar = calendars.first(where: { $0.calendarIdentifier == reminder.calendar.calendarIdentifier }) {
            printSnapshot(reminder, calendar: calendar)
        }
    }
}

func findReminder(store: EKEventStore, externalId: String) throws -> EKReminder {
    if let reminder = store.calendarItem(withIdentifier: externalId) as? EKReminder {
        return reminder
    }

    let predicate = store.predicateForReminders(in: nil)
    if let reminder = fetchReminders(store: store, matching: predicate).first(where: { $0.calendarItemIdentifier == externalId }) {
        return reminder
    }

    throw ReminderCtlError(description: "Reminder was not found: \(externalId)")
}

func fetchReminders(store: EKEventStore, matching predicate: NSPredicate) -> [EKReminder] {
    let semaphore = DispatchSemaphore(value: 0)
    var output: [EKReminder] = []
    store.fetchReminders(matching: predicate) { reminders in
        output = reminders ?? []
        semaphore.signal()
    }
    semaphore.wait()
    return output
}

func findCalendar(store: EKEventStore, named listName: String) throws -> EKCalendar {
    guard let calendar = store.calendars(for: .reminder).first(where: { $0.title == listName }) else {
        throw ReminderCtlError(description: "Reminders list was not found: \(listName)")
    }
    return calendar
}

func requiredValue(after flag: String, in arguments: [String]) throws -> String {
    guard let value = values(after: flag, in: arguments).first else {
        throw usageError()
    }
    return value
}

func values(after flag: String, in arguments: [String]) -> [String] {
    guard let start = arguments.firstIndex(of: flag) else {
        return []
    }
    let valueStart = start + 1
    guard valueStart < arguments.count else {
        return []
    }
    var output: [String] = []
    for value in arguments[valueStart...] {
        if value.hasPrefix("--") { break }
        output.append(value)
    }
    return output
}

func printSnapshot(_ reminder: EKReminder, calendar: EKCalendar) {
    let snapshot = ReminderSnapshot(
        externalId: reminder.calendarItemIdentifier,
        listId: calendar.calendarIdentifier,
        listName: calendar.title,
        title: reminder.title ?? "",
        notes: reminder.notes,
        completed: reminder.isCompleted
    )
    if let data = try? JSONEncoder().encode(snapshot), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}

func printJson(_ object: [String: Bool]) {
    if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}

func usageError() -> ReminderCtlError {
    ReminderCtlError(
        description: """
        Usage:
          reminderctl list --list-names <names...>
          reminderctl complete --external-id <id>
          reminderctl delete --external-id <id>
          reminderctl rename --external-id <id> --title <title>
          reminderctl create --list-name <name> --title <title>
        """
    )
}
