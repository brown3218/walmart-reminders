on cleanText(v)
  if v is missing value then return ""
  set t to v as text
  set AppleScript's text item delimiters to tab
  set parts to text items of t
  set AppleScript's text item delimiters to " "
  set t to parts as text
  set AppleScript's text item delimiters to linefeed
  set parts to text items of t
  set AppleScript's text item delimiters to " "
  set t to parts as text
  set AppleScript's text item delimiters to return
  set parts to text items of t
  set AppleScript's text item delimiters to " "
  set t to parts as text
  set AppleScript's text item delimiters to ""
  return t
end cleanText

on run argv
  set outputLines to {}
  tell application "Reminders"
    set targetLists to {}
    repeat with listName in argv
      try
        set candidateList to list (listName as text)
        set end of targetLists to candidateList
      end try
    end repeat

    if (count of targetLists) is 0 then
      error "No configured Reminders list was found."
    end if

    repeat with targetList in targetLists
      set listId to id of targetList as text
      set listName to name of targetList as text
      repeat with r in reminders of targetList
        if completed of r is false then
          set rid to id of r as text
          set titleText to my cleanText(name of r)
          set noteText to my cleanText(body of r)
          set end of outputLines to rid & tab & listId & tab & listName & tab & titleText & tab & noteText & tab & "false"
        end if
      end repeat
    end repeat
  end tell

  set AppleScript's text item delimiters to linefeed
  set outputText to outputLines as text
  set AppleScript's text item delimiters to ""
  return outputText
end run
