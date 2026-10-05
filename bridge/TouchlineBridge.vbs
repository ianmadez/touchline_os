' ---------------------------------------------------------------------------
'  TouchlineOS bridge - hidden launcher.
'
'  Resolves its own folder so a desktop shortcut keeps working wherever the
'  folder is moved, then runs TouchlineBridge.cmd with the console VISIBLE.
'
'  Visible on purpose, and unlike the reference companion's hidden wrapper: the
'  pairing code is printed to that console, so hiding it would hide the one thing
'  the manager has to read.
' ---------------------------------------------------------------------------
Option Explicit

Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)

' 1 = normal window, False = do not wait for it to finish.
shell.Run """" & here & "\TouchlineBridge.cmd""", 1, False
