; Build through build_installer.py: metadata comes from agent/version.py.
#ifndef AgentName
  #error AgentName must be supplied by build_installer.py
#endif
#ifndef AgentVersion
  #error AgentVersion must be supplied by build_installer.py
#endif
#ifndef PublisherDisplayName
  #error PublisherDisplayName must be supplied by build_installer.py
#endif
#ifndef AgentDescription
  #error AgentDescription must be supplied by build_installer.py
#endif

[Setup]
AppId=WorkPulse.Agent
AppName={#AgentName}
AppVersion={#AgentVersion}
AppVerName={#AgentName} {#AgentVersion}
AppPublisher={#PublisherDisplayName}
AppComments={#AgentDescription}. Publisher display name is provisional; no verified identity or signing is claimed.
VersionInfoVersion={#AgentVersion}.0
VersionInfoTextVersion={#AgentVersion}
VersionInfoProductVersion={#AgentVersion}.0
VersionInfoProductTextVersion={#AgentVersion}
VersionInfoCompany={#PublisherDisplayName}
VersionInfoDescription={#AgentDescription} Setup
DefaultDirName={autopf}\WorkPulse Agent
DefaultGroupName=WorkPulse Agent
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.10240
WizardStyle=modern
DisableProgramGroupPage=no
UsePreviousTasks=no
UninstallDisplayIcon={app}\WorkPulseAgent.exe
UninstallDisplayName={#AgentName} {#AgentVersion}
InfoBeforeFile=PRIVACY.txt
OutputDir=..\dist\installer
OutputBaseFilename=WorkPulseAgent-{#AgentVersion}-Setup-x64
Compression=lzma2
SolidCompression=yes
SignedUninstaller=no
CloseApplications=yes
RestartApplications=no
SetupLogging=no

[Tasks]
Name: "startup"; Description: "Add current-user Windows startup (opens PAUSED; unchecked makes no startup changes)"; GroupDescription: "Optional startup:"; Flags: unchecked

[Files]
Source: "..\dist\gui\WorkPulseAgent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "PRIVACY.txt"; DestDir: "{app}\documentation"; Flags: ignoreversion
Source: "..\packaging\BUILDING.md"; DestDir: "{app}\documentation"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}\documentation"; Flags: ignoreversion

[Icons]
Name: "{group}\WorkPulse Agent"; Filename: "{app}\WorkPulseAgent.exe"; WorkingDir: "{app}"; Comment: "{#AgentDescription}"; AppUserModelID: "WorkPulse.Agent"
Name: "{group}\Installation and privacy notice"; Filename: "{app}\documentation\PRIVACY.txt"
Name: "{group}\Uninstall WorkPulse Agent"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\WorkPulseAgent.exe"; Description: "Open WorkPulse Agent (tracking stays PAUSED)"; Flags: postinstall nowait skipifsilent unchecked runasoriginaluser

; Intentionally no [UninstallDelete] entries and no user-data [Files] entries.
; Inno removes only installed files/shortcuts, not employee data or credentials.
[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  StartupEnabled: Boolean;
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('startup') then
  begin
    ResultCode := -1;
    StartupEnabled := False;
    try
      StartupEnabled := ExecAsOriginalUser(ExpandConstant('{app}\WorkPulseAgent.exe'),
        '--enable-startup', ExpandConstant('{app}'), SW_SHOWNORMAL,
        ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
    except
      StartupEnabled := False;
    end;
    if not StartupEnabled then
      SuppressibleMsgBox('The current-user startup setting could not be enabled. No tracking was started. Use the WorkPulse tray to check or change startup later.', mbInformation, MB_OK, IDOK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ExistingValue, OwnedValue: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    OwnedValue := ExpandConstant('{app}\WorkPulseAgent.exe');
    if Pos(' ', OwnedValue) > 0 then
      OwnedValue := '"' + OwnedValue + '"';
    OwnedValue := OwnedValue + ' --startup';
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run',
      'WorkPulse Agent', ExistingValue) and (CompareText(ExistingValue, OwnedValue) = 0) then
      RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'WorkPulse Agent');
    if not UninstallSilent then
      MsgBox('WorkPulse employee activity data, logs, custom configuration and credentials will be retained. Other Windows accounts must remove their own startup preference. No employee data is deleted by this uninstaller.', mbInformation, MB_OK);
  end;
end;
