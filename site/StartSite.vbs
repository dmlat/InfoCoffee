Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & Replace(WScript.ScriptFullName, "StartSite.vbs", "start_site.bat") & Chr(34), 0, False
