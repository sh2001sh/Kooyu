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
!macroend
