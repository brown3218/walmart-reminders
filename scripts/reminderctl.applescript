on usage()
  error "Usage: reminderctl.applescript complete|delete|rename|create ..."
end usage

on findReminderById(externalId)
  tell application "Reminders"
    repeat with targetList in lists
      repeat with candidate in reminders of targetList
        if (id of candidate as text) is externalId then return candidate
      end repeat
    end repeat
  end tell
  return missing value
end findReminderById

on run argv
  if (count of argv) is 0 then my usage()
  set commandName to item 1 of argv

  tell application "Reminders"
    if commandName is "complete" then
      if (count of argv) is not 2 then my usage()
      set targetReminder to my findReminderById(item 2 of argv)
      if targetReminder is missing value then error "Reminder was not found."
      set completed of targetReminder to true
      return "ok"
    else if commandName is "delete" then
      if (count of argv) is not 2 then my usage()
      set targetReminder to my findReminderById(item 2 of argv)
      if targetReminder is missing value then error "Reminder was not found."
      delete targetReminder
      return "ok"
    else if commandName is "rename" then
      if (count of argv) is not 3 then my usage()
      set targetReminder to my findReminderById(item 2 of argv)
      if targetReminder is missing value then error "Reminder was not found."
      set name of targetReminder to item 3 of argv
      return "ok"
    else if commandName is "create" then
      if (count of argv) is not 3 then my usage()
      set targetList to list (item 2 of argv)
      make new reminder at end of reminders of targetList with properties {name:item 3 of argv}
      return "ok"
    else
      my usage()
    end if
  end tell
end run
