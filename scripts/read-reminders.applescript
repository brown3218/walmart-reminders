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
    set targetList to missing value
    repeat with listName in argv
      try
        set candidateList to list (listName as text)
        set candidateListId to id of candidateList as text
        set targetList to candidateList
        exit repeat
      end try
    end repeat

    if targetList is missing value then
      error "No configured Reminders list was found."
    end if

    set listId to id of targetList as text
    repeat with r in reminders of targetList
      if completed of r is false then
        set rid to id of r as text
        set titleText to my cleanText(name of r)
        set noteText to my cleanText(body of r)
        set end of outputLines to rid & tab & listId & tab & titleText & tab & noteText & tab & "false"
      end if
    end repeat
  end tell

  set AppleScript's text item delimiters to linefeed
  set outputText to outputLines as text
  set AppleScript's text item delimiters to ""
  return outputText
end run
