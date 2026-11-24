; =========================================================================
; df-decode v1.0.0 — Script de Instalación NSIS para Windows (x64)
; =========================================================================

!include "MUI2.nsh"
!include "FileFunc.nsh"

; Definiciones Generales
!define PRODUCT_NAME "df-decode"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Walther Curo De La Cruz"
!define PRODUCT_WEB_SITE "https://github.com/walthercurodelacruz/DF-DECODE"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\df-decode.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKCU"

SetCompressor /SOLID lzma

; Configuración de Modern UI
!define MUI_ABORTWARNING
!define MUI_ICON "../assets/icon.ico"
!define MUI_UNICON "../assets/icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH

; Páginas del Instalador
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; Página Final: Opción de ejecutar la app
!define MUI_FINISHPAGE_RUN "$INSTDIR\df-decode.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Ejecutar df-decode"
!insertmacro MUI_PAGE_FINISH

; Páginas del Desinstalador
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma
!insertmacro MUI_LANGUAGE "Spanish"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "../dist/df-decode-setup-${PRODUCT_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\df-decode"
InstallDirRegKey HKCU "${PRODUCT_DIR_REGKEY}" ""
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel user

; =========================================================================
; SECCIÓN PRINCIPAL DE INSTALACIÓN
; =========================================================================
Section "Principal" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite try

  ; Copiar todos los archivos desempaquetados de Electron
  File /r "..\dist\win-unpacked\*.*"

  ; Crear accesos directos
  CreateDirectory "$SMPROGRAMS\df-decode"
  CreateShortcut "$SMPROGRAMS\df-decode\df-decode.lnk" "$INSTDIR\df-decode.exe" "" "$INSTDIR\df-decode.exe" 0
  CreateShortcut "$SMPROGRAMS\df-decode\Desinstalar df-decode.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0
  CreateShortcut "$DESKTOP\df-decode.lnk" "$INSTDIR\df-decode.exe" "" "$INSTDIR\df-decode.exe" 0

  ; Registrar Asociación de Archivos .dfx
  WriteRegStr HKCU "Software\Classes\.dfx" "" "dfdecode.Diagram"
  WriteRegStr HKCU "Software\Classes\dfdecode.Diagram" "" "Diagrama de Flujo df-decode"
  WriteRegStr HKCU "Software\Classes\dfdecode.Diagram\DefaultIcon" "" "$INSTDIR\df-decode.exe,0"
  WriteRegStr HKCU "Software\Classes\dfdecode.Diagram\shell\open\command" "" '"$INSTDIR\df-decode.exe" "%1"'

  ; Registrar Asociación de Archivos .dfd (DFD)
  WriteRegStr HKCU "Software\Classes\.dfd" "" "dfdecode.DFD"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFD" "" "Diagrama DFD"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFD\DefaultIcon" "" "$INSTDIR\df-decode.exe,0"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFD\shell\open\command" "" '"$INSTDIR\df-decode.exe" "%1"'

  ; Registrar Asociación de Archivos .dfdx (JSON heredado)
  WriteRegStr HKCU "Software\Classes\.dfdx" "" "dfdecode.DFDX"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFDX" "" "Diagrama df-decode JSON"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFDX\DefaultIcon" "" "$INSTDIR\df-decode.exe,0"
  WriteRegStr HKCU "Software\Classes\dfdecode.DFDX\shell\open\command" "" '"$INSTDIR\df-decode.exe" "%1"'

  ; Notificar al explorador de Windows sobre nuevas asociaciones
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\df-decode.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\df-decode.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
SectionEnd

; =========================================================================
; SECCIÓN DE DESINSTALACIÓN
; =========================================================================
Section Uninstall
  ; Eliminar accesos directos
  Delete "$DESKTOP\df-decode.lnk"
  Delete "$SMPROGRAMS\df-decode\df-decode.lnk"
  Delete "$SMPROGRAMS\df-decode\Desinstalar df-decode.lnk"
  RMDir "$SMPROGRAMS\df-decode"

  ; Eliminar asociaciones del registro
  DeleteRegKey HKCU "Software\Classes\.dfx"
  DeleteRegKey HKCU "Software\Classes\dfdecode.Diagram"
  DeleteRegKey HKCU "Software\Classes\.dfd"
  DeleteRegKey HKCU "Software\Classes\dfdecode.DFD"
  DeleteRegKey HKCU "Software\Classes\.dfdx"
  DeleteRegKey HKCU "Software\Classes\dfdecode.DFDX"

  ; Eliminar registro de desinstalación
  DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"

  ; Eliminar archivos de la aplicación
  RMDir /r "$INSTDIR"

  SetAutoClose true
SectionEnd
