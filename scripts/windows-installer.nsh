; Pause work and drain the verified detached Host before replacing locked files.
!define KOOYU_HOST_GUARD_SOURCE "${__FILEDIR__}\installer-host-guard.mjs"
!macro GUARD_KOOYU_HOST NODE_ROOT ROOT1 ROOT2 ROOT3
  ${If} ${FileExists} "${NODE_ROOT}\resources\runtime\node.exe"
  InitPluginsDir
  File /oname=$PLUGINSDIR\kooyu-host-guard.mjs "${KOOYU_HOST_GUARD_SOURCE}"
  nsExec::ExecToStack '"${NODE_ROOT}\resources\runtime\node.exe" "$PLUGINSDIR\kooyu-host-guard.mjs" "${ROOT1}\resources" "${ROOT2}\resources" "${ROOT3}\resources"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Kooyu could not safely prepare its Host for installation. Your conversations were preserved.$\r$\n$1" /SD IDOK
    Abort
  ${EndIf}
  ${EndIf}
!macroend

!macro STOP_KOOYU_PROCESSES
  Push $0
  Push $1
  Push $R8
  Push $R9
  ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} ${FileExists} "$INSTDIR\resources\runtime\node.exe"
    !insertmacro GUARD_KOOYU_HOST "$INSTDIR" "$INSTDIR" "$R8" "$R9"
  ${ElseIf} ${FileExists} "$R8\resources\runtime\node.exe"
    !insertmacro GUARD_KOOYU_HOST "$R8" "$INSTDIR" "$R8" "$R9"
  ${ElseIf} ${FileExists} "$R9\resources\runtime\node.exe"
    !insertmacro GUARD_KOOYU_HOST "$R9" "$INSTDIR" "$R8" "$R9"
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "KOOYU_STOP_INSTDIR", t "$INSTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "KOOYU_STOP_PREV_CU", t "$R8")'
  System::Call 'kernel32::SetEnvironmentVariable(t "KOOYU_STOP_PREV_LM", t "$R9")'
  ; The Host has drained. Close only Kooyu UI processes in these installation directories.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dirs = @($$env:KOOYU_STOP_INSTDIR, $$env:KOOYU_STOP_PREV_CU, $$env:KOOYU_STOP_PREV_LM) | Where-Object { $$_ -and $$_.Trim().Length -gt 3 } | ForEach-Object { $$_.TrimEnd([char]92) + [char]92 }; Get-CimInstance Win32_Process | Where-Object { $$p = $$_; $$p.Name -ieq ''Kooyu.exe'' -and @($$dirs | Where-Object { $$p.ExecutablePath.StartsWith($$_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 } | ForEach-Object { Stop-Process -Id $$_.ProcessId -ErrorAction SilentlyContinue }"'
  Pop $0
  Pop $1
  Pop $R9
  Pop $R8
  Pop $1
  Pop $0
!macroend

; A build workspace can label generated executables Low integrity. Windows
; then starts NSIS at Low integrity, even from a normal Explorer process.
; Detect this before extraction turns access denied into an app-running error.
!macro customInit
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $4 0
  System::Call 'advapi32::OpenProcessToken(p -1, i 8, *p .r0) i .r3'
  ${If} $3 != 0
    System::Alloc 256
    Pop $1
    ${If} $1 != 0
      System::Call 'advapi32::GetTokenInformation(p r0, i 25, p r1, i 256, *i .r2) i .r3'
      ${If} $3 != 0
        System::Call '*$1(p .r2)'
        System::Call 'advapi32::GetSidSubAuthority(p r2, i 0) p .r3'
        System::Call '*$3(i .r4)'
      ${EndIf}
      System::Free $1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  ${If} $4 > 0
  ${AndIf} $4 < 8192
    MessageBox MB_OK|MB_ICONSTOP "Windows started this installer with Low integrity, so it cannot write application files.$\r$\n$\r$\nCopy the installer to your Downloads folder or another normal folder outside the build workspace, then run that copy." /SD IDOK
    SetErrorLevel 5
    Quit
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0

  ; In per-machine elevated inner instances, electron-builder's installSection.nsh
  ; skips CHECK_APP_RUNNING. Stop Kooyu & its detached Host here right after UAC
  ; approval so uninstallOldVersion and file extraction never hit locked handles.
  !ifndef ONE_CLICK
    ${If} ${UAC_IsInnerInstance}
      !insertmacro STOP_KOOYU_PROCESSES
    ${EndIf}
  !endif
!macroend

!macro customCheckAppRunning
  !insertmacro STOP_KOOYU_PROCESSES
!macroend

!macro customUnInstall
  !insertmacro STOP_KOOYU_PROCESSES
!macroend

; The detached migration checks idle state and identity before touching the Host.
; Busy work keeps running; the helper retries after it finishes.
!macro customInstall
  ExecShell "open" "$INSTDIR\resources\runtime\node.exe" '"$INSTDIR\resources\upgrade-host.mjs" "$INSTDIR\resources"' SW_HIDE
!macroend
